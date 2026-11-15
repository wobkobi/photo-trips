// Pure helpers for scripts/notices.mjs: pick out the packages that ship in the app and render
// THIRD_PARTY_NOTICES.txt from them.

/**
 * @typedef {object} Shipped
 * @property {string} name - package name
 * @property {string} version - package version
 * @property {string} licence - SPDX expression from the package's manifest, or "UNKNOWN"
 * @property {string[]} texts - contents of the licence files the package ships, if any
 */

/**
 * A package as `cargo metadata` lists it; only the fields these scripts read.
 * @typedef {object} CargoPackage
 * @property {string} id - package id, as the resolve graph refers to it
 * @property {string} name - package name
 * @property {string} version - package version
 * @property {string | null} [license] - SPDX expression from the manifest
 * @property {string | null} [license_file] - licence file named in the manifest instead
 * @property {string} [manifest_path] - path to the package's Cargo.toml
 * @property {{ kind: string[] }[]} targets - build targets, e.g. lib or proc-macro
 */

/**
 * A node in the `cargo metadata` resolve graph: one package and its dependencies.
 * @typedef {object} CargoNode
 * @property {string} id - package id
 * @property {{ pkg: string, dep_kinds: { kind: string | null }[] }[]} deps - each dependency,
 *   with null as the kind for a normal one
 */

/**
 * Output of `cargo metadata --format-version 1`; only the fields these scripts read.
 * @typedef {object} CargoMetadata
 * @property {CargoPackage[]} packages - every package in the graph
 * @property {{ root: string, nodes: CargoNode[] }} resolve - the resolved dependency graph
 */

/** Licence, copying and notice files, e.g. LICENSE, LICENCE.md, LICENSE-APACHE, COPYING, NOTICE. */
export const LICENCE_FILE = /^(un)?licen[cs]e|^copying|^notice|^copyright/i;

/**
 * Rust packages compiled into the app: everything reachable from the root through normal
 * dependencies. Build and dev dependencies never ship, and neither does a proc-macro or anything
 * only a proc-macro uses, since those run inside the compiler.
 * @param {CargoMetadata} metadata - output of `cargo metadata --format-version 1`
 * @returns {CargoPackage[]} the shipped packages from `metadata.packages`, root excluded
 */
export function shippedCrates(metadata) {
  const packages = new Map(metadata.packages.map((p) => [p.id, p]));
  const nodes = new Map(metadata.resolve.nodes.map((n) => [n.id, n]));
  const root = metadata.resolve.root;
  const seen = new Set([root]);
  const queue = [root];
  while (queue.length > 0) {
    const node = nodes.get(queue.shift());
    for (const dep of node?.deps ?? []) {
      if (seen.has(dep.pkg)) continue;
      if (!dep.dep_kinds.some((k) => k.kind === null)) continue;
      const pkg = packages.get(dep.pkg);
      if (pkg.targets.some((t) => t.kind.includes("proc-macro"))) continue;
      seen.add(dep.pkg);
      queue.push(dep.pkg);
    }
  }
  seen.delete(root);
  return [...seen].map((id) => packages.get(id));
}

/**
 * Normalise a licence file so copies that differ only in line endings or trailing spaces match.
 * @param {string} text - file contents
 * @returns {string} the tidied text
 */
export function tidyText(text) {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

/**
 * Group packages that ship the same licence text, so each text is printed once with every
 * package that uses it. Packages that ship no licence file are returned separately.
 * @param {Shipped[]} shipped - every shipped package
 * @returns {{ groups: { text: string, users: Shipped[] }[], bare: Shipped[] }} groups sorted by
 * their first user's name, and the packages with no licence file
 */
export function groupByText(shipped) {
  const byText = new Map();
  const bare = [];
  for (const pkg of shipped) {
    if (pkg.texts.length === 0) {
      bare.push(pkg);
      continue;
    }
    for (const text of new Set(pkg.texts.map(tidyText))) {
      if (!text) continue;
      if (!byText.has(text)) byText.set(text, []);
      byText.get(text).push(pkg);
    }
  }
  const groups = [...byText].map(([text, users]) => ({ text, users: [...users].sort(byName) }));
  groups.sort((a, b) => byName(a.users[0], b.users[0]) || a.text.localeCompare(b.text));
  return { groups, bare: bare.sort(byName) };
}

/**
 * Sort packages by name, then version.
 * @param {Shipped} a - one package
 * @param {Shipped} b - the other
 * @returns {number} sort order
 */
function byName(a, b) {
  return a.name.localeCompare(b.name) || a.version.localeCompare(b.version);
}

/**
 * Package line for the summary and the "used by" lists.
 * @param {Shipped} pkg - the package
 * @returns {string} e.g. "react 19.1.0"
 */
function label(pkg) {
  return `${pkg.name} ${pkg.version}`;
}

/**
 * Wrap a list of words onto lines no wider than `width`, each indented by `indent`.
 * @param {string[]} words - items to lay out
 * @param {string} indent - prefix for every line
 * @param {number} width - maximum line length, indent included
 * @returns {string} the wrapped lines
 */
function wrap(words, indent, width = 100) {
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && indent.length + line.length + 1 + word.length > width) {
      lines.push(indent + line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(indent + line);
  return lines.join("\n");
}

const RULE = "=".repeat(100);
const THIN = "-".repeat(100);

/**
 * Render THIRD_PARTY_NOTICES.txt.
 * @param {object} input - what goes in the file
 * @param {string} input.product - app name, e.g. "Pic Cabinet"
 * @param {string} input.extras - hand-written section for bundled tools and data
 * @param {Shipped[]} input.npm - JavaScript packages in the app's interface
 * @param {Shipped[]} input.crates - Rust packages compiled into the app
 * @returns {string} the file contents
 */
export function renderNotices({ product, extras, npm, crates }) {
  /**
   * A titled list of packages, sorted by name, each with its licence in a column.
   * @param {string} title - the list's heading
   * @param {Shipped[]} list - the packages
   * @returns {string} the list as text
   */
  const summary = (title, list) =>
    [title, "", ...[...list].sort(byName).map((p) => `  ${label(p).padEnd(48)} ${p.licence}`)].join(
      "\n",
    );
  const { groups, bare } = groupByText([...npm, ...crates]);

  const parts = [
    `${product} - third-party notices`,
    "",
    `${product} is made by To the Point Tech and includes the third-party software and data listed`,
    "below. Each is used under its own licence, reproduced or referenced here. Those licences apply",
    `to those components only; ${product} itself is covered by LICENSE.txt.`,
    "",
    "This list is generated when the app is built, so it matches this version exactly.",
    "",
    RULE,
    "Bundled tools and data",
    RULE,
    "",
    extras.trim(),
    "",
    RULE,
    "Packages",
    RULE,
    "",
    summary("JavaScript (the app's interface)", npm),
    "",
    summary("Rust (the app's engine)", crates),
    "",
    RULE,
    "Licence texts",
    RULE,
  ];
  for (const group of groups) {
    parts.push("", THIN, "Used by:", wrap(group.users.map(label), "  "), THIN, "", group.text);
  }
  if (bare.length > 0) {
    parts.push(
      "",
      THIN,
      "These packages ship no licence file. Each is used under the licence named, whose text is at",
      "https://spdx.org/licenses/ under that name.",
      THIN,
      "",
      ...bare.map((p) => `  ${label(p).padEnd(48)} ${p.licence}`),
    );
  }
  return `${parts.join("\n")}\n`;
}
