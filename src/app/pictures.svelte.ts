// P-2 to P-7, the half that touches the folder and the browser —
// requirements.md §4.6. What a name means and what to do about one is
// `core/pictures.ts`; this file only carries the bytes.
//
// A picture never enters the op log. It is written once under a name that is
// its content, read when it is drawn, and renamed or removed by the rules
// `core/pictures.ts` plans — so nothing here can lose an op, and the worst a
// failure here costs is a picture drawn as missing (P-5).

import { dayKey } from '../core/agenda';
import { isPictureName, type FolderAdapter } from '../core/folder';
import {
  droppedPictures,
  flaggedCopy,
  flaggedName,
  namedBy,
  pictureName,
  tidyPlan,
} from '../core/pictures';
import type { NodeMap } from '../core/types';

/** P-3. A note needs a picture legible, not printable. */
const LONG_EDGE = 2048;
const QUALITY = 0.85;

export class Pictures {
  private readonly folder: FolderAdapter;
  private readonly onError: (error: unknown) => void;
  /** Pictures already drawn. A name is its content, so an entry never goes stale. */
  // ponytail: never revoked, so a session holds every picture it drew (~300 KB
  // each); revoke on note change if a long session ever runs short of memory.
  private readonly urls = new Map<string, string>();
  /** The pictures the last cycle listed, which is where a flagged copy is found. */
  private listed: readonly string[] = [];
  /** Bumped every cycle, so a picture drawn as missing is looked for again — P-5. */
  generation = $state(0);

  constructor(folder: FolderAdapter, onError: (error: unknown) => void) {
    this.folder = folder;
    this.onError = onError;
  }

  /** P-2 to P-4. Shrunk, named by its bytes, written once; the name is the mark's. */
  async add(file: Blob): Promise<string> {
    const shrunk = await shrink(file);
    const digest = await crypto.subtle.digest('SHA-256', await shrunk.arrayBuffer());
    const name = pictureName(digest, shrunk.type === 'image/webp' ? 'webp' : 'png');
    await this.folder.write(name, shrunk);
    this.urls.set(name, URL.createObjectURL(shrunk));
    return name;
  }

  /**
   * P-5, P-6. Something to draw, or null for the symbol: a file that is
   * missing, has not arrived, or does not hash to its name all draw the same.
   */
  async url(name: string): Promise<string | null> {
    const known = this.urls.get(name);
    if (known !== undefined) return known;
    const copy = flaggedCopy(this.listed, name);
    const content = (await this.blob(name)) ?? (copy === null ? null : await this.blob(copy));
    if (content === null) return null;
    if (!namedBy(name, await crypto.subtle.digest('SHA-256', await content.arrayBuffer()))) {
      return null;
    }
    const url = URL.createObjectURL(content);
    this.urls.set(name, url);
    return url;
  }

  /** P-6. After a body is committed: flag what it took away and nothing else points at. */
  async commit(before: string, nodes: NodeMap, now: number): Promise<void> {
    for (const name of droppedPictures(before, nodes)) {
      await this.move(name, flaggedName(name, dayKey(now)));
    }
  }

  /** P-7. After every cycle, over the names it listed. */
  async tidy(names: readonly string[], nodes: NodeMap, now: number): Promise<void> {
    this.listed = names.filter(isPictureName);
    const plan = tidyPlan(this.listed, nodes, now);
    for (const [from, to] of plan.restore) await this.move(from, to);
    for (const name of plan.remove) await this.attempt(() => this.folder.remove(name));
    this.generation++;
  }

  /**
   * A rename, which the adapter does not have: the new name is written before
   * the old one is removed, so a device that dies between the two leaves a
   * spare copy rather than none — past_decision.md §23.3.
   */
  private async move(from: string, to: string): Promise<void> {
    const content = await this.blob(from);
    if (content === null) return;
    await this.attempt(async () => {
      await this.folder.write(to, content);
      await this.folder.remove(from);
    });
  }

  private async blob(name: string): Promise<Blob | null> {
    try {
      const content = await this.folder.read(name);
      return content instanceof Blob ? content : null;
    } catch {
      // The provider's client holding the file, most likely: missing for one
      // cycle, which P-5 already draws — S-7's rule for a log, applied here.
      return null;
    }
  }

  private async attempt(run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.onError(error);
    }
  }
}

/** P-3. 2048 px on the long edge at most, as WebP — never enlarged. */
async function shrink(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, LONG_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(bitmap.width * scale)),
    Math.max(1, Math.round(bitmap.height * scale)),
  );
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.convertToBlob({ type: 'image/webp', quality: QUALITY });
}
