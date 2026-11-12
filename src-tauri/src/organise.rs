// Commands for sorting the library into trip and year/month folders: a dry-run preview for
// the user to review, then applying exactly that preview as one undoable batch.

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::AppState;
use crate::commands::{format_table, library_root, lock_db};
use crate::error::{Error, Result};
use crate::executor::{self, Env, NewBatch, OnBegin};
use crate::groups;
use crate::index;
use crate::jobs;
use crate::planner::{self, Plan, Rules};
use crate::trips;

/// A previewed plan waiting for the user to apply it.
pub struct PendingBatch {
    /// Batch kind for History: `organise`, `trip`.
    pub kind: &'static str,
    pub label: String,
    pub root: PathBuf,
    pub plan: Plan,
    /// Database change saved with the batch (a trip's new dates, say).
    pub on_begin: Option<Arc<OnBegin>>,
}

/// Managed state: the latest preview. Applying names its id, so what runs is exactly what the
/// user reviewed, and a stale preview can't be applied by mistake.
#[derive(Default)]
pub struct Previews {
    next_id: AtomicU64,
    latest: Mutex<Option<(u64, Arc<PendingBatch>)>>,
}

impl Previews {
    /// Keep `pending` as the latest preview, replacing any older one. Returns its id.
    pub fn store(&self, pending: PendingBatch) -> u64 {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        if let Ok(mut latest) = self.latest.lock() {
            *latest = Some((id, Arc::new(pending)));
        }
        id
    }

    fn get(&self, id: u64) -> Result<Arc<PendingBatch>> {
        self.latest
            .lock()
            .ok()
            .and_then(|latest| latest.clone())
            .filter(|(latest_id, _)| *latest_id == id)
            .map(|(_, pending)| pending)
            .ok_or_else(|| Error::msg("This preview is out of date. Check the changes again."))
    }

    fn clear(&self, id: u64) {
        if let Ok(mut latest) = self.latest.lock()
            && latest
                .as_ref()
                .is_some_and(|(latest_id, _)| *latest_id == id)
        {
            *latest = None;
        }
    }
}

/// What a plan will do, for the review screen.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub id: u64,
    /// Files that will move.
    pub files: usize,
    /// Groups that get a ` (n)` added to their names.
    pub renamed: usize,
    /// Groups already in the right folder.
    pub in_place: usize,
    /// Files never moved (sidecars without their photo, files outside the library).
    pub left_alone: usize,
    /// Destination folders, relative to the library, with how many files each receives.
    pub folders: Vec<FolderCount>,
    pub items: Vec<PreviewItem>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderCount {
    pub folder: String,
    pub files: usize,
}

/// One group's move, shown by its leader.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewItem {
    /// Leader's media id, for the thumbnail.
    pub id: i64,
    pub version: i64,
    /// Paths relative to the library folder.
    pub from: String,
    pub to: String,
    /// Companion files moving with the leader.
    pub extra: usize,
    pub renamed: bool,
}

/// Work out the moves that would put every file in its trip or year and month folder.
#[tauri::command(async)]
pub fn plan_organise(state: State<'_, AppState>, previews: State<'_, Previews>) -> Result<Preview> {
    let (root, table, rows, trips) = {
        let conn = lock_db(&state)?;
        (
            library_root(&conn)?,
            format_table(&conn)?,
            index::load_rows(&conn)?,
            trips::load(&conn)?,
        )
    };
    let versions: HashMap<i64, i64> = rows.iter().map(|r| (r.id, r.mtime)).collect();
    let (groups, orphans) = groups::build(rows);
    let plan = planner::plan(
        &Rules {
            root: &root,
            trips: &trips,
        },
        &groups,
        orphans.len(),
        &table,
        &|p| fs::symlink_metadata(p).is_ok(),
    );
    let files = plan.file_count();
    let label = format!(
        "Sorted {files} {} into their folders",
        if files == 1 { "file" } else { "files" }
    );
    let mut preview = describe(&root, &plan, &versions);
    preview.id = previews.store(PendingBatch {
        kind: "organise",
        label,
        root,
        plan,
        on_begin: None,
    });
    Ok(preview)
}

/// Run a previewed plan in the background as one undoable batch.
#[tauri::command]
pub fn apply_plan(app: AppHandle, previews: State<Previews>, id: u64) -> Result<()> {
    let pending = previews.get(id)?;
    let handle = app.clone();
    jobs::start(&app, "apply", move |ctx| {
        let state = handle.state::<AppState>();
        let table = format_table(&*lock_db(&state)?)?;
        let env = Env {
            db: &state.db,
            root: &pending.root,
            table: &table,
            cancel: ctx.cancel_flag(),
            report: &|stage, done, total| ctx.report(stage, done, total),
        };
        let batch = NewBatch {
            kind: pending.kind,
            label: &pending.label,
            on_begin: pending.on_begin.as_deref(),
        };
        executor::apply(&env, &batch, &pending.plan)
    })?;
    previews.clear(id);
    Ok(())
}

/// Summarise a plan for the review screen. `versions` maps media ids to their modified time,
/// for thumbnail URLs.
pub(crate) fn describe(root: &Path, plan: &Plan, versions: &HashMap<i64, i64>) -> Preview {
    let mut folders: BTreeMap<String, usize> = BTreeMap::new();
    let items = plan
        .groups
        .iter()
        .filter_map(|group| {
            let leader = group.moves.first()?;
            let to = relative(root, &leader.to);
            let folder = Path::new(&to)
                .parent()
                .map(|p| p.to_string_lossy().into_owned());
            *folders.entry(folder.unwrap_or_default()).or_default() += group.moves.len();
            Some(PreviewItem {
                id: leader.media_id,
                version: versions.get(&leader.media_id).copied().unwrap_or_default(),
                from: relative(root, &leader.from),
                to,
                extra: group.moves.len() - 1,
                renamed: group.renamed,
            })
        })
        .collect();
    Preview {
        id: 0,
        files: plan.file_count(),
        renamed: plan.groups.iter().filter(|g| g.renamed).count(),
        in_place: plan.in_place,
        left_alone: plan.left_alone,
        // Newest folder first, matching the library timeline.
        folders: folders
            .into_iter()
            .rev()
            .map(|(folder, files)| FolderCount { folder, files })
            .collect(),
        items,
    }
}

/// `path` relative to the library folder, or in full when it is somewhere else.
pub fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::planner::{GroupMove, Move};

    #[test]
    fn describe_counts_files_per_folder_newest_first() {
        let root = Path::new("C:\\L");
        let mv = |id: i64, from: &str, to: &str| Move {
            media_id: id,
            from: root.join(from),
            to: root.join(to),
        };
        let plan = Plan {
            groups: vec![
                GroupMove {
                    moves: vec![
                        mv(1, "in\\IMG_1.HEIC", "2025\\2025-03\\IMG_1.HEIC"),
                        mv(2, "in\\IMG_1.MOV", "2025\\2025-03\\IMG_1.MOV"),
                    ],
                    renamed: false,
                },
                GroupMove {
                    moves: vec![mv(3, "in\\IMG_2.JPG", "2025\\2025-04\\IMG_2 (1).JPG")],
                    renamed: true,
                },
            ],
            in_place: 4,
            left_alone: 1,
        };
        let preview = describe(root, &plan, &HashMap::from([(1, 77)]));
        assert_eq!(
            (preview.files, preview.renamed, preview.in_place),
            (3, 1, 4)
        );
        let folders: Vec<_> = preview
            .folders
            .iter()
            .map(|f| (f.folder.as_str(), f.files))
            .collect();
        assert_eq!(folders, [("2025\\2025-04", 1), ("2025\\2025-03", 2)]);
        assert_eq!(preview.items[0].from, "in\\IMG_1.HEIC");
        assert_eq!((preview.items[0].extra, preview.items[0].version), (1, 77));
    }
}
