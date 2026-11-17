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
import { Tour } from "./components/Tour";
import type { TripInfo } from "./lib/api";
import { themeOf } from "./lib/display";
import { JobsProvider } from "./lib/jobs";
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
  isTextEntry,
  modalOnScreen,
  useMenuBar,
  type HistoryStep,
  type MenuRequest,
} from "./lib/menu";
import { pushEntry, startHistory, stepBack, stepForward, type NavEntry } from "./lib/navHistory";
import { PageMemoryProvider } from "./lib/pageMemory";
import { SettingsProvider } from "./lib/settings";
import type { TripStart } from "./lib/trips";
import { UpdatesProvider } from "./lib/updates";
import { useJobDone } from "./lib/useJobs";
import { useLibrary } from "./lib/useLibrary";
import { useSettings } from "./lib/useSettings";
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
 * Root component: settings, job, library and page memory providers around the shell.
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
              <Shell />
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
  const remember = useCallback(
    (next: NavEntry<PageId>) => {
      visits.current = pushEntry(visits.current, { page, filter }, next);
    },
    [page, filter],
  );
  const showTrip = useCallback(
    (trip: FilterTrip) => {
      // The viewer's link to the trip already on show keeps where Back goes.
      if (page !== "library" || tripOf(filter)?.id !== trip.id) setTripFrom(page);
      const next: LibraryFilter = { ...NO_FILTER, trip };
      remember({ page: "library", filter: next });
      setFilter(next);
      setPage("library");
    },
    [page, filter, setFilter, remember],
  );
  // Leaving takes the trip out of the filter wherever Back goes, so the Library next opens on
  // everything rather than on the trip just left.
  const leaveTrip = useCallback(() => {
    const next: LibraryFilter = { ...filter, trip: "any" };
    remember({ page: tripFrom, filter: next });
    setFilter(next);
    setPage(tripFrom);
  }, [filter, setFilter, tripFrom, remember]);
  // Opening the Library by name (sidebar, Ctrl+1, the tray, Import's link) means the whole
  // library, so any trip the filter still holds is left. Only showTrip opens a trip.
  const openPage = useCallback(
    (next: PageId) => {
      const leaving = next === "library" && tripOf(filter) !== null;
      const nextFilter: LibraryFilter = leaving ? { ...filter, trip: "any" } : filter;
      remember({ page: next, filter: nextFilter });
      if (leaving) setFilter(nextFilter);
      setPage(next);
    },
    [filter, setFilter, remember],
  );
  // A page opened as it is, keeping the Library's filter and any trip in it.
  const goTo = useCallback(
    (next: PageId) => {
      remember({ page: next, filter });
      setPage(next);
    },
    [filter, remember],
  );
  // Back and forward put back the page and the filter. The filter is set only when it differs,
  // since setting it clears the selection, the open photo and the grid's place.
  const step = useCallback(
    (direction: HistoryStep) => {
      const here = { page, filter };
      visits.current =
        direction === "back" ? stepBack(visits.current, here) : stepForward(visits.current, here);
      const to = visits.current.entries[visits.current.at];
      if (!sameFilter(to.filter, filter)) setFilter(to.filter);
      setPage(to.page);
    },
    [page, filter, setFilter],
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

  useMenuBar((request: MenuRequest) => {
    if (request === "refresh") {
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

  if (settings === null) return null;
  if (!settings.library_root) return <SetupPage />;
  const touring = tourAsked || (!tourClosed && settings.tour_done !== "true");

  return (
    <div className="flex h-full">
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
            refresh={refresh}
            onRefreshStarted={refreshStarted}
            find={find}
            onFindStarted={findStarted}
            showAbout={showAbout}
            onAboutShown={aboutShown}
            onTour={() => setTourAsked(true)}
          />
        </main>
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
 * @param props.refresh - File > Refresh is waiting for the Library
 * @param props.onRefreshStarted - called once the Library has started looking
 * @param props.find - View > Find is waiting for the Library's file name box
 * @param props.onFindStarted - called once the Library has taken the find request
 * @param props.showAbout - Settings should open at About
 * @param props.onAboutShown - called once Settings has shown About
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
  refresh,
  onRefreshStarted,
  find,
  onFindStarted,
  showAbout,
  onAboutShown,
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
  refresh: boolean;
  onRefreshStarted: () => void;
  find: boolean;
  onFindStarted: () => void;
  showAbout: boolean;
  onAboutShown: () => void;
  onTour: () => void;
}): ReactElement {
  switch (page) {
    case "library":
      return (
        <LibraryPage
          onCreateTrip={onCreateTrip}
          onImport={() => onNavigate("import")}
          onNavigate={onNavigate}
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
      return <SortPage onNavigate={onNavigate} />;
    case "trips":
      return (
        <TripsPage
          draft={tripDraft}
          onDraftUsed={onTripDraftUsed}
          edit={tripEdit}
          onEditUsed={onTripEditUsed}
          onNavigate={onNavigate}
          onShowTrip={onShowTrip}
        />
      );
    case "suggestions":
      return <SuggestionsPage onNavigate={onNavigate} onCreateTrip={onCreateTrip} />;
    case "import":
      return <ImportPage onNavigate={onNavigate} />;
    case "duplicates":
      return <DuplicatesPage onNavigate={onNavigate} />;
    case "history":
      return <HistoryPage onNavigate={onNavigate} />;
    case "settings":
      return (
        <SettingsPage showAbout={showAbout} onAboutShown={onAboutShown} onNavigate={onNavigate} />
      );
    case "help":
      return <HelpPage onNavigate={onNavigate} onTour={onTour} />;
  }
}
