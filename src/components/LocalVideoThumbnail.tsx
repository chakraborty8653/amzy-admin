import React, { useEffect, useState } from 'react';
import { Video } from 'lucide-react';
import { TelegramNative } from '../services/telegramNative';

interface LocalVideoThumbnailProps {
  path: string;
  title: string;
}

export const LocalVideoThumbnail: React.FC<LocalVideoThumbnailProps> = ({ path, title }) => {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    void TelegramNative.getLocalVideoThumbnail({ path })
      .then(({ data }) => {
        if (isMounted) setThumbnailUrl(`data:image/jpeg;base64,${data}`);
      })
      .catch((error: unknown) => {
        if (isMounted) console.warn(`Could not load thumbnail for local video "${title}":`, error);
      });

    return () => {
      isMounted = false;
    };
  }, [path, title]);

  return thumbnailUrl ? (
    <img src={thumbnailUrl} alt={`${title} thumbnail`} className="absolute inset-0 h-full w-full object-cover" />
  ) : (
    <Video className="h-8 w-8" />
  );
};
