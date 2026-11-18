import { createContext, useContext } from "react";
import type { JobToast, Toast, ToastInput } from "./toastQueue";

/** What pages use: stable for the app's life, so asking for it never re-renders a page. */
export interface ToastsValue {
  /**
   * Show a toast when the next job of `kind` ends, so the result shows whichever page is open
   * by then. Call it just before starting the job. A job that fails shows nothing here; the
   * sidebar's job status already shows its error.
   * @returns forget the wish, for when the job couldn't start
   */
  expectJob: (kind: string, wishes: JobToast) => () => void;
  /** Show a toast now, for a change that isn't a background job (a date change). */
  show: (toast: ToastInput) => void;
}

/** What the toast host uses: the toasts on screen and what can be done to them. */
export interface ToastListValue {
  toasts: Toast[];
  dismiss: (id: number) => void;
  /** Undo couldn't start: the toast says why in place of its text. */
  fail: (id: number, text: string) => void;
}

export const ToastsContext = createContext<ToastsValue | null>(null);
export const ToastListContext = createContext<ToastListValue | null>(null);

/**
 * Toasts for results. Must be used under ToastProvider.
 * @returns ways to show a toast now or when a job ends
 */
export function useToasts(): ToastsValue {
  const ctx = useContext(ToastsContext);
  if (!ctx) throw new Error("useToasts outside ToastProvider");
  return ctx;
}

/**
 * The toasts on screen. Must be used under ToastProvider.
 * @returns the toasts and what can be done to them
 */
export function useToastList(): ToastListValue {
  const ctx = useContext(ToastListContext);
  if (!ctx) throw new Error("useToastList outside ToastProvider");
  return ctx;
}
