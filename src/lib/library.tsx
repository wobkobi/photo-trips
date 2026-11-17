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
import { NO_FILTER, type LibraryFilter } from "./libraryFilter";
import { useJobDone } from "./useJobs";
import { LibraryContext } from "./useLibrary";
import { useSettings } from "./useSettings";

/** Jobs whose end can change which photos there are, or their dates and trips. */
const RELOAD_ON = ["apply", "undo", "remove", "import", "inbox"];

/**
 * Loads the library's photos and trips and keeps the Library page's filter, selection and open
 * photo, so leaving the page and coming back finds everything as it was. Reloads when a job
 * that changes the library ends, whichever page is showing. Must be under JobsProvider and
 * SettingsProvider.
 * @param props - Component props.
 * @param props.children - app content
 * @returns the provider element
 */
export function LibraryProvider({ children }: { children: ReactNode }): ReactElement {
  const { settings } = useSettings();
  const root = settings?.library_root || null;
  const [tiles, setTiles] = useState<Tile[] | null>(null);
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

  const reload = useCallback((): Promise<void> => {
    loadSeq.current += 1;
    const seq = loadSeq.current;
    return Promise.all([api.libraryTiles(), api.listTrips()]).then(
      ([loadedTiles, loadedTrips]) => {
        if (seq !== loadSeq.current) return;
        setTiles(loadedTiles);
        setTrips(loadedTrips);
        setError(null);
      },
      (err) => {
        if (seq === loadSeq.current) setError(errorText(err));
      },
    );
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
    setTiles(null);
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
    if (root) void reload();
  }, [root, reload]);

  useJobDone("index", (done) => {
    if (done.ok) setSummary(done.result as IndexSummary);
    void reload();
  });
  useJobDone(RELOAD_ON, () => void reload());

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
    ],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}
