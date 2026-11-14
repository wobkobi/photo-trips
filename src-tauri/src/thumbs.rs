// Thumbnails and full-size previews from the Windows shell: the same images Explorer shows, so
// any format with an installed handler (HEIC, RAW, most video) gets a picture, already turned
// upright. Rendered on a small pool of COM threads, cached as JPEGs and served on thumb://.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};

use tauri::http::{Request, Response, StatusCode, header};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use crate::AppState;

/// Grid tiles: long edge in pixels (tiles are ~170 px, so this stays sharp at 150% scaling).
pub const THUMB_SIZE: i32 = 320;
/// Full-size viewer for formats the webview can't draw itself.
pub const PREVIEW_SIZE: i32 = 2048;

/// Requests beyond this are for tiles scrolled far out of view; the oldest are dropped.
const MAX_QUEUE: usize = 1000;

/// Tile background (the `surface` colour), painted behind transparent images.
const BACKGROUND: [u8; 3] = [0x24, 0x2a, 0x32];

type Callback = Box<dyn FnOnce(Option<Vec<u8>>) + Send>;

struct Job {
    source: PathBuf,
    cache: PathBuf,
    size: i32,
    done: Callback,
}

#[derive(Default)]
struct Shared {
    queue: Mutex<Vec<Job>>,
    ready: Condvar,
    /// Cache paths the shell couldn't render this session, so they aren't retried on every scroll.
    failed: Mutex<HashSet<PathBuf>>,
}

/// Managed state: the render threads and cache folders.
pub struct Pool {
    shared: Arc<Shared>,
    thumbs_dir: PathBuf,
    previews_dir: PathBuf,
}

impl Pool {
    pub fn new(workers: usize, data_dir: &Path) -> Self {
        let thumbs_dir = data_dir.join("thumbs");
        let previews_dir = data_dir.join("previews");
        let _ = std::fs::create_dir_all(&thumbs_dir);
        let _ = std::fs::create_dir_all(&previews_dir);
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
        let dir = if full { &self.previews_dir } else { &self.thumbs_dir };
        dir.join(format!("{}.jpg", &key[..32]))
    }

    /// Cached JPEG bytes, or a render queued on the pool. `done` gets `None` when the shell has
    /// no image for the file (missing codec, corrupt file).
    fn get(&self, source: PathBuf, cache: PathBuf, size: i32, done: Callback) {
        if let Ok(bytes) = std::fs::read(&cache) {
            return done(Some(bytes));
        }
        if lock(&self.shared.failed).contains(&cache) {
            return done(None);
        }
        let dropped = {
            let mut queue = lock(&self.shared.queue);
            queue.push(Job {
                source,
                cache,
                size,
                done,
            });
            let excess = queue.len().saturating_sub(MAX_QUEUE);
            queue.drain(..excess).collect::<Vec<_>>()
        };
        self.shared.ready.notify_one();
        for job in dropped {
            (job.done)(None);
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
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
                // Newest first: that is the tile the user has just scrolled to.
                if let Some(job) = queue.pop() {
                    break job;
                }
                queue = shared
                    .ready
                    .wait(queue)
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
            }
        };
        let jpeg = render(&job.source, job.size);
        match &jpeg {
            Some(bytes) => write_atomic(&job.cache, bytes),
            None => {
                lock(&shared.failed).insert(job.cache.clone());
            }
        }
        (job.done)(jpeg);
    }
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
fn render(source: &Path, size: i32) -> Option<Vec<u8>> {
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
        encode_jpeg(&flatten(&bgra), width, height)
    }
}

#[cfg(not(windows))]
fn render(_source: &Path, _size: i32) -> Option<Vec<u8>> {
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

/// BGRA (premultiplied alpha) to RGB over the tile background. Many shell bitmaps leave alpha at
/// zero for fully opaque images, so an all-zero alpha channel is read as opaque.
fn flatten(bgra: &[u8]) -> Vec<u8> {
    let (pixels, _) = bgra.as_chunks::<4>();
    let uses_alpha = pixels.iter().any(|px| px[3] != 0);
    let mut rgb = Vec::with_capacity(pixels.len() * 3);
    for px in pixels {
        let (b, g, r) = (px[0], px[1], px[2]);
        let a = if uses_alpha { px[3] } else { 255 };
        for (channel, bg) in [r, g, b].into_iter().zip(BACKGROUND) {
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
        let px = if full { PREVIEW_SIZE } else { THUMB_SIZE };
        pool.get(
            source,
            cache,
            px,
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
    fn zero_alpha_is_opaque_and_transparent_pixels_show_the_background() {
        // Two opaque-by-convention pixels (alpha 0 everywhere).
        assert_eq!(flatten(&[10, 20, 30, 0, 1, 2, 3, 0]), vec![30, 20, 10, 3, 2, 1]);
        // Fully transparent next to fully opaque: the first becomes the background colour.
        assert_eq!(
            flatten(&[0, 0, 0, 0, 10, 20, 30, 255]),
            vec![BACKGROUND[0], BACKGROUND[1], BACKGROUND[2], 30, 20, 10]
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
        let fixture =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/exif_gps.jpg");
        let jpeg = render(&fixture, 64).expect("Windows renders JPEG thumbnails");
        let decoded = image::load_from_memory(&jpeg).unwrap();
        assert!(decoded.width() <= 64 && decoded.height() <= 64);
        assert!(render(&fixture.with_file_name("corrupt.jpg"), 64).is_none());
    }
}


