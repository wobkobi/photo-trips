import {
  createContext,
  useContext,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { IndexSummary, Tile, TripInfo } from "./api";
import type { GridPlace } from "./format";
import type { LibraryFilter } from "./libraryFilter";

export interface LibraryContextValue {
  /**
   * Every photo and video in the library, less those hidden on their way to the Recycle Bin,
   * or null until the first load.
   */
  tiles: Tile[] | null;
  trips: TripInfo[];
  /** What the last library refresh found, once one has finished. */
  summary: IndexSummary | null;
  /** Why the last load failed, or null. */
  error: string | null;
  /** Which photos the Library shows. */
  filter: LibraryFilter;
  /** Show another set of photos; the selection and the open photo belong to the old set, so go. */
  setFilter: (filter: LibraryFilter) => void;
  /** Ids of the selected photos. */
  selected: ReadonlySet<number>;
  setSelected: Dispatch<SetStateAction<ReadonlySet<number>>>;
  /** Select mode was turned on with the button, so a plain click selects even with none yet. */
  picking: boolean;
  setPicking: Dispatch<SetStateAction<boolean>>;
  /** Id of the photo a Shift-click range starts from. */
  anchorId: number | null;
  setAnchorId: Dispatch<SetStateAction<number | null>>;
  /** Id of the photo open in the viewer. */
  openId: number | null;
  setOpenId: Dispatch<SetStateAction<number | null>>;
  /** Where the Library's grid is scrolled to, so it opens there again. */
  place: RefObject<GridPlace | null>;
  /** Leave select mode and deselect everything. */
  clearSelection: () => void;
  /** Read the photos and trips again; resolves once both are in. */
  reload: () => Promise<void>;
  /** Hide photos on their way to the Recycle Bin, until the first load after the bin job ends. */
  hide: (ids: number[]) => void;
  /** Show hidden photos again, as when the bin job couldn't start. */
  unhide: (ids: number[]) => void;
}

export const LibraryContext = createContext<LibraryContextValue | null>(null);

/**
 * The library's photos and the Library page's place in them, kept above the pages so they
 * survive a visit elsewhere. Must be used under LibraryProvider.
 * @returns the library state and its setters
 */
export function useLibrary(): LibraryContextValue {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary outside LibraryProvider");
  return ctx;
}
