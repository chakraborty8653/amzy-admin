import { TelegramChannelConfig, DownloadedVideo, MediaItem, MediaPlaylist } from '../types';
import { getBackendUrl } from './backendApi';
import { isLongVideo } from '../utils/duration';
import { Capacitor } from '@capacitor/core';
import {
  TelegramNative,
  type TelegramPrivateVideoFeed,
} from './telegramNative';

let privateStreamMessageListenerAdded = false;

const STORAGE_KEY_CHANNELS = 'teleflix_saved_channels';
const STORAGE_KEY_ACTIVE_CHANNEL = 'teleflix_active_channel_id';
const STORAGE_KEY_MY_LIST = 'teleflix_my_list';
const STORAGE_KEY_PLAYLISTS = 'amzy_media_playlists';
const STORAGE_KEY_WATCH_PROGRESS = 'teleflix_watch_progress';
const STORAGE_KEY_WATCH_POSITIONS = 'teleflix_watch_positions';
const STORAGE_KEY_DOWNLOADED_VIDEOS = 'teleflix_downloaded_videos';
const privateThumbnailUrls = new Map<number, string>();
const privateThumbnailLoads = new Map<number, Promise<string>>();
const failedPrivateThumbnailIds = new Set<number>();
const privateThumbnailQueue: (() => void)[] = [];
let activePrivateThumbnailDownloads = 0;

export async function fetchDemoChannels(): Promise<TelegramChannelConfig[]> {
  try {
    const res = await fetch('/api/telegram/demo-channels');
    if (res.ok) {
      const data = await res.json();
      return data.channels || [];
    }
  } catch (e) {
    console.warn('Could not fetch demo channels from server, using local fallback:', e);
  }
  return [];
}

export function normalizeTelegramChannelInput(input: string): string {
  const value = input.trim();
  if (!value) throw new Error('Paste a public Telegram group/channel link or username.');
  if (/^tg:\/\/resolve\?/i.test(value)) {
    const domain = new URL(value).searchParams.get('domain');
    if (domain && /^[a-zA-Z0-9_]{5,}$/.test(domain.replace(/^@/, ''))) {
      return domain.replace(/^@/, '');
    }
    throw new Error('The Telegram link does not contain a valid public group/channel username.');
  }

  const withoutAt = value.replace(/^@/, '');
  if (/^[a-zA-Z0-9_]{5,}$/.test(withoutAt)) return withoutAt;

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    throw new Error('Enter a Telegram username or a valid t.me group/channel link.');
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 't.me' && host !== 'telegram.me') {
    throw new Error('Use a public Telegram link such as https://t.me/group_or_channel.');
  }
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments[0]?.toLowerCase() === 's') segments.shift();
  const username = segments[0];
  if (!username || username.startsWith('+') || username.toLowerCase() === 'joinchat') {
    throw new Error('This is a private invite link. Use it in the Android app to join the group/channel.');
  }
  if (!/^[a-zA-Z0-9_]{5,}$/.test(username)) {
    throw new Error('That link does not contain a valid public group/channel username.');
  }
  return username;
}

export function isTelegramInviteLink(input: string): boolean {
  try {
    const value = input.trim();
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return (host === 't.me' || host === 'telegram.me')
      && /^\/(?:\+[A-Za-z0-9_-]+|joinchat\/[A-Za-z0-9_-]+)\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function isTelegramContentItem(item: MediaItem): boolean {
  return Boolean(item.telegramLink || item.telegramId || item.telegramChatId || item.telegramFileId);
}

export async function inspectTelegramInvite(inviteLink: string) {
  return TelegramNative.inspectInviteLink({ inviteLink: inviteLink.trim() });
}

export async function joinTelegramInvite(inviteLink: string) {
  return TelegramNative.joinInviteLink({ inviteLink: inviteLink.trim() });
}

interface ChannelFeedLoadOptions {
  onPageLoaded?: (page: number) => void;
  onHistoryUpdated?: (channel: TelegramChannelConfig) => void;
  onHistoryError?: (error: Error) => void;
  onHistoryComplete?: (channel: TelegramChannelConfig) => void;
  onChannelBlocked?: (channelId: string) => void;
  loadRemainingHistory?: boolean;
  waitForHistory?: boolean;
  // Refresh mode: keep paging until a page reaches one of these already-saved videos.
  knownVideoIds?: Set<string>;
}

function createPrivateChannel(
  feed: TelegramPrivateVideoFeed,
  videos: TelegramPrivateVideoFeed['items'],
  requestedUsername?: string,
): TelegramChannelConfig {
  const username = requestedUsername || `private_${feed.chatId.replace(/\D/g, '')}`;
  const items: MediaItem[] = videos.map((video) => ({
    id: `telegram_${feed.chatId}_${video.id}`,
    telegramId: video.id,
    telegramChatId: feed.chatId,
    telegramContentRestrictionChecked: true,
    telegramFileId: video.fileId,
    telegramFileSize: video.fileSize || undefined,
    telegramMimeType: video.mimeType || 'video/mp4',
    telegramSupportsStreaming: video.supportsStreaming,
    telegramThumbnailFileId: video.thumbnailFileId || undefined,
    poster: privateThumbnailUrls.get(video.thumbnailFileId)
      || (video.thumbnailData ? `data:image/jpeg;base64,${video.thumbnailData}` : undefined),
    channel: username,
    type: 'video',
    title: video.title,
    caption: video.caption,
    duration: video.duration,
    date: video.date,
    genre: 'Telegram Video',
    matchScore: 90,
    ageRating: '13+',
    resolution: 'HD',
  }));

  return {
    id: `private_${feed.chatId}`,
    username: feed.username || username,
    telegramChatId: feed.chatId,
    telegramChatKind: feed.chatKind || 'channel',
    isPublicTelegramChat: feed.isPublic ?? Boolean(requestedUsername),
    title: feed.title || `Private Telegram ${feed.chatKind || 'channel'}`,
    description: `${feed.isPublic ?? Boolean(requestedUsername) ? 'Public' : 'Private'} Telegram ${feed.chatKind || 'channel'} videos available to your Telegram account on this device.`,
    isCustom: true,
    lastSynced: new Date().toISOString(),
    items,
    featured: items[0],
  };
}

export function needsPrivateThumbnail(item: MediaItem): boolean {
  const fileId = item.telegramThumbnailFileId;
  return Boolean(
    fileId
    && !privateThumbnailUrls.has(fileId)
    && !privateThumbnailLoads.has(fileId)
    && !failedPrivateThumbnailIds.has(fileId)
    && (!item.poster || item.poster.startsWith('data:image/jpeg;base64,')),
  );
}

function queuePrivateThumbnailDownload(download: () => Promise<string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const startDownload = () => {
      activePrivateThumbnailDownloads += 1;
      download()
        .then(resolve, reject)
        .finally(() => {
          activePrivateThumbnailDownloads -= 1;
          privateThumbnailQueue.shift()?.();
        });
    };

    if (activePrivateThumbnailDownloads < 2) {
      startDownload();
    } else {
      privateThumbnailQueue.push(startDownload);
    }
  });
}

export async function loadPrivateThumbnails(channel: TelegramChannelConfig): Promise<void> {
  const items = channel.items.filter(needsPrivateThumbnail);
  let nextItem = 0;
  const loadNext = async () => {
    while (nextItem < items.length) {
      const item = items[nextItem++];
      const fileId = item.telegramThumbnailFileId;
      if (!fileId) continue;
      try {
        let thumbnailLoad = privateThumbnailLoads.get(fileId);
        if (!thumbnailLoad) {
          thumbnailLoad = queuePrivateThumbnailDownload(async () => {
            let thumbnailPath: string | undefined;
            for (let attempt = 0; attempt < 2; attempt += 1) {
              try {
                thumbnailPath = await downloadPrivateTelegramVideo(
                  fileId,
                  item.telegramChatId,
                  item.telegramId,
                );
                break;
              } catch (error) {
                if (attempt === 1) throw error;
                await new Promise((resolve) => window.setTimeout(resolve, 500));
              }
            }
            if (!thumbnailPath) throw new Error(`Telegram returned no thumbnail path for ${item.id}`);
            return thumbnailPath;
          })
            .then((thumbnailPath) => {
              const url = Capacitor.convertFileSrc(thumbnailPath);
              privateThumbnailUrls.set(fileId, url);
              return url;
            })
            .finally(() => privateThumbnailLoads.delete(fileId));
          privateThumbnailLoads.set(fileId, thumbnailLoad);
        }
        const thumbnailUrl = privateThumbnailUrls.get(fileId) || await thumbnailLoad;
        item.poster = thumbnailUrl;
        item.backdrop = thumbnailUrl;
      } catch (error) {
        failedPrivateThumbnailIds.add(fileId);
        console.warn(`Could not load Telegram video thumbnail for ${item.id}:`, error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, items.length) }, () => loadNext()));
}

export async function fetchJoinedPrivateChannelFeed(
  chatId: string,
  options?: ChannelFeedLoadOptions,
): Promise<TelegramChannelConfig> {
  return fetchTelegramClientFeed(
    (fromMessageId) => TelegramNative.getJoinedChannelVideos({ chatId, fromMessageId }),
    options,
  );
}

export async function fetchPublicTelegramClientChannelFeed(
  username: string,
  options?: ChannelFeedLoadOptions,
): Promise<TelegramChannelConfig> {
  const cleanUsername = username.replace(/^@/, '').trim();
  return fetchTelegramClientFeed(
    (fromMessageId) => TelegramNative.getPublicChannelVideos({ username: cleanUsername, fromMessageId }),
    options,
    cleanUsername,
  );
}

async function fetchTelegramClientFeed(
  fetchPage: (fromMessageId?: string) => Promise<TelegramPrivateVideoFeed>,
  options?: ChannelFeedLoadOptions,
  username?: string,
): Promise<TelegramChannelConfig> {
  let page = 0;
  const fetchPageWithRetry = async (cursor?: string) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await fetchPage(cursor);
      } catch (error) {
        lastError = error;
        if (attempt === 3) break;
        await new Promise((resolve) => window.setTimeout(resolve, 500 * (2 ** attempt)));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  };

  const rejectSensitiveFeed = (nextFeed: TelegramPrivateVideoFeed) => {
    if (!nextFeed.blockedBySensitiveContent) return nextFeed;
    options?.onChannelBlocked?.(`private_${nextFeed.chatId}`);
    throw new Error('Telegram marked this channel as sensitive. AMZY blocked the channel.');
  };

  let feed = rejectSensitiveFeed(await fetchPageWithRetry());
  const firstFeed = feed;
  const videosById = new Map(
    feed.items.filter((video) => isLongVideo(video.duration)).map((video) => [video.id, video]),
  );
  let cursor = feed.nextFromMessageId || undefined;
  const seenCursors = new Set<string>();

  const loadPage = async (nextCursor: string) => {
    if (seenCursors.has(nextCursor)) {
      throw new Error('Telegram stopped paging channel history before all videos could be loaded.');
    }
    seenCursors.add(nextCursor);
    options?.onPageLoaded?.(++page);
    feed = rejectSensitiveFeed(await fetchPageWithRetry(nextCursor));
    feed.items.filter((video) => isLongVideo(video.duration))
      .forEach((video) => videosById.set(video.id, video));
    cursor = feed.nextFromMessageId || undefined;
  };

  while (videosById.size === 0 && cursor) {
    await loadPage(cursor);
  }

  // TDLib returns only cached messages per call, so one page can miss several new posts.
  const knownVideoIds = options?.knownVideoIds;
  if (options?.loadRemainingHistory === false && knownVideoIds && knownVideoIds.size > 0) {
    let extraPages = 0;
    while (cursor && extraPages < 10 && !feed.items.some((video) => knownVideoIds.has(video.id))) {
      extraPages += 1;
      await loadPage(cursor);
    }
  }

  const createChannel = () => createPrivateChannel(firstFeed, [...videosById.values()], username);
  const loadRemainingHistory = async () => {
    let lastUpdate = Date.now();
    try {
      while (cursor) {
        await loadPage(cursor);
        if (options?.onHistoryUpdated && Date.now() - lastUpdate >= 1000) {
          options.onHistoryUpdated(createChannel());
          lastUpdate = Date.now();
        }
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    } catch (error) {
      options?.onHistoryUpdated?.(createChannel());
      throw error;
    }
    const fullChannel = createChannel();
    options?.onHistoryUpdated?.(fullChannel);
    options?.onHistoryComplete?.(fullChannel);
    return fullChannel;
  };

  if (options?.loadRemainingHistory === false) {
    const latestChannel = createChannel();
    return latestChannel;
  }

  if (options?.onHistoryUpdated && !options.waitForHistory) {
    void loadRemainingHistory().catch((error: unknown) => {
      const historyError = error instanceof Error ? error : new Error(String(error));
      if (options.onHistoryError) options.onHistoryError(historyError);
      else console.error('Could not load Telegram channel history:', historyError);
    });
    return createChannel();
  }
  return loadRemainingHistory();
}

export async function downloadPrivateTelegramVideo(
  fileId: number,
  chatId?: string,
  messageId?: string,
): Promise<string> {
  const file = await TelegramNative.downloadChannelVideo({ fileId, chatId, messageId });
  return file.path;
}

export async function openPrivateTelegramVideoStream(
  fileId: number,
  mimeType = 'video/mp4',
): Promise<{ url: string; token: string }> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Is Android WebView me live private-video streaming available nahi hai.');
  }
  if (!privateStreamMessageListenerAdded) {
    navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
      const message = event.data as {
        type?: string;
        token?: string;
        offset?: number;
        length?: number;
      };
      const port = event.ports[0];
      if (message.type !== 'amzy-telegram-stream-read' || !port) return;
      if (
        !message.token
        || typeof message.offset !== 'number'
        || !Number.isSafeInteger(message.offset)
        || typeof message.length !== 'number'
        || !Number.isSafeInteger(message.length)
      ) {
        port.postMessage({ error: 'Telegram video range request is invalid.' });
        port.close();
        return;
      }
      void TelegramNative.readChannelVideoRange({
        token: message.token,
        offset: message.offset,
        length: message.length,
      }).then(
        (result) => port.postMessage({ data: result.data }),
        (error: unknown) => port.postMessage({
          error: error instanceof Error ? error.message : String(error),
        }),
      ).finally(() => port.close());
    });
    privateStreamMessageListenerAdded = true;
  }

  const registration = await navigator.serviceWorker.register('/telegram-stream-worker.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
        reject(new Error('Private video stream could not start. Please close and reopen the app, then try again.'));
      }, 5000);
      const onControllerChange = () => {
        window.clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
        resolve();
      };
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange, { once: true });
      registration.active?.postMessage({ type: 'amzy-telegram-claim-clients' });
      if (navigator.serviceWorker.controller) onControllerChange();
    });
  }
  if (!navigator.serviceWorker.controller) {
    throw new Error('Private video stream worker is not controlling this app.');
  }

  const stream = await TelegramNative.openChannelVideoStream({ fileId });
  navigator.serviceWorker.controller.postMessage({
    type: 'amzy-telegram-register-stream',
    token: stream.token,
  });
  return {
    token: stream.token,
    url: `${window.location.origin}/__amzy_telegram_stream__/${encodeURIComponent(stream.token)}?size=${stream.size}&mime=${encodeURIComponent(mimeType)}`,
  };
}

export async function closePrivateTelegramVideoStream(token: string): Promise<void> {
  navigator.serviceWorker?.controller?.postMessage({
    type: 'amzy-telegram-close-stream',
    token,
  });
  try {
    await TelegramNative.closeChannelVideoStream({ token });
  } catch (error) {
    console.warn('Could not close Telegram video stream:', error);
  }
}

export async function fetchPublicChannelFeed(
  channelUsername: string,
  options?: ChannelFeedLoadOptions,
): Promise<TelegramChannelConfig> {
  const cleanName = normalizeTelegramChannelInput(channelUsername);
  if (Capacitor.isNativePlatform()) {
    const authState = await TelegramNative.getAuthState();
    if (authState.step !== 'ready' || !authState.user) {
      throw new Error('Android par Telegram channel content restrictions check karne ke liye Telegram login zaroori hai.');
    }
    return fetchPublicTelegramClientChannelFeed(cleanName, options);
  }
  const useSupabaseFunction = Boolean(import.meta.env.VITE_SUPABASE_FUNCTION_URL);
  const itemsById = new Map<string, MediaItem>();
  const seenCursors = new Set<string>();
  let channel: Record<string, string> | undefined;
  let before: string | undefined;
  let page = 0;

  const fetchPage = async (cursor?: string) => {
    if (page > 0 && useSupabaseFunction) {
      await new Promise((resolve) => window.setTimeout(resolve, 2200));
    }
    page += 1;
    options?.onPageLoaded?.(page);
    const query = `channel=${encodeURIComponent(cleanName)}${cursor ? `&before=${encodeURIComponent(cursor)}` : ''}`;
    const endpoint = useSupabaseFunction
      ? `${getBackendUrl('/telegram/channel-feed')}?${query}`
      : `/api/telegram/channel-feed?${query}`;
    let res = await fetch(endpoint);
    for (let attempt = 0; res.status === 429 && attempt < 3; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 5000 * (2 ** attempt)));
      res = await fetch(endpoint);
    }
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Failed to fetch Telegram channel @${cleanName}`);
    }

    const data: {
      channel: Record<string, string>;
      items: MediaItem[];
      nextBefore?: string | null;
    } = await res.json();
    channel ??= data.channel;
    for (const item of data.items || []) {
      if (item.type === 'video' && item.videoUrl && isLongVideo(item.duration)) {
        itemsById.set(item.id, item);
      }
    }
    return data.nextBefore || undefined;
  };

  const createChannel = (): TelegramChannelConfig => {
    if (!channel) throw new Error(`Failed to fetch Telegram channel @${cleanName}`);
    const items = Array.from(itemsById.values());
    return {
      id: `public_${channel.username.toLowerCase()}`,
      username: channel.username,
      title: channel.title || `@${channel.username}`,
      description: channel.description || `Public Telegram channel @${channel.username}`,
      avatar: channel.avatar || '',
      subscribers: channel.subscribers || '',
      isCustom: true,
      lastSynced: new Date().toISOString(),
      items,
      bannerBackdrop: items.find((item) => item.poster)?.poster || '',
      featured: items[0],
    };
  };

  before = await fetchPage();
  while (itemsById.size === 0 && before) {
    if (seenCursors.has(before)) {
      throw new Error(`Telegram stopped paging @${cleanName} before a playable video could be found.`);
    }
    seenCursors.add(before);
    before = await fetchPage(before);
  }

  const initialChannel = createChannel();
  if (options?.loadRemainingHistory === false) return initialChannel;

  const loadRemainingHistory = async () => {
    let lastUpdate = Date.now();
    try {
      while (before) {
        if (seenCursors.has(before)) {
          throw new Error(`Telegram stopped paging @${cleanName} before all channel history could be loaded.`);
        }
        seenCursors.add(before);
        before = await fetchPage(before);
        if (options?.onHistoryUpdated && Date.now() - lastUpdate >= 1000) {
          options.onHistoryUpdated(createChannel());
          lastUpdate = Date.now();
        }
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    } catch (error) {
      options?.onHistoryUpdated?.(createChannel());
      throw error;
    }
    const fullChannel = createChannel();
    options?.onHistoryUpdated?.(fullChannel);
    options?.onHistoryComplete?.(fullChannel);
    return fullChannel;
  };

  if (options?.onHistoryUpdated && before && !options.waitForHistory) {
    void loadRemainingHistory()
      .catch((error: unknown) => {
        const historyError = error instanceof Error ? error : new Error(String(error));
        if (options.onHistoryError) options.onHistoryError(historyError);
        else console.error('Could not load Telegram channel history:', historyError);
      });
    return initialChannel;
  }
  return loadRemainingHistory();
}

export async function testMtProtoConnection(data: {
  apiId?: string;
  apiHash?: string;
  botToken?: string;
  channelUsername?: string;
}) {
  const res = await fetch('/api/telegram/mtproto-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return await res.json();
}

export async function connectBotChannel(botToken: string, chatId: string): Promise<TelegramChannelConfig> {
  const res = await fetch('/api/telegram/bot-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ botToken, chatId }),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Failed to authenticate Telegram Bot or access channel');
  }

  const channel = data.channel;
  const items: MediaItem[] = (data.items || []).filter(
    (item: MediaItem) => item.type !== 'video' || isLongVideo(item.duration),
  );

  return {
    id: `bot_${channel.username.toLowerCase()}`,
    username: channel.username,
    title: channel.title,
    description: channel.description,
    avatar: channel.avatar || '',
    botToken,
    chatId,
    isCustom: true,
    isBotConnected: true,
    lastSynced: new Date().toISOString(),
    items,
    bannerBackdrop: items.find(i => i.poster)?.poster || '',
    featured: items.find(i => i.type === 'video') || items[0],
  };
}

export function getSavedChannels(): TelegramChannelConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CHANNELS);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to parse saved channels:', e);
  }
  return [];
}

export function saveChannels(channels: TelegramChannelConfig[]) {
  try {
    localStorage.setItem(STORAGE_KEY_CHANNELS, JSON.stringify(channels, (key, value: unknown) => (
      (key === 'poster' || key === 'backdrop' || key === 'bannerBackdrop')
      && typeof value === 'string' && value.startsWith('data:image/')
        ? undefined
        : value
    )));
  } catch (e) {
    console.error('Failed to save channels:', e);
    window.setTimeout(() => window.dispatchEvent(new Event('amzy-channel-storage-error')), 0);
  }
}

export function getSavedActiveChannelId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_ACTIVE_CHANNEL);
  } catch {
    return null;
  }
}

export function saveActiveChannelId(id: string) {
  try {
    localStorage.setItem(STORAGE_KEY_ACTIVE_CHANNEL, id);
  } catch {}
}

export function getMyList(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MY_LIST);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveMyList(ids: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY_MY_LIST, JSON.stringify(ids));
  } catch {}
}

export function getSavedPlaylists(): MediaPlaylist[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PLAYLISTS);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Saved playlists data is not an array.');
    return parsed.filter((playlist): playlist is MediaPlaylist => (
      typeof playlist === 'object'
      && playlist !== null
      && typeof playlist.id === 'string'
      && typeof playlist.name === 'string'
      && Array.isArray(playlist.itemIds)
      && playlist.itemIds.every((id: unknown) => typeof id === 'string')
      && typeof playlist.createdAt === 'number'
    ));
  } catch (error) {
    console.error('Failed to load playlists:', error);
    return [];
  }
}

export function savePlaylists(playlists: MediaPlaylist[]) {
  localStorage.setItem(STORAGE_KEY_PLAYLISTS, JSON.stringify(playlists));
}

export function getWatchProgressMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_WATCH_PROGRESS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveWatchProgress(id: string, percent: number) {
  try {
    const map = getWatchProgressMap();
    map[id] = Math.min(100, Math.max(0, percent));
    localStorage.setItem(STORAGE_KEY_WATCH_PROGRESS, JSON.stringify(map));
  } catch {}
}

export function getSavedWatchPositions(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_WATCH_POSITIONS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveWatchPosition(id: string, seconds: number) {
  try {
    const positions = getSavedWatchPositions();
    if (!Number.isFinite(seconds) || seconds <= 0) {
      delete positions[id];
    } else {
      positions[id] = Math.floor(seconds);
    }
    localStorage.setItem(STORAGE_KEY_WATCH_POSITIONS, JSON.stringify(positions));
  } catch {}
}

export function getDownloadedVideos(): DownloadedVideo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DOWNLOADED_VIDEOS);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error('Failed to load downloaded videos:', error);
    return [];
  }
}

export function saveDownloadedVideos(videos: DownloadedVideo[]) {
  localStorage.setItem(STORAGE_KEY_DOWNLOADED_VIDEOS, JSON.stringify(videos));
}
