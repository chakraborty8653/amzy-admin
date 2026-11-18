import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX, Maximize, Minimize,
  ArrowLeft, Send, SkipForward, MessageSquare, PictureInPicture, Check,
  LockKeyhole, LockKeyholeOpen, LogOut,
} from 'lucide-react';
import { MediaItem } from '../types';
import { TelegramNative, type TelegramVideoPlayerState } from '../services/telegramNative';

interface NetflixPlayerProps {
  item: MediaItem;
  allChannelItems: MediaItem[];
  onClose: () => void;
  onSelectNextItem: (item: MediaItem) => void;
  onUpdateProgress: (itemId: string, percent: number, positionSeconds: number) => void;
  resumePositionSeconds: number;
  isWatchRoomGuest?: boolean;
  onLeaveWatchRoom?: () => void;
  roomPlaybackNeedsJoin?: boolean;
  roomPlaybackStartPositionSeconds?: number;
  roomPlaybackStartPaused?: boolean;
  roomPlayback?: {
    revision: number;
    currentTime: number;
    isPlaying: boolean;
  } | null;
  onRoomPlaybackState?: (item: MediaItem, currentTime: number, isPlaying: boolean) => void;
  onJoinRoomPlayback?: () => void;
}

export const NetflixPlayer: React.FC<NetflixPlayerProps> = ({
  item,
  allChannelItems,
  onClose,
  onSelectNextItem,
  onUpdateProgress,
  resumePositionSeconds,
  isWatchRoomGuest = false,
  onLeaveWatchRoom,
  roomPlaybackNeedsJoin = false,
  roomPlayback = null,
  roomPlaybackStartPositionSeconds,
  roomPlaybackStartPaused = false,
  onRoomPlaybackState,
  onJoinRoomPlayback,
}) => {
  const isNativePlayback = Boolean(
    (item.telegramNativePlayback || item.localNativePlayback) && Capacitor.isNativePlatform(),
  );
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const onSelectNextItemRef = useRef(onSelectNextItem);
  const onUpdateProgressRef = useRef(onUpdateProgress);
  const onCloseRef = useRef(onClose);
  const onRoomPlaybackStateRef = useRef(onRoomPlaybackState);
  const resumePositionRef = useRef(resumePositionSeconds);
  onSelectNextItemRef.current = onSelectNextItem;
  onUpdateProgressRef.current = onUpdateProgress;
  onCloseRef.current = onClose;
  onRoomPlaybackStateRef.current = onRoomPlaybackState;
  resumePositionRef.current = resumePositionSeconds;

  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isRotationLocked, setIsRotationLocked] = useState(false);
  const [orientationLockError, setOrientationLockError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showCaptionOverlay, setShowCaptionOverlay] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isWaitingForRoomPlayback, setIsWaitingForRoomPlayback] = useState(
    isWatchRoomGuest,
  );
  const [hasJoinedRoomPlayback, setHasJoinedRoomPlayback] = useState(!isWatchRoomGuest);
  const [hasError, setHasError] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const isWaitingForRoomPlaybackRef = useRef(isWaitingForRoomPlayback);
  isWaitingForRoomPlaybackRef.current = isWaitingForRoomPlayback;
  const hasJoinedRoomPlaybackRef = useRef(hasJoinedRoomPlayback);
  hasJoinedRoomPlaybackRef.current = hasJoinedRoomPlayback;
  const roomPlaybackRef = useRef(roomPlayback);
  roomPlaybackRef.current = roomPlayback;
  const roomPlaybackStartPositionRef = useRef(roomPlaybackStartPositionSeconds);
  roomPlaybackStartPositionRef.current = roomPlaybackStartPositionSeconds;
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Find next item in current channel
  const currentIndex = allChannelItems.findIndex((i) => i.id === item.id);
  const nextItem = currentIndex !== -1 && currentIndex < allChannelItems.length - 1
    ? allChannelItems[currentIndex + 1]
    : null;
  const nextItemRef = useRef(nextItem);
  nextItemRef.current = nextItem;

  // Format seconds to mm:ss or hh:mm:ss
  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return null;
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const size = bytes / (1024 ** unitIndex);
    return `${size.toFixed(unitIndex < 2 ? 0 : 1)} ${units[unitIndex]}`;
  };

  // Hide controls on inactivity
  const resetControlsTimeout = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
        setShowSpeedMenu(false);
      }
    }, 3500);
  }, [isPlaying]);

  useEffect(() => {
    resetControlsTimeout();
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [resetControlsTimeout]);

  // Video playback listeners
  useEffect(() => {
    if (isNativePlayback) return;
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      onRoomPlaybackStateRef.current?.(item, video.currentTime, !video.paused);
      if (video.duration > 0 && video.currentTime > 0) {
        const percent = Math.max(1, Math.floor((video.currentTime / video.duration) * 100));
        onUpdateProgress(item.id, percent, video.currentTime);
      }
    };

    const onLoadedMetadata = () => {
      setDuration(video.duration);
      setIsLoading(false);
      const resumePosition = isWaitingForRoomPlaybackRef.current
        ? roomPlaybackRef.current?.currentTime ?? roomPlaybackStartPositionRef.current ?? 0
        : roomPlaybackStartPositionRef.current ?? resumePositionRef.current;
      if (resumePosition > 0 && resumePosition < video.duration) {
        video.currentTime = resumePosition;
        setCurrentTime(resumePosition);
      }
      if ((isWatchRoomGuest && !hasJoinedRoomPlaybackRef.current)
        || isWaitingForRoomPlaybackRef.current
        || roomPlaybackStartPaused) {
        video.pause();
        setIsPlaying(false);
      } else {
        video.play().catch(() => setIsPlaying(false));
      }
    };

    const onWaiting = () => setIsLoading(true);
    const onPlaying = () => {
      setIsLoading(false);
      setIsPlaying(true);
      onRoomPlaybackStateRef.current?.(item, video.currentTime, true);
      if (Capacitor.isNativePlatform()) {
        void TelegramNative.setPictureInPicturePlaybackActive({ enabled: true, title: item.title })
          .catch((error: unknown) => console.warn('Could not enable Android picture-in-picture:', error));
        if (Capacitor.getPlatform() === 'android') {
          void TelegramNative.setVideoPlaybackActive({ active: true })
            .catch((error: unknown) => console.error('Could not keep the screen awake during playback:', error));
        }
      }
    };
    const onPause = () => {
      setIsPlaying(false);
      onRoomPlaybackStateRef.current?.(item, video.currentTime, false);
      if (video.duration > 0 && video.currentTime > 0) {
        const percent = video.ended
          ? 100
          : Math.max(1, Math.floor((video.currentTime / video.duration) * 100));
        onUpdateProgress(item.id, percent, video.currentTime);
      }
      if (Capacitor.isNativePlatform()) {
        void TelegramNative.setPictureInPicturePlaybackActive({ enabled: false })
          .catch((error: unknown) => console.warn('Could not disable Android picture-in-picture:', error));
        if (Capacitor.getPlatform() === 'android') {
          void TelegramNative.setVideoPlaybackActive({ active: false })
            .catch((error: unknown) => console.error('Could not restore the screen timeout after playback:', error));
        }
      }
    };
    const onEnded = () => {
      setIsPlaying(false);
      onRoomPlaybackStateRef.current?.(item, video.currentTime, false);
      onUpdateProgress(item.id, 100, video.duration);
      if (Capacitor.isNativePlatform()) {
        void TelegramNative.setPictureInPicturePlaybackActive({ enabled: false })
          .catch((error: unknown) => console.warn('Could not disable Android picture-in-picture:', error));
        if (Capacitor.getPlatform() === 'android') {
          void TelegramNative.setVideoPlaybackActive({ active: false })
            .catch((error: unknown) => console.error('Could not restore the screen timeout after playback:', error));
        }
      }
      if (nextItem && !isWatchRoomGuest) {
        onSelectNextItem(nextItem);
      }
    };
    const onError = () => {
      setIsLoading(false);
      setHasError(true);
      setPlayerError('The video could not be decoded or streamed.');
      if (Capacitor.getPlatform() === 'android') {
        void TelegramNative.setVideoPlaybackActive({ active: false })
          .catch((error: unknown) => console.error('Could not restore the screen timeout after playback:', error));
      }
    };

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
      if (Capacitor.isNativePlatform()) {
        void TelegramNative.setPictureInPicturePlaybackActive({ enabled: false })
          .catch((error: unknown) => console.warn('Could not disable Android picture-in-picture:', error));
        if (Capacitor.getPlatform() === 'android') {
          void TelegramNative.setVideoPlaybackActive({ active: false })
            .catch((error: unknown) => console.error('Could not restore the screen timeout after playback:', error));
        }
      }
    };
  }, [isNativePlayback, isWatchRoomGuest, item, nextItem, onSelectNextItem, onUpdateProgress, roomPlaybackStartPaused]);

  useEffect(() => {
    if (!isNativePlayback) return;
    let listener: { remove: () => Promise<void> } | undefined;
    let lastEnded = false;
    let disposed = false;

    const handleState = (state: TelegramVideoPlayerState) => {
      if (disposed) return;
      if (state.closed) {
        onCloseRef.current();
        return;
      }
      setCurrentTime(state.currentTime);
      setDuration(state.duration);
      setIsPlaying(state.isPlaying);
      setIsLoading(state.isLoading);
      onRoomPlaybackStateRef.current?.(item, state.currentTime, state.isPlaying);
      if (state.duration > 0 && state.currentTime > 0) {
        onUpdateProgressRef.current(
          item.id,
          Math.max(1, Math.floor((state.currentTime / state.duration) * 100)),
          state.currentTime,
        );
      }
      if (state.error) {
        setHasError(true);
        setIsLoading(false);
        setPlayerError(state.error);
      } else if (state.isLoading) {
        setHasError(false);
        setPlayerError(null);
      }
      if (state.ended && !lastEnded) {
        lastEnded = true;
        if (state.duration > 0) {
          onUpdateProgressRef.current(item.id, 100, state.duration);
        }
        if (nextItemRef.current) onSelectNextItemRef.current(nextItemRef.current);
      }
    };

    void TelegramNative.addListener('videoPlayerState', (state) => {
      handleState(state);
    }).then((handle) => {
      if (disposed) {
        void handle.remove();
        return;
      }
      listener = handle;
      return TelegramNative.controlTelegramVideo({
        action: isWatchRoomGuest && !hasJoinedRoomPlaybackRef.current
          || isWaitingForRoomPlaybackRef.current
          || roomPlaybackStartPaused
          ? 'pause'
          : 'play',
      });
    }).catch((error: unknown) => {
      if (disposed) return;
      console.error('Could not start native Telegram playback:', error);
      setHasError(true);
      setIsLoading(false);
    });

    return () => {
      disposed = true;
      if (listener) void listener.remove();
      if (isNativePlayback) void TelegramNative.stopTelegramVideo({ fileId: item.telegramFileId });
    };
  }, [isNativePlayback, isWatchRoomGuest, item, item.id, item.telegramFileId, roomPlaybackStartPaused]);

  useEffect(() => {
    if (!isWatchRoomGuest || !roomPlayback) return;
    if (!hasJoinedRoomPlaybackRef.current || isWaitingForRoomPlayback) {
      if (isNativePlayback) {
        void TelegramNative.controlTelegramVideo({ action: 'seek', value: Math.max(0, roomPlayback.currentTime) });
        void TelegramNative.controlTelegramVideo({ action: 'pause' });
      } else {
        const video = videoRef.current;
        if (video) {
          if (Number.isFinite(roomPlayback.currentTime)) video.currentTime = Math.max(0, roomPlayback.currentTime);
          video.pause();
        }
      }
      setCurrentTime(Math.max(0, roomPlayback.currentTime));
      setIsPlaying(false);
      return;
    }
    if (isNativePlayback) {
      if (Math.abs(currentTimeRef.current - roomPlayback.currentTime) > 2) {
        void TelegramNative.controlTelegramVideo({
          action: 'seek',
          value: Math.max(0, roomPlayback.currentTime),
        });
      }
      void TelegramNative.controlTelegramVideo({ action: roomPlayback.isPlaying ? 'play' : 'pause' });
      return;
    }

    const video = videoRef.current;
    if (!video) return;
    if (Number.isFinite(roomPlayback.currentTime) && Math.abs(video.currentTime - roomPlayback.currentTime) > 2) {
      video.currentTime = Math.max(0, roomPlayback.currentTime);
    }
    if (roomPlayback.isPlaying && video.paused) {
      void video.play().catch((error: unknown) => {
        console.warn('Room playback could not start in this browser:', error);
      });
    } else if (!roomPlayback.isPlaying && !video.paused) {
      video.pause();
    }
  }, [isNativePlayback, isWatchRoomGuest, isWaitingForRoomPlayback, hasJoinedRoomPlayback, roomPlayback?.revision]);

  useEffect(() => {
    if (!isWatchRoomGuest) {
      setIsWaitingForRoomPlayback(false);
      setHasJoinedRoomPlayback(true);
      return;
    }
    if (!roomPlaybackNeedsJoin && hasJoinedRoomPlaybackRef.current) return;
    setIsWaitingForRoomPlayback(true);
    setHasJoinedRoomPlayback(false);
    hasJoinedRoomPlaybackRef.current = false;
    if (isNativePlayback) {
      void TelegramNative.controlTelegramVideo({ action: 'pause' });
      if (roomPlayback) {
        void TelegramNative.controlTelegramVideo({
          action: 'seek',
          value: Math.max(0, roomPlayback.currentTime),
        });
      }
    } else {
      const video = videoRef.current;
      if (video) {
        video.pause();
        if (roomPlayback) video.currentTime = Math.max(0, roomPlayback.currentTime);
      }
    }
  }, [isNativePlayback, isWatchRoomGuest, roomPlayback?.revision, roomPlaybackNeedsJoin]);

  useEffect(() => {
    setIsLoading(true);
    setHasError(false);
    setPlayerError(null);
    setIsPlaying(true);
    setCurrentTime(0);
    setDuration(0);
  }, [item.id, item.videoUrl, isNativePlayback]);

  useEffect(() => () => {
    if (Capacitor.isNativePlatform()) {
      void TelegramNative.setScreenOrientationLock({ locked: false }).catch((error: unknown) => {
        console.error('Could not restore screen rotation after playback:', error);
      });
    }
  }, []);

  const toggleRotationLock = async () => {
    const locked = !isRotationLocked;
    try {
      await TelegramNative.setScreenOrientationLock({ locked });
      setIsRotationLocked(locked);
      setOrientationLockError(null);
    } catch (error) {
      console.error('Could not change screen rotation lock:', error);
      setOrientationLockError(error instanceof Error ? error.message : 'Could not change screen rotation lock.');
    }
  };

  // Keyboard shortcuts (Netflix standards: Space, Left/Right, F, M, Esc)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      resetControlsTimeout();
      if (e.code === 'Space' || e.key === 'k') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowLeft' || e.key === 'j') {
        skipTime(-10);
      } else if (e.code === 'ArrowRight' || e.key === 'l') {
        skipTime(10);
      } else if (e.key === 'f') {
        toggleFullscreen();
      } else if (e.key === 'm') {
        toggleMute();
      } else if (e.key === 'Escape') {
        if (isFullscreen) {
          document.exitFullscreen?.();
        } else {
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen, isPlaying, onClose, resetControlsTimeout]);

  const togglePlay = () => {
    if (isWatchRoomGuest && !hasJoinedRoomPlayback) {
      const joinPosition = roomPlayback?.currentTime ?? roomPlaybackStartPositionSeconds ?? 0;
      if (isNativePlayback) {
        if (joinPosition > 0) void TelegramNative.controlTelegramVideo({ action: 'seek', value: joinPosition });
        void TelegramNative.controlTelegramVideo({ action: 'play' });
      } else if (videoRef.current) {
        if (joinPosition > 0) videoRef.current.currentTime = joinPosition;
        void videoRef.current.play().catch((error: unknown) => {
          console.error('Room video could not start after joining playback:', error);
          setPlayerError('Video Play nahi ho saki. Dobara Play karein.');
        });
      }
      hasJoinedRoomPlaybackRef.current = true;
      setHasJoinedRoomPlayback(true);
      setIsWaitingForRoomPlayback(false);
      setCurrentTime(joinPosition);
      setIsPlaying(true);
      onJoinRoomPlayback?.();
      return;
    }
    if (isWatchRoomGuest) return;
    if (isNativePlayback) {
      void TelegramNative.controlTelegramVideo({ action: isPlaying ? 'pause' : 'play' });
      setIsPlaying(!isPlaying);
      return;
    }
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  const skipTime = (seconds: number) => {
    if (isWatchRoomGuest) return;
    if (isNativePlayback) {
      const targetTime = Math.max(0, currentTime + seconds);
      void TelegramNative.controlTelegramVideo({
        action: 'seek',
        value: duration > 0 ? Math.min(duration, targetTime) : targetTime,
      });
      return;
    }
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, Math.min(duration, videoRef.current.currentTime + seconds));
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isWatchRoomGuest) return;
    if (duration <= 0) return;
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (isNativePlayback) {
      void TelegramNative.controlTelegramVideo({ action: 'seek', value: time });
    } else if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (isNativePlayback) {
      void TelegramNative.controlTelegramVideo({ action: 'volume', value: val });
      setIsMuted(val === 0);
    } else if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
      setIsMuted(val === 0);
    }
  };

  const toggleMute = () => {
    if (isNativePlayback) {
      const nextMuted = !isMuted;
      const nextVolume = nextMuted ? 0 : (volume || 0.8);
      void TelegramNative.controlTelegramVideo({ action: 'volume', value: nextVolume });
      setIsMuted(nextMuted);
      return;
    }
    if (!videoRef.current) return;
    if (isMuted) {
      videoRef.current.muted = false;
      setIsMuted(false);
      videoRef.current.volume = volume || 0.8;
    } else {
      videoRef.current.muted = true;
      setIsMuted(true);
    }
  };

  const setSpeed = (speed: number) => {
    if (isWatchRoomGuest) return;
    setPlaybackSpeed(speed);
    if (isNativePlayback) {
      void TelegramNative.controlTelegramVideo({ action: 'speed', value: speed });
    } else if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
    setShowSpeedMenu(false);
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const togglePiP = async () => {
    if (isNativePlayback) {
      try {
        await TelegramNative.enterPictureInPicture();
      } catch (error) {
        console.warn('Android picture-in-picture could not start:', error);
      }
      return;
    }
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (e) {
      console.warn('PiP not supported or failed:', e);
    }
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const videoSrc = item.videoUrl || item.rawVideoUrl || '';
  const videoSizeLabel = formatFileSize(item.telegramFileSize ?? 0);

  useEffect(() => {
    setIsWaitingForRoomPlayback(isWatchRoomGuest && (roomPlaybackNeedsJoin || !hasJoinedRoomPlaybackRef.current));
  }, [isWatchRoomGuest, item.id, roomPlaybackNeedsJoin]);

  return (
    <div
      ref={containerRef}
      onMouseMove={resetControlsTimeout}
      onClick={resetControlsTimeout}
      className={`native-video-overlay fixed inset-0 z-50 flex items-center justify-center select-none overflow-hidden ${isNativePlayback ? 'bg-transparent' : 'bg-black'}`}
    >
      {/* Video Element */}
      {isNativePlayback ? (
        <div className="w-full h-full bg-transparent" />
      ) : videoSrc ? (
        <video
          ref={videoRef}
          src={videoSrc}
          poster={item.poster || item.photoUrl}
          playsInline
          autoPlay={
            (!isWatchRoomGuest || hasJoinedRoomPlayback)
            && !isWaitingForRoomPlayback
            && !roomPlaybackStartPaused
          }
          className="w-full h-full object-contain cursor-pointer"
          onClick={togglePlay}
          onDoubleClick={(event) => {
            event.preventDefault();
            const midpoint = event.currentTarget.getBoundingClientRect().left
              + event.currentTarget.getBoundingClientRect().width / 2;
            skipTime(event.clientX < midpoint ? -10 : 10);
          }}
        />
      ) : (
        <div className="text-center p-6 space-y-4 max-w-md">
          <p className="text-zinc-400">This Telegram post contains a photo or audio instead of direct video stream.</p>
          {item.photoUrl && (
            <img src={item.photoUrl} alt={item.title} className="rounded-lg max-h-[60vh] mx-auto shadow-2xl" />
          )}
        </div>
      )}

      {/* Loading Spinner */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/40">
          <div className="flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-black/75 px-5 py-4 text-center shadow-xl">
            <div className="w-12 h-12 border-4 border-[#E50914] border-t-transparent rounded-full animate-spin" />
            <span className="text-sm font-semibold text-white">Live stream buffering...</span>
            {videoSizeLabel && (
              <span className="text-xs text-zinc-300">Video size: {videoSizeLabel}</span>
            )}
          </div>
        </div>
      )}

      {/* Error Fallback */}
      {hasError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/95 text-center p-6 space-y-4 z-40">
          <div className="w-16 h-16 rounded-full bg-red-950/60 border border-red-500/50 flex items-center justify-center text-[#E50914] text-2xl">
            !
          </div>
          <h3 className="text-xl font-bold text-white">Stream Unavailable</h3>
          <p className="text-sm text-zinc-400 max-w-md">
            {playerError || 'This Telegram video may have expired or requires channel authorization. You can open and stream it directly in the Telegram app.'}
          </p>
          {item.telegramLink && (
            <a
              href={item.telegramLink}
              target="_blank"
              rel="noreferrer"
              className="flex items-center space-x-2 bg-[#0088cc] hover:bg-[#0077b5] text-white px-5 py-2.5 rounded-md font-semibold text-sm transition-all shadow-lg"
            >
              <Send className="w-4 h-4" />
              <span>Watch on Telegram</span>
            </a>
          )}
          <button
            onClick={onClose}
            className="text-xs text-zinc-400 hover:text-white underline pt-2"
          >
            Go Back
          </button>
        </div>
      )}

      {/* Caption / Telegram Message Subtitle Overlay (toggleable) */}
      {!item.localVideo && showCaptionOverlay && item.caption && (
        <div className="absolute bottom-24 sm:bottom-28 left-4 right-4 sm:left-12 sm:right-12 pointer-events-none flex justify-center z-20">
          <div className="bg-black/75 backdrop-blur-md border border-zinc-800 text-zinc-100 text-xs sm:text-sm px-4 py-2 rounded-lg max-w-xl text-center shadow-2xl line-clamp-2">
            <span className="text-[#E50914] font-bold mr-1.5 font-mono text-[11px]">TELEGRAM CAPTION:</span>
            {item.caption}
          </div>
        </div>
      )}

      {/* Overlay UI Controls (Fade in/out on hover or touch) */}
      <div
        className={`safe-area-overlay absolute inset-0 flex flex-col justify-between transition-opacity duration-300 pointer-events-none ${
          showControls ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {/* Top Bar: Back button, Channel Badge, Title, Direct Telegram Link */}
        <div className="flex items-center justify-between pointer-events-auto bg-gradient-to-b from-black/80 to-transparent -mx-4 -mt-4 px-6 pt-4 pb-8 sm:-mx-6 sm:-mt-6">
          <div className="flex items-center space-x-4 min-w-0">
            <button
              onClick={onClose}
              className="p-2 -ml-2 rounded-full hover:bg-white/10 text-white transition-colors"
              title="Back"
            >
              <ArrowLeft className="w-6 h-6 sm:w-7 sm:h-7" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center space-x-2">
                <span className="bg-[#E50914] text-white text-[9px] font-black px-1.5 py-0.2 rounded">
                  NETFLIX PLAYER
                </span>
                {isWatchRoomGuest && (
                  <span className="rounded bg-emerald-950/80 px-2 py-0.5 text-[9px] font-bold text-emerald-300">
                    SYNCED BY ROOM ADMIN
                  </span>
                )}
                <span className="text-zinc-400 text-xs font-medium truncate flex items-center space-x-1">
                  <Send className="w-3 h-3 text-[#0088cc]" />
                  <span>@{item.channel}</span>
                </span>
              </div>
              <h2 className="text-sm sm:text-lg font-bold text-white truncate max-w-md sm:max-w-xl">
                {item.title}
              </h2>
              {videoSizeLabel && (
                <span className="mt-0.5 block text-[11px] font-medium text-zinc-300">
                  Video size: {videoSizeLabel}
                </span>
              )}
            </div>
          </div>
          {isWatchRoomGuest && onLeaveWatchRoom && (
            <button
              type="button"
              onClick={onLeaveWatchRoom}
              className="ml-3 flex shrink-0 items-center gap-2 rounded-lg border border-red-900/80 bg-black/50 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-950/70"
            >
              <LogOut className="h-4 w-4" />
              Leave room
            </button>
          )}

          <div className="flex items-center space-x-3">
            {item.telegramLink && (
              <a
                href={item.telegramLink}
                target="_blank"
                rel="noreferrer"
                className="hidden sm:flex items-center space-x-1.5 bg-[#0088cc]/20 border border-[#0088cc]/50 hover:bg-[#0088cc]/30 text-sky-200 text-xs font-semibold px-3 py-1.5 rounded transition-colors"
                title="Open post in Telegram"
              >
                <Send className="w-3.5 h-3.5 text-[#0088cc]" />
                <span>Open in Telegram</span>
              </a>
            )}
          </div>
        </div>

        {/* Center Big Play/Pause Button (Click anywhere also triggers) */}
        <div className="flex flex-col items-center justify-center gap-3 pointer-events-auto">
          <button
            onClick={togglePlay}
            disabled={isLoading || (isWatchRoomGuest && hasJoinedRoomPlayback)}
            className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-black/60 hover:bg-black/80 border border-white/20 flex items-center justify-center text-white backdrop-blur-md transition-transform active:scale-90 disabled:cursor-wait"
            title={isWaitingForRoomPlayback ? 'Join the room video from its current position' : isPlaying ? 'Pause' : 'Play'}
          >
            {isLoading ? (
              <span className="w-8 h-8 border-4 border-[#E50914] border-t-transparent rounded-full animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-8 h-8 sm:w-10 sm:h-10 fill-white" />
            ) : (
              <Play className="w-8 h-8 sm:w-10 sm:h-10 fill-white translate-x-1" />
            )}
          </button>
          {isWaitingForRoomPlayback && (
            <p className="max-w-xs rounded-lg bg-black/75 px-3 py-2 text-center text-xs font-medium text-white shadow-lg">
              Play dabakar current position se room video join karein
            </p>
          )}
        </div>

        {orientationLockError && (
          <p role="status" className="absolute right-4 top-20 rounded bg-black/80 px-3 py-2 text-xs text-red-300">
            {orientationLockError}
          </p>
        )}

        {/* Bottom Bar: Progress Scrubber & Controls */}
        <div className="pointer-events-auto bg-gradient-to-t from-black/90 via-black/60 to-transparent -mx-4 -mb-4 px-6 pb-6 pt-10 sm:-mx-6 sm:-mb-6 space-y-3">
          {/* Scrubber Bar */}
          <div className="relative flex items-center group/scrubber cursor-pointer">
            <input
              type="range"
              min={0}
              max={duration || 1}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              disabled={duration <= 0 || isWatchRoomGuest}
              className="w-full h-1.5 group-hover/scrubber:h-2.5 bg-zinc-700/80 rounded-lg appearance-none cursor-pointer netflix-slider transition-all disabled:cursor-not-allowed disabled:opacity-50"
            />
            {/* Visual Red Progress Fill */}
            <div
              className="absolute left-0 top-0 bottom-0 pointer-events-none rounded-lg bg-[#E50914]"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Controls Row */}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-3 text-white">
            {/* Left Controls: Play, Rewind 10, Forward 10, Next, Volume, Timecode */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:gap-x-5">
              <button
                onClick={togglePlay}
                disabled={isWatchRoomGuest && !isWaitingForRoomPlayback}
                className="hover:text-[#E50914] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause className="w-5 h-5 sm:w-6 sm:h-6" /> : <Play className="w-5 h-5 sm:w-6 sm:h-6 fill-white" />}
              </button>

              <button
                onClick={() => skipTime(-10)}
                disabled={isWatchRoomGuest}
                className="hover:text-zinc-300 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                title="Rewind 10 seconds"
              >
                <RotateCcw className="w-5 h-5 sm:w-6 sm:h-6" />
              </button>

              <button
                onClick={() => skipTime(10)}
                disabled={isWatchRoomGuest}
                className="hover:text-zinc-300 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                title="Forward 10 seconds"
              >
                <RotateCw className="w-5 h-5 sm:w-6 sm:h-6" />
              </button>

              {nextItem && !isWatchRoomGuest && (
                <button
                  onClick={() => onSelectNextItem(nextItem)}
                  className="hover:text-[#E50914] transition-colors"
                  title="Next Episode / Post"
                >
                  <SkipForward className="w-5 h-5 sm:w-6 sm:h-6" />
                </button>
              )}

              {/* Volume Slider & Toggle */}
              <div className="flex items-center space-x-2 group/volume">
                <button onClick={toggleMute} className="hover:text-zinc-300 transition-colors">
                  {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-16 sm:w-20 h-1 bg-zinc-600 rounded-lg appearance-none cursor-pointer netflix-slider hidden group-hover/volume:block sm:block"
                />
              </div>

              {/* Timecode */}
              <span className="text-xs sm:text-sm font-mono text-zinc-300">
                {formatTime(currentTime)} <span className="text-zinc-600">/</span> {formatTime(duration)}
              </span>
            </div>

            {/* Right Controls: Captions, Speed, PiP, Fullscreen */}
            <div className="flex items-center gap-x-3 sm:gap-x-4">
              {!isNativePlayback && Capacitor.isNativePlatform() && (
                <button
                  onClick={() => void toggleRotationLock()}
                  className={`p-1.5 rounded transition-colors text-white ${
                    isRotationLocked ? 'bg-white/15' : 'hover:bg-white/10'
                  }`}
                  title={isRotationLocked ? 'Unlock screen rotation' : 'Lock screen rotation'}
                  aria-label={isRotationLocked ? 'Unlock screen rotation' : 'Lock screen rotation'}
                >
                  {isRotationLocked
                    ? <LockKeyhole className="w-5 h-5" strokeWidth={3} />
                    : <LockKeyholeOpen className="w-5 h-5" strokeWidth={2} />}
                </button>
              )}

              {/* Caption Overlay Toggle */}
              {!item.localVideo && (
                <button
                  onClick={() => setShowCaptionOverlay(!showCaptionOverlay)}
                  className={`p-1.5 rounded transition-colors ${
                    showCaptionOverlay ? 'text-[#E50914] bg-white/10' : 'text-zinc-400 hover:text-white'
                  }`}
                  title="Toggle Telegram Caption Subtitles"
                >
                  <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              )}

              {/* Speed Menu */}
              <div className="relative">
                <button
                  onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                  disabled={isWatchRoomGuest}
                  className="text-xs sm:text-sm font-bold px-2 py-1 rounded bg-white/10 hover:bg-white/20 transition-colors"
                  title="Playback Speed"
                >
                  {playbackSpeed}x
                </button>

                {showSpeedMenu && (
                  <div className="absolute right-0 bottom-10 bg-zinc-900 border border-zinc-700 rounded-lg p-1.5 shadow-2xl z-50 space-y-0.5 min-w-[90px]">
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
                      <button
                        key={s}
                        onClick={() => setSpeed(s)}
                        className={`w-full text-left px-2 py-1 text-xs rounded flex items-center justify-between ${
                          playbackSpeed === s ? 'text-[#E50914] font-bold bg-white/5' : 'text-zinc-300 hover:bg-zinc-800'
                        }`}
                      >
                        <span>{s}x</span>
                        {playbackSpeed === s && <Check className="w-3 h-3 text-[#E50914]" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* PiP */}
              {!isNativePlayback && (
                <button
                  onClick={togglePiP}
                  className="hidden sm:block text-zinc-400 hover:text-white transition-colors"
                  title="Picture in Picture"
                >
                  <PictureInPicture className="w-5 h-5" />
                </button>
              )}

              {/* Fullscreen */}
              <button
                onClick={toggleFullscreen}
                className="text-zinc-400 hover:text-white transition-colors"
                title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
