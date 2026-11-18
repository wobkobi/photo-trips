import type { ReactElement } from "react";
import type { FileDetails } from "../lib/api";
import { cameraName, cameraSettings, lensText, sizeText } from "../lib/details";
import { clockTime } from "../lib/format";
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
  const length = video && details.duration ? clockTime(details.duration) : null;
  if (!size && !length) return null;
  return (
    <p className="mt-1 text-[15px] text-muted tabular-nums">
      {[length, size].filter(Boolean).join(" · ")}
    </p>
  );
}

/**
 * The camera or phone, then its lens and its settings for the shot on one line each. Hovering
 * the settings names them, since the line shows values only.
 * @param props - Component props.
 * @param props.details - the file's details
 * @returns the fact, or nothing when the file records no camera, lens or settings
 */
export function CameraFact({ details }: { details: FileDetails }): ReactElement | null {
  const camera = cameraName(details.make, details.model);
  const settings = cameraSettings(details);
  const lens = lensText(details);
  if (!camera && !lens && settings.length === 0) return null;
  return (
    <Fact label="Camera">
      <p className="selectable">{camera ?? "Not recorded"}</p>
      {lens && <p className="selectable mt-1 text-[15px] wrap-break-word text-muted">{lens}</p>}
      {settings.length > 0 && (
        <p
          className="selectable mt-1 text-[15px] text-muted tabular-nums"
          title={settings.map(([label]) => label).join(", ")}
        >
          {settings.map(([, value]) => value).join(" · ")}
        </p>
      )}
    </Fact>
  );
}
