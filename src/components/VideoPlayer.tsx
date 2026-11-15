import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { clockTime } from "../lib/format";
import { DEFAULT_VOLUME, savedVolume, saveVolume } from "../lib/videoVolume";
import { Icon } from "./Icon";

/**
 * Play when paused or finished, pause when playing.
 * @param el - the video, or null before it mounts
 */
function togglePlay(el: HTMLVideoElement | null): void {
  if (!el) return;
  if (el.paused || el.ended) el.play().catch(() => undefined);
  else el.pause();
}

/**
 * A video with its controls in a bar underneath rather than over the picture: play and pause,
 * the time, a seek bar, mute and volume. Clicking the picture or pressing Space plays and
 * pauses. It starts playing at the volume the last video was left at.
 * @param props - Component props.
 * @param props.src - the video's URL
 * @param props.poster - a still shown until it plays
 * @param props.label - the file's name, for screen readers
 * @param props.onError - the webview can't play it
 * @returns the video and its controls
 */
export function VideoPlayer({
  src,
  poster,
  label,
  onError,
}: {
  src: string;
  poster: string;
  label: string;
  onError: () => void;
}): ReactElement {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [sound, setSound] = useState(savedVolume);

  /** Play or pause this video. */
  function toggle(): void {
    togglePlay(video.current);
  }

  // Set before playback starts, so a video never begins at the browser's full volume.
  const attach = useCallback((el: HTMLVideoElement | null) => {
    video.current = el;
    if (!el) return;
    const start = savedVolume();
    el.volume = start.volume;
    el.muted = start.muted;
  }, []);

  // Space plays and pauses, unless a control has focus and handles Space itself.
  useEffect(() => {
    /**
     * Toggle playback on Space.
     * @param event - the window's keydown
     */
    function onKey(event: KeyboardEvent): void {
      if (event.key !== " ") return;
      const target = event.target;
      if (target instanceof Element && target.closest("button, input, select, textarea, a")) {
        return;
      }
      event.preventDefault();
      togglePlay(video.current);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * Change the volume or mute; the video's volumechange event keeps it for the next video.
   * @param volume - 0 to 1
   * @param muted - whether sound is off
   */
  function setVolume(volume: number, muted: boolean): void {
    const el = video.current;
    if (!el) return;
    el.volume = volume;
    el.muted = muted;
  }

  const quiet = sound.muted || sound.volume === 0;
  return (
    <div className="flex size-full flex-col items-center justify-center gap-3">
      <video
        ref={attach}
        src={src}
        poster={poster}
        aria-label={label}
        autoPlay
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onVolumeChange={(e) => {
          const next = { volume: e.currentTarget.volume, muted: e.currentTarget.muted };
          setSound(next);
          saveVolume(next);
        }}
        onError={onError}
        className="min-h-0 max-w-full cursor-pointer object-contain"
      />

      <div className="flex w-full max-w-2xl shrink-0 items-center gap-3 rounded-full bg-surface/90 px-2 py-1.5 text-ink">
        <BarButton label={playing ? "Pause" : "Play"} onClick={toggle}>
          <Icon name={playing ? "pause" : "play"} size={20} />
        </BarButton>
        <span className="w-12 shrink-0 text-right text-[14px] tabular-nums">{clockTime(time)}</span>
        <input
          type="range"
          aria-label="Position"
          aria-valuetext={`${clockTime(time)} of ${clockTime(duration)}`}
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(time, duration || 0)}
          disabled={!duration}
          onChange={(e) => {
            const el = video.current;
            if (el) el.currentTime = Number(e.target.value);
          }}
          className="h-8 min-w-0 flex-1 cursor-pointer accent-accent"
        />
        <span className="w-12 shrink-0 text-[14px] text-faint tabular-nums">
          {clockTime(duration)}
        </span>
        <BarButton
          label={quiet ? "Turn sound on" : "Mute"}
          onClick={() =>
            quiet ? setVolume(sound.volume || DEFAULT_VOLUME, false) : setVolume(sound.volume, true)
          }
        >
          <Icon name={quiet ? "soundOff" : "sound"} size={20} />
        </BarButton>
        <input
          type="range"
          aria-label="Volume"
          aria-valuetext={`${Math.round((quiet ? 0 : sound.volume) * 100)}%`}
          min={0}
          max={1}
          step={0.05}
          value={quiet ? 0 : sound.volume}
          onChange={(e) => {
            const volume = Number(e.target.value);
            setVolume(volume, volume === 0);
          }}
          className="mr-2 hidden h-8 w-24 shrink-0 cursor-pointer accent-accent sm:block"
        />
      </div>
    </div>
  );
}

/**
 * A round icon button in the control bar.
 * @param props - Component props.
 * @param props.label - what it does, for the tooltip and screen readers
 * @param props.onClick - do it
 * @param props.children - the icon
 * @returns the button
 */
function BarButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-raised"
    >
      {children}
    </button>
  );
}
