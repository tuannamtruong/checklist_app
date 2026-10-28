// P-4, P-6, P-7. What a picture is called and what taking one away means —
// requirements.md §4.6, past_decision.md §23.
//
// Names and plans only. The bytes are `app/pictures.svelte.ts`'s, so nothing
// here reads the folder or a clock: `now` is passed in like everywhere else.
//
// A picture nobody points at is flagged in its own name, `del_<day>_<name>`,
// rather than in anything a device remembers — so any device can finish the
// job, and a picture brought back by undo, T-13 or a conflict's losing value
// still draws until the day it is removed.

import { dayKey } from './agenda';
import { PICTURES } from './folder';
import { pictureNames } from './markup';
import type { NodeMap } from './types';

/** P-7. How long a picture nobody points at stays in the folder. */
export const KEEP_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** P-4. 128 bits: far past any number of pictures one person pastes. */
const HASH_DIGITS = 32;

const FLAGGED = /^pictures\/del_(\d{4}-\d{2}-\d{2})_(.+)$/;

/**
 * P-4. Named by its own bytes, so two devices that write one name write the
 * same file — the half of S-3 that is not a device id (past_decision.md §23.2).
 */
export function pictureName(digest: ArrayBuffer, extension: string): string {
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0'));
  return `${PICTURES}${hex.join('').slice(0, HASH_DIGITS)}.${extension}`;
}

const HASH_NAME = /^pictures\/([0-9a-f]{32})\.[a-z]+$/;

/**
 * P-5. Whether bytes are the picture their name says — false for one that
 * half-arrived. A name that is not a hash, a picture put in `pictures/` by
 * hand (past_decision.md §23.1, D), has nothing to be checked against.
 */
export function namedBy(name: string, digest: ArrayBuffer): boolean {
  const hash = HASH_NAME.exec(name)?.[1];
  return hash === undefined || pictureName(digest, '').startsWith(PICTURES + hash);
}

/** P-6. The name a picture is kept under once nothing points at it. */
export function flaggedName(name: string, day: string): string {
  return `${PICTURES}del_${day}_${name.slice(PICTURES.length)}`;
}

/** The day a flagged picture was flagged and the name it had, or null for any other name. */
export function flagged(name: string): { day: string; name: string } | null {
  const match = FLAGGED.exec(name);
  return match === null ? null : { day: match[1]!, name: PICTURES + match[2]! };
}

/** P-6. Where a mark's picture is kept now, if it was flagged — so it still draws. */
export function flaggedCopy(names: readonly string[], name: string): string | null {
  return names.find((candidate) => flagged(candidate)?.name === name) ?? null;
}

/**
 * Every picture a body points at, in every node the fold holds — archived and
 * deleted rows too, so a row T-13 restores comes back with its pictures.
 */
export function referencedPictures(nodes: NodeMap): Set<string> {
  const names = new Set<string>();
  for (const node of Object.values(nodes)) {
    for (const name of pictureNames(node.body ?? '')) names.add(name);
  }
  return names;
}

/**
 * P-6. What a commit took away: a picture the last body pointed at and no body
 * in the tree points at now. Only the device that dropped the mark asks, which
 * is what keeps a picture pasted elsewhere a moment ago out of it.
 */
export function droppedPictures(before: string, nodes: NodeMap): string[] {
  const referenced = referencedPictures(nodes);
  return pictureNames(before).filter((name) => !referenced.has(name) && flagged(name) === null);
}

export interface Tidy {
  /** A flagged picture to put back under the name a body points at again. */
  restore: [from: string, to: string][];
  remove: string[];
}

/**
 * P-7, on every cycle and on any device. A flagged picture a body points at
 * again goes back to its name — or is dropped, when the bytes are already
 * there under it — and one flagged more than `KEEP_DAYS` ago is removed. A
 * picture that was never flagged is never touched: a sweep would delete one a
 * peer pasted before its body arrived (past_decision.md §23.3).
 */
export function tidyPlan(names: readonly string[], nodes: NodeMap, now: number): Tidy {
  const referenced = referencedPictures(nodes);
  const present = new Set(names);
  const cutoff = dayKey(now - KEEP_DAYS * DAY_MS);
  const plan: Tidy = { restore: [], remove: [] };
  for (const name of names) {
    const was = flagged(name);
    if (was === null) continue;
    if (referenced.has(was.name)) {
      if (present.has(was.name)) {
        plan.remove.push(name);
      } else {
        plan.restore.push([name, was.name]);
        present.add(was.name);
      }
    } else if (was.day < cutoff) {
      plan.remove.push(name);
    }
  }
  return plan;
}
