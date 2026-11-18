import React, { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { ArrowRightLeft, Check, Copy, DoorOpen, LoaderCircle, Play, Search, Shield, Trash2, Users, Video, X } from 'lucide-react';
import type { MediaItem } from '../types';
import {
  createWatchRoom,
  deleteWatchRoom,
  getWatchRoomSnapshot,
  joinWatchRoom,
  leaveWatchRoom,
  transferWatchRoomAdmin,
  updateWatchRoomPlayback,
  type WatchRoomSession,
  type WatchRoomSnapshot,
} from '../services/watchRoomApi';

const STORED_ROOM_KEY = 'amzy_watch_room_session';
const STORED_NICKNAME_KEY = 'amzy_watch_room_nickname';

interface WatchRoomPanelProps {
  isOpen: boolean;
  items: MediaItem[];
  initialRoomCode?: string | null;
  deleteRoomRequestCode?: string | null;
  leaveRoomRequestCode?: string | null;
  onClose: () => void;
  onRoomRemember: (room: Pick<WatchRoomSession, 'code' | 'nickname'>) => void;
  onRoomDelete: (code: string) => void;
  onDeleteRoomRequestHandled?: () => void;
  onLeaveRoomRequestHandled?: () => void;
  onSessionChange: (session: WatchRoomSession | null) => void;
  onSnapshot: (snapshot: WatchRoomSnapshot, session: WatchRoomSession) => void;
  onSelectVideo: (item: MediaItem) => void;
}

function isValidSession(value: unknown): value is WatchRoomSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<WatchRoomSession>;
  return typeof session.code === 'string'
    && typeof session.participantId === 'string'
    && typeof session.nickname === 'string'
    && (session.role === 'admin' || session.role === 'guest')
    && typeof session.token === 'string';
}

export const WatchRoomPanel: React.FC<WatchRoomPanelProps> = ({
  isOpen,
  items,
  initialRoomCode,
  deleteRoomRequestCode,
  leaveRoomRequestCode,
  onClose,
  onRoomRemember,
  onRoomDelete,
  onDeleteRoomRequestHandled,
  onLeaveRoomRequestHandled,
  onSessionChange,
  onSnapshot,
  onSelectVideo,
}) => {
  const [session, setSession] = useState<WatchRoomSession | null>(null);
  const [snapshot, setSnapshot] = useState<WatchRoomSnapshot | null>(null);
  const [nickname, setNickname] = useState(
    () => localStorage.getItem(STORED_NICKNAME_KEY) || '',
  );
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [videoSearchQuery, setVideoSearchQuery] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sessionRef = useRef(session);
  const snapshotCallbackRef = useRef(onSnapshot);
  const sessionCallbackRef = useRef(onSessionChange);
  const roomRememberCallbackRef = useRef(onRoomRemember);
  const roomDeleteCallbackRef = useRef(onRoomDelete);
  const selectVideoCallbackRef = useRef(onSelectVideo);
  const pollingRef = useRef(false);
  sessionRef.current = session;
  snapshotCallbackRef.current = onSnapshot;
  sessionCallbackRef.current = onSessionChange;
  roomRememberCallbackRef.current = onRoomRemember;
  roomDeleteCallbackRef.current = onRoomDelete;
  selectVideoCallbackRef.current = onSelectVideo;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORED_ROOM_KEY);
      if (!saved) return;
      const parsed: unknown = JSON.parse(saved);
      if (isValidSession(parsed)) {
        setSession(parsed);
        setNickname(parsed.nickname);
        localStorage.setItem(STORED_NICKNAME_KEY, parsed.nickname);
        roomRememberCallbackRef.current(parsed);
      }
      else localStorage.removeItem(STORED_ROOM_KEY);
    } catch (error) {
      console.error('Could not restore the watch room session:', error);
      localStorage.removeItem(STORED_ROOM_KEY);
    }
  }, []);

  useEffect(() => {
    if (!isOpen || !initialRoomCode || session) return;
    setRoomCodeInput(initialRoomCode);
    setErrorMessage(null);
    setNotice(null);
  }, [initialRoomCode, isOpen, session]);

  useEffect(() => {
    sessionRef.current = session;
    sessionCallbackRef.current(session);
    if (session) localStorage.setItem(STORED_ROOM_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORED_ROOM_KEY);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    let disposed = false;
    const poll = async () => {
      if (pollingRef.current) return;
      pollingRef.current = true;
      try {
        const nextSnapshot = await getWatchRoomSnapshot(session);
        if (disposed) return;
        const participantRole = nextSnapshot.participants.find(
          (participant) => participant.id === session.participantId,
        )?.role;
        const currentSession = participantRole && participantRole !== session.role
          ? { ...session, role: participantRole }
          : session;
        if (currentSession !== session) setSession(currentSession);
        setSnapshot(nextSnapshot);
        setErrorMessage(null);
        snapshotCallbackRef.current(nextSnapshot, currentSession);
        if (nextSnapshot.status === 'closed') {
          roomDeleteCallbackRef.current(nextSnapshot.code);
          setNotice('Room closed.');
          setSession(null);
        }
      } catch (error) {
        if (disposed) return;
        const message = error instanceof Error ? error.message : 'Could not refresh the room.';
        setErrorMessage(message);
        if (/session is invalid|rejoin the room/i.test(message)) {
          setSession(null);
          setSnapshot(null);
        }
      } finally {
        pollingRef.current = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [session]);

  const startSession = async (mode: 'create' | 'join') => {
    const code = roomCodeInput.trim().toUpperCase().replace(/[\s-]/g, '');
    if (!nickname.trim()) {
      setErrorMessage('Enter a nickname to join the room.');
      return;
    }
    if (mode === 'join' && !/^[A-Z2-9]{10}$/.test(code)) {
      setErrorMessage('Enter the 10-character room code shown by the room admin.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setNotice(null);
    try {
      const result = mode === 'create'
        ? await createWatchRoom(nickname)
        : await joinWatchRoom(code, nickname);
      localStorage.setItem(STORED_NICKNAME_KEY, nickname.trim());
      roomRememberCallbackRef.current({
        code: result.session.code,
        nickname: result.session.nickname,
      });
      setSession(result.session);
      setSnapshot(result.snapshot);
      sessionCallbackRef.current(result.session);
      snapshotCallbackRef.current(result.snapshot, result.session);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not open the watch room.';
      setErrorMessage(message);
      if (mode === 'join' && /closed|expired|not found/i.test(message)) {
        roomDeleteCallbackRef.current(code);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const startVideo = async () => {
    if (!session || session.role !== 'admin') return;
    const item = items.find((candidate) => candidate.id === selectedItemId);
    if (!item) {
      setErrorMessage('Choose a video first.');
      return;
    }
    const isPrivateTelegramVideo = !item.videoUrl && !item.rawVideoUrl
      && Boolean(item.telegramChatId && item.telegramId);
    if (isPrivateTelegramVideo && !Capacitor.isNativePlatform()) {
      setErrorMessage('Private Telegram video rooms can only be started in the Android app.');
      return;
    }

    const shareableItem = { ...item };
    for (const key of ['videoUrl', 'rawVideoUrl', 'poster', 'telegramLink'] as const) {
      const value = shareableItem[key];
      if (value && value.startsWith('/')) {
        shareableItem[key] = new URL(value, window.location.origin).toString();
      }
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const nextSnapshot = await updateWatchRoomPlayback(session, shareableItem, 0, true);
      setSnapshot(nextSnapshot);
      snapshotCallbackRef.current(nextSnapshot, session);
      selectVideoCallbackRef.current(shareableItem);
      setNotice('Video is syncing to everyone in the room.');
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not start the room video.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const exitRoom = async () => {
    if (!session) return;
    setIsSubmitting(true);
    try {
      await leaveWatchRoom(session);
      setSnapshot(null);
      setSession(null);
      setNotice('You left the room. It is still available for others to join.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not leave the room.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const removeRoom = async () => {
    if (!session || session.role !== 'admin') return;
    if (!window.confirm('Room ko permanently close karna hai? Iske baad koi join nahi kar payega.')) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await deleteWatchRoom(session);
      roomDeleteCallbackRef.current(session.code);
      setSnapshot(null);
      setSession(null);
      setNotice('Room deleted.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not delete the room.');
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (!deleteRoomRequestCode) return;
    onDeleteRoomRequestHandled?.();
    if (session?.code === deleteRoomRequestCode && session.role === 'admin') {
      void removeRoom();
    }
  }, [deleteRoomRequestCode]);

  useEffect(() => {
    if (!leaveRoomRequestCode) return;
    onLeaveRoomRequestHandled?.();
    if (session?.code === leaveRoomRequestCode) void exitRoom();
  }, [leaveRoomRequestCode]);

  const transferAdmin = async (participantId: string, participantNickname: string) => {
    if (!session || session.role !== 'admin' || participantId === session.participantId) return;
    if (!window.confirm(`Admin control ${participantNickname} ko dena hai? Iske baad woh playback control karega.`)) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const nextSnapshot = await transferWatchRoomAdmin(session, participantId);
      const role = nextSnapshot.participants.find(
        (participant) => participant.id === session.participantId,
      )?.role || 'guest';
      const nextSession = { ...session, role };
      setSession(nextSession);
      setSnapshot(nextSnapshot);
      snapshotCallbackRef.current(nextSnapshot, nextSession);
      setNotice(`Admin control ${participantNickname} ko de diya gaya.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Admin control transfer nahi ho saka.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyRoomCode = async () => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.code);
      setNotice('Room code copied.');
    } catch (error) {
      console.error('Could not copy the watch room code:', error);
      setNotice(`Share this room code: ${session.code}`);
    }
  };

  const shareableItems = items.filter((item) => item.type === 'video' && (
    item.videoUrl || item.rawVideoUrl || (item.telegramChatId && item.telegramId)
  ) && (
    Capacitor.isNativePlatform() || Boolean(item.videoUrl || item.rawVideoUrl)
  ));
  const normalizedVideoSearchQuery = videoSearchQuery.trim().toLocaleLowerCase();
  const filteredShareableItems = normalizedVideoSearchQuery
    ? shareableItems.filter((item) => (
      `${item.title} ${item.channel}`.toLocaleLowerCase().includes(normalizedVideoSearchQuery)
    ))
    : shareableItems;
  const adminParticipant = snapshot?.participants.find(
    (participant) => participant.id === snapshot.adminParticipantId,
  );

  return (
    <div
      className={`safe-area-overlay fixed inset-0 z-[70] flex items-center justify-center bg-black/75 backdrop-blur-sm ${
        isOpen ? '' : 'pointer-events-none invisible'
      }`}
      aria-hidden={!isOpen}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="watch-room-title"
        className="max-h-full w-full max-w-xl overflow-y-auto overscroll-contain rounded-2xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl sm:p-7"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-[0.2em] text-[#E50914]">AMZY Watch Party</p>
            <h2 id="watch-room-title" className="text-2xl font-bold text-white">Watch together</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Ek admin playback control karega; room mein max 10 log. Ek waqt mein ek hi room join rahega.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white"
            aria-label="Close watch room"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {session && snapshot ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-700 bg-zinc-900/70 p-4">
              <div>
                <p className="text-xs text-zinc-400">Room code</p>
                <p className="font-mono text-2xl font-black tracking-[0.2em] text-white">{session.code}</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-zinc-300">
                  <Shield className="h-3.5 w-3.5 text-amber-400" />
                  Admin: <span className="font-semibold text-white">{adminParticipant?.nickname || 'Offline'}</span>
                  <span className="ml-1 text-zinc-500">· {snapshot.participants.length}/10 members</span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void copyRoomCode()}
                  className="flex items-center gap-2 rounded-lg border border-zinc-600 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
                >
                  <Copy className="h-4 w-4" /> Copy code
                </button>
                {session.role === 'admin' && (
                  <button
                    type="button"
                    onClick={() => void removeRoom()}
                    disabled={isSubmitting}
                    className="flex items-center gap-2 rounded-lg border border-red-900/80 px-3 py-2 text-sm font-semibold text-red-300 hover:bg-red-950/60 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" /> Delete room
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void exitRoom()}
                  disabled={isSubmitting}
                  className="flex items-center gap-2 rounded-lg border border-red-900/80 px-3 py-2 text-sm font-semibold text-red-300 hover:bg-red-950/60 disabled:opacity-50"
                >
                  <DoorOpen className="h-4 w-4" /> Leave room
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 font-semibold text-white">
                  <Users className="h-4 w-4 text-zinc-300" /> Participants
                </h3>
                <span className="text-xs text-zinc-400">{snapshot.participants.length} member{snapshot.participants.length === 1 ? '' : 's'} online</span>
              </div>
              <ul className="space-y-2">
                {snapshot.participants.map((participant) => (
                  <li key={participant.id} className="flex items-center justify-between rounded-lg bg-black/30 px-3 py-2">
                    <span className="truncate text-sm text-zinc-100">{participant.nickname}</span>
                    <span className="ml-3 flex shrink-0 items-center gap-2">
                      <span className="flex items-center gap-1 text-[11px] font-medium text-zinc-400">
                        {participant.role === 'admin' && <Shield className="h-3.5 w-3.5 text-amber-400" />}
                        {participant.role === 'admin' ? 'Admin' : participant.platform === 'android' ? 'Android' : 'Browser'}
                      </span>
                      {session.role === 'admin' && participant.role !== 'admin' && (
                        <button
                          type="button"
                          onClick={() => void transferAdmin(participant.id, participant.nickname)}
                          disabled={isSubmitting}
                          className="flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[10px] font-semibold text-zinc-200 hover:border-amber-500 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label={`Transfer admin control to ${participant.nickname}`}
                          title={`Transfer admin control to ${participant.nickname}`}
                        >
                          <ArrowRightLeft className="h-3 w-3" />
                          Make admin
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {session.role === 'admin' ? (
              <div className="space-y-3 rounded-xl border border-zinc-800 p-4">
                <label htmlFor="watch-room-video" className="block text-sm font-semibold text-white">
                  Search and choose a video for everyone
                </label>
                <input
                  type="search"
                  aria-label="Search room videos"
                  value={videoSearchQuery}
                  onChange={(event) => {
                    setVideoSearchQuery(event.target.value);
                    setSelectedItemId('');
                  }}
                  placeholder="Search by movie or channel name"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-[#E50914]"
                />
                <p className="text-xs text-zinc-500" aria-live="polite">
                  {filteredShareableItems.length} video{filteredShareableItems.length === 1 ? '' : 's'} found
                </p>
                <div className="max-h-72 overflow-y-auto rounded-lg border border-zinc-800 bg-black/30 p-2">
                  {filteredShareableItems.length > 0 ? (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {filteredShareableItems.map((item) => {
                        const isSelected = selectedItemId === item.id;
                        const thumbnail = item.poster || item.photoUrl || item.backdrop;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setSelectedItemId(item.id)}
                            aria-pressed={isSelected}
                            className={`group flex min-w-0 items-center gap-3 overflow-hidden rounded-lg border p-2 text-left transition-colors ${
                              isSelected
                                ? 'border-[#E50914] bg-[#E50914]/10'
                                : 'border-zinc-800 bg-zinc-900 hover:border-zinc-600'
                            }`}
                          >
                            <span className="relative h-16 w-28 shrink-0 overflow-hidden rounded bg-zinc-950">
                              {thumbnail ? (
                                <img
                                  src={thumbnail}
                                  alt=""
                                  loading="lazy"
                                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                                />
                              ) : (
                                <Video className="absolute inset-0 m-auto h-6 w-6 text-zinc-600" />
                              )}
                              {item.duration && (
                                <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 text-[10px] text-white">
                                  {item.duration}
                                </span>
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-white">{item.title}</span>
                              <span className="mt-1 block truncate text-xs text-zinc-400">
                                {item.channel ? `@${item.channel}` : 'Telegram video'}
                              </span>
                            </span>
                            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                              isSelected
                                ? 'border-[#E50914] bg-[#E50914] text-white'
                                : 'border-zinc-600 text-transparent'
                            }`}>
                              {isSelected ? <Check className="h-4 w-4" /> : <Search className="h-3.5 w-3.5" />}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="px-3 py-8 text-center text-sm text-zinc-500">
                      No matching videos. Dusra title ya channel search karein.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void startVideo()}
                  disabled={!selectedItemId || isSubmitting}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#E50914] px-4 py-3 font-bold text-white hover:bg-[#b81d24] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  Start room video
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-300">
                <Video className="h-5 w-5 shrink-0 text-[#E50914]" />
                {snapshot.video
                  ? `Admin is sharing: ${snapshot.video.title}. Playback will stay in sync.`
                  : 'Admin will choose a video. Keep this room open to stay connected.'}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <label htmlFor="watch-room-nickname" className="block text-sm font-semibold text-white">
              Your nickname
            </label>
            <input
              id="watch-room-nickname"
              maxLength={32}
              value={nickname}
              onChange={(event) => {
                setNickname(event.target.value);
                setErrorMessage(null);
              }}
              placeholder="Enter a nickname"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none focus:border-[#E50914]"
            />
            <button
              type="button"
              onClick={() => void startSession('create')}
              disabled={!nickname.trim() || isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#E50914] px-4 py-3 font-bold text-white hover:bg-[#b81d24] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
              Create room
            </button>
            <div className="flex items-center gap-3 py-1 text-xs uppercase tracking-wider text-zinc-500">
              <span className="h-px flex-1 bg-zinc-800" /> or join with code <span className="h-px flex-1 bg-zinc-800" />
            </div>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void startSession('join');
              }}
            >
              <input
                aria-label="Room code"
                maxLength={20}
                value={roomCodeInput}
                onChange={(event) => {
                  setRoomCodeInput(event.target.value.toUpperCase().replace(/[\s-]/g, '').slice(0, 10));
                  setErrorMessage(null);
                }}
                placeholder="10-character code"
                className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 font-mono text-sm uppercase tracking-wider text-white outline-none focus:border-[#E50914]"
              />
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex items-center justify-center rounded-lg border border-zinc-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : 'Join'}
              </button>
            </form>
            <p className="text-xs text-zinc-500">
              Nickname aur sahi 10-character code zaroori hai. Spaces aur hyphens ignore honge.
              Room switch karne ke liye pehle current room se Leave karein.
            </p>
          </div>
        )}

        {errorMessage && (
          <p role="alert" className="mt-4 rounded-lg border border-red-900/70 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            {errorMessage}
          </p>
        )}
        {notice && <p role="status" className="mt-3 text-sm text-emerald-300">{notice}</p>}
        <p className="mt-5 text-xs leading-relaxed text-zinc-500">
          Private Telegram videos ke liye har participant ko apne Android device par Telegram account se us group/video ka access chahiye. Browser users private-video rooms join nahi kar sakte.
        </p>
      </section>
    </div>
  );
};
