import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export type TelegramNativeAuthStep =
  | 'initializing'
  | 'phone'
  | 'code'
  | 'password'
  | 'ready'
  | 'loggedOut';

export interface TelegramNativeUser {
  uid: string;
  displayName: string;
  photoURL: string | null;
  username: string | null;
  phoneNumber: string | null;
}

export interface TelegramNativeAuthState {
  step: TelegramNativeAuthStep;
  user: TelegramNativeUser | null;
  error: string | null;
}

export interface TelegramInviteInfo {
  joined: boolean;
  chatId: string;
  title: string;
  createsJoinRequest: boolean;
  isPublic: boolean;
}

export interface TelegramPrivateChannelReference {
  chatId?: string;
  title?: string;
  requestPending?: boolean;
}

export interface TelegramPrivateVideo {
  id: string;
  fileId: number;
  fileSize: number;
  mimeType: string;
  supportsStreaming: boolean;
  thumbnailFileId: number;
  thumbnailData?: string;
  title: string;
  caption: string;
  duration: string;
  date: string;
  canBeSaved: boolean;
}

export interface TelegramPrivateVideoFeed extends TelegramPrivateChannelReference {
  chatId: string;
  title: string;
  username?: string;
  chatKind?: 'channel' | 'group';
  isPublic?: boolean;
  blockedBySensitiveContent?: boolean;
  items: TelegramPrivateVideo[];
  nextFromMessageId?: string | null;
}

export interface TelegramVideoPlayerState {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  isLoading: boolean;
  ended: boolean;
  closed?: boolean;
  error?: string;
}

export interface TelegramDownloadProgress {
  fileId: number;
  itemId?: string;
  downloadedBytes: number;
  totalBytes: number;
  progress: number;
  status: 'downloading' | 'completed' | 'failed';
  error?: string;
}

interface TelegramNativePlugin {
  pickLocalVideo(): Promise<
    | { cancelled: true }
    | { path: string; title: string; mimeType: string; sourceUri: string }
  >;
  importLocalVideo(options: { uri: string }): Promise<{
    path: string;
    title: string;
    mimeType: string;
    sourceUri: string;
  }>;
  getLocalVideoThumbnail(options: { path: string }): Promise<{ data: string }>;
  deleteLocalVideo(options: { path: string }): Promise<void>;
  prepareLocalVideo(options: {
    path: string;
    title: string;
    startPositionSeconds?: number;
    autoPlay?: boolean;
  }): Promise<void>;
  getCloudSessionToken(): Promise<{ token: string }>;
  setCloudSessionToken(options: { token: string }): Promise<void>;
  clearCloudSessionToken(): Promise<void>;
  getCloudSyncDisabled(): Promise<{ disabled: boolean }>;
  setCloudSyncDisabled(options: { disabled: boolean }): Promise<void>;
  configureTelegram(options: { apiId: number; apiHash: string }): Promise<void>;
  getAuthState(): Promise<TelegramNativeAuthState>;
  startLogin(): Promise<TelegramNativeAuthState>;
  setPhoneNumber(options: { phoneNumber: string }): Promise<void>;
  checkCode(options: { code: string }): Promise<void>;
  checkPassword(options: { password: string }): Promise<void>;
  logOut(): Promise<void>;
  signDeviceProof(options: { challenge: string; uid: string }): Promise<{ publicKey: string; signature: string }>;
  startBotVerification(options: { botUsername: string; challenge: string }): Promise<void>;
  inspectInviteLink(options: { inviteLink: string }): Promise<TelegramInviteInfo>;
  joinInviteLink(options: { inviteLink: string }): Promise<TelegramPrivateChannelReference>;
  getPublicChannelVideos(options: { username: string; fromMessageId?: string }): Promise<TelegramPrivateVideoFeed>;
  getJoinedChannelVideos(options: { chatId: string; fromMessageId?: string }): Promise<TelegramPrivateVideoFeed>;
  downloadChannelVideo(options: {
    fileId: number;
    chatId?: string;
    messageId?: string;
  }): Promise<{ path: string }>;
  saveChannelVideo(options: {
    fileId: number;
    itemId: string;
    chatId?: string;
    messageId?: string;
    title: string;
    mimeType?: string;
  }): Promise<{ location: string; playbackUrl: string }>;
  downloadRemoteVideo(options: {
    url: string;
    itemId: string;
    title: string;
    mimeType?: string;
  }): Promise<{ location: string; playbackUrl: string }>;
  openChannelVideoStream(options: { fileId: number }): Promise<{ token: string; size: number }>;
  readChannelVideoRange(options: { token: string; offset: number; length: number }): Promise<{ data: string }>;
  closeChannelVideoStream(options: { token: string }): Promise<void>;
  prepareTelegramVideo(options: {
    fileId?: number;
    chatId?: string;
    messageId?: string;
    mimeType?: string;
    title?: string;
    supportsStreaming?: boolean;
    startPositionSeconds?: number;
    autoPlay?: boolean;
  }): Promise<{ fileId: number }>;
  controlTelegramVideo(options: {
    action: 'play' | 'pause' | 'seek' | 'volume' | 'speed';
    value?: number;
  }): Promise<void>;
  setPictureInPicturePlaybackActive(options: { enabled: boolean; title?: string }): Promise<void>;
  setVideoPlaybackActive(options: { active: boolean }): Promise<void>;
  enterPictureInPicture(): Promise<void>;
  stopTelegramVideo(options: { fileId?: number }): Promise<void>;
  setScreenOrientationLock(options: { locked: boolean }): Promise<void>;
  addListener(
    eventName: 'authStateChanged',
    listener: (state: TelegramNativeAuthState) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'videoPlayerState',
    listener: (state: TelegramVideoPlayerState) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'downloadProgress',
    listener: (progress: TelegramDownloadProgress) => void,
  ): Promise<PluginListenerHandle>;
}

export const TelegramNative = registerPlugin<TelegramNativePlugin>('TelegramAuth');
