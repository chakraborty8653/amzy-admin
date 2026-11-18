import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Info, Play, Plus, Send, Check } from 'lucide-react';
import { MediaItem } from '../types';

interface HeroBannerProps {
  items: MediaItem[];
  onPlay: (item: MediaItem) => void;
  onMoreInfo: (item: MediaItem) => void;
  isSavedInList: boolean;
  onToggleMyList: (item: MediaItem) => void;
}

const fallbackBackdrop = 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=1600&auto=format&fit=crop&q=80';

export const HeroBanner: React.FC<HeroBannerProps> = ({
  items,
  onPlay,
  onMoreInfo,
  isSavedInList,
  onToggleMyList,
}) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const imageLoads = useRef(new Map<string, Promise<boolean>>());
  const slideRequest = useRef(0);
  const slides = items.slice(0, 10);
  const slidesRef = useRef(slides);
  slidesRef.current = slides;
  const item = slides[activeIndex] || slides[0];
  const backdropImage = item?.poster || item?.backdrop || item?.photoUrl || fallbackBackdrop;
  const nextItem = slides[(activeIndex + 1) % slides.length];
  const nextBackdropImage = nextItem?.poster || nextItem?.backdrop || nextItem?.photoUrl;
  const [failedImageId, setFailedImageId] = useState<string | null>(null);

  const preloadImage = useCallback((source: string): Promise<boolean> => {
    const cachedLoad = imageLoads.current.get(source);
    if (cachedLoad) return cachedLoad;

    const image = new Image();
    image.decoding = 'async';
    image.fetchPriority = 'low';
    let decoding = false;
    let loadImage: Promise<boolean>;
    loadImage = new Promise<boolean>((resolve) => {
      const finish = (loaded: boolean) => {
        image.onload = null;
        image.onerror = null;
        resolve(loaded);
      };
      const decode = () => {
        if (decoding) return;
        decoding = true;
        if (typeof image.decode === 'function') {
          void image.decode().then(
            () => finish(true),
            () => finish(image.naturalWidth > 0),
          );
        } else {
          finish(true);
        }
      };
      image.onload = decode;
      image.onerror = () => finish(false);
      image.src = source;
      if (image.complete) {
        if (image.naturalWidth > 0) decode();
        else finish(false);
      }
    }).then((loaded) => {
      if (!loaded && imageLoads.current.get(source) === loadImage) {
        imageLoads.current.delete(source);
      }
      return loaded;
    });
    imageLoads.current.set(source, loadImage);
    return loadImage;
  }, []);

  const showSlide = useCallback((index: number) => {
    const currentSlides = slidesRef.current;
    if (currentSlides.length < 2) return;
    const nextIndex = ((index % currentSlides.length) + currentSlides.length) % currentSlides.length;
    const nextSlide = currentSlides[nextIndex];
    if (!nextSlide) return;

    const source = nextSlide.poster || nextSlide.backdrop || nextSlide.photoUrl || fallbackBackdrop;
    const request = ++slideRequest.current;
    void preloadImage(source).then((loaded) => {
      if (request !== slideRequest.current) return;
      setFailedImageId(loaded ? null : nextSlide.id);
      setActiveIndex(nextIndex);
    });
  }, [preloadImage]);

  useEffect(() => {
    slideRequest.current += 1;
    setActiveIndex(0);
  }, [slides[0]?.id]);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(slides.length - 1, 0)));
  }, [slides.length]);

  useEffect(() => {
    if (slides.length < 2) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        showSlide(activeIndex + 1);
      }
    }, 6000);
    return () => window.clearInterval(timer);
  }, [activeIndex, showSlide, slides.length]);

  useEffect(() => {
    if (nextBackdropImage) void preloadImage(nextBackdropImage);
  }, [nextBackdropImage, preloadImage]);

  if (!item) return null;

  const displayedBackdrop = failedImageId === item.id ? fallbackBackdrop : backdropImage;
  const metadata = [
    item.type === 'video' ? 'Video' : item.type,
    ...(item.tags || []).slice(0, 4),
  ];

  return (
    <div
      className="relative mx-3 mt-16 h-[calc(100svh-5.5rem)] min-h-[min(400px,calc(100svh-5.5rem))] max-h-[920px] select-none overflow-hidden rounded-[26px] border border-white/30 bg-[#141414] shadow-2xl sm:mx-6 sm:mt-20 sm:h-[75vh] lg:mx-auto lg:h-[82vh] lg:max-w-7xl"
      onTouchStart={(event) => {
        touchStartX.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        if (touchStartX.current === null || slides.length < 2) return;
        const delta = event.changedTouches[0].clientX - touchStartX.current;
        if (Math.abs(delta) > 50) showSlide(activeIndex + (delta < 0 ? 1 : -1));
        touchStartX.current = null;
      }}
    >
      <img
        src={displayedBackdrop}
        alt=""
        aria-hidden="true"
        decoding="async"
        className="hero-slide-background absolute inset-0 h-full w-full object-cover object-center"
      />
      <img
        src={displayedBackdrop}
        alt={item.title}
        decoding="async"
        fetchPriority="high"
        onError={() => {
          if (displayedBackdrop !== fallbackBackdrop) setFailedImageId(item.id);
        }}
        className="absolute inset-0 h-full w-full object-contain object-center"
      />

      <div className="hero-gradient-overlay absolute inset-0" />
      <div className="hero-side-gradient absolute inset-0 hidden sm:block" />

      <div className="absolute right-4 top-4 z-20 flex items-center gap-2 sm:right-6 sm:top-6">
        <span className="rounded-full border border-white/25 bg-black/45 px-3 py-1.5 text-[11px] font-semibold text-white backdrop-blur-md">
          {activeIndex + 1} / {slides.length}
        </span>
        <button
          type="button"
          onClick={() => onMoreInfo(item)}
          aria-label={`More information about ${item.title}`}
          className="rounded-full border border-white/25 bg-black/45 p-2 text-white backdrop-blur-md transition-colors hover:bg-black/75"
        >
          <Info className="h-4 w-4" />
        </button>
      </div>

      {item.ageRating && (
        <div className="absolute right-0 top-1/2 z-20 -translate-y-1/2 border-l-4 border-zinc-300 bg-black/50 px-2 py-1 text-xs font-semibold text-white backdrop-blur-sm">
          {item.ageRating}
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 z-20 px-4 pb-5 pt-24 sm:px-8 sm:pb-8 lg:px-10 lg:pb-10">
        <div className="space-y-3 sm:space-y-4">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-zinc-200 sm:text-sm">
            <span className="text-white/90">Latest</span>
            <span className="text-white/50">•</span>
            <span className="flex min-w-0 items-center gap-1 truncate">
              <Send className="h-3.5 w-3.5 shrink-0 text-[#36aeea]" />
              @{item.channel}
            </span>
          </div>

          <h1 className="line-clamp-2 max-w-3xl font-bebas text-4xl font-bold leading-[0.95] tracking-wide text-white drop-shadow-lg sm:text-6xl lg:text-7xl">
            {item.title}
          </h1>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-200 drop-shadow sm:text-sm">
            {metadata.map((label, index) => (
              <React.Fragment key={`${label}-${index}`}>
                {index > 0 && <span className="text-white/50">•</span>}
                <span className={index === 0 ? 'font-semibold' : ''}>{label}</span>
              </React.Fragment>
            ))}
            {item.resolution && (
              <>
                <span className="text-white/50">•</span>
                <span>{item.resolution}</span>
              </>
            )}
          </div>

          <div className="flex gap-2 pt-2 sm:gap-3">
            <button
              type="button"
              onClick={() => onPlay(item)}
              className="flex min-h-14 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg bg-white px-2 py-3 text-sm font-bold text-black shadow-lg transition-transform hover:bg-zinc-200 active:scale-[0.98] sm:min-h-16 sm:gap-2 sm:px-4 sm:text-xl"
            >
              <Play className="h-5 w-5 fill-black sm:h-6 sm:w-6" />
              <span>Play Show</span>
            </button>
            <button
              type="button"
              onClick={() => onToggleMyList(item)}
              className="flex min-h-14 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg border border-white/15 bg-white/20 px-2 py-3 text-sm font-semibold text-white backdrop-blur-md transition-colors hover:bg-white/30 active:scale-[0.98] sm:min-h-16 sm:gap-2 sm:px-4 sm:text-xl"
            >
              {isSavedInList
                ? <Check className="h-6 w-6 text-emerald-400" />
                : <Plus className="h-7 w-7" />}
              <span>{isSavedInList ? 'In Playlist' : 'Add to Playlist'}</span>
            </button>
          </div>
        </div>

        {slides.length > 1 && (
          <div className="absolute bottom-1/2 left-4 right-4 z-20 flex -translate-y-1/2 justify-between sm:left-6 sm:right-6">
            <button
              type="button"
              onClick={() => showSlide(activeIndex - 1)}
              aria-label="Previous latest video"
              className="rounded-full border border-white/30 bg-black/45 p-2.5 text-white backdrop-blur-md transition-colors hover:bg-black/75"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => showSlide(activeIndex + 1)}
              aria-label="Next latest video"
              className="rounded-full border border-white/30 bg-black/45 p-2.5 text-white backdrop-blur-md transition-colors hover:bg-black/75"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
