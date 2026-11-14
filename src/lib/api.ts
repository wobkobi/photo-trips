// Typed wrappers around the Rust commands in src-tauri/src/commands.rs.

import { invoke } from "@tauri-apps/api/core";

export type Settings = Record<string, string>;

export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  setSetting: (key: string, value: string) => invoke<void>("set_setting", { key, value }),
};

/** Error text from a rejected command (commands reject with a plain string). */
export function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
