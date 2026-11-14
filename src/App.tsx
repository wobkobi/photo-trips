import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { BrandMark } from "./components/BrandMark";
import { Icon, type IconName } from "./components/Icon";
import { JobStatus } from "./components/JobStatus";
import { JobsProvider } from "./lib/jobs";
import { useMenuBar, type MenuRequest } from "./lib/menu";
import { SettingsProvider } from "./lib/settings";
import { UpdatesProvider } from "./lib/updates";
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

const NAV: { id: PageId; label: string; icon: IconName }[] = [
  { id: "library", label: "Library", icon: "library" },
  { id: "sort", label: "Sort", icon: "sort" },
  { id: "trips", label: "Trips", icon: "trips" },
  { id: "suggestions", label: "Suggestions", icon: "suggest" },
  { id: "import", label: "Import", icon: "import" },
  { id: "duplicates", label: "Duplicates", icon: "duplicates" },
  { id: "history", label: "History", icon: "history" },
  { id: "settings", label: "Settings", icon: "settings" },
];

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
  const { settings } = useSettings();
  const { runCheck } = useUpdates();
  const [page, setPage] = useState<PageId>("library");
  // A trip started in the Library or Suggestions, until the Trips page opens it.
  const [tripDraft, setTripDraft] = useState<TripStart | null>(null);
  const clearTripDraft = useCallback(() => setTripDraft(null), []);
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
      <nav className="on-brand flex w-60 shrink-0 flex-col overflow-y-auto px-3 pb-5">
        <div className="mb-4 flex items-center gap-3 border-b border-line px-2 pt-5 pb-4">
          <BrandMark size={34} className="shrink-0" />
          <div className="min-w-0">
            <p className="text-[19px] leading-none font-extrabold tracking-tight">Pic Cabinet</p>
            <p className="mt-1.5 text-[14px] leading-none font-semibold text-accent">
              To the Point Tech
            </p>
          </div>
        </div>
        <ul className="flex flex-col gap-0.5">
          {NAV.map((item) => (
            <li key={item.id}>
              {/* The active page gets a moonstone rule on its left edge, as on the website's
                  admin sidebar; it's a pseudo-element so the label doesn't shift. */}
              <button
                type="button"
                onClick={() => setPage(item.id)}
                aria-current={page === item.id ? "page" : undefined}
                className={`relative flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[18px] font-semibold transition-colors ${
                  page === item.id
                    ? "bg-raised text-ink before:absolute before:inset-y-2 before:left-0 before:w-0.75 before:rounded-r-sm before:bg-accent"
                    : "text-muted hover:bg-raised hover:text-ink"
                }`}
              >
                <Icon name={item.icon} />
                {item.label}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-auto flex flex-col gap-3">
          <JobStatus />
          <p
            className="selectable truncate px-3 text-[14px] text-faint"
            title={settings.library_root}
          >
            {settings.library_root}
          </p>
        </div>
      </nav>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <CurrentPage
          page={page}
          onNavigate={setPage}
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
          onCreateTrip={onCreateTrip}
          onImport={() => onNavigate("import")}
          refreshRequested={refresh}
          onRefreshStarted={onRefreshStarted}
        />
      );
    case "sort":
      return <SortPage onNavigate={onNavigate} />;
    case "trips":
      return <TripsPage draft={tripDraft} onDraftUsed={onTripDraftUsed} onNavigate={onNavigate} />;
    case "suggestions":
      return <SuggestionsPage onNavigate={onNavigate} onCreateTrip={onCreateTrip} />;
    case "import":
      return <ImportPage onNavigate={onNavigate} />;
    case "duplicates":
      return <DuplicatesPage onNavigate={onNavigate} />;
    case "history":
      return <HistoryPage />;
    case "settings":
      return <SettingsPage showAbout={showAbout} onAboutShown={onAboutShown} />;
  }
}
