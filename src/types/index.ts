export interface MediaItem {
  id: string;
  telegramId?: string;
  channel: string;
  type: 'video' | 'photo' | 'text';
  title: string;
  videoUrl?: string;
  rawVideoUrl?: string;
  photoUrl?: string;
  poster?: string;
  backdrop?: string;
  caption: string;
  views?: string;
  date?: string;
  duration?: string;
  genre?: string;
  matchScore?: number;
  ageRating?: string;
  resolution?: string;
  telegramLink?: string;
  tags?: string[];
  cast?: string;
  director?: string;
  progressPercent?: number; // 0-100 for continue watching
  telegramFileId?: number;
  telegramFileSize?: number;
  telegramStreamToken?: string;
  telegramNativePlayback?: boolean;
  localNativePlayback?: boolean;
  localVideo?: boolean;
  localVideoPath?: string;
  telegramMimeType?: string;
  telegramSupportsStreaming?: boolean;
  telegramThumbnailFileId?: number;
  telegramChatId?: string;
  telegramContentRestrictionChecked?: boolean;
  albumPhotos?: string[]; // Multiple photos in a Telegram media album
  photoSizes?: {
    type: 's' | 'm' | 'x' | 'y' | 'w';
    label: string;
    url: string;
    width?: number;
    height?: number;
  }[];
}

export interface TelegramChannelConfig {
  id: string;
  username: string;
  title: string;
  description?: string;
  avatar?: string;
  subscribers?: string;
  botToken?: string;
  chatId?: string;
  isCustom?: boolean;
  isBotConnected?: boolean;
  category?: string;
  isMonetized?: boolean;
  lastSynced?: string;
  items: MediaItem[];
  bannerBackdrop?: string;
  featured?: MediaItem;
  telegramChatId?: string;
  telegramChatKind?: 'channel' | 'group';
  isPublicTelegramChat?: boolean;
  sourceLink?: string;
}

export interface DownloadedVideo {
  id: string;
  item: MediaItem;
  location: string;
  playbackUrl?: string;
  downloadedAt: number;
  status: 'downloading' | 'completed' | 'failed';
  progress: number;
  downloadedBytes?: number;
  totalBytes?: number;
  error?: string;
}

export interface MediaPlaylist {
  id: string;
  name: string;
  itemIds: string[];
  createdAt: number;
}

export interface LocalVideoHistoryEntry {
  id: string;
  path: string;
  title: string;
  sourceUri: string;
  mimeType: string;
  lastPlayedAt: number;
}

export type ActiveTab = 'home' | 'search' | 'favorite' | 'profile' | 'trending' | 'mylist' | 'downloads';
