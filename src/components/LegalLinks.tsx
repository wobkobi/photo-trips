import { openUrl } from "@tauri-apps/plugin-opener";
import { useState, type ReactElement } from "react";
import { api, errorText } from "../lib/api";

/** The public repo, whose main branch holds the current version of each document. */
const DOCS = "https://github.com/wobkobi/pic-cabinet/blob/main";

/**
 * Settings > About's links. The licence and privacy policy open in the browser; the third-party
 * notices open from the install folder, since they're generated for each build and aren't online.
 * @returns the row of links, and any problem opening the notices
 */
export function LegalLinks(): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const links = [
    {
      label: "Licence",
      /**
       * Open the licence on GitHub.
       * @returns resolves once the browser has been asked to open it
       */
      open: (): Promise<void> => openUrl(`${DOCS}/LICENSE`),
    },
    {
      label: "Privacy policy",
      /**
       * Open the privacy policy on GitHub.
       * @returns resolves once the browser has been asked to open it
       */
      open: (): Promise<void> => openUrl(`${DOCS}/PRIVACY.md`),
    },
    {
      label: "Third-party notices",
      /**
       * Open the notices file from the install folder.
       * @returns resolves once it has been handed to the default app
       */
      open: (): Promise<void> => api.openNotices(),
    },
  ];

  return (
    <>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[15px]">
        {links.map(({ label, open }) => (
          <button
            key={label}
            type="button"
            className="text-muted underline underline-offset-2 hover:text-ink"
            onClick={() => {
              setError(null);
              open().catch((err: unknown) => setError(errorText(err)));
            }}
          >
            {label}
          </button>
        ))}
      </p>
      {error && (
        <p role="alert" className="mt-1 text-[15px] text-danger">
          {error}
        </p>
      )}
    </>
  );
}
