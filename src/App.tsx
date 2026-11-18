/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { useAuth } from './context/AuthContext';
import { backendFetch } from './services/backendApi';
import {
  fetchDemoChannels,
  fetchJoinedPrivateChannelFeed,
  fetchPublicChannelFeed,
  getSavedChannels,
  saveChannels,
  getSavedActiveChannelId,
  saveActiveChannelId,
  getMyList,
  saveMyList,
  getSavedPlaylists,
  savePlaylists,
  getWatchProgressMap,
  saveWatchProgress,
  getSavedWatchPositions,
  saveWatchPosition,
  getDownloadedVideos,
  saveDownloadedVideos,
  isTelegramContentItem,
  loadPrivateThumbnails,
  needsPrivateThumbnail,
} from './services/telegramApi';
import { TelegramNative, type TelegramDownloadProgress } from './services/telegramNative';
import {
  TelegramChannelConfig,
  DownloadedVideo,
  LocalVideoHistoryEntry,
  MediaItem,
  MediaPlaylist,
  ActiveTab,
} from './types';
import { Header } from './components/Header';
import { HeroBanner } from './components/HeroBanner';
import { MediaCard } from './components/MediaCard';
import { MediaRow } from './components/MediaRow';
import { NetflixPlayer } from './components/NetflixPlayer';
import { LocalVideoThumbnail } from './components/LocalVideoThumbnail';
import { MediaDetailModal } from './components/MediaDetailModal';
import { ConnectChannelModal } from './components/ConnectChannelModal';
import { SearchModal } from './components/SearchModal';
import { MobileTabletAppBar } from './components/MobileTabletAppBar';
import { ProfileView } from './components/ProfileView';
import { FirstLaunchLoginModal } from './components/FirstLaunchLoginModal';
import { ChannelFilterBar } from './components/ChannelFilterBar';
import { Send, Bookmark, Sparkles, Film, Heart, Search, Video, Image as ImageIcon, X, Filter, Download, Play, Trash2, Plus, ListVideo, ArrowLeft, Users } from 'lucide-react';
import { playNetflixTaDum } from './utils/sound';
import { isLongVideo } from './utils/duration';
import { WatchRoomPanel } from './components/WatchRoomPanel';
import {
  updateWatchRoomPlayback,
  type WatchRoomSession,
  type WatchRoomSnapshot,
} from './services/watchRoomApi';

const SAVED_WATCH_ROOMS_KEY = 'amzy_saved_watch_rooms';
const LOCAL_VIDEO_HISTORY_KEY = 'amzy_local_video_history';

function uniqueLocalVideoHistory(entries: LocalVideoHistoryEntry[]): LocalVideoHistoryEntry[] {
  const entriesBySource = new Map<string, LocalVideoHistoryEntry>();
  for (const entry of entries) {
    const savedEntry = entriesBySource.get(entry.sourceUri);
    if (!savedEntry || entry.lastPlayedAt > savedEntry.lastPlayedAt) {
      entriesBySource.set(entry.sourceUri, entry);
    }
  }
  return Array.from(entriesBySource.values())
    .sort((first, second) => second.lastPlayedAt - first.lastPlayedAt);
}

function loadLocalVideoHistory(): LocalVideoHistoryEntry[] {
  try {
    const saved = localStorage.getItem(LOCAL_VIDEO_HISTORY_KEY);
    if (!saved) return [];
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    const validEntries = parsed.filter((video): video is LocalVideoHistoryEntry => (
      Boolean(video)
      && typeof video === 'object'
      && typeof video.id === 'string'
      && typeof video.path === 'string'
      && typeof video.title === 'string'
      && typeof video.sourceUri === 'string'
      && typeof video.mimeType === 'string'
      && typeof video.lastPlayedAt === 'number'
      && Number.isFinite(video.lastPlayedAt)
    ));
    return uniqueLocalVideoHistory(validEntries);
  } catch (error) {
    console.error('Could not restore local video history:', error);
    return [];
  }
}

type SavedWatchRoom = Pick<WatchRoomSession, 'code' | 'nickname'>;

function loadSavedWatchRooms(): SavedWatchRoom[] {
  try {
    const saved = localStorage.getItem(SAVED_WATCH_ROOMS_KEY);
    if (!saved) return [];
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((room): room is SavedWatchRoom => (
      Boolean(room)
      && typeof room === 'object'
      && typeof room.code === 'string'
      && typeof room.nickname === 'string'
    ));
  } catch (error) {
    console.error('Could not restore saved watch rooms:', error);
    return [];
  }
}

export default function App() {
  const {
    user,
    loading: isAuthLoading,
    loginCompleted,
    cloudSyncEnabled,
  } = useAuth();
  const [channels, setChannels] = useState<TelegramChannelConfig[]>([]);
  const channelsRef = React.useRef(channels);
  channelsRef.current = channels;
  const [activeChannel, setActiveChannel] = useState<TelegramChannelConfig | null>(null);
  const [isInitialDataLoaded, setIsInitialDataLoaded] = useState(false);
  const [cloudChannelsLoadedForUid, setCloudChannelsLoadedForUid] = useState<string | null>(null);
  const [onboardingStage, setOnboardingStage] = useState<'login' | 'channel' | null>(null);
  const [channelPromptDismissed, setChannelPromptDismissed] = useState(false);
  const [showLaunchSplash, setShowLaunchSplash] = useState(true);
  const [isLaunchSplashExiting, setIsLaunchSplashExiting] = useState(false);
  const [activeTab, setActiveTabState] = useState<ActiveTab>(() =>
    new URLSearchParams(window.location.search).get('tab') === 'profile' ? 'profile' : 'home'
  );
  const activeTabRef = React.useRef(activeTab);
  const tabHistoryRef = React.useRef<ActiveTab[]>([]);
  const onboardingInProgressRef = React.useRef(false);

  useEffect(() => {
    if (!isInitialDataLoaded) return;
    const exitTimer = window.setTimeout(() => setIsLaunchSplashExiting(true), 350);
    const hideTimer = window.setTimeout(() => setShowLaunchSplash(false), 900);
    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(hideTimer);
    };
  }, [isInitialDataLoaded]);

  const setActiveTab = useCallback((tab: ActiveTab) => {
    const currentTab = activeTabRef.current;
    if (currentTab === tab) return;
    tabHistoryRef.current.push(currentTab);
    activeTabRef.current = tab;
    setActiveTabState(tab);
  }, []);

  // Modals & Player state
  const [playingItem, setPlayingItem] = useState<MediaItem | null>(null);
  const localVideoInputRef = React.useRef<HTMLInputElement>(null);
  const localVideoObjectUrlRef = React.useRef<string | null>(null);
  const handledExternalVideoUrisRef = React.useRef(new Set<string>());
  const [roomPlayerStartOptions, setRoomPlayerStartOptions] = useState<{
    itemId: string;
    startPositionSeconds?: number;
    startPaused?: boolean;
  } | null>(null);
  const [detailItem, setDetailItem] = useState<MediaItem | null>(null);
  const [watchRoomSession, setWatchRoomSession] = useState<WatchRoomSession | null>(null);
  const [watchRoomSnapshot, setWatchRoomSnapshot] = useState<WatchRoomSnapshot | null>(null);
  const [roomPlaybackNeedsJoin, setRoomPlaybackNeedsJoin] = useState(false);
  const [savedWatchRooms, setSavedWatchRooms] = useState<SavedWatchRoom[]>(loadSavedWatchRooms);
  const [isWatchRoomOpen, setIsWatchRoomOpen] = useState(false);
  const [roomCodeToRejoin, setRoomCodeToRejoin] = useState<string | null>(null);
  const [roomCodeToDelete, setRoomCodeToDelete] = useState<string | null>(null);
  const [roomCodeToLeave, setRoomCodeToLeave] = useState<string | null>(null);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [notificationChannelLink, setNotificationChannelLink] = useState<string | null>(null);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [homeVisibleCount, setHomeVisibleCount] = useState(50);
  const [searchVisibleCount, setSearchVisibleCount] = useState(120);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const refreshTouchStart = React.useRef<{ x: number; y: number } | null>(null);
  const refreshInFlight = React.useRef(false);
  const watchRoomSessionRef = React.useRef(watchRoomSession);
  const roomSyncPendingRef = React.useRef<{
    item: MediaItem;
    currentTime: number;
    isPlaying: boolean;
  } | null>(null);
  const roomSyncBusyRef = React.useRef(false);
  const lastRoomSyncRef = React.useRef<{
    itemId: string;
    isPlaying: boolean;
    sentAt: number;
  } | null>(null);
  const lastRemoteRoomRevisionRef = React.useRef(-1);
  const roomPlaybackJoinedRef = React.useRef(false);
  const dismissedRoomVideoIdRef = React.useRef<string | null>(null);
  watchRoomSessionRef.current = watchRoomSession;

  useEffect(() => {
    try {
      localStorage.setItem(SAVED_WATCH_ROOMS_KEY, JSON.stringify(savedWatchRooms));
    } catch (error) {
      console.error('Could not save watch rooms on this device:', error);
    }
  }, [savedWatchRooms]);
  const overlaysRef = React.useRef({
    playingItem,
    detailItem,
    isWatchRoomOpen,
    isConnectModalOpen,
    isSearchModalOpen,
  });
  overlaysRef.current = {
    playingItem,
    detailItem,
    isWatchRoomOpen,
    isConnectModalOpen,
    isSearchModalOpen,
  };

  useEffect(() => {
    const isNativePlayback = Boolean(playingItem?.telegramNativePlayback || playingItem?.localNativePlayback);
    document.body.classList.toggle('native-video-transparent', isNativePlayback);
    return () => document.body.classList.remove('native-video-transparent');
  }, [playingItem?.telegramNativePlayback, playingItem?.localNativePlayback]);

  const closeActivePlayer = () => {
    if (
      playingItem
      && watchRoomSessionRef.current?.role === 'guest'
      && watchRoomSnapshot?.video?.id === playingItem.id
    ) {
      dismissedRoomVideoIdRef.current = playingItem.id;
    }
    if (localVideoObjectUrlRef.current) {
      URL.revokeObjectURL(localVideoObjectUrlRef.current);
      localVideoObjectUrlRef.current = null;
    }
    setPlayingItem(null);
  };

  useEffect(() => () => {
    if (localVideoObjectUrlRef.current) {
      URL.revokeObjectURL(localVideoObjectUrlRef.current);
      localVideoObjectUrlRef.current = null;
    }
  }, []);

  const handleLocalVideoSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (file.type && !file.type.startsWith('video/')) {
      showToast('Please select a video file.');
      return;
    }

    try {
      const videoUrl = URL.createObjectURL(file);
      localVideoObjectUrlRef.current = videoUrl;
      void handlePlayItem({
        id: `local-${crypto.randomUUID()}`,
        channel: 'Local device',
        type: 'video',
        title: file.name,
        videoUrl,
        caption: 'Playing from this device',
        localVideo: true,
      });
    } catch (error) {
      console.error('Could not open local video:', error);
      showToast('Could not open this local video.');
    }
  };

  const handleAndroidLocalVideoPicked = async () => {
    try {
      const result = await TelegramNative.pickLocalVideo();
      if (!('path' in result)) return;

      const historyEntry = await recordLocalVideo(result);
      closeActivePlayer();
      await handlePlayItem({
        id: historyEntry.id,
        channel: 'Local device',
        type: 'video',
        title: historyEntry.title,
        videoUrl: Capacitor.convertFileSrc(historyEntry.path),
        caption: 'Playing from this device',
        localVideo: true,
        localVideoPath: historyEntry.path,
      });
    } catch (error) {
      console.error('Could not pick local video:', error);
      showToast(error instanceof Error ? error.message : 'Could not open this local video.');
    }
  };

  const mergeChannelHistory = (existing: TelegramChannelConfig, incoming: TelegramChannelConfig) => {
    const itemsById = new Map(incoming.items.map((item) => [item.id, item]));
    existing.items.forEach((item) => {
      if (!itemsById.has(item.id)) itemsById.set(item.id, item);
    });
    const items = Array.from(itemsById.values());
    return {
      ...existing,
      ...incoming,
      items,
      featured: items.find((item) => item.id === incoming.featured?.id) || items[0],
    };
  };

  useEffect(() => {
    const backButtonListener = CapacitorApp.addListener('backButton', () => {
      if (overlaysRef.current.isWatchRoomOpen) {
        overlaysRef.current.isWatchRoomOpen = false;
        setIsWatchRoomOpen(false);
        return;
      }
      if (overlaysRef.current.playingItem) {
        overlaysRef.current.playingItem = null;
        closeActivePlayer();
        return;
      }
      if (overlaysRef.current.detailItem) {
        overlaysRef.current.detailItem = null;
        setDetailItem(null);
        return;
      }
      if (overlaysRef.current.isSearchModalOpen) {
        overlaysRef.current.isSearchModalOpen = false;
        setIsSearchModalOpen(false);
        return;
      }
      if (overlaysRef.current.isConnectModalOpen) {
        overlaysRef.current.isConnectModalOpen = false;
        setIsConnectModalOpen(false);
        setNotificationChannelLink(null);
        return;
      }

      const previousTab = tabHistoryRef.current.pop();
      if (previousTab) {
        activeTabRef.current = previousTab;
        setActiveTabState(previousTab);
      } else if (activeTabRef.current !== 'home') {
        activeTabRef.current = 'home';
        setActiveTabState('home');
      } else {
        void CapacitorApp.exitApp();
      }
    });

    return () => {
      void backButtonListener.then((listener) => listener.remove());
    };
  }, []);

  // Search tab specific state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFilter, setSearchFilter] = useState<'all' | 'video' | 'photo' | '4k'>('all');

  // Telegram Category & Hashtag Filter State
  const [homeChannelFilter, setHomeChannelFilter] = useState('all');

  // Watchlist & Progress
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [playlists, setPlaylists] = useState<MediaPlaylist[]>(() => getSavedPlaylists());
  const [localVideoHistory, setLocalVideoHistory] = useState<LocalVideoHistoryEntry[]>(loadLocalVideoHistory);
  const [showAllLocalVideos, setShowAllLocalVideos] = useState(false);
  const localVideoHistoryRef = React.useRef(localVideoHistory);
  localVideoHistoryRef.current = localVideoHistory;
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [isCreatingPlaylist, setIsCreatingPlaylist] = useState(false);
  const [playlistName, setPlaylistName] = useState('');
  const [playlistPickerItem, setPlaylistPickerItem] = useState<MediaItem | null>(null);
  const [pendingPlaylistItem, setPendingPlaylistItem] = useState<MediaItem | null>(null);
  const [downloadedVideos, setDownloadedVideos] = useState<DownloadedVideo[]>(() => {
    const saved = getDownloadedVideos();
    if (!Capacitor.isNativePlatform()) return saved;
    const safeDownloads = saved.filter((download) => (
      !isTelegramContentItem(download.item) || download.item.telegramContentRestrictionChecked
    ));
    if (safeDownloads.length !== saved.length) saveDownloadedVideos(safeDownloads);
    return safeDownloads;
  });
  const downloadedVideosRef = React.useRef(downloadedVideos);
  const persistDownloadedVideos = (videos: DownloadedVideo[]) => {
    saveDownloadedVideos(videos);
    downloadedVideosRef.current = videos;
    setDownloadedVideos(videos);
  };

  useEffect(() => {
    const recovered = downloadedVideosRef.current.map((download) =>
      download.status === 'downloading'
        ? {
            ...download,
            status: 'failed' as const,
            error: 'Download was interrupted. Retry to start it again.',
          }
        : download,
    );
    if (recovered.some((download, index) => download !== downloadedVideosRef.current[index])) {
      try {
        persistDownloadedVideos(recovered);
      } catch (error) {
        console.error('Could not mark interrupted downloads:', error);
        showToast('Could not recover the previous download state.');
      }
    }
  }, []);
  const [cloudFavoriteItems, setCloudFavoriteItems] = useState<MediaItem[]>([]);
  const [watchProgressMap, setWatchProgressMap] = useState<Record<string, number>>({});
  const watchProgressRef = React.useRef<Record<string, number>>({});
  const watchPositionsRef = React.useRef<Record<string, number>>({});

  // Show toast notification
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const persistLocalVideoHistory = (history: LocalVideoHistoryEntry[]) => {
    const uniqueHistory = uniqueLocalVideoHistory(history);
    localVideoHistoryRef.current = uniqueHistory;
    setLocalVideoHistory(uniqueHistory);
    try {
      localStorage.setItem(LOCAL_VIDEO_HISTORY_KEY, JSON.stringify(uniqueHistory));
    } catch (error) {
      console.error('Could not save local video history:', error);
      showToast('Local video history could not be saved.');
    }
  };

  const recordLocalVideo = async (
    video: { path: string; title: string; mimeType: string; sourceUri: string },
  ) => {
    const existing = localVideoHistoryRef.current.find((entry) => entry.sourceUri === video.sourceUri);
    const entry: LocalVideoHistoryEntry = existing
      ? { ...existing, lastPlayedAt: Date.now() }
      : {
          ...video,
          id: `local-${crypto.randomUUID()}`,
          lastPlayedAt: Date.now(),
        };
    if (existing && existing.path !== video.path) {
      try {
        await TelegramNative.deleteLocalVideo({ path: video.path });
      } catch (error) {
        console.error('Could not remove duplicate local video copy:', error);
        showToast('A duplicate local video copy could not be removed.');
      }
    }
    persistLocalVideoHistory([
      entry,
      ...localVideoHistoryRef.current.filter((item) => item.sourceUri !== entry.sourceUri),
    ]);
    return entry;
  };

  const playLocalVideoHistoryEntry = (entry: LocalVideoHistoryEntry) => {
    persistLocalVideoHistory([
      { ...entry, lastPlayedAt: Date.now() },
      ...localVideoHistoryRef.current.filter((item) => item.sourceUri !== entry.sourceUri),
    ]);
    void handlePlayItem({
      id: entry.id,
      channel: 'Local device',
      type: 'video',
      title: entry.title,
      videoUrl: Capacitor.convertFileSrc(entry.path),
      caption: 'Playing from this device',
      localVideo: true,
      localVideoPath: entry.path,
    });
  };

  const removeLocalVideoHistoryEntry = async (entry: LocalVideoHistoryEntry) => {
    try {
      await TelegramNative.deleteLocalVideo({ path: entry.path });
      persistLocalVideoHistory(
        localVideoHistoryRef.current.filter((item) => item.sourceUri !== entry.sourceUri),
      );
      showToast('Local video removed from history.');
    } catch (error) {
      console.error('Could not remove local video from history:', error);
      showToast(error instanceof Error ? error.message : 'Could not remove local video.');
    }
  };

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let isMounted = true;
    let appUrlListener: { remove: () => Promise<void> } | undefined;

    const openExternalVideo = async (uri: string) => {
      if (!uri.startsWith('content://') && !uri.startsWith('file://')) return;
      if (handledExternalVideoUrisRef.current.has(uri)) return;
      handledExternalVideoUrisRef.current.add(uri);

      try {
        const importedVideo = await TelegramNative.importLocalVideo({ uri });
        if (!isMounted) {
          await TelegramNative.deleteLocalVideo({ path: importedVideo.path });
          return;
        }
        const historyEntry = await recordLocalVideo(importedVideo);
        closeActivePlayer();
        void handlePlayItem({
          id: historyEntry.id,
          channel: 'Local device',
          type: 'video',
          title: historyEntry.title,
          videoUrl: Capacitor.convertFileSrc(historyEntry.path),
          caption: 'Playing from this device',
          localVideo: true,
          localVideoPath: historyEntry.path,
        });
      } catch (error) {
        console.error('Could not open video shared from another app:', error);
        showToast(error instanceof Error ? error.message : 'Could not open this local video.');
      } finally {
        handledExternalVideoUrisRef.current.delete(uri);
      }
    };

    void CapacitorApp.addListener('appUrlOpen', ({ url }) => {
      void openExternalVideo(url);
    }).then((listener) => {
      appUrlListener = listener;
      if (!isMounted) void listener.remove();
    }).catch((error: unknown) => {
      console.error('Could not listen for videos opened from another app:', error);
    });

    void CapacitorApp.getLaunchUrl().then((launch) => {
      if (launch?.url) void openExternalVideo(launch.url);
    }).catch((error: unknown) => {
      console.error('Could not restore a video opened from another app:', error);
    });

    return () => {
      isMounted = false;
      void appUrlListener?.remove();
    };
  }, []);

  useEffect(() => {
    const reportStorageError = () => showToast('Channel history device par save nahi ho saki. Storage check karein.');
    window.addEventListener('amzy-channel-storage-error', reportStorageError);
    return () => window.removeEventListener('amzy-channel-storage-error', reportStorageError);
  }, []);

  // Load Initial Data
  useEffect(() => {
    const initApp = async () => {
      // 1. Load saved watchlist and watch progress
      setSavedIds(getMyList());
      const savedWatchProgress = getWatchProgressMap();
      watchProgressRef.current = savedWatchProgress;
      setWatchProgressMap(savedWatchProgress);
      watchPositionsRef.current = getSavedWatchPositions();

      // 2. Load demo channels
      const demoChannels = await fetchDemoChannels();
      const savedCustomChannels = getSavedChannels();
      const allowedCustomChannels = Capacitor.isNativePlatform()
        ? savedCustomChannels.flatMap((channel) => {
            const items = channel.items.filter((item) => (
              !isTelegramContentItem(item) || item.telegramContentRestrictionChecked
            ));
            return items.length > 0
              ? [{
                  ...channel,
                  items,
                  featured: items.find((item) => item.id === channel.featured?.id) || items[0],
                }]
              : [];
          })
        : savedCustomChannels;
      const filterChannelVideos = (channel: TelegramChannelConfig): TelegramChannelConfig => {
        const items = channel.items.filter((item) => item.type !== 'video' || isLongVideo(item.duration));
        return {
          ...channel,
          items,
          featured: items.find((item) => item.id === channel.featured?.id) || items[0],
        };
      };
      const visibleCustomChannels = allowedCustomChannels.map(filterChannelVideos);
      if (visibleCustomChannels.length !== savedCustomChannels.length
        || visibleCustomChannels.some((channel, index) => channel.items.length !== savedCustomChannels[index]?.items.length)) {
        saveChannels(visibleCustomChannels);
      }

      // Merge unique channels
      const channelMap = new Map<string, TelegramChannelConfig>();
      demoChannels.map(filterChannelVideos).forEach((c) => channelMap.set(c.id, c));
      visibleCustomChannels.forEach((c) => channelMap.set(c.id, c));

      let allChannels = Array.from(channelMap.values());

      // 3. Check URL parameter ?channel=<channel_username>
      const urlParams = new URLSearchParams(window.location.search);
      const urlChannel = urlParams.get('channel');

      if (urlChannel) {
        try {
          const directChannel = await fetchPublicChannelFeed(urlChannel);
          channelMap.set(directChannel.id, directChannel);
          allChannels = Array.from(channelMap.values());
          setChannels(allChannels);
          setActiveChannel(directChannel);
          saveActiveChannelId(directChannel.id);
          showToast(`Stream loaded for @${directChannel.username}!`);
          setIsInitialDataLoaded(true);
          return;
        } catch (e) {
          console.warn('Could not load channel from URL param:', e);
        }
      }

      setChannels(allChannels);

      // Determine active channel
      const savedActiveId = getSavedActiveChannelId();
      const initialActive = allChannels.find((c) => c.id === savedActiveId) || allChannels[0] || null;
      setActiveChannel(initialActive);
      setIsInitialDataLoaded(true);
    };

    initApp();
  }, []);

  useEffect(() => {
    if (!cloudSyncEnabled || !user || !isInitialDataLoaded) {
      return;
    }

    let cancelled = false;
    const restoreSavedChannels = async () => {
      try {
        const localChannels = channels.filter((channel) => channel.isCustom);
        const saveResults = await Promise.allSettled(localChannels.map(async (channel) => {
          const saveResponse = await backendFetch('/user/channels', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              channelUsername: channel.username,
              channelLink: channel.sourceLink,
              title: channel.title,
              category: channel.category,
              description: channel.description,
              avatarUrl: channel.avatar,
              subscriberCount: channel.subscribers,
              telegramChatId: channel.telegramChatId,
              telegramChatKind: channel.telegramChatKind,
              isPublicTelegramChat: channel.isPublicTelegramChat,
              isMonetized: channel.isMonetized,
            }),
          });
          if (!saveResponse.ok) {
            const data = await saveResponse.json().catch(() => ({}));
            throw new Error(data.error || `Channel save failed (${saveResponse.status})`);
          }
        }));
        saveResults.forEach((result, index) => {
          if (result.status === 'rejected') {
            console.error(`Could not sync saved channel ${localChannels[index].title}:`, result.reason);
          }
        });
        if (saveResults.some((result) => result.status === 'rejected')) {
          showToast('Some saved channels could not be uploaded to Supabase');
        }

        const response = await backendFetch('/user/channels');
        if (!response.ok) throw new Error(`Channel restore failed (${response.status})`);
        const data: {
          channels: {
            channelUsername: string;
            channelLink?: string | null;
            title: string;
            telegramChatId?: string | null;
            telegramChatKind?: 'channel' | 'group' | null;
            isPublicTelegramChat?: boolean | null;
          }[];
        } = await response.json();
        const existingChannels = new Set(channels.map((channel) => (
          channel.telegramChatId
            ? `chat:${channel.telegramChatId}`
            : `username:${channel.username.toLowerCase()}`
        )));
        const missingChannels = (data.channels || []).filter(
          (channel) => !existingChannels.has(
            channel.telegramChatId
              ? `chat:${channel.telegramChatId}`
              : `username:${channel.channelUsername.toLowerCase()}`
          )
        );
        const results = await Promise.allSettled(
          missingChannels.map((channel) => {
            if (channel.telegramChatId && channel.isPublicTelegramChat === false) {
              if (Capacitor.isNativePlatform()) {
                return fetchJoinedPrivateChannelFeed(channel.telegramChatId).then((restoredChannel) => ({
                  ...restoredChannel,
                  sourceLink: channel.channelLink || undefined,
                }));
              }
              return Promise.resolve({
                id: `private_${channel.telegramChatId}`,
                username: channel.channelUsername,
                title: channel.title,
                sourceLink: channel.channelLink || undefined,
                telegramChatId: channel.telegramChatId,
                telegramChatKind: channel.telegramChatKind || 'channel',
                isPublicTelegramChat: false,
                isCustom: true,
                items: [],
              });
            }
            return fetchPublicChannelFeed(channel.channelUsername).then((restoredChannel) => ({
              ...restoredChannel,
              sourceLink: channel.channelLink || `https://t.me/${channel.channelUsername.replace(/^@/, '')}`,
            }));
          })
        );
        const restored = results.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : []
        );
        if (cancelled) return;

        results.forEach((result) => {
          if (result.status === 'rejected') {
            console.warn('Could not restore a saved Telegram channel:', result.reason);
          }
        });
        if (results.some((result) => result.status === 'rejected')) {
          showToast('Some saved Telegram channels could not be restored');
        }
        if (restored.length === 0) return;

        setChannels((previous) => {
          const merged = new Map(previous.map((channel) => [channel.id, channel]));
          restored.forEach((channel) => merged.set(channel.id, channel));
          const updated = Array.from(merged.values());
          saveChannels(updated.filter((channel) => channel.isCustom));
          const savedActiveId = getSavedActiveChannelId();
          const savedActiveChannel = updated.find((channel) => channel.id === savedActiveId);
          if (savedActiveChannel) setActiveChannel(savedActiveChannel);
          return updated;
        });
      } catch (error) {
        console.error('Failed to restore channels from Supabase:', error);
        showToast('Could not sync saved channels from Supabase');
      } finally {
        if (!cancelled) setCloudChannelsLoadedForUid(user.uid);
      }
    };

    restoreSavedChannels();
    return () => {
      cancelled = true;
    };
  }, [user, isInitialDataLoaded, cloudSyncEnabled]);

  useEffect(() => {
    if (!isInitialDataLoaded || isAuthLoading || showLaunchSplash || playingItem) return;
    if (cloudSyncEnabled && user && cloudChannelsLoadedForUid !== user.uid) return;

    const loginPromptSeen = localStorage.getItem('amzy_first_launch_login_seen') === 'true';
    if (user && !loginPromptSeen) {
      localStorage.setItem('amzy_first_launch_login_seen', 'true');
    }

    if (!user && !loginPromptSeen) {
      onboardingInProgressRef.current = true;
      setOnboardingStage('login');
      return;
    }

    if (channels.some((channel) => channel.isCustom)) {
      onboardingInProgressRef.current = false;
      setOnboardingStage(null);
      return;
    }

    if (!channelPromptDismissed) {
      onboardingInProgressRef.current = true;
      setOnboardingStage('channel');
    }
  }, [
    channels,
    channelPromptDismissed,
    cloudChannelsLoadedForUid,
    cloudSyncEnabled,
    isAuthLoading,
    isInitialDataLoaded,
    playingItem,
    showLaunchSplash,
    user,
  ]);

  const finishLoginOnboarding = () => {
    localStorage.setItem('amzy_first_launch_login_seen', 'true');
    if (channels.some((channel) => channel.isCustom)) {
      onboardingInProgressRef.current = false;
      setOnboardingStage(null);
      return;
    }
    setOnboardingStage('channel');
  };

  const finishChannelOnboarding = () => {
    setChannelPromptDismissed(true);
    onboardingInProgressRef.current = false;
    setOnboardingStage(null);
    setIsConnectModalOpen(false);
  };

  useEffect(() => {
    if (!isInitialDataLoaded || !Capacitor.isNativePlatform()) return;
    const channelsNeedingThumbnails = channels.map((channel) => ({
      ...channel,
      items: channel.items.slice(0, channel.id === homeChannelFilter ? homeVisibleCount : 50),
    })).filter((channel) => channel.items.some(needsPrivateThumbnail));
    if (channelsNeedingThumbnails.length === 0) return;

    let cancelled = false;
    void Promise.all(channelsNeedingThumbnails.map(loadPrivateThumbnails))
      .then(() => {
        if (cancelled) return;
        setChannels((previous) => {
          const updated = previous.map((channel) => ({
            ...channel,
            items: channel.items.map((item) => ({ ...item })),
          }));
          saveChannels(updated.filter((channel) => channel.isCustom));
          const loadedActiveChannel = updated.find((channel) => channel.id === activeChannel?.id);
          if (loadedActiveChannel) setActiveChannel(loadedActiveChannel);
          return updated;
        });
      })
      .catch((error: unknown) => {
        console.error('Could not load saved Telegram video thumbnails:', error);
        showToast('Kuch Telegram thumbnails load nahi ho sake.');
      });
    return () => {
      cancelled = true;
    };
  }, [isInitialDataLoaded, channels, activeChannel?.id, homeChannelFilter, homeVisibleCount]);

  // Handle Channel Selection
  const handleSelectChannel = (channel: TelegramChannelConfig) => {
    setActiveChannel(channel);
    setHomeChannelFilter(channel.telegramChatId ? channel.id : 'all');
    saveActiveChannelId(channel.id);
    setActiveTab('home');
    showToast(`Switched to @${channel.username}`);
  };

  // Handle Adding Channel
  const handleAddChannel = (newChannel: TelegramChannelConfig) => {
    setChannels((prev) => {
      const existing = prev.find((channel) => channel.id === newChannel.id);
      const channelToSave = existing ? mergeChannelHistory(existing, newChannel) : newChannel;
      const filtered = prev.filter((channel) => channel.id !== newChannel.id);
      const updated = [channelToSave, ...filtered];
      // Save only custom/modified channels to localStorage
      saveChannels(updated.filter((c) => c.isCustom));
      return updated;
    });

    if (cloudSyncEnabled && newChannel.isCustom) {
      backendFetch('/user/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelUsername: newChannel.username,
          channelLink: newChannel.sourceLink,
          title: newChannel.title,
          category: newChannel.category,
          description: newChannel.description,
          avatarUrl: newChannel.avatar,
          subscriberCount: newChannel.subscribers,
          telegramChatId: newChannel.telegramChatId,
          telegramChatKind: newChannel.telegramChatKind,
          isPublicTelegramChat: newChannel.isPublicTelegramChat,
          isMonetized: newChannel.isMonetized,
        }),
      }).then(async (response) => {
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `Channel save failed (${response.status})`);
        }
      }).catch((error) => {
        console.error('Failed to save channel to Supabase:', error);
        showToast('Channel is local only; Supabase sync failed');
      });
    }
  };

  const handleChannelsConnected = (connectedChannels: TelegramChannelConfig[], failedCount: number) => {
    connectedChannels.forEach(handleAddChannel);
    finishChannelOnboarding();
    const selectedChannel = connectedChannels[connectedChannels.length - 1];
    setActiveChannel((current) => current?.id === selectedChannel.id
      ? mergeChannelHistory(current, selectedChannel)
      : selectedChannel);
    setHomeChannelFilter(selectedChannel.id);
    saveActiveChannelId(selectedChannel.id);
    setActiveTab('home');
    setIsConnectModalOpen(false);
    setNotificationChannelLink(null);
    const totalVideos = connectedChannels.reduce((total, channel) => total + channel.items.length, 0);
    const result = `${connectedChannels.length} channel(s), ${totalVideos} videos added; older videos loading`;
    showToast(failedCount > 0 ? `${result}; ${failedCount} link(s) could not connect` : result);
  };

  const handleNotificationTelegramLink = (link: string) => {
    setNotificationChannelLink(link);
    setIsConnectModalOpen(true);
  };

  const historyUpdateRef = React.useRef<{ pending: Map<string, TelegramChannelConfig>; timer?: number }>({
    pending: new Map(),
  });

  // Batches history updates so thousands of videos do not re-render the app on every page.
  const handleChannelHistoryUpdated = (fullChannel: TelegramChannelConfig) => {
    const state = historyUpdateRef.current;
    state.pending.set(fullChannel.id, fullChannel);
    if (state.timer !== undefined) return;
    state.timer = window.setTimeout(() => {
      state.timer = undefined;
      const batch = Array.from(state.pending.values());
      state.pending.clear();
      setChannels((prev) => {
        let updated = prev;
        batch.forEach((incoming) => {
          updated = updated.map((channel) => channel.id === incoming.id ? mergeChannelHistory(channel, incoming) : channel);
        });
        saveChannels(updated.filter((c) => c.isCustom));
        return updated;
      });
      setActiveChannel((current) => {
        const incoming = batch.find((channel) => channel.id === current?.id);
        return current && incoming ? mergeChannelHistory(current, incoming) : current;
      });
    }, 3000);
  };

  const handlePlayItem = async (
    item: MediaItem,
    options: { startPositionSeconds?: number; startPaused?: boolean } = {},
  ) => {
    if (item.localVideo && item.localVideoPath && Capacitor.getPlatform() === 'android') {
      try {
        await TelegramNative.prepareLocalVideo({
          path: item.localVideoPath,
          title: item.title,
          startPositionSeconds: options.startPositionSeconds
            ?? watchPositionsRef.current[item.id]
            ?? 0,
          autoPlay: options.startPaused !== true,
        });
        setPlayingItem({ ...item, localNativePlayback: true });
        setRoomPlayerStartOptions({
          itemId: item.id,
          startPositionSeconds: options.startPositionSeconds,
          startPaused: options.startPaused,
        });
      } catch (error) {
        console.error('Could not start native local video playback:', error);
        showToast(error instanceof Error ? error.message : 'Could not play this local video.');
      }
      return;
    }

    if (Capacitor.isNativePlatform()
      && isTelegramContentItem(item)
      && !item.telegramContentRestrictionChecked) {
      showToast('This Telegram video has not passed the sensitive-content check and is blocked.');
      return;
    }
    const hasTelegramMessageReference = Boolean(item.telegramChatId && item.telegramId);
    if (item.videoUrl || (!item.telegramFileId && !hasTelegramMessageReference)) {
      setRoomPlayerStartOptions({
        itemId: item.id,
        startPositionSeconds: options.startPositionSeconds,
        startPaused: options.startPaused,
      });
      setPlayingItem(item);
      return;
    }
    if (!Capacitor.isNativePlatform()) {
      showToast('Private Telegram videos can only play in the Android app.');
      return;
    }

    try {
      showToast('Private live stream connect ho raha hai...');
      const playback = await TelegramNative.prepareTelegramVideo({
        fileId: item.telegramFileId,
        chatId: item.telegramChatId,
        messageId: item.telegramId,
        mimeType: item.telegramMimeType,
        title: item.title,
        supportsStreaming: item.telegramSupportsStreaming,
        startPositionSeconds: options.startPositionSeconds
          ?? watchPositionsRef.current[item.id]
          ?? 0,
        autoPlay: options.startPaused !== true
          && (watchRoomSessionRef.current?.role !== 'guest' || roomPlaybackJoinedRef.current),
      });
      setPlayingItem({
        ...item,
        telegramFileId: playback.fileId,
        telegramNativePlayback: true,
      });
      setRoomPlayerStartOptions({
        itemId: item.id,
        startPositionSeconds: options.startPositionSeconds,
        startPaused: options.startPaused,
      });
    } catch (error) {
      console.error('Could not start native Telegram live playback:', error);
      showToast(error instanceof Error
        ? `Live stream start nahi hui: ${error.message}`
        : 'Private Telegram video ki live stream start nahi hui.');
    }
  };

  const handleWatchRoomSessionChange = (session: WatchRoomSession | null) => {
    const previousCode = watchRoomSessionRef.current?.code;
    watchRoomSessionRef.current = session;
    setWatchRoomSession(session);
    if (!session || session.code !== previousCode) {
      setWatchRoomSnapshot(null);
      setRoomPlaybackNeedsJoin(false);
      roomPlaybackJoinedRef.current = session?.role === 'admin';
      dismissedRoomVideoIdRef.current = null;
      lastRemoteRoomRevisionRef.current = -1;
      lastRoomSyncRef.current = null;
      roomSyncPendingRef.current = null;
    }
  };

  const rememberWatchRoom = (room: SavedWatchRoom) => {
    setSavedWatchRooms((savedRooms) => [
      room,
      ...savedRooms.filter((savedRoom) => savedRoom.code !== room.code),
    ]);
  };

  const forgetWatchRoom = (code: string) => {
    setSavedWatchRooms((savedRooms) => savedRooms.filter((room) => room.code !== code));
  };

  const openSavedWatchRoom = (room: SavedWatchRoom) => {
    if (watchRoomSession && watchRoomSession.code !== room.code) {
      showToast('Pehle current room se Leave karein, phir doosre room mein join karein.');
      return;
    }
    setRoomCodeToRejoin(watchRoomSession?.code === room.code ? null : room.code);
    setIsWatchRoomOpen(true);
  };

  const deleteSavedWatchRoom = (room: SavedWatchRoom) => {
    const isCurrentRoom = watchRoomSession?.code === room.code;
    const isCurrentAdmin = isCurrentRoom
      && watchRoomSession.role === 'admin';

    if (isCurrentAdmin) {
      setRoomCodeToDelete(room.code);
      return;
    }

    if (watchRoomSession && !isCurrentRoom) {
      showToast('Pehle current room se Leave karein, phir is room ko open karke delete karein.');
      return;
    }

    if (isCurrentRoom) {
      showToast('Sirf active room admin hi room delete kar sakta hai.');
      setIsWatchRoomOpen(true);
      return;
    }

    showToast('Room delete karne ke liye pehle us room mein Rejoin karein as admin.');
    openSavedWatchRoom(room);
  };

  const handleWatchRoomSnapshot = (snapshot: WatchRoomSnapshot, session: WatchRoomSession) => {
    setWatchRoomSnapshot(snapshot);
    if (snapshot.status === 'closed') {
      setPlayingItem(null);
      return;
    }
    const sharedVideo = snapshot.video;
    if (!sharedVideo) {
      dismissedRoomVideoIdRef.current = null;
      return;
    }
    if (session.role === 'guest' && sharedVideo) {
      if (dismissedRoomVideoIdRef.current === sharedVideo.id) {
        lastRemoteRoomRevisionRef.current = snapshot.revision;
        return;
      }
      if (dismissedRoomVideoIdRef.current) dismissedRoomVideoIdRef.current = null;
      const playbackChanged = snapshot.revision !== lastRemoteRoomRevisionRef.current;
      lastRemoteRoomRevisionRef.current = snapshot.revision;
      if (!roomPlaybackJoinedRef.current) {
        setRoomPlaybackNeedsJoin(true);
        if (playingItem?.id !== sharedVideo.id) {
          setIsWatchRoomOpen(false);
          void handlePlayItem(sharedVideo, {
            startPositionSeconds: snapshot.currentTime,
            startPaused: true,
          });
        }
      } else if (playbackChanged && playingItem?.id !== sharedVideo.id) {
        setRoomPlaybackNeedsJoin(false);
        setIsWatchRoomOpen(false);
        void handlePlayItem(sharedVideo, {
          startPositionSeconds: snapshot.currentTime,
        });
      }
    }
  };

  const joinRoomPlayback = () => {
    roomPlaybackJoinedRef.current = true;
    setRoomPlaybackNeedsJoin(false);
  };

  const requestLeaveRoomFromPlayer = () => {
    const session = watchRoomSessionRef.current;
    if (!session || session.role !== 'guest') return;
    if (!window.confirm('Room se leave karna hai? Video is device par chalta rahega.')) return;
    setRoomCodeToLeave(session.code);
  };

  const flushRoomPlaybackUpdates = async () => {
    if (roomSyncBusyRef.current) return;
    roomSyncBusyRef.current = true;
    try {
      while (roomSyncPendingRef.current) {
        const update = roomSyncPendingRef.current;
        roomSyncPendingRef.current = null;
        const session = watchRoomSessionRef.current;
        if (!session || session.role !== 'admin') continue;
        lastRoomSyncRef.current = {
          itemId: update.item.id,
          isPlaying: update.isPlaying,
          sentAt: Date.now(),
        };
        try {
          await updateWatchRoomPlayback(session, update.item, update.currentTime, update.isPlaying);
        } catch (error) {
          console.error('Could not sync watch room playback:', error);
          showToast(error instanceof Error ? error.message : 'Could not sync room playback.');
        }
      }
    } finally {
      roomSyncBusyRef.current = false;
    }
  };

  const handleRoomPlayerState = (item: MediaItem, currentTime: number, isPlaying: boolean) => {
    const session = watchRoomSessionRef.current;
    if (!session || session.role !== 'admin' || !Number.isFinite(currentTime) || currentTime < 0) return;
    const last = lastRoomSyncRef.current;
    if (last && last.itemId === item.id && last.isPlaying === isPlaying && Date.now() - last.sentAt < 1800) return;
    roomSyncPendingRef.current = { item, currentTime, isPlaying };
    void flushRoomPlaybackUpdates();
  };

  // Handle Removing Channel
  const handleRemoveChannel = (channelId: string) => {
    const removedChannel = channels.find((channel) => channel.id === channelId);
    const updated = channels.filter((channel) => channel.id !== channelId);
    setChannels(updated);
    saveChannels(updated.filter((channel) => channel.isCustom));
    if (removedChannel) {
      const username = removedChannel.username.toLowerCase();
      const remainingDownloads = downloadedVideosRef.current.filter((download) => (
        download.item.telegramChatId !== removedChannel.telegramChatId
        && download.item.channel.toLowerCase() !== username
      ));
      if (remainingDownloads.length !== downloadedVideosRef.current.length) {
        persistDownloadedVideos(remainingDownloads);
      }
    }
    if (activeChannel?.id === channelId) {
      const next = updated[0] || null;
      setActiveChannel(next);
      if (next) {
        saveActiveChannelId(next.id);
      } else {
        localStorage.removeItem('teleflix_active_channel_id');
      }
    }
    if (cloudSyncEnabled && removedChannel?.isCustom) {
      backendFetch(`/user/channels/${encodeURIComponent(removedChannel.username)}`, { method: 'DELETE' })
        .then((response) => {
          if (!response.ok) throw new Error(`Channel delete failed (${response.status})`);
        })
        .catch((error) => {
          console.error('Failed to remove channel from Supabase:', error);
          showToast('Channel removed locally, but Supabase sync failed');
        });
    }
    showToast('Channel removed');
  };

  // Refresh every connected channel, regardless of the selected channel filter.
  const handleRefreshFeed = async (options: { showIndicator?: boolean; showToast?: boolean } = {}) => {
    const channelsToRefresh = channelsRef.current;
    if (channelsToRefresh.length === 0 || refreshInFlight.current) return;
    const showIndicator = options.showIndicator ?? true;
    const shouldShowToast = options.showToast ?? true;
    refreshInFlight.current = true;
    if (showIndicator) setIsRefreshing(true);
    const refreshStartedAt = Date.now();

    try {
      const refreshedChannels: TelegramChannelConfig[] = [];
      let failedCount = 0;

      for (let index = 0; index < channelsToRefresh.length; index += 3) {
        const batch = channelsToRefresh.slice(index, index + 3);
        const results = await Promise.allSettled(batch.map((channel) => {
          const withTimeout = <T,>(promise: Promise<T>) => Promise.race([
            promise,
            new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error('Refresh timed out')), 30000)),
          ]);
          if (channel.telegramChatId) {
            return withTimeout(fetchJoinedPrivateChannelFeed(channel.telegramChatId, {
              loadRemainingHistory: false,
              knownVideoIds: new Set(channel.items.flatMap((item) => (item.telegramId ? [item.telegramId] : []))),
              onChannelBlocked: handleRemoveChannel,
            }));
          }
          if (channel.username) {
            return withTimeout(fetchPublicChannelFeed(channel.username, {
              loadRemainingHistory: false,
              onChannelBlocked: handleRemoveChannel,
            }));
          }
          return Promise.reject(new Error(`Channel ${channel.title} has no Telegram identifier`));
        }));

        results.forEach((result, batchIndex) => {
          if (result.status === 'fulfilled') {
            refreshedChannels.push(result.value);
          } else {
            failedCount += 1;
            console.warn(`Could not refresh Telegram channel ${batch[batchIndex].title}:`, result.reason);
          }
        });
      }

      if (refreshedChannels.length > 0) {
        const refreshedById = new Map(refreshedChannels.map((channel) => [channel.id, channel]));
        setChannels((previous) => {
          const updated = previous.map((channel) => {
            const refreshed = refreshedById.get(channel.id);
            return refreshed ? mergeChannelHistory(channel, refreshed) : channel;
          });
          saveChannels(updated.filter((channel) => channel.isCustom));
          return updated;
        });
        setActiveChannel((current) => {
          if (!current) return current;
          const refreshed = refreshedById.get(current.id);
          return refreshed ? mergeChannelHistory(current, refreshed) : current;
        });
      }

      if (!shouldShowToast) {
        return;
      }
      if (failedCount === 0) {
        showToast(`Feed updated for all ${refreshedChannels.length} channel(s)`);
      } else if (refreshedChannels.length === 0) {
        showToast(`Could not refresh any channels (${failedCount} failed)`);
      } else {
        showToast(`Updated ${refreshedChannels.length}/${channelsToRefresh.length} channels; ${failedCount} failed`);
      }
    } finally {
      if (showIndicator) {
        const remainingIndicatorTime = 650 - (Date.now() - refreshStartedAt);
        if (remainingIndicatorTime > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, remainingIndicatorTime));
        }
        setIsRefreshing(false);
      }
      refreshInFlight.current = false;
    }
  };

  useEffect(() => {
    if (!isInitialDataLoaded) return;
    void handleRefreshFeed({ showIndicator: false, showToast: false });
  }, [isInitialDataLoaded]);

  // Background pass that rebuilds each channel's full history, so search covers every video.
  useEffect(() => {
    if (!isInitialDataLoaded) return;
    let cancelled = false;
    const applyFullHistory = (full: TelegramChannelConfig) => {
      if (cancelled) return;
      handleChannelHistoryUpdated(full);
    };
    const loadFullHistory = async () => {
      for (const channel of channelsRef.current) {
        if (cancelled) return;
        const options = {
          onHistoryUpdated: applyFullHistory,
          onChannelBlocked: handleRemoveChannel,
          waitForHistory: true,
        };
        try {
          const first = channel.telegramChatId
            ? await fetchJoinedPrivateChannelFeed(channel.telegramChatId, options)
            : channel.username
              ? await fetchPublicChannelFeed(channel.username, options)
              : null;
          if (first) applyFullHistory(first);
        } catch (error) {
          console.warn(`Could not load full history for ${channel.title}:`, error);
          if (!cancelled) showToast(`${channel.title}: poori history load nahi ho saki. App dobara kholkar retry karein.`);
        }
      }
    };
    void loadFullHistory();
    return () => {
      cancelled = true;
    };
  }, [isInitialDataLoaded]);

  useEffect(() => {
    const listener = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void handleRefreshFeed({ showIndicator: false, showToast: false });
    });
    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, []);

  useEffect(() => {
    let listener: { remove: () => Promise<void> } | undefined;
    let isMounted = true;
    void TelegramNative.addListener('downloadProgress', (progress: TelegramDownloadProgress) => {
      const matching = downloadedVideosRef.current.filter(
        (download) =>
          (progress.itemId ? download.id === progress.itemId : false) ||
          (progress.fileId > 0 && download.item.telegramFileId === progress.fileId),
      );
      if (matching.length === 0) return;
      const updated = downloadedVideosRef.current.map((download) => {
        const isMatchingDownload =
          (progress.itemId ? download.id === progress.itemId : false) ||
          (progress.fileId > 0 && download.item.telegramFileId === progress.fileId);
        if (!isMatchingDownload) return download;
        return {
          ...download,
          status: progress.status,
          progress: Math.max(download.progress, progress.progress),
          downloadedBytes: progress.downloadedBytes,
          totalBytes: progress.totalBytes,
          error: progress.error,
        };
      });
      try {
        persistDownloadedVideos(updated);
      } catch (error) {
        console.error('Could not save Telegram download progress:', error);
        showToast('Download chal raha hai, lekin progress list save nahi ho saki.');
      }
    }).then((handle) => {
      if (isMounted) listener = handle;
      else void handle.remove();
    }).catch((error: unknown) => {
      console.error('Could not listen for Telegram download progress:', error);
      showToast('Download progress display start nahi ho saka.');
    });

    return () => {
      isMounted = false;
      if (listener) void listener.remove();
    };
  }, []);

  // Toggle My List / Fevrate
  const handleToggleMyList = (item: MediaItem) => {
    const isRemoving = savedIds.includes(item.id);
    setSavedIds((prev) => {
      let updated: string[];
      if (isRemoving) {
        updated = prev.filter((id) => id !== item.id);
        showToast(`Removed from Fevrate`);
      } else {
        updated = [...prev, item.id];
        showToast(`Added to Fevrate ❤️`);
      }
      saveMyList(updated);
      return updated;
    });

    if (cloudSyncEnabled) {
      const request = isRemoving
        ? backendFetch(`/user/favorites/${encodeURIComponent(item.id)}`, { method: 'DELETE' })
        : backendFetch('/user/favorites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mediaId: item.id,
              title: item.title,
              channel: item.channel,
              type: item.type,
              videoUrl: item.videoUrl,
              poster: item.poster,
              backdrop: item.backdrop,
              caption: item.caption,
            }),
          });

      request.then(async (response) => {
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `Favorite sync failed (${response.status})`);
        }
      }).then(() => {
        setCloudFavoriteItems((previous) => isRemoving
          ? previous.filter((favorite) => favorite.id !== item.id)
          : [...previous.filter((favorite) => favorite.id !== item.id), item]
        );
      }).catch((error) => {
        console.error('Failed to sync favorite with Supabase:', error);
        showToast('Favorite saved locally, but Supabase sync failed');
      });
    }
  };

  const handleAddToPlaylist = (item: MediaItem) => {
    if (item.type !== 'video') {
      showToast('Sirf videos playlist mein add ho sakte hain.');
      return;
    }
    if (playlists.length === 0) {
      setPendingPlaylistItem(item);
      setActiveTab('mylist');
      setIsCreatingPlaylist(true);
      showToast('Video add karne se pehle apni pehli playlist banayein.');
      return;
    }
    if (playlists.length === 1) {
      addVideoToPlaylist(item, playlists[0].id);
      return;
    }
    setPlaylistPickerItem(item);
  };

  const addVideoToPlaylist = (item: MediaItem, playlistId: string) => {
    const playlist = playlists.find((entry) => entry.id === playlistId);
    if (!playlist) {
      showToast('Playlist nahi mili. Dobara try karein.');
      return;
    }
    if (playlist.itemIds.includes(item.id)) {
      showToast(`Video "${playlist.name}" mein pehle se hai.`);
      return;
    }
    const updatedPlaylist = { ...playlist, itemIds: [...playlist.itemIds, item.id] };
    const updated = playlists.map((entry) => entry.id === playlistId ? updatedPlaylist : entry);
    try {
      savePlaylists(updated);
      setPlaylists(updated);
      showToast(`Video "${playlist.name}" playlist mein add ho gaya.`);
    } catch (error) {
      console.error('Could not save video to playlist:', error);
      showToast('Playlist update nahi ho saki. Storage space check karke retry karein.');
    }
  };

  const createPlaylist = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = playlistName.trim();
    if (!name) {
      showToast('Playlist ka naam enter karein.');
      return;
    }
    const id = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `playlist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const playlist: MediaPlaylist = {
      id,
      name,
      itemIds: pendingPlaylistItem ? [pendingPlaylistItem.id] : [],
      createdAt: Date.now(),
    };
    const updated = [playlist, ...playlists];
    try {
      savePlaylists(updated);
      setPlaylists(updated);
      setSelectedPlaylistId(playlist.id);
      setPlaylistName('');
      setIsCreatingPlaylist(false);
      setPendingPlaylistItem(null);
      showToast(pendingPlaylistItem
        ? `Playlist ban gayi aur video "${name}" mein add ho gaya.`
        : `Playlist "${name}" ban gayi.`);
    } catch (error) {
      console.error('Could not create playlist:', error);
      showToast('Playlist save nahi ho saki. Storage space check karke retry karein.');
    }
  };

  const removeVideoFromPlaylist = (item: MediaItem, playlistId: string) => {
    const playlist = playlists.find((entry) => entry.id === playlistId);
    if (!playlist) return;
    const updatedPlaylist = {
      ...playlist,
      itemIds: playlist.itemIds.filter((id) => id !== item.id),
    };
    const updated = playlists.map((entry) => entry.id === playlistId ? updatedPlaylist : entry);
    try {
      savePlaylists(updated);
      setPlaylists(updated);
      showToast(`Video "${playlist.name}" se remove ho gaya.`);
    } catch (error) {
      console.error('Could not remove video from playlist:', error);
      showToast('Playlist update nahi ho saki.');
    }
  };

  const deletePlaylist = (playlist: MediaPlaylist) => {
    if (!window.confirm(`"${playlist.name}" playlist delete karein?`)) return;
    const updated = playlists.filter((entry) => entry.id !== playlist.id);
    try {
      savePlaylists(updated);
      setPlaylists(updated);
      if (selectedPlaylistId === playlist.id) setSelectedPlaylistId(null);
      showToast(`Playlist "${playlist.name}" delete ho gayi.`);
    } catch (error) {
      console.error('Could not delete playlist:', error);
      showToast('Playlist delete nahi ho saki.');
    }
  };

  // Update Watch Progress
  const handleUpdateProgress = (itemId: string, percent: number, positionSeconds: number) => {
    const safePercent = Math.min(100, Math.max(0, percent));
    const safePosition = Number.isFinite(positionSeconds) ? Math.max(0, positionSeconds) : 0;
    const isLocalVideo = itemId.startsWith('local-');
    if (safePercent >= (isLocalVideo ? 100 : 95)) {
      if (watchPositionsRef.current[itemId] !== undefined) {
        const updatedPositions = { ...watchPositionsRef.current };
        delete updatedPositions[itemId];
        watchPositionsRef.current = updatedPositions;
        saveWatchPosition(itemId, 0);
      }
    } else if (safePosition > 0 && Math.floor(watchPositionsRef.current[itemId] || 0) !== Math.floor(safePosition)) {
      watchPositionsRef.current = { ...watchPositionsRef.current, [itemId]: Math.floor(safePosition) };
      saveWatchPosition(itemId, safePosition);
    }
    if (watchProgressRef.current[itemId] === safePercent) return;
    watchProgressRef.current = { ...watchProgressRef.current, [itemId]: safePercent };
    saveWatchProgress(itemId, safePercent);
    setWatchProgressMap((prev) => {
      if (prev[itemId] === safePercent) return prev;
      return { ...prev, [itemId]: safePercent };
    });
  };

  // All Items across all channels (for search & recommendations)
  const allMediaItems = useMemo(() => {
    const list: MediaItem[] = [];
    const seen = new Set<string>();
    channels.forEach((ch) => {
      ch.items.forEach((item) => {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          list.push(item);
        }
      });
    });
    return list;
  }, [channels]);

  useEffect(() => {
    if (!cloudSyncEnabled || !user || !isInitialDataLoaded) {
      setCloudFavoriteItems([]);
      return;
    }

    let cancelled = false;
    const restoreFavorites = async () => {
      try {
        const response = await backendFetch('/user/favorites');
        if (!response.ok) throw new Error(`Favorite restore failed (${response.status})`);
        const data: {
          favorites: {
            mediaId: string;
            title: string;
            channel: string;
            type: string;
            videoUrl?: string | null;
            poster?: string | null;
            backdrop?: string | null;
            caption?: string | null;
          }[];
        } = await response.json();
        if (cancelled) return;

        const restoredItems: MediaItem[] = (data.favorites || []).map((favorite) => ({
          id: favorite.mediaId,
          channel: favorite.channel,
          type: favorite.type === 'photo' || favorite.type === 'text' ? favorite.type : 'video',
          title: favorite.title,
          videoUrl: favorite.videoUrl || undefined,
          poster: favorite.poster || undefined,
          backdrop: favorite.backdrop || undefined,
          caption: favorite.caption || '',
        }));
        const remoteIds = restoredItems.map((item) => item.id);
        setCloudFavoriteItems(restoredItems);
        setSavedIds((previous) => {
          const updated = Array.from(new Set([...previous, ...remoteIds]));
          saveMyList(updated);
          return updated;
        });
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to restore favorites from Supabase:', error);
        showToast('Could not sync favorites from Supabase');
      }
    };

    restoreFavorites();
    return () => {
      cancelled = true;
    };
  }, [user, isInitialDataLoaded, cloudSyncEnabled]);

  // Current active channel items
  const currentItems = useMemo(() => activeChannel?.items.filter(
    (item) => item.type === 'video'
      && (item.videoUrl || item.telegramFileId)
  ) || [], [activeChannel]);

  // Continue Watching items
  const continueWatchingItems = useMemo(() => {
    return allMediaItems.filter(
      (item) => item.type === 'video' && (watchProgressMap[item.id] || 0) > 0 && (watchProgressMap[item.id] || 0) < 100
    );
  }, [allMediaItems, watchProgressMap]);

  // Fevrate / My List items
  const fevrateItems = useMemo(() => {
    const itemsById = new Map(cloudFavoriteItems.map((item) => [item.id, item]));
    allMediaItems.forEach((item) => {
      if (savedIds.includes(item.id)) itemsById.set(item.id, item);
    });
    return Array.from(itemsById.values()).filter((item) => (
      savedIds.includes(item.id) && (item.type !== 'video' || isLongVideo(item.duration))
    ));
  }, [allMediaItems, cloudFavoriteItems, savedIds]);

  const playlistSavedItemIds = useMemo(
    () => [...new Set(playlists.flatMap((playlist) => playlist.itemIds))],
    [playlists],
  );
  const selectedPlaylist = playlists.find((playlist) => playlist.id === selectedPlaylistId) || null;
  const selectedPlaylistItems = useMemo(() => {
    if (!selectedPlaylist) return [];
    const itemsById = new Map(allMediaItems.map((item) => [item.id, item]));
    return selectedPlaylist.itemIds
      .map((id) => itemsById.get(id))
      .filter((item): item is MediaItem => Boolean(item && item.type === 'video'));
  }, [allMediaItems, selectedPlaylist]);

  // Grouped Categories for Netflix Rows
  const latestVideoItems = useMemo(
    () => allMediaItems
      .filter((item) => item.type === 'video' && (item.videoUrl || item.telegramFileId))
      .map((item, originalIndex) => ({ item, originalIndex, timestamp: Date.parse(item.date || '') }))
      .sort((left, right) => {
        const leftHasDate = Number.isFinite(left.timestamp);
        const rightHasDate = Number.isFinite(right.timestamp);
        if (leftHasDate && rightHasDate) return right.timestamp - left.timestamp;
        if (leftHasDate !== rightHasDate) return leftHasDate ? -1 : 1;
        return left.originalIndex - right.originalIndex;
      })
      .slice(0, 10)
      .map(({ item }) => item),
    [allMediaItems],
  );
  const featuredItem = latestVideoItems[0] || null;

  const trendingItems = useMemo(() => [...currentItems].sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0)), [currentItems]);
  const channelFeedSections = useMemo(
    () => channels
      .map((channel) => ({
        channel,
        items: channel.items
          .filter((item) => item.type === 'video'
            && (item.videoUrl || item.telegramFileId))
          .map((item, originalIndex) => ({
            item,
            originalIndex,
            timestamp: Date.parse(item.date || ''),
          }))
          .sort((left, right) => {
            const leftHasDate = Number.isFinite(left.timestamp);
            const rightHasDate = Number.isFinite(right.timestamp);
            if (leftHasDate && rightHasDate) return right.timestamp - left.timestamp;
            if (leftHasDate !== rightHasDate) return leftHasDate ? -1 : 1;
            return left.originalIndex - right.originalIndex;
          })
          .map(({ item }) => item),
      }))
      .filter(({ items }) => items.length > 0),
    [channels],
  );
  const homeTrendingItems = useMemo(() => {
    const channelFeeds = channelFeedSections.map(({ items }) => items);
    const selectedItems: MediaItem[] = [];
    const channelIndexes = channelFeeds.map(() => 0);
    const seenIds = new Set<string>();

    while (selectedItems.length < 50) {
      let foundItem = false;
      for (let channelIndex = 0; channelIndex < channelFeeds.length && selectedItems.length < 50; channelIndex++) {
        const item = channelFeeds[channelIndex][channelIndexes[channelIndex]];
        if (!item) continue;
        channelIndexes[channelIndex] += 1;
        foundItem = true;
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);
        selectedItems.push(item);
      }
      if (!foundItem) break;
    }

    return selectedItems.sort((left, right) => {
      const leftTimestamp = Date.parse(left.date || '');
      const rightTimestamp = Date.parse(right.date || '');
      const leftHasDate = Number.isFinite(leftTimestamp);
      const rightHasDate = Number.isFinite(rightTimestamp);
      if (leftHasDate && rightHasDate) return rightTimestamp - leftTimestamp;
      if (leftHasDate !== rightHasDate) return leftHasDate ? -1 : 1;
      return 0;
    });
  }, [channelFeedSections]);
  const actionItems = useMemo(() => currentItems.filter((i) => i.genre?.toLowerCase().includes('action') || i.genre?.toLowerCase().includes('thrill') || i.matchScore! > 95), [currentItems]);
  const cinemaItems = useMemo(() => currentItems.filter((i) => i.resolution?.includes('4K') || i.genre?.toLowerCase().includes('cinema')), [currentItems]);

  const filteredHomeChannel = useMemo(
    () => channels.find((channel) => channel.id === homeChannelFilter) || null,
    [channels, homeChannelFilter],
  );
  const filteredHomeChannelItems = useMemo(
    () => filteredHomeChannel?.items.filter(
      (item) => item.type === 'video' && (item.videoUrl || item.telegramFileId),
    ) || [],
    [filteredHomeChannel],
  );
  useEffect(() => {
    setHomeVisibleCount(50);
  }, [homeChannelFilter]);

  useEffect(() => {
    setSearchVisibleCount(120);
  }, [searchQuery, searchFilter]);

  useEffect(() => {
    if (homeChannelFilter !== 'all' && !channels.some((channel) => channel.id === homeChannelFilter)) {
      setHomeChannelFilter('all');
    }
  }, [channels, homeChannelFilter]);

  // Filtered Items for Search Tab
  const searchTabResults = useMemo(() => {
    return allMediaItems.filter((item) => {
      const matchText =
        !searchQuery ||
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.caption.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.genre?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.channel.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchText) return false;

      if (searchFilter === 'video') return item.type === 'video';
      if (searchFilter === 'photo') return item.type === 'photo';
      if (searchFilter === '4k') return item.resolution?.includes('4K');
      return true;
    });
  }, [allMediaItems, searchQuery, searchFilter]);

  const handleDownloadVideo = async (item: MediaItem) => {
    if (Capacitor.isNativePlatform()
      && isTelegramContentItem(item)
      && !item.telegramContentRestrictionChecked) {
      showToast('This Telegram video has not passed the sensitive-content check and is blocked.');
      return;
    }
    if (!item.telegramFileId && !item.videoUrl && !item.rawVideoUrl) {
      showToast('Is video ke liye download source available nahi hai.');
      return;
    }

    const downloadStartedAt = Date.now();
    try {
      const existingDownload = downloadedVideosRef.current.find((download) => download.id === item.id);
      const pendingDownload: DownloadedVideo = {
        id: item.id,
        item,
        location: existingDownload?.location || '',
        playbackUrl: existingDownload?.playbackUrl,
        downloadedAt: existingDownload?.downloadedAt || downloadStartedAt,
        status: 'downloading',
        progress: 0,
        error: undefined,
      };
      persistDownloadedVideos([
        pendingDownload,
        ...downloadedVideosRef.current.filter((download) => download.id !== item.id),
      ]);
      showToast('Video download ho raha hai...');
      const result = item.telegramFileId
        ? await TelegramNative.saveChannelVideo({
            fileId: item.telegramFileId,
            itemId: item.id,
            chatId: item.telegramChatId,
            messageId: item.telegramId,
            title: item.title,
            mimeType: item.telegramMimeType,
          })
        : await TelegramNative.downloadRemoteVideo({
            url: item.videoUrl || item.rawVideoUrl || '',
            itemId: item.id,
            title: item.title,
            mimeType: item.telegramMimeType || 'video/mp4',
          });
      const downloadedVideo: DownloadedVideo = {
        id: item.id,
        item,
        location: result.location,
        playbackUrl: result.playbackUrl,
        downloadedAt: downloadStartedAt,
        status: 'completed',
        progress: 100,
      };
      persistDownloadedVideos([
        downloadedVideo,
        ...downloadedVideosRef.current.filter((download) => download.id !== item.id),
      ]);
      showToast(`Video device par save ho gaya: ${result.location}`);
    } catch (error) {
      console.error('Could not save Telegram video:', error);
      const message = error instanceof Error ? error.message : 'Telegram video download nahi hua.';
      const failed = downloadedVideosRef.current.map((download) =>
        download.id === item.id
          ? { ...download, status: 'failed' as const, error: message }
          : download,
      );
      try {
        persistDownloadedVideos(failed);
      } catch (storageError) {
        console.error('Could not save the failed download state:', storageError);
      }
      showToast(`Download nahi hua: ${message}`);
    }
  };

  return (
    <div className={`min-h-screen min-h-[100dvh] bg-[#141414] text-white flex flex-col justify-between selection:bg-[#E50914] selection:text-white pb-[calc(6rem+env(safe-area-inset-bottom,0px))] xl:pb-8 ${playingItem?.telegramNativePlayback || playingItem?.localNativePlayback ? 'native-video-active' : ''}`}>
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 right-4 z-50 bg-[#E50914] text-white text-xs sm:text-sm font-semibold px-4 py-2.5 rounded-lg shadow-2xl flex items-center space-x-2 animate-in fade-in slide-in-from-top-4 duration-200">
          <Sparkles className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <Header
        onTabChange={setActiveTab}
        downloadCount={downloadedVideos.length}
        onTelegramLinkClick={handleNotificationTelegramLink}
      />

      {/* Main Content Area */}
      <main
        className="app-content flex-1 w-full"
        onTouchStart={(event) => {
          if (activeTab !== 'home' || isRefreshing || window.scrollY > 4 || event.touches.length !== 1) {
            refreshTouchStart.current = null;
            return;
          }
          const touch = event.touches[0];
          refreshTouchStart.current = { x: touch.clientX, y: touch.clientY };
        }}
        onTouchMove={(event) => {
          const start = refreshTouchStart.current;
          if (!start || isRefreshing || event.touches.length !== 1) return;
          const touch = event.touches[0];
          const deltaY = touch.clientY - start.y;
          const deltaX = Math.abs(touch.clientX - start.x);
          if (deltaY >= 50 && deltaY > deltaX * 1.3 && window.scrollY <= 4) {
            refreshTouchStart.current = null;
            void handleRefreshFeed();
          }
        }}
        onTouchEnd={(event) => {
          const start = refreshTouchStart.current;
          refreshTouchStart.current = null;
          if (!start || activeTab !== 'home' || isRefreshing || event.changedTouches.length !== 1) return;

          const touch = event.changedTouches[0];
          const deltaY = touch.clientY - start.y;
          const deltaX = Math.abs(touch.clientX - start.x);
          if (deltaY >= 80 && deltaY > deltaX * 1.3) void handleRefreshFeed();
        }}
        onTouchCancel={() => {
          refreshTouchStart.current = null;
        }}
      >
        {isRefreshing && (
          <div
            className="fixed top-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-zinc-700 bg-zinc-900/95 px-4 py-2.5 text-xs font-medium text-white shadow-xl backdrop-blur"
            role="status"
            aria-live="polite"
          >
            <span className="refresh-spinner" aria-hidden="true">
              <span className="refresh-spinner-play" />
            </span>
            Latest posts check ho rahe hain...
          </div>
        )}
        {/* TAB 1: HOME */}
        {activeTab === 'home' && (
          <div className="space-y-4">
            {/* Hero Banner */}
            <HeroBanner
              items={latestVideoItems}
              onPlay={(item) => {
                playNetflixTaDum();
                void handlePlayItem(item);
              }}
              onMoreInfo={(item) => setDetailItem(item)}
              isSavedInList={featuredItem ? playlistSavedItemIds.includes(featuredItem.id) : false}
              onToggleMyList={handleAddToPlaylist}
            />

            <div className="relative z-20 mt-4 space-y-4 sm:space-y-6">
              <ChannelFilterBar
                channels={channels}
                selectedChannelId={homeChannelFilter}
                onSelectChannel={setHomeChannelFilter}
              />

              {homeChannelFilter !== 'all' ? (
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg sm:text-xl font-bold text-white flex items-center space-x-2">
                      <span>Videos from {filteredHomeChannel?.title || `@${filteredHomeChannel?.username}`}</span>
                      <span className="text-[#E50914] text-xs font-semibold">({filteredHomeChannelItems.length})</span>
                    </h2>
                    <button
                      onClick={() => setHomeChannelFilter('all')}
                      className="text-xs text-zinc-400 hover:text-white underline"
                    >
                      Show All Channels
                    </button>
                  </div>

                  {filteredHomeChannelItems.length === 0 ? (
                    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-8 text-center space-y-2">
                      <p className="text-zinc-300 font-semibold text-sm">No videos found in this channel</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
                      {filteredHomeChannelItems.slice(0, homeVisibleCount).map((item) => (
                        <div
                          key={item.id}
                          onClick={() => {
                            playNetflixTaDum();
                            void handlePlayItem(item);
                          }}
                          className="group bg-zinc-900 rounded-lg overflow-hidden border border-zinc-800 hover:border-zinc-500 cursor-pointer transition-all"
                        >
                          <div className="relative aspect-video bg-zinc-950">
                            <img
                              src={item.poster || item.photoUrl || item.backdrop}
                              alt={item.title}
                              loading="lazy"
                              decoding="async"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                            />
                            {item.duration && (
                              <span className="absolute bottom-1 right-1 bg-black/80 text-[10px] font-mono px-1 rounded text-zinc-200">
                                {item.duration}
                              </span>
                            )}
                            <span className="absolute top-1 left-1 bg-[#E50914] text-white text-[9px] font-bold px-1 rounded">
                              {item.matchScore || 96}%
                            </span>
                          </div>
                          <div className="p-2 space-y-0.5">
                            <h4 className="text-xs font-semibold text-white truncate leading-tight">{item.title}</h4>
                            <p className="text-[10px] text-zinc-400 truncate">@{item.channel}</p>
                          </div>
                        </div>
                      ))}
                      {homeVisibleCount < filteredHomeChannelItems.length && (
                        <button
                          type="button"
                          onClick={() => setHomeVisibleCount((count) => count + 50)}
                          className="col-span-full mx-auto rounded-lg border border-zinc-600 bg-zinc-900 px-6 py-2.5 text-sm font-bold text-white hover:bg-zinc-800"
                        >
                          View more ({filteredHomeChannelItems.length - homeVisibleCount})
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {/* Continue Watching Row */}
                  {continueWatchingItems.length > 0 && (
                    <MediaRow
                      title="Continue Watching"
                      subtitle="Pick up right where you left off"
                      items={continueWatchingItems}
                      onPlay={(item) => void handlePlayItem(item)}
                      onMoreInfo={(item) => setDetailItem(item)}
                      savedItemIds={playlistSavedItemIds}
                      onToggleMyList={handleAddToPlaylist}
                      watchProgressMap={watchProgressMap}
                    />
                  )}

                  <section className="space-y-3 py-4">
                    <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
                      <div>
                        <h2 className="flex items-center gap-2 text-base font-bold tracking-wide text-white sm:text-xl md:text-2xl">
                          <ListVideo className="h-5 w-5 text-[#E50914]" />
                          <span>My Playlist</span>
                          <span className="text-xs font-normal text-zinc-600">({playlists.length})</span>
                        </h2>
                        <p className="mt-0.5 text-xs text-zinc-400">Your saved video playlists</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPlaylistId(null);
                          setPendingPlaylistItem(null);
                          setIsCreatingPlaylist(true);
                          setActiveTab('mylist');
                        }}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#E50914] px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-[#b81d24] sm:text-sm"
                      >
                        <Plus className="h-4 w-4" />
                        Create
                      </button>
                    </div>

                    {playlists.length > 0 ? (
                      <div className="flex gap-3 overflow-x-auto px-4 pb-2 no-scrollbar sm:gap-4 sm:px-6 lg:px-8">
                        {playlists.map((playlist) => {
                          const firstItem = allMediaItems.find((item) => playlist.itemIds.includes(item.id));
                          return (
                            <button
                              key={playlist.id}
                              type="button"
                              onClick={() => {
                                setSelectedPlaylistId(playlist.id);
                                setActiveTab('mylist');
                              }}
                              className="group w-[170px] shrink-0 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 text-left transition-colors hover:border-zinc-500 sm:w-[220px] md:w-[260px]"
                            >
                              <div className="relative aspect-video bg-zinc-950">
                                {firstItem?.poster || firstItem?.photoUrl || firstItem?.backdrop ? (
                                  <img
                                    src={firstItem.poster || firstItem.photoUrl || firstItem.backdrop}
                                    alt=""
                                    loading="lazy"
                                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                                  />
                                ) : (
                                  <ListVideo className="absolute inset-0 m-auto h-10 w-10 text-zinc-600" />
                                )}
                                <span className="absolute bottom-2 right-2 rounded bg-black/80 px-2 py-1 text-[10px] text-white">
                                  {playlist.itemIds.length} video{playlist.itemIds.length === 1 ? '' : 's'}
                                </span>
                              </div>
                              <div className="p-3">
                                <h3 className="truncate text-xs font-semibold text-white sm:text-sm">
                                  {playlist.name}
                                </h3>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="mx-4 flex items-center justify-between gap-3 rounded-xl border border-dashed border-zinc-700 bg-zinc-900/50 p-4 sm:mx-6 lg:mx-8">
                        <div className="flex min-w-0 items-center gap-3">
                          <ListVideo className="h-8 w-8 shrink-0 text-zinc-500" />
                          <p className="text-xs text-zinc-400 sm:text-sm">
                            No playlists yet. Create one to organize your videos.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPlaylistId(null);
                            setPendingPlaylistItem(null);
                            setIsCreatingPlaylist(true);
                            setActiveTab('mylist');
                          }}
                          className="shrink-0 text-xs font-bold text-white underline decoration-[#E50914] underline-offset-4 sm:text-sm"
                        >
                          Create playlist
                        </button>
                      </div>
                    )}
                  </section>

              {/* Trending Now */}
              <MediaRow
                title="🔥 Trending Now on Telegram"
                items={homeTrendingItems}
                onPlay={(item) => void handlePlayItem(item)}
                onMoreInfo={(item) => setDetailItem(item)}
                savedItemIds={playlistSavedItemIds}
                onToggleMyList={handleAddToPlaylist}
                watchProgressMap={watchProgressMap}
              />

              {channelFeedSections.map(({ channel, items }) => (
                <MediaRow
                  key={channel.id}
                  title={`🎬 Videos from ${channel.title}`}
                  items={items}
                  onPlay={(item) => void handlePlayItem(item)}
                  onMoreInfo={(item) => setDetailItem(item)}
                  savedItemIds={playlistSavedItemIds}
                  onToggleMyList={handleAddToPlaylist}
                  watchProgressMap={watchProgressMap}
                />
              ))}

              {/* 4K & Action Vault */}
              {cinemaItems.length > 0 && (
                <MediaRow
                  title="⚡ 4K Ultra HD & Blockbuster Teasers"
                  items={cinemaItems}
                  onPlay={(item) => void handlePlayItem(item)}
                  onMoreInfo={(item) => setDetailItem(item)}
                  savedItemIds={playlistSavedItemIds}
                  onToggleMyList={handleAddToPlaylist}
                  watchProgressMap={watchProgressMap}
                />
              )}

              {/* Fevrate Row */}
              {fevrateItems.some((item) => item.type === 'video') && (
                <MediaRow
                  title="❤️ Fevrate / Bookmarks"
                  items={fevrateItems.filter((item) => item.type === 'video')}
                  onPlay={(item) => void handlePlayItem(item)}
                  onMoreInfo={(item) => setDetailItem(item)}
                  savedItemIds={playlistSavedItemIds}
                  onToggleMyList={handleAddToPlaylist}
                  watchProgressMap={watchProgressMap}
                />
              )}

            </>
          )}
        </div>
      </div>
    )}

        {/* TAB 2: SEARCH (MOBILE & TABLET APP BAR OR DESKTOP) */}
        {activeTab === 'search' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-24 space-y-6">
            <div className="space-y-1">
              <h1 className="font-bebas text-3xl sm:text-4xl text-white tracking-wide flex items-center space-x-2">
                <Search className="w-7 h-7 text-[#E50914]" />
                <span>Search Telegram Streams</span>
              </h1>
              <p className="text-xs sm:text-sm text-zinc-400">
                Instantly search across {allMediaItems.length} videos, movies, and photos from all connected channels.
              </p>
            </div>

            {/* Search Input Box */}
            <div className="relative">
              <Search className="w-5 h-5 text-zinc-400 absolute left-4 top-3.5 pointer-events-none" />
              <input
                type="text"
                autoFocus
                placeholder="Search by title, category, actor, or Telegram caption..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-xl pl-12 pr-10 py-3 text-white text-sm sm:text-base placeholder-zinc-500 focus:outline-none focus:border-[#E50914] shadow-lg"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-4 top-3.5 text-zinc-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Filter Chips */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setSearchFilter('all')}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  searchFilter === 'all' ? 'bg-[#E50914] text-white shadow' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
              >
                All ({allMediaItems.length})
              </button>
              <button
                onClick={() => setSearchFilter('video')}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold flex items-center space-x-1.5 transition-colors ${
                  searchFilter === 'video' ? 'bg-[#E50914] text-white shadow' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
              >
                <Video className="w-3.5 h-3.5" />
                <span>Videos Only</span>
              </button>
              <button
                onClick={() => setSearchFilter('photo')}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold flex items-center space-x-1.5 transition-colors ${
                  searchFilter === 'photo' ? 'bg-[#E50914] text-white shadow' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>Photos</span>
              </button>
              <button
                onClick={() => setSearchFilter('4k')}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  searchFilter === '4k' ? 'bg-[#E50914] text-white shadow' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
              >
                4K Ultra HD
              </button>
            </div>

            {/* Quick Keyword Suggestions if query is empty */}
            {!searchQuery && (
              <div className="space-y-2">
                <span className="text-[11px] uppercase tracking-wider text-zinc-500 font-bold">
                  Popular Searches:
                </span>
                <div className="flex flex-wrap gap-2">
                  {['Action', 'Cyber', '4K Ultra HD', 'Bollywood', 'Documentary', 'Trailer', 'Sci-Fi'].map((kw) => (
                    <button
                      key={kw}
                      onClick={() => setSearchQuery(kw)}
                      className="text-xs bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg border border-zinc-700 transition-colors"
                    >
                      {kw}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Results Grid */}
            <div className="space-y-3 pt-2">
              <h3 className="text-xs uppercase tracking-wider text-zinc-400 font-bold">
                {searchTabResults.length > 0 ? `Found ${searchTabResults.length} Stream Results` : 'No matching streams'}
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
                {searchTabResults.slice(0, searchVisibleCount).map((item) => (
                  <div
                    key={item.id}
                    onClick={() => {
                      playNetflixTaDum();
                      void handlePlayItem(item);
                    }}
                    className="group bg-zinc-900 rounded-lg overflow-hidden border border-zinc-800 hover:border-zinc-500 cursor-pointer transition-all duration-200"
                  >
                    <div className="relative aspect-video bg-zinc-950">
                      <img
                        src={item.poster || item.photoUrl || item.backdrop}
                        alt={item.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                      {item.duration && (
                        <span className="absolute bottom-1 right-1 bg-black/80 text-[10px] font-mono px-1 rounded text-zinc-200">
                          {item.duration}
                        </span>
                      )}
                      <span className="absolute top-1 left-1 bg-[#E50914] text-white text-[9px] font-bold px-1 rounded">
                        {item.matchScore || 96}%
                      </span>
                    </div>
                    <div className="p-2 space-y-0.5">
                      <h4 className="text-xs font-semibold text-white truncate leading-tight">{item.title}</h4>
                      <p className="text-[10px] text-zinc-400 truncate">@{item.channel}</p>
                    </div>
                  </div>
                ))}
              </div>
              {searchVisibleCount < searchTabResults.length && (
                <button type="button" onClick={() => setSearchVisibleCount((count) => count + 120)} className="rounded-lg border border-zinc-600 bg-zinc-900 px-5 py-3 text-sm font-bold text-white hover:bg-zinc-800">
                  View more ({searchTabResults.length - searchVisibleCount})
                </button>
              )}
            </div>
          </div>
        )}

        {activeTab === 'downloads' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-24 space-y-6">
            <div className="flex items-center gap-3">
              <Download className="w-7 h-7 text-[#E50914]" />
              <div>
                <h1 className="font-bebas text-3xl sm:text-4xl text-white tracking-wide">
                  Downloads ({downloadedVideos.length})
                </h1>
                <p className="text-xs sm:text-sm text-zinc-400">Videos saved from AMZY are kept here.</p>
              </div>
            </div>

            {downloadedVideos.length === 0 ? (
              <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-10 sm:p-12 text-center space-y-4 max-w-lg mx-auto">
                <Download className="w-12 h-12 text-zinc-500 mx-auto" />
                <h2 className="text-lg font-bold text-white">No downloads yet</h2>
                <p className="text-sm text-zinc-400">
                  Open a video and use its Download button. Saved videos will appear here.
                </p>
                <button
                  onClick={() => setActiveTab('home')}
                  className="bg-[#E50914] hover:bg-[#b81d24] text-white px-6 py-2.5 rounded-lg font-bold text-xs transition-colors"
                >
                  Browse videos
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
                {downloadedVideos.map(({ id, item, location, playbackUrl, downloadedAt, status, progress, error }) => (
                  <article key={id} className="group bg-zinc-900 rounded-lg overflow-hidden border border-zinc-800">
                    <div className="relative aspect-video bg-zinc-950">
                      {item.poster || item.photoUrl || item.backdrop ? (
                        <img
                          src={item.poster || item.photoUrl || item.backdrop}
                          alt=""
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Film className="w-10 h-10 text-zinc-600 absolute inset-0 m-auto" />
                      )}
                      {status === 'completed' ? (
                        <button
                          type="button"
                          onClick={() => {
                            playNetflixTaDum();
                            void handlePlayItem({
                              ...item,
                              videoUrl: playbackUrl,
                              rawVideoUrl: undefined,
                              telegramChatId: undefined,
                              telegramId: undefined,
                              telegramNativePlayback: false,
                            });
                          }}
                          className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/40 transition-colors"
                          aria-label={`Play downloaded video ${item.title}`}
                        >
                          <Play className="w-10 h-10 fill-white text-white drop-shadow-lg" />
                        </button>
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 px-4 text-center">
                          <span className="text-xs font-semibold text-white">
                            {status === 'failed' ? 'Download failed' : 'Downloading'}
                          </span>
                          <span className="text-xs text-zinc-300">{progress}%</span>
                        </div>
                      )}
                      {status === 'downloading' && (
                        <div
                          className="absolute bottom-0 left-0 h-1 bg-[#E50914] transition-[width] duration-300"
                          style={{ width: `${progress}%` }}
                        />
                      )}
                    </div>
                    <div className="p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h2 className="text-sm font-semibold text-white truncate">{item.title}</h2>
                          <p className="text-[10px] text-zinc-400 truncate">@{item.channel}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {status === 'failed' && (
                            <button
                              type="button"
                              onClick={() => void handleDownloadVideo(item)}
                              aria-label={`Retry download for ${item.title}`}
                              title="Retry download"
                              className="rounded p-1 text-zinc-400 hover:text-white"
                            >
                              <Download className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              const updated = downloadedVideos.filter((download) => download.id !== id);
                              try {
                                persistDownloadedVideos(updated);
                              } catch (error) {
                                console.error('Could not remove video from the downloads list:', error);
                                showToast('Could not update the downloads list.');
                              }
                            }}
                            aria-label={`Remove ${item.title} from downloads list`}
                            title="Remove from list"
                            className="rounded p-1 text-zinc-400 hover:text-red-400"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <p className="text-[10px] text-zinc-500">
                        {status === 'completed'
                          ? `Saved ${new Date(downloadedAt).toLocaleDateString()}`
                          : status === 'failed'
                            ? error || 'Download failed'
                            : `Downloading… ${progress}%`}
                      </p>
                      {status === 'completed' && (
                        <p className="text-[10px] text-zinc-500 truncate" title={location}>{location}</p>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'mylist' && (
          <div className="mx-auto max-w-7xl space-y-6 px-4 pb-24 pt-20 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                {selectedPlaylist && (
                  <button
                    type="button"
                    onClick={() => setSelectedPlaylistId(null)}
                    aria-label="Back to playlists"
                    className="rounded-full border border-zinc-700 p-2 text-zinc-200 hover:bg-zinc-800"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                )}
                <div className="min-w-0">
                  <h1 className="truncate font-bebas text-3xl tracking-wide text-white sm:text-4xl">
                    {selectedPlaylist ? selectedPlaylist.name : `My Playlists (${playlists.length})`}
                  </h1>
                  <p className="text-xs text-zinc-400 sm:text-sm">
                    {selectedPlaylist
                      ? `${selectedPlaylistItems.length} video${selectedPlaylistItems.length === 1 ? '' : 's'}`
                      : 'Create playlists and organize your videos.'}
                  </p>
                </div>
              </div>
              {!selectedPlaylist && (
                <div className="flex shrink-0 items-center gap-2">
                  <input
                    ref={localVideoInputRef}
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={handleLocalVideoSelected}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (Capacitor.getPlatform() === 'android') {
                        void handleAndroidLocalVideoPicked();
                      } else {
                        localVideoInputRef.current?.click();
                      }
                    }}
                    className="flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2.5 text-sm font-bold text-white hover:bg-zinc-800 sm:px-4"
                  >
                    <Video className="h-5 w-5" />
                    <span>Add local video</span>
                  </button>
                </div>
              )}
            </div>

            {!selectedPlaylist && (
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-white">Local video history</h2>
                    <p className="text-xs text-zinc-400">Saved on this device until you remove them.</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {localVideoHistory.length > 4 && (
                      <button
                        type="button"
                        onClick={() => setShowAllLocalVideos((showAll) => !showAll)}
                        className="text-xs font-semibold text-zinc-300 hover:text-white"
                      >
                        {showAllLocalVideos ? 'Show less' : 'View all'}
                      </button>
                    )}
                    <span className="rounded-full bg-zinc-800 px-2.5 py-1 text-xs font-semibold text-zinc-300">
                      {localVideoHistory.length}
                    </span>
                  </div>
                </div>
                {localVideoHistory.length > 0 ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {localVideoHistory.slice(0, showAllLocalVideos ? localVideoHistory.length : 4).map((video) => (
                      <article
                        key={video.id}
                        className="min-w-0 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/70"
                      >
                        <div className="relative flex aspect-video items-center justify-center bg-zinc-800 text-zinc-400">
                          <LocalVideoThumbnail path={video.path} title={video.title} />
                          <button
                            type="button"
                            onClick={() => playLocalVideoHistoryEntry(video)}
                            aria-label={`Play ${video.title}`}
                            title="Play again"
                            className="absolute inset-0 flex items-center justify-center bg-black/10 text-white transition-colors hover:bg-black/30"
                          >
                            <span className="rounded-full bg-black/60 p-2.5">
                              <Play className="h-5 w-5 fill-current" />
                            </span>
                          </button>
                        </div>
                        <div className="flex min-w-0 items-center gap-2 p-2.5">
                          <div className="min-w-0 flex-1">
                            <h3 className="truncate text-sm font-semibold text-white" title={video.title}>
                              {video.title}
                            </h3>
                            <p className="mt-1 truncate text-[10px] text-zinc-500 sm:text-xs">
                              Played {new Date(video.lastPlayedAt).toLocaleString()}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void removeLocalVideoHistoryEntry(video)}
                            aria-label={`Remove ${video.title} from local video history`}
                            title="Remove from history and device"
                            className="shrink-0 rounded-full p-2 text-zinc-400 hover:bg-red-950 hover:text-white"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-5 text-sm text-zinc-400">
                    Videos you play using Add local video will appear here so you can play them again.
                  </p>
                )}
              </section>
            )}

            {isCreatingPlaylist && (
              <form
                onSubmit={createPlaylist}
                className="max-w-xl space-y-3 rounded-xl border border-zinc-700 bg-zinc-900/80 p-4"
              >
                <label htmlFor="playlist-name" className="block text-sm font-semibold text-white">
                  {pendingPlaylistItem
                    ? 'Create your first playlist to add this video'
                    : 'New playlist name'}
                </label>
                <div className="flex gap-2">
                  <input
                    id="playlist-name"
                    autoFocus
                    maxLength={60}
                    value={playlistName}
                    onChange={(event) => setPlaylistName(event.target.value)}
                    placeholder="e.g. Weekend movies"
                    className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-black/40 px-3 py-2.5 text-sm text-white outline-none focus:border-[#E50914]"
                  />
                  <button
                    type="submit"
                    className="rounded-lg bg-white px-4 py-2.5 text-sm font-bold text-black hover:bg-zinc-200"
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsCreatingPlaylist(false);
                      setPendingPlaylistItem(null);
                    }}
                    className="rounded-lg border border-zinc-700 px-3 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {!selectedPlaylist && (
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-white">Playlists</h2>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPendingPlaylistItem(null);
                      setIsCreatingPlaylist(true);
                    }}
                    className="flex items-center gap-1.5 rounded-lg bg-[#E50914] px-3 py-2 text-xs font-bold text-white hover:bg-[#b81d24] sm:text-sm"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Create playlist</span>
                  </button>
                  <span className="rounded-full bg-zinc-800 px-2.5 py-1 text-xs font-semibold text-zinc-300">
                    {playlists.length}
                  </span>
                </div>
              </div>
            )}

            {selectedPlaylist ? (
              selectedPlaylistItems.length > 0 ? (
                <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {selectedPlaylistItems.map((item) => (
                    <div key={item.id} className="relative">
                      <MediaCard
                        item={item}
                        onPlay={(selectedItem) => {
                          playNetflixTaDum();
                          void handlePlayItem(selectedItem);
                        }}
                        onMoreInfo={(selectedItem) => setDetailItem(selectedItem)}
                        isSavedInList
                        onToggleMyList={() => undefined}
                        watchProgress={watchProgressMap[item.id] || 0}
                      />
                      <button
                        type="button"
                        onClick={() => removeVideoFromPlaylist(item, selectedPlaylist.id)}
                        aria-label={`Remove ${item.title} from ${selectedPlaylist.name}`}
                        title="Remove from playlist"
                        className="absolute right-2 top-2 z-10 rounded-full bg-black/80 p-2 text-white hover:bg-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mx-auto max-w-lg space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-10 text-center">
                  <ListVideo className="mx-auto h-12 w-12 text-zinc-500" />
                  <h2 className="text-lg font-bold text-white">This playlist is empty</h2>
                  <p className="text-sm text-zinc-400">Browse videos and tap the plus button to add one here.</p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('home')}
                    className="rounded-lg bg-[#E50914] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#b81d24]"
                  >
                    Browse videos
                  </button>
                </div>
              )
            ) : playlists.length === 0 ? (
              <div className="mx-auto max-w-lg space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-10 text-center">
                <ListVideo className="mx-auto h-12 w-12 text-zinc-500" />
                <h2 className="text-lg font-bold text-white">Create your first playlist</h2>
                <p className="text-sm text-zinc-400">
                  Create a playlist first. Then use the plus button on a video to add it.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {playlists.map((playlist) => {
                  const firstItem = allMediaItems.find((item) => playlist.itemIds.includes(item.id));
                  const itemCount = playlist.itemIds.length;
                  return (
                    <article
                      key={playlist.id}
                      className="group relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 transition-colors hover:border-zinc-500"
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedPlaylistId(playlist.id)}
                        className="block w-full text-left"
                      >
                        <div className="relative aspect-video bg-zinc-950">
                        {firstItem?.poster || firstItem?.photoUrl || firstItem?.backdrop ? (
                          <img
                            src={firstItem.poster || firstItem.photoUrl || firstItem.backdrop}
                            alt=""
                            className="h-full w-full object-cover transition-transform group-hover:scale-105"
                          />
                        ) : (
                          <ListVideo className="absolute inset-0 m-auto h-10 w-10 text-zinc-600" />
                        )}
                        <span className="absolute bottom-2 right-2 rounded bg-black/80 px-2 py-1 text-xs text-white">
                          {itemCount} video{itemCount === 1 ? '' : 's'}
                        </span>
                        </div>
                        <div className="p-3 pr-12">
                          <h2 className="truncate text-sm font-semibold text-white">{playlist.name}</h2>
                          <p className="mt-1 text-xs text-zinc-400">
                            Created {new Date(playlist.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => deletePlaylist(playlist)}
                        aria-label={`Delete playlist ${playlist.name}`}
                        title="Delete playlist"
                        className="absolute bottom-3 right-3 rounded-full p-2 text-zinc-400 hover:bg-red-700 hover:text-white"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </article>
                  );
                })}
              </div>
            )}

            {!selectedPlaylist && (
              <section className="space-y-4">
                <div className="flex flex-col justify-between gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 sm:flex-row sm:items-center sm:p-6">
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-[#E50914]/15 p-3 text-[#E50914]">
                      <Users className="h-6 w-6" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-white">Watch Party Rooms</h2>
                      <p className="mt-1 text-sm text-zinc-400">
                        Doston ke saath video dekho. Room create karo ya code se join karo.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setRoomCodeToRejoin(null);
                      setIsWatchRoomOpen(true);
                    }}
                    className="flex shrink-0 items-center justify-center gap-2 rounded-lg border border-zinc-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-zinc-800"
                  >
                    <Users className="h-5 w-5" />
                    Create / Join Room
                  </button>
                </div>

                {savedWatchRooms.map((room) => {
                  const isCurrentRoom = watchRoomSession?.code === room.code;
                  const isActive = isCurrentRoom && watchRoomSnapshot?.status === 'active';
                  const adminNickname = isActive
                    ? watchRoomSnapshot.participants.find(
                      (participant) => participant.id === watchRoomSnapshot.adminParticipantId,
                    )?.nickname || 'Offline'
                    : null;
                  const anotherRoomIsActive = Boolean(watchRoomSession && !isCurrentRoom);
                  return (
                  <article
                    key={room.code}
                    className="flex flex-col justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4 sm:flex-row sm:items-center sm:p-5"
                  >
                    <div className="flex min-w-0 items-center gap-4">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-[#E50914]/15 text-[#E50914]">
                        <Users className="h-7 w-7" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate font-semibold text-white">Watch Party Room</h3>
                        <p className="mt-1 font-mono text-lg font-bold tracking-widest text-zinc-100">
                          {room.code}
                        </p>
                        <p className="mt-1 text-xs text-zinc-400">
                          {isActive
                            ? `Admin: ${adminNickname} · ${watchRoomSnapshot.participants.length}/10 members`
                            : `Saved room · ${room.nickname}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openSavedWatchRoom(room)}
                        disabled={anotherRoomIsActive}
                        className="rounded-lg bg-[#E50914] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#b81d24] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {anotherRoomIsActive ? 'Leave current room first' : isCurrentRoom ? 'Open room' : 'Rejoin room'}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteSavedWatchRoom(room)}
                        disabled={anotherRoomIsActive}
                        aria-label={`Delete watch party room ${room.code}`}
                        title="Delete room"
                        className="flex h-11 w-11 items-center justify-center rounded-lg border border-red-900/70 text-red-400 hover:bg-red-950/60 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>
                  </article>
                  );
                })}
              </section>
            )}
          </div>
        )}

        {/* TAB: FEVRATE (LEGACY FAVORITES) */}
        {activeTab === 'favorite' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-24 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="font-bebas text-3xl sm:text-4xl text-white tracking-wide flex items-center space-x-2">
                  <Heart className="w-7 h-7 text-[#E50914] fill-[#E50914]" />
                  <span>Fevrate Streams ({fevrateItems.length})</span>
                </h1>
                <p className="text-xs sm:text-sm text-zinc-400">
                  Your bookmarked favorite video clips and posts for quick streaming
                </p>
              </div>
            </div>

            {fevrateItems.length === 0 ? (
              <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-12 text-center space-y-4 max-w-lg mx-auto">
                <div className="w-16 h-16 rounded-full bg-zinc-800 text-[#E50914] flex items-center justify-center mx-auto">
                  <Heart className="w-8 h-8 fill-[#E50914]" />
                </div>
                <h3 className="text-lg font-bold text-white">No Fevrates Added Yet</h3>
                <p className="text-xs sm:text-sm text-zinc-400">
                  Tap the (+) or ❤️ button on any video or movie card in the feed to save it to your personal Fevrate list.
                </p>
                <button
                  onClick={() => setActiveTab('home')}
                  className="bg-[#E50914] hover:bg-[#b81d24] text-white px-6 py-2.5 rounded-lg font-bold text-xs transition-colors shadow-lg"
                >
                  Explore Telegram Videos
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
                {fevrateItems.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => {
                      playNetflixTaDum();
                      void handlePlayItem(item);
                    }}
                    className="group bg-zinc-900 rounded-lg overflow-hidden border border-zinc-800 hover:border-zinc-500 cursor-pointer transition-all"
                  >
                    <div className="relative aspect-video bg-zinc-950">
                      <img
                        src={item.poster || item.photoUrl || item.backdrop}
                        alt={item.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                      {item.duration && (
                        <span className="absolute bottom-1 right-1 bg-black/80 text-[10px] font-mono px-1 rounded text-zinc-200">
                          {item.duration}
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleMyList(item);
                        }}
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 flex items-center justify-center text-[#E50914] hover:scale-110 transition-transform"
                        title="Remove from Fevrate"
                      >
                        <Heart className="w-3.5 h-3.5 fill-[#E50914]" />
                      </button>
                    </div>
                    <div className="p-2 space-y-0.5">
                      <h4 className="text-xs font-semibold text-white truncate">{item.title}</h4>
                      <p className="text-[10px] text-zinc-400 truncate">@{item.channel}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: MY PROFILE */}
        {activeTab === 'profile' && (
          <ProfileView
            channels={channels}
            activeChannel={activeChannel}
            onSelectChannel={handleSelectChannel}
            onRemoveChannel={handleRemoveChannel}
            onOpenConnectModal={() => setIsConnectModalOpen(true)}
            favoriteCount={fevrateItems.length}
            watchedCount={continueWatchingItems.length}
          />
        )}

        {/* TAB 5: TRENDING & POPULAR (FROM TOP NAV) */}
        {activeTab === 'trending' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-24 space-y-6">
            <div className="space-y-1">
              <h1 className="font-bebas text-3xl sm:text-4xl text-white tracking-wide">
                Trending & Popular Streams
              </h1>
              <p className="text-xs sm:text-sm text-zinc-400">
                Top rated video posts across all connected Telegram broadcast channels
              </p>
            </div>

            <MediaRow
              title="Top 10 Worldwide"
              items={trendingItems.slice(0, 10)}
              onPlay={(item) => void handlePlayItem(item)}
              onMoreInfo={(item) => setDetailItem(item)}
              savedItemIds={playlistSavedItemIds}
              onToggleMyList={handleAddToPlaylist}
              watchProgressMap={watchProgressMap}
            />

            <MediaRow
              title="High Octane & Action"
              items={actionItems}
              onPlay={(item) => void handlePlayItem(item)}
              onMoreInfo={(item) => setDetailItem(item)}
              savedItemIds={playlistSavedItemIds}
              onToggleMyList={handleAddToPlaylist}
              watchProgressMap={watchProgressMap}
            />
          </div>
        )}
      </main>

      {/* Netflix Footer */}
      <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-8 border-t border-zinc-800/60 mt-16 text-zinc-500 text-xs space-y-4">
        <div className="flex flex-wrap gap-4 sm:gap-8">
          <button onClick={() => setIsConnectModalOpen(true)} className="hover:underline">
            Connect Telegram Channel
          </button>
          <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="hover:underline">
            BotFather Setup
          </a>
          <button onClick={() => setActiveTab('search')} className="hover:underline">
            Search Media
          </button>
          <button onClick={() => void handleRefreshFeed()} className="hover:underline">
            Sync Latest Posts
          </button>
        </div>
        <p>© 2026 AMZY — Powered by Telegram API & Bot Protocol.</p>
      </footer>

      {/* Fullscreen Netflix Video Player */}
      {playingItem && (
        <NetflixPlayer
          item={playingItem}
          allChannelItems={currentItems}
          onClose={closeActivePlayer}
          onSelectNextItem={(item) => void handlePlayItem(item)}
          onUpdateProgress={handleUpdateProgress}
          resumePositionSeconds={watchPositionsRef.current[playingItem.id] || 0}
          roomPlaybackStartPositionSeconds={
            roomPlayerStartOptions?.itemId === playingItem.id
              ? roomPlayerStartOptions.startPositionSeconds
              : undefined
          }
          roomPlaybackStartPaused={
            roomPlayerStartOptions?.itemId === playingItem.id
              && roomPlayerStartOptions.startPaused === true
          }
          isWatchRoomGuest={watchRoomSession?.role === 'guest'}
          onLeaveWatchRoom={requestLeaveRoomFromPlayer}
          roomPlaybackNeedsJoin={watchRoomSession?.role === 'guest' && roomPlaybackNeedsJoin}
          roomPlayback={
            watchRoomSession?.role === 'guest' && watchRoomSnapshot?.video?.id === playingItem.id
              ? {
                  revision: watchRoomSnapshot.revision,
                  currentTime: watchRoomSnapshot.currentTime,
                  isPlaying: watchRoomSnapshot.isPlaying,
                }
              : null
          }
          onRoomPlaybackState={handleRoomPlayerState}
          onJoinRoomPlayback={joinRoomPlayback}
        />
      )}

      <WatchRoomPanel
        isOpen={isWatchRoomOpen}
        items={allMediaItems}
        initialRoomCode={roomCodeToRejoin}
        onClose={() => setIsWatchRoomOpen(false)}
        onRoomRemember={rememberWatchRoom}
        onRoomDelete={forgetWatchRoom}
        deleteRoomRequestCode={roomCodeToDelete}
        onDeleteRoomRequestHandled={() => setRoomCodeToDelete(null)}
        leaveRoomRequestCode={roomCodeToLeave}
        onLeaveRoomRequestHandled={() => setRoomCodeToLeave(null)}
        onSessionChange={handleWatchRoomSessionChange}
        onSnapshot={handleWatchRoomSnapshot}
        onSelectVideo={(item) => void handlePlayItem(item)}
      />

      {/* More Info Details Modal */}
      {detailItem && (
        <MediaDetailModal
          item={detailItem}
          relatedItems={currentItems.filter((i) => i.id !== detailItem.id)}
          onClose={() => setDetailItem(null)}
          onPlay={(item) => {
            setDetailItem(null);
            playNetflixTaDum();
            void handlePlayItem(item);
          }}
          onDownload={handleDownloadVideo}
          downloadInfo={downloadedVideos.find((download) => download.id === detailItem.id)}
          isSavedInList={playlistSavedItemIds.includes(detailItem.id)}
          onToggleMyList={handleAddToPlaylist}
        />
      )}

      {playlistPickerItem && (
        <div
          className="safe-area-overlay fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm"
          onClick={() => setPlaylistPickerItem(null)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="playlist-picker-title"
            className="max-h-full w-full max-w-md space-y-4 overflow-y-auto rounded-2xl border border-zinc-700 bg-[#181818] p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="playlist-picker-title" className="text-lg font-bold text-white">Add to playlist</h2>
                <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{playlistPickerItem.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setPlaylistPickerItem(null)}
                aria-label="Close playlist picker"
                className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[55vh] space-y-2 overflow-y-auto">
              {playlists.map((playlist) => {
                const alreadyAdded = playlist.itemIds.includes(playlistPickerItem.id);
                return (
                  <button
                    key={playlist.id}
                    type="button"
                    disabled={alreadyAdded}
                    onClick={() => {
                      addVideoToPlaylist(playlistPickerItem, playlist.id);
                      setPlaylistPickerItem(null);
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-left text-white transition-colors hover:border-zinc-500 disabled:cursor-default disabled:opacity-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{playlist.name}</span>
                      <span className="text-xs text-zinc-400">
                        {playlist.itemIds.length} video{playlist.itemIds.length === 1 ? '' : 's'}
                      </span>
                    </span>
                    {alreadyAdded
                      ? <span className="shrink-0 text-xs text-emerald-400">Already added</span>
                      : <Plus className="h-5 w-5 shrink-0" />}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => {
                setPlaylistPickerItem(null);
                setPendingPlaylistItem(playlistPickerItem);
                setIsCreatingPlaylist(true);
                setSelectedPlaylistId(null);
                setActiveTab('mylist');
              }}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-600 px-4 py-3 text-sm font-semibold text-zinc-200 hover:border-zinc-400 hover:bg-zinc-800"
            >
              <Plus className="h-4 w-4" />
              Create another playlist
            </button>
          </section>
        </div>
      )}

      {/* Connect Channel Modal */}
      <ConnectChannelModal
        isOpen={isConnectModalOpen || onboardingStage === 'channel'}
        initialLink={notificationChannelLink}
        onClose={() => {
          setNotificationChannelLink(null);
          if (onboardingStage === 'channel') {
            finishChannelOnboarding();
          } else {
            setIsConnectModalOpen(false);
          }
        }}
        onChannelsConnected={handleChannelsConnected}
        onChannelHistoryUpdated={handleChannelHistoryUpdated}
        onChannelHistoryError={(error) => showToast(`Poori history load nahi ho saki: ${error.message}`)}
        onChannelHistoryComplete={(channel) => showToast(`${channel.title}: ${channel.items.length} videos load ho gaye`)}
        onChannelBlocked={handleRemoveChannel}
      />

      {onboardingStage === 'login' && (
        <FirstLaunchLoginModal onSkip={finishLoginOnboarding} />
      )}

      {/* Search Modal */}
      <SearchModal
        isOpen={isSearchModalOpen}
        onClose={() => setIsSearchModalOpen(false)}
        items={allMediaItems}
        onPlay={(item) => {
          playNetflixTaDum();
          void handlePlayItem(item);
        }}
        onMoreInfo={(item) => setDetailItem(item)}
      />

      {/* MOBILE AND TABLET APP BAR ONLY (Home, Search, Fevrate, My Profile - Hidden on Desktop) */}
      <MobileTabletAppBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        playlistCount={playlists.length}
      />
      {showLaunchSplash && (
        <div
          className={`amzy-launch-splash ${isLaunchSplashExiting ? 'amzy-launch-splash-exit' : ''}`}
          role="status"
          aria-label="AMZY is starting"
        >
          <div className="amzy-launch-brand">
            <img src="/amzy-logo.png" alt="" className="amzy-launch-logo" />
            <span className="amzy-launch-wordmark">AMZY</span>
            <span className="amzy-launch-progress" />
          </div>
        </div>
      )}
    </div>
  );
}
