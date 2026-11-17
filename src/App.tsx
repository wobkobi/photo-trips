import { listen } from "@tauri-apps/api/event";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { Sidebar } from "./components/Sidebar";
import { ToastHost } from "./components/ToastHost";
import { Tour } from "./components/Tour";
import { api, type TripInfo } from "./lib/api";
import { themeOf } from "./lib/display";
import { JobsProvider } from "./lib/jobs";
import { BATCH_PAGE, newestUndoable } from "./lib/lastUndo";
import { LibraryProvider } from "./lib/library";
import {
  NO_FILTER,
  sameFilter,
  tripOf,
  type FilterTrip,
  type LibraryFilter,
} from "./lib/libraryFilter";
import {
  historyStepForButton,
  historyStepForKey,
  holdsWork,
  isTextEntry,
  modalOnScreen,
  useMenuBar,
  type HistoryStep,
  type MenuRequest,
} from "./lib/menu";
import {
  backReturnsTo,
  pushEntry,
  startHistory,
  stepBack,
  stepForward,
  type NavEntry,
} from "./lib/navHistory";
import { PageMemoryProvider } from "./lib/pageMemory";
import { SettingsProvider } from "./lib/settings";
import { ToastProvider } from "./lib/toasts";
import type { TripStart } from "./lib/trips";
import { UpdatesProvider } from "./lib/updates";
import { useFolderDrop } from "./lib/useFolderDrop";
import { useJobDone } from "./lib/useJobs";
import { useLibrary } from "./lib/useLibrary";
import { useSettings } from "./lib/useSettings";
import { useToasts } from "./lib/useToasts";
import { useUpdates } from "./lib/useUpdates";
import { keepsWebviewMenu } from "./lib/webviewMenu";
import { DuplicatesPage } from "./pages/DuplicatesPage";
import { HelpPage } from "./pages/HelpPage";
import { HistoryPage } from "./pages/HistoryPage";
import { ImportPage } from "./pages/ImportPage";
import { LibraryPage } from "./pages/LibraryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SetupPage } from "./pages/SetupPage";
import { SortPage } from "./pages/SortPage";
import { SuggestionsPage } from "./pages/SuggestionsPage";
import { TripsPage } from "./pages/TripsPage";

export type PageId =
  | "library"
  | "sort"
  | "trips"
  | "suggestions"
  | "import"
  | "duplicates"
  | "history"
  | "settings"
  | "help";

/**
 * A place for the history. With a trip on show it carries where the trip's Back returns to.
 * @param page - the page
 * @param filter - the Library's filter
 * @param from - the page the trip on show was opened from
 * @returns the entry
 */
function placeOf(page: PageId, filter: LibraryFilter, from: PageId): NavEntry<PageId> {
  return tripOf(filter) === null ? { page, filter } : { page, filter, from };
}

/**
 * Root component: settings, job, library, page memory and toast providers around the shell.
 * Right-clicks get no browser menu except on text, so the app never offers Back, Reload or Print.
 * @returns the app
 */
export default function App(): ReactElement {
  useEffect(() => {
    /**
     * Stop the webview's own menu unless the click was on text.
     * @param event - the right-click
     */
    const onMenu = (event: MouseEvent): void => {
      if (!keepsWebviewMenu(event.target, event.shiftKey, import.meta.env.DEV)) {
        event.preventDefault();
      }
    };
    window.addEventListener("contextmenu", onMenu);
    return () => window.removeEventListener("contextmenu", onMenu);
  }, []);

  return (
    <SettingsProvider>
      <JobsProvider>
        <UpdatesProvider>
          <LibraryProvider>
            <PageMemoryProvider>
              <ToastProvider>
                <Shell />
              </ToastProvider>
            </PageMemoryProvider>
          </LibraryProvider>
        </UpdatesProvider>
      </JobsProvider>
    </SettingsProvider>
  );
}

/**
 * The sidebar and current page, once settings have loaded; the setup page until a library
 * folder is chosen. Holds the state that has to outlive a page change.
 * @returns the shell, or null while settings load
 */
function Shell(): ReactElement | null {
  const { settings, save, reload } = useSettings();
  // A folder name change saves its presets with the batch, and undoing it puts them back.
  useJobDone(["apply", "undo"], reload);
  // The stylesheet picks light or dark from this; until settings load it follows Windows, which
  // the backend has already set the window to.
  const theme = themeOf(settings);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const { runCheck } = useUpdates();
  const toasts = useToasts();
  const [page, setPage] = useState<PageId>("library");
  // A trip started in the Library or Suggestions, until the Trips page opens it.
  const [tripDraft, setTripDraft] = useState<TripStart | null>(null);
  const clearTripDraft = useCallback(() => setTripDraft(null), []);
  // A trip the Library's Edit asked for, until the Trips page opens it in its editor.
  const [tripEdit, setTripEdit] = useState<TripInfo | null>(null);
  const clearTripEdit = useCallback(() => setTripEdit(null), []);
  // The trip on show is the one in the Library's filter; all Shell keeps is the page its Back
  // returns to.
  const [tripFrom, setTripFrom] = useState<PageId>("library");
  const { filter, setFilter } = useLibrary();
  // The places visited, for Alt+Left/Right and the mouse's side buttons. A ref, since nothing on
  // screen shows it. Every way of going somewhere records the place it opens, and a filter changed
  // on the page since is saved over the current entry, so back finds the page as it was left.
  const visits = useRef(startHistory<PageId>({ page: "library", filter: NO_FILTER }));
  // Another library folder is another set of places: what was visited, a trip's way back and any
  // trip waiting for the Trips page belong to the old one.
  const root = settings?.library_root || null;
  const [shownRoot, setShownRoot] = useState(root);
  if (shownRoot !== root) {
    setShownRoot(root);
    setTripFrom("library");
    setTripEdit(null);
    setTripDraft(null);
  }
  useEffect(() => {
    visits.current = startHistory<PageId>({ page: "library", filter: NO_FILTER });
  }, [root]);
  const remember = useCallback(
    (next: NavEntry<PageId>) => {
      visits.current = pushEntry(visits.current, placeOf(page, filter, tripFrom), next);
    },
    [page, filter, tripFrom],
  );
  const showTrip = useCallback(
    (trip: FilterTrip) => {
      // The viewer's link to the trip already on show keeps where Back goes.
      const from = page !== "library" || tripOf(filter)?.id !== trip.id ? page : tripFrom;
      const next: LibraryFilter = { ...NO_FILTER, trip };
      remember(placeOf("library", next, from));
      setTripFrom(from);
      setFilter(next);
      setPage("library");
    },
    [page, filter, tripFrom, setFilter, remember],
  );
  // Back and forward put back the page, the filter and, for a trip, where its Back returns to.
  // The filter is set only when it differs, since setting it clears the selection, the open photo
  // and the grid's place.
  const step = useCallback(
    (direction: HistoryStep) => {
      const here = placeOf(page, filter, tripFrom);
      visits.current =
        direction === "back" ? stepBack(visits.current, here) : stepForward(visits.current, here);
      const to = visits.current.entries[visits.current.at];
      if (!sameFilter(to.filter, filter)) setFilter(to.filter);
      if (to.from) setTripFrom(to.from);
      setPage(to.page);
    },
    [page, filter, tripFrom, setFilter],
  );
  // Leaving a trip goes back when the place before it is the page it was opened from, so that
  // page comes back with its own filter, and Forward returns to the trip. Otherwise it opens that
  // page anew, with the trip, and anything else it had narrowed, left behind.
  const leaveTrip = useCallback(() => {
    if (backReturnsTo(visits.current, tripFrom)) {
      step("back");
      return;
    }
    remember({ page: tripFrom, filter: NO_FILTER });
    setFilter(NO_FILTER);
    setPage(tripFrom);
  }, [setFilter, tripFrom, remember, step]);
  // Opening the Library by name (sidebar, Ctrl+1, the tray, Import's link) means the whole
  // library: inside a trip that's everything, with nothing else narrowed either. Only showTrip
  // opens a trip.
  const openPage = useCallback(
    (next: PageId) => {
      const leaving = next === "library" && tripOf(filter) !== null;
      const nextFilter = leaving ? NO_FILTER : filter;
      remember(placeOf(next, nextFilter, tripFrom));
      if (leaving) setFilter(nextFilter);
      setPage(next);
    },
    [filter, tripFrom, setFilter, remember],
  );
  // A page opened as it is, keeping the Library's filter and any trip in it.
  const goTo = useCallback(
    (next: PageId) => {
      remember(placeOf(next, filter, tripFrom));
      setPage(next);
    },
    [filter, tripFrom, remember],
  );
  // The listeners are added once, so they call the latest step through a ref.
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  });
  useEffect(() => {
    /**
     * Alt+Left and Alt+Right step through the places visited. A sub-step's own back (PageHeader
     * listens on the document, so it runs first) marks the key used and keeps it; so does a text
     * box, and a modal on screen.
     * @param event - the window's keydown
     */
    function onKey(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.repeat) return;
      const direction = historyStepForKey(event);
      if (!direction || isTextEntry(event.target) || modalOnScreen()) return;
      event.preventDefault();
      stepRef.current(direction);
    }
    /**
     * The mouse's side buttons do what Alt+Left and Alt+Right do. Every press is marked used,
     * even when nothing moves, so WebView2 never tries to go back a page in the document itself.
     * @param event - the window's mouseup
     */
    function onButton(event: MouseEvent): void {
      const direction = historyStepForButton(event.button);
      if (!direction) return;
      const used = event.defaultPrevented;
      event.preventDefault();
      if (!used && !modalOnScreen()) stepRef.current(direction);
    }
    /**
     * Mark a side button's press and click used too, for the same reason.
     * @param event - the window's mousedown or auxclick
     */
    function onButtonOther(event: MouseEvent): void {
      if (historyStepForButton(event.button)) event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onButton);
    window.addEventListener("mousedown", onButtonOther);
    window.addEventListener("auxclick", onButtonOther);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onButton);
      window.removeEventListener("mousedown", onButtonOther);
      window.removeEventListener("auxclick", onButtonOther);
    };
  }, []);
  // The navigate listener is added once, so it calls the latest openPage through a ref.
  const openPageRef = useRef(openPage);
  useEffect(() => {
    openPageRef.current = openPage;
  });
  const editTrip = useCallback(
    (trip: TripInfo) => {
      setTripEdit(trip);
      goTo("trips");
    },
    [goTo],
  );
  const createTrip = useCallback(
    (start: TripStart) => {
      setTripDraft(start);
      goTo("trips");
    },
    [goTo],
  );
  // Menu requests waiting for their page to open: File > Refresh, View > Find, and
  // Help > About or Check for updates (from Help or the tray), which both open Settings at About.
  const [refresh, setRefresh] = useState(false);
  const [find, setFind] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const refreshStarted = useCallback(() => setRefresh(false), []);
  const findStarted = useCallback(() => setFind(false), []);
  const aboutShown = useCallback(() => setShowAbout(false), []);
  // The tour shows once, after setup, until finished or skipped; Help can start it again.
  // Closing it also hides it here, so a failed save can't bring it straight back.
  const [tourAsked, setTourAsked] = useState(false);
  const [tourClosed, setTourClosed] = useState(false);
  const [tourPage, setTourPage] = useState<PageId | null>(null);
  const closeTour = useCallback(() => {
    setTourAsked(false);
    setTourClosed(true);
    void save("tour_done", "true").catch(() => undefined);
  }, [save]);
  // The batch Ctrl+Z picked, until History shows its undo question.
  const [undoAsk, setUndoAsk] = useState<number | null>(null);
  const undoAskUsed = useCallback(() => setUndoAsk(null), []);

  useMenuBar((request: MenuRequest) => {
    if (request === "undo") {
      // Nothing to undo leaves the page as it is. A failed list opens History, which shows why.
      if (!settings?.library_root) return;
      api.listBatches(BATCH_PAGE).then(
        (batches) => {
          const id = newestUndoable(batches);
          if (id === null) return;
          setUndoAsk(id);
          openPageRef.current("history");
        },
        () => openPageRef.current("history"),
      );
    } else if (request === "refresh") {
      setRefresh(true);
      goTo("library");
    } else if (request === "find") {
      setFind(true);
      goTo("library");
    } else {
      if (request === "updates") void runCheck();
      setShowAbout(true);
      goTo("settings");
    }
  });

  // The tray menu and the menu bar can ask for a page (e.g. "Import photos...").
  useEffect(() => {
    const unlisten = listen<PageId>("navigate", (event) => openPageRef.current(event.payload));
    return () => {
      void unlisten.then((off) => off());
    };
  }, []);

  // Another page starts at its top rather than at the last one's scroll. Only the page change
  // moves it; the Library's grid scrolls inside its own box and keeps its own place.
  const mainRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [page]);

  // A folder dropped on the window, until the Import page starts checking it.
  const [importDrop, setImportDrop] = useState<string | null>(null);
  const clearImportDrop = useCallback(() => setImportDrop(null), []);
  // A page holding work keeps it rather than opening Import over it.
  const dropping = useFolderDrop(Boolean(settings?.library_root), (folder) => {
    if (folder === null) {
      toasts.show({ text: "Drop a folder, not files", problem: true });
      return;
    }
    if (holdsWork()) {
      toasts.show({ text: "Finish or leave this step first", problem: true });
      return;
    }
    setImportDrop(folder);
    openPageRef.current("import");
  });

  if (settings === null) return null;
  if (!settings.library_root) return <SetupPage />;
  const touring = tourAsked || (!tourClosed && settings.tour_done !== "true");

  return (
    <div className="flex h-full">
      {/* First, so its Escape listener goes in ahead of the pages' own. */}
      <ToastHost onShow={openPage} />
      <Sidebar
        page={page}
        onPage={openPage}
        onShowTrip={showTrip}
        libraryRoot={settings.library_root}
        narrow={settings.menu_narrow === "true"}
        // A failed save leaves the menu as it was; there's nothing more useful to say about it.
        onNarrow={(narrow) => void save("menu_narrow", String(narrow)).catch(() => undefined)}
        highlight={touring ? tourPage : null}
      />
      {/* The tour covers only the page, so the menu items it points at stay in view. */}
      <div className="relative flex min-w-0 flex-1">
        <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto" inert={touring}>
          <CurrentPage
            page={page}
            onNavigate={openPage}
            onShowTrip={showTrip}
            onLeaveTrip={leaveTrip}
            onEditTrip={editTrip}
            tripEdit={tripEdit}
            onTripEditUsed={clearTripEdit}
            tripDraft={tripDraft}
            onTripDraftUsed={clearTripDraft}
            onCreateTrip={createTrip}
            importDrop={importDrop}
            onImportDropUsed={clearImportDrop}
            refresh={refresh}
            onRefreshStarted={refreshStarted}
            find={find}
            onFindStarted={findStarted}
            showAbout={showAbout}
            onAboutShown={aboutShown}
            undoAsk={undoAsk}
            onUndoAskUsed={undoAskUsed}
            onTour={() => setTourAsked(true)}
          />
        </main>
        {dropping && (
          <div className="pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-ground/80 text-[18px] font-semibold">
            Drop a folder to import it
          </div>
        )}
        {touring && (
          <Tour
            onStep={setTourPage}
            onClose={closeTour}
            onHelp={() => {
              closeTour();
              goTo("help");
            }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The page the sidebar has selected, with the state and callbacks it needs.
 * @param props - Component props.
 * @param props.page - which page to show
 * @param props.onNavigate - open another page
 * @param props.onShowTrip - show one trip in the Library
 * @param props.onLeaveTrip - leave the trip on show for the page it was opened from
 * @param props.onEditTrip - open a trip in the Trips page's editor
 * @param props.tripEdit - a trip to edit, for the Trips page to open
 * @param props.onTripEditUsed - called once the Trips page has opened that trip
 * @param props.tripDraft - a trip started elsewhere, for the Trips page to open
 * @param props.onTripDraftUsed - called once the Trips page has opened the draft
 * @param props.onCreateTrip - start a trip and open the Trips page
 * @param props.importDrop - a folder dropped on the window, for the Import page to check
 * @param props.onImportDropUsed - called once the Import page has taken the dropped folder
 * @param props.refresh - File > Refresh is waiting for the Library
 * @param props.onRefreshStarted - called once the Library has started looking
 * @param props.find - View > Find is waiting for the Library's file name box
 * @param props.onFindStarted - called once the Library has taken the find request
 * @param props.showAbout - Settings should open at About
 * @param props.onAboutShown - called once Settings has shown About
 * @param props.undoAsk - a batch Ctrl+Z picked, for History to ask about undoing
 * @param props.onUndoAskUsed - called once History has taken that batch
 * @param props.onTour - start the tour, from Help
 * @returns the page
 */
function CurrentPage({
  page,
  onNavigate,
  onShowTrip,
  onLeaveTrip,
  onEditTrip,
  tripEdit,
  onTripEditUsed,
  tripDraft,
  onTripDraftUsed,
  onCreateTrip,
  importDrop,
  onImportDropUsed,
  refresh,
  onRefreshStarted,
  find,
  onFindStarted,
  showAbout,
  onAboutShown,
  undoAsk,
  onUndoAskUsed,
  onTour,
}: {
  page: PageId;
  onNavigate: (page: PageId) => void;
  onShowTrip: (trip: FilterTrip) => void;
  onLeaveTrip: () => void;
  onEditTrip: (trip: TripInfo) => void;
  tripEdit: TripInfo | null;
  onTripEditUsed: () => void;
  tripDraft: TripStart | null;
  onTripDraftUsed: () => void;
  onCreateTrip: (start: TripStart) => void;
  importDrop: string | null;
  onImportDropUsed: () => void;
  refresh: boolean;
  onRefreshStarted: () => void;
  find: boolean;
  onFindStarted: () => void;
  showAbout: boolean;
  onAboutShown: () => void;
  undoAsk: number | null;
  onUndoAskUsed: () => void;
  onTour: () => void;
}): ReactElement {
  switch (page) {
    case "library":
      return (
        <LibraryPage
          onCreateTrip={onCreateTrip}
          onImport={() => onNavigate("import")}
          onShowTrip={onShowTrip}
          onLeaveTrip={onLeaveTrip}
          onEditTrip={onEditTrip}
          refreshRequested={refresh}
          onRefreshStarted={onRefreshStarted}
          findRequested={find}
          onFindStarted={onFindStarted}
        />
      );
    case "sort":
      return <SortPage />;
    case "trips":
      return (
        <TripsPage
          draft={tripDraft}
          onDraftUsed={onTripDraftUsed}
          edit={tripEdit}
          onEditUsed={onTripEditUsed}
          onShowTrip={onShowTrip}
        />
      );
    case "suggestions":
      return <SuggestionsPage onCreateTrip={onCreateTrip} />;
    case "import":
      return <ImportPage dropped={importDrop} onDroppedUsed={onImportDropUsed} />;
    case "duplicates":
      return <DuplicatesPage />;
    case "history":
      return (
        <HistoryPage onNavigate={onNavigate} undoAsk={undoAsk} onUndoAskUsed={onUndoAskUsed} />
      );
    case "settings":
      return <SettingsPage showAbout={showAbout} onAboutShown={onAboutShown} />;
    case "help":
      return <HelpPage onNavigate={onNavigate} onTour={onTour} />;
  }
}
