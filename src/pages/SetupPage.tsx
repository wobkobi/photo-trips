import { open } from "@tauri-apps/plugin-dialog";
import { useState, type ReactElement } from "react";
import { Icon } from "../components/Icon";
import { Button } from "../components/ui";
import { errorText } from "../lib/api";
import { useSettings } from "../lib/useSettings";

/**
 * First run: choose the folder that becomes the library.
 * @returns the page
 */
export function SetupPage(): ReactElement {
  const { save } = useSettings();
  const [error, setError] = useState<string | null>(null);

  /** Ask for the library folder and save it, showing any failure to save. */
  async function chooseFolder(): Promise<void> {
    setError(null);
    const picked = await open({ directory: true, title: "Choose your photo library folder" });
    if (typeof picked !== "string") return;
    try {
      await save("library_root", picked);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    // Centred with auto margins rather than align-items, so at a large text size the top of the
    // text stays reachable when it's taller than the window.
    <div className="flex h-full overflow-y-auto px-8 py-8">
      <div className="m-auto max-w-lg">
        <h1 className="text-[52px] leading-[1.05] font-extrabold tracking-tight text-brand">
          Where do your photos live?
        </h1>
        <p className="mt-5 text-[17px] leading-relaxed text-muted">
          Pick the folder you want Pic Cabinet to keep tidy. Photos inside it get sorted into year
          and month folders, and trips get folders of their own. Nothing moves until you review the
          plan and say so.
        </p>
        <p className="mt-3 text-[17px] leading-relaxed text-muted">
          Photos kept somewhere else, like an old backup, a memory card or your phone, can be
          brought in from Import once the library is set up.
        </p>
        <Button variant="primary" className="mt-8 px-5 py-2.5 text-[16px]" onClick={chooseFolder}>
          <Icon name="folder" />
          Choose library folder
        </Button>
        {error && <p className="mt-4 text-danger">{error}</p>}
      </div>
    </div>
  );
}
