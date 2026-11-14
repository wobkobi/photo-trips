import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Icon, type IconName } from "./components/Icon";
import { SettingsProvider } from "./lib/settings";
import { useSettings } from "./lib/useSettings";
import { SetupPage } from "./pages/SetupPage";
import { SettingsPage } from "./pages/SettingsPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";

export type PageId =
  "library" | "trips" | "suggestions" | "import" | "duplicates" | "history" | "settings";

const NAV: { id: PageId; label: string; icon: IconName }[] = [
  { id: "library", label: "Library", icon: "library" },
  { id: "trips", label: "Trips", icon: "trips" },
  { id: "suggestions", label: "Suggestions", icon: "suggest" },
  { id: "import", label: "Import", icon: "import" },
  { id: "duplicates", label: "Duplicates", icon: "duplicates" },
  { id: "history", label: "History", icon: "history" },
  { id: "settings", label: "Settings", icon: "settings" },
];

/** Root component: settings provider around the shell. */
export default function App() {
  return (
    <SettingsProvider>
      <Shell />
    </SettingsProvider>
  );
}

function Shell() {
  const { settings } = useSettings();
  const [page, setPage] = useState<PageId>("library");

  // The tray menu can ask for a page (e.g. "Import photos...").
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
      <nav className="flex w-52 shrink-0 flex-col border-r border-line bg-surface px-3 py-5">
        <div className="px-3 pb-6">
          <span className="font-display text-[22px] leading-none font-semibold">Photo Trips</span>
        </div>
        <ul className="flex flex-col gap-0.5">
          {NAV.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setPage(item.id)}
                aria-current={page === item.id ? "page" : undefined}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${
                  page === item.id
                    ? "bg-raised text-paper"
                    : "text-muted hover:bg-raised/60 hover:text-paper"
                }`}
              >
                <Icon name={item.icon} />
                {item.label}
              </button>
            </li>
          ))}
        </ul>
        <p
          className="selectable mt-auto truncate px-3 text-[12px] text-faint"
          title={settings.library_root}
        >
          {settings.library_root}
        </p>
      </nav>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <CurrentPage page={page} />
      </main>
    </div>
  );
}

function CurrentPage({ page }: { page: PageId }) {
  switch (page) {
    case "settings":
      return <SettingsPage />;
    default:
      return <PlaceholderPage title={NAV.find((n) => n.id === page)?.label ?? ""} />;
  }
}
