// Reading, tidying and describing the values on the Settings page.

import type { Settings, WatchStatus } from "./api";
import { count } from "./format";

/** Matches DEFAULT_MIN_PHOTOS in suggest.rs. */
export const DEFAULT_MIN_PHOTOS = 15;

/** How often a plugged-in card or phone gets a notification. Must match NOTIFY_CHOICES in devices.rs. */
export const DEVICE_NOTIFY: { value: string; label: string }[] = [
  { value: "always", label: "Every time" },
  { value: "day", label: "Once a day" },
  { value: "week", label: "Once a week" },
  { value: "never", label: "Never" },
];

/**
 * How often a plugged-in card or phone gets a notification.
 * @param settings - the saved settings
 * @returns one of the {@link DEVICE_NOTIFY} values, once a day when unset
 */
export function deviceNotifyOf(settings: Settings | null): string {
  const saved = settings?.device_notify ?? "";
  return DEVICE_NOTIFY.some((choice) => choice.value === saved) ? saved : "day";
}

/** Choices in the busy-day dropdown on the Settings page, as photos per day. */
const BUSY_CHOICES = [5, 10, 15, 20, 30, 50];

/**
 * The inbox folders saved in Settings.
 * @param text - the inbox_folders setting, a JSON array of paths
 * @returns the paths, or none when unset or unreadable
 */
export function parseFolders(text: string | undefined): string[] {
  if (!text?.trim()) return [];
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Whether two Windows paths name the same folder: case and a trailing slash don't matter.
 * @param a - one path
 * @param b - the other
 * @returns true when they match
 */
export function samePath(a: string, b: string): boolean {
  /**
   * Lower-case a path and strip its trailing slashes.
   * @param path - a Windows path
   * @returns the comparable form
   */
  const norm = (path: string): string => path.replace(/[\\/]+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

/**
 * The last part of a folder path, which tells folders apart better than the start does.
 * @param path - e.g. "C:\Users\Me\OneDrive\Pictures\Camera Roll"
 * @returns e.g. "Camera Roll", or "D:" for a drive
 */
export function folderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * Extension list as saved: lower case, no dots, no repeats, comma separated.
 * @param text - what was typed, e.g. ".ORF xyz,abc"
 * @returns e.g. "orf, xyz, abc"
 */
export function normaliseExtensions(text: string): string {
  const exts = text
    .split(/[\s,;]+/)
    .map((ext) => ext.replace(/^\.+/, "").toLowerCase())
    .filter(Boolean);
  return [...new Set(exts)].join(", ");
}

/**
 * Photos and videos a day needs to count as busy for suggestions.
 * @param settings - the saved settings
 * @returns the saved number, or the default
 */
export function minPhotosOf(settings: Settings | null): number {
  const saved = Number(settings?.suggest_min_photos);
  return Number.isInteger(saved) && saved >= 1 ? saved : DEFAULT_MIN_PHOTOS;
}

/**
 * The busy-day counts offered in Settings, keeping a saved count that isn't one of them.
 * @param current - the count in use
 * @returns counts in ascending order
 */
export function busyChoices(current: number): number[] {
  if (BUSY_CHOICES.includes(current)) return BUSY_CHOICES;
  return [...BUSY_CHOICES, current].sort((a, b) => a - b);
}

/**
 * The app's version as Settings > About shows it, marking a pre-release build.
 * @param version - the running version, e.g. "0.31.0-beta.3"
 * @returns e.g. "Version 0.31.0-beta.3 (beta)", or "Version 0.30.0" for a release
 */
export function versionLabel(version: string): string {
  // Semver puts a pre-release after the first "-"; build metadata after "+" doesn't count.
  const beta = version.split("+")[0].includes("-");
  return beta ? `Version ${version} (beta)` : `Version ${version}`;
}

/**
 * One line on what the inbox watcher is doing.
 * @param status - the watcher's state
 * @returns e.g. "Watching 2 folders. 3 files are still copying in."
 */
export function watchSummary(status: WatchStatus): string {
  const { folders, missing, paused, waiting } = status;
  if (folders.length === 0 && missing.length === 0) return "Add a folder to start watching.";
  if (paused) return "Paused. Anything put in an inbox meanwhile is moved in on resuming.";
  if (folders.length === 0) {
    return missing.length === 1
      ? "The inbox folder can't be found."
      : "None of the inbox folders can be found.";
  }
  const watching = `Watching ${count(folders.length, "folder", "folders")}.`;
  if (waiting === 0) return watching;
  return `${watching} ${count(waiting, "file is", "files are")} still copying in.`;
}
