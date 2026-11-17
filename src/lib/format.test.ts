import { describe, expect, it } from "vitest";
import type { Tile } from "./api";
import {
  clockTime,
  count,
  dateNote,
  folderName,
  formatBytes,
  formatTaken,
  jumpRow,
  libraryFolder,
  monthLabel,
  parseTaken,
  splitPath,
  stepTile,
  timelineRows,
} from "./format";

/**
 * A plain photo tile.
 * @param id - media id
 * @param takenAt - when it was taken
 * @returns the tile
 */
function tile(id: number, takenAt: string): Tile {
  return {
    id,
    takenAt,
    kind: "photo",
    ext: "jpg",
    name: `IMG_${id}.jpg`,
    uncertain: false,
    dateSet: false,
    extra: 0,
    version: 0,
    trip: null,
  };
}

describe("dates", () => {
  it("parses wall-clock time without shifting it", () => {
    const d = parseTaken("2024-07-15T09:30:05");
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      2024, 6, 15, 9, 30,
    ]);
  });

  it("labels months and full dates in NZ English", () => {
    expect(monthLabel("2024-07")).toBe("July 2024");
    expect(formatTaken("2024-07-15T09:30:00")).toMatch(/^Monday 15 July 2024 at 9:30\s?am$/i);
  });
});

describe("formatBytes", () => {
  it("uses decimal units with one decimal under 100", () => {
    expect(formatBytes(512)).toBe("512 bytes");
    expect(formatBytes(4_200_000)).toBe("4.2 MB");
    expect(formatBytes(250_000_000)).toBe("250 MB");
  });
});

describe("timelineRows", () => {
  it("starts each month with a heading and wraps tiles into rows", () => {
    const tiles = [
      tile(1, "2024-08-02T10:00:00"),
      tile(2, "2024-07-30T10:00:00"),
      tile(3, "2024-07-20T10:00:00"),
      tile(4, "2024-07-01T10:00:00"),
    ];
    const rows = timelineRows(tiles, 2);
    expect(rows.map((r) => (r.type === "month" ? r.label : `${r.start}-${r.end}`))).toEqual([
      "August 2024",
      "0-1",
      "July 2024",
      "1-3",
      "3-4",
    ]);
    expect(rows[2]).toMatchObject({ type: "month", count: 3, start: 1, end: 4 });
  });

  it("jumps to a month's heading for its first row, and to the row itself after that", () => {
    const tiles = [
      tile(1, "2024-08-02T10:00:00"),
      tile(2, "2024-07-30T10:00:00"),
      tile(3, "2024-07-20T10:00:00"),
      tile(4, "2024-07-01T10:00:00"),
    ];
    // August heading, 0-1, July heading, 1-3, 3-4
    const rows = timelineRows(tiles, 2);
    expect(jumpRow(rows, 0)).toBe(0);
    expect(jumpRow(rows, 2)).toBe(2);
    expect(jumpRow(rows, 3)).toBe(4);
    expect(jumpRow(rows, 9)).toBe(-1);
  });

  it("moves focus through the grid by arrow key, keeping the column across a month break", () => {
    const tiles = [
      tile(1, "2024-08-03T10:00:00"),
      tile(2, "2024-08-02T10:00:00"),
      tile(3, "2024-08-01T10:00:00"),
      tile(4, "2024-07-30T10:00:00"),
      tile(5, "2024-07-20T10:00:00"),
    ];
    // August heading, 0-2, 2-3, July heading, 3-5
    const rows = timelineRows(tiles, 2);
    expect(stepTile(rows, 1, "ArrowDown", 5)).toBe(2);
    expect(stepTile(rows, 2, "ArrowDown", 5)).toBe(3);
    expect(stepTile(rows, 4, "ArrowUp", 5)).toBe(2);
    expect(stepTile(rows, 1, "ArrowUp", 5)).toBeNull();
    expect(stepTile(rows, 2, "ArrowRight", 5)).toBe(3);
    expect(stepTile(rows, 0, "ArrowLeft", 5)).toBeNull();
    expect(stepTile(rows, 3, "End", 5)).toBe(4);
    expect(stepTile(rows, 3, "Home", 5)).toBe(0);
    expect(stepTile(rows, 3, "Enter", 5)).toBeNull();
  });

  it("returns nothing for an empty library", () => {
    expect(timelineRows([], 4)).toEqual([]);
  });
});

describe("text helpers", () => {
  it("pairs counts with the right noun", () => {
    expect(count(1, "file", "files")).toBe("1 file");
    expect(count(0, "file", "files")).toBe("0 files");
    expect(count(1204, "file", "files")).toBe("1,204 files");
  });

  it("splits Windows paths into folder and name", () => {
    expect(splitPath(String.raw`2025\2025-03\IMG_1.HEIC`)).toEqual({
      folder: String.raw`2025\2025-03`,
      name: "IMG_1.HEIC",
    });
    expect(splitPath("IMG_1.HEIC")).toEqual({ folder: "", name: "IMG_1.HEIC" });
  });
});

describe("folderName", () => {
  it("gives the last folder of a path", () => {
    expect(folderName("C:\\Users\\Me\\Pictures\\Photos")).toBe("Photos");
    expect(folderName("C:\\Users\\Me\\Photos\\")).toBe("Photos");
    expect(folderName("\\\\nas\\family")).toBe("family");
  });

  it("keeps a whole drive as it is", () => {
    expect(folderName("D:\\")).toBe("D:\\");
    expect(folderName("D:")).toBe("D:");
  });
});

describe("libraryFolder", () => {
  const root = String.raw`C:\Users\Me\Pictures\Library`;

  it("reads from the library folder", () => {
    expect(libraryFolder(String.raw`C:\Users\Me\Pictures\Library\2025\2025-03`, root)).toBe(
      String.raw`2025\2025-03`,
    );
    expect(libraryFolder(String.raw`c:\users\me\pictures\library\Camera`, `${root}\\`)).toBe(
      "Camera",
    );
  });

  it("names the library folder itself", () => {
    expect(libraryFolder(root, root)).toBe("Library folder");
  });

  it("keeps a folder outside the library, or a near-miss name, whole", () => {
    expect(libraryFolder(String.raw`D:\Photos`, root)).toBe(String.raw`D:\Photos`);
    expect(libraryFolder(String.raw`C:\Users\Me\Pictures\Library2\x`, root)).toBe(
      String.raw`C:\Users\Me\Pictures\Library2\x`,
    );
    expect(libraryFolder("anything", null)).toBe("anything");
  });
});

describe("dateNote", () => {
  it("notes only dates that aren't the file's own record", () => {
    expect(dateNote("set")).toBe("Set in Pic Cabinet");
    expect(dateNote("exif")).toBeNull();
    expect(dateNote("video")).toBeNull();
    expect(dateNote("filename")).toBe("From the file name");
    expect(dateNote("modified")).toBe("When the file last changed");
  });
});

describe("clockTime", () => {
  it("reads like a player clock", () => {
    expect(clockTime(7.9)).toBe("0:07");
    expect(clockTime(754)).toBe("12:34");
    expect(clockTime(3723)).toBe("1:02:03");
  });

  it("shows zero for a time not known yet", () => {
    expect(clockTime(NaN)).toBe("0:00");
    expect(clockTime(Infinity)).toBe("0:00");
  });
});
