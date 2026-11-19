import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  createRemoteJWKSet,
  compactVerify,
  jwtVerify,
  SignJWT,
  type JWTPayload,
} from 'https://esm.sh/jose@6';
import { deduplicateAdminChannelRows } from '../_shared/adminChannelRows.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const botId = Deno.env.get('TELEGRAM_BOT_ID');
const clientId = Deno.env.get('TELEGRAM_CLIENT_ID');
const clientSecret = Deno.env.get('TELEGRAM_CLIENT_SECRET');
const redirectUri = Deno.env.get('TELEGRAM_REDIRECT_URI');
const appRedirectUri = Deno.env.get('APP_REDIRECT_URI');
const sessionSecret = Deno.env.get('SESSION_SECRET');
const frontendUrl = Deno.env.get('FRONTEND_URL');
const additionalFrontendUrls = Deno.env.get('ADDITIONAL_FRONTEND_URLS') ?? '';
const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
const botUsername = Deno.env.get('TELEGRAM_BOT_USERNAME')?.replace(/^@/, '');
const botWebhookSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET');
const issuer = 'https://oauth.telegram.org';
const functionPrefix = '/functions/v1/teleflix-api';
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

const supabase = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  : null;

interface AppUser {
  uid: string;
  displayName: string;
  photoURL: string | null;
  username: string | null;
  phoneNumber: string | null;
  telegramId: string;
}

function json(data: unknown, status = 200, origin = ''): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
    },
  });
}

function corsHeaders(origin: string): Record<string, string> {
  const allowedOrigins = new Set([
    frontendUrl ? new URL(frontendUrl).origin : '',
    supabaseUrl ? new URL(supabaseUrl).origin : '',
    ...additionalFrontendUrls
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean)
      .map((url) => new URL(url).origin),
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
    'http://localhost',
    'https://localhost',
    'capacitor://localhost',
  ]);
  let isLocalDevelopmentOrigin = false;
  try {
    const parsedOrigin = new URL(origin);
    isLocalDevelopmentOrigin = parsedOrigin.protocol === 'http:'
      && ['localhost', '127.0.0.1'].includes(parsedOrigin.hostname);
  } catch {
    isLocalDevelopmentOrigin = false;
  }
  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) || isLocalDevelopmentOrigin ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, content-type, range',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Vary': 'Origin',
  };
}

function extractPublicChannel(input: string): string {
  const value = input.trim();
  if (!value) throw new Error('A Telegram channel link or username is required.');
  if (/^tg:\/\/resolve\?/i.test(value)) {
    const username = new URL(value).searchParams.get('domain');
    if (username) return username.replace(/^@/, '');
  }

  const username = value.replace(/^@/, '');
  if (/^[a-zA-Z0-9_]{5,}$/.test(username)) return username;

  let link: URL;
  try {
    link = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    throw new Error('Enter a Telegram username or a valid t.me channel link.');
  }
  const host = link.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 't.me' && host !== 'telegram.me') {
    throw new Error('Only public t.me or telegram.me channel links are supported.');
  }
  const segments = link.pathname.split('/').filter(Boolean);
  if (segments[0]?.toLowerCase() === 's') segments.shift();
  const channel = segments[0];
  if (!channel || channel.startsWith('+') || channel.toLowerCase() === 'joinchat') {
    throw new Error('Private invite links are not supported. Use a public channel link.');
  }
  if (!/^[a-zA-Z0-9_]{5,}$/.test(channel)) {
    throw new Error('The link does not contain a valid public channel username.');
  }
  return channel;
}

function telegramMediaUrl(request: Request, mediaUrl: string): string {
  const requestUrl = new URL(request.url);
  const routeIndex = requestUrl.pathname.search(/\/(?:auth|user|telegram|watch)\//);
  const functionPath = routeIndex >= 0 ? requestUrl.pathname.slice(0, routeIndex) : '';
  return `${requestUrl.origin}${functionPath}/telegram/proxy-media?url=${encodeURIComponent(mediaUrl)}`;
}

async function fetchPublicChannelFeed(request: Request, input: string, before?: string): Promise<Response> {
  const channelName = extractPublicChannel(input);
  const telegramUrl = new URL(`https://t.me/s/${encodeURIComponent(channelName)}`);
  if (before) telegramUrl.searchParams.set('before', before);
  const response = await fetch(telegramUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    return json({ error: `Telegram could not load @${channelName} (HTTP ${response.status}). Check that it is public and the link is correct.` }, 502, request.headers.get('origin') || '');
  }

  const html = await response.text();
  const nextBefore = html.match(/data-before=["'](\d+)["']/i)?.[1] || '';
  const mediaUrl = (url: string) => telegramMediaUrl(request, url);
  const titleMatch = html.match(/<div class="tgme_channel_info_header_title"[^>]*><span dir="auto">([^<]+)<\/span>/i)
    || html.match(/<meta property="og:title" content="([^"]+)"/i);
  const avatarMatch = html.match(/<img class="tgme_page_photo_image"[^>]*src="([^"]+)"/i)
    || html.match(/<meta property="og:image" content="([^"]+)"/i);
  const descriptionMatch = html.match(/<div class="tgme_channel_info_description"[^>]*>([\s\S]*?)<\/div>/i)
    || html.match(/<meta property="og:description" content="([^"]+)"/i);
  const subscriberMatch = html.match(/<div class="tgme_channel_info_counter"[^>]*><span class="counter_value">([^<]+)<\/span>/i);
  const decodeHtml = (text: string) => text
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
  const cleanText = (text: string) => decodeHtml(text.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[^>]+>/g, '').trim());
  const messageChunks = html.split('<div class="tgme_widget_message_wrap');
  const items: Record<string, unknown>[] = [];

  for (let i = 1; i < messageChunks.length; i++) {
    const chunk = messageChunks[i];
    const postId = chunk.match(/data-post="([^"]+)"/i)?.[1] || `${channelName}/${i}`;
    const videoUrl = chunk.match(/<video[^>]*src="([^"]+)"/i)?.[1] || '';
    const posterUrl = chunk.match(/<video[^>]*poster=["']([^"']+)["']/i)?.[1] || '';
    const photoMatches = Array.from(
      chunk.matchAll(/background-image\s*:\s*url\(["']?([^"')]+)["']?\)/gi),
      match => match[1].replace(/&amp;/gi, '&'),
    );
    const photoUrl = photoMatches[0] || '';
    const rawCaption = chunk.match(/<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '';
    const caption = cleanText(rawCaption);
    if (!videoUrl && !photoUrl && !caption) continue;

    const lowerCaption = caption.toLowerCase();
    const genres = ['Action', 'Drama', 'Cinema', 'Telegram Exclusive', 'Trending', 'Sci-Fi', 'Documentary'];
    const genre = lowerCaption.includes('comedy') || lowerCaption.includes('funny') ? 'Comedy'
      : lowerCaption.includes('trailer') || lowerCaption.includes('teaser') ? 'Trailers'
      : lowerCaption.includes('anime') ? 'Anime'
      : genres[i % genres.length];
    const headline = caption.split('\n').find(Boolean)?.slice(0, 60)
      || `Telegram post ${postId.split('/').pop() || i}`;
    const proxiedPhoto = photoUrl ? mediaUrl(photoUrl) : '';
    const photoSizes = photoUrl
      ? (['s', 'm', 'x', 'y', 'w'] as const).map((type, sizeIndex) => ({
        type,
        label: ['Thumb (100px)', 'Medium (320px)', 'Standard HD (800px)', 'Full HD (1280px)', 'Master 4K (2560px)'][sizeIndex],
        url: proxiedPhoto,
        width: [100, 320, 800, 1280, 2560][sizeIndex],
        height: [100, 320, 800, 1280, 2560][sizeIndex],
      }))
      : undefined;
    items.push({
      id: postId,
      telegramId: postId,
      channel: channelName,
      type: videoUrl ? 'video' : photoUrl ? 'photo' : 'text',
      videoUrl: videoUrl ? mediaUrl(videoUrl) : '',
      rawVideoUrl: videoUrl,
      photoUrl: proxiedPhoto,
      poster: posterUrl ? mediaUrl(posterUrl) : (videoUrl && proxiedPhoto) || proxiedPhoto,
      albumPhotos: photoMatches.length > 1 ? photoMatches.map(mediaUrl) : undefined,
      photoSizes,
      caption,
      title: headline,
      views: cleanText(chunk.match(/<span class="tgme_widget_message_views">([^<]+)<\/span>/i)?.[1] || ''),
      date: chunk.match(/<time[^>]*datetime="([^"]+)"/i)?.[1] || new Date().toISOString(),
      duration: cleanText(chunk.match(/<time class="message_video_duration">([^<]+)<\/time>/i)?.[1] || '0:45'),
      genre,
      matchScore: 90,
      ageRating: '13+',
      resolution: /4k/i.test(caption) ? '4K Ultra HD' : 'HD 720p',
      telegramLink: `https://t.me/${postId}`,
      tags: (caption.match(/#[\p{L}\p{N}_]+/gu) || []).map(tag => tag.slice(1)),
    });
  }

  items.reverse();
  return json({
    channel: {
      username: channelName,
      title: titleMatch ? cleanText(titleMatch[1]) : `@${channelName}`,
      avatar: avatarMatch ? mediaUrl(avatarMatch[1]) : '',
      subscribers: subscriberMatch ? `${cleanText(subscriberMatch[1])} subscribers` : '',
      description: descriptionMatch ? cleanText(descriptionMatch[1]) : '',
      link: `https://t.me/${channelName}`,
    },
    items,
    nextBefore: nextBefore || null,
  }, 200, request.headers.get('origin') || '');
}

async function proxyTelegramMedia(request: Request): Promise<Response> {
  const origin = request.headers.get('origin') || '';
  const mediaUrl = new URL(request.url).searchParams.get('url');
  if (!mediaUrl) return json({ error: 'Missing media URL.' }, 400, origin);

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(mediaUrl);
  } catch {
    return json({ error: 'Invalid media URL.' }, 400, origin);
  }
  const hostname = parsedUrl.hostname.toLowerCase();
  const allowed = ['t.me', 'telegram.org', 'telesco.pe', 'telegram-cdn.org']
    .some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
  if (parsedUrl.protocol !== 'https:' || !allowed) {
    return json({ error: 'Only Telegram media URLs can be proxied.' }, 400, origin);
  }

  const headers = new Headers({
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
    'Referer': 'https://t.me/',
  });
  const range = request.headers.get('range');
  if (range) headers.set('Range', range);
  const response = await fetch(parsedUrl, { headers, signal: AbortSignal.timeout(30000) });
  const responseHeaders = new Headers(corsHeaders(origin));
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const value = response.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set('Cache-Control', 'public, max-age=86400');
  responseHeaders.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  return new Response(response.body, { status: response.status, headers: responseHeaders });
}

function getCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;
  const part = cookieHeader.split(';').find((item) => item.trim().startsWith(`${name}=`));
  return part ? part.trim().slice(name.length + 1) : null;
}

function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=${functionPrefix}/auth/telegram; Max-Age=${maxAge}`;
}

function clearAuthCookies(headers: Headers): void {
  for (const name of ['telegram_oauth_state', 'telegram_oauth_nonce', 'telegram_oauth_verifier', 'telegram_oauth_return_to']) {
    headers.append('Set-Cookie', cookie(name, '', 0));
  }
}

function secret(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not configured in Supabase Edge Function secrets.`);
  return value;
}

function getSupabase() {
  if (!supabase) throw new Error('Supabase service configuration is missing.');
  return supabase;
}

function isAdminEmail(email: string): boolean {
  return (Deno.env.get('ADMIN_SUPABASE_EMAILS') || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

async function getSupabaseAuthEmail(request: Request): Promise<string | null> {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return null;
  const { data, error } = await getSupabase().auth.getUser(authorization.slice(7));
  if (error) {
    if (error.status === 401) return null;
    throw error;
  }
  return data.user?.email?.toLowerCase() || null;
}

const ADMIN_DATASETS = [
  { name: 'users', label: 'Users', select: 'id, uid, email, display_name, photo_url, telegram_id, username, phone_number, created_at, updated_at, channels(count), favorites(count)', orderBy: 'created_at', search: ['uid', 'email', 'display_name', 'username'] },
  { name: 'channels', label: 'Channels', select: 'id, user_id, channel_username, channel_link, title, category, description, telegram_chat_id, telegram_chat_kind, is_public_telegram_chat, created_at', orderBy: 'created_at', search: ['channel_username', 'title', 'category', 'description'] },
  { name: 'favorites', label: 'Favorites', select: 'id, user_id, media_id, title, channel, type, video_url, poster, backdrop, caption, created_at', orderBy: 'created_at', search: ['media_id', 'title', 'channel', 'type', 'caption'] },
  { name: 'announcements', label: 'Announcements', select: 'id, title, message, is_published, created_at', orderBy: 'created_at', search: ['title', 'message'] },
  { name: 'watch_rooms', label: 'Watch rooms', select: 'code, admin_participant_id, status, video, current_time_seconds, is_playing, revision, created_at, expires_at', orderBy: 'created_at', search: ['status'] },
  { name: 'watch_room_participants', label: 'Room participants', select: 'id, room_code, nickname, platform, joined_at, last_seen_at, left_at', orderBy: 'joined_at', search: ['nickname', 'platform'] },
  { name: 'telegram_login_codes', label: 'Telegram login records', select: 'uid, display_name, photo_url, username, phone_number, expires_at, consumed_at, created_at', orderBy: 'created_at', search: ['uid', 'display_name', 'username'] },
  { name: 'native_login_challenges', label: 'Native login challenges', select: 'verified_uid, purpose, expires_at, consumed_at', orderBy: 'expires_at', search: ['verified_uid', 'purpose'] },
  { name: 'device_keys', label: 'Registered devices', select: 'uid, public_key, created_at', orderBy: 'created_at', search: ['uid'] },
  { name: 'rate_limits', label: 'Rate-limit records', select: 'window_start, hits', orderBy: 'window_start', search: [] },
  { name: 'deleted_accounts', label: 'Deleted-account records', select: 'uid, deleted_at, purge_after', orderBy: 'deleted_at', search: ['uid'] },
] as const;

function maskAdminRoomCode(code: string): string {
  return code.length > 4 ? `${code.slice(0, 2)}••••••${code.slice(-2)}` : '••••';
}

function isGeneratedPrivateChannelLink(value: Record<string, unknown>): boolean {
  const username = typeof value.channel_username === 'string'
    ? value.channel_username.trim().replace(/^@/, '').toLowerCase()
    : '';
  const telegramChatId = typeof value.telegram_chat_id === 'string' ? value.telegram_chat_id : '';
  const digits = telegramChatId.replace(/\D/g, '');
  const storedLink = typeof value.channel_link === 'string' ? value.channel_link.trim().toLowerCase() : '';
  return Boolean(digits && username === `private_${digits}` && storedLink === `https://t.me/${username}`);
}

function normalizeAdminTelegramChannelLink(value: string): string | null {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if ((hostname !== 't.me' && hostname !== 'telegram.me') || url.username || url.password) return null;
    return `https://${hostname}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

async function loadAdminChannelRows(
  db: ReturnType<typeof getSupabase>,
  dataset: typeof ADMIN_DATASETS[number],
  search: string,
): Promise<Array<Record<string, unknown>>> {
  const batchSize = 500;
  const rows: Array<Record<string, unknown>> = [];
  let offset = 0;
  let total = 0;

  while (offset === 0 || offset < total) {
    let query = db.from('channels')
      .select(dataset.select, { count: 'exact' })
      .order(dataset.orderBy, { ascending: false });
    if (search && dataset.search.length) {
      query = query.or(dataset.search.map((column) => `${column}.ilike.%${search}%`).join(','));
    }
    const { data, count, error } = await query.range(offset, offset + batchSize - 1);
    if (error) throw error;

    const batch = data || [];
    if (offset === 0) total = count || 0;
    rows.push(...batch.map((row: Record<string, unknown>) => sanitizeAdminDatasetRow('channels', row)));
    offset += batch.length;
    if (batch.length < batchSize) break;
  }

  return deduplicateAdminChannelRows(rows);
}

function getPersonalEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim();
  const normalizedEmail = email.toLowerCase();
  if (
    !email ||
    normalizedEmail.endsWith('@telegram.local') ||
    normalizedEmail === 'user@teleflix.internal'
  ) {
    return null;
  }
  return email;
}

function sanitizeAdminDatasetRow(table: string, value: Record<string, unknown>): Record<string, unknown> {
  if (table === 'users') return { ...value, email: getPersonalEmail(value.email) };
  if (table === 'channels') {
    const storedLink = typeof value.channel_link === 'string' ? value.channel_link.trim() : '';
    const channelLink = isGeneratedPrivateChannelLink(value)
      ? null
      : normalizeAdminTelegramChannelLink(storedLink);
    const safeValue = { ...value };
    delete safeValue.channel_link;
    return {
      ...safeValue,
      channelLink,
    };
  }
  if (table === 'watch_rooms') {
    const video = value.video && typeof value.video === 'object'
      ? value.video as Record<string, unknown>
      : null;
    return {
      ...value,
      code: maskAdminRoomCode(String(value.code || '')),
      video: video ? {
        title: video.title || null,
        channel: video.channel || null,
        type: video.type || null,
      } : null,
    };
  }
  if (table === 'watch_room_participants') {
    return { ...value, room_code: maskAdminRoomCode(String(value.room_code || '')) };
  }
  if (table === 'device_keys') {
    const { public_key: publicKey, ...safeValue } = value;
    return { ...safeValue, publicKeyConfigured: Boolean(publicKey) };
  }
  return value;
}

async function handleAdminRoute(
  request: Request,
  path: string,
  url: URL,
  origin: string,
): Promise<Response> {
  const email = await getSupabaseAuthEmail(request);
  if (!email) return json({ error: 'Supabase Auth sign-in is required.' }, 401, origin);
  if (!isAdminEmail(email)) return json({ error: 'Admin access is not enabled for this email.' }, 403, origin);
  const db = getSupabase();

  if (path === '/admin/settings/telegram-api' && request.method === 'GET') {
    const { data, error } = await db.from('telegram_runtime_config')
      .select('updated_at')
      .eq('id', true)
      .maybeSingle();
    if (error) throw error;
    return json({
      configured: Boolean(data),
      updatedAt: data?.updated_at || null,
    }, 200, origin);
  }

  if (path === '/admin/settings/telegram-api' && request.method === 'PATCH') {
    const body = await request.json().catch(() => null);
    const apiId = body && typeof body.apiId === 'number' ? body.apiId : 0;
    const apiHash = body && typeof body.apiHash === 'string' ? body.apiHash.trim() : '';
    if (!Number.isSafeInteger(apiId) || apiId <= 0 || !/^[a-f0-9]{32}$/i.test(apiHash)) {
      return json({ error: 'Enter a valid Telegram API ID and 32-character API hash.' }, 400, origin);
    }

    const updatedAt = new Date().toISOString();
    const { error } = await db.from('telegram_runtime_config').upsert({
      id: true,
      api_id: apiId,
      api_hash: apiHash,
      updated_at: updatedAt,
    }, { onConflict: 'id' });
    if (error) throw error;
    return json({ success: true, configured: true, updatedAt }, 200, origin);
  }

  if (path === '/admin/data' && request.method === 'GET') {
    const table = url.searchParams.get('table') || '';
    if (!table) {
      const tables = await Promise.all(ADMIN_DATASETS.map(async (dataset) => {
        if (dataset.name === 'channels') {
          const channels = await loadAdminChannelRows(db, dataset, '');
          return { name: dataset.name, label: dataset.label, count: channels.length };
        }
        const { count, error } = await db.from(dataset.name).select('*', { count: 'exact', head: true });
        if (error) throw error;
        return { name: dataset.name, label: dataset.label, count: count || 0 };
      }));
      return json({ tables }, 200, origin);
    }

    const dataset = ADMIN_DATASETS.find((item) => item.name === table);
    if (!dataset) return json({ error: 'Unknown Supabase data table.' }, 400, origin);
    const requestedPage = Number(url.searchParams.get('page'));
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? Math.min(requestedPage, 100000)
      : 1;
    const requestedPageSize = Number(url.searchParams.get('pageSize'));
    const pageSize = Number.isSafeInteger(requestedPageSize) && requestedPageSize > 0
      ? Math.min(requestedPageSize, 50)
      : 20;
    const search = (url.searchParams.get('search') || '')
      .trim()
      .slice(0, 100)
      .replace(/[^a-zA-Z0-9@._+\- ]/g, '')
      .trim();
    let rows: Array<Record<string, unknown>>;
    let count: number;
    if (table === 'channels') {
      const channels = await loadAdminChannelRows(db, dataset, search);
      count = channels.length;
      rows = channels.slice((page - 1) * pageSize, page * pageSize);
    } else {
      let query = db.from(dataset.name)
        .select(dataset.select, { count: 'exact' })
        .order(dataset.orderBy, { ascending: false });
      if (search && dataset.search.length) {
        query = query.or(dataset.search.map((column) => `${column}.ilike.%${search}%`).join(','));
      }
      const result = await query.range((page - 1) * pageSize, page * pageSize - 1);
      if (result.error) throw result.error;
      count = result.count || 0;
      rows = (result.data || []).map((row: Record<string, unknown>) => sanitizeAdminDatasetRow(table, row));
    }
    const columns = rows.length
      ? Object.keys(rows[0])
      : dataset.select.split(',')
        .map((column) => column.trim().replace(/\(count\)$/, ''))
        .filter((column) => column !== 'public_key');
    if (!rows.length && table === 'channels') {
      const userIdIndex = columns.indexOf('user_id');
      if (userIdIndex !== -1) columns.splice(userIdIndex, 1, 'userIds', 'userCount');
      const channelLinkIndex = columns.indexOf('channel_link');
      if (channelLinkIndex !== -1) columns[channelLinkIndex] = 'channelLink';
    }
    if (!rows.length && table === 'device_keys') columns.push('publicKeyConfigured');
    return json({
      table: dataset.name,
      label: dataset.label,
      total: count,
      page,
      pageSize,
      columns,
      rows,
    }, 200, origin);
  }

  if (path === '/admin/users' && request.method === 'GET') {
    const requestedPage = Number(url.searchParams.get('page'));
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? Math.min(requestedPage, 100000)
      : 1;
    const requestedPageSize = Number(url.searchParams.get('pageSize'));
    const pageSize = Number.isSafeInteger(requestedPageSize) && requestedPageSize > 0
      ? Math.min(requestedPageSize, 50)
      : 20;
    const search = (url.searchParams.get('search') || '')
      .trim()
      .slice(0, 100)
      .replace(/[^a-zA-Z0-9@._+\- ]/g, '')
      .trim();
    let query = db.from('users')
      .select(
        'id, uid, email, display_name, photo_url, telegram_id, username, phone_number, created_at, channels(count), favorites(count)',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false });
    if (search) {
      query = query.or([
        `uid.ilike.%${search}%`,
        `email.ilike.%${search}%`,
        `display_name.ilike.%${search}%`,
        `username.ilike.%${search}%`,
      ].join(','));
    }
    const { data, count, error } = await query.range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw error;
    const users = (data || []).map((row: Record<string, unknown>) => {
      const channels = Array.isArray(row.channels) ? row.channels as Array<{ count?: number }> : [];
      const favorites = Array.isArray(row.favorites) ? row.favorites as Array<{ count?: number }> : [];
      return {
        id: row.id,
        uid: row.uid,
        email: getPersonalEmail(row.email),
        displayName: row.display_name,
        photoUrl: row.photo_url,
        telegramId: row.telegram_id,
        username: row.username,
        phoneNumber: row.phone_number,
        createdAt: row.created_at,
        channelCount: channels[0]?.count || 0,
        favoriteCount: favorites[0]?.count || 0,
      };
    });
    return json({ users, total: count || 0, page, pageSize }, 200, origin);
  }

  const userChannelsMatch = path.match(/^\/admin\/users\/(\d+)\/channels$/);
  if (userChannelsMatch && request.method === 'GET') {
    const userId = Number(userChannelsMatch[1]);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return json({ error: 'Invalid user ID.' }, 400, origin);
    }
    const { data, error } = await db.from('channels')
      .select('id, channel_username, channel_link, title, telegram_chat_id, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const channels = (data || []).map((row: Record<string, unknown>) => {
      const safeRow = sanitizeAdminDatasetRow('channels', row);
      return {
        id: row.id,
        title: row.title,
        channelUsername: row.channel_username,
        channelLink: safeRow.channelLink,
        createdAt: row.created_at,
      };
    });
    return json({ channels }, 200, origin);
  }

  if (path === '/admin/notifications' && request.method === 'GET') {
    const { data, error } = await db.from('announcements')
      .select('id, title, message, is_published, created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return json({
      notifications: (data || []).map((item: Record<string, unknown>) => ({
        id: item.id,
        title: item.title,
        message: item.message,
        isPublished: item.is_published,
        createdAt: item.created_at,
      })),
    }, 200, origin);
  }

  if (path === '/admin/notifications' && request.method === 'POST') {
    const body = await request.json().catch(() => null);
    const title = body && typeof body.title === 'string' ? body.title.trim() : '';
    const message = body && typeof body.message === 'string' ? body.message.trim() : '';
    if (!title || title.length > 120 || !message || message.length > 2000) {
      return json({ error: 'Title (1–120 characters) and message (1–2000 characters) are required.' }, 400, origin);
    }
    const { data, error } = await db.from('announcements')
      .insert({ title, message, is_published: true })
      .select('id, title, message, is_published, created_at')
      .single();
    if (error) throw error;
    return json({
      notification: {
        id: data.id,
        title: data.title,
        message: data.message,
        isPublished: data.is_published,
        createdAt: data.created_at,
      },
    }, 201, origin);
  }

  const notificationMatch = path.match(/^\/admin\/notifications\/([0-9a-f-]+)$/i);
  if (notificationMatch && (request.method === 'PATCH' || request.method === 'DELETE')) {
    const id = notificationMatch[1];
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return json({ error: 'Notification ID is invalid.' }, 400, origin);
    }

    if (request.method === 'PATCH') {
      const body = await request.json().catch(() => null);
      const title = body && typeof body.title === 'string' ? body.title.trim() : '';
      const message = body && typeof body.message === 'string' ? body.message.trim() : '';
      if (!title || title.length > 120 || !message || message.length > 2000) {
        return json({ error: 'Title (1–120 characters) and message (1–2000 characters) are required.' }, 400, origin);
      }

      const { data, error } = await db.from('announcements')
        .update({ title, message })
        .eq('id', id)
        .select('id, title, message, is_published, created_at')
        .maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: 'Notification not found.' }, 404, origin);
      return json({
        notification: {
          id: data.id,
          title: data.title,
          message: data.message,
          isPublished: data.is_published,
          createdAt: data.created_at,
        },
      }, 200, origin);
    }

    const { data, error } = await db.from('announcements')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) return json({ error: 'Notification not found.' }, 404, origin);
    return json({ success: true }, 200, origin);
  }

  return json({ error: 'Not found' }, 404, origin);
}

function requireTelegramConfig() {
  const configuredBotId = secret('TELEGRAM_BOT_ID', botId);
  if (!/^\d+$/.test(configuredBotId)) throw new Error('TELEGRAM_BOT_ID must be numeric.');
  const configuredRedirect = secret('TELEGRAM_REDIRECT_URI', redirectUri);
  const configuredFrontend = secret('FRONTEND_URL', frontendUrl);
  const configuredAppRedirect = secret('APP_REDIRECT_URI', appRedirectUri);
  const parsedFrontend = new URL(configuredFrontend);
  if (parsedFrontend.protocol !== 'https:' && parsedFrontend.hostname !== 'localhost') {
    throw new Error('FRONTEND_URL must use HTTPS.');
  }
  const parsedRedirect = new URL(configuredRedirect);
  if (parsedRedirect.protocol !== 'https:') throw new Error('Telegram callback URL must use HTTPS.');
  const parsedAppRedirect = new URL(configuredAppRedirect);
  if (parsedAppRedirect.protocol !== 'amzy:' || parsedAppRedirect.hostname !== 'auth') {
    throw new Error('APP_REDIRECT_URI must be amzy://auth.');
  }
  return {
    botId: configuredBotId,
    clientId: secret('TELEGRAM_CLIENT_ID', clientId),
    clientSecret: secret('TELEGRAM_CLIENT_SECRET', clientSecret),
    redirectUri: configuredRedirect,
    frontendUrl: configuredFrontend,
    appRedirectUri: configuredAppRedirect,
  };
}

function getAllowedReturnTarget(value: string | null, config: ReturnType<typeof requireTelegramConfig>): string {
  if (!value) return config.appRedirectUri;
  if (value === config.appRedirectUri) return value;

  const target = new URL(value);
  const allowedOrigins = new Set([
    new URL(config.frontendUrl).origin,
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
  ]);
  const isLocalDevelopmentOrigin = target.protocol === 'http:'
    && ['localhost', '127.0.0.1'].includes(target.hostname);
  if (
    (!allowedOrigins.has(target.origin) && !isLocalDevelopmentOrigin) ||
    target.pathname !== '/' ||
    target.search ||
    target.hash
  ) {
    throw new Error('Telegram login return URL is not allowed.');
  }
  return target.origin;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

type WatchRoomRole = 'admin' | 'guest';
type WatchRoomPlatform = 'android' | 'browser';

interface WatchRoomIdentity {
  id: string;
  code: string;
  role: WatchRoomRole;
}

function getWatchRoomPlatform(origin: string): WatchRoomPlatform {
  if (!origin) return 'browser';
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'capacitor:'
      || (
        ['localhost', '127.0.0.1'].includes(parsed.hostname)
        && parsed.port === ''
      )
      ? 'android'
      : 'browser';
  } catch {
    return 'browser';
  }
}

function validateNickname(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter a nickname to join the room.');
  const nickname = value.trim();
  if (nickname.length < 1 || nickname.length > 32) {
    throw new Error('Nickname must be between 1 and 32 characters.');
  }
  return nickname;
}

function createRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const values = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(values, (value) => alphabet[value & 31]).join('');
}

function createRoomToken(identity: WatchRoomIdentity): Promise<string> {
  const key = new TextEncoder().encode(secret('SESSION_SECRET', sessionSecret));
  if (key.byteLength < 32) throw new Error('SESSION_SECRET must contain at least 32 bytes.');
  return new SignJWT({ room_code: identity.code })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('teleflix-watch-room')
    .setAudience('teleflix-watch-room')
    .setSubject(identity.id)
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(key);
}

async function getWatchRoomIdentity(request: Request, code: string): Promise<WatchRoomIdentity | null> {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return null;
  const key = new TextEncoder().encode(secret('SESSION_SECRET', sessionSecret));
  if (key.byteLength < 32) throw new Error('SESSION_SECRET must contain at least 32 bytes.');
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(authorization.slice(7), key, {
      issuer: 'teleflix-watch-room',
      audience: 'teleflix-watch-room',
    }));
  } catch {
    return null;
  }

  if (typeof payload.sub !== 'string' || payload.room_code !== code) return null;
  const { data: room, error: roomError } = await getSupabase().from('watch_rooms')
    .select('admin_participant_id')
    .eq('code', code)
    .maybeSingle();
  if (roomError) throw roomError;
  if (!room) return null;

  const { data: participant, error: participantError } = await getSupabase()
    .from('watch_room_participants')
    .select('id')
    .eq('id', payload.sub)
    .eq('room_code', code)
    .is('left_at', null)
    .maybeSingle();
  if (participantError) throw participantError;
  if (!participant) return null;

  return {
    id: payload.sub,
    code,
    role: room.admin_participant_id === payload.sub ? 'admin' : 'guest',
  };
}

function sanitizeRoomVideo(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Choose a video to play in the room.');
  }
  const item = value as Record<string, unknown>;
  if (
    item.type !== 'video'
    || typeof item.id !== 'string'
    || !item.id
    || item.id.length > 200
    || typeof item.title !== 'string'
    || !item.title.trim()
    || item.title.length > 200
  ) {
    throw new Error('The selected video is invalid.');
  }

  const safeUrl = (candidate: unknown): string | undefined => {
    if (typeof candidate !== 'string' || !candidate) return undefined;
    if (candidate.length > 4096) throw new Error('The video link is too long.');
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      throw new Error('Room videos must have a shareable HTTPS link.');
    }
    if (url.protocol !== 'https:') throw new Error('Room video links must use HTTPS.');
    return url.toString();
  };

  const videoUrl = safeUrl(item.videoUrl);
  const rawVideoUrl = safeUrl(item.rawVideoUrl);
  const telegramChatId = typeof item.telegramChatId === 'string' && item.telegramChatId.length <= 100
    ? item.telegramChatId
    : undefined;
  const telegramId = typeof item.telegramId === 'string' && item.telegramId.length <= 100
    ? item.telegramId
    : undefined;
  if (!videoUrl && !rawVideoUrl && (!telegramChatId || !telegramId)) {
    throw new Error('This video cannot be shared with room participants.');
  }

  return {
    id: item.id,
    type: 'video',
    title: item.title.trim(),
    channel: typeof item.channel === 'string' ? item.channel.slice(0, 120) : '',
    caption: typeof item.caption === 'string' ? item.caption.slice(0, 4000) : '',
    duration: typeof item.duration === 'string' ? item.duration.slice(0, 40) : '',
    videoUrl,
    rawVideoUrl,
    poster: typeof item.poster === 'string' && item.poster.startsWith('https://')
      ? safeUrl(item.poster)
      : undefined,
    telegramLink: typeof item.telegramLink === 'string' && item.telegramLink.startsWith('https://')
      ? safeUrl(item.telegramLink)
      : undefined,
    telegramChatId,
    telegramId,
    telegramMimeType: typeof item.telegramMimeType === 'string'
      ? item.telegramMimeType.slice(0, 100)
      : undefined,
    telegramSupportsStreaming: item.telegramSupportsStreaming === true,
    telegramFileSize: typeof item.telegramFileSize === 'number'
      && Number.isFinite(item.telegramFileSize)
      && item.telegramFileSize >= 0
      ? item.telegramFileSize
      : undefined,
  };
}

async function watchRoomSnapshot(code: string): Promise<Record<string, unknown> | null> {
  const db = getSupabase();
  const { data: room, error: roomError } = await db.from('watch_rooms')
    .select('code, admin_participant_id, status, video, current_time_seconds, is_playing, revision, expires_at')
    .eq('code', code)
    .maybeSingle();
  if (roomError) throw roomError;
  if (!room) return null;

  if (room.status !== 'active' || new Date(room.expires_at).getTime() <= Date.now()) {
    if (room.status === 'active') {
      const { error } = await db.from('watch_rooms').update({ status: 'closed' }).eq('code', code);
      if (error) throw error;
    }
    return {
      code,
      status: 'closed',
      adminParticipantId: room.admin_participant_id,
      participants: [],
      video: null,
      currentTime: 0,
      isPlaying: false,
      revision: Number(room.revision),
    };
  }

  const { data: participants, error: participantsError } = await db.from('watch_room_participants')
    .select('id, nickname, platform')
    .eq('room_code', code)
    .is('left_at', null)
    .gt('last_seen_at', new Date(Date.now() - 45000).toISOString())
    .order('joined_at', { ascending: true });
  if (participantsError) throw participantsError;
  return {
    code: room.code,
    status: room.status,
    adminParticipantId: room.admin_participant_id,
    participants: (participants || []).map((participant: Record<string, unknown>) => ({
      id: participant.id,
      nickname: participant.nickname,
      role: participant.id === room.admin_participant_id ? 'admin' : 'guest',
      platform: participant.platform,
    })),
    video: room.video,
    currentTime: Number(room.current_time_seconds) || 0,
    isPlaying: room.is_playing === true,
    revision: Number(room.revision) || 0,
  };
}

function watchRoomErrorResponse(error: unknown, origin: string): Response {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
      ? error.message
      : 'Watch room request failed.';
  if (/between 1 and 32|nickname|invalid|choose a video|video link|shareable|HTTPS/i.test(message)) {
    return json({ error: message }, 400, origin);
  }
  if (/10 active participants|already has 10/i.test(message)) {
    return json({ error: 'This room already has 10 active participants.' }, 409, origin);
  }
  if (/Android-only|only include Android/i.test(message)) {
    return json({ error: 'Private Telegram video rooms can only include Android participants.' }, 403, origin);
  }
  if (/closed|expired/i.test(message)) return json({ error: 'This room is closed or expired.' }, 410, origin);
  if (/Only the (current )?room admin/i.test(message)) return json({ error: message }, 403, origin);
  if (/Choose another active room participant/i.test(message)) return json({ error: message }, 400, origin);
  console.error('Watch room request failed:', error);
  return json({ error: 'The watch room request failed.' }, 500, origin);
}

async function handleWatchRoomRoute(
  request: Request,
  path: string,
  origin: string,
): Promise<Response | null> {
  if (!path.startsWith('/watch/')) return null;
  const db = getSupabase();

  if (path === '/watch/rooms' && request.method === 'POST') {
    try {
      const body = await request.json();
      const nickname = validateNickname(body.nickname);
      const code = createRoomCode();
      const participantId = crypto.randomUUID();
      const platform = getWatchRoomPlatform(origin);
      const { error: roomError } = await db.from('watch_rooms').insert({
        code,
        admin_participant_id: participantId,
      });
      if (roomError) throw roomError;

      const { error: participantError } = await db.from('watch_room_participants').insert({
        id: participantId,
        room_code: code,
        nickname,
        platform,
      });
      if (participantError) {
        await db.from('watch_rooms').delete().eq('code', code);
        throw participantError;
      }

      const identity: WatchRoomIdentity = { id: participantId, code, role: 'admin' };
      const [token, snapshot] = await Promise.all([
        createRoomToken(identity),
        watchRoomSnapshot(code),
      ]);
      if (!snapshot) throw new Error('The new room could not be loaded.');
      return json({
        session: { code, participantId, role: identity.role, nickname, token },
        snapshot,
      }, 201, origin);
    } catch (error) {
      return watchRoomErrorResponse(error, origin);
    }
  }

  const joinMatch = path.match(/^\/watch\/rooms\/([A-Z2-9]{10})\/join$/);
  if (joinMatch && request.method === 'POST') {
    try {
      const body = await request.json();
      const nickname = validateNickname(body.nickname);
      const code = joinMatch[1];
      const participantId = crypto.randomUUID();
      const platform = getWatchRoomPlatform(origin);
      const { error } = await db.rpc('join_watch_room', {
        p_code: code,
        p_participant_id: participantId,
        p_nickname: nickname,
        p_platform: platform,
      });
      if (error) throw error;

      const { data: room, error: roomError } = await db.from('watch_rooms')
        .select('admin_participant_id')
        .eq('code', code)
        .single();
      if (roomError) throw roomError;
      const identity: WatchRoomIdentity = {
        id: participantId,
        code,
        role: room.admin_participant_id === participantId ? 'admin' : 'guest',
      };
      const [token, snapshot] = await Promise.all([
        createRoomToken(identity),
        watchRoomSnapshot(code),
      ]);
      if (!snapshot) throw new Error('The room could not be loaded.');
      return json({
        session: { code, participantId, role: identity.role, nickname, token },
        snapshot,
      }, 200, origin);
    } catch (error) {
      return watchRoomErrorResponse(error, origin);
    }
  }

  const roomMatch = path.match(/^\/watch\/rooms\/([A-Z2-9]{10})$/);
  if (roomMatch && request.method === 'GET') {
    const code = roomMatch[1];
    const identity = await getWatchRoomIdentity(request, code);
    if (!identity) return json({ error: 'This room session is invalid. Rejoin the room.' }, 401, origin);
    try {
      const { error } = await db.from('watch_room_participants')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', identity.id)
        .eq('room_code', code);
      if (error) throw error;
      const snapshot = await watchRoomSnapshot(code);
      if (!snapshot) return json({ error: 'Room not found.' }, 404, origin);
      return json(snapshot, 200, origin);
    } catch (error) {
      return watchRoomErrorResponse(error, origin);
    }
  }

  const playbackMatch = path.match(/^\/watch\/rooms\/([A-Z2-9]{10})\/playback$/);
  if (playbackMatch && request.method === 'POST') {
    const code = playbackMatch[1];
    const identity = await getWatchRoomIdentity(request, code);
    if (!identity) return json({ error: 'This room session is invalid. Rejoin the room.' }, 401, origin);
    if (identity.role !== 'admin') {
      return json({ error: 'Only the room admin can control playback.' }, 403, origin);
    }
    try {
      const body = await request.json();
      const video = sanitizeRoomVideo(body.video);
      const currentTime = Number(body.currentTime);
      if (!Number.isFinite(currentTime) || currentTime < 0 || currentTime > 604800) {
        return json({ error: 'The playback position is invalid.' }, 400, origin);
      }
      if (typeof body.isPlaying !== 'boolean') {
        return json({ error: 'The playback state is invalid.' }, 400, origin);
      }
      const { error } = await db.rpc('set_watch_room_playback', {
        p_code: code,
        p_participant_id: identity.id,
        p_video: video,
        p_current_time: currentTime,
        p_is_playing: body.isPlaying,
      });
      if (error) throw error;
      await db.from('watch_room_participants')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', identity.id)
        .eq('room_code', code);
      const snapshot = await watchRoomSnapshot(code);
      if (!snapshot) return json({ error: 'Room not found.' }, 404, origin);
      return json(snapshot, 200, origin);
    } catch (error) {
      return watchRoomErrorResponse(error, origin);
    }
  }

  const leaveMatch = path.match(/^\/watch\/rooms\/([A-Z2-9]{10})\/leave$/);
  if (leaveMatch && request.method === 'POST') {
    const code = leaveMatch[1];
    const identity = await getWatchRoomIdentity(request, code);
    if (!identity) return json({ error: 'This room session is invalid. Rejoin the room.' }, 401, origin);
    try {
      const { error } = await db.rpc('leave_watch_room', {
        p_code: code,
        p_participant_id: identity.id,
      });
      if (error) throw error;
      return json({ success: true }, 200, origin);
    } catch (error) {
      return watchRoomErrorResponse(error, origin);
    }
  }

  const deleteMatch = path.match(/^\/watch\/rooms\/([A-Z2-9]{10})$/);
  if (deleteMatch && request.method === 'DELETE') {
    const code = deleteMatch[1];
    const identity = await getWatchRoomIdentity(request, code);
    if (!identity) return json({ error: 'This room session is invalid. Rejoin the room.' }, 401, origin);
    if (identity.role !== 'admin') {
      return json({ error: 'Only the room admin can delete this room.' }, 403, origin);
    }
    try {
      const { error } = await db.rpc('delete_watch_room', {
        p_code: code,
        p_admin_participant_id: identity.id,
      });
      if (error) throw error;
      return json({ success: true }, 200, origin);
    } catch (error) {
      return watchRoomErrorResponse(error, origin);
    }
  }

  const transferAdminMatch = path.match(/^\/watch\/rooms\/([A-Z2-9]{10})\/transfer-admin$/);
  if (transferAdminMatch && request.method === 'POST') {
    const code = transferAdminMatch[1];
    const identity = await getWatchRoomIdentity(request, code);
    if (!identity) return json({ error: 'This room session is invalid. Rejoin the room.' }, 401, origin);
    if (identity.role !== 'admin') {
      return json({ error: 'Only the current room admin can transfer admin control.' }, 403, origin);
    }
    try {
      const body = await request.json();
      if (typeof body.participantId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.participantId)) {
        return json({ error: 'Choose a valid room participant.' }, 400, origin);
      }
      const { error } = await db.rpc('transfer_watch_room_admin', {
        p_code: code,
        p_current_admin_id: identity.id,
        p_new_admin_id: body.participantId,
      });
      if (error) throw error;
      const { error: heartbeatError } = await db.from('watch_room_participants')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', identity.id)
        .eq('room_code', code);
      if (heartbeatError) throw heartbeatError;
      const snapshot = await watchRoomSnapshot(code);
      if (!snapshot) return json({ error: 'Room not found.' }, 404, origin);
      return json(snapshot, 200, origin);
    } catch (error) {
      return watchRoomErrorResponse(error, origin);
    }
  }

  return null;
}

async function createSessionToken(user: AppUser): Promise<string> {
  const key = new TextEncoder().encode(secret('SESSION_SECRET', sessionSecret));
  if (key.byteLength < 32) throw new Error('SESSION_SECRET must contain at least 32 bytes.');
  let issuedAt = Math.floor(Date.now() / 1000);
  const { data: deletion, error: deletionError } = await getSupabase()
    .from('deleted_accounts')
    .select('deleted_at')
    .eq('uid', user.uid)
    .gt('purge_after', new Date().toISOString())
    .maybeSingle();
  if (deletionError) throw deletionError;
  if (deletion) issuedAt = Math.max(issuedAt, Math.floor(Date.parse(deletion.deleted_at) / 1000) + 1);
  return await new SignJWT({
    name: user.displayName,
    picture: user.photoURL,
    username: user.username,
    phone_number: user.phoneNumber,
    telegram_id: user.telegramId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('teleflix-api')
    .setAudience('teleflix')
    .setSubject(user.uid)
    .setIssuedAt(issuedAt)
    .setExpirationTime('7d')
    .sign(key);
}

async function getAuthenticatedUser(request: Request): Promise<AppUser | null> {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return null;
  const key = new TextEncoder().encode(secret('SESSION_SECRET', sessionSecret));
  if (key.byteLength < 32) throw new Error('SESSION_SECRET must contain at least 32 bytes.');
  try {
    const { payload } = await jwtVerify(authorization.slice(7), key, {
      issuer: 'teleflix-api',
      audience: 'teleflix',
    });
    if (typeof payload.sub !== 'string') return null;
    const { data: deletion, error: deletionError } = await getSupabase()
      .from('deleted_accounts')
      .select('deleted_at')
      .eq('uid', payload.sub)
      .gt('purge_after', new Date().toISOString())
      .maybeSingle();
    if (deletionError) throw deletionError;
    if (deletion && (typeof payload.iat !== 'number' || payload.iat <= Math.floor(Date.parse(deletion.deleted_at) / 1000))) {
      return null;
    }
    const { data: account, error: accountError } = await getSupabase()
      .from('users')
      .select('uid')
      .eq('uid', payload.sub)
      .maybeSingle();
    if (accountError) throw accountError;
    if (!account) return null;
    return {
      uid: payload.sub,
      displayName: typeof payload.name === 'string' ? payload.name : 'Telegram user',
      photoURL: typeof payload.picture === 'string' ? payload.picture : null,
      username: typeof payload.username === 'string' ? payload.username : null,
      phoneNumber: typeof payload.phone_number === 'string' ? payload.phone_number : null,
      telegramId: typeof payload.telegram_id === 'string'
        ? payload.telegram_id
        : payload.sub.replace(/^telegram:/, ''),
    };
  } catch {
    return null;
  }
}

async function isDeletedAccountSession(request: Request): Promise<boolean> {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return false;
  const key = new TextEncoder().encode(secret('SESSION_SECRET', sessionSecret));
  if (key.byteLength < 32) throw new Error('SESSION_SECRET must contain at least 32 bytes.');
  let payload: JWTPayload;
  try {
    const { payload: verifiedPayload, protectedHeader } = await compactVerify(authorization.slice(7), key);
    if (protectedHeader.alg !== 'HS256') return false;
    payload = JSON.parse(new TextDecoder().decode(verifiedPayload)) as JWTPayload;
  } catch {
    return false;
  }
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== 'teleflix-api' || !audiences.includes('teleflix') || typeof payload.sub !== 'string') {
    return false;
  }
  const { data, error } = await getSupabase()
    .from('deleted_accounts')
    .select('deleted_at')
    .eq('uid', payload.sub)
    .gt('purge_after', new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  return Boolean(data && typeof payload.iat === 'number'
    && payload.iat <= Math.floor(Date.parse(data.deleted_at) / 1000));
}

async function deleteCloudAccount(db: ReturnType<typeof getSupabase>, uid: string): Promise<void> {
  const { error } = await db.rpc('delete_amzy_cloud_account', { p_uid: uid });
  if (error) throw error;
}

function htmlResponse(content: string): Response {
  return new Response(content, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function privacyPolicyPage(): Response {
  return htmlResponse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AMZY Privacy Policy</title>
<style>body{margin:0;background:#111;color:#e5e7eb;font:16px/1.65 system-ui,sans-serif}main{max-width:820px;margin:auto;padding:32px 22px 64px}h1,h2{color:#fff;line-height:1.2}h1{font-size:2rem}h2{font-size:1.2rem;margin-top:30px}a{color:#7dd3fc}small{color:#a1a1aa}.links{display:flex;gap:18px;flex-wrap:wrap}</style></head>
<body><main><h1>AMZY Privacy Policy</h1><p><small>Effective date: November 2, 2026</small></p>
<p>AMZY is operated by Chakraborty Compliance. This policy explains what the AMZY Android app and website process when you use Telegram sign-in, cloud sync, channel lists, favorites, video playback, and Watch Rooms.</p>
<h2>Information we process</h2><p>When you enable cloud sync, we receive your Telegram account identifier, display name, username, profile-photo URL, and phone number when available. We store connected Telegram group/channel references and favorites you choose to sync, including their Telegram IDs and related title, channel, caption, poster, backdrop, or media URL fields when supplied. A device public key is stored to validate native sign-in; its private key remains in Android Keystore.</p>
<p>Telegram phone-login codes, two-step verification passwords, the TDLib authorization database, and private Telegram media credentials are handled on your device and are not sent to AMZY's Supabase database. The native cloud-session token is held in the app's private Android preferences. App preferences, watch progress, download files, and local history are stored on your device.</p>
<p>Watch Rooms may process room codes, nicknames, platform type, shared video metadata, playback position, and participant activity timestamps. Room membership does not grant Telegram access. Server requests also expose an IP address, which is used for abuse prevention and rate limiting; stale rate-limit counters are periodically removed.</p>
<h2>How information is used and shared</h2><p>Supabase hosts account and sync data and processes API requests for AMZY. Telegram provides sign-in verification, group/channel information, and video/media delivery. We do not sell personal information. The current app build does not include advertising or analytics SDKs.</p>
<h2>Retention and deletion</h2><p>Cloud account data is retained while the account is active. You can delete it in the app's Profile screen or use the independent <a href="./delete-account">AMZY account deletion page</a>. Deleting a cloud account removes its profile, saved channels, favorites, playlists, device key, and pending verification records. Existing AMZY session tokens stop working after the account record is deleted. Watch Rooms expire after their stated lifetime. Deleting cloud data does not erase Telegram's own records or local downloads/TDLib data; remove local app data or uninstall AMZY to clear those from your device.</p>
<h2>Security and children</h2><p>Requests use HTTPS. Native account login remains on-device; cloud sync is enabled only after a Telegram bot challenge. AMZY is not designed for children and may display content from Telegram channels selected by the user.</p>
<h2>Contact</h2><p>For privacy questions or requests, contact <a href="mailto:service@chakrabortycompliance.in">service@chakrabortycompliance.in</a>.</p>
<p class="links"><a href="./delete-account">Delete an AMZY account</a><a href="https://telegram.org/privacy">Telegram Privacy Policy</a></p></main></body></html>`);
}

function accountDeletionPage(): Response {
  return htmlResponse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Delete AMZY account</title>
<style>body{margin:0;background:#111;color:#e5e7eb;font:16px/1.6 system-ui,sans-serif}main{max-width:620px;margin:12vh auto;padding:28px 22px;background:#1a1a1a;border:1px solid #3f3f46;border-radius:14px}h1{color:#fff;line-height:1.2}button,a.action{display:inline-block;background:#e50914;color:#fff;border:0;border-radius:8px;padding:12px 16px;font-weight:700;text-decoration:none;cursor:pointer}button:disabled{opacity:.55}#status{min-height:3em;color:#a1a1aa}a{color:#7dd3fc}</style></head>
<body><main><h1>Delete your AMZY cloud account</h1><p>This securely verifies the Telegram account linked to your AMZY cloud data, then deletes the cloud profile, saved channels, favorites, playlists, device key, and pending verification data. It does not delete your Telegram account or erase local AMZY downloads/Telegram data on a device.</p><button id="start">Verify and delete account</button><p id="status" role="status" aria-live="polite">You will confirm ownership by starting a one-time Telegram bot link.</p><p><a href="./privacy">Privacy Policy</a> · <a href="mailto:service@chakrabortycompliance.in">Contact support</a></p></main>
<script>
const button=document.getElementById('start');const status=document.getElementById('status');const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
button.addEventListener('click',async()=>{button.disabled=true;status.textContent='Creating a secure verification link…';try{const challengeResponse=await fetch('./auth/native/challenge');const challengeData=await challengeResponse.json();if(!challengeResponse.ok||!challengeData.challenge||!challengeData.botUsername)throw new Error(challengeData.error||'Could not create a verification link.');const link=document.createElement('a');link.className='action';link.target='_blank';link.rel='noopener';link.href='https://t.me/'+encodeURIComponent(challengeData.botUsername)+'?start='+encodeURIComponent(challengeData.challenge);link.textContent='Verify in Telegram';status.replaceChildren(document.createTextNode('Open the bot link, press Start, then return here. This page will finish the deletion automatically. '),link);for(let attempt=0;attempt<55;attempt++){await pause(2000);const response=await fetch('./auth/native/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({challenge:challengeData.challenge})});if(response.status===409)continue;const result=await response.json();if(!response.ok)throw new Error(result.error||'Deletion could not be completed.');status.textContent='Your AMZY cloud account and associated cloud data have been deleted.';button.hidden=true;return;}throw new Error('Verification expired. Start again to request deletion.');}catch(error){status.textContent=error instanceof Error?error.message:'Deletion could not be completed.';button.disabled=false;}});
</script></body></html>`);
}

async function deleteAccountWithBotChallenge(request: Request, origin: string): Promise<Response> {
  const body = await request.json().catch(() => ({}));
  if (typeof body.challenge !== 'string' || body.challenge.length > 100) {
    return json({ error: 'Invalid deletion verification request.' }, 400, origin);
  }
  const db = getSupabase();
  const challengeHash = await digest(body.challenge);
  const { data: challenge, error: challengeError } = await db
    .from('native_login_challenges')
    .select('verified_uid, purpose')
    .eq('challenge_hash', challengeHash)
    .eq('purpose', 'delete')
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (challengeError) throw challengeError;
  if (!challenge) return json({ error: 'Verification expired. Start again.' }, 401, origin);
  if (!challenge.verified_uid) return json({ pending: true }, 409, origin);
  const { data: consumed, error: consumeError } = await db
    .from('native_login_challenges')
    .update({ consumed_at: new Date().toISOString() })
    .eq('challenge_hash', challengeHash)
    .eq('purpose', 'delete')
    .is('consumed_at', null)
    .not('verified_uid', 'is', null)
    .select('verified_uid')
    .maybeSingle();
  if (consumeError) throw consumeError;
  if (!consumed) return json({ error: 'Verification expired. Start again.' }, 401, origin);
  await deleteCloudAccount(db, consumed.verified_uid);
  return json({ success: true }, 200, origin);
}

async function startTelegramLogin(request: Request, origin: string): Promise<Response> {
  const config = requireTelegramConfig();
  const requestUrl = new URL(request.url);
  const returnTo = getAllowedReturnTarget(requestUrl.searchParams.get('return_to'), config);
  const state = crypto.randomUUID();
  const nonce = crypto.randomUUID();
  const verifier = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const challengeBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(challengeBytes)))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const authorizationUrl = new URL(`${issuer}/auth`);
  authorizationUrl.search = new URLSearchParams({
    bot_id: config.botId,
    origin: new URL(config.frontendUrl).origin,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'openid profile phone',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();

  const headers = new Headers({
    Location: authorizationUrl.toString(),
    ...corsHeaders(origin),
  });
  headers.append('Set-Cookie', cookie('telegram_oauth_state', state, 300));
  headers.append('Set-Cookie', cookie('telegram_oauth_nonce', nonce, 300));
  headers.append('Set-Cookie', cookie('telegram_oauth_verifier', verifier, 300));
  headers.append('Set-Cookie', cookie('telegram_oauth_return_to', returnTo, 300));
  return new Response(null, { status: 302, headers });
}

async function finishTelegramLogin(request: Request): Promise<Response> {
  const config = requireTelegramConfig();
  const requestUrl = new URL(request.url);
  const returnTo = getAllowedReturnTarget(getCookie(request, 'telegram_oauth_return_to'), config);
  const errorUrl = new URL(returnTo);
  if (errorUrl.protocol !== 'amzy:') errorUrl.searchParams.set('tab', 'profile');
  errorUrl.searchParams.set('telegramLogin', 'error');
  const headers = new Headers({ Location: errorUrl.toString() });
  clearAuthCookies(headers);

  try {
    const stateCookie = getCookie(request, 'telegram_oauth_state');
    const nonceCookie = getCookie(request, 'telegram_oauth_nonce');
    const verifier = getCookie(request, 'telegram_oauth_verifier');
    const state = requestUrl.searchParams.get('state') || '';
    const code = requestUrl.searchParams.get('code') || '';
    if (
      !stateCookie || !nonceCookie || !verifier || !code ||
      stateCookie !== state
    ) {
      throw new Error('Telegram login state validation failed.');
    }

    const tokenResponse = await fetch(`${issuer}/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
        client_id: config.clientId,
        code_verifier: verifier,
      }),
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || typeof tokenData.id_token !== 'string') {
      throw new Error(`Telegram token exchange failed (${tokenResponse.status}).`);
    }

    const { payload } = await jwtVerify(tokenData.id_token, jwks, {
      issuer,
      audience: config.clientId,
      maxTokenAge: '10m',
    });
    if (typeof payload.nonce !== 'string' || payload.nonce !== nonceCookie) {
      throw new Error('Telegram ID token nonce validation failed.');
    }
    if (typeof payload.sub !== 'string' || !payload.sub) {
      throw new Error('Telegram ID token is missing a user identifier.');
    }

    const username = typeof payload.preferred_username === 'string' ? payload.preferred_username : null;
    const displayName = typeof payload.name === 'string' ? payload.name : username || 'Telegram user';
    const photoURL = typeof payload.picture === 'string' ? payload.picture : null;
    const phoneNumber = typeof payload.phone_number === 'string' ? payload.phone_number : null;
    const uid = `telegram:${payload.sub}`;
    const db = getSupabase();
    const { data: existingUser, error: existingUserError } = await db
      .from('users')
      .select('phone_number, email')
      .eq('uid', uid)
      .maybeSingle();
    if (existingUserError) throw existingUserError;
    const { error: userError } = await getSupabase().from('users').upsert({
      uid,
      telegram_id: payload.sub,
      email: getPersonalEmail(existingUser?.email) || `${payload.sub}@telegram.local`,
      display_name: displayName,
      photo_url: photoURL,
      username,
      phone_number: phoneNumber ?? existingUser?.phone_number ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'uid' });
    if (userError) throw userError;

    const oneTimeCode = crypto.randomUUID() + crypto.randomUUID();
    const { error: cleanupError } = await getSupabase()
      .from('telegram_login_codes')
      .delete()
      .lt('expires_at', new Date().toISOString());
    if (cleanupError) throw cleanupError;
    const { error: codeError } = await getSupabase().from('telegram_login_codes').insert({
      code_hash: await digest(oneTimeCode),
      uid,
      display_name: displayName,
      photo_url: photoURL,
      username,
      phone_number: phoneNumber ?? existingUser?.phone_number ?? null,
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    if (codeError) throw codeError;

    const appUrl = new URL(returnTo);
    appUrl.searchParams.set('telegram_code', oneTimeCode);
    headers.set('Location', appUrl.toString());
  } catch (error) {
    console.error('Telegram OIDC callback failed:', error);
    const reason = error instanceof Error ? error.message : JSON.stringify(error);
    return new Response(`AMZY login failed: ${reason.slice(0, 300)}`, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  // Supabase serves function HTML as text/plain, so deep links must use a plain redirect.
  return new Response(null, { status: 302, headers });
}

async function exchangeLoginCode(request: Request, origin: string): Promise<Response> {
  const body = await request.json().catch(() => ({}));
  if (typeof body.code !== 'string' || body.code.length > 100) {
    return json({ error: 'Invalid or expired Telegram login code.' }, 400, origin);
  }
  const codeHash = await digest(body.code);
  const { data, error } = await getSupabase()
    .from('telegram_login_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('code_hash', codeHash)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('uid, display_name, photo_url, username, phone_number')
    .maybeSingle();
  if (error) throw error;
  if (!data) return json({ error: 'Invalid or expired Telegram login code.' }, 401, origin);

  const user: AppUser = {
    uid: data.uid,
    displayName: data.display_name || 'Telegram user',
    photoURL: data.photo_url,
    username: data.username,
    phoneNumber: data.phone_number,
    telegramId: data.uid.replace(/^telegram:/, ''),
  };
  return json({ token: await createSessionToken(user), user }, 200, origin);
}

async function createNativeChallenge(origin: string, purpose: 'login' | 'delete' = 'login'): Promise<Response> {
  if (!botToken || !botUsername || !botWebhookSecret) {
    return json({ error: 'Cloud sync verification is not configured yet.' }, 503, origin);
  }
  const challenge = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const db = getSupabase();
  const { error: cleanupError } = await db
    .from('native_login_challenges')
    .delete()
    .lt('expires_at', new Date().toISOString());
  if (cleanupError) throw cleanupError;
  const { error } = await db.from('native_login_challenges').insert({
    challenge_hash: await digest(challenge),
    expires_at: new Date(Date.now() + 2 * 60_000).toISOString(),
    purpose,
  });
  if (error) throw error;
  return json({ challenge, botUsername }, 200, origin);
}

async function handleBotWebhook(request: Request): Promise<Response> {
  const received = request.headers.get('x-telegram-bot-api-secret-token') || '';
  if (!botToken || !botWebhookSecret || await digest(received) !== await digest(botWebhookSecret)) {
    return new Response('Forbidden', { status: 403 });
  }
  const update = await request.json().catch(() => ({}));
  const message = update?.message;
  const match = typeof message?.text === 'string' ? /^\/start\s+([A-Za-z0-9_-]{20,64})$/.exec(message.text.trim()) : null;
  if (!match || message.chat?.type !== 'private' || typeof message.from?.id !== 'number' || message.from.is_bot) {
    return new Response('ok');
  }
  const { data: verified, error } = await getSupabase()
    .from('native_login_challenges')
    .update({ verified_uid: `telegram:${message.from.id}` })
    .eq('challenge_hash', await digest(match[1]))
    .is('verified_uid', null)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('challenge_hash')
    .maybeSingle();
  if (error) throw error;
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: message.chat.id,
      text: verified ? 'Telegram account verified. Return to AMZY to finish.' : 'This verification link expired. Please start again.',
    }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => undefined);
  return new Response('ok');
}

function derEcdsaToRaw(der: Uint8Array): Uint8Array {
  let offset = 2;
  const readInt = (): Uint8Array => {
    const length = der[offset + 1];
    let value = der.slice(offset + 2, offset + 2 + length);
    offset += 2 + length;
    while (value.length > 32 && value[0] === 0) value = value.slice(1);
    const padded = new Uint8Array(32);
    padded.set(value, 32 - value.length);
    return padded;
  };
  const r = readInt();
  const s = readInt();
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

async function createNativeSession(request: Request, origin: string): Promise<Response> {
  const body = await request.json().catch(() => ({}));
  if (
    typeof body.uid !== 'string' || !/^telegram:\d+$/.test(body.uid) ||
    typeof body.challenge !== 'string' || body.challenge.length > 100 ||
    typeof body.publicKey !== 'string' || body.publicKey.length > 500 ||
    typeof body.signature !== 'string' || body.signature.length > 300
  ) {
    return json({ error: 'Invalid Telegram device login request.' }, 400, origin);
  }
  const db = getSupabase();
  const challengeHash = await digest(body.challenge);
  const { data: challengeRow, error: challengeError } = await db
    .from('native_login_challenges')
    .select('verified_uid, purpose')
    .eq('challenge_hash', challengeHash)
    .eq('purpose', 'login')
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (challengeError) throw challengeError;
  if (!challengeRow) return json({ error: 'Telegram login challenge expired. Please try again.' }, 401, origin);
  if (!challengeRow.verified_uid) return json({ pending: true }, 409, origin);
  if (challengeRow.verified_uid !== body.uid) {
    return json({ error: 'Telegram verification came from a different account.' }, 403, origin);
  }
  const { data: consumed, error: consumeError } = await db
    .from('native_login_challenges')
    .update({ consumed_at: new Date().toISOString() })
    .eq('challenge_hash', challengeHash)
    .eq('purpose', 'login')
    .is('consumed_at', null)
    .select('challenge_hash')
    .maybeSingle();
  if (consumeError) throw consumeError;
  if (!consumed) return json({ error: 'Telegram login challenge expired. Please try again.' }, 401, origin);

  const publicKeyBytes = Uint8Array.from(atob(body.publicKey), (char) => char.charCodeAt(0));
  const signatureBytes = Uint8Array.from(atob(body.signature), (char) => char.charCodeAt(0));
  const message = new TextEncoder().encode(`amzy-native-login:${body.challenge}:${body.uid}`);
  let verified = false;
  try {
    const publicKey = await crypto.subtle.importKey(
      'spki',
      publicKeyBytes,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    verified = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      derEcdsaToRaw(signatureBytes),
      message,
    );
  } catch {
    verified = false;
  }
  if (!verified) return json({ error: 'Device signature could not be verified.' }, 401, origin);

  // Telegram already proved the account, so a new device key simply replaces the old one.
  const { error: deviceKeyError } = await db.from('device_keys').upsert(
    { uid: body.uid, public_key: body.publicKey },
    { onConflict: 'uid' },
  );
  if (deviceKeyError) throw deviceKeyError;

  const telegramId = body.uid.replace(/^telegram:/, '');
  const displayName = typeof body.displayName === 'string' && body.displayName ? body.displayName.slice(0, 120) : 'Telegram user';
  const username = typeof body.username === 'string' ? body.username.slice(0, 64) : null;
  const photoURL = typeof body.photoURL === 'string' ? body.photoURL.slice(0, 500) : null;
  const phoneNumber = typeof body.phoneNumber === 'string' ? body.phoneNumber.slice(0, 32) : null;
  const { data: existingUser, error: existingUserError } = await db
    .from('users')
    .select('email')
    .eq('uid', body.uid)
    .maybeSingle();
  if (existingUserError) throw existingUserError;
  const { error: userError } = await db.from('users').upsert({
    uid: body.uid,
    telegram_id: telegramId,
    email: getPersonalEmail(existingUser?.email) || `${telegramId}@telegram.local`,
    display_name: displayName,
    photo_url: photoURL,
    username,
    ...(phoneNumber ? { phone_number: phoneNumber } : {}),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'uid' });
  if (userError) throw userError;

  const user: AppUser = {
    uid: body.uid,
    displayName,
    photoURL,
    username,
    phoneNumber,
    telegramId,
  };
  return json({ token: await createSessionToken(user), user }, 200, origin);
}

const memoryRateLimits = new Map<string, { windowStart: number; hits: number }>();

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('cf-connecting-ip') || 'unknown';
}

function tooManyRequests(origin: string, windowSeconds: number): Response {
  const response = json({ error: 'Too many requests. Please slow down.' }, 429, origin);
  response.headers.set('Retry-After', String(windowSeconds));
  return response;
}

// Database-backed counter shared by all function instances; fails open if the database is unavailable.
async function isRateLimited(request: Request, bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const { data, error } = await getSupabase().rpc('rate_limit_hit', {
      p_bucket: `${bucket}:${clientIp(request)}`,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) throw error;
    return data === false;
  } catch (error) {
    console.error('Rate limit check failed:', error);
    return false;
  }
}

// Cheap per-instance counter for high-volume media requests.
function isMemoryRateLimited(request: Request, bucket: string, limit: number, windowSeconds: number): boolean {
  const key = `${bucket}:${clientIp(request)}`;
  const now = Date.now();
  const entry = memoryRateLimits.get(key);
  if (!entry || now - entry.windowStart > windowSeconds * 1000) {
    if (memoryRateLimits.size > 5000) memoryRateLimits.clear();
    memoryRateLimits.set(key, { windowStart: now, hits: 1 });
    return false;
  }
  entry.hits += 1;
  return entry.hits > limit;
}

async function route(request: Request): Promise<Response> {
  const origin = request.headers.get('origin') || '';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });

  const url = new URL(request.url);
  const routeIndex = url.pathname.search(/\/(?:auth|user|admin|app-config|telegram|watch|privacy|delete-account)(?:\/|$)/);
  const path = routeIndex >= 0
    ? url.pathname.slice(routeIndex)
    : url.pathname.endsWith('/notifications') ? '/notifications' : '/';
  if (request.method !== 'GET' || path !== '/telegram/proxy-media') {
    const limits: [boolean, string, number][] = [
      [path.startsWith('/watch/'), 'watch', 240],
      [path === '/telegram/channel-feed', 'channel-feed', 30],
      [path === '/app-config/telegram', 'telegram-runtime-config', 30],
      [path === '/auth/native/challenge', 'native-challenge', 10],
      [path === '/auth/native/deletion-challenge', 'native-deletion-challenge', 10],
      [path === '/auth/native/session', 'native-session', 60],
      [path === '/auth/native/delete', 'native-delete', 10],
      [path === '/user/account' && request.method === 'DELETE', 'account-delete', 10],
      [path === '/auth/telegram/start', 'telegram-start', 20],
      [path === '/auth/telegram/callback', 'telegram-callback', 30],
      [path === '/auth/telegram/exchange', 'telegram-exchange', 30],
    ];
    const matched = limits.find(([applies]) => applies);
    if (matched && await isRateLimited(request, matched[1], matched[2], 60)) {
      return tooManyRequests(origin, 60);
    }
  } else if (isMemoryRateLimited(request, 'proxy-media', 600, 60)) {
    return tooManyRequests(origin, 60);
  }
  if (request.method === 'GET' && path === '/privacy') {
    return Response.redirect('https://amzy.chakrabortycompliance.in/legal/privacy.html', 302);
  }
  if (request.method === 'GET' && path === '/delete-account') {
    return Response.redirect('https://amzy.chakrabortycompliance.in/legal/delete-account.html', 302);
  }
  const watchRoomResponse = await handleWatchRoomRoute(request, path, origin);
  if (watchRoomResponse) return watchRoomResponse;
  if (request.method === 'GET' && path === '/telegram/channel-feed') {
    try {
      const before = url.searchParams.get('before') || '';
      if (before && !/^\d+$/.test(before)) {
        return json({ error: 'Telegram history cursor is invalid.' }, 400, origin);
      }
      return await fetchPublicChannelFeed(request, url.searchParams.get('channel') || '', before || undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load the public Telegram channel.';
      return json({ error: message }, 502, origin);
    }
  }
  if (request.method === 'GET' && path === '/telegram/proxy-media') {
    try {
      return await proxyTelegramMedia(request);
    } catch (error) {
      console.error('Telegram media proxy failed:', error);
      return json({ error: 'Could not load this Telegram media file.' }, 502, origin);
    }
  }
  if (request.method === 'POST' && path === '/telegram/bot-webhook') {
    return await handleBotWebhook(request);
  }
  if (request.method === 'GET' && path === '/auth/native/challenge') {
    return await createNativeChallenge(origin);
  }
  if (request.method === 'GET' && path === '/auth/native/deletion-challenge') {
    return await createNativeChallenge(origin, 'delete');
  }
  if (request.method === 'POST' && path === '/auth/native/delete') {
    return await deleteAccountWithBotChallenge(request, origin);
  }
  if (request.method === 'POST' && path === '/auth/native/session') {
    return await createNativeSession(request, origin);
  }
  if (request.method === 'GET' && path === '/auth/telegram/start') {
    return await startTelegramLogin(request, origin);
  }
  if (request.method === 'GET' && path === '/auth/telegram/callback') {
    return await finishTelegramLogin(request);
  }
  if (request.method === 'POST' && path === '/auth/telegram/exchange') {
    return await exchangeLoginCode(request, origin);
  }
  if (request.method === 'GET' && path === '/auth/session') {
    if (await isDeletedAccountSession(request)) {
      return json({ user: null, accountDeleted: true }, 410, origin);
    }
    const user = await getAuthenticatedUser(request);
    return json({ user }, user ? 200 : 401, origin);
  }
  if (request.method === 'GET' && path === '/notifications') {
    const { data, error } = await getSupabase()
      .from('announcements')
      .select('id, title, message, created_at')
      .eq('is_published', true)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return json({
      success: true,
      notifications: (data || []).map((notification) => ({
        id: notification.id,
        title: notification.title,
        message: notification.message,
        createdAt: notification.created_at,
      })),
    }, 200, origin);
  }
  if (request.method === 'GET' && path === '/app-config/telegram') {
    const { data, error } = await getSupabase()
      .from('telegram_runtime_config')
      .select('api_id, api_hash')
      .eq('id', true)
      .maybeSingle();
    if (error) throw error;
    if (!data) return json({ error: 'Telegram API settings have not been configured by an admin.' }, 503, origin);
    return json({ apiId: data.api_id, apiHash: data.api_hash }, 200, origin);
  }
  if (request.method === 'POST' && path === '/auth/logout') {
    return json({ success: true }, 200, origin);
  }

  if (path.startsWith('/admin/')) {
    return await handleAdminRoute(request, path, url, origin);
  }

  const user = await getAuthenticatedUser(request);
  if (!user) return json({ error: 'Unauthorized' }, 401, origin);
  const db = getSupabase();

  if (path === '/user/account' && request.method === 'DELETE') {
    await deleteCloudAccount(db, user.uid);
    return json({ success: true }, 200, origin);
  }

  if (path === '/user/profile' && request.method === 'GET') {
    const { data: profile, error: profileError } = await db
      .from('users')
      .select('id, telegram_id, username, phone_number')
      .eq('uid', user.uid)
      .single();
    if (profileError) throw profileError;
    const { count, error: countError } = await db
      .from('channels')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', profile.id);
    if (countError) throw countError;
    return json({
      success: true,
      profile: {
        telegramId: profile.telegram_id || user.telegramId,
        username: profile.username || user.username,
        phoneNumber: profile.phone_number || user.phoneNumber,
        channelCount: count || 0,
      },
    }, 200, origin);
  }
  if (path === '/user/profile' && request.method === 'PATCH') {
    const body = await request.json().catch(() => ({}));
    if (
      typeof body.phoneNumber !== 'string'
      || body.phoneNumber.length > 32
      || !/^\+?[0-9][0-9 ()-]{3,30}$/.test(body.phoneNumber)
    ) {
      return json({ error: 'A valid Telegram phone number is required.' }, 400, origin);
    }
    const { error } = await db.from('users')
      .update({ phone_number: body.phoneNumber })
      .eq('uid', user.uid);
    if (error) throw error;
    return json({ success: true }, 200, origin);
  }

  if (path === '/user/channels' && request.method === 'GET') {
    const { data, error } = await db
      .from('users')
      .select('id, channels(*)')
      .eq('uid', user.uid)
      .maybeSingle();
    if (error) throw error;
    const channels = (data?.channels || []).map((channel: Record<string, unknown>) => ({
      id: channel.id,
      userId: channel.user_id,
      channelUsername: channel.channel_username,
      channelLink: isGeneratedPrivateChannelLink(channel) ? null : channel.channel_link,
      title: channel.title,
      category: channel.category,
      description: channel.description,
      avatarUrl: channel.avatar_url,
      subscriberCount: channel.subscriber_count,
      telegramChatId: channel.telegram_chat_id,
      telegramChatKind: channel.telegram_chat_kind,
      isPublicTelegramChat: channel.is_public_telegram_chat,
      isMonetized: channel.is_monetized,
      adNetwork: channel.ad_network,
      createdAt: channel.created_at,
    }));
    return json({ success: true, channels, channelCount: channels.length }, 200, origin);
  }
  if (path === '/user/channels' && request.method === 'POST') {
    const body = await request.json();
    if (typeof body.channelUsername !== 'string' || typeof body.title !== 'string') {
      return json({ error: 'Channel username and title are required.' }, 400, origin);
    }
    const { data: owner, error: ownerError } = await db.from('users').select('id').eq('uid', user.uid).single();
    if (ownerError) throw ownerError;
    const { data, error } = await db.from('channels').upsert({
      user_id: owner.id,
      channel_username: body.channelUsername.replace(/^@/, '').toLowerCase(),
      ...(typeof body.channelLink === 'string' && body.channelLink.trim()
        ? { channel_link: body.channelLink.trim().slice(0, 2000) }
        : {}),
      title: body.title,
      category: body.category || 'Movies & Shows',
      description: body.description || null,
      avatar_url: body.avatarUrl || null,
      subscriber_count: body.subscriberCount || null,
      telegram_chat_id: typeof body.telegramChatId === 'string' ? body.telegramChatId : null,
      telegram_chat_kind: body.telegramChatKind === 'group' ? 'group' : 'channel',
      is_public_telegram_chat: typeof body.isPublicTelegramChat === 'boolean'
        ? body.isPublicTelegramChat
        : null,
      is_monetized: body.isMonetized ?? false,
      ad_network: body.adNetwork || 'Direct Sponsorship',
    }, { onConflict: 'user_id,channel_username' }).select('*').single();
    if (error) throw error;
    return json({ success: true, channel: data }, 200, origin);
  }
  if (path.startsWith('/user/channels/') && request.method === 'DELETE') {
    const username = decodeURIComponent(path.slice('/user/channels/'.length)).replace(/^@/, '').toLowerCase();
    const { data: owner, error: ownerError } = await db.from('users').select('id').eq('uid', user.uid).single();
    if (ownerError) throw ownerError;
    const { error } = await db.from('channels').delete()
      .eq('channel_username', username).eq('user_id', owner.id);
    if (error) throw error;
    return json({ success: true }, 200, origin);
  }
  if (path === '/user/favorites' && request.method === 'GET') {
    const { data: owner, error: ownerError } = await db.from('users').select('id').eq('uid', user.uid).single();
    if (ownerError) throw ownerError;
    const { data, error } = await db.from('favorites').select('*')
      .eq('user_id', owner.id).order('created_at', { ascending: false });
    if (error) throw error;
    const favorites = (data || []).map((item: Record<string, unknown>) => ({
      id: item.id,
      userId: item.user_id,
      mediaId: item.media_id,
      title: item.title,
      channel: item.channel,
      type: item.type,
      videoUrl: item.video_url,
      poster: item.poster,
      backdrop: item.backdrop,
      caption: item.caption,
      createdAt: item.created_at,
    }));
    return json({ success: true, favorites }, 200, origin);
  }
  if (path === '/user/favorites' && request.method === 'POST') {
    const body = await request.json();
    if (typeof body.mediaId !== 'string' || typeof body.title !== 'string') {
      return json({ error: 'Media ID and title are required.' }, 400, origin);
    }
    const { data: owner, error: ownerError } = await db.from('users').select('id').eq('uid', user.uid).single();
    if (ownerError) throw ownerError;
    const { data, error } = await db.from('favorites').upsert({
      user_id: owner.id,
      media_id: body.mediaId,
      title: body.title,
      channel: body.channel || '',
      type: body.type || 'video',
      video_url: body.videoUrl || null,
      poster: body.poster || null,
      backdrop: body.backdrop || null,
      caption: body.caption || null,
    }, { onConflict: 'user_id,media_id' }).select('*').single();
    if (error) throw error;
    return json({ success: true, favorite: data }, 200, origin);
  }
  if (path.startsWith('/user/favorites/') && request.method === 'DELETE') {
    const mediaId = decodeURIComponent(path.slice('/user/favorites/'.length));
    const { data: owner, error: ownerError } = await db.from('users').select('id').eq('uid', user.uid).single();
    if (ownerError) throw ownerError;
    const { error } = await db.from('favorites').delete()
      .eq('media_id', mediaId).eq('user_id', owner.id);
    if (error) throw error;
    return json({ success: true }, 200, origin);
  }

  return json({ error: 'Not found' }, 404, origin);
}

Deno.serve(async (request: Request) => {
  try {
    return await route(request);
  } catch (error) {
    console.error('TeleFlix Edge Function request failed:', error);
    return json({ error: 'The backend request failed.' }, 500, request.headers.get('origin') || '');
  }
});
