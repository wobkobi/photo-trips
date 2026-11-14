import { describe, expect, it } from "vitest";
import { LICENCE_FILE, groupByText, renderNotices, shippedCrates } from "./notices-lib.mjs";

/**
 * A package as `cargo metadata` lists it.
 * @param {string} name - package name, also used as its id
 * @param {string} [kind] - target kind, e.g. "proc-macro"
 * @returns {object} the package
 */
const pkg = (name, kind = "lib") => ({ id: name, name, targets: [{ kind: [kind] }] });

/**
 * A dependency edge as `cargo metadata` resolves it.
 * @param {string} name - dependency's package id
 * @param {(string | null)[]} kinds - dependency kinds; null is a normal dependency
 * @returns {object} the edge
 */
const dep = (name, kinds = [null]) => ({ pkg: name, dep_kinds: kinds.map((kind) => ({ kind })) });

describe("shippedCrates", () => {
  it("keeps normal dependencies and drops dev, build and proc-macro ones", () => {
    const metadata = {
      packages: [
        pkg("app"),
        pkg("serde"),
        pkg("serde_derive", "proc-macro"),
        pkg("syn"),
        pkg("tempfile"),
        pkg("cc"),
        pkg("itoa"),
      ],
      resolve: {
        root: "app",
        nodes: [
          {
            id: "app",
            deps: [dep("serde"), dep("tempfile", ["dev"]), dep("cc", ["build"])],
          },
          { id: "serde", deps: [dep("serde_derive"), dep("itoa")] },
          { id: "serde_derive", deps: [dep("syn")] },
        ],
      },
    };
    expect(shippedCrates(metadata).map((p) => p.name)).toEqual(["serde", "itoa"]);
  });

  it("keeps a dependency that's both a build and a normal one", () => {
    const metadata = {
      packages: [pkg("app"), pkg("windows")],
      resolve: { root: "app", nodes: [{ id: "app", deps: [dep("windows", ["build", null])] }] },
    };
    expect(shippedCrates(metadata).map((p) => p.name)).toEqual(["windows"]);
  });
});

describe("LICENCE_FILE", () => {
  it("matches the usual licence file names", () => {
    for (const name of [
      "LICENSE",
      "LICENCE.md",
      "LICENSE-APACHE",
      "license-mit",
      "COPYING",
      "NOTICE",
      "UNLICENSE",
    ]) {
      expect(LICENCE_FILE.test(name)).toBe(true);
    }
    for (const name of ["README.md", "Cargo.toml", "src"]) {
      expect(LICENCE_FILE.test(name)).toBe(false);
    }
  });
});

describe("groupByText", () => {
  it("prints a text once for every package that ships it, ignoring line endings", () => {
    const { groups, bare } = groupByText([
      { name: "b", version: "1.0.0", licence: "MIT", texts: ["MIT text\r\n"] },
      { name: "a", version: "2.0.0", licence: "MIT", texts: ["MIT text  \n"] },
      { name: "c", version: "1.0.0", licence: "MIT", texts: [] },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].text).toBe("MIT text");
    expect(groups[0].users.map((u) => u.name)).toEqual(["a", "b"]);
    expect(bare.map((p) => p.name)).toEqual(["c"]);
  });
});

describe("renderNotices", () => {
  it("lists packages, then each licence text with who uses it", () => {
    const text = renderNotices({
      product: "Pic Cabinet",
      extras: "ExifTool",
      npm: [{ name: "react", version: "19.0.0", licence: "MIT", texts: ["MIT text"] }],
      crates: [{ name: "serde", version: "1.0.0", licence: "MIT OR Apache-2.0", texts: [] }],
    });
    expect(text).toMatch(/^Pic Cabinet - third-party notices\n/);
    expect(text).toContain("ExifTool");
    expect(text).toMatch(/ {2}react 19\.0\.0 +MIT\n/);
    expect(text).toContain("Used by:\n  react 19.0.0\n");
    expect(text).toMatch(/ship no licence file[\s\S]*serde 1\.0\.0 +MIT OR Apache-2\.0\n$/);
  });
});
