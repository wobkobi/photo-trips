// The offline map the viewer draws around a photo's location. Coastlines, lakes, borders and
// towns come from map/world.bin (Natural Earth, built by scripts/map-data.mjs). The area around
// the photo is cut out and turned into SVG paths here, so the location never leaves the PC.

use std::fmt::Write as _;
use std::sync::OnceLock;

use serde::Serialize;

use crate::error::{Error, Result};
use crate::metadata::valid_coords;
use crate::suggest::{self, Point};

const DATA: &[u8] = include_bytes!("../map/world.bin");
/// Stored coordinates are whole ten-thousandths of a degree.
const SCALE: f64 = 10_000.0;
/// The picture's size in SVG units; the page scales it to fit.
const WIDTH: f64 = 280.0;
const HEIGHT: f64 = 180.0;
/// Shapes are cut this far outside the picture, so their cut edges never show.
const MARGIN: f64 = 12.0;
const KM_PER_DEG: f64 = 111.32;
/// Points closer than this to the last one drawn add nothing visible, so they're skipped.
const MIN_STEP: f64 = 0.75;
const MAX_LABELS: usize = 8;
/// Rough width of one character of a label, for keeping labels apart.
const CHAR_WIDTH: f64 = 7.4;

/// The area around a photo, ready to draw as an SVG `width` by `height` with the photo at the
/// centre.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapView {
    pub width: f64,
    pub height: f64,
    /// Path data, filled.
    pub land: String,
    pub lakes: String,
    /// Path data for country borders, stroked.
    pub borders: String,
    pub labels: Vec<Label>,
    /// The scale bar's length in SVG units, and what it measures ("10 km").
    pub scale_length: f64,
    pub scale_label: String,
    /// "Rotorua, Bay of Plenty, New Zealand", or `None` when no town is near enough to name.
    pub place: Option<String>,
}

/// A town on the map. Its dot is at `x`, `y` (unless `dot` is false), with the name to the right,
/// or to the left when `left` (it would run off the edge otherwise).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Label {
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub left: bool,
    /// False for a town under the pin: its name goes beside the pin instead, and `x`, `y` is the
    /// pin's side.
    pub dot: bool,
    /// The town nearest the photo, which the place name above the map is about.
    pub nearest: bool,
}

/// The map around `lat`, `lon`, showing `span_km` from top to bottom.
#[tauri::command(async)]
pub fn location_map(lat: f64, lon: f64, span_km: f64) -> Result<MapView> {
    let (lat, lon) =
        valid_coords(lat, lon).ok_or_else(|| Error::msg("That location isn't on the map."))?;
    let world = world().ok_or_else(|| {
        Error::msg("The map built into Pic Cabinet is damaged. Reinstalling puts it back.")
    })?;
    let view = View::new(lat, lon, span_km.clamp(5.0, 20_000.0));
    let town = suggest::town_near(Point { lat, lon });

    let (scale_length, scale_label) = scale_bar(view.k / KM_PER_DEG);
    let labels = labels(
        world,
        &view,
        town.as_ref().map(|(place, at)| (place.town.as_str(), *at)),
        scale_length,
    );
    Ok(MapView {
        width: WIDTH,
        height: HEIGHT,
        land: shapes(&world.land, &view, true),
        lakes: shapes(&world.lakes, &view, true),
        borders: shapes(&world.borders, &view, false),
        labels,
        scale_length,
        scale_label,
        place: town.map(|(place, _)| {
            let mut parts = vec![place.town.clone()];
            if !place.region.is_empty() && place.region != place.town {
                parts.push(place.region);
            }
            if !place.country.is_empty() {
                parts.push(place.country);
            }
            parts.join(", ")
        }),
    })
}

/// One ring of a lake or piece of land, or one border line, with its bounding box.
struct Part {
    min: [i32; 2],
    max: [i32; 2],
    /// Longitude, latitude.
    points: Vec<[i32; 2]>,
}

struct Town {
    lat: i32,
    lon: i32,
    name: String,
}

struct World {
    land: Vec<Part>,
    lakes: Vec<Part>,
    borders: Vec<Part>,
    /// Most important first.
    towns: Vec<Town>,
}

/// The map, decoded on first use. `None` only if the bundled file is damaged.
fn world() -> Option<&'static World> {
    static WORLD: OnceLock<Option<World>> = OnceLock::new();
    WORLD.get_or_init(|| decode(DATA)).as_ref()
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Reader<'_> {
    fn byte(&mut self) -> Option<u8> {
        let byte = *self.bytes.get(self.at)?;
        self.at += 1;
        Some(byte)
    }

    /// Unsigned LEB128.
    fn varint(&mut self) -> Option<u64> {
        let mut value = 0u64;
        for shift in (0..64).step_by(7) {
            let byte = self.byte()?;
            value |= u64::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return Some(value);
            }
        }
        None
    }

    /// Zigzag: 0, -1, 1, -2 are stored as 0, 1, 2, 3.
    fn signed(&mut self) -> Option<i64> {
        let n = self.varint()?;
        Some((n >> 1) as i64 ^ -((n & 1) as i64))
    }

    fn count(&mut self) -> Option<usize> {
        usize::try_from(self.varint()?).ok()
    }

    fn layer(&mut self) -> Option<Vec<Part>> {
        let parts = self.count()?;
        let mut layer = Vec::with_capacity(parts);
        for _ in 0..parts {
            let n = self.count()?;
            let mut points = Vec::with_capacity(n);
            let (mut x, mut y) = (0i64, 0i64);
            let (mut min, mut max) = ([i32::MAX; 2], [i32::MIN; 2]);
            for _ in 0..n {
                x += self.signed()?;
                y += self.signed()?;
                let point = [i32::try_from(x).ok()?, i32::try_from(y).ok()?];
                for axis in 0..2 {
                    min[axis] = min[axis].min(point[axis]);
                    max[axis] = max[axis].max(point[axis]);
                }
                points.push(point);
            }
            layer.push(Part { min, max, points });
        }
        Some(layer)
    }
}

/// The layout scripts/map-data.mjs writes: a "PCMAP" 1 header, the land, lake and border
/// layers, then the towns.
fn decode(bytes: &[u8]) -> Option<World> {
    let rest = bytes.strip_prefix(b"PCMAP\x01")?;
    let mut r = Reader { bytes: rest, at: 0 };
    let land = r.layer()?;
    let lakes = r.layer()?;
    let borders = r.layer()?;
    let count = r.count()?;
    let mut towns = Vec::with_capacity(count);
    for _ in 0..count {
        let lat = i32::try_from(r.signed()?).ok()?;
        let lon = i32::try_from(r.signed()?).ok()?;
        let _rank = r.byte()?;
        let _population = r.varint()?;
        let len = r.count()?;
        let name = String::from_utf8(r.bytes.get(r.at..r.at + len)?.to_vec()).ok()?;
        r.at += len;
        towns.push(Town { lat, lon, name });
    }
    Some(World {
        land,
        lakes,
        borders,
        towns,
    })
}

/// How degrees map onto the picture: a flat projection centred on the photo, with longitude
/// squeezed by the cosine of the latitude so shapes keep their proportions.
struct View {
    lat: f64,
    lon: f64,
    /// SVG units per degree of latitude, and of longitude.
    k: f64,
    kx: f64,
}

/// A box in degrees: longitude from `x0` to `x1`, latitude from `y0` to `y1`.
#[derive(Clone, Copy)]
struct Rect {
    x0: f64,
    x1: f64,
    y0: f64,
    y1: f64,
}

impl View {
    fn new(lat: f64, lon: f64, span_km: f64) -> Self {
        let k = HEIGHT / (span_km / KM_PER_DEG);
        // Capped near the poles, where the squeeze would stretch a few points across the world.
        let kx = k * lat.to_radians().cos().max(0.05);
        Self { lat, lon, k, kx }
    }

    fn x(&self, lon: f64) -> f64 {
        WIDTH / 2.0 + (lon - self.lon) * self.kx
    }

    fn y(&self, lat: f64) -> f64 {
        HEIGHT / 2.0 - (lat - self.lat) * self.k
    }

    /// The picture plus `pad` units on every side, in degrees.
    fn bounds(&self, pad: f64) -> Rect {
        let half_x = (WIDTH / 2.0 + pad) / self.kx;
        let half_y = (HEIGHT / 2.0 + pad) / self.k;
        Rect {
            x0: self.lon - half_x,
            x1: self.lon + half_x,
            y0: self.lat - half_y,
            y1: self.lat + half_y,
        }
    }
}

/// Copies of the world to the left and right, so a view across the 180th meridian finds the
/// shapes on the far side (stored near -180 when the view is near +180, and the other way).
const WRAPS: [f64; 3] = [-360.0, 0.0, 360.0];

/// SVG path data for every part of `layer` inside the view, cut to its edges. Rings are closed
/// (`filled`); border lines aren't, and are split wherever they leave the view.
fn shapes(layer: &[Part], view: &View, filled: bool) -> String {
    let bounds = view.bounds(MARGIN);
    let mut d = String::new();
    for wrap in WRAPS {
        // The view's box in the stored coordinates of this copy of the world.
        let inner = Rect {
            x0: bounds.x0 - wrap,
            x1: bounds.x1 - wrap,
            ..bounds
        };
        let (lo, hi) = (to_fixed(inner.x0, inner.y0), to_fixed(inner.x1, inner.y1));
        for part in layer {
            if part.max[0] < lo[0]
                || part.min[0] > hi[0]
                || part.max[1] < lo[1]
                || part.min[1] > hi[1]
            {
                continue;
            }
            let points: Vec<(f64, f64)> = part
                .points
                .iter()
                .map(|&[x, y]| (f64::from(x) / SCALE + wrap, f64::from(y) / SCALE))
                .collect();
            if filled {
                push_path(&mut d, &clip_ring(points, &bounds), view, true);
            } else {
                for run in clip_line(&points, &bounds) {
                    push_path(&mut d, &run, view, false);
                }
            }
        }
    }
    d
}

fn to_fixed(lon: f64, lat: f64) -> [i32; 2] {
    // Saturating casts: a box past the poles just means "everything that way".
    [(lon * SCALE).floor() as i32, (lat * SCALE).floor() as i32]
}

/// Add one ring or line to path data, in picture units to one decimal place.
fn push_path(d: &mut String, points: &[(f64, f64)], view: &View, closed: bool) {
    let mut kept: Vec<(f64, f64)> = Vec::with_capacity(points.len());
    for &(lon, lat) in points {
        let p = (view.x(lon), view.y(lat));
        if kept
            .last()
            .is_none_or(|last| (p.0 - last.0).hypot(p.1 - last.1) >= MIN_STEP)
        {
            kept.push(p);
        }
    }
    if kept.len() < if closed { 3 } else { 2 } {
        return;
    }
    for (i, (x, y)) in kept.iter().enumerate() {
        let _ = write!(d, "{}{x:.1} {y:.1}", if i == 0 { 'M' } else { 'L' });
    }
    if closed {
        d.push('Z');
    }
}

/// Sutherland-Hodgman: cut a ring to the box one side at a time. A concave ring can come out
/// with zero-width slivers along the box's edges, which fill nothing and sit outside the picture.
fn clip_ring(mut ring: Vec<(f64, f64)>, r: &Rect) -> Vec<(f64, f64)> {
    for side in 0..4 {
        let Some(&last) = ring.last() else { break };
        let inside = |p: (f64, f64)| match side {
            0 => p.0 >= r.x0,
            1 => p.0 <= r.x1,
            2 => p.1 >= r.y0,
            _ => p.1 <= r.y1,
        };
        // Where a-b crosses this side. Only asked when one end is in and one is out, so the
        // segment isn't parallel to the side.
        let cross = |a: (f64, f64), b: (f64, f64)| {
            let edge = [r.x0, r.x1, r.y0, r.y1][side];
            if side < 2 {
                let t = (edge - a.0) / (b.0 - a.0);
                (edge, a.1 + t * (b.1 - a.1))
            } else {
                let t = (edge - a.1) / (b.1 - a.1);
                (a.0 + t * (b.0 - a.0), edge)
            }
        };
        let mut out = Vec::with_capacity(ring.len());
        let mut prev = last;
        for &cur in &ring {
            match (inside(prev), inside(cur)) {
                (true, true) => out.push(cur),
                (true, false) => out.push(cross(prev, cur)),
                (false, true) => {
                    out.push(cross(prev, cur));
                    out.push(cur);
                }
                (false, false) => {}
            }
            prev = cur;
        }
        ring = out;
    }
    ring
}

/// Cut a line to the box, giving the stretches of it that are inside.
fn clip_line(points: &[(f64, f64)], r: &Rect) -> Vec<Vec<(f64, f64)>> {
    let mut runs = Vec::new();
    let mut run: Vec<(f64, f64)> = Vec::new();
    for pair in points.windows(2) {
        let Some((a, b)) = clip_segment(pair[0], pair[1], r) else {
            if run.len() >= 2 {
                runs.push(std::mem::take(&mut run));
            }
            run.clear();
            continue;
        };
        // An uncut start is exactly the previous segment's uncut end, so the line carries on.
        if run.last() != Some(&a) {
            if run.len() >= 2 {
                runs.push(std::mem::take(&mut run));
            }
            run.clear();
            run.push(a);
        }
        run.push(b);
        if b != pair[1] {
            runs.push(std::mem::take(&mut run));
        }
    }
    if run.len() >= 2 {
        runs.push(run);
    }
    runs
}

/// Liang-Barsky: the part of segment a-b inside the box, or `None` when it misses. Ends that are
/// already inside come back unchanged, which [`clip_line`] relies on.
fn clip_segment(a: (f64, f64), b: (f64, f64), r: &Rect) -> Option<((f64, f64), (f64, f64))> {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let (mut t0, mut t1) = (0.0f64, 1.0f64);
    for (p, q) in [
        (-dx, a.0 - r.x0),
        (dx, r.x1 - a.0),
        (-dy, a.1 - r.y0),
        (dy, r.y1 - a.1),
    ] {
        if p == 0.0 {
            if q < 0.0 {
                return None;
            }
            continue;
        }
        let t = q / p;
        if p < 0.0 {
            if t > t1 {
                return None;
            }
            t0 = t0.max(t);
        } else {
            if t < t0 {
                return None;
            }
            t1 = t1.min(t);
        }
    }
    let at = |t: f64| (a.0 + t * dx, a.1 + t * dy);
    Some((
        if t0 > 0.0 { at(t0) } else { a },
        if t1 < 1.0 { at(t1) } else { b },
    ))
}

/// A round scale bar about a quarter of the picture wide: its length and what it measures.
fn scale_bar(units_per_km: f64) -> (f64, String) {
    let target = WIDTH / 4.0 / units_per_km;
    let mut nice = 10f64.powf(target.log10().floor());
    for step in [5.0, 2.0] {
        if nice * step <= target {
            nice *= step;
            break;
        }
    }
    let label = if nice >= 1.0 {
        format!("{} km", nice.round())
    } else {
        format!("{} m", (nice * 1000.0).round())
    };
    (nice * units_per_km, label)
}

/// Towns to name on the map: the one nearest the photo first, then the most important others,
/// skipping any that would overlap a name already placed, the pin or the scale bar.
fn labels(
    world: &World,
    view: &View,
    nearest: Option<(&str, Point)>,
    scale_length: f64,
) -> Vec<Label> {
    // Boxes as (left, top, right, bottom) in picture units. The pin's tip is the photo's spot.
    let mut taken = vec![
        (
            WIDTH / 2.0 - 9.0,
            HEIGHT / 2.0 - 24.0,
            WIDTH / 2.0 + 9.0,
            HEIGHT / 2.0 + 2.0,
        ),
        (0.0, HEIGHT - 26.0, 16.0 + scale_length + 8.0, HEIGHT),
    ];
    let mut labels: Vec<Label> = Vec::new();
    let mut place = |name: &str, lat: f64, lon: f64, nearest: bool, labels: &mut Vec<Label>| {
        if labels.len() >= MAX_LABELS || labels.iter().any(|l| l.name.eq_ignore_ascii_case(name)) {
            return;
        }
        // Whichever copy of the town is on the picture, for views across the 180th meridian.
        let Some(mut x) = WRAPS
            .iter()
            .map(|wrap| view.x(lon + wrap))
            .find(|x| (4.0..=WIDTH - 4.0).contains(x))
        else {
            return;
        };
        let mut y = view.y(lat);
        if !(12.0..=HEIGHT - 4.0).contains(&y) {
            return;
        }
        // The nearest town is often right where the photo was taken, under the pin. Its name
        // then sits beside the pin, with no dot of its own.
        let dot = !(nearest && (x - WIDTH / 2.0).hypot(y - HEIGHT / 2.0) < 14.0);
        if !dot {
            (x, y) = (WIDTH / 2.0 + 9.0, HEIGHT / 2.0 - 8.0);
        }
        let width = name.chars().count() as f64 * CHAR_WIDTH;
        let left = x + 6.0 + width > WIDTH - 2.0;
        if left && !dot {
            x = WIDTH / 2.0 - 9.0;
        }
        // A dot needs room on both sides of its centre; a name beside the pin starts clear of it.
        let near = if dot { 3.0 } else { -3.0 };
        let (x0, x1) = if left {
            (x - 6.0 - width, x + near)
        } else {
            (x - near, x + 6.0 + width)
        };
        let block = (x0, y - 11.0, x1, y + 4.0);
        let overlaps = |b: &(f64, f64, f64, f64)| {
            block.0 < b.2 && b.0 < block.2 && block.1 < b.3 && b.1 < block.3
        };
        if x0 < 0.0 || taken.iter().any(overlaps) {
            return;
        }
        taken.push(block);
        labels.push(Label {
            name: name.to_owned(),
            x,
            y,
            left,
            dot,
            nearest,
        });
    };
    if let Some((name, at)) = nearest {
        place(name, at.lat, at.lon, true, &mut labels);
    }
    let bounds = view.bounds(0.0);
    for town in &world.towns {
        let (lat, lon) = (f64::from(town.lat) / SCALE, f64::from(town.lon) / SCALE);
        if lat < bounds.y0 || lat > bounds.y1 {
            continue;
        }
        place(&town.name, lat, lon, false, &mut labels);
    }
    labels
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROTORUA: (f64, f64) = (-38.1368, 176.2497);

    /// Every number in path data, as (x, y) pairs.
    fn points(d: &str) -> Vec<(f64, f64)> {
        let numbers: Vec<f64> = d
            .split(|c: char| c.is_ascii_alphabetic() || c == ' ')
            .filter(|s| !s.is_empty())
            .map(|s| s.parse().expect("a number"))
            .collect();
        numbers.chunks(2).map(|p| (p[0], p[1])).collect()
    }

    #[test]
    fn the_bundled_map_decodes() {
        let world = world().expect("the map decodes");
        assert!(world.land.len() > 1000);
        assert!(world.lakes.len() > 100);
        assert!(world.borders.len() > 100);
        assert!(world.towns.iter().any(|t| t.name == "Auckland"));
        assert!(
            decode(b"PCMAP\x01\x05").is_none(),
            "a cut-short file is refused"
        );
        assert!(decode(b"nope").is_none());
    }

    #[test]
    fn rotorua_has_land_a_lake_and_its_own_name() {
        let map = location_map(ROTORUA.0, ROTORUA.1, 40.0).unwrap();
        assert!(!map.land.is_empty());
        assert!(!map.lakes.is_empty(), "Lake Rotorua");
        let first = map.labels.first().expect("a label");
        assert!(first.nearest && first.name == "Rotorua", "{:?}", map.labels);
        assert!(map.place.as_deref().unwrap().starts_with("Rotorua, "));
        assert_eq!(map.labels.iter().filter(|l| l.name == "Rotorua").count(), 1);
    }

    #[test]
    fn everything_drawn_stays_near_the_picture() {
        for span in [15.0, 120.0, 1500.0] {
            let map = location_map(ROTORUA.0, ROTORUA.1, span).unwrap();
            for (x, y) in points(&map.land).into_iter().chain(points(&map.borders)) {
                assert!(
                    (-MARGIN - 0.1..=WIDTH + MARGIN + 0.1).contains(&x),
                    "x {x} at {span} km"
                );
                assert!(
                    (-MARGIN - 0.1..=HEIGHT + MARGIN + 0.1).contains(&y),
                    "y {y} at {span} km"
                );
            }
            assert!(map.labels.len() <= MAX_LABELS);
        }
    }

    #[test]
    fn open_ocean_is_all_water() {
        let map = location_map(-30.0, -140.0, 40.0).unwrap();
        assert!(map.land.is_empty() && map.lakes.is_empty() && map.labels.is_empty());
        assert_eq!(map.place, None);
    }

    #[test]
    fn a_view_across_the_dateline_draws_both_sides() {
        // Taveuni, Fiji, which the 180th meridian runs through.
        let map = location_map(-16.85, 179.98, 120.0).unwrap();
        let xs: Vec<f64> = points(&map.land).into_iter().map(|p| p.0).collect();
        assert!(xs.iter().any(|&x| x < WIDTH / 2.0 - 20.0));
        assert!(xs.iter().any(|&x| x > WIDTH / 2.0 + 20.0));
    }

    #[test]
    fn a_border_crossing_the_view_is_cut_at_its_edges() {
        let r = Rect {
            x0: 0.0,
            x1: 10.0,
            y0: 0.0,
            y1: 10.0,
        };
        let runs = clip_line(
            &[
                (-5.0, 5.0),
                (5.0, 5.0),
                (15.0, 5.0),
                (15.0, 8.0),
                (5.0, 8.0),
            ],
            &r,
        );
        assert_eq!(
            runs,
            vec![
                vec![(0.0, 5.0), (5.0, 5.0), (10.0, 5.0)],
                vec![(10.0, 8.0), (5.0, 8.0)]
            ]
        );
        assert!(clip_line(&[(20.0, 20.0), (30.0, 30.0)], &r).is_empty());
    }

    #[test]
    fn a_ring_is_cut_to_the_box() {
        let r = Rect {
            x0: 0.0,
            x1: 10.0,
            y0: 0.0,
            y1: 10.0,
        };
        let square = vec![(-5.0, -5.0), (5.0, -5.0), (5.0, 5.0), (-5.0, 5.0)];
        let mut cut = clip_ring(square, &r);
        cut.sort_by(|a, b| a.partial_cmp(b).unwrap());
        assert_eq!(cut, vec![(0.0, 0.0), (0.0, 5.0), (5.0, 0.0), (5.0, 5.0)]);
    }

    #[test]
    fn the_scale_bar_is_a_round_distance() {
        assert_eq!(scale_bar(5.0), (50.0, "10 km".to_owned()));
        assert_eq!(scale_bar(13.0).1, "5 km");
        assert_eq!(scale_bar(0.1).1, "500 km");
        assert_eq!(scale_bar(200.0).1, "200 m");
    }

    #[test]
    fn a_location_off_the_globe_is_refused() {
        assert!(location_map(95.0, 0.0, 40.0).is_err());
        assert!(location_map(f64::NAN, 0.0, 40.0).is_err());
    }
}
