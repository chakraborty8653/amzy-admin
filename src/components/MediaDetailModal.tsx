import React, { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { X, Play, Plus, Check, ThumbsUp, Send, Calendar, Eye, Clock, Share2, Download, Image as ImageIcon, Sparkles, Layers } from 'lucide-react';
import { DownloadedVideo, MediaItem } from '../types';

interface MediaDetailModalProps {
  item: MediaItem;
  relatedItems: MediaItem[];
  onClose: () => void;
  onPlay: (item: MediaItem) => void;
  onDownload: (item: MediaItem) => Promise<void>;
  downloadInfo?: DownloadedVideo;
  isSavedInList: boolean;
  onToggleMyList: (item: MediaItem) => void;
}

export const MediaDetailModal: React.FC<MediaDetailModalProps> = ({
  item,
  relatedItems,
  onClose,
  onPlay,
  onDownload,
  downloadInfo,
  isSavedInList,
  onToggleMyList,
}) => {
  const initialPhoto = item.photoUrl || item.poster || item.backdrop || '';
  const [activeMediaUrl, setActiveMediaUrl] = useState<string>(initialPhoto);
  const [selectedResolution, setSelectedResolution] = useState<string>('w');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{ downloadedBytes: number; totalBytes: number }>();
  const [downloadError, setDownloadError] = useState('');

  const backdrop = activeMediaUrl || initialPhoto || 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1200&auto=format&fit=crop&q=80';

  const sharePost = () => {
    if (navigator.share) {
      navigator.share({
        title: item.title,
        text: item.caption,
        url: window.location.href,
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(window.location.href);
      alert('Link copied to clipboard!');
    }
  };

  const downloadMedia = () => {
    const targetUrl = activeMediaUrl || item.videoUrl || item.photoUrl;
    if (targetUrl) {
      const a = document.createElement('a');
      a.href = targetUrl;
      a.download = `${item.title.replace(/\s+/g, '_')}_master.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const downloadVideo = async () => {
    if (isDownloading || downloadInfo?.status === 'downloading') return;
    setDownloadError('');
    setIsDownloading(true);
    try {
      if (Capacitor.isNativePlatform()) {
        await onDownload(item);
        return;
      }

      const videoUrl = item.videoUrl || item.rawVideoUrl;
      if (!videoUrl) throw new Error('Is video ke liye download source available nahi hai.');

      const response = await fetch(videoUrl);
      if (!response.ok) throw new Error(`Video download failed (${response.status}).`);
      const totalBytes = Number(response.headers.get('content-length')) || 0;
      const chunks: BlobPart[] = [];
      let downloadedBytes = 0;
      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            downloadedBytes += value.byteLength;
            setDownloadProgress({ downloadedBytes, totalBytes });
          }
        }
      } else {
        const blob = await response.blob();
        chunks.push(blob);
        downloadedBytes = blob.size;
        setDownloadProgress({ downloadedBytes, totalBytes: totalBytes || blob.size });
      }

      const blob = new Blob(chunks, { type: response.headers.get('content-type') || 'video/mp4' });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `${item.title.replace(/[^\w.-]+/g, '_')}.mp4`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      setDownloadProgress({ downloadedBytes, totalBytes: totalBytes || downloadedBytes });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Video download nahi ho saka.';
      setDownloadError(message);
      console.error('Could not download video:', error);
    } finally {
      setIsDownloading(false);
    }
  };

  const activeDownloadedBytes = downloadInfo?.downloadedBytes ?? downloadProgress?.downloadedBytes;
  const activeTotalBytes = downloadInfo?.totalBytes ?? downloadProgress?.totalBytes;
  const activeProgress = downloadInfo?.status === 'downloading'
    ? downloadInfo.progress
    : activeTotalBytes && activeDownloadedBytes !== undefined
      ? Math.min(100, Math.round(activeDownloadedBytes * 100 / activeTotalBytes))
      : 0;
  const formatBytes = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div
      className="safe-area-overlay fixed inset-0 z-50 flex items-start justify-center overflow-hidden bg-black/80 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="relative my-0 max-h-full w-full max-w-4xl overflow-y-auto overscroll-contain rounded-xl border border-zinc-800 bg-[#181818] shadow-2xl animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-30 w-9 h-9 rounded-full bg-black/70 hover:bg-black text-white flex items-center justify-center transition-transform active:scale-90 border border-zinc-700"
          title="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Hero Banner Area */}
        <div className="relative aspect-video max-h-[440px] w-full bg-zinc-950 overflow-hidden">
          <img
            src={backdrop}
            alt={item.title}
            className="w-full h-full object-cover object-center transition-all duration-300"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#181818] via-transparent to-black/30" />

          {/* Action Overlay */}
          <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-3 sm:bottom-6 sm:left-6 sm:right-6 sm:gap-4">
            <div className="space-y-2">
              <h1 className="font-bebas text-2xl tracking-wide text-white drop-shadow-md sm:text-4xl">
                {item.title}
              </h1>

              <div className="flex flex-wrap items-center gap-3">
                {item.type === 'video' ? (
                  <>
                    <button
                      onClick={() => onPlay(item)}
                      className="flex items-center space-x-2 rounded bg-white px-4 py-2 text-xs font-bold text-black shadow transition-transform hover:bg-zinc-200 active:scale-95 sm:px-6 sm:text-sm"
                    >
                      <Play className="w-4 h-4 fill-black" />
                      <span>Play Now</span>
                    </button>
                    {(item.telegramFileId || item.videoUrl || item.rawVideoUrl) && (
                      <button
                        onClick={() => void downloadVideo()}
                        disabled={
                          isDownloading ||
                          downloadInfo?.status === 'downloading' ||
                          downloadInfo?.status === 'completed'
                        }
                        className="flex items-center space-x-2 rounded bg-zinc-800 px-4 py-2 text-xs font-bold text-white shadow transition-transform hover:bg-zinc-700 active:scale-95 disabled:opacity-60 sm:text-sm"
                        title="Download video to device"
                      >
                        <Download className={`w-4 h-4 ${isDownloading ? 'animate-bounce' : ''}`} />
                        <span>
                          {isDownloading || downloadInfo?.status === 'downloading'
                            ? `Downloading ${activeProgress}%`
                            : downloadInfo?.status === 'completed'
                              ? 'Downloaded'
                              : downloadInfo?.status === 'failed'
                                ? 'Retry Download'
                                : 'Download'}
                        </span>
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    onClick={downloadMedia}
                    className="flex items-center space-x-2 bg-white hover:bg-zinc-200 text-black px-6 py-2 rounded font-bold text-sm transition-transform active:scale-95 shadow"
                  >
                    <Download className="w-4 h-4 text-black" />
                    <span>Download Master Photo</span>
                  </button>
                )}

                <button
                  onClick={() => onToggleMyList(item)}
                  className="w-9 h-9 rounded-full border border-zinc-500 bg-black/50 hover:border-white text-white flex items-center justify-center transition-colors"
                  title={isSavedInList ? 'Add to another playlist' : 'Add to playlist'}
                >
                  {isSavedInList ? <Check className="w-4 h-4 text-emerald-400" /> : <Plus className="w-4 h-4" />}
                </button>

                <button
                  onClick={sharePost}
                  className="w-9 h-9 rounded-full border border-zinc-500 bg-black/50 hover:border-white text-white flex items-center justify-center transition-colors"
                  title="Share"
                >
                  <Share2 className="w-4 h-4" />
                </button>

                {item.telegramLink && (
                  <a
                    href={item.telegramLink}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center space-x-1.5 bg-[#0088cc] hover:bg-[#0077b5] text-white text-xs font-semibold px-3 py-2 rounded transition-colors shadow"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Telegram Post</span>
                  </a>
                )}
              </div>
              {(isDownloading || downloadInfo?.status === 'downloading') && (
                <div className="w-full space-y-1">
                  <div className="flex justify-between gap-2 text-[10px] text-zinc-300">
                    <span>{activeDownloadedBytes !== undefined ? formatBytes(activeDownloadedBytes) : 'Starting download...'}</span>
                    <span>
                      {activeTotalBytes
                        ? `${formatBytes(activeTotalBytes)} total`
                        : `${activeProgress}%`}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-zinc-700">
                    <div
                      className={`h-full bg-[#E50914] transition-[width] duration-300 ${activeTotalBytes ? '' : 'animate-pulse'}`}
                      style={{ width: activeTotalBytes ? `${activeProgress}%` : '35%' }}
                    />
                  </div>
                </div>
              )}
              {(downloadError || (downloadInfo?.status === 'failed' && downloadInfo.error)) && (
                <p className="max-w-xl text-xs text-red-400">
                  {downloadError || downloadInfo?.error}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Multi-Photo Album Rail (If Post has multiple Telegram Photos) */}
        {item.albumPhotos && item.albumPhotos.length > 1 && (
          <div className="px-6 pt-4 border-b border-zinc-800/80 bg-zinc-900/40">
            <div className="flex items-center space-x-2 text-xs text-zinc-400 font-semibold mb-2">
              <Layers className="w-4 h-4 text-[#E50914]" />
              <span>Telegram Photo Album ({item.albumPhotos.length} photos):</span>
            </div>
            <div className="flex items-center space-x-2 overflow-x-auto no-scrollbar pb-3">
              {item.albumPhotos.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => setActiveMediaUrl(p)}
                  className={`relative w-20 h-14 rounded-lg overflow-hidden border-2 flex-shrink-0 transition-all ${
                    activeMediaUrl === p ? 'border-[#E50914] scale-105 shadow-md' : 'border-zinc-700 opacity-70 hover:opacity-100'
                  }`}
                >
                  <img src={p} alt={`Photo ${idx + 1}`} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Modal Content Body */}
        <div className="p-6 sm:p-8 space-y-6">
          {/* Metadata Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-4">
              <div className="flex flex-wrap items-center gap-2.5 text-xs sm:text-sm">
                <span className="text-emerald-400 font-bold">{item.matchScore || 97}% Match</span>
                <span className="border border-zinc-700 text-zinc-300 px-1.5 py-0.5 rounded text-xs font-semibold">
                  {item.ageRating || '16+'}
                </span>
                {item.duration && (
                  <span className="text-zinc-400 flex items-center space-x-1">
                    <Clock className="w-3 h-3 text-zinc-500" />
                    <span>{item.duration}</span>
                  </span>
                )}
                {item.resolution && (
                  <span className="border border-zinc-600 text-white font-bold text-[10px] px-1.5 py-0.5 rounded bg-zinc-800">
                    {item.resolution}
                  </span>
                )}
                <span className="bg-[#E50914] text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                  {item.genre || 'Stream'}
                </span>
                <span className="bg-[#0088cc]/20 border border-[#0088cc]/40 text-sky-300 text-[10px] font-semibold px-2 py-0.5 rounded">
                  MTProto Photo API
                </span>
              </div>

              {/* MTProto Photo Resolution Ladder Selector */}
              {item.photoSizes && item.photoSizes.length > 0 && (
                <div className="bg-zinc-900/90 p-3 rounded-xl border border-zinc-800 space-y-2">
                  <div className="flex items-center space-x-1.5 text-xs font-bold text-white">
                    <Sparkles className="w-3.5 h-3.5 text-[#E50914]" />
                    <span>Telegram MTProto Resolution Master:</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {item.photoSizes.map((variant) => (
                      <button
                        key={variant.type}
                        onClick={() => {
                          setSelectedResolution(variant.type);
                          setActiveMediaUrl(variant.url);
                        }}
                        className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
                          selectedResolution === variant.type
                            ? 'bg-[#E50914] text-white shadow'
                            : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700'
                        }`}
                      >
                        {variant.label} ({variant.type.toUpperCase()})
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Telegram Caption */}
              <div className="space-y-2">
                <h4 className="text-xs uppercase tracking-wider text-zinc-400 font-bold">Caption & Details</h4>
                <p className="text-sm sm:text-base text-zinc-200 leading-relaxed whitespace-pre-line">
                  {item.caption || 'No caption provided with this media item.'}
                </p>
              </div>
            </div>

            {/* Sidebar Details */}
            <div className="bg-zinc-900/60 p-4 rounded-lg border border-zinc-800 space-y-3 text-xs">
              <div>
                <span className="text-zinc-400 block mb-0.5">Source Channel:</span>
                <a
                  href={`https://t.me/${item.channel}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-400 font-semibold hover:underline flex items-center space-x-1"
                >
                  <Send className="w-3 h-3 text-[#0088cc]" />
                  <span>@{item.channel}</span>
                </a>
              </div>

              {item.views && (
                <div>
                  <span className="text-zinc-400 block mb-0.5">Telegram Views:</span>
                  <span className="text-white font-medium flex items-center space-x-1">
                    <Eye className="w-3 h-3 text-zinc-500" />
                    <span>{item.views}</span>
                  </span>
                </div>
              )}

              {item.date && (
                <div>
                  <span className="text-zinc-400 block mb-0.5">Published Date:</span>
                  <span className="text-zinc-300 flex items-center space-x-1">
                    <Calendar className="w-3 h-3 text-zinc-500" />
                    <span>{new Date(item.date).toLocaleDateString()}</span>
                  </span>
                </div>
              )}

              {item.tags && item.tags.length > 0 && (
                <div>
                  <span className="text-zinc-400 block mb-1">Tags & Categories:</span>
                  <div className="flex flex-wrap gap-1">
                    {item.tags.map((t) => (
                      <span key={t} className="bg-zinc-800 text-zinc-300 text-[10px] px-1.5 py-0.5 rounded">
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Related / More from this Channel */}
          {relatedItems.length > 0 && (
            <div className="border-t border-zinc-800 pt-6 space-y-4">
              <h3 className="text-lg font-bold text-white">More from @{item.channel}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {relatedItems.slice(0, 6).map((rel) => (
                  <div
                    key={rel.id}
                    onClick={() => onPlay(rel)}
                    className="group/item bg-zinc-900 rounded-md overflow-hidden cursor-pointer hover:border-zinc-500 border border-zinc-800 transition-all"
                  >
                    <div className="relative aspect-video bg-zinc-950">
                      <img
                        src={rel.poster || rel.photoUrl || backdrop}
                        alt={rel.title}
                        className="w-full h-full object-cover group-hover/item:scale-105 transition-transform"
                      />
                      <div className="absolute inset-0 bg-black/20 group-hover/item:bg-transparent" />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/item:opacity-100 transition-opacity">
                        <div className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center">
                          <Play className="w-4 h-4 fill-black text-black ml-0.5" />
                        </div>
                      </div>
                      {rel.duration && (
                        <span className="absolute bottom-1 right-1 bg-black/80 text-[10px] font-mono px-1 rounded text-zinc-300">
                          {rel.duration}
                        </span>
                      )}
                    </div>
                    <div className="p-2 space-y-1">
                      <p className="text-xs font-semibold text-white truncate">{rel.title}</p>
                      <p className="text-[10px] text-zinc-400 line-clamp-1">{rel.caption || 'Video stream'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
