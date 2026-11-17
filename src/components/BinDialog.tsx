import { useEffect, useState, type ReactElement } from "react";
import { api, type Tile } from "../lib/api";
import { binQuestion } from "../lib/binText";
import { Button, Dialog, DIALOG_BUTTONS } from "./ui";

/**
 * The question asked before photos go to the Recycle Bin, from the grid or the viewer. A single
 * photo with linked files names them once read, so a Live Photo video or RAW twin never goes
 * unseen. The Send button starts focused, so Enter answers yes, as in Windows' own question.
 * @param props - Component props.
 * @param props.tiles - the photos and videos about to go
 * @param props.busy - a job is running, so Send waits
 * @param props.onConfirm - send them to the Recycle Bin
 * @param props.onCancel - close and keep them
 * @returns the dialog
 */
export function BinDialog({
  tiles,
  busy,
  onConfirm,
  onCancel,
}: {
  tiles: Tile[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): ReactElement {
  const one = tiles.length === 1 && tiles[0].extra > 0 ? tiles[0].id : null;
  const [partners, setPartners] = useState<{ id: number; names: string[] } | null>(null);
  useEffect(() => {
    if (one === null) return;
    let live = true;
    api.mediaDetail(one).then(
      (detail) => {
        if (!live) return;
        const names = detail.members.filter((m) => m.id !== detail.id).map((m) => m.name);
        setPartners({ id: one, names });
      },
      // Without the names the question counts the linked files instead.
      () => {},
    );
    return () => {
      live = false;
    };
  }, [one]);

  return (
    <Dialog title="Recycle Bin" onCancel={onCancel}>
      <p className="mt-2 text-muted">
        {binQuestion(tiles, partners?.id === one ? partners.names : null)} You can undo this from
        History.
      </p>
      <div className={DIALOG_BUTTONS}>
        <Button variant="primary" data-autofocus onClick={onConfirm} busy={busy}>
          Send to the Recycle Bin
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}
