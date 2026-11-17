import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";
import type { ApplySummary, UndoSummary } from "./api";
import { jobToast, NO_TOASTS, toastReducer, type JobToast, type ToastInput } from "./toastQueue";
import { JOB_NAMES, useJobDone } from "./useJobs";
import { useSettings } from "./useSettings";
import { ToastListContext, ToastsContext, type ToastsValue } from "./useToasts";

/**
 * Holds the toasts and the jobs pages are waiting on, above every page, so a result shows even
 * when the page that started the job has been left. Must be inside JobsProvider and
 * SettingsProvider.
 * @param props - Component props.
 * @param props.children - app content
 * @returns the provider element
 */
export function ToastProvider({ children }: { children: ReactNode }): ReactElement {
  const [state, dispatch] = useReducer(toastReducer, NO_TOASTS);
  // One wish per job kind: only one job runs at a time, and a page starts one only when none is.
  const expected = useRef(new Map<string, JobToast>());

  useJobDone(Object.keys(JOB_NAMES), (done) => {
    if (done.kind === "undo" && done.ok && done.result) {
      dispatch({ type: "undone", batchId: (done.result as UndoSummary).batchId });
    }
    const wishes = expected.current.get(done.kind);
    if (!wishes) return;
    expected.current.delete(done.kind);
    if (done.ok && done.result) {
      dispatch({ type: "add", toast: jobToast(done.result as ApplySummary, wishes) });
    }
  });

  // Another library folder's batches can't be undone from here.
  const root = useSettings().settings?.library_root;
  useEffect(() => {
    dispatch({ type: "clear" });
    expected.current.clear();
  }, [root]);

  const expectJob = useCallback((kind: string, wishes: JobToast) => {
    expected.current.set(kind, wishes);
    return () => {
      if (expected.current.get(kind) === wishes) expected.current.delete(kind);
    };
  }, []);
  const show = useCallback((toast: ToastInput) => dispatch({ type: "add", toast }), []);
  const dismiss = useCallback((id: number) => dispatch({ type: "dismiss", id }), []);
  const fail = useCallback((id: number, text: string) => dispatch({ type: "fail", id, text }), []);

  const actions = useMemo<ToastsValue>(() => ({ expectJob, show }), [expectJob, show]);
  const list = useMemo(
    () => ({ toasts: state.toasts, dismiss, fail }),
    [state.toasts, dismiss, fail],
  );

  return (
    <ToastsContext.Provider value={actions}>
      <ToastListContext.Provider value={list}>{children}</ToastListContext.Provider>
    </ToastsContext.Provider>
  );
}
