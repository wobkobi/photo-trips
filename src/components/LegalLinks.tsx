import { openUrl } from "@tauri-apps/plugin-opener";

/** The public repo, whose main branch holds the current version of each document. */
const DOCS = "https://github.com/wobkobi/photo-trips/blob/main";

const LINKS = [
  { label: "Licence", href: `${DOCS}/LICENSE` },
  { label: "Privacy policy", href: `${DOCS}/PRIVACY.md` },
  { label: "Third-party notices", href: `${DOCS}/THIRD_PARTY_NOTICES.txt` },
];

/**
 * Settings > About's links to the licence, privacy policy and third-party notices, opened in the
 * browser. The installer also puts the licence and notices in the install folder.
 * @returns the row of links
 */
export function LegalLinks() {
  return (
    <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
      {LINKS.map(({ label, href }) => (
        <button
          key={label}
          type="button"
          className="text-muted underline underline-offset-2 hover:text-ink"
          onClick={() => void openUrl(href)}
        >
          {label}
        </button>
      ))}
    </p>
  );
}
