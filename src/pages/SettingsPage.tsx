import { useEffect, useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { Button, PageHeader } from "../components/ui";
import { errorText } from "../lib/api";
import { useSettings } from "../lib/useSettings";

/** App settings: library folder and window behaviour. */
export function SettingsPage() {
  const { settings, save } = useSettings();
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    isEnabled().then(setAutostart, () => setAutostart(false));
  }, []);

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function changeLibrary() {
    const picked = await open({ directory: true, title: "Choose your photo library folder" });
    if (typeof picked === "string") await run(() => save("library_root", picked));
  }

  const closeToTray = settings?.close_to_tray !== "false";

  return (
    <>
      <PageHeader title="Settings" />
      <div className="max-w-2xl px-8 py-6">
        {error && <p className="mb-4 text-danger">{error}</p>}
        <Row
          title="Library folder"
          detail={<span className="selectable">{settings?.library_root}</span>}
        >
          <Button onClick={changeLibrary}>Change folder</Button>
        </Row>
        <Row
          title="Keep running in the tray"
          detail="Closing the window leaves Photo Trips in the system tray so it can watch for new photos and devices."
        >
          <Toggle
            checked={closeToTray}
            label="Keep running in the tray"
            onChange={(on) => run(() => save("close_to_tray", on ? "true" : "false"))}
          />
        </Row>
        <Row title="Start with Windows" detail="Opens quietly in the tray when you sign in.">
          <Toggle
            checked={autostart ?? false}
            disabled={autostart === null}
            label="Start with Windows"
            onChange={(on) =>
              run(async () => {
                await (on ? enable() : disable());
                setAutostart(on);
              })
            }
          />
        </Row>
      </div>
    </>
  );
}

/**
 * One setting: title and explanation on the left, control on the right.
 * @param props.title - setting name
 * @param props.detail - what it does
 * @param props.children - the control
 * @returns the row element
 */
export function Row({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-line py-5">
      <div className="min-w-0">
        <h2 className="font-medium">{title}</h2>
        {detail && <p className="mt-1 text-[13px] break-words text-muted">{detail}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/**
 * On/off switch.
 * @param props.checked - current state
 * @param props.label - accessible name
 * @param props.disabled - greys the switch out
 * @param props.onChange - called with the new state
 * @returns the switch element
 */
export function Toggle({
  checked,
  label,
  disabled,
  onChange,
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full border transition-colors disabled:opacity-40 ${
        checked ? "border-paper bg-paper" : "border-line bg-raised"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-[18px] w-[18px] rounded-full transition-transform ${
          checked ? "translate-x-5 bg-ground" : "bg-muted"
        }`}
      />
    </button>
  );
}
