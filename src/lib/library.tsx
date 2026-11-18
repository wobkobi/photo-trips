import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { api, errorText, type IndexSummary, type Tile, type TripInfo } from "./api";
import type { GridPlace } from "./format";
import { NONE, withIds, withoutIds } from "./hiddenIds";
import { NO_FILTER, type LibraryFilter } from "./libraryFilter";
import { useJobDone } from "./useJobs";
import { LibraryContext } from "./useLibrary";
import { useSettings } from "./useSettings";

/**
 * Jobs whose end can change which photos there are, or their dates and trips. The Recycle Bin
 * job reloads too, with its own handler, as it also shows the photos it hid.
 */
const RELOAD_ON = ["apply", "undo", "import", "inbox"];

/**
 * Loads the library's photos and trips and keeps the Library page's filter, selection and open
 * photo, so leaving the page and coming back finds everything as it was. Reloads when a job
 * that changes the library ends, whichever page is showing. Photos on their way to the Recycle
 * Bin are hidden from the moment the job starts until the first load after it ends lands, which
 * drops them or, when the job failed, brings them back. Only the photos hidden by the time that
 * job ended come back, so a second job started before that load lands keeps its own hidden.
 * Must be under JobsProvider and SettingsProvider.
 * @param props - Component props.
 * @param props.children - app content
 * @returns the provider element
 */
export function LibraryProvider({ children }: { children: ReactNode }): ReactElement {
  const { settings } = useSettings();
  const root = settings?.library_root || null;
  const [loaded, setLoaded] = useState<Tile[] | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<number>>(NONE);
  const [trips, setTrips] = useState<TripInfo[]>([]);
  const [summary, setSummary] = useState<IndexSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilterState] = useState<LibraryFilter>(NO_FILTER);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [picking, setPicking] = useState(false);
  const [anchorId, setAnchorId] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  // A ref, not state: it changes on every scroll and nothing redraws for it.
  const place = useRef<GridPlace | null>(null);
  // Loads can overlap (a job ends while the last one is still reading); only the newest lands.
  const loadSeq = useRef(0);
  // The photos hidden when a bin job ended, for the next load to land to show as they now are.
  const unhideOnLoad = useRef<ReadonlySet<number>>(NONE);
  // The hidden set as last drawn, read when a bin job ends.
  const hiddenNow = useRef(hidden);
  useEffect(() => {
    hiddenNow.current = hidden;
  });

  const reload = useCallback((): Promise<void> => {
    loadSeq.current += 1;
    const seq = loadSeq.current;
    return Promise.all([api.libraryTiles(), api.listTrips()]).then(
      ([loadedTiles, loadedTrips]) => {
        if (seq !== loadSeq.current) return;
        setLoaded(loadedTiles);
        setTrips(loadedTrips);
        setError(null);
        const ended = unhideOnLoad.current;
        if (ended.size > 0) {
          unhideOnLoad.current = NONE;
          setHidden((prev) => withoutIds(prev, ended));
        }
      },
      (err) => {
        if (seq === loadSeq.current) setError(errorText(err));
      },
    );
  }, []);

  const tiles = useMemo(
    () => (loaded && hidden.size > 0 ? loaded.filter((t) => !hidden.has(t.id)) : loaded),
    [loaded, hidden],
  );

  const hide = useCallback((ids: number[]) => {
    setHidden((prev) => withIds(prev, ids));
  }, []);
  const unhide = useCallback((ids: number[]) => {
    setHidden((prev) => withoutIds(prev, ids));
  }, []);

  const clearSelection = useCallback(() => {
    setPicking(false);
    setSelected(new Set());
    setAnchorId(null);
  }, []);

  const setFilter = useCallback(
    (next: LibraryFilter) => {
      clearSelection();
      setOpenId(null);
      // Another set of photos starts at its top.
      place.current = null;
      setFilterState(next);
    },
    [clearSelection],
  );

  // Another library folder is another set of photos: start again from nothing.
  const [shownRoot, setShownRoot] = useState(root);
  if (shownRoot !== root) {
    setShownRoot(root);
    setLoaded(null);
    setHidden(NONE);
    setTrips([]);
    setSummary(null);
    setError(null);
    setFilterState(NO_FILTER);
    setSelected(new Set());
    setPicking(false);
    setAnchorId(null);
    setOpenId(null);
  }
  useEffect(() => {
    place.current = null;
    unhideOnLoad.current = NONE;
    if (root) void reload();
  }, [root, reload]);

  useJobDone("index", (done) => {
    if (done.ok) setSummary(done.result as IndexSummary);
    void reload();
  });
  useJobDone(RELOAD_ON, () => void reload());
  // Flagged after starting the load, which makes every earlier load stale, so the photos come
  // back from a read made after the job.
  useJobDone("remove", () => {
    void reload();
    unhideOnLoad.current = withIds(unhideOnLoad.current, hiddenNow.current);
  });

  // One object per change, so pages that read the store redraw only when it changes, not on
  // every render of the provider.
  const value = useMemo(
    () => ({
      tiles,
      trips,
      summary,
      error,
      filter,
      setFilter,
      selected,
      setSelected,
      picking,
      setPicking,
      anchorId,
      setAnchorId,
      openId,
      setOpenId,
      place,
      clearSelection,
      reload,
      hide,
      unhide,
    }),
    // State setters and the place ref never change, so they aren't listed.
    [
      tiles,
      trips,
      summary,
      error,
      filter,
      setFilter,
      selected,
      picking,
      anchorId,
      openId,
      clearSelection,
      reload,
      hide,
      unhide,
    ],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}
