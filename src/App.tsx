import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "./components/Sidebar";
import { NO_FILTER, type FilterTrip, type LibraryFilter } from "./lib/libraryFilter";
import { JobsProvider } from "./lib/jobs";
import { useMenuBar, type MenuRequest } from "./lib/menu";
import { SettingsProvider } from "./lib/settings";
import { UpdatesProvider } from "./lib/updates";
import { useJobDone } from "./lib/useJobs";
import { useUpdates } from "./lib/useUpdates";
import { useSettings } from "./lib/useSettings";
import { DuplicatesPage } from "./pages/DuplicatesPage";
import { HistoryPage } from "./pages/HistoryPage";
import { ImportPage } from "./pages/ImportPage";
import { LibraryPage } from "./pages/LibraryPage";
import { SetupPage } from "./pages/SetupPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SortPage } from "./pages/SortPage";
import { SuggestionsPage } from "./pages/SuggestionsPage";
import { TripsPage } from "./pages/TripsPage";
import type { TripStart } from "./lib/trips";

export type PageId =
  "library" | "sort" | "trips" | "suggestions" | "import" | "duplicates" | "history" | "settings";

/** Root component: settings and job providers around the shell. */
export default function App() {
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

function Shell() {
  const { settings, save, reload } = useSettings();
  // A folder name change saves its presets with the batch, and undoing it puts them back.
  useJobDone(["apply", "undo"], reload);
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
      unlisten.then((off) => off());
    };
  }, []);

  if (settings === null) return null;
  if (!settings.library_root) return <SetupPage />;

  return (
    <div className="flex h-full">
      <Sidebar
        page={page}
        onPage={setPage}
        libraryRoot={settings.library_root}
        narrow={settings.menu_narrow === "true"}
        onNarrow={(narrow) => void save("menu_narrow", String(narrow))}
      />
      <main className="min-w-0 flex-1 overflow-y-auto">
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
        />
      </main>
    </div>
  );
}

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
}) {
  switch (page) {
    case "library":
      return (
        <LibraryPage
          filter={filter}
          onFilter={onFilter}
          onCreateTrip={onCreateTrip}
          onImport={() => onNavigate("import")}
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
      return <HistoryPage />;
    case "settings":
      return (
        <SettingsPage showAbout={showAbout} onAboutShown={onAboutShown} onNavigate={onNavigate} />
      );
  }
}
