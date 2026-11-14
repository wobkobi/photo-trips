// Release notes as the release script writes them: changelog groups ("### Fixed") of bullets.

/** One changelog group, like Added or Fixed. */
export interface NoteGroup {
  /** Null for bullets before any heading. */
  heading: string | null;
  items: string[];
}

/**
 * Split release notes into groups of items. Lines indented under a bullet continue it, and a
 * line that is neither a heading nor a bullet becomes an item of its own.
 * @param notes - the notes markdown
 * @returns the groups in order, without empty ones
 */
export function parseReleaseNotes(notes: string): NoteGroup[] {
  const groups: NoteGroup[] = [];
  let group: NoteGroup = { heading: null, items: [] };
  let continues = false;
  for (const raw of notes.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      continues = false;
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line)?.[1];
    if (heading !== undefined) {
      groups.push(group);
      group = { heading, items: [] };
      continues = false;
    } else if (/^[-*]\s+/.test(line)) {
      group.items.push(line.replace(/^[-*]\s+/, ""));
      continues = true;
    } else if (continues && /^\s/.test(raw) && group.items.length > 0) {
      group.items[group.items.length - 1] += ` ${line}`;
    } else {
      group.items.push(line);
      continues = false;
    }
  }
  groups.push(group);
  return groups.filter((g) => g.items.length > 0);
}
