// Trip suggestions: stretches of busy days, and days spent far from home, that no trip covers.
//
// 1. Count photos and videos per day. A day with at least `min_photos` of them is busy.
// 2. With GPS, find home (where photos were taken on the most days, unless Settings has one)
//    and mark days whose middle photo location is more than 50 km from it as away.
// 3. Join busy and away days into runs, bridging one quiet day. With a home, a run whose located
//    days are all at home is everyday life, not a trip, and home days at either end come off.
//    A run of 2+ days is a suggestion, and so is one busy day away (a day trip).
// 4. Name it after the area, region or country its located photos fit (see `place_name`), or its
//    dates.
// 5. Leave out runs that overlap a trip or a dismissed suggestion.
// 6. Add folders that look like trips (see `folder_trips`), over any run they overlap.

use std::collections::{BTreeMap, HashMap};
use std::sync::OnceLock;

use chrono::{NaiveDate, NaiveDateTime, NaiveTime};
use reverse_geocoder::{Record, ReverseGeocoder};
use rusqlite::{Connection, params};
use serde::Serialize;
use tauri::State;

use crate::AppState;
use crate::commands::{library_root, lock_db};
use crate::dates::DateSource;
use crate::db;
use crate::error::{Error, Result};
use crate::folder_trips::{self, FolderTrip};
use crate::groups::{self, Group};
use crate::index;
use crate::trips::{self, SampleTile, Trip};

/// Photos and videos in a day for it to count as busy, unless Settings says otherwise.
pub const DEFAULT_MIN_PHOTOS: usize = 15;
/// A day whose photos are further than this from home is an away day.
const AWAY_KM: f64 = 50.0;
/// Quiet days a run can bridge: a rest day mid-trip doesn't split it in two.
const MAX_GAP_DAYS: i64 = 1;
/// Shortest run worth suggesting, counted from its first to its last day. One busy day away
/// from home (a day trip) is suggested too.
const MIN_RUN_DAYS: i64 = 2;
/// Grid used to find home, in degrees: about 28 km north to south.
const HOME_CELL_DEG: f64 = 0.25;
/// Located days needed around one spot before it's taken as home.
const MIN_HOME_DAYS: usize = 5;
/// A photo further than this from the nearest town in the place list gets no place name
/// (out at sea, or somewhere remote).
const PLACE_MAX_KM: f64 = 100.0;
/// Photos within this of one town count as a stay there: the town, its beaches and day walks.
const AREA_KM: f64 = 25.0;
/// A suburb within this of its city is named after the city.
const CITY_KM: f64 = 15.0;
const KM_PER_DEG_LAT: f64 = 111.2;
/// Located photos looked up per suggestion, spread evenly; plenty to find the main place.
const PLACE_LOOKUPS: usize = 200;
const EARTH_RADIUS_KM: f64 = 6371.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    pub lat: f64,
    pub lon: f64,
}

/// One photo or video, as suggestions see it.
#[derive(Debug, Clone, Copy)]
pub struct Shot {
    pub day: NaiveDate,
    pub point: Option<Point>,
}

/// A stretch of days worth suggesting as a trip.
#[derive(Debug, Clone, PartialEq)]
pub struct Run {
    pub start: NaiveDate,
    pub end: NaiveDate,
    /// Days in the run spent more than 50 km from home.
    pub away_days: usize,
    /// How far from home the away days were (the middle distance), in km.
    pub away_km: Option<f64>,
}

/// What the runs were worked out from.
#[derive(Debug, Clone, PartialEq)]
pub struct Found {
    pub runs: Vec<Run>,
    pub home: Option<Point>,
}

/// Find the runs of busy or away days in `shots`. `home` is the home set in Settings; without
/// one, it's worked out from the shots' locations.
pub fn find(shots: &[Shot], min_photos: usize, home: Option<Point>) -> Found {
    let mut days: BTreeMap<NaiveDate, (usize, Vec<Point>)> = BTreeMap::new();
    for shot in shots {
        let day = days.entry(shot.day).or_default();
        day.0 += 1;
        day.1.extend(shot.point);
    }
    let middles: BTreeMap<NaiveDate, Point> = days
        .iter()
        .filter(|(_, (_, points))| !points.is_empty())
        .map(|(day, (_, points))| (*day, median_point(points)))
        .collect();
    let home = home.or_else(|| find_home(&middles));
    let away: BTreeMap<NaiveDate, f64> = match home {
        Some(home) => middles
            .iter()
            .map(|(day, p)| (*day, distance_km(home, *p)))
            .filter(|(_, km)| *km > AWAY_KM)
            .collect(),
        None => BTreeMap::new(),
    };
    let wanted = days
        .iter()
        .filter(|(day, (photos, _))| *photos >= min_photos || away.contains_key(*day))
        .map(|(day, _)| *day);
    // Days with photos placing them near home. Without a home nothing can be placed there.
    let at_home =
        |day: &NaiveDate| home.is_some() && middles.contains_key(day) && !away.contains_key(day);
    let runs = join_runs(wanted)
        .into_iter()
        .filter(|(start, end)| {
            // Busy days at home (a party, a weekend in the garden) aren't a trip. Days without
            // locations can't be placed, so a run of only those stays.
            let located = middles.range(*start..=*end).count();
            located == 0 || away.range(*start..=*end).next().is_some()
        })
        .filter_map(|(mut start, mut end)| {
            // A busy day at home before leaving or after getting back isn't part of the trip.
            while start < end && at_home(&start) {
                start = start.succ_opt()?;
            }
            while end > start && at_home(&end) {
                end = end.pred_opt()?;
            }
            let day_trip = start == end
                && away.contains_key(&start)
                && days
                    .get(&start)
                    .is_some_and(|(photos, _)| *photos >= min_photos);
            ((end - start).num_days() + 1 >= MIN_RUN_DAYS || day_trip).then_some((start, end))
        })
        .map(|(start, end)| {
            let mut kms: Vec<f64> = away.range(start..=end).map(|(_, km)| *km).collect();
            Run {
                start,
                end,
                away_days: kms.len(),
                away_km: (!kms.is_empty()).then(|| median(&mut kms)),
            }
        })
        .collect();
    Found { runs, home }
}

/// Join sorted days into runs, bridging up to `MAX_GAP_DAYS` missing days. Single days come
/// back as one-day runs; [`find`] decides which are long enough.
fn join_runs(days: impl Iterator<Item = NaiveDate>) -> Vec<(NaiveDate, NaiveDate)> {
    let mut runs = Vec::new();
    let mut current: Option<(NaiveDate, NaiveDate)> = None;
    for day in days {
        current = match current {
            Some((start, end)) if (day - end).num_days() <= MAX_GAP_DAYS + 1 => Some((start, day)),
            Some(done) => {
                runs.push(done);
                Some((day, day))
            }
            None => Some((day, day)),
        };
    }
    runs.extend(current);
    runs
}

/// Home: the spot photos were taken on the most different days. Counting days rather than
/// photos keeps one heavily photographed holiday from outvoting everyday life. Each day's
/// middle location falls in a grid cell; the cell whose 3x3 block holds the most days wins, so
/// a home on a cell edge isn't split in two. `None` when no spot has `MIN_HOME_DAYS` days.
pub fn find_home(middles: &BTreeMap<NaiveDate, Point>) -> Option<Point> {
    let cell_of = |p: &Point| {
        (
            (p.lat / HOME_CELL_DEG).floor() as i64,
            (p.lon / HOME_CELL_DEG).floor() as i64,
        )
    };
    let mut cells: BTreeMap<(i64, i64), Vec<Point>> = BTreeMap::new();
    for p in middles.values() {
        cells.entry(cell_of(p)).or_default().push(*p);
    }
    let block = |(lat, lon): (i64, i64)| {
        (-1..=1).flat_map(move |dl| (-1..=1).map(move |dn| (lat + dl, lon + dn)))
    };
    // Ties go to the first cell in grid order, so the answer never depends on hash order.
    let (best, days) = cells
        .keys()
        .map(|&cell| {
            let days: usize = block(cell)
                .filter_map(|c| cells.get(&c))
                .map(Vec::len)
                .sum();
            (cell, days)
        })
        .fold(
            None,
            |best: Option<((i64, i64), usize)>, (cell, days)| match best {
                Some((_, most)) if most >= days => best,
                _ => Some((cell, days)),
            },
        )?;
    if days < MIN_HOME_DAYS {
        return None;
    }
    let points: Vec<Point> = block(best)
        .filter_map(|c| cells.get(&c))
        .flatten()
        .copied()
        .collect();
    Some(median_point(&points))
}

/// The middle of some points, taking latitude and longitude separately. Points either side of
/// the 180th meridian (Fiji, the Chatham Islands) would average badly, a case rare enough to
/// leave.
fn median_point(points: &[Point]) -> Point {
    let mut lats: Vec<f64> = points.iter().map(|p| p.lat).collect();
    let mut lons: Vec<f64> = points.iter().map(|p| p.lon).collect();
    Point {
        lat: median(&mut lats),
        lon: median(&mut lons),
    }
}

/// Middle value; the mean of the two middle values for an even count. `values` isn't empty.
fn median(values: &mut [f64]) -> f64 {
    values.sort_by(f64::total_cmp);
    let n = values.len();
    if n % 2 == 1 {
        values[n / 2]
    } else {
        (values[n / 2 - 1] + values[n / 2]) / 2.0
    }
}

/// Great-circle distance (haversine).
pub fn distance_km(a: Point, b: Point) -> f64 {
    let (lat1, lat2) = (a.lat.to_radians(), b.lat.to_radians());
    let dlat = lat2 - lat1;
    let dlon = (b.lon - a.lon).to_radians();
    let h = (dlat / 2.0).sin().powi(2) + lat1.cos() * lat2.cos() * (dlon / 2.0).sin().powi(2);
    2.0 * EARTH_RADIUS_KM * h.sqrt().min(1.0).asin()
}

/// Whether a run is clear of every trip and every dismissed range (inclusive days).
fn is_clear(run: &Run, trips: &[Trip], dismissed: &[(NaiveDate, NaiveDate)]) -> bool {
    let start = run.start.and_time(NaiveTime::MIN);
    let end = run.end.and_hms_opt(23, 59, 59).unwrap_or(start);
    trips.iter().all(|t| t.end_at < start || end < t.start_at)
        && dismissed
            .iter()
            .all(|(s, e)| *e < run.start || run.end < *s)
}

/// Where a photo was taken, from the offline place list.
#[derive(Debug, Clone, PartialEq)]
pub struct Place {
    pub town: String,
    /// State, province or region; empty for some countries.
    pub region: String,
    /// The country's name.
    pub country: String,
    /// Where the town is.
    pub at: Point,
}

/// A place at one level of [`place_name`]: its name, then the levels above that tell it apart
/// from places of the same name.
type PlaceKey = (String, String, String);

#[derive(Clone, Copy)]
enum Level {
    Town,
    Region,
    Country,
}

/// `place` at `level`, or `None` when the place list has no name for it there. Each key
/// carries the levels above it, so two Richmonds stay two towns.
fn place_key(place: &Place, level: Level) -> Option<PlaceKey> {
    let (name, above) = match level {
        Level::Town => (&place.town, (place.region.clone(), place.country.clone())),
        Level::Region => (&place.region, (String::new(), place.country.clone())),
        Level::Country => (&place.country, (String::new(), String::new())),
    };
    (!name.is_empty()).then(|| (name.clone(), above.0, above.1))
}

/// Photos per place at `level`, most first (ties by name, so the answer never depends on hash
/// order).
fn ranked(places: &[Place], level: Level) -> Vec<(PlaceKey, usize)> {
    let mut counts: HashMap<PlaceKey, usize> = HashMap::new();
    for place in places {
        if let Some(k) = place_key(place, level) {
            *counts.entry(k).or_default() += 1;
        }
    }
    let mut ranked: Vec<(PlaceKey, usize)> = counts.into_iter().collect();
    ranked.sort_by(|(a, n), (b, m)| m.cmp(n).then_with(|| a.cmp(b)));
    ranked
}

/// The one place at `level` holding at least `share` (numerator, denominator) of the photos.
fn one_of(places: &[Place], level: Level, share: (usize, usize)) -> Option<String> {
    match ranked(places, level).as_slice() {
        [(first, n), ..] if n * share.1 >= places.len() * share.0 => Some(first.0.clone()),
        _ => None,
    }
}

/// The two places at `level` holding three quarters of the photos between them, as "A and B".
/// Two places of the same name (a Richmond in each hemisphere) are just that name.
fn two_of(places: &[Place], level: Level) -> Option<String> {
    match ranked(places, level).as_slice() {
        [(first, n), (second, m), ..] if (n + m) * 4 >= places.len() * 3 => {
            Some(if first.0 == second.0 {
                first.0.clone()
            } else {
                format!("{} and {}", first.0, second.0)
            })
        }
        _ => None,
    }
}

/// The town whose surroundings (within `AREA_KM`) hold two thirds of the photos: a stay in
/// one place, a town and the beaches around it. Named after the most photographed town there,
/// which is usually where the stay was.
fn area_name(places: &[Place]) -> Option<String> {
    let towns: Vec<(&Place, usize)> = {
        let mut seen: Vec<(&Place, usize)> = Vec::new();
        for place in places {
            match seen
                .iter_mut()
                .find(|(p, _)| p.town == place.town && p.at == place.at)
            {
                Some((_, n)) => *n += 1,
                None => seen.push((place, 1)),
            }
        }
        seen
    };
    let around = |centre: Point| {
        towns
            .iter()
            .filter(move |(p, _)| distance_km(p.at, centre) <= AREA_KM)
    };
    let (_, best, in_area) = towns
        .iter()
        .map(|(centre, own)| {
            (
                *own,
                *centre,
                around(centre.at).map(|(_, n)| n).sum::<usize>(),
            )
        })
        .max_by(|a, b| {
            a.2.cmp(&b.2)
                .then(a.0.cmp(&b.0))
                .then_with(|| b.1.town.cmp(&a.1.town))
        })?;
    if in_area * 3 < places.len() * 2 {
        return None;
    }
    around(best.at)
        .max_by(|(a, n), (b, m)| n.cmp(m).then_with(|| b.town.cmp(&a.town)))
        .map(|(p, _)| p.town.clone())
}

/// A name for photos taken at `places`, as specific as the photos allow and no more:
///
/// 1. One area holding two thirds of them (see [`area_name`]): "Tairua".
/// 2. One region holding two thirds: a road trip down the coast is "California", not the town
///    with the most stops.
/// 3. Two towns holding three quarters: "Tokyo and Kyoto".
/// 4. Two regions holding three quarters.
/// 5. The country holding half, or two countries holding three quarters: "France and Italy".
///
/// `None` when there's nothing to go on.
pub fn place_name(places: &[Place]) -> Option<String> {
    if places.is_empty() {
        return None;
    }
    area_name(places)
        .or_else(|| one_of(places, Level::Region, (2, 3)))
        .or_else(|| two_of(places, Level::Town))
        .or_else(|| two_of(places, Level::Region))
        .or_else(|| one_of(places, Level::Country, (1, 2)))
        .or_else(|| two_of(places, Level::Country))
}

/// The offline place list, loaded on first use (it takes a moment).
fn geocoder() -> &'static ReverseGeocoder {
    static GEOCODER: OnceLock<ReverseGeocoder> = OnceLock::new();
    GEOCODER.get_or_init(ReverseGeocoder::new)
}

/// Where `point` is, for naming trips and home: the nearest town, or the city it's part of
/// (see [`main_town`]), unless it's too far from anywhere to mean much.
fn place_of(point: Point) -> Option<Place> {
    let found = nearest(point)?;
    Some(place_from(main_town(found).unwrap_or(found)))
}

/// The town nearest `point` and where that town is, unless it's too far to mean much. Exact,
/// for the map beside one photo, where a suburb is the right answer.
pub fn town_near(point: Point) -> Option<(Place, Point)> {
    nearest(point).map(|found| {
        let place = place_from(found);
        let at = place.at;
        (place, at)
    })
}

/// The place-list entry nearest `point`, within `PLACE_MAX_KM`.
fn nearest(point: Point) -> Option<&'static Record> {
    let found = geocoder().search((point.lat, point.lon)).record;
    (distance_km(point, record_point(found)) <= PLACE_MAX_KM).then_some(found)
}

fn record_point(record: &Record) -> Point {
    Point {
        lat: record.lat,
        lon: record.lon,
    }
}

fn place_from(record: &Record) -> Place {
    Place {
        town: record.name.clone(),
        region: record.admin1.clone(),
        country: country_name(&record.cc).unwrap_or_else(|| record.cc.clone()),
        at: record_point(record),
    }
}

/// Whether a place-list entry is a main town: one its region or council is named after
/// (Auckland in Auckland, Hamilton in "Hamilton City", Sydney in "City of Sydney").
fn is_main(record: &Record) -> bool {
    let council = record.admin2.as_str();
    let council = council.strip_prefix("City of ").unwrap_or(council);
    let council = [" City", " District", " County", " Municipality"]
        .iter()
        .find_map(|suffix| council.strip_suffix(suffix))
        .unwrap_or(council);
    record.name == record.admin1 || record.name == council
}

/// The main town `record` is part of, when it's a suburb: the nearest main town (see
/// [`is_main`]) within `CITY_KM`. The place list has a few entries per city, so the nearest
/// entry to a home or a hotel is often a suburb nobody would name a trip after.
///
/// The geocoder only answers "what's nearest this point", so this asks it at points on rings
/// around the suburb (every 30 degrees, 2 to 14 km out) and keeps the main towns it finds.
/// `None` when the town is a main town itself or none is close.
fn main_town(record: &'static Record) -> Option<&'static Record> {
    if is_main(record) {
        return None;
    }
    let centre = record_point(record);
    let km_per_deg_lon = KM_PER_DEG_LAT * centre.lat.to_radians().cos().max(0.01);
    [2.0, 4.0, 7.0, 10.0, 14.0]
        .into_iter()
        .flat_map(|km: f64| (0..12).map(move |step| (km, f64::from(step) * 30f64.to_radians())))
        .map(|(km, bearing)| {
            let probe = (
                centre.lat + km * bearing.cos() / KM_PER_DEG_LAT,
                centre.lon + km * bearing.sin() / km_per_deg_lon,
            );
            geocoder().search(probe).record
        })
        .filter(|found| is_main(found))
        .map(|found| (distance_km(centre, record_point(found)), found))
        .filter(|(km, _)| *km <= CITY_KM)
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(_, found)| found)
}

/// A country's name from its two-letter code, in the language Windows is set to.
#[cfg(windows)]
fn country_name(code: &str) -> Option<String> {
    use windows::Win32::Globalization::{GEO_FRIENDLYNAME, GetGeoInfoEx};
    use windows::core::HSTRING;

    let code = HSTRING::from(code);
    let mut name = [0u16; 128];
    let len = unsafe { GetGeoInfoEx(&code, GEO_FRIENDLYNAME, Some(&mut name)) };
    // The length counts the closing null; 0 means Windows doesn't know the code.
    let len = usize::try_from(len).ok().filter(|&n| n > 1)?;
    Some(String::from_utf16_lossy(&name[..len - 1]))
}

#[cfg(not(windows))]
fn country_name(_code: &str) -> Option<String> {
    None
}

/// A suggestion for the Suggestions page.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    /// First and last day, "YYYY-MM-DD".
    pub start_day: String,
    pub end_day: String,
    /// The place name, or just "Trip" when there isn't one: the folder name setting adds the
    /// dates, so a name made from them would say them twice.
    pub name: String,
    /// Photos and videos (groups) taken during the run.
    pub files: usize,
    pub away_days: usize,
    /// Whole km, when some days were away.
    pub away_km: Option<u32>,
    pub sample: Vec<SampleTile>,
    /// The folder it was found from, relative to the library, when it's a folder that looks
    /// like a trip rather than a run of busy days.
    pub folder: Option<String>,
}

/// Where home is, for the page to explain away days.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeInfo {
    /// The nearest town, when there is one.
    pub place: Option<String>,
    /// Set in Settings rather than worked out from the photos.
    pub set: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestions {
    /// Newest first.
    pub suggestions: Vec<Suggestion>,
    pub home: Option<HomeInfo>,
    /// Suggestions hidden because they were dismissed.
    pub dismissed: usize,
    /// Photos and videos in a day for it to count as busy.
    pub min_photos: usize,
    /// Photos and videos with a location.
    pub located: usize,
}

/// What Settings says about suggestions: the busy-day count and the home location.
fn suggest_settings(conn: &Connection) -> Result<(usize, Option<Point>)> {
    let min_photos = db::get_setting(conn, "suggest_min_photos")?
        .and_then(|v| parse_min_photos(&v))
        .unwrap_or(DEFAULT_MIN_PHOTOS);
    let home = db::get_setting(conn, "home_location")?.and_then(|v| parse_home(&v));
    Ok((min_photos, home))
}

/// The busy-day count from Settings, when it's a whole number from 1 to 1,000.
pub fn parse_min_photos(text: &str) -> Option<usize> {
    text.trim()
        .parse::<usize>()
        .ok()
        .filter(|n| (1..=1000).contains(n))
}

/// A home typed or pasted as "latitude, longitude", the way map apps copy a place, e.g.
/// "-36.8485, 174.7633". A space between the two numbers works too.
pub fn parse_home(text: &str) -> Option<Point> {
    let mut parts = text.split([',', ' ']).filter(|p| !p.trim().is_empty());
    let lat = parts.next()?.trim().parse::<f64>().ok()?;
    let lon = parts.next()?.trim().parse::<f64>().ok()?;
    let valid = parts.next().is_none() && lat.abs() <= 90.0 && lon.abs() <= 180.0;
    valid.then_some(Point { lat, lon })
}

/// The town nearest a home typed in Settings, with its country, so the page can confirm it.
/// `None` when there's no town within 100 km.
#[tauri::command(async)]
pub fn home_place(location: String) -> Result<Option<String>> {
    let point = parse_home(&location)
        .ok_or_else(|| Error::msg("Type the latitude and longitude, like -36.85, 174.76"))?;
    Ok(place_of(point).map(|p| {
        if p.country.is_empty() || p.country == p.town {
            p.town
        } else {
            format!("{}, {}", p.town, p.country)
        }
    }))
}

pub(crate) fn load_dismissed(conn: &Connection) -> Result<Vec<(NaiveDate, NaiveDate)>> {
    let mut stmt = conn.prepare("SELECT start_day, end_day FROM dismissed_suggestions")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    let parse = |s: &str| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok();
    Ok(rows
        .filter_map(|r| r.ok())
        .filter_map(|(s, e)| Some((parse(&s)?, parse(&e)?)))
        .collect())
}

/// Where a group was taken: the first member with a location.
fn point_of(group: &Group) -> Option<Point> {
    group.members.iter().find_map(|m| match (m.lat, m.lon) {
        (Some(lat), Some(lon)) => Some(Point { lat, lon }),
        _ => None,
    })
}

/// Every `n`th item so that at most `limit` are kept, spread through the slice.
fn spread<T: Copy>(items: &[T], limit: usize) -> Vec<T> {
    let step = items.len().div_ceil(limit.max(1)).max(1);
    items.iter().step_by(step).copied().collect()
}

/// Trips Pic Cabinet thinks you took, with their photo counts, names and sample photos.
#[tauri::command(async)]
pub fn suggest_trips(state: State<'_, AppState>) -> Result<Suggestions> {
    let (root, rows, trips, dismissed, (min_photos, set_home)) = {
        let conn = lock_db(&state)?;
        (
            library_root(&conn).ok(),
            index::load_rows(&conn)?,
            trips::load(&conn)?,
            load_dismissed(&conn)?,
            suggest_settings(&conn)?,
        )
    };
    let (groups, _) = groups::build(rows);
    // A date guessed from the file's modified time says when it was copied, not taken.
    let shots: Vec<Shot> = groups
        .iter()
        .filter(|g| g.date_source != DateSource::Modified)
        .map(|g| Shot {
            day: g.taken_at.date(),
            point: point_of(g),
        })
        .collect();
    let located = shots.iter().filter(|s| s.point.is_some()).count();
    let found = find(&shots, min_photos, set_home);

    let (clear, hidden): (Vec<&Run>, Vec<&Run>) = found
        .runs
        .iter()
        .filter(|r| is_clear(r, &trips, &[]))
        .partition(|r| is_clear(r, &[], &dismissed));
    // Folders come first: a run of busy days over one says the same trip less well.
    let folders = root.map_or_else(Vec::new, |root| {
        folder_trips::find(&root, &groups, &trips, &dismissed)
    });
    let mut suggestions: Vec<Suggestion> = clear
        .into_iter()
        .filter(|run| {
            folders
                .iter()
                .all(|f| f.end < run.start || run.end < f.start)
        })
        .map(|run| describe(run, &groups))
        .chain(folders.iter().map(|f| from_folder(f, &groups)))
        .collect();
    suggestions.sort_by(|a, b| b.start_day.cmp(&a.start_day));
    let home = found.home.map(|home| HomeInfo {
        place: place_of(home).map(|p| p.town),
        set: set_home.is_some(),
    });
    Ok(Suggestions {
        suggestions,
        home,
        dismissed: hidden.len(),
        min_photos,
        located,
    })
}

/// A run as a suggestion: its photos, a name and some samples.
fn describe(run: &Run, groups: &[Group]) -> Suggestion {
    let start: NaiveDateTime = run.start.and_time(NaiveTime::MIN);
    let end = run.end.and_hms_opt(23, 59, 59).unwrap_or(start);
    let inside: Vec<&Group> = groups
        .iter()
        .filter(|g| start <= g.taken_at && g.taken_at <= end)
        .collect();
    let points: Vec<Point> = inside.iter().filter_map(|g| point_of(g)).collect();
    let places: Vec<Place> = spread(&points, PLACE_LOOKUPS)
        .into_iter()
        .filter_map(place_of)
        .collect();
    let place = place_name(&places);
    Suggestion {
        start_day: run.start.format("%Y-%m-%d").to_string(),
        end_day: run.end.format("%Y-%m-%d").to_string(),
        name: place.unwrap_or_else(|| "Trip".to_string()),
        files: inside.len(),
        away_days: run.away_days,
        away_km: run.away_km.map(|km| km.round() as u32),
        sample: trips::sample(&inside),
        folder: None,
    }
}

/// A folder that looks like a trip as a suggestion, named after the folder. Its files are every
/// photo taken in its days, since that's what the trip would hold.
fn from_folder(found: &FolderTrip, groups: &[Group]) -> Suggestion {
    let start: NaiveDateTime = found.start.and_time(NaiveTime::MIN);
    let end = found.end.and_hms_opt(23, 59, 59).unwrap_or(start);
    let inside: Vec<&Group> = groups
        .iter()
        .filter(|g| start <= g.taken_at && g.taken_at <= end)
        .collect();
    Suggestion {
        start_day: found.start.format("%Y-%m-%d").to_string(),
        end_day: found.end.format("%Y-%m-%d").to_string(),
        name: found.name.clone(),
        files: inside.len(),
        away_days: 0,
        away_km: None,
        sample: trips::sample(&inside),
        folder: Some(found.folder.clone()),
    }
}

/// Hide a suggestion. It stays hidden while its dates overlap these.
#[tauri::command(async)]
pub fn dismiss_suggestion(
    state: State<'_, AppState>,
    start_day: NaiveDate,
    end_day: NaiveDate,
) -> Result<()> {
    if end_day < start_day {
        return Err(Error::msg("The suggestion has to end after it starts"));
    }
    lock_db(&state)?.execute(
        "INSERT OR IGNORE INTO dismissed_suggestions (start_day, end_day) VALUES (?1, ?2)",
        params![start_day.to_string(), end_day.to_string()],
    )?;
    Ok(())
}

/// Show every dismissed suggestion again.
#[tauri::command(async)]
pub fn restore_dismissed(state: State<'_, AppState>) -> Result<()> {
    lock_db(&state)?.execute("DELETE FROM dismissed_suggestions", [])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const AUCKLAND: Point = Point {
        lat: -36.8485,
        lon: 174.7633,
    };
    const SYDNEY: Point = Point {
        lat: -33.8688,
        lon: 151.2093,
    };
    const WELLINGTON: Point = Point {
        lat: -41.2865,
        lon: 174.7762,
    };

    fn day(text: &str) -> NaiveDate {
        NaiveDate::parse_from_str(text, "%Y-%m-%d").unwrap()
    }

    /// `count` shots on `on`, all at `point`.
    fn shots(on: &str, count: usize, point: Option<Point>) -> Vec<Shot> {
        vec![
            Shot {
                day: day(on),
                point
            };
            count
        ]
    }

    /// A few photos at home on each of `days` days in January 2025.
    fn everyday_life(days: u32, place: Point) -> Vec<Shot> {
        (1..=days)
            .flat_map(|d| shots(&format!("2025-01-{d:02}"), 3, Some(place)))
            .collect()
    }

    fn range(run: &Run) -> (String, String) {
        (run.start.to_string(), run.end.to_string())
    }

    #[test]
    fn busy_days_join_into_runs_across_one_quiet_day() {
        let mut all = Vec::new();
        all.extend(shots("2025-03-01", 20, None));
        all.extend(shots("2025-03-02", 15, None));
        all.extend(shots("2025-03-03", 2, None));
        all.extend(shots("2025-03-04", 30, None));
        // Two quiet days split these into two single busy days, too short to suggest.
        all.extend(shots("2025-03-10", 20, None));
        all.extend(shots("2025-03-13", 20, None));
        let found = find(&all, 15, None);
        let runs: Vec<_> = found.runs.iter().map(range).collect();
        assert_eq!(runs, vec![("2025-03-01".into(), "2025-03-04".into())]);
        assert_eq!(found.runs[0].away_days, 0);
        assert_eq!(found.home, None);
    }

    #[test]
    fn the_busy_threshold_is_inclusive() {
        let mut all = shots("2025-03-01", 14, None);
        all.extend(shots("2025-03-02", 14, None));
        assert!(find(&all, 15, None).runs.is_empty());
        all.extend(shots("2025-03-02", 1, None));
        all.extend(shots("2025-03-03", 15, None));
        let found = find(&all, 15, None);
        assert_eq!(
            found.runs.iter().map(range).collect::<Vec<_>>(),
            vec![("2025-03-02".into(), "2025-03-03".into())]
        );
    }

    #[test]
    fn home_is_where_photos_were_taken_on_the_most_days() {
        // Ten ordinary days in Auckland, then a big three-day trip to Sydney.
        let mut all = everyday_life(10, AUCKLAND);
        for d in ["2025-02-10", "2025-02-11", "2025-02-12"] {
            all.extend(shots(d, 80, Some(SYDNEY)));
        }
        let found = find(&all, 15, None);
        let home = found.home.expect("home found");
        assert!(distance_km(home, AUCKLAND) < 1.0, "home was {home:?}");
        assert_eq!(found.runs.len(), 1);
        assert_eq!(found.runs[0].away_days, 3);
        let km = found.runs[0].away_km.unwrap();
        assert!(
            (2140.0..2170.0).contains(&km),
            "Sydney is about 2,155 km away, got {km}"
        );
    }

    #[test]
    fn away_days_count_even_with_few_photos() {
        let mut all = everyday_life(10, AUCKLAND);
        all.extend(shots("2025-02-10", 2, Some(WELLINGTON)));
        all.extend(shots("2025-02-11", 3, Some(WELLINGTON)));
        let found = find(&all, 15, None);
        assert_eq!(
            found.runs.iter().map(range).collect::<Vec<_>>(),
            vec![("2025-02-10".into(), "2025-02-11".into())]
        );
        assert_eq!(found.runs[0].away_days, 2);
    }

    #[test]
    fn a_day_out_nearby_is_not_away() {
        // About 30 km north of the city centre.
        let nearby = Point {
            lat: -36.59,
            lon: 174.69,
        };
        let mut all = everyday_life(10, AUCKLAND);
        all.extend(shots("2025-02-10", 4, Some(nearby)));
        all.extend(shots("2025-02-11", 4, Some(nearby)));
        assert!(find(&all, 15, None).runs.is_empty());
    }

    #[test]
    fn busy_days_at_home_are_not_a_trip() {
        let mut all = everyday_life(10, AUCKLAND);
        all.extend(shots("2025-02-08", 30, Some(AUCKLAND)));
        all.extend(shots("2025-02-09", 30, Some(AUCKLAND)));
        assert!(find(&all, 15, None).runs.is_empty());
        // Without locations those days can't be placed, so they're still suggested.
        all.extend(shots("2025-03-08", 30, None));
        all.extend(shots("2025-03-09", 30, None));
        let found = find(&all, 15, None);
        assert_eq!(
            found.runs.iter().map(range).collect::<Vec<_>>(),
            vec![("2025-03-08".into(), "2025-03-09".into())]
        );
    }

    #[test]
    fn one_busy_day_away_is_a_day_trip() {
        let mut all = everyday_life(10, AUCKLAND);
        // A big day out far from home, then a few photos away on another day.
        all.extend(shots("2025-02-10", 30, Some(WELLINGTON)));
        all.extend(shots("2025-02-20", 3, Some(WELLINGTON)));
        // A big day at home, and a big day with no locations.
        all.extend(shots("2025-03-01", 30, Some(AUCKLAND)));
        all.extend(shots("2025-03-10", 30, None));
        let found = find(&all, 15, None);
        assert_eq!(
            found.runs.iter().map(range).collect::<Vec<_>>(),
            vec![("2025-02-10".into(), "2025-02-10".into())]
        );
        assert_eq!(found.runs[0].away_days, 1);
    }

    #[test]
    fn busy_home_days_either_side_of_a_trip_come_off() {
        let mut all = everyday_life(10, AUCKLAND);
        all.extend(shots("2025-02-09", 30, Some(AUCKLAND)));
        for d in ["2025-02-10", "2025-02-11", "2025-02-12"] {
            all.extend(shots(d, 20, Some(WELLINGTON)));
        }
        all.extend(shots("2025-02-13", 30, Some(AUCKLAND)));
        let found = find(&all, 15, None);
        assert_eq!(
            found.runs.iter().map(range).collect::<Vec<_>>(),
            vec![("2025-02-10".into(), "2025-02-12".into())]
        );
        assert_eq!(found.runs[0].away_days, 3);
    }

    #[test]
    fn a_day_away_counts_by_where_most_of_its_photos_were() {
        // One photo at home that morning doesn't stop the day counting as away.
        let mut all = everyday_life(10, AUCKLAND);
        for d in ["2025-02-10", "2025-02-11"] {
            all.extend(shots(d, 1, Some(AUCKLAND)));
            all.extend(shots(d, 4, Some(WELLINGTON)));
        }
        let found = find(&all, 15, None);
        assert_eq!(found.runs.len(), 1);
        assert_eq!(found.runs[0].away_days, 2);
    }

    #[test]
    fn a_home_set_in_settings_wins() {
        // The photos say Auckland, but Settings says Wellington: Auckland days are away.
        let all = everyday_life(3, AUCKLAND);
        let found = find(&all, 15, Some(WELLINGTON));
        assert_eq!(found.home, Some(WELLINGTON));
        assert_eq!(
            found.runs.iter().map(range).collect::<Vec<_>>(),
            vec![("2025-01-01".into(), "2025-01-03".into())]
        );
    }

    #[test]
    fn too_few_located_days_means_no_home() {
        let mut all = everyday_life(MIN_HOME_DAYS as u32 - 1, AUCKLAND);
        all.extend(shots("2025-02-10", 2, Some(SYDNEY)));
        all.extend(shots("2025-02-11", 2, Some(SYDNEY)));
        let found = find(&all, 15, None);
        assert_eq!(found.home, None);
        assert!(found.runs.is_empty());
    }

    #[test]
    fn a_home_on_a_grid_edge_is_still_found() {
        // Home days either side of a cell boundary, against fewer days at one far-off spot.
        let west = Point {
            lat: -36.80,
            lon: 174.749,
        };
        let east = Point {
            lat: -36.80,
            lon: 174.751,
        };
        let mut all = everyday_life(4, west);
        all.extend((10..=13).flat_map(|d| shots(&format!("2025-01-{d}"), 3, Some(east))));
        all.extend((1..=6).flat_map(|d| shots(&format!("2025-03-{d:02}"), 3, Some(SYDNEY))));
        let home = find(&all, 15, None).home.expect("home found");
        assert!(distance_km(home, west) < 1.0, "home was {home:?}");
    }

    #[test]
    fn runs_over_a_trip_or_a_dismissed_range_are_left_out() {
        let run = Run {
            start: day("2025-03-10"),
            end: day("2025-03-12"),
            away_days: 0,
            away_km: None,
        };
        let trip = |start: &str, end: &str| Trip {
            id: 1,
            name: "t".into(),
            start_at: crate::dates::parse(start).unwrap(),
            end_at: crate::dates::parse(end).unwrap(),
            folder: "f".into(),
            created_at: 0,
            excluded: Default::default(),
        };
        assert!(is_clear(&run, &[], &[]));
        // Touching the run's last second counts; ending the evening before doesn't.
        assert!(!is_clear(
            &run,
            &[trip("2025-03-12T23:59:59", "2025-03-14T00:00:00")],
            &[]
        ));
        assert!(is_clear(
            &run,
            &[trip("2025-03-01T00:00:00", "2025-03-09T23:59:59")],
            &[]
        ));
        assert!(!is_clear(
            &run,
            &[],
            &[(day("2025-03-08"), day("2025-03-10"))]
        ));
        assert!(is_clear(
            &run,
            &[],
            &[(day("2025-03-13"), day("2025-03-20"))]
        ));
    }

    fn place(town: &str, region: &str, country: &str, (lat, lon): (f64, f64)) -> Place {
        Place {
            town: town.into(),
            region: region.into(),
            country: country.into(),
            at: Point { lat, lon },
        }
    }

    /// `count` copies of `place`.
    fn times(place: &Place, count: usize) -> Vec<Place> {
        vec![place.clone(); count]
    }

    #[test]
    fn names_fit_how_far_the_photos_spread() {
        let tokyo = place("Tokyo", "Tokyo", "Japan", (35.69, 139.69));
        let kyoto = place("Kyoto", "Kyoto", "Japan", (35.02, 135.75));
        let osaka = place("Osaka", "Osaka", "Japan", (34.69, 135.50));
        let paris = place("Paris", "Ile-de-France", "France", (48.85, 2.35));
        let rome = place("Rome", "Lazio", "Italy", (41.89, 12.51));
        let nice = place(
            "Nice",
            "Provence-Alpes-Cote d'Azur",
            "France",
            (43.70, 7.27),
        );
        let florence = place("Florence", "Tuscany", "Italy", (43.77, 11.25));
        let barcelona = place("Barcelona", "Catalonia", "Spain", (41.39, 2.16));
        let queenstown = place("Queenstown", "Otago", "New Zealand", (-45.03, 168.66));
        let wanaka = place("Wanaka", "Otago", "New Zealand", (-44.70, 169.14));
        let cromwell = place("Cromwell", "Otago", "New Zealand", (-45.04, 169.20));
        let te_anau = place("Te Anau", "Southland", "New Zealand", (-45.41, 167.72));

        // Mostly one town.
        assert_eq!(
            place_name(&[tokyo.clone(), tokyo.clone(), kyoto.clone()]).as_deref(),
            Some("Tokyo")
        );
        let fiordland = [times(&queenstown, 10), times(&te_anau, 3)].concat();
        assert_eq!(place_name(&fiordland).as_deref(), Some("Queenstown"));
        // Two towns sharing nearly everything make a pair.
        let pair = [times(&tokyo, 4), times(&kyoto, 4), times(&osaka, 1)].concat();
        assert_eq!(place_name(&pair).as_deref(), Some("Kyoto and Tokyo"));
        // Spread over towns in one region.
        let otago = [queenstown, wanaka, cromwell];
        assert_eq!(place_name(&otago).as_deref(), Some("Otago"));
        // Spread over regions in one country.
        assert_eq!(place_name(&[tokyo, kyoto, osaka]).as_deref(), Some("Japan"));
        // Spread over countries, mostly two.
        let europe = [paris, nice, rome, florence, barcelona];
        assert_eq!(place_name(&europe).as_deref(), Some("France and Italy"));
        assert_eq!(place_name(&[]), None);
    }

    #[test]
    fn a_stay_is_named_after_its_busiest_town() {
        // Days at the beaches around Tairua, and one day trip further off.
        let tairua = place("Tairua", "Waikato", "New Zealand", (-37.02, 175.85));
        let whangamata = place("Whangamata", "Waikato", "New Zealand", (-37.20, 175.87));
        let thames = place("Thames", "Waikato", "New Zealand", (-37.14, 175.54));
        let stay = [times(&whangamata, 3), times(&tairua, 4), times(&thames, 2)].concat();
        assert_eq!(place_name(&stay).as_deref(), Some("Tairua"));
    }

    #[test]
    fn a_road_trip_is_named_after_its_region_not_its_busiest_stop() {
        let pacific_grove = place(
            "Pacific Grove",
            "California",
            "United States",
            (36.62, -121.92),
        );
        let cambria = place("Cambria", "California", "United States", (35.56, -121.08));
        let sausalito = place("Sausalito", "California", "United States", (37.86, -122.49));
        let trip = [
            times(&pacific_grove, 6),
            times(&cambria, 4),
            times(&sausalito, 3),
        ]
        .concat();
        assert_eq!(place_name(&trip).as_deref(), Some("California"));
    }

    #[test]
    fn towns_with_the_same_name_in_different_places_are_told_apart() {
        let richmond_nz = place("Richmond", "Tasman", "New Zealand", (-41.34, 173.18));
        let richmond_us = place("Richmond", "Virginia", "United States", (37.54, -77.44));
        let christchurch = place(
            "Christchurch",
            "Canterbury",
            "New Zealand",
            (-43.53, 172.63),
        );
        // Counted by name alone, Richmond would have two of three photos. Told apart, no town or
        // region stands out, and the country most photos share names the trip.
        let found = place_name(&[richmond_nz.clone(), richmond_us.clone(), christchurch]);
        assert_eq!(found.as_deref(), Some("New Zealand"));
        // Two different Richmonds never make "Richmond and Richmond".
        let found = place_name(&[
            richmond_nz.clone(),
            richmond_us.clone(),
            richmond_nz,
            richmond_us,
        ]);
        assert_eq!(found.as_deref(), Some("Richmond"));
    }

    #[test]
    fn evenly_spread_picks_keep_the_ends_in_reach() {
        let items: Vec<u32> = (0..10).collect();
        assert_eq!(spread(&items, 3), vec![0, 4, 8]);
        assert_eq!(spread(&items, 20), items);
        assert!(spread::<u32>(&[], 5).is_empty());
    }

    #[test]
    fn the_place_list_names_real_places() {
        let auckland = place_of(AUCKLAND).expect("a place near Auckland");
        assert_eq!(auckland.town, "Auckland");
        assert!(!auckland.country.is_empty() && auckland.country != "NZ");
        // Suburbs go by their city; towns that are their own main town keep their names.
        let town = |lat, lon| place_of(Point { lat, lon }).map(|p| p.town);
        assert_eq!(
            town(-36.875, 174.67).as_deref(),
            Some("Auckland"),
            "Rosebank"
        );
        assert_eq!(
            town(36.618, -121.917).as_deref(),
            Some("Monterey"),
            "Pacific Grove"
        );
        assert_eq!(town(-37.017, 175.85).as_deref(), Some("Tairua"));
        assert_eq!(town(-45.03, 168.663).as_deref(), Some("Queenstown"));
        // The map beside one photo still names the exact suburb.
        let exact = town_near(Point {
            lat: -36.875,
            lon: 174.67,
        })
        .map(|(p, _)| p.town);
        assert_eq!(exact.as_deref(), Some("Rosebank"));
        // The middle of the Pacific is nowhere.
        assert_eq!(
            place_of(Point {
                lat: -30.0,
                lon: -140.0
            }),
            None
        );
    }

    #[cfg(windows)]
    #[test]
    fn country_codes_become_names() {
        assert!(country_name("JP").is_some_and(|n| n.len() > 2));
        assert_eq!(country_name("ZZ"), None);
    }

    #[test]
    fn a_home_can_be_pasted_from_a_map() {
        let home = Point {
            lat: -36.8485,
            lon: 174.7633,
        };
        assert_eq!(parse_home("-36.8485, 174.7633"), Some(home));
        assert_eq!(parse_home(" -36.8485 174.7633 "), Some(home));
        assert_eq!(parse_home("-36.8485,174.7633"), Some(home));
        assert_eq!(parse_home("91, 0"), None);
        assert_eq!(parse_home("0, 181"), None);
        assert_eq!(parse_home("-36.8485"), None);
        assert_eq!(parse_home("1, 2, 3"), None);
        assert_eq!(parse_home("Auckland"), None);
        assert_eq!(parse_home(""), None);
    }

    #[test]
    fn the_busy_day_count_is_a_sensible_whole_number() {
        assert_eq!(parse_min_photos(" 20 "), Some(20));
        assert_eq!(parse_min_photos("0"), None);
        assert_eq!(parse_min_photos("1001"), None);
        assert_eq!(parse_min_photos("lots"), None);
    }
}
