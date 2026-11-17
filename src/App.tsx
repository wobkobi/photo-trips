import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Sidebar } from "./components/Sidebar";
import { Tour } from "./components/Tour";
import { themeOf } from "./lib/display";
import { JobsProvider } from "./lib/jobs";
import { NO_FILTER, type FilterTrip, type LibraryFilter } from "./lib/libraryFilter";
import { useMenuBar, type MenuRequest } from "./lib/menu";
import { SettingsProvider } from "./lib/settings";
import type { TripStart } from "./lib/trips";
import { UpdatesProvider } from "./lib/updates";
import { useJobDone } from "./lib/useJobs";
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
 * Root component: settings and job providers around the shell. Right-clicks get no browser menu
 * except on text, so the app never offers Back, Reload or Print.
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
          <Shell />
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
  // Kept here, not in the Library, so it survives a trip to another page and back.
  const [filter, setFilter] = useState<LibraryFilter>(NO_FILTER);
  const showTrip = useCallback((trip: FilterTrip) => {
    setFilter({ ...NO_FILTER, trip });
    setPage("library");
  }, []);
  const createTrip = useCallback((start: TripStart) => {
    setTripDraft(start);
    setPage("trips");
  }, []);
  // Menu requests waiting for their page to open: File > Look for new photos, and Help > About or
  // Check for updates (from Help or the tray), which both open Settings at About.
  const [refresh, setRefresh] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const refreshStarted = useCallback(() => setRefresh(false), []);
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
      setPage("library");
    } else {
      if (request === "updates") void runCheck();
      setShowAbout(true);
      setPage("settings");
    }
  });

  // The tray menu and the menu bar can ask for a page (e.g. "Import photos...").
  useEffect(() => {
    const unlisten = listen<PageId>("navigate", (event) => setPage(event.payload));
    return () => {
      void unlisten.then((off) => off());
    };
  }, []);

  if (settings === null) return null;
  if (!settings.library_root) return <SetupPage />;
  const touring = tourAsked || (!tourClosed && settings.tour_done !== "true");

  return (
    <div className="flex h-full">
      <Sidebar
        page={page}
        onPage={setPage}
        libraryRoot={settings.library_root}
        narrow={settings.menu_narrow === "true"}
        // A failed save leaves the menu as it was; there's nothing more useful to say about it.
        onNarrow={(narrow) => void save("menu_narrow", String(narrow)).catch(() => undefined)}
        highlight={touring ? tourPage : null}
      />
      {/* The tour covers only the page, so the menu items it points at stay in view. */}
      <div className="relative flex min-w-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto" inert={touring}>
          <CurrentPage
            page={page}
            onNavigate={setPage}
            filter={filter}
            onFilter={setFilter}
            onShowTrip={showTrip}
            tripDraft={tripDraft}
            onTripDraftUsed={clearTripDraft}
            onCreateTrip={createTrip}
            refresh={refresh}
            onRefreshStarted={refreshStarted}
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
              setPage("help");
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
 * @param props.filter - the Library filter
 * @param props.onFilter - change the Library filter
 * @param props.onShowTrip - show one trip in the Library
 * @param props.tripDraft - a trip started elsewhere, for the Trips page to open
 * @param props.onTripDraftUsed - called once the Trips page has opened the draft
 * @param props.onCreateTrip - start a trip and open the Trips page
 * @param props.refresh - File > Look for new photos is waiting for the Library
 * @param props.onRefreshStarted - called once the Library has started looking
 * @param props.showAbout - Settings should open at About
 * @param props.onAboutShown - called once Settings has shown About
 * @param props.onTour - start the tour, from Help
 * @returns the page
 */
function CurrentPage({
  page,
  onNavigate,
  filter,
  onFilter,
  onShowTrip,
  tripDraft,
  onTripDraftUsed,
  onCreateTrip,
  refresh,
  onRefreshStarted,
  showAbout,
  onAboutShown,
  onTour,
}: {
  page: PageId;
  onNavigate: (page: PageId) => void;
  filter: LibraryFilter;
  onFilter: (filter: LibraryFilter) => void;
  onShowTrip: (trip: FilterTrip) => void;
  tripDraft: TripStart | null;
  onTripDraftUsed: () => void;
  onCreateTrip: (start: TripStart) => void;
  refresh: boolean;
  onRefreshStarted: () => void;
  showAbout: boolean;
  onAboutShown: () => void;
  onTour: () => void;
}): ReactElement {
  switch (page) {
    case "library":
      return (
        <LibraryPage
          filter={filter}
          onFilter={onFilter}
          onCreateTrip={onCreateTrip}
          onImport={() => onNavigate("import")}
          onNavigate={onNavigate}
          refreshRequested={refresh}
          onRefreshStarted={onRefreshStarted}
        />
      );
    case "sort":
      return <SortPage onNavigate={onNavigate} />;
    case "trips":
      return (
        <TripsPage
          draft={tripDraft}
          onDraftUsed={onTripDraftUsed}
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
