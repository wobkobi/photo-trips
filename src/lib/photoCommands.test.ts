import { describe, expect, it, vi } from "vitest";
import type { Tile, TripInfo } from "./api";
import type { KeyPress } from "./menu";
import {
  afterRemoval,
  matchCommand,
  menuItems,
  photoCommands,
  type CommandHandlers,
  type CommandTarget,
} from "./photoCommands";

const japan: TripInfo = {
  id: 1,
  name: "Japan",
  startAt: "2025-03-12T00:00:00",
  endAt: "2025-03-17T23:59:59",
  folder: "2025-03-12 Japan",
  colour: 1,
  files: 3,
  sample: [],
  excluded: [],
};

/**
 * A library tile for the tests.
 * @param id - its id
 * @param takenAt - when it was taken
 * @param more - fields to change
 * @returns the tile
 */
function tile(id: number, takenAt = "2025-03-14T10:00:00", more: Partial<Tile> = {}): Tile {
  return {
    id,
    takenAt,
    kind: "photo",
    ext: "jpg",
    name: `IMG_${id}.jpg`,
    uncertain: false,
    dateSet: false,
    extra: 0,
    live: false,
    rawTwin: false,
    linked: [],
    version: 0,
    trip: null,
    empty: false,
    ...more,
  };
}

/**
 * Every handler, each a spy.
 * @returns the handlers
 */
function allHandlers(): Required<CommandHandlers> {
  return {
    view: vi.fn(),
    open: vi.fn(),
    reveal: vi.fn(),
    copy: vi.fn(),
    copyPath: vi.fn(),
    setDate: vi.fn(),
    fileDate: vi.fn(),
    tripEdit: vi.fn(),
    makeTrip: vi.fn(),
    deselect: vi.fn(),
    bin: vi.fn(),
  };
}

/**
 * A target of one photo on its own.
 * @param photo - the photo
 * @returns the target
 */
const one = (photo: Tile): CommandTarget => ({ photo, photos: [photo], selection: false });

/**
 * A fake key press.
 * @param key - the key value, e.g. "c" or "Delete"
 * @param mods - modifier keys held down
 * @param mods.ctrl - Ctrl held
 * @param mods.shift - Shift held
 * @returns the key press
 */
const press = (key: string, mods: { ctrl?: boolean; shift?: boolean } = {}): KeyPress => ({
  key,
  code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
  ctrlKey: mods.ctrl ?? false,
  shiftKey: mods.shift ?? false,
  altKey: false,
  metaKey: false,
});

describe("photoCommands", () => {
  it("lists one photo's commands in groups, View first", () => {
    const commands = photoCommands(one(tile(1)), null, allHandlers());
    expect(commands.map((c) => c.id)).toEqual([
      "view",
      "open",
      "reveal",
      "copy",
      "copy-path",
      "set-date",
      "bin",
    ]);
    expect(commands.filter((c) => c.divided).map((c) => c.id)).toEqual(["set-date", "bin"]);
    expect(commands.find((c) => c.id === "bin")?.label).toBe("Send to the Recycle Bin");
  });

  it("counts the selection in its labels and acts on all of it", () => {
    const handlers = allHandlers();
    const photos = [tile(1), tile(2), tile(3)];
    const commands = photoCommands({ photo: photos[0], photos, selection: true }, null, handlers);
    const labels = new Map(commands.map((c) => [c.id, c.label]));
    expect(labels.get("set-date")).toBe("Set date for 3 items");
    expect(labels.get("bin")).toBe("Send 3 items to the Recycle Bin");
    expect(labels.get("deselect")).toBe("Deselect");
    commands.find((c) => c.id === "bin")?.run();
    expect(handlers.bin).toHaveBeenCalledWith(photos);
    commands.find((c) => c.id === "copy")?.run();
    expect(handlers.copy).toHaveBeenCalledWith(photos[0]);
  });

  it("disables one-photo commands when no one photo is meant", () => {
    const handlers = allHandlers();
    const photos = [tile(1), tile(2)];
    const commands = photoCommands({ photo: null, photos, selection: true }, null, handlers);
    const disabled = commands.filter((c) => c.disabled).map((c) => c.id);
    expect(disabled).toEqual(["view", "open", "reveal", "copy", "copy-path"]);
    commands.find((c) => c.id === "copy")?.run();
    expect(handlers.copy).not.toHaveBeenCalled();
  });

  it("disables the photo commands for an empty target", () => {
    const commands = photoCommands(
      { photo: null, photos: [], selection: true },
      null,
      allHandlers(),
    );
    expect(commands.filter((c) => !c.disabled).map((c) => c.id)).toEqual(["deselect"]);
  });

  it("leaves out commands the page has no handler for", () => {
    const { view, bin, deselect, ...rest } = allHandlers();
    void view;
    void bin;
    void deselect;
    const commands = photoCommands(
      { photo: tile(1), photos: [tile(1)], selection: true },
      null,
      rest,
    );
    expect(commands.map((c) => c.id)).not.toContain("view");
    expect(commands.map((c) => c.id)).not.toContain("bin");
    expect(commands.map((c) => c.id)).not.toContain("deselect");
    expect(commands[0].divided).toBeUndefined();
  });

  it("offers going back to the file's date only for photos with a date set", () => {
    const handlers = allHandlers();
    const set = tile(2, undefined, { dateSet: true });
    const photos = [tile(1), set];
    const commands = photoCommands({ photo: null, photos, selection: true }, null, handlers);
    commands.find((c) => c.id === "file-date")?.run();
    expect(handlers.fileDate).toHaveBeenCalledWith([set]);
    const plain = photoCommands(one(tile(1)), null, handlers);
    expect(plain.map((c) => c.id)).not.toContain("file-date");
  });

  it("adds trip changes as their own group only when given the trips", () => {
    const handlers = allHandlers();
    const photo = tile(1, "2025-03-20T10:00:00");
    const scope = { trips: [japan], tiles: [photo] };
    const commands = photoCommands(one(photo), scope, handlers);
    const add = commands.find((c) => c.id === "trip-add-1");
    expect(add?.label).toBe("Add to Japan");
    expect(add?.divided).toBe(true);
    expect(commands.find((c) => c.id === "make-trip")?.label).toBe("Make a trip from 1 photo");
    add?.run();
    expect(handlers.tripEdit).toHaveBeenCalledWith(expect.objectContaining({ kind: "add" }));
    const ids = photoCommands(one(photo), null, handlers).map((c) => c.id);
    expect(ids.some((id) => id.startsWith("trip-") || id === "make-trip")).toBe(false);
  });

  it("turns commands into menu entries", () => {
    const handlers = allHandlers();
    const [view] = menuItems(photoCommands(one(tile(1)), null, handlers));
    expect(view).toMatchObject({ id: "view", label: "View" });
    view.onSelect();
    expect(handlers.view).toHaveBeenCalled();
  });
});

describe("matchCommand", () => {
  const commands = photoCommands(one(tile(1)), null, allHandlers());

  it("matches Ctrl+C to Copy in either case", () => {
    expect(matchCommand(press("c", { ctrl: true }), commands)?.id).toBe("copy");
    expect(matchCommand(press("C", { ctrl: true }), commands)?.id).toBe("copy");
  });

  it("matches Delete to the Recycle Bin", () => {
    expect(matchCommand(press("Delete"), commands)?.id).toBe("bin");
  });

  it("needs the exact modifiers", () => {
    expect(matchCommand(press("c"), commands)).toBeNull();
    expect(matchCommand(press("c", { ctrl: true, shift: true }), commands)).toBeNull();
    expect(matchCommand(press("Delete", { ctrl: true }), commands)).toBeNull();
  });

  it("never matches a command that isn't on offer or is disabled", () => {
    const { bin, ...noBin } = allHandlers();
    void bin;
    const without = photoCommands(one(tile(1)), null, noBin);
    expect(matchCommand(press("Delete"), without)).toBeNull();
    const many = photoCommands(
      { photo: null, photos: [tile(1), tile(2)], selection: true },
      null,
      allHandlers(),
    );
    expect(matchCommand(press("c", { ctrl: true }), many)).toBeNull();
    expect(matchCommand(press("Delete"), many)?.id).toBe("bin");
  });
});

describe("afterRemoval", () => {
  const ids = [1, 2, 3, 4, 5];

  it("keeps the photo on show when it stays", () => {
    expect(afterRemoval(ids, new Set([2, 4]), 3)).toBe(3);
    expect(afterRemoval(ids, new Set([2]), null)).toBeNull();
  });

  it("moves to the next photo that stays", () => {
    expect(afterRemoval(ids, new Set([3]), 3)).toBe(4);
    expect(afterRemoval(ids, new Set([3, 4]), 3)).toBe(5);
  });

  it("falls back to the photo before at the end of the list", () => {
    expect(afterRemoval(ids, new Set([5]), 5)).toBe(4);
    expect(afterRemoval(ids, new Set([3, 4, 5]), 4)).toBe(2);
  });

  it("closes the viewer when nothing stays", () => {
    expect(afterRemoval(ids, new Set(ids), 2)).toBeNull();
    expect(afterRemoval([7], new Set([7]), 7)).toBeNull();
  });

  it("closes the viewer for a removed photo not in the list", () => {
    expect(afterRemoval(ids, new Set([9]), 9)).toBeNull();
  });
});
