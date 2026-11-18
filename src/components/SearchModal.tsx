import React, { useState, useMemo, useEffect } from 'react';
import { Search, X, Video, Image as ImageIcon, Send, Play } from 'lucide-react';
import { MediaItem } from '../types';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: MediaItem[];
  onPlay: (item: MediaItem) => void;
  onMoreInfo: (item: MediaItem) => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
  items,
  onPlay,
  onMoreInfo,
}) => {
  const [query, setQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'video' | 'photo' | '4k'>('all');
  const [visibleCount, setVisibleCount] = useState(120);
  useEffect(() => setVisibleCount(120), [query, filterType]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchText =
        !query ||
        item.title.toLowerCase().includes(query.toLowerCase()) ||
        item.caption.toLowerCase().includes(query.toLowerCase()) ||
        item.genre?.toLowerCase().includes(query.toLowerCase()) ||
        item.channel.toLowerCase().includes(query.toLowerCase());

      if (!matchText) return false;

      if (filterType === 'video') return item.type === 'video';
      if (filterType === 'photo') return item.type === 'photo';
      if (filterType === '4k') return item.resolution?.includes('4K');
      return true;
    });
  }, [items, query, filterType]);

  if (!isOpen) return null;

  return (
    <div
      className="safe-area-overlay fixed inset-0 z-50 bg-[#141414]/95 backdrop-blur-xl overflow-y-auto"
      onClick={onClose}
    >
      <div className="max-w-5xl mx-auto space-y-6" onClick={(e) => e.stopPropagation()}>
        {/* Search Bar & Close */}
        <div className="flex items-center justify-between space-x-4 border-b border-zinc-800 pb-4">
          <div className="relative flex-1 flex items-center">
            <Search className="w-5 h-5 text-zinc-400 absolute left-3 pointer-events-none" />
            <input
              type="text"
              autoFocus
              placeholder="Search movies, series, Telegram videos, or captions..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl pl-11 pr-10 py-3 text-white text-base placeholder-zinc-500 focus:outline-none focus:border-[#E50914]"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-3 text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center transition-colors flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filter Chips */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setFilterType('all')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              filterType === 'all' ? 'bg-[#E50914] text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            All ({items.length})
          </button>
          <button
            onClick={() => setFilterType('video')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold flex items-center space-x-1.5 transition-colors ${
              filterType === 'video' ? 'bg-[#E50914] text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            <Video className="w-3.5 h-3.5" />
            <span>Videos Only</span>
          </button>
          <button
            onClick={() => setFilterType('photo')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold flex items-center space-x-1.5 transition-colors ${
              filterType === 'photo' ? 'bg-[#E50914] text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span>Photos</span>
          </button>
          <button
            onClick={() => setFilterType('4k')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              filterType === '4k' ? 'bg-[#E50914] text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            4K Ultra HD
          </button>
        </div>

        {/* Search Results Grid */}
        <div>
          <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-bold mb-4">
            {filteredItems.length > 0 ? `Results (${filteredItems.length})` : 'No matching streams found'}
          </h3>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {filteredItems.slice(0, visibleCount).map((item) => (
              <div
                key={item.id}
                onClick={() => {
                  onPlay(item);
                  onClose();
                }}
                className="group relative bg-zinc-900 rounded-lg overflow-hidden border border-zinc-800 hover:border-zinc-500 cursor-pointer transition-all duration-300"
              >
                <div className="relative aspect-video bg-zinc-950">
                  <img
                    src={item.poster || item.photoUrl || item.backdrop}
                    alt={item.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  />
                  <div className="absolute inset-0 bg-black/40 group-hover:bg-black/10 transition-colors" />

                  {/* Play Overlay */}
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="w-10 h-10 rounded-full bg-white/95 text-black flex items-center justify-center shadow-lg">
                      <Play className="w-5 h-5 fill-black ml-0.5" />
                    </div>
                  </div>

                  {item.duration && (
                    <span className="absolute bottom-1.5 right-1.5 bg-black/80 text-[10px] font-mono px-1.5 py-0.2 rounded text-zinc-200">
                      {item.duration}
                    </span>
                  )}
                </div>

                <div className="p-2.5 space-y-1">
                  <h4 className="text-xs font-semibold text-white truncate">{item.title}</h4>
                  <div className="flex items-center justify-between text-[10px] text-zinc-400">
                    <span className="flex items-center space-x-1 truncate">
                      <Send className="w-2.5 h-2.5 text-[#0088cc]" />
                      <span className="truncate">@{item.channel}</span>
                    </span>
                    <span className="text-emerald-400 font-bold">{item.matchScore || 96}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {visibleCount < filteredItems.length && (
            <button type="button" onClick={() => setVisibleCount((count) => count + 120)} className="mt-4 rounded-lg border border-zinc-600 bg-zinc-900 px-5 py-3 text-sm font-bold text-white hover:bg-zinc-800">
              View more ({filteredItems.length - visibleCount})
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
