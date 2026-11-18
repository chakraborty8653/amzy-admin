const MINIMUM_VIDEO_DURATION_SECONDS = 10 * 60;

export function isLongVideo(duration?: string): boolean {
  if (!duration) return false;

  const value = duration.trim().toLowerCase();
  const colonParts = value.split(':');
  if (
    colonParts.length >= 2
    && colonParts.length <= 3
    && colonParts.every((part) => /^\d+$/.test(part))
  ) {
    const seconds = colonParts.reduce(
      (total, part) => total * 60 + Number(part),
      0,
    );
    return seconds >= MINIMUM_VIDEO_DURATION_SECONDS;
  }

  const units = Array.from(value.matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g));
  if (units.length === 0) return false;

  const seconds = units.reduce((total, [unit, amount, label]) => {
    const normalizedLabel = label[0];
    const multiplier = normalizedLabel === 'h' ? 3600 : normalizedLabel === 'm' ? 60 : 1;
    return total + Number(amount) * multiplier;
  }, 0);
  return seconds >= MINIMUM_VIDEO_DURATION_SECONDS;
}
