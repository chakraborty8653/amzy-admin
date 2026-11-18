import React, { useState } from 'react';
import { Play, Plus, Check, ThumbsUp, ChevronDown, Send, Video, Image as ImageIcon } from 'lucide-react';
import { MediaItem } from '../types';

interface MediaCardProps {
  item: MediaItem;
  onPlay: (item: MediaItem) => void;
  onMoreInfo: (item: MediaItem) => void;
  isSavedInList: boolean;
  onToggleMyList: (item: MediaItem) => void;
  watchProgress?: number;
}

export const MediaCard: React.FC<MediaCardProps> = ({
  item,
  onPlay,
  onMoreInfo,
  isSavedInList,
  onToggleMyList,
  watchProgress = 0,
}) => {
  const [isLiked, setIsLiked] = useState(false);
  const [imageError, setImageError] = useState(false);

  const fallbackImage = 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=800&auto=format&fit=crop&q=80';
  const displayImage = !imageError && (item.poster || item.photoUrl || item.backdrop) ? (item.poster || item.photoUrl || item.backdrop) : fallbackImage;

  return (
    <div className="group relative flex-none w-[170px] sm:w-[220px] md:w-[260px] lg:w-[280px] select-none transition-all duration-300 hover:z-30">
      {/* Card Container */}
      <div className="relative rounded-md overflow-hidden bg-zinc-900 shadow-lg cursor-pointer transform group-hover:scale-105 transition-transform duration-300 border border-zinc-800/60 group-hover:border-zinc-600">
        {/* Thumbnail Aspect Ratio 16:9 */}
        <div className="relative aspect-video w-full bg-zinc-950 overflow-hidden" onClick={() => onPlay(item)}>
          <img
            src={displayImage}
            alt={item.title}
            onError={() => setImageError(true)}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />

          {/* Badges on Thumbnail */}
          <div className="absolute top-2 left-2 flex items-center space-x-1">
            <span className="bg-black/70 backdrop-blur-md text-[10px] font-bold px-1.5 py-0.5 rounded text-white flex items-center space-x-1">
              {item.type === 'video' ? <Video className="w-2.5 h-2.5 text-[#E50914]" /> : <ImageIcon className="w-2.5 h-2.5 text-blue-400" />}
              <span>{item.type === 'video' ? 'VIDEO' : 'PHOTO'}</span>
            </span>
          </div>

          {/* Resolution Badge */}
          {item.resolution && (
            <div className="absolute top-2 right-2">
              <span className="bg-[#E50914] text-white text-[9px] font-extrabold px-1 py-0.5 rounded shadow">
                {item.resolution.includes('4K') ? '4K' : 'HD'}
              </span>
            </div>
          )}

          {/* Duration Badge */}
          {item.duration && item.type === 'video' && (
            <div className="absolute bottom-2 right-2 bg-black/80 px-1.5 py-0.5 rounded text-[10px] font-mono text-zinc-200">
              {item.duration}
            </div>
          )}

          {/* Watch Progress bar */}
          {watchProgress > 0 && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-zinc-700">
              <div className="h-full bg-[#E50914]" style={{ width: `${watchProgress}%` }} />
            </div>
          )}
        </div>

        {/* Card Body Info */}
        <div className="p-3 bg-[#181818] space-y-2">
          {/* Quick Actions Bar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              {/* Play Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onPlay(item);
                }}
                className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white hover:bg-zinc-200 flex items-center justify-center text-black transition-transform active:scale-90"
                title="Play"
              >
                <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-black translate-x-0.5" />
              </button>

              {/* Add to playlist */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleMyList(item);
                }}
                className="w-7 h-7 sm:w-8 sm:h-8 rounded-full border border-zinc-600 hover:border-white flex items-center justify-center text-white transition-colors"
                title={isSavedInList ? 'Add to another playlist' : 'Add to playlist'}
              >
                {isSavedInList ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Plus className="w-3.5 h-3.5" />
                )}
              </button>

              {/* Like Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsLiked(!isLiked);
                }}
                className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full border flex items-center justify-center transition-colors ${
                  isLiked ? 'border-[#E50914] text-[#E50914]' : 'border-zinc-600 hover:border-white text-zinc-300'
                }`}
                title="Like"
              >
                <ThumbsUp className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Expand / Details */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMoreInfo(item);
              }}
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-full border border-zinc-600 hover:border-white flex items-center justify-center text-white transition-colors"
              title="More Info"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>

          {/* Title & Stats */}
          <div onClick={() => onMoreInfo(item)}>
            <h3 className="font-semibold text-xs sm:text-sm text-white truncate leading-tight hover:text-[#E50914] transition-colors">
              {item.title}
            </h3>

            <div className="flex items-center space-x-2 text-[11px] pt-1">
              <span className="text-emerald-400 font-bold">{item.matchScore || 96}% Match</span>
              <span className="border border-zinc-700 text-zinc-400 px-1 py-0.2 rounded text-[9px]">
                {item.ageRating || '16+'}
              </span>
              <span className="text-zinc-400 truncate">{item.genre || 'Stream'}</span>
            </div>

            {/* Channel info & views */}
            <div className="flex items-center justify-between text-[10px] text-zinc-500 pt-1">
              <span className="flex items-center space-x-1 truncate max-w-[120px]">
                <Send className="w-2.5 h-2.5 text-[#0088cc] flex-shrink-0" />
                <span className="truncate">@{item.channel}</span>
              </span>
              <span>{item.views || 'Telegram'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
