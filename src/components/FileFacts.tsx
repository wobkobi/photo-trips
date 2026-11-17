import { useState, type ReactElement } from "react";
import type { FileDetails } from "../lib/api";
import { cameraName, cameraSettings, durationText, sizeText } from "../lib/details";
import { Icon } from "./Icon";
import { Fact } from "./Viewer";

/**
 * A video's length and a picture's size in pixels, under the file's type.
 * @param props - Component props.
 * @param props.details - the file's details, or null while they load
 * @param props.video - the file is a video, so its length shows too
 * @returns the line, or nothing when neither is known
 */
export function Measures({
  details,
  video,
}: {
  details: FileDetails | null;
  video: boolean;
}): ReactElement | null {
  if (!details) return null;
  const size = sizeText(details, video);
  const length = video && details.duration ? durationText(details.duration) : null;
  if (!size && !length) return null;
  return <p className="mt-1 text-[15px] text-muted">{[length, size].filter(Boolean).join(", ")}</p>;
}

/** Whether the camera settings are showing; kept as the viewer steps from file to file. */
let settingsOpen = false;

/**
 * The camera or phone, with its settings for the shot behind "More details".
 * @param props - Component props.
 * @param props.details - the file's details
 * @returns the fact, or nothing when neither the camera nor its settings were recorded
 */
export function CameraFact({ details }: { details: FileDetails }): ReactElement | null {
  const [open, setOpen] = useState(settingsOpen);
  const camera = cameraName(details.make, details.model);
  const settings = cameraSettings(details);
  if (!camera && settings.length === 0) return null;

  /** Show or hide the settings, remembering the choice for the next file. */
  function toggle(): void {
    settingsOpen = !open;
    setOpen(!open);
  }

  return (
    <Fact label="Camera">
      <p className="selectable">{camera ?? "Not recorded"}</p>
      {settings.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={toggle}
            className="mt-1 -ml-1 flex min-h-8.5 items-center gap-1.5 rounded-lg px-1 text-[15px] font-semibold text-accent hover:underline"
          >
            <Icon name="chevron" size={16} className={open ? "rotate-90" : ""} />
            {open ? "Fewer details" : "More details"}
          </button>
          {open && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[15px]">
              {settings.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-faint">{label}</dt>
                  <dd className="selectable wrap-break-word">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
    </Fact>
  );
}
