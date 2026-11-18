import React, { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MediaItem } from '../types';
import { MediaCard } from './MediaCard';

const PAGE_SIZE = 50;

interface MediaRowProps {
  title: string;
  items: MediaItem[];
  onPlay: (item: MediaItem) => void;
  onMoreInfo: (item: MediaItem) => void;
  savedItemIds: string[];
  onToggleMyList: (item: MediaItem) => void;
  watchProgressMap: Record<string, number>;
  subtitle?: string;
}

export const MediaRow: React.FC<MediaRowProps> = ({
  title,
  items,
  onPlay,
  onMoreInfo,
  savedItemIds,
  onToggleMyList,
  watchProgressMap,
  subtitle,
}) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const checkScroll = () => {
    if (rowRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = rowRef.current;
      setCanScrollLeft(scrollLeft > 20);
      setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 20);
    }
  };

  const scroll = (direction: 'left' | 'right') => {
    if (rowRef.current) {
      const { clientWidth } = rowRef.current;
      const scrollAmount = clientWidth * 0.75;
      rowRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth',
      });
      setTimeout(checkScroll, 350);
    }
  };

  if (!items || items.length === 0) return null;

  return (
    <div className="space-y-2 py-4 select-none group/row relative">
      {/* Row Header */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-baseline justify-between">
        <div>
          <h2 className="text-base sm:text-xl md:text-2xl font-bold text-white tracking-wide flex items-center space-x-2">
            <span>{title}</span>
            <span className="text-zinc-600 text-xs font-normal">({items.length})</span>
          </h2>
          {subtitle && <p className="text-xs text-zinc-400 mt-0.5">{subtitle}</p>}
        </div>
      </div>

      {/* Row Rail Carousel */}
      <div className="relative">
        {/* Left Scroll Button */}
        {canScrollLeft && (
          <button
            onClick={() => scroll('left')}
            className="hidden sm:flex absolute left-0 top-0 bottom-0 z-20 w-12 bg-black/60 hover:bg-black/85 items-center justify-center text-white transition-opacity duration-200"
            aria-label="Scroll left"
          >
            <ChevronLeft className="w-8 h-8 hover:scale-125 transition-transform" />
          </button>
        )}

        {/* Horizontal Scroll Area */}
        <div
          ref={rowRef}
          onScroll={checkScroll}
          className="flex items-center space-x-3 sm:space-x-4 overflow-x-auto no-scrollbar scroll-smooth px-4 sm:px-6 lg:px-8 py-2"
        >
          {items.slice(0, visibleCount).map((item) => (
            <MediaCard
              key={item.id}
              item={item}
              onPlay={onPlay}
              onMoreInfo={onMoreInfo}
              isSavedInList={savedItemIds.includes(item.id)}
              onToggleMyList={onToggleMyList}
              watchProgress={watchProgressMap[item.id] || 0}
            />
          ))}
          {visibleCount < items.length && (
            <button
              type="button"
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              className="shrink-0 self-center rounded-lg border border-zinc-600 bg-zinc-900 px-5 py-3 text-xs font-bold text-white hover:bg-zinc-800 sm:text-sm"
            >
              View more ({items.length - visibleCount})
            </button>
          )}
        </div>

        {/* Right Scroll Button */}
        {canScrollRight && (
          <button
            onClick={() => scroll('right')}
            className="hidden sm:flex absolute right-0 top-0 bottom-0 z-20 w-12 bg-black/60 hover:bg-black/85 items-center justify-center text-white transition-opacity duration-200"
            aria-label="Scroll right"
          >
            <ChevronRight className="w-8 h-8 hover:scale-125 transition-transform" />
          </button>
        )}
      </div>
    </div>
  );
};
