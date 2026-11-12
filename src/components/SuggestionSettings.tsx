import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { busyChoices, DEFAULT_MIN_PHOTOS, minPhotosOf } from "../lib/settingValues";
import { useAction } from "../lib/useAction";
import { useSettings } from "../lib/useSettings";
import { INPUT } from "./Field";
import { Row, SavedText, Section } from "./SettingParts";

/** Trip suggestion settings: how busy a day must be, and where home is. */
export function SuggestionSettings() {
  const { settings, save } = useSettings();
  const { error, run, clear } = useAction();
  const minPhotos = minPhotosOf(settings);
  const home = settings?.home_location ?? "";
  // The town near a home, kept with the home it was looked up for so an old answer is ignored.
  const [place, setPlace] = useState<{ home: string; name: string | null } | null>(null);

  useEffect(() => {
    if (!home) return;
    let live = true;
    api.homePlace(home).then(
      (name) => live && setPlace({ home, name }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [home]);

  const placeNow = place?.home === home ? place : null;

  return (
    <Section title="Trip suggestions" error={error}>
      <Row
        title="Busy day"
        detail="A day with at least this many photos and videos counts as busy, and two or more busy days in a row are suggested as a trip. Lower it if trips are missed, raise it if ordinary weekends turn up."
      >
        <select
          aria-label="Photos and videos for a busy day"
          value={minPhotos}
          onChange={(event) => run(() => save("suggest_min_photos", event.target.value))}
          className={`${INPUT} w-36`}
        >
          {busyChoices(minPhotos).map((n) => (
            <option key={n} value={n}>
              {n === DEFAULT_MIN_PHOTOS ? `${n} (usual)` : n}
            </option>
          ))}
        </select>
      </Row>
      <Row title="Home" detail={homeDetail(home, placeNow?.name)}>
        <SavedText
          value={home}
          label="Home latitude and longitude"
          placeholder="-36.85, 174.76"
          className="w-52"
          onSave={(text) => run(() => save("home_location", text))}
          onRevert={clear}
        />
      </Row>
    </Section>
  );
}

/**
 * The explanation under the home box: where a set home is, or how home is found otherwise.
 * @param home - the saved "lat, lon", or empty
 * @param place - the nearest town (null when none is near, undefined while looking up)
 * @returns the text
 */
function homeDetail(home: string, place: string | null | undefined): string {
  const away =
    "Days more than 50 km from home are suggested as trips however few photos they have.";
  if (!home) {
    return `${away} Home is worked out from where photos were taken on the most days. To set it, right-click your home in an online map, copy the latitude and longitude, and paste them here.`;
  }
  const where =
    place === undefined ? "" : place ? `Near ${place}. ` : "No town within 100 km of there. ";
  return `${where}${away} Empty the box to work home out from your photos instead.`;
}
