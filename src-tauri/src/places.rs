// Suburb names for the viewer's side panel from Nominatim, OpenStreetMap's own geocoder. Its
// reverse lookup finds the area a spot is inside rather than the nearest mapped object, so a
// photo near a suburb's edge gets the suburb it's in. The usage policy asks for an identifying
// User-Agent (which a webview fetch can't set), at most one request a second, and no repeat
// requests for a spot, so lookups are made here, spaced app-wide and kept for the session.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::AppHandle;
use tauri::async_runtime::Mutex as AsyncMutex;

use crate::error::{Error, Result};
use crate::metadata::valid_coords;

const ENDPOINT: &str = "https://nominatim.openstreetmap.org/reverse";
const PROJECT_URL: &str = "https://github.com/wobkobi/pic-cabinet";
/// The policy's limit is one request a second, for the whole app.
const SPACING: Duration = Duration::from_secs(1);
const TIMEOUT: Duration = Duration::from_secs(10);
/// Spots are kept to five decimal places (about a metre) for the request and the cache.
const PLACES: f64 = 100_000.0;

/// The parts of a Nominatim address a place name is built from, in English.
#[derive(Debug, Default, Deserialize)]
struct Address {
    suburb: Option<String>,
    neighbourhood: Option<String>,
    quarter: Option<String>,
    village: Option<String>,
    town: Option<String>,
    hamlet: Option<String>,
    city_district: Option<String>,
    city: Option<String>,
    state: Option<String>,
    country: Option<String>,
}

/// A reverse lookup's answer. Nominatim answers a spot with nothing there (open sea) with an
/// `error` and no address.
#[derive(Debug, Deserialize)]
struct Reply {
    address: Option<Address>,
}

/// Place names by spot (latitude and longitude in hundred-thousandths of a degree).
type Answers = HashMap<(i64, i64), Option<String>>;

/// Answers by spot for this session, `None` where Nominatim has nothing to name.
fn known() -> &'static Mutex<Answers> {
    static KNOWN: OnceLock<Mutex<Answers>> = OnceLock::new();
    KNOWN.get_or_init(Mutex::default)
}

/// When the last request went out. Waiters queue on the lock in order, so each one starts at
/// least [`SPACING`] after the one before.
fn last_sent() -> &'static AsyncMutex<Option<Instant>> {
    static LAST: OnceLock<AsyncMutex<Option<Instant>>> = OnceLock::new();
    LAST.get_or_init(|| AsyncMutex::new(None))
}

/// The suburb, region and country around a spot, from Nominatim. Each spot is asked about once
/// a session; a failed request (offline, or Nominatim down) isn't kept, so it's tried again.
/// `Ok(None)` means Nominatim has no suburb or town there (open country or sea).
#[tauri::command]
pub async fn place_name(app: AppHandle, lat: f64, lon: f64) -> Result<Option<String>> {
    let (lat, lon) =
        valid_coords(lat, lon).ok_or_else(|| Error::msg("That location isn't on the map."))?;
    let spot = ((lat * PLACES).round() as i64, (lon * PLACES).round() as i64);
    if let Some(place) = cached(spot) {
        return Ok(place);
    }

    {
        let mut last = last_sent().lock().await;
        // Another lookup of this spot may have finished while this one waited its turn.
        if let Some(place) = cached(spot) {
            return Ok(place);
        }
        if let Some(wait) = last.and_then(|at| SPACING.checked_sub(at.elapsed())) {
            tokio::time::sleep(wait).await;
        }
        *last = Some(Instant::now());
    }

    let version = app.package_info().version.to_string();
    let place = fetch(spot, &version).await.map_err(|err| {
        log::warn!("Place lookup failed: {err}");
        Error::msg("Couldn't reach the place-name service.")
    })?;
    if let Ok(mut known) = known().lock() {
        known.insert(spot, place.clone());
    }
    Ok(place)
}

/// The session's answer for a `spot` (latitude and longitude in hundred-thousandths of a
/// degree), if it has been asked about.
fn cached(spot: (i64, i64)) -> Option<Option<String>> {
    known().lock().ok()?.get(&spot).cloned()
}

/// Ask Nominatim about one `spot` (latitude and longitude in hundred-thousandths of a degree)
/// for an address at suburb level (zoom 16) with names in English, giving the app's `version`
/// in the User-Agent.
async fn fetch(spot: (i64, i64), version: &str) -> std::result::Result<Option<String>, String> {
    // reqwest is built without a TLS provider of its own (as the updater uses it), so install
    // ring's once. Failing means another provider is already installed, which is just as good.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let lat = spot.0 as f64 / PLACES;
    let lon = spot.1 as f64 / PLACES;
    // Plain numbers and fixed words, so nothing in the query needs escaping.
    let url = format!(
        "{ENDPOINT}?format=jsonv2&zoom=16&addressdetails=1&accept-language=en&lat={lat:.5}&lon={lon:.5}"
    );
    let client = reqwest::Client::builder()
        .user_agent(format!("PicCabinet/{version} ({PROJECT_URL})"))
        .timeout(TIMEOUT)
        .build()
        .map_err(|err| err.to_string())?;
    let reply: Reply = client
        .get(url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|err| err.to_string())?
        .json()
        .await
        .map_err(|err| err.to_string())?;
    Ok(reply.address.as_ref().and_then(place_from_address))
}

/// A place name from a Nominatim address: suburb, region and country, skipping any that repeat
/// the part before. The suburb is the smallest named area there, down to a village or hamlet in
/// the country; with none, the city district and then the city stand in. The city is otherwise
/// left out: in Auckland it's the council local board (Albert-Eden, Howick), not a name anyone
/// gives as where they were. `None` when there's no suburb, town or city to name (open country).
fn place_from_address(address: &Address) -> Option<String> {
    let suburb = [
        &address.suburb,
        &address.neighbourhood,
        &address.quarter,
        &address.village,
        &address.town,
        &address.hamlet,
        &address.city_district,
        &address.city,
    ]
    .into_iter()
    .flatten()
    .find(|name| !name.trim().is_empty())?;
    let mut parts: Vec<&str> = Vec::new();
    for part in [
        Some(suburb),
        address.state.as_ref(),
        address.country.as_ref(),
    ]
    .into_iter()
    .flatten()
    {
        let part = part.trim();
        if !part.is_empty() && !parts.contains(&part) {
            parts.push(part);
        }
    }
    Some(parts.join(", "))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn address(json: &str) -> Address {
        let reply: Reply = serde_json::from_str(json).expect("a Nominatim reply");
        reply.address.expect("an address")
    }

    #[test]
    fn names_the_suburb_not_aucklands_local_board() {
        // Nominatim's answer for IMG_2417 in Waterview, which Photon put in New Windsor.
        let waterview = address(
            r#"{"address":{"road":"Oakley Avenue","suburb":"Waterview","city":"Albert-Eden",
            "state":"Auckland","ISO3166-2-lvl4":"NZ-AUK","postcode":"1026",
            "country":"New Zealand","country_code":"nz"}}"#,
        );
        assert_eq!(
            place_from_address(&waterview).as_deref(),
            Some("Waterview, Auckland, New Zealand")
        );
    }

    #[test]
    fn falls_back_through_smaller_areas_to_the_city() {
        let village = address(
            r#"{"address":{"village":"Raglan","state":"Waikato","country":"New Zealand"}}"#,
        );
        assert_eq!(
            place_from_address(&village).as_deref(),
            Some("Raglan, Waikato, New Zealand")
        );
        let neighbourhood = address(
            r#"{"address":{"neighbourhood":"Gros-Caillou","city_district":"7th Arrondissement",
            "city":"Paris","state":"Ile-de-France","country":"France"}}"#,
        );
        assert_eq!(
            place_from_address(&neighbourhood).as_deref(),
            Some("Gros-Caillou, Ile-de-France, France")
        );
        let city =
            address(r#"{"address":{"city":"Hamilton","state":"Waikato","country":"New Zealand"}}"#);
        assert_eq!(
            place_from_address(&city).as_deref(),
            Some("Hamilton, Waikato, New Zealand")
        );
    }

    #[test]
    fn skips_a_part_that_repeats_the_one_before() {
        let wellington = address(
            r#"{"address":{"city":"Wellington","state":"Wellington","country":"New Zealand"}}"#,
        );
        assert_eq!(
            place_from_address(&wellington).as_deref(),
            Some("Wellington, New Zealand")
        );
    }

    #[test]
    fn gives_nothing_in_open_country_or_at_sea() {
        let open = address(r#"{"address":{"state":"Taranaki","country":"New Zealand"}}"#);
        assert_eq!(place_from_address(&open), None);
        let sea: Reply = serde_json::from_str(r#"{"error":"Unable to geocode"}"#).expect("json");
        assert!(sea.address.is_none());
    }
}
