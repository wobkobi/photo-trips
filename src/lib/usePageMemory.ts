import {
  createContext,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

export interface PageMemoryValue {
  /** Whether anything is kept under `key`. */
  has: (key: string) => boolean;
  /** The value kept under `key`, or undefined when there is none. */
  read: (key: string) => unknown;
  /** Keep `value` under `key` for the next time a page asks. */
  write: (key: string, value: unknown) => void;
}

export const PageMemoryContext = createContext<PageMemoryValue | null>(null);

/**
 * The store behind {@link usePageMemory}. Must be used under PageMemoryProvider.
 * @returns the store
 */
function usePageMemoryStore(): PageMemoryValue {
  const ctx = useContext(PageMemoryContext);
  if (!ctx) throw new Error("usePageMemory outside PageMemoryProvider");
  return ctx;
}

/**
 * State that outlives its page: works like useState, but starts from the value the page last
 * had under `key`, so leaving the page and coming back finds it as it was. Only one component
 * should use a key at a time, and the value isn't shared live between components.
 * @param key - names the value; unique across the app, e.g. "settings.tab"
 * @param initial - the value the first time the page opens
 * @returns the value and its setter, as useState returns them
 */
export function usePageMemory<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const store = usePageMemoryStore();
  const [value, setValue] = useState<T>(() => (store.has(key) ? (store.read(key) as T) : initial));
  // Written after each change rather than on unmount, so a value set just before leaving is kept.
  useEffect(() => {
    store.write(key, value);
  }, [store, key, value]);
  return [value, setValue];
}
