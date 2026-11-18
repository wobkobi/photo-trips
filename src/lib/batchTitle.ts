import type { BatchInfo } from "./api";

/** Past-tense opening verbs of batch labels, and the plain form for a batch that did nothing. */
const UNDONE_VERB: Record<string, string> = {
  Moved: "Move",
  Copied: "Copy",
  Changed: "Change",
  Created: "Create",
  Deleted: "Delete",
  Renamed: "Rename",
};

/**
 * A batch's title. Labels are written in the past tense when the batch starts, so one that
 * stopped or failed before touching a file is retitled as what it set out to do ("Move 4
 * duplicate copies…") rather than claiming it happened.
 * @param batch - the batch
 * @returns the title
 */
export function titleText(batch: BatchInfo): string {
  const stopped = ["interrupted", "cancelled", "failed"].includes(batch.status);
  if (!stopped || batch.done > 0) return batch.label;
  const space = batch.label.indexOf(" ");
  const plain = UNDONE_VERB[batch.label.slice(0, space)];
  return plain && space > 0 ? plain + batch.label.slice(space) : batch.label;
}
