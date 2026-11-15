// Write THIRD_PARTY_NOTICES.txt: every third-party package, tool and data set that ships in the
// installer, with its licence. Reads the installed node_modules and Cargo's registry, so run it
// after npm install. Runs before every dev start and build, so each installer lists exactly the
// dependencies it was built with; the file isn't kept in git.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { LICENCE_FILE, renderNotices, shippedCrates } from "./notices-lib.mjs";

const PRODUCT = "Pic Cabinet";
const root = resolve(import.meta.dirname, "..");
// Bundled as a resource (tauri.conf.json) next to ExifTool, which is also downloaded at build time.
const out = join(root, "src-tauri", "resources", "THIRD_PARTY_NOTICES.txt");

/**
 * Contents of the licence files directly inside a package folder.
 * @param {string} dir - package folder
 * @returns {string[]} file contents, in file-name order
 */
function licenceTexts(dir) {
  return readdirSync(dir)
    .filter((name) => LICENCE_FILE.test(name) && statSync(join(dir, name)).isFile())
    .sort()
    .map((name) => readFileSync(join(dir, name), "utf8"));
}

// npm: production dependencies only, since dev tools never reach the installer. The lockfile
// flags dev-only packages (dev, or devOptional for optional ones) and keys each by its folder.
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const seen = new Set();
const npm = [];
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path || entry.dev || entry.devOptional || entry.link) continue;
  const dir = join(root, path);
  // An optional package for another platform isn't installed, so isn't shipped either.
  if (!existsSync(dir)) continue;
  const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
  const key = `${name}@${entry.version}`;
  if (seen.has(key)) continue;
  seen.add(key);
  npm.push({
    name,
    version: entry.version,
    licence: entry.license ?? "UNKNOWN",
    texts: licenceTexts(dir),
  });
}

// Rust: the Windows build's dependency graph, as Cargo resolves it.
const metadata = JSON.parse(
  execFileSync(
    "cargo",
    [
      "metadata",
      "--format-version",
      "1",
      "--locked",
      "--filter-platform",
      "x86_64-pc-windows-msvc",
      "--manifest-path",
      join(root, "src-tauri", "Cargo.toml"),
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  ),
);
const crates = shippedCrates(metadata).map((pkg) => ({
  name: pkg.name,
  version: pkg.version,
  licence: pkg.license ?? (pkg.license_file ? "see licence file" : "UNKNOWN"),
  texts: licenceTexts(dirname(pkg.manifest_path)),
}));

// ExifTool's pinned version lives in the download script, which works without the download.
const exiftool = readFileSync(join(root, "scripts", "fetch-exiftool.mjs"), "utf8").match(
  /const VERSION = "([^"]+)"/,
)?.[1];
if (!exiftool) throw new Error("notices: couldn't find ExifTool's version in fetch-exiftool.mjs");
const geocoder = crates.find((c) => c.name === "reverse_geocoder");
// Likewise the map data's Natural Earth release, from the script that builds it.
const naturalEarth = readFileSync(join(root, "scripts", "map-data.mjs"), "utf8").match(
  /const TAG = "([^"]+)"/,
)?.[1];
if (!naturalEarth)
  throw new Error("notices: couldn't find Natural Earth's version in map-data.mjs");

const extras = `
ExifTool ${exiftool}, by Phil Harvey - https://exiftool.org
  Reads the date taken and location from photos and videos. ExifTool is free software, used under
  the same terms as Perl itself: the GNU General Public License or the Artistic License. It runs as
  a separate program, and its source code is available from https://exiftool.org.

Strawberry Perl, bundled with ExifTool - https://strawberryperl.com
  The Perl runtime ExifTool's Windows build runs on, under the same terms as Perl itself.
  The licence texts for ExifTool and Strawberry Perl are installed with ${PRODUCT}, in
  resources\\exiftool\\exiftool_files inside the install folder (LICENSE and
  Licenses_Strawberry_Perl.zip). The ExifTool Windows launcher is released under CC0 1.0.

GeoNames place data${geocoder ? `, bundled in reverse_geocoder ${geocoder.version}` : ""} - https://www.geonames.org
  Names the places in suggested trips and where a photo was taken, offline. Place data by
  GeoNames, licensed under the Creative Commons Attribution 4.0 licence:
  https://creativecommons.org/licenses/by/4.0/

Natural Earth ${naturalEarth} - https://www.naturalearthdata.com
  The coastlines, lakes, borders and towns on the photo viewer's map. Made with Natural Earth.
  Free vector and raster map data @ naturalearthdata.com. Natural Earth is in the public domain.
`;

const text = renderNotices({ product: PRODUCT, extras, npm, crates });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, text);
console.log(`notices: ${npm.length} npm and ${crates.length} Rust packages`);
