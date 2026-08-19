// The on-disk encoding of a device file: JSON Lines, a header line carrying the
// full vector, then one op per line — S-15, sync-flow.md §4.2.
//
// The op line does not repeat the device id or the whole vector. The device is
// the header's, and every intermediate vector is reconstructible by replaying
// forward, so carrying either per line would cost bytes and buy nothing.
//
// The adapter has no append and never will — architecture.md §4 fixes it at
// three methods — so a write is always the whole file, and this module is the
// only thing that spells one.

import { cleanTags } from './tags';
import {
  KINDS,
  PRIORITIES,
  type DeviceId,
  type Kind,
  type Op,
  type Priority,
  type SClock,
  type SetOp,
} from './types';

export const LOG_VERSION = 1;

export interface LogHeader {
  v: number;
  dev: DeviceId;
  clock: SClock;
  /**
   * D-1. The device names itself here, which is the whole of the merge story
   * for a name: one writer per file means one writer per name, so two devices
   * can never disagree about one — requirements.md §8.
   */
  name?: string;
  /** D-2. When this device last wrote. Advisory — the merge never reads it. */
  at?: number;
}

/** Long enough for a phone and a laptop, short enough to stay one line. */
const MAX_NAME = 64;

export interface DecodedLog {
  header: LogHeader;
  ops: Op[];
  /** Lines that did not parse. A count, because the caller has to log it. */
  skipped: number;
}

/** One device, one file — the one-writer-per-file rule made a filename. */
export function deviceFileName(device: DeviceId): string {
  return `checklist.${device}.ops.jsonl`;
}

const FILE_NAME = /^checklist\.([0-9a-f]{8})\.ops\.jsonl$/;

/** The device a file name belongs to, or null when it is not one of ours. */
export function deviceOfFileName(name: string): DeviceId | null {
  return FILE_NAME.exec(name)?.[1] ?? null;
}

export function encodeLog(header: LogHeader, ops: readonly Op[]): string {
  const lines = [JSON.stringify(header)];
  for (const op of ops) lines.push(JSON.stringify(encodeOp(op)));
  return lines.join('\n') + '\n';
}

/** The device id is implied by the header, so it is dropped on the way out. */
function encodeOp(op: Op): Record<string, unknown> {
  const { dev: _dev, ...rest } = op;
  return rest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isKind(value: unknown): value is Kind {
  return typeof value === 'string' && (KINDS as readonly string[]).includes(value);
}

function isPriority(value: unknown): value is Priority {
  return typeof value === 'string' && (PRIORITIES as readonly string[]).includes(value);
}

function isClock(value: unknown): value is SClock {
  return isRecord(value) && Object.values(value).every((counter) => typeof counter === 'number');
}

function parseHeader(line: string): LogHeader | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (typeof value['v'] !== 'number' || typeof value['dev'] !== 'string') return null;
  if (!isClock(value['clock'])) return null;
  const header: LogHeader = { v: value['v'], dev: value['dev'], clock: value['clock'] };
  // Both are advisory and both are absent from every file M2 wrote, so a
  // missing one is an unnamed device rather than a header that failed to parse
  // — D-3 is what makes that distinction free.
  if (typeof value['name'] === 'string') header.name = value['name'].slice(0, MAX_NAME);
  if (typeof value['at'] === 'number') header.at = value['at'];
  return header;
}

/** What a device may put in its own header — the trim D-1's input owes the file. */
export function cleanDeviceName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

function parseOp(line: string, dev: DeviceId): Op | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const { id, c, at } = value;
  if (typeof id !== 'string' || typeof c !== 'number' || typeof at !== 'number') return null;
  const seen = isClock(value['seen']) ? { seen: value['seen'] } : {};

  switch (value['op']) {
    case 'create': {
      const { parent, kind, order } = value;
      if (typeof parent !== 'string' || !isKind(kind) || typeof order !== 'string') return null;
      return { op: 'create', id, parent, kind, order, c, at, dev, ...seen };
    }
    case 'set': {
      const op: SetOp = { op: 'set', id, c, at, dev, ...seen };
      if (typeof value['title'] === 'string') op.title = value['title'];
      if (typeof value['done'] === 'boolean') op.done = value['done'];
      if (typeof value['body'] === 'string' || value['body'] === null) {
        op.body = value['body'] as string | null;
      }
      if (isKind(value['kind'])) op.kind = value['kind'];
      // A-1. Normalised on the way in as well as on the way out: a tag from an
      // older build or a hand-edited line is put in the same form as one this
      // device typed, or two spellings of one tag would be two tags.
      if (Array.isArray(value['tags'])) op.tags = cleanTags(value['tags']);
      if (isPriority(value['priority'])) op.priority = value['priority'];
      return op;
    }
    case 'move': {
      const { parent, order } = value;
      if (typeof parent !== 'string' || typeof order !== 'string') return null;
      return { op: 'move', id, parent, order, c, at, dev, ...seen };
    }
    case 'delete':
      return { op: 'delete', id, c, at, dev, ...seen };
    case 'restore':
      return { op: 'restore', id, c, at, dev, ...seen };
    default:
      return null;
  }
}

/**
 * `null` means the file could not be read as a log at all, which is a normal
 * event rather than an error: the provider's client can be mid-download when a
 * read lands, and the file is picked up whole on the next cycle — S-7.
 *
 * A single unparseable op line is not that case. It is dropped and counted, so
 * one bad line costs one op instead of the whole device's history.
 */
export function decodeLog(text: string): DecodedLog | null {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) return null;
  const header = parseHeader(lines[0]!);
  if (header === null || header.v !== LOG_VERSION) return null;

  const ops: Op[] = [];
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const op = parseOp(line, header.dev);
    if (op === null) skipped++;
    else ops.push(op);
  }
  return { header, ops, skipped };
}

/** The vector a log's own ops imply, used when writing the header back out. */
export function clockOf(ops: readonly Op[]): SClock {
  const clock: Record<DeviceId, number> = {};
  for (const op of ops) clock[op.dev] = Math.max(clock[op.dev] ?? 0, op.c);
  return clock;
}
