// Loading what a file says about itself for the viewer's side panel.

import { useEffect, useState } from "react";
import type { FileDetails } from "./api";

/** Details read lately, oldest first. A handful is enough for stepping back and forth. */
const read = new Map<string, FileDetails>();
const KEEP = 30;
/** Reads in flight, so the look-ahead and the side panel never read one file twice at once. */
const reading = new Map<string, Promise<FileDetails>>();

/**
 * Read a file's details once, sharing the answer between the look-ahead and the side panel. A
 * failed read isn't kept, so the next try reads again.
 * @param key - changes whenever `load` would read a different file
 * @param load - reads the details
 * @returns the details
 */
export function readDetails(key: string, load: () => Promise<FileDetails>): Promise<FileDetails> {
  const done = read.get(key);
  if (done) return Promise.resolve(done);
  const inFlight = reading.get(key);
  if (inFlight) return inFlight;
  const request = load()
    .then((details) => {
      read.set(key, details);
      for (const old of read.keys()) {
        if (read.size <= KEEP) break;
        read.delete(old);
      }
      return details;
    })
    .finally(() => reading.delete(key));
  reading.set(key, request);
  return request;
}

/**
 * What the file says about itself. Ready at once when the viewer's look-ahead read it already;
 * otherwise null until it arrives.
 * @param key - changes whenever `load` would read a different file
 * @param load - reads the details; memoised by the caller
 * @returns the details, or null
 */
export function useFileDetails(key: string, load: () => Promise<FileDetails>): FileDetails | null {
  const [found, setFound] = useState<{ key: string; details: FileDetails } | null>(null);
  const cached = read.get(key);
  useEffect(() => {
    if (read.has(key)) return;
    let active = true;
    // Missing details aren't worth an error: the panel just shows less.
    readDetails(key, load).then(
      (details) => active && setFound({ key, details }),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [key, load]);
  return cached ?? (found?.key === key ? found.details : null);
}

/**
 * Where the file says it was taken.
 * @param details - the file's details, or null while they load
 * @returns the location, or null when there is none
 */
export function located(details: FileDetails | null): { lat: number; lon: number } | null {
  return details?.lat != null && details.lon != null
    ? { lat: details.lat, lon: details.lon }
    : null;
}
