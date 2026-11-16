// The computer's location from Windows, read once when asked, to fill in home in Settings.

use crate::error::{Error, Result};

/// How long to wait for Windows to find the computer before giving up.
#[cfg(windows)]
const WAIT_SECS: i64 = 20;

/// Where Windows says this computer is now, as "lat, lon" rounded to three places (about 100 m,
/// plenty for telling trips from home). One reading, nothing kept running afterwards.
#[tauri::command(async)]
pub fn current_location() -> Result<String> {
    let (lat, lon) = read()?;
    Ok(format!("{lat:.3}, {lon:.3}"))
}

#[cfg(windows)]
fn read() -> Result<(f64, f64)> {
    use windows::Devices::Geolocation::{GeolocationAccessStatus, Geolocator};
    use windows::Foundation::TimeSpan;

    let blocked = || {
        Error::msg(
            "Windows isn't sharing your location. In Windows Settings > Privacy & security > Location, turn on Location and \"Let desktop apps access your location\", then try again.",
        )
    };
    let failed = |_: windows::core::Error| {
        Error::msg("Windows couldn't find your location. Try again, or type it in.")
    };
    let access = Geolocator::RequestAccessAsync()
        .and_then(|op| op.join())
        .map_err(|_| blocked())?;
    if access != GeolocationAccessStatus::Allowed {
        return Err(blocked());
    }
    // TimeSpan counts 100 ns ticks. A reading up to 10 minutes old is as good as a new one here.
    let ticks = |secs: i64| TimeSpan {
        Duration: secs * 10_000_000,
    };
    let position = Geolocator::new()
        .and_then(|locator| {
            locator.GetGeopositionAsyncWithAgeAndTimeout(ticks(600), ticks(WAIT_SECS))
        })
        .and_then(|op| op.join())
        .map_err(failed)?;
    let point = position
        .Coordinate()
        .and_then(|c| c.Point())
        .and_then(|p| p.Position())
        .map_err(failed)?;
    Ok((point.Latitude, point.Longitude))
}

#[cfg(not(windows))]
fn read() -> Result<(f64, f64)> {
    Err(Error::msg("Finding your location needs Windows."))
}
