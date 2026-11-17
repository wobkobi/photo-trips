import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "./api";
import { photoSizeOf } from "./display";
import { useSettings } from "./useSettings";

/** Wait this long after the last change before saving, so a run of wheel notches saves once. */
const SAVE_DELAY_MS = 400;

/**
 * The grid's photo size, changed at once on screen and saved to the `photo_size` setting once
 * changes settle. Settings > Display shows the same setting, so a size picked there shows here
 * and the other way round once saved. A save that fails puts the stored size back.
 * @returns the size on show (a PHOTO_SIZES value), a setter for a new one, and the last save's
 * error text (null after a success)
 */
export function usePhotoSize(): {
  size: string;
  setSize: (value: string) => void;
  error: string | null;
} {
  const { settings, save } = useSettings();
  // A size picked but not yet saved; null once the stored one has caught up.
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const unsaved = useRef<string | null>(null);
  const size = pending ?? photoSizeOf(settings);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const value = unsaved.current;
    unsaved.current = null;
    if (value === null) return;
    save("photo_size", value).then(
      // Only the latest pick is let go; one made while this saved stays on show.
      () => {
        setPending((now) => (now === value ? null : now));
        setError(null);
      },
      (err) => {
        setPending((now) => (now === value ? null : now));
        setError(errorText(err));
      },
    );
  }, [save]);

  const setSize = useCallback(
    (value: string) => {
      // Ctrl+wheel past either end asks for the size already on show.
      if (value === size) return;
      setPending(value);
      unsaved.current = value;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush, size],
  );

  // Leaving before the delay is up still saves the last pick.
  useEffect(() => flush, [flush]);

  return { size, setSize, error };
}
