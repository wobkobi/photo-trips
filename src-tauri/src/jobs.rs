// Background jobs (index, apply, import, hash). Only one runs at a time: two jobs moving or
// reading the same files at once could race, and one progress bar is easier to follow.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::error::{Error, Result};

pub const PROGRESS_EVENT: &str = "job://progress";
pub const DONE_EVENT: &str = "job://done";

/// Progress events are capped at this rate so a fast job doesn't flood the webview.
const EMIT_EVERY: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub kind: &'static str,
    pub stage: String,
    pub done: usize,
    /// 0 while the total isn't known yet (the UI shows an indeterminate bar).
    pub total: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Done {
    kind: &'static str,
    ok: bool,
    cancelled: bool,
    error: Option<String>,
    result: serde_json::Value,
}

struct Running {
    cancel: Arc<AtomicBool>,
    progress: Arc<Mutex<Progress>>,
}

/// Managed state: the job currently running, if any.
#[derive(Default)]
pub struct Jobs {
    current: Mutex<Option<Running>>,
    /// Set while an update installs. The app exits partway through, so no job may start.
    /// Only changed with `current` locked, which keeps it in step with the busy check.
    closed: AtomicBool,
}

/// Handed to a job's work function: cancel flag and progress reporting.
pub struct JobCtx {
    app: AppHandle,
    cancel: Arc<AtomicBool>,
    progress: Arc<Mutex<Progress>>,
    last_emit: Mutex<Instant>,
}

impl JobCtx {
    pub fn cancel_flag(&self) -> &AtomicBool {
        &self.cancel
    }

    /// Record progress and emit it, throttled. The last step of a stage always gets through.
    pub fn report(&self, stage: &str, done: usize, total: usize) {
        let snapshot = {
            let Ok(mut progress) = self.progress.lock() else { return };
            progress.stage.clear();
            progress.stage.push_str(stage);
            progress.done = done;
            progress.total = total;
            progress.clone()
        };
        let Ok(mut last) = self.last_emit.lock() else { return };
        if done == total || last.elapsed() >= EMIT_EVERY {
            *last = Instant::now();
            let _ = self.app.emit(PROGRESS_EVENT, snapshot);
        }
    }
}

impl Jobs {
    /// Progress of the running job, so a page opened mid-job can show it.
    pub fn status(&self) -> Option<Progress> {
        let current = self.current.lock().ok()?;
        let running = current.as_ref()?;
        running.progress.lock().ok().map(|p| p.clone())
    }

    pub fn cancel(&self) {
        if let Ok(current) = self.current.lock()
            && let Some(running) = current.as_ref()
        {
            running.cancel.store(true, Ordering::Relaxed);
        }
    }

    pub fn is_running(&self) -> bool {
        self.current.lock().map(|c| c.is_some()).unwrap_or(false)
    }

    /// Stop any more jobs starting, when none is running. Returns the running job's kind
    /// instead (and leaves jobs open) when one is.
    pub fn close(&self) -> std::result::Result<(), &'static str> {
        let Ok(current) = self.current.lock() else {
            return Err("job");
        };
        if let Some(running) = current.as_ref() {
            return Err(running.progress.lock().map(|p| p.kind).unwrap_or("job"));
        }
        self.closed.store(true, Ordering::Relaxed);
        Ok(())
    }

    /// Let jobs start again after [`Jobs::close`].
    pub fn reopen(&self) {
        if let Ok(_current) = self.current.lock() {
            self.closed.store(false, Ordering::Relaxed);
        }
    }
}

/// Start `work` on a background thread. Fails straight away if another job is running.
/// The outcome arrives as a `job://done` event carrying the serialised result.
pub fn start<T, F>(app: &AppHandle, kind: &'static str, work: F) -> Result<()>
where
    T: Serialize,
    F: FnOnce(&JobCtx) -> Result<T> + Send + 'static,
{
    let jobs = app.state::<Jobs>();
    let ctx = {
        let mut current = jobs
            .current
            .lock()
            .map_err(|_| Error::msg("Job lock poisoned"))?;
        if jobs.closed.load(Ordering::Relaxed) {
            return Err(Error::msg("Photo Trips is installing an update."));
        }
        if current.is_some() {
            return Err(Error::msg("Photo Trips is busy with another task. Try again when it finishes."));
        }
        let ctx = JobCtx {
            app: app.clone(),
            cancel: Arc::new(AtomicBool::new(false)),
            progress: Arc::new(Mutex::new(Progress {
                kind,
                stage: "Starting".into(),
                done: 0,
                total: 0,
            })),
            last_emit: Mutex::new(Instant::now() - EMIT_EVERY),
        };
        *current = Some(Running {
            cancel: ctx.cancel.clone(),
            progress: ctx.progress.clone(),
        });
        ctx
    };
    ctx.report("Starting", 0, 0);

    std::thread::Builder::new()
        .name(format!("job-{kind}"))
        .spawn(move || {
            // A panic must still clear the slot, or every later job would be refused as "busy".
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| work(&ctx)))
                .unwrap_or_else(|_| Err(Error::msg("Something went wrong. Check the log.")));
            let cancelled = ctx.cancel.load(Ordering::Relaxed);
            let done = match outcome {
                Ok(result) => Done {
                    kind,
                    ok: true,
                    cancelled: false,
                    error: None,
                    result: serde_json::to_value(result).unwrap_or_default(),
                },
                Err(err) => {
                    if !cancelled {
                        log::error!("{kind} job failed: {err}");
                    }
                    Done {
                        kind,
                        ok: false,
                        cancelled,
                        error: (!cancelled).then(|| err.to_string()),
                        result: serde_json::Value::Null,
                    }
                }
            };
            // Clear the slot before announcing, so a listener can start the next job at once.
            if let Ok(mut current) = ctx.app.state::<Jobs>().current.lock() {
                *current = None;
            }
            let _ = ctx.app.emit(DONE_EVENT, done);
        })
        .map_err(Error::from)?;
    Ok(())
}
