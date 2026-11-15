import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { PageId } from "../App";
import { Icon } from "../components/Icon";
import { PhotoPicker, PickBar } from "../components/PhotoPicker";
import {
  FolderJumpList,
  FolderList,
  LeftAlone,
  MovingProgress,
  ResultBanner,
} from "../components/PlanPreview";
import type { TileJump } from "../components/TimelineGrid";
import { Button, EmptyState, PageHeader } from "../components/ui";
import { useImportSource } from "../components/viewSources";
import {
  api,
  DEVICES_CHANGED,
  errorText,
  thumbUrl,
  type ApplySummary,
  type ImportDevice,
  type ImportPreview,
  type ImportSource,
  type Tile,
} from "../lib/api";
import { tileSizeOf } from "../lib/display";
import { count, formatBytes } from "../lib/format";
import { firstInFolder, importTiles, pickedFolders, pickTotals } from "../lib/picker";
import { useJobDone, useJobs } from "../lib/useJobs";
import { useSettings } from "../lib/useSettings";

const NONE_LEFT: ReadonlySet<number> = new Set();

/**
 * Bring photos in from a memory card, a phone or a folder. A check lists what's new first,
 * nothing comes in until the user says so, and the whole import can be undone.
 * @param props.onNavigate - switch to another page
 * @returns the page
 */
export function ImportPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { running } = useJobs();
  const [devices, setDevices] = useState<ImportDevice[] | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [moveFiles, setMoveFiles] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplySummary | null>(null);
  // Whether the import that ran last moved files in rather than copying them.
  const [movedIn, setMovedIn] = useState(false);
  // Items unticked on the review screen, for the preview they were unticked on.
  const [leftOut, setLeftOut] = useState<{ preview: number; items: ReadonlySet<number> } | null>(
    null,
  );
  const left = preview !== null && leftOut?.preview === preview.id ? leftOut.items : NONE_LEFT;
  const totals = useMemo(() => (preview ? pickTotals(preview.items, left) : null), [preview, left]);

  useEffect(() => {
    api.importSources().then(setDevices, (err) => setError(errorText(err)));
    api.importPreview().then(setPreview, (err) => setError(errorText(err)));
    const unlisten = listen<ImportDevice[]>(DEVICES_CHANGED, (event) => setDevices(event.payload));
    return () => {
      unlisten.then((off) => off());
    };
  }, []);

  useJobDone("import-scan", (done) => {
    if (done.ok) setPreview(done.result as ImportPreview);
    else if (done.error) setError(done.error);
  });
  useJobDone("import", (done) => {
    if (done.ok) setResult(done.result as ApplySummary);
    else if (done.error) setError(done.error);
    setPreview(null);
  });
  useJobDone("undo", () => setResult(null));

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorText(err));
    }
  }

  function check(source: ImportSource) {
    setResult(null);
    run(() => api.scanImport(source));
  }

  async function chooseFolder() {
    const picked = await open({
      directory: true,
      title: moveFiles
        ? "Choose a folder to move photos in from"
        : "Choose a folder to copy photos from",
    });
    if (typeof picked === "string") check({ kind: "folder", path: picked, moveFiles });
  }

  function bringIn(ready: ImportPreview) {
    setMovedIn(ready.moving);
    run(() => api.applyImport(ready.id, [...left]));
  }

  function otherSources() {
    if (preview) api.discardImport(preview.id).catch(() => undefined);
    setPreview(null);
    setError(null);
  }

  const busy = running !== null;
  const working =
    running?.kind === "import-scan" || running?.kind === "import" || running?.kind === "undo";
  const ready = preview !== null && preview.files > 0 && !working;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Import"
        detail="Bring in photos from a memory card, a phone or a folder. Anything already in your library stays out."
        actions={
          ready && (
            <>
              <Button variant="ghost" onClick={otherSources}>
                <Icon name="back" size={16} />
                Other sources
              </Button>
              <Button onClick={() => check(preview.spec)} disabled={busy}>
                <Icon name="refresh" size={16} />
                Check again
              </Button>
              <Button
                variant="primary"
                onClick={() => bringIn(preview)}
                disabled={busy || totals === null || totals.items === 0}
              >
                {preview.moving ? "Move" : "Copy"} {count(totals?.files ?? 0, "file", "files")} in
              </Button>
            </>
          )
        }
      />
      {error && (
        <p role="alert" className="mx-8 mt-4 text-danger">
          {error}
        </p>
      )}
      {result && !working && (
        <ResultBanner
          result={result}
          verb={movedIn ? "moved" : "copied"}
          destination="your library"
          busy={busy}
          onUndo={() => run(() => api.undoBatch(result.batchId))}
          onHistory={() => onNavigate("history")}
        />
      )}

      {working && running && <MovingProgress job={running} />}
      {!working && preview !== null && preview.files === 0 && (
        <NothingNew
          preview={preview}
          busy={busy}
          onCheck={() => check(preview.spec)}
          onBack={otherSources}
        />
      )}
      {ready && (
        <IncomingView
          preview={preview}
          left={left}
          onLeftChange={(items) => setLeftOut({ preview: preview.id, items })}
        />
      )}
      {!working && preview === null && (
        <Sources
          devices={devices}
          moveFiles={moveFiles}
          busy={busy}
          onMoveFiles={setMoveFiles}
          onCheck={check}
          onChooseFolder={chooseFolder}
        />
      )}
    </div>
  );
}

/**
 * A plugged-in card or phone as something to check.
 * @param device - the card or phone
 * @returns the source to look through
 */
function sourceOf(device: ImportDevice): ImportSource {
  return device.kind === "phone"
    ? { kind: "phone", id: device.id, name: device.name }
    : { kind: "drive", path: device.id, name: device.name };
}

function Sources({
  devices,
  moveFiles,
  busy,
  onMoveFiles,
  onCheck,
  onChooseFolder,
}: {
  devices: ImportDevice[] | null;
  moveFiles: boolean;
  busy: boolean;
  onMoveFiles: (move: boolean) => void;
  onCheck: (source: ImportSource) => void;
  onChooseFolder: () => void;
}) {
  return (
    <div className="flex max-w-3xl flex-col gap-10 px-8 py-7">
      <section aria-labelledby="import-devices">
        <h2
          id="import-devices"
          className="text-[24px] leading-none font-bold tracking-tight text-brand"
        >
          Memory cards and phones
        </h2>
        {devices !== null && devices.length === 0 && (
          <p className="mt-3 text-muted">
            None plugged in. Put in a memory card, or connect a phone with its cable and unlock it,
            and it shows up here.
          </p>
        )}
        {devices !== null && devices.length > 0 && (
          <ul className="mt-4 flex flex-col divide-y divide-line rounded-md border border-line bg-surface">
            {devices.map((device) => (
              <li key={device.id} className="flex items-center gap-3 px-4 py-3">
                <Icon name={device.kind === "phone" ? "phone" : "card"} className="text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{device.name}</span>
                  <span className="block text-[14px] text-muted">
                    {device.kind === "phone" ? "Phone or camera" : "Memory card"}
                  </span>
                </span>
                <Button variant="primary" onClick={() => onCheck(sourceOf(device))} disabled={busy}>
                  Check for new photos
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[15px] text-faint">
          Nothing on a card or phone is ever changed or removed. A phone&apos;s photos are read onto
          this PC to compare them, so the first check of a phone takes a while.
        </p>
      </section>

      <section aria-labelledby="import-folder">
        <h2
          id="import-folder"
          className="text-[24px] leading-none font-bold tracking-tight text-brand"
        >
          A folder on this PC
        </h2>
        <p className="mt-3 text-muted">
          An old backup, a download from the cloud, or photos someone sent you.
        </p>
        <fieldset className="mt-4 grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">What happens to the folder</legend>
          <Choice
            checked={!moveFiles}
            title="Copy the photos in"
            detail="The folder stays as it is."
            onSelect={() => onMoveFiles(false)}
          />
          <Choice
            checked={moveFiles}
            title="Move the photos in"
            detail="New photos leave the folder. Copies of photos you already have stay behind."
            onSelect={() => onMoveFiles(true)}
          />
        </fieldset>
        <Button className="mt-4" onClick={onChooseFolder} disabled={busy}>
          <Icon name="folder" size={16} />
          Choose folder
        </Button>
      </section>
    </div>
  );
}

/**
 * One option of a radio group, drawn as a card.
 * @param props.checked - this option is chosen
 * @param props.title - the option
 * @param props.detail - what it means
 * @param props.onSelect - choose this option
 * @returns the option
 */
function Choice({
  checked,
  title,
  detail,
  onSelect,
}: {
  checked: boolean;
  title: string;
  detail: string;
  onSelect: () => void;
}) {
  return (
    <label
      className={`flex cursor-pointer gap-3 rounded-md border p-3.5 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent ${
        checked ? "border-accent bg-accent/10" : "border-line bg-surface hover:bg-raised/60"
      }`}
    >
      <input
        type="radio"
        name="folder-mode"
        checked={checked}
        onChange={onSelect}
        className="mt-1 accent-accent"
      />
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="mt-0.5 block text-[15px] text-muted">{detail}</span>
      </span>
    </label>
  );
}

/**
 * What a check found: the headline, notes, and every incoming photo with a tick, so photos
 * can be left out before anything comes in.
 * @param props.preview - the checked import
 * @param props.left - indexes of the items unticked
 * @param props.onLeftChange - called with the new unticked indexes
 * @returns the review view, filling the remaining height
 */
function IncomingView({
  preview,
  left,
  onLeftChange,
}: {
  preview: ImportPreview;
  left: ReadonlySet<number>;
  onLeftChange: (left: ReadonlySet<number>) => void;
}) {
  const { settings } = useSettings();
  const tiles = useMemo(() => importTiles(preview.items), [preview.items]);
  const order = useMemo(() => tiles.map((t) => t.id), [tiles]);
  const source = useImportSource(preview, order);
  const folders = useMemo(() => pickedFolders(preview.items, left), [preview.items, left]);
  const totals = pickTotals(preview.items, left);
  const thumbOf = (tile: Tile) => thumbUrl(preview.items[tile.id].thumb, tile.version);
  const [jump, setJump] = useState<TileJump | null>(null);
  function openFolder(folder: string) {
    const index = firstInFolder(preview.items, tiles, folder, left);
    if (index >= 0) setJump({ index });
  }
  const where = preview.moving
    ? "in the folder"
    : `${preview.spec.kind === "folder" ? "in" : "on"} ${preview.source}`;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section className="px-8 pt-6 pb-5">
        <p className="text-[30px] leading-none font-extrabold tracking-tight text-brand">
          {count(preview.files, "new file", "new files")} from {preview.source}
        </p>
        {preview.spec.kind === "folder" && (
          <p className="mt-2 truncate text-[15px] text-faint" title={preview.spec.path}>
            {preview.spec.path}
          </p>
        )}
        <div className="mt-3 flex max-w-3xl flex-col gap-1 text-muted">
          <p>
            {formatBytes(preview.bytes)} into {count(preview.folders.length, "folder", "folders")}:
            each photo goes in its trip&apos;s folder, or the folder for the month it was taken.
          </p>
          {preview.already > 0 && (
            <p>
              {count(preview.already, "file is", "files are")} already in your library (
              {formatBytes(preview.alreadyBytes)}) and {preview.already === 1 ? "stays" : "stay"}{" "}
              out.
            </p>
          )}
          {preview.renamed > 0 && (
            <p>
              {count(preview.renamed, "photo gets", "photos get")} a number added to the name, like
              IMG_1 (1).jpg, because a different file with that name is already there.
            </p>
          )}
          {preview.leftAlone > 0 && <LeftAlone files={preview.leftAlone} />}
          {preview.otherFiles > 0 && (
            <p>
              {count(
                preview.otherFiles,
                "file isn't a photo or video and is",
                "files aren't photos or videos and are",
              )}{" "}
              left out.
            </p>
          )}
          <p>
            {preview.moving
              ? "The new photos move out of the folder."
              : `Nothing ${preview.spec.kind === "folder" ? "in" : "on"} ${preview.source} changes.`}{" "}
            No file in your library is ever replaced, and the whole import can be undone from
            History.
          </p>
        </div>
      </section>
      <PickBar
        ticked={totals.items}
        total={preview.items.length}
        extra={<span className="text-muted">({formatBytes(totals.bytes)})</span>}
        hint={<>Untick any you don&apos;t want. They stay {where} and show up again next time.</>}
        onAll={(pick) => onLeftChange(pick ? new Set() : new Set(tiles.map((t) => t.id)))}
      />
      <FolderJumpList folders={folders} onOpen={openFolder} />
      <div className="flex min-h-0 flex-1 border-t border-line">
        <FolderList folders={folders} onOpen={openFolder} />
        <PhotoPicker
          tiles={tiles}
          left={left}
          onChange={onLeftChange}
          tileSize={tileSizeOf(settings)}
          thumbOf={thumbOf}
          source={source}
          tickLabel="Bring this one in"
          jump={jump}
        />
      </div>
    </div>
  );
}

function NothingNew({
  preview,
  busy,
  onCheck,
  onBack,
}: {
  preview: ImportPreview;
  busy: boolean;
  onCheck: () => void;
  onBack: () => void;
}) {
  const where = preview.spec.kind === "folder" ? "in" : "on";
  return (
    <EmptyState title={`Nothing new ${where} ${preview.source}`}>
      <p>
        {preview.already === 0
          ? "There are no photos or videos there."
          : preview.already === 1
            ? "The one photo there is already in your library."
            : `All ${count(preview.already, "file", "photos and videos")} there are already in your library.`}
      </p>
      {preview.leftAlone > 0 && <LeftAlone files={preview.leftAlone} />}
      <div className="flex justify-center gap-2">
        <Button onClick={onBack}>
          <Icon name="back" size={16} />
          Other sources
        </Button>
        <Button onClick={onCheck} disabled={busy}>
          <Icon name="refresh" size={16} />
          Check again
        </Button>
      </div>
    </EmptyState>
  );
}
