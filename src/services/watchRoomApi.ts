import { getBackendUrl } from './backendApi';
import type { MediaItem } from '../types';

export interface WatchRoomSession {
  code: string;
  participantId: string;
  nickname: string;
  role: 'admin' | 'guest';
  token: string;
}

export interface WatchRoomParticipant {
  id: string;
  nickname: string;
  role: 'admin' | 'guest';
  platform: 'android' | 'browser';
}

export interface WatchRoomSnapshot {
  code: string;
  status: 'active' | 'closed';
  adminParticipantId: string;
  participants: WatchRoomParticipant[];
  video: MediaItem | null;
  currentTime: number;
  isPlaying: boolean;
  revision: number;
}

async function request<T>(
  path: string,
  token?: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(getBackendUrl(path), { ...init, headers });
  const data = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) {
    throw new Error(data.error || `Watch room request failed (${response.status}).`);
  }
  return data;
}

export async function createWatchRoom(nickname: string): Promise<{
  session: WatchRoomSession;
  snapshot: WatchRoomSnapshot;
}> {
  return request('/watch/rooms', undefined, {
    method: 'POST',
    body: JSON.stringify({ nickname }),
  });
}

export async function joinWatchRoom(code: string, nickname: string): Promise<{
  session: WatchRoomSession;
  snapshot: WatchRoomSnapshot;
}> {
  return request(`/watch/rooms/${encodeURIComponent(code)}/join`, undefined, {
    method: 'POST',
    body: JSON.stringify({ nickname }),
  });
}

export function getWatchRoomSnapshot(session: WatchRoomSession): Promise<WatchRoomSnapshot> {
  return request(`/watch/rooms/${encodeURIComponent(session.code)}`, session.token);
}

export function updateWatchRoomPlayback(
  session: WatchRoomSession,
  video: MediaItem,
  currentTime: number,
  isPlaying: boolean,
): Promise<WatchRoomSnapshot> {
  return request(`/watch/rooms/${encodeURIComponent(session.code)}/playback`, session.token, {
    method: 'POST',
    body: JSON.stringify({ video, currentTime, isPlaying }),
  });
}

export function leaveWatchRoom(session: WatchRoomSession): Promise<{ success: boolean }> {
  return request(`/watch/rooms/${encodeURIComponent(session.code)}/leave`, session.token, {
    method: 'POST',
  });
}

export function deleteWatchRoom(session: WatchRoomSession): Promise<{ success: boolean }> {
  return request(`/watch/rooms/${encodeURIComponent(session.code)}`, session.token, {
    method: 'DELETE',
  });
}

export function transferWatchRoomAdmin(
  session: WatchRoomSession,
  participantId: string,
): Promise<WatchRoomSnapshot> {
  return request(`/watch/rooms/${encodeURIComponent(session.code)}/transfer-admin`, session.token, {
    method: 'POST',
    body: JSON.stringify({ participantId }),
  });
}
