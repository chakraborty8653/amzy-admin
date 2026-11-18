import { getSupabaseAdmin } from './supabase.ts';

interface UserRow {
  id: number;
  uid: string;
  email: string;
  display_name: string | null;
  photo_url: string | null;
  telegram_api_key: string | null;
  telegram_bot_token: string | null;
  telegram_api_hash: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface ChannelRow {
  id: number;
  user_id: number;
  channel_username: string;
  title: string;
  category: string | null;
  description: string | null;
  avatar_url: string | null;
  subscriber_count: string | null;
  channel_link: string | null;
  is_monetized: boolean | null;
  ad_network: string | null;
  created_at: string | null;
}

interface FavoriteRow {
  id: number;
  user_id: number;
  media_id: string;
  title: string;
  channel: string;
  type: string;
  video_url: string | null;
  poster: string | null;
  backdrop: string | null;
  caption: string | null;
  created_at: string | null;
}

function throwDatabaseError(operation: string, error: unknown): never {
  console.error(`Supabase ${operation} failed:`, error);
  throw new Error('Supabase database query failed. Please try again later.', { cause: error });
}

function isPlaceholderEmail(email: string): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  return normalizedEmail.endsWith('@telegram.local')
    || normalizedEmail === 'user@teleflix.internal';
}

async function requireUser(uid: string): Promise<UserRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('users')
    .select('*')
    .eq('uid', uid)
    .maybeSingle();
  if (error) throw error;
  return data as UserRow | null;
}

function mapUser(row: UserRow) {
  return {
    id: row.id,
    uid: row.uid,
    email: row.email,
    displayName: row.display_name,
    photoUrl: row.photo_url,
    telegramApiKey: row.telegram_api_key,
    telegramBotToken: row.telegram_bot_token,
    telegramApiHash: row.telegram_api_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapChannel(row: ChannelRow) {
  return {
    id: row.id,
    userId: row.user_id,
    channelUsername: row.channel_username,
    channelLink: row.channel_link,
    title: row.title,
    category: row.category,
    description: row.description,
    avatarUrl: row.avatar_url,
    subscriberCount: row.subscriber_count,
    isMonetized: row.is_monetized,
    adNetwork: row.ad_network,
    createdAt: row.created_at,
  };
}

function mapFavorite(row: FavoriteRow) {
  return {
    id: row.id,
    userId: row.user_id,
    mediaId: row.media_id,
    title: row.title,
    channel: row.channel,
    type: row.type,
    videoUrl: row.video_url,
    poster: row.poster,
    backdrop: row.backdrop,
    caption: row.caption,
    createdAt: row.created_at,
  };
}

export async function getOrCreateUser(
  uid: string,
  email: string,
  displayName?: string,
  photoUrl?: string
) {
  try {
    const existing = await requireUser(uid);
    const storedEmail = isPlaceholderEmail(email) && existing?.email && !isPlaceholderEmail(existing.email)
      ? existing.email
      : email;
    const { data, error } = await getSupabaseAdmin()
      .from('users')
      .upsert({
        uid,
        email: storedEmail,
        display_name: displayName ?? existing?.display_name ?? null,
        photo_url: photoUrl ?? existing?.photo_url ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'uid' })
      .select('*')
      .single();

    if (error) throw error;
    return mapUser(data as UserRow);
  } catch (error) {
    return throwDatabaseError('getOrCreateUser', error);
  }
}

export async function getUserByUid(uid: string) {
  try {
    const user = await requireUser(uid);
    return user ? mapUser(user) : null;
  } catch (error) {
    return throwDatabaseError('getUserByUid', error);
  }
}

export async function updateUserSettings(
  uid: string,
  data: { telegramApiKey?: string; telegramBotToken?: string; telegramApiHash?: string }
) {
  try {
    const update: Record<string, string> = { updated_at: new Date().toISOString() };
    if (data.telegramApiKey !== undefined) update.telegram_api_key = data.telegramApiKey;
    if (data.telegramBotToken !== undefined) update.telegram_bot_token = data.telegramBotToken;
    if (data.telegramApiHash !== undefined) update.telegram_api_hash = data.telegramApiHash;

    const { data: row, error } = await getSupabaseAdmin()
      .from('users')
      .update(update)
      .eq('uid', uid)
      .select('*')
      .maybeSingle();

    if (error) throw error;
    return row ? mapUser(row as UserRow) : null;
  } catch (error) {
    return throwDatabaseError('updateUserSettings', error);
  }
}

export async function getUserChannels(uid: string) {
  try {
    const user = await requireUser(uid);
    if (!user) return [];

    const { data, error } = await getSupabaseAdmin()
      .from('channels')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return ((data || []) as ChannelRow[]).map(mapChannel);
  } catch (error) {
    return throwDatabaseError('getUserChannels', error);
  }
}

export async function addUserChannel(
  uid: string,
  channelData: {
    channelUsername: string;
    title: string;
    category?: string;
    description?: string;
    avatarUrl?: string;
    subscriberCount?: string;
    channelLink?: string;
    isMonetized?: boolean;
    adNetwork?: string;
  }
) {
  try {
    const user = await requireUser(uid);
    if (!user) throw new Error('User not found in Supabase.');

    const { data, error } = await getSupabaseAdmin()
      .from('channels')
      .upsert({
        user_id: user.id,
        channel_username: channelData.channelUsername.replace('@', '').toLowerCase(),
        title: channelData.title,
        category: channelData.category || 'Movies & Shows',
        description: channelData.description || null,
        avatar_url: channelData.avatarUrl || null,
        subscriber_count: channelData.subscriberCount || null,
        ...(channelData.channelLink ? { channel_link: channelData.channelLink.slice(0, 2000) } : {}),
        is_monetized: channelData.isMonetized ?? false,
        ad_network: channelData.adNetwork || 'Direct Sponsorship',
      }, { onConflict: 'user_id,channel_username' })
      .select('*')
      .single();

    if (error) throw error;
    return mapChannel(data as ChannelRow);
  } catch (error) {
    return throwDatabaseError('addUserChannel', error);
  }
}

export async function deleteUserChannel(uid: string, channelUsername: string) {
  try {
    const user = await requireUser(uid);
    if (!user) return;

    const { error } = await getSupabaseAdmin()
      .from('channels')
      .delete()
      .eq('channel_username', channelUsername.replace('@', '').toLowerCase())
      .eq('user_id', user.id);

    if (error) throw error;
  } catch (error) {
    return throwDatabaseError('deleteUserChannel', error);
  }
}

export async function getUserFavorites(uid: string) {
  try {
    const user = await requireUser(uid);
    if (!user) return [];

    const { data, error } = await getSupabaseAdmin()
      .from('favorites')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return ((data || []) as FavoriteRow[]).map(mapFavorite);
  } catch (error) {
    return throwDatabaseError('getUserFavorites', error);
  }
}

export async function addUserFavorite(
  uid: string,
  item: {
    mediaId: string;
    title: string;
    channel: string;
    type: string;
    videoUrl?: string;
    poster?: string;
    backdrop?: string;
    caption?: string;
  }
) {
  try {
    const user = await requireUser(uid);
    if (!user) throw new Error('User not found in Supabase.');

    const { data, error } = await getSupabaseAdmin()
      .from('favorites')
      .upsert({
        user_id: user.id,
        media_id: item.mediaId,
        title: item.title,
        channel: item.channel,
        type: item.type,
        video_url: item.videoUrl || null,
        poster: item.poster || null,
        backdrop: item.backdrop || null,
        caption: item.caption || null,
      }, { onConflict: 'user_id,media_id' })
      .select('*')
      .single();

    if (error) throw error;
    return mapFavorite(data as FavoriteRow);
  } catch (error) {
    return throwDatabaseError('addUserFavorite', error);
  }
}

export async function removeUserFavorite(uid: string, mediaId: string) {
  try {
    const user = await requireUser(uid);
    if (!user) return;

    const { error } = await getSupabaseAdmin()
      .from('favorites')
      .delete()
      .eq('media_id', mediaId)
      .eq('user_id', user.id);

    if (error) throw error;
  } catch (error) {
    return throwDatabaseError('removeUserFavorite', error);
  }
}
