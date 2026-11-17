// The things that can be done to photos, as one list that the right-click menu draws and the key
// handlers match shortcuts against, so a menu item and its key always do the same thing. A
// command is only in the list when the page hands over a handler for it, so a page without a
// Recycle Bin handler never answers Delete.

import type { MenuItem } from "../components/TileMenu";
import type { Tile, TripInfo } from "./api";
import { count } from "./format";
import { isTextEntry, keyCombo, type KeyPress } from "./menu";
import { addEdit, editLabel, nearestTrips, pickedEdits, type TripEdit } from "./tripEdits";

/** How many nearby trips the menus offer to add photos to. */
export const ADD_CHOICES = 4;

/** One thing to do to the target photos, for a menu item and its key. */
export interface PhotoCommand {
  /** Stable name, e.g. "copy" or "trip-remove-3". */
  id: string;
  label: string;
  /** The keys that run it, as written beside it in a menu, e.g. "Ctrl+C". */
  shortcut?: string;
  /** Shown but not runnable, as when a one-photo command has no single photo to act on. */
  disabled?: boolean;
  /** Starts a new group, drawn with a line above it in a menu. */
  divided?: boolean;
  run: () => void;
}

/** The photos a command acts on. */
export interface CommandTarget {
  /**
   * The one photo for commands that take one: the right-clicked, focused or open photo. Null
   * when several are selected and none was pointed at, which disables those commands.
   */
  photo: Tile | null;
  /** The photos for commands that take several: the selection, or just the photo. */
  photos: Tile[];
  /** Whether the photos are the selection rather than one photo on its own, offering Deselect. */
  selection: boolean;
}

/** What the trip changes are worked out from; leave it out to offer none. */
export interface TripScope {
  trips: TripInfo[];
  /** Every photo in the library, unfiltered. */
  tiles: Tile[];
}

/**
 * What the page does for each command. A command whose handler is missing is left out of the
 * list, so its menu item and its shortcut both go.
 */
export interface CommandHandlers {
  view?: (photo: Tile) => void;
  open?: (photo: Tile) => void;
  reveal?: (photo: Tile) => void;
  copy?: (photo: Tile) => void;
  copyPath?: (photo: Tile) => void;
  setDate?: (photos: Tile[]) => void;
  fileDate?: (photos: Tile[]) => void;
  tripEdit?: (edit: TripEdit) => void;
  makeTrip?: (photos: Tile[]) => void;
  deselect?: () => void;
  bin?: (photos: Tile[]) => void;
}

/** The run of a command that can't run. */
function nothing(): void {}

/**
 * A command that acts on the target's one photo, disabled when there isn't one.
 * @param id - the command's id
 * @param label - its label
 * @param photo - the target's one photo, or null
 * @param handler - what it does, or undefined to leave it out
 * @param shortcut - its keys, if any
 * @returns the command, or null when there's no handler
 */
function onePhoto(
  id: string,
  label: string,
  photo: Tile | null,
  handler: ((photo: Tile) => void) | undefined,
  shortcut?: string,
): PhotoCommand | null {
  if (!handler) return null;
  return {
    id,
    label,
    shortcut,
    disabled: photo === null,
    run: photo ? handler.bind(null, photo) : nothing,
  };
}

/**
 * The trip changes the photos allow: out of or back into the trips they're in, into a trip
 * nearby, or a new trip from those on none.
 * @param photos - the target photos
 * @param scope - the trips and every photo
 * @param handlers - the page's handlers
 * @returns the commands, in menu order
 */
function tripCommands(photos: Tile[], scope: TripScope, handlers: CommandHandlers): PhotoCommand[] {
  const found = pickedEdits(photos, scope.trips, scope.tiles);
  const commands: PhotoCommand[] = [];
  const { tripEdit, makeTrip } = handlers;
  if (tripEdit) {
    const adds = nearestTrips(found.free, scope.trips, ADD_CHOICES).map((trip) =>
      addEdit(trip, found.free, scope.tiles),
    );
    for (const edit of [...found.remove, ...found.putBack, ...adds]) {
      commands.push({
        id: `trip-${edit.kind}-${edit.trip.id}`,
        label: editLabel(edit),
        run: tripEdit.bind(null, edit),
      });
    }
  }
  if (makeTrip && found.free.length > 0) {
    commands.push({
      id: "make-trip",
      label: `Make a trip from ${count(found.free.length, "photo", "photos")}`,
      run: makeTrip.bind(null, found.free),
    });
  }
  return commands;
}

/**
 * Every command for some photos, in menu order and grouped: the file's own actions, its date,
 * its trips, then the Recycle Bin. Labels count the photos when there are several.
 * @param target - the photos to act on
 * @param trips - what trip changes are worked out from, or null to offer none (as for a key
 *   press, which never needs them)
 * @param handlers - what the page does for each command; missing ones are left out
 * @returns the commands, the first of each group after the first marked divided
 */
export function photoCommands(
  target: CommandTarget,
  trips: TripScope | null,
  handlers: CommandHandlers,
): PhotoCommand[] {
  const { photo, photos } = target;
  const many = photos.length > 1;
  const none = photos.length === 0;
  const { setDate, fileDate, deselect, bin } = handlers;

  const file = [
    onePhoto("view", "View", photo, handlers.view),
    onePhoto("open", "Open", photo, handlers.open),
    onePhoto("reveal", "Show in folder", photo, handlers.reveal),
    onePhoto("copy", "Copy", photo, handlers.copy, "Ctrl+C"),
    onePhoto("copy-path", "Copy path", photo, handlers.copyPath),
  ];

  const date: (PhotoCommand | null)[] = [];
  if (setDate) {
    date.push({
      id: "set-date",
      label: many ? `Set date for ${count(photos.length, "item", "items")}` : "Set date",
      disabled: none,
      run: setDate.bind(null, photos),
    });
  }
  // Only photos with a date set in Pic Cabinet have a file's date to go back to.
  const dateSet = photos.filter((t) => t.dateSet);
  if (fileDate && dateSet.length > 0) {
    date.push({
      id: "file-date",
      label: "Use the file's date",
      run: fileDate.bind(null, dateSet),
    });
  }

  const trip: (PhotoCommand | null)[] = trips ? tripCommands(photos, trips, handlers) : [];
  if (deselect && target.selection) {
    trip.push({ id: "deselect", label: "Deselect", run: deselect });
  }

  const recycle: (PhotoCommand | null)[] = [];
  if (bin) {
    recycle.push({
      id: "bin",
      label: many
        ? `Send ${count(photos.length, "item", "items")} to the Recycle Bin`
        : "Send to the Recycle Bin",
      shortcut: "Delete",
      disabled: none,
      run: bin.bind(null, photos),
    });
  }

  const commands: PhotoCommand[] = [];
  for (const group of [file, date, trip, recycle]) {
    const present = group.filter((c): c is PhotoCommand => c !== null);
    if (present.length === 0) continue;
    if (commands.length > 0) present[0] = { ...present[0], divided: true };
    commands.push(...present);
  }
  return commands;
}

/**
 * Commands as right-click menu entries, keeping their order, groups and shortcut hints.
 * @param commands - the commands
 * @returns the menu entries
 */
export function menuItems(commands: PhotoCommand[]): MenuItem[] {
  return commands.map(({ run, ...rest }) => ({ ...rest, onSelect: run }));
}

/**
 * The command a key press runs, matched by the keys written in its shortcut. Letters go by
 * the character and digits by the physical key, as for the menu bar's shortcuts.
 * @param event - the keydown
 * @param commands - the commands on offer
 * @returns the first enabled command with those keys, or null
 */
export function matchCommand(event: KeyPress, commands: PhotoCommand[]): PhotoCommand | null {
  const combo = keyCombo(event);
  if (combo === null) return null;
  return commands.find((c) => c.shortcut === combo && !c.disabled) ?? null;
}

/**
 * The command a key press in the page runs, leaving the keys alone where they mean something
 * else: typing in a box, a held-down repeat, or Ctrl+C over selected text (as in the viewer's
 * details panel), which the browser copies. A dialog on screen is for the caller to check.
 * @param event - the keydown
 * @param commands - the commands on offer
 * @returns the command to run, or null to let the key through
 */
export function keyCommand(event: KeyboardEvent, commands: PhotoCommand[]): PhotoCommand | null {
  if (event.repeat || isTextEntry(event.target)) return null;
  const command = matchCommand(event, commands);
  if (command?.shortcut === "Ctrl+C" && textSelected()) return null;
  return command;
}

/**
 * Whether the page has text selected, so Ctrl+C belongs to it.
 * @returns true for a non-empty selection
 */
function textSelected(): boolean {
  const selection = window.getSelection();
  return selection !== null && !selection.isCollapsed && selection.toString().trim() !== "";
}
