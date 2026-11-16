// The viewer's video volume, kept between videos and app restarts. Browsers start every video at
// full volume, which is far louder than phone clips are usually watched at.

const KEY = "videoVolume";
/** A first video plays at this, until the volume is changed. */
export const DEFAULT_VOLUME = 0.4;

export interface VideoVolume {
  /** 0 to 1. */
  volume: number;
  muted: boolean;
}

/**
 * Read a stored volume, falling back to the default for anything missing or malformed.
 * @param stored - what was saved, or null
 * @returns the volume to play at
 */
export function parseVolume(stored: string | null): VideoVolume {
  try {
    const value = JSON.parse(stored ?? "") as Partial<VideoVolume>;
    const volume = typeof value.volume === "number" ? value.volume : NaN;
    return {
      volume: volume >= 0 && volume <= 1 ? volume : DEFAULT_VOLUME,
      muted: value.muted === true,
    };
  } catch {
    return { volume: DEFAULT_VOLUME, muted: false };
  }
}

/**
 * The volume the last video was left at. Storage can be unavailable; the default is used then.
 * @returns the volume to play at
 */
export function savedVolume(): VideoVolume {
  try {
    return parseVolume(localStorage.getItem(KEY));
  } catch {
    return parseVolume(null);
  }
}

/**
 * Keep a video's volume for the next one.
 * @param volume - the new volume
 */
export function saveVolume(volume: VideoVolume): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(volume));
  } catch {
    // Not kept: the next video starts at the default.
  }
}
