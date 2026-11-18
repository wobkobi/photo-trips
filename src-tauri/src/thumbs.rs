// Thumbnails and full-size previews from the Windows shell: the same images Explorer shows, so
// any format with an installed handler (HEIC, RAW, most video) gets a picture, already turned
// upright. Rendered on a small pool of COM threads, cached as JPEGs and served on thumb://.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use tauri::http::{Request, Response, StatusCode, header};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use crate::AppState;

/// Grid tiles: long edge in pixels. Large tiles are ~280 CSS px, so this stays sharp at 175%
/// combined text size and Windows scaling.
pub const THUMB_SIZE: i32 = 512;
/// Full-size viewer for formats the webview can't draw itself.
pub const PREVIEW_SIZE: i32 = 2048;

/// Requests beyond this are for tiles scrolled far out of view; the oldest are dropped.
const MAX_QUEUE: usize = 1000;

/// How long a file Windows couldn't draw is answered "no picture" without trying again. Long
/// enough that scrolling past it doesn't redraw it each time, short enough that a file still
/// being written (a sync, a copy) gets its picture once it's done.
const RETRY_AFTER: Duration = Duration::from_secs(60);

/// Painted behind transparent images, matching where each rendering is shown (both are colours
/// in index.css): thumbnails sit on `raised` tiles, and the viewer's stage is `.on-dark` `ground`.
const TILE_BACKGROUND: [u8; 3] = rgb(0xe2e6e9);
const VIEWER_BACKGROUND: [u8; 3] = rgb(0x001514);

/// Cache folders carry this number. Raise it when renderings change (such as a background colour)
/// so stale images aren't served; folders with other numbers are deleted at start.
const CACHE_VERSION: u32 = 3;

/// `0xRRGGBB` as bytes, so colours here read like the hex codes in index.css.
const fn rgb(hex: u32) -> [u8; 3] {
    [(hex >> 16) as u8, (hex >> 8) as u8, hex as u8]
}

type Callback = Box<dyn FnOnce(Option<Vec<u8>>) + Send>;

struct Job {
    source: PathBuf,
    cache: PathBuf,
    /// The viewer's full-size picture rather than a grid tile.
    full: bool,
    /// Everyone waiting for this rendering: a picture asked for again while queued joins it.
    done: Vec<Callback>,
}

#[derive(Default)]
struct Queue {
    jobs: Vec<Job>,
    /// Renderings being drawn, with callers who asked for them meanwhile.
    running: HashMap<PathBuf, Vec<Callback>>,
}

#[derive(Default)]
struct Shared {
    queue: Mutex<Queue>,
    ready: Condvar,
    /// Cache paths the shell couldn't render, and when, so they aren't retried on every scroll.
    failed: Mutex<HashMap<PathBuf, Instant>>,
}

/// Managed state: the render threads and cache folders.
pub struct Pool {
    shared: Arc<Shared>,
    thumbs_dir: PathBuf,
    previews_dir: PathBuf,
}

impl Pool {
    pub fn new(workers: usize, data_dir: &Path) -> Self {
        let thumbs_dir = data_dir.join(format!("thumbs-v{CACHE_VERSION}"));
        let previews_dir = data_dir.join(format!("previews-v{CACHE_VERSION}"));
        let _ = std::fs::create_dir_all(&thumbs_dir);
        let _ = std::fs::create_dir_all(&previews_dir);
        let stale = stale_cache_dirs(data_dir);
        if !stale.is_empty() {
            let _ = std::thread::Builder::new()
                .name("thumbs-cleanup".into())
                .spawn(move || {
                    for dir in stale {
                        let _ = std::fs::remove_dir_all(dir);
                    }
                });
        }
        let shared = Arc::new(Shared::default());
        for n in 0..workers {
            let shared = shared.clone();
            let _ = std::thread::Builder::new()
                .name(format!("thumbs-{n}"))
                .spawn(move || worker(&shared));
        }
        Pool {
            shared,
            thumbs_dir,
            previews_dir,
        }
    }

    /// Cache file for one rendering. Keyed on name, size and modified time rather than the full
    /// path, so sorting a file into another folder keeps its cached thumbnail.
    fn cache_path(&self, source: &Path, size: u64, mtime: i64, full: bool) -> PathBuf {
        let name = source
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let px = if full { PREVIEW_SIZE } else { THUMB_SIZE };
        let key = blake3::hash(format!("{name}|{size}|{mtime}|{px}").as_bytes()).to_hex();
        let dir = if full {
            &self.previews_dir
        } else {
            &self.thumbs_dir
        };
        dir.join(format!("{}.jpg", &key[..32]))
    }

    /// Let every file Windows couldn't draw be tried again at once, for when a codec extension
    /// has just been added or removed.
    pub fn forget_failures(&self) {
        lock(&self.shared.failed).clear();
    }

    /// Cached JPEG bytes, or a render queued on the pool. `done` gets `None` when the shell has
    /// no image for the file (missing codec, corrupt file) or couldn't draw it in the last
    /// minute. `full` is the viewer's size and background.
    fn get(&self, source: PathBuf, cache: PathBuf, full: bool, done: Callback) {
        if let Ok(bytes) = std::fs::read(&cache) {
            return done(Some(bytes));
        }
        if failed_lately(&mut lock(&self.shared.failed), &cache, Instant::now()) {
            return done(None);
        }
        let dropped = {
            let mut queue = lock(&self.shared.queue);
            if let Some(waiting) = queue.running.get_mut(&cache) {
                waiting.push(done);
                return;
            }
            // Asked for again while queued (the viewer stepping onto a picture it fetched ahead):
            // one rendering serves both, and it moves up as the newest request.
            let job = match queue.jobs.iter().position(|j| j.cache == cache) {
                Some(at) => {
                    let mut job = queue.jobs.remove(at);
                    job.done.push(done);
                    job
                }
                None => Job {
                    source,
                    cache,
                    full,
                    done: vec![done],
                },
            };
            queue.jobs.push(job);
            let excess = queue.jobs.len().saturating_sub(MAX_QUEUE);
            queue.jobs.drain(..excess).collect::<Vec<_>>()
        };
        self.shared.ready.notify_one();
        for job in dropped {
            for done in job.done {
                done(None);
            }
        }
    }
}

/// Whether the shell failed to draw `cache` within [`RETRY_AFTER`] of `now`. An older failure is
/// forgotten, so the caller tries the file again.
fn failed_lately(failed: &mut HashMap<PathBuf, Instant>, cache: &Path, now: Instant) -> bool {
    match failed.get(cache) {
        Some(at) if now.saturating_duration_since(*at) < RETRY_AFTER => true,
        Some(_) => {
            failed.remove(cache);
            false
        }
        None => false,
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn worker(shared: &Shared) {
    #[cfg(windows)]
    // SAFETY: initialises COM once for this dedicated thread, which lives as long as the app.
    unsafe {
        use windows::Win32::System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx};
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    }
    loop {
        let job = {
            let mut queue = lock(&shared.queue);
            loop {
                if let Some(at) = next_job(&queue.jobs) {
                    let job = queue.jobs.remove(at);
                    queue.running.insert(job.cache.clone(), Vec::new());
                    break job;
                }
                queue = shared
                    .ready
                    .wait(queue)
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
            }
        };
        let jpeg = if job.full {
            render(&job.source, PREVIEW_SIZE, VIEWER_BACKGROUND)
        } else {
            render(&job.source, THUMB_SIZE, TILE_BACKGROUND)
        };
        match &jpeg {
            Some(bytes) => write_atomic(&job.cache, bytes),
            None => {
                lock(&shared.failed).insert(job.cache.clone(), Instant::now());
            }
        }
        let waiting = lock(&shared.queue)
            .running
            .remove(&job.cache)
            .unwrap_or_default();
        for done in job.done.into_iter().chain(waiting) {
            done(jpeg.clone());
        }
    }
}

/// Which queued job to draw next. The viewer's full-size pictures go before grid tiles, since
/// one of them is the photo on screen and a backlog of tiles from scrolling would otherwise hold
/// it up for seconds. Within each, newest first: the photo just opened or the tile just scrolled
/// to.
fn next_job(jobs: &[Job]) -> Option<usize> {
    jobs.iter()
        .rposition(|j| j.full)
        .or_else(|| jobs.len().checked_sub(1))
}

/// Write through a temp file so a crash mid-write never leaves a half JPEG in the cache.
fn write_atomic(path: &Path, bytes: &[u8]) {
    let tmp = path.with_extension("tmp");
    if std::fs::write(&tmp, bytes).is_ok() {
        let _ = std::fs::rename(&tmp, path);
    }
}

/// Ask the shell for an image of the file, fitted inside `size` x `size`, as JPEG.
#[cfg(windows)]
fn render(source: &Path, size: i32, background: [u8; 3]) -> Option<Vec<u8>> {
    use windows::Win32::Foundation::SIZE;
    use windows::Win32::Graphics::Gdi::DeleteObject;
    use windows::Win32::UI::Shell::{
        IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_RESIZETOFIT,
        SIIGBF_THUMBNAILONLY,
    };

    // SAFETY: COM is initialised on this thread by `worker`; the bitmap handle is owned here and
    // deleted once its pixels are copied out.
    unsafe {
        let factory: IShellItemImageFactory =
            SHCreateItemFromParsingName(&crate::win::parsing_name(source), None).ok()?;
        // THUMBNAILONLY: a generic file icon is worse than the UI's own file-type tile.
        let bitmap = factory
            .GetImage(
                SIZE { cx: size, cy: size },
                SIIGBF_RESIZETOFIT | SIIGBF_THUMBNAILONLY,
            )
            .ok()?;
        let pixels = bitmap_pixels(bitmap);
        let _ = DeleteObject(bitmap.into());
        let (bgra, width, height) = pixels?;
        encode_jpeg(&flatten(&bgra, background), width, height)
    }
}

#[cfg(not(windows))]
fn render(_source: &Path, _size: i32, _background: [u8; 3]) -> Option<Vec<u8>> {
    None
}

/// Copy a shell bitmap out as top-down 32-bit BGRA.
#[cfg(windows)]
unsafe fn bitmap_pixels(
    bitmap: windows::Win32::Graphics::Gdi::HBITMAP,
) -> Option<(Vec<u8>, u32, u32)> {
    use windows::Win32::Graphics::Gdi::{
        BI_RGB, BITMAP, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleDC, DIB_RGB_COLORS, DeleteDC,
        GetDIBits, GetObjectW,
    };

    // SAFETY: the caller owns `bitmap`; every buffer passed is sized for what GDI writes.
    unsafe {
        let mut info = BITMAP::default();
        let read = GetObjectW(
            bitmap.into(),
            size_of::<BITMAP>() as i32,
            Some(std::ptr::from_mut(&mut info).cast()),
        );
        let (width, height) = (info.bmWidth, info.bmHeight.abs());
        if read == 0 || width <= 0 || height <= 0 {
            return None;
        }
        let mut header = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                // Negative height asks GDI for rows top-down.
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut buffer = vec![0u8; width as usize * height as usize * 4];
        let dc = CreateCompatibleDC(None);
        let lines = GetDIBits(
            dc,
            bitmap,
            0,
            height as u32,
            Some(buffer.as_mut_ptr().cast()),
            &mut header,
            DIB_RGB_COLORS,
        );
        let _ = DeleteDC(dc);
        (lines == height).then_some((buffer, width as u32, height as u32))
    }
}

/// Cache folders this version doesn't use: `thumbs` and `previews` without a number, and any
/// numbered copy other than [`CACHE_VERSION`]. Other folders in the app's data are left alone.
fn stale_cache_dirs(data_dir: &Path) -> Vec<PathBuf> {
    let current = [
        format!("thumbs-v{CACHE_VERSION}"),
        format!("previews-v{CACHE_VERSION}"),
    ];
    let is_cache = |name: &str| {
        ["thumbs", "previews"].iter().any(|base| {
            name == *base
                || name
                    .strip_prefix(base)
                    .and_then(|rest| rest.strip_prefix("-v"))
                    .is_some_and(|n| n.parse::<u32>().is_ok())
        })
    };
    let Ok(entries) = std::fs::read_dir(data_dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            is_cache(&name) && !current.contains(&name)
        })
        .map(|entry| entry.path())
        .collect()
}

/// BGRA (premultiplied alpha) to RGB over `background`. Many shell bitmaps leave alpha at zero
/// for fully opaque images, so an all-zero alpha channel is read as opaque.
fn flatten(bgra: &[u8], background: [u8; 3]) -> Vec<u8> {
    let (pixels, _) = bgra.as_chunks::<4>();
    let uses_alpha = pixels.iter().any(|px| px[3] != 0);
    let mut rgb = Vec::with_capacity(pixels.len() * 3);
    for px in pixels {
        let (b, g, r) = (px[0], px[1], px[2]);
        let a = if uses_alpha { px[3] } else { 255 };
        for (channel, bg) in [r, g, b].into_iter().zip(background) {
            let over = u16::from(channel) + u16::from(bg) * u16::from(255 - a) / 255;
            rgb.push(over.min(255) as u8);
        }
    }
    rgb
}

fn encode_jpeg(rgb: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
    use image::ExtendedColorType;
    use image::codecs::jpeg::JpegEncoder;
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, 85)
        .encode(rgb, width, height, ExtendedColorType::Rgb8)
        .ok()?;
    Some(out)
}

/// Handler for `thumb://localhost/<media id>` (grid tile), `.../i<preview>-<n>` (a file the
/// import preview would bring in) and `...?full` (viewer). The flag is a
/// query parameter because the webview's URL helper percent-encodes any slash in the path.
/// Database and disk work happens off the webview thread.
pub fn protocol<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    let id = request.uri().path().trim_matches('/').to_owned();
    let full = request
        .uri()
        .query()
        .is_some_and(|q| q.split('&').any(|part| part == "full"));
    tauri::async_runtime::spawn_blocking(move || {
        // `i<preview>-<n>` names a file in the import preview, not yet in the library.
        let found = match id.strip_prefix('i') {
            Some(item) => crate::import::thumb_source(&app, item),
            None => id.parse().ok().and_then(|id| lookup(&app, id)),
        };
        let Some((source, size, mtime)) = found else {
            return responder.respond(not_found());
        };
        let pool = app.state::<Pool>();
        let cache = pool.cache_path(&source, size, mtime, full);
        pool.get(
            source,
            cache,
            full,
            Box::new(move |bytes| {
                responder.respond(match bytes {
                    Some(bytes) => jpeg_response(bytes),
                    None => not_found(),
                })
            }),
        );
    });
}

fn lookup<R: Runtime>(app: &tauri::AppHandle<R>, id: i64) -> Option<(PathBuf, u64, i64)> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().ok()?;
    conn.query_row(
        "SELECT path, size, mtime FROM media WHERE id = ?1",
        [id],
        |row| {
            Ok((
                PathBuf::from(row.get::<_, String>(0)?),
                row.get::<_, i64>(1)? as u64,
                row.get(2)?,
            ))
        },
    )
    .ok()
}

fn jpeg_response(bytes: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .header(header::CONTENT_TYPE, "image/jpeg")
        // URLs carry the file's modified time, so a cached response is never stale.
        .header(header::CACHE_CONTROL, "max-age=31536000, immutable")
        .body(bytes)
        .unwrap_or_default()
}

fn not_found() -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(Vec::new())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_failed_file_is_tried_again_after_a_minute() {
        let cache = PathBuf::from("abc.jpg");
        let at = Instant::now();
        let mut failed = HashMap::from([(cache.clone(), at)]);
        assert!(failed_lately(
            &mut failed,
            &cache,
            at + Duration::from_secs(30)
        ));
        assert!(failed_lately(&mut failed, &cache, at));
        assert!(!failed_lately(&mut failed, &cache, at + RETRY_AFTER));
        // Forgotten, so the retry's own outcome decides from here.
        assert!(failed.is_empty());
        assert!(!failed_lately(&mut failed, Path::new("other.jpg"), at));
    }

    #[test]
    fn zero_alpha_is_opaque_and_transparent_pixels_show_the_background() {
        let bg = TILE_BACKGROUND;
        // Two opaque-by-convention pixels (alpha 0 everywhere).
        assert_eq!(
            flatten(&[10, 20, 30, 0, 1, 2, 3, 0], bg),
            vec![30, 20, 10, 3, 2, 1]
        );
        // Fully transparent next to fully opaque: the first becomes the background colour.
        assert_eq!(
            flatten(&[0, 0, 0, 0, 10, 20, 30, 255], bg),
            vec![bg[0], bg[1], bg[2], 30, 20, 10]
        );
    }

    #[test]
    fn full_pictures_go_before_tiles_and_newest_first() {
        let job = |name: &str, full| Job {
            source: PathBuf::from(name),
            cache: PathBuf::from(name),
            full,
            done: Vec::new(),
        };
        assert_eq!(next_job(&[]), None);
        assert_eq!(next_job(&[job("a", false), job("b", false)]), Some(1));
        let jobs = [
            job("full-old", true),
            job("full-new", true),
            job("tile", false),
        ];
        assert_eq!(next_job(&jobs), Some(1));
    }

    #[test]
    fn hex_colours_split_into_bytes() {
        assert_eq!(rgb(0xe2e6e9), [0xe2, 0xe6, 0xe9]);
        assert_eq!(VIEWER_BACKGROUND, [0x00, 0x15, 0x14]);
    }

    #[test]
    fn only_other_cache_versions_are_stale() {
        let dir = tempfile::tempdir().unwrap();
        let names = [
            "thumbs",
            "previews",
            "thumbs-v1",
            "thumbs-v2",
            "thumbs-v3",
            "previews-v2",
            "previews-v3",
            "thumbsup",
            "logs",
        ];
        for name in names {
            std::fs::create_dir(dir.path().join(name)).unwrap();
        }
        std::fs::write(dir.path().join("thumbs-v9"), b"a file, not a folder").unwrap();
        let mut stale: Vec<String> = stale_cache_dirs(dir.path())
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        stale.sort();
        assert_eq!(
            stale,
            [
                "previews",
                "previews-v2",
                "thumbs",
                "thumbs-v1",
                "thumbs-v2"
            ]
        );
    }

    #[cfg(windows)]
    #[test]
    fn shell_renders_a_jpeg_fixture() {
        // SAFETY: test thread, COM initialised once before use.
        unsafe {
            use windows::Win32::System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx};
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        }
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/exif_gps.jpg");
        let jpeg = render(&fixture, 64, TILE_BACKGROUND).expect("Windows renders JPEG thumbnails");
        let decoded = image::load_from_memory(&jpeg).unwrap();
        assert!(decoded.width() <= 64 && decoded.height() <= 64);
        assert!(render(&fixture.with_file_name("corrupt.jpg"), 64, TILE_BACKGROUND).is_none());
    }

    #[cfg(windows)]
    #[test]
    fn transparent_png_corners_take_the_background() {
        // SAFETY: test thread, COM initialised once before use.
        unsafe {
            use windows::Win32::System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx};
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        }
        // A red square in the middle of a fully transparent 64 px PNG.
        let dir = tempfile::tempdir().unwrap();
        let png = dir.path().join("logo.png");
        image::RgbaImage::from_fn(64, 64, |x, y| {
            let inside = (16..48).contains(&x) && (16..48).contains(&y);
            image::Rgba(if inside {
                [255, 0, 0, 255]
            } else {
                [0, 0, 0, 0]
            })
        })
        .save(&png)
        .unwrap();
        for background in [TILE_BACKGROUND, VIEWER_BACKGROUND] {
            let jpeg = render(&png, 64, background).expect("Windows renders PNG thumbnails");
            let decoded = image::load_from_memory(&jpeg).unwrap().to_rgb8();
            let corner = decoded.get_pixel(1, 1).0;
            // JPEG is lossy, so allow a few levels either way.
            let near = corner
                .iter()
                .zip(background)
                .all(|(&c, b)| c.abs_diff(b) <= 6);
            assert!(near, "corner {corner:?}, background {background:?}");
        }
    }
}
