import { useCallback, useState } from "react";
import { errorText } from "./api";

/**
 * Runs a save or command and keeps its error text for display, cleared on the next run.
 * @returns the last error (null after a success), the runner (resolves true on success), and
 * `clear` for when the change that failed is abandoned
 */
export function useAction(): {
  error: string | null;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  clear: () => void;
} {
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    }
  }, []);
  const clear = useCallback(() => setError(null), []);
  return { error, run, clear };
}
