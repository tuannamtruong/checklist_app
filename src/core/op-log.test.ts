import { describe, expect, it } from 'vitest';
import {
  clockOf,
  decodeLog,
  deviceFileName,
  deviceOfFileName,
  encodeLog,
  LOG_VERSION,
  type LogHeader,
} from './op-log';
import { ROOT, type Op } from './types';

const DEV = 'aaaa0001';
const header: LogHeader = { v: LOG_VERSION, dev: DEV, clock: { [DEV]: 3, bbbb0002: 4 } };

const ops: Op[] = [
  { op: 'create', id: 'n_1', parent: ROOT, kind: 'task', order: 'a1', c: 1, at: 100, dev: DEV },
  { op: 'set', id: 'n_1', title: 'Buy milk', done: false, c: 2, at: 200, dev: DEV },
  { op: 'move', id: 'n_1', parent: 'n_2', order: 'a3', c: 3, at: 300, dev: DEV, seen: { bbbb0002: 4 } },
];

describe('the device file', () => {
  it('names itself after the device that writes it', () => {
    expect(deviceFileName(DEV)).toBe('checklist.aaaa0001.ops.jsonl');
    expect(deviceOfFileName('checklist.aaaa0001.ops.jsonl')).toBe(DEV);
    expect(deviceOfFileName('checklist.json')).toBeNull();
    expect(deviceOfFileName('notes.txt')).toBeNull();
  });
});

describe('encodeLog', () => {
  it('writes a header line and one line per op', () => {
    const lines = encodeLog(header, ops).trim().split('\n');
    expect(lines).toHaveLength(4);
    expect(JSON.parse(lines[0]!)).toEqual(header);
  });

  it('leaves the device id off every op line — it is the header’s', () => {
    const lines = encodeLog(header, ops).trim().split('\n');
    for (const line of lines.slice(1)) expect(JSON.parse(line)).not.toHaveProperty('dev');
  });

  it('round-trips every op, device id and all', () => {
    const decoded = decodeLog(encodeLog(header, ops));
    expect(decoded?.header).toEqual(header);
    expect(decoded?.ops).toEqual(ops);
    expect(decoded?.skipped).toBe(0);
  });
});

describe('decodeLog', () => {
  it('skips a file it cannot read as a log at all — S-7', () => {
    expect(decodeLog('')).toBeNull();
    expect(decodeLog('half a jso')).toBeNull();
    expect(decodeLog('{"v":99,"dev":"aaaa0001","clock":{}}\n')).toBeNull();
    expect(decodeLog('{"dev":"aaaa0001"}\n')).toBeNull();
  });

  it('drops one unreadable op line rather than the device’s history', () => {
    const text = encodeLog(header, ops).trim() + '\n{"op":"set","id":\n';
    const decoded = decodeLog(text);
    expect(decoded?.ops).toHaveLength(3);
    expect(decoded?.skipped).toBe(1);
  });

  it('drops an op whose shape is wrong', () => {
    const text = `${JSON.stringify(header)}\n{"op":"create","id":"n_9","parent":"root","kind":"idea","order":"a1","c":1,"at":1}\n`;
    expect(decodeLog(text)?.skipped).toBe(1);
  });

  it('reads a hand-written log with no trailing newline', () => {
    const text = `${JSON.stringify(header)}\n{"op":"delete","id":"n_1","c":9,"at":10}`;
    expect(decodeLog(text)?.ops).toEqual([{ op: 'delete', id: 'n_1', c: 9, at: 10, dev: DEV }]);
  });
});

describe('clockOf', () => {
  it('reads the vector back off the ops themselves', () => {
    expect(clockOf(ops)).toEqual({ [DEV]: 3 });
    expect(clockOf([])).toEqual({});
  });
});
