// B-1 to B-9. The only place a mark in a note body is spelled — requirements.md
// §4.3, past_decision.md §12.
//
// The marks are stored in `body` itself, so this module is a reader of a string
// and never a second format: `body` is one field with one merge rule before and
// after, and a build that predates this one shows `**07:40**` rather than a
// paragraph of tags. That is the whole reason the design is Markdown and not a
// document.
//
// Nothing here emits HTML. `parseBody` returns blocks and spans and the
// component renders them, so what reaches the DOM goes through Svelte's own
// escaping and a pasted `<script>` is text — B-6.

/** A heading opens with a hash and a space: `#town` is a word, not a heading. */
const HEADING_1 = '# ';
const HEADING_2 = '## ';

/** Both bold marks are this, and an empty pair is two literal pairs. */
const BOLD = '**';

/** B-8. A code block opens and closes with three backticks on a line of their own. */
const FENCE = '```';

/** B-9. Inline code is one backtick each side, within one line. */
const CODE = '`';

/**
 * B-10. A list item: `- ` or `3. `, after whatever indent it carries. The space
 * is required for the reason a heading's is — `-5C` is a temperature, not a
 * bullet — and the number is read as typed rather than renumbered, because B-3
 * renders what is in the string and nothing else.
 */
const LIST = /^([ \t]*)(-|\d{1,9}\.) (.*)$/;

export type BlockKind = 'heading1' | 'heading2' | 'paragraph' | 'code' | 'bullet' | 'number';

export interface Span {
  text: string;
  bold: boolean;
  /** B-9. A run of inline code, which carries no other mark inside it. */
  code: boolean;
}

export interface Block {
  kind: BlockKind;
  spans: readonly Span[];
  /** B-10. A list item's own marker — `-`, or the number as typed — and its indent. */
  list?: { marker: string; indent: string };
}

/** A line of the body, and where it sits in the string. */
interface Line {
  from: number;
  to: number;
  text: string;
}

/**
 * One block per line, blank lines included — except a fenced block, which is
 * the one construct that spans lines.
 *
 * A body is typed in a plain field, so every line break in it is one the person
 * made and one they expect to see — grouping runs of lines into paragraphs
 * would render something other than what was typed, which is exactly what B-3
 * promises not to do.
 */
export function parseBody(body: string): Block[] {
  const lines = body.split('\n');
  const blocks: Block[] = [];
  let at = 0;
  while (at < lines.length) {
    const line = lines[at]!;
    // B-8. An *unclosed* fence is three literal characters, for the reason an
    // unmatched `**` is two: the body is being typed, and a line that swallows
    // the rest of the note the moment the third backtick lands is a line that
    // fights the typing. The control writes both fences at once, so the closed
    // case is the ordinary one.
    const close = opensFence(line) ? closingFence(lines, at + 1) : -1;
    if (close !== -1) {
      // The content is taken raw: code is the one place where `**` and `#` are
      // characters rather than marks, which is most of the point of having it.
      blocks.push({
        kind: 'code',
        spans: [
          {
            text: lines.slice(at + 1, close).join('\n'),
            bold: false,
            code: true,
          },
        ],
      });
      at = close + 1;
      continue;
    }
    blocks.push(lineBlock(line));
    at += 1;
  }
  return blocks;
}

/** The line that closes a block opened at `from - 1`, or -1 while there is none. */
function closingFence(lines: readonly string[], from: number): number {
  for (let at = from; at < lines.length; at += 1) {
    if (lines[at]!.trimEnd() === FENCE) return at;
  }
  return -1;
}

/**
 * A word after the opening fence is a language, and this build reads it and
 * draws nothing with it — a pasted ```` ```js ```` block is code rather than
 * three literal characters, and the box says "Code" either way.
 */
function opensFence(line: string): boolean {
  return line.trimEnd().startsWith(FENCE);
}

function lineBlock(line: string): Block {
  if (line.startsWith(HEADING_2)) {
    return { kind: 'heading2', spans: spansOf(line.slice(HEADING_2.length)) };
  }
  if (line.startsWith(HEADING_1)) {
    return { kind: 'heading1', spans: spansOf(line.slice(HEADING_1.length)) };
  }
  const item = LIST.exec(line);
  if (item !== null) {
    const [, indent, marker, rest] = item as unknown as [string, string, string, string];
    return {
      kind: marker === '-' ? 'bullet' : 'number',
      spans: spansOf(rest),
      list: { marker, indent },
    };
  }
  return { kind: 'paragraph', spans: spansOf(line) };
}

/**
 * The marked runs of one line, and the plain text between them.
 *
 * An unmatched `**` is four literal characters rather than an error: a body is
 * text a person is halfway through typing, and a line that reformats itself the
 * moment a second asterisk lands is a line that fights the typing. A backtick
 * is read first and its content is taken whole, so `` `**x**` `` is the four
 * characters it says and not a bold run — B-9.
 */
function spansOf(line: string): Span[] {
  const spans: Span[] = [];
  let plain = '';
  let at = 0;
  const flush = (): void => {
    if (plain !== '') spans.push({ text: plain, bold: false, code: false });
    plain = '';
  };

  while (at < line.length) {
    if (line.startsWith(CODE, at)) {
      const close = line.indexOf(CODE, at + CODE.length);
      // `` closes immediately and marks nothing, so it stays literal — and so
      // does a run of three, which is a fence that wandered into a line.
      if (close > at + CODE.length) {
        flush();
        spans.push({
          text: line.slice(at + CODE.length, close),
          bold: false,
          code: true,
        });
        at = close + CODE.length;
        continue;
      }
    }
    if (line.startsWith(BOLD, at)) {
      const close = line.indexOf(BOLD, at + BOLD.length);
      // `****` closes immediately and marks nothing, so it stays literal.
      if (close > at + BOLD.length) {
        flush();
        spans.push({
          text: line.slice(at + BOLD.length, close),
          bold: true,
          code: false,
        });
        at = close + BOLD.length;
        continue;
      }
    }
    plain += line[at];
    at += 1;
  }
  flush();
  return spans;
}

/**
 * B-5. The body with its marks taken off, which is what search matches and what
 * a snippet shows: F-1 is a substring match, and "leaves at 07:40" must not
 * stop matching because the time is bold.
 *
 * It is the identity on a body that carries no marks, so every hit that worked
 * before this existed works the same way now.
 */
export function plainText(body: string): string {
  return parseBody(body)
    .map((block) => block.spans.map((span) => span.text).join(''))
    .join('\n');
}

/** Where a control left the caret, so the field can put it back — B-4. */
export interface Edited {
  text: string;
  start: number;
  end: number;
}

/**
 * B-4. `Ctrl-B` and the button: wrap the selection, or unwrap it when it is
 * already wrapped, so one control is both directions.
 *
 * An empty selection inserts the pair and puts the caret between the halves,
 * which is what a person pressing it before typing the word means by it.
 */
export function toggleBold(text: string, start: number, end: number): Edited {
  const selected = text.slice(start, end);
  const before = text.slice(0, start);
  const after = text.slice(end);

  if (
    selected.startsWith(BOLD) &&
    selected.endsWith(BOLD) &&
    selected.length > BOLD.length * 2
  ) {
    const bare = selected.slice(BOLD.length, -BOLD.length);
    return { text: before + bare + after, start, end: start + bare.length };
  }
  // The marks may sit just outside the selection, which is what a double-click
  // on the word inside them gives.
  if (before.endsWith(BOLD) && after.startsWith(BOLD)) {
    return {
      text: before.slice(0, -BOLD.length) + selected + after.slice(BOLD.length),
      start: start - BOLD.length,
      end: end - BOLD.length,
    };
  }
  return {
    text: `${before}${BOLD}${selected}${BOLD}${after}`,
    start: start + BOLD.length,
    end: end + BOLD.length,
  };
}

/** 0 is "not a heading", which is what pressing the level it already has means. */
export type HeadingLevel = 0 | 1 | 2;

/** The level the line holding `caret` carries now. */
export function headingAt(text: string, caret: number): HeadingLevel {
  const line = text.slice(lineStart(text, caret), lineEnd(text, caret));
  if (line.startsWith(HEADING_2)) return 2;
  if (line.startsWith(HEADING_1)) return 1;
  return 0;
}

/**
 * B-4. One control, three states, in the order it cycles — the same shape A-2's
 * flag gives priority, and for the same reason: two buttons for two levels
 * teach nothing that one button showing the level does not.
 */
export function nextHeading(level: HeadingLevel): HeadingLevel {
  return level === 0 ? 1 : level === 1 ? 2 : 0;
}

/**
 * B-4. Sets the level of every line the range touches, which is a prefix per
 * line rather than a mode: the mark is in the text, so the field's own undo
 * reverses it like any other typing.
 *
 * A caret is a range of no width, so one line is the ordinary case rather than
 * a special one.
 */
export function setHeading(
  text: string,
  start: number,
  end: number,
  level: HeadingLevel,
): Edited {
  const from = lineStart(text, start);
  const to = lineEnd(text, end);
  const lines = text.slice(from, to).split('\n');
  const marked = lines.map((line) => mark(bare(line), level));
  const next = marked.join('\n');
  // The caret moves by what changed in front of it: the first line's own shift
  // for where the range starts, every line's for where it ends.
  const first = marked[0]!.length - lines[0]!.length;
  const all = next.length - (to - from);
  return {
    text: text.slice(0, from) + next + text.slice(to),
    start: Math.max(from, start + first),
    end: Math.max(from, end + all),
  };
}

/** The line without whatever mark it carries now. */
function bare(line: string): string {
  if (line.startsWith(HEADING_2)) return line.slice(HEADING_2.length);
  if (line.startsWith(HEADING_1)) return line.slice(HEADING_1.length);
  return line;
}

function mark(line: string, level: HeadingLevel): string {
  if (level === 0) return line;
  return (level === 2 ? HEADING_2 : HEADING_1) + line;
}

function lineStart(text: string, caret: number): number {
  // A negative `fromIndex` is clamped to 0 rather than meaning "nowhere", so a
  // caret at the very start has to be answered before asking.
  if (caret <= 0) return 0;
  return text.lastIndexOf('\n', caret - 1) + 1;
}

function lineEnd(text: string, caret: number): number {
  const at = text.indexOf('\n', caret);
  return at === -1 ? text.length : at;
}

/**
 * B-8, B-9. One control, and which of the two marks it writes is a question
 * about the selection rather than a second button:
 *
 * - a run inside one line becomes inline code, and inline code becomes the run
 *   again — the shape `toggleBold` already has;
 * - anything else — a caret, or a selection crossing a line break — becomes a
 *   fenced block over the lines it touches, which is the empty box a person
 *   pressing it on an empty line means by it;
 * - a caret or a selection *inside* a block takes the fences off, so the one
 *   control is both directions there too.
 *
 * Two marks and one button, for the reason the heading cycles rather than
 * splitting in two — requirements.md §4.3.
 */
export function toggleCode(text: string, start: number, end: number): Edited {
  const lines = lineRanges(text);
  const fenced = fenceAround(lines, start, end);
  if (fenced !== null) return unfence(text, lines, fenced, start, end);

  const selected = text.slice(start, end);
  if (start !== end && !selected.includes('\n'))
    return toggleInline(text, start, end);
  return fence(text, start, end);
}

/** B-9. The single-backtick pair, wrapped or unwrapped — `toggleBold`'s rules. */
function toggleInline(text: string, start: number, end: number): Edited {
  const selected = text.slice(start, end);
  const before = text.slice(0, start);
  const after = text.slice(end);

  if (
    selected.startsWith(CODE) &&
    selected.endsWith(CODE) &&
    selected.length > CODE.length * 2
  ) {
    const bare = selected.slice(CODE.length, -CODE.length);
    return { text: before + bare + after, start, end: start + bare.length };
  }
  // The marks may sit just outside the selection, which is what a double-click
  // on the word inside them gives.
  if (before.endsWith(CODE) && after.startsWith(CODE)) {
    return {
      text: before.slice(0, -CODE.length) + selected + after.slice(CODE.length),
      start: start - CODE.length,
      end: end - CODE.length,
    };
  }
  return {
    text: `${before}${CODE}${selected}${CODE}${after}`,
    start: start + CODE.length,
    end: end + CODE.length,
  };
}

/**
 * B-8. The lines the selection touches, between two fence lines, with the
 * content left selected — a caret on an empty line therefore ends up on the
 * empty line between the two fences, which is the box the button promised.
 */
function fence(text: string, start: number, end: number): Edited {
  const from = lineStart(text, start);
  const to = lineEnd(text, end);
  const content = text.slice(from, to);
  const opened = from + FENCE.length + 1;
  return {
    text: `${text.slice(0, from)}${FENCE}\n${content}\n${FENCE}${text.slice(to)}`,
    start: opened,
    end: opened + content.length,
  };
}

/** B-8. The two fence lines taken off, with the caret kept on the same character. */
function unfence(
  text: string,
  lines: readonly Line[],
  pair: { open: number; close: number },
  start: number,
  end: number,
): Edited {
  const open = lines[pair.open]!;
  const close = lines[pair.close]!;
  const content = text.slice(
    open.to + 1,
    Math.max(open.to + 1, close.from - 1),
  );
  const shift = open.to + 1 - open.from;
  const held = (at: number): number =>
    Math.min(open.from + content.length, Math.max(open.from, at - shift));
  return {
    text: text.slice(0, open.from) + content + text.slice(close.to),
    start: held(start),
    end: held(end),
  };
}

/** The fenced block both ends of the selection sit inside, if they sit in one. */
function fenceAround(
  lines: readonly Line[],
  start: number,
  end: number,
): { open: number; close: number } | null {
  const texts = lines.map((line) => line.text);
  const from = lineAt(lines, start);
  const to = lineAt(lines, end);
  let at = 0;
  while (at < lines.length) {
    if (!opensFence(texts[at]!)) {
      at += 1;
      continue;
    }
    const close = closingFence(texts, at + 1);
    if (close === -1) return null;
    // The fence lines themselves are not "inside": pressing the control with
    // the caret on one is a fresh block, which is what the alternative — a
    // silent no-op — would have been mistaken for.
    if (from > at && to < close) return { open: at, close };
    at = close + 1;
  }
  return null;
}

/** Every line of the body, with where it sits, which is what a fence is found by. */
function lineRanges(text: string): Line[] {
  const ranges: Line[] = [];
  let from = 0;
  for (const line of text.split('\n')) {
    ranges.push({ from, to: from + line.length, text: line });
    from += line.length + 1;
  }
  return ranges;
}

/** Which line holds `caret`; the end of a line and the start of the next is the earlier one. */
function lineAt(lines: readonly Line[], caret: number): number {
  for (let at = 0; at < lines.length; at += 1) {
    if (caret <= lines[at]!.to) return at;
  }
  return lines.length - 1;
}

/** A replacement of one range by one string — what B-10's Enter is, before the field applies it. */
export interface Splice {
  from: number;
  to: number;
  insert: string;
}

/**
 * B-10. What Enter means on a list item, and `null` when it means what Enter
 * always meant — requirements.md §4.3.
 *
 * A list is typed rather than switched on: `- ` or `1. ` opens one, and Enter
 * carries the marker onto the next line so the second item costs nothing.
 * **Enter on an item with nothing in it ends the list** — the marker comes off
 * and the line is an ordinary empty one — which is the way out that stops a
 * list being a mode the field is stuck in.
 *
 * It is a splice rather than a whole body so the caller can type it into the
 * field: a marker inserted by `insertText` is undone by the field's own
 * `Ctrl-Z`, exactly as a typed one is.
 */
export function listEnter(text: string, start: number, end: number): Splice | null {
  // A selection Enter replaces what is selected, which is the browser's own
  // rule and not a list question.
  if (start !== end) return null;
  const lines = lineRanges(text);
  // Inside a fenced block Enter is Enter: a `- ` in code is two characters.
  if (fenceAround(lines, start, end) !== null) return null;

  const line = lines[lineAt(lines, start)]!;
  const item = LIST.exec(line.text);
  if (item === null) return null;
  const [, indent, marker, rest] = item as unknown as [string, string, string, string];

  // Before the end of the marker the caret is not "on the item" yet, and
  // carrying the marker there would write it in front of itself.
  if (start < line.from + indent.length + marker.length + 1) return null;

  if (rest.trim() === '') return { from: line.from, to: line.to, insert: '' };
  return { from: start, to: start, insert: `\n${indent}${nextMarker(marker)}` };
}

/** The marker the next item carries: the same bullet, or the next number. */
function nextMarker(marker: string): string {
  if (marker === '-') return '- ';
  return `${Number(marker.slice(0, -1)) + 1}. `;
}

/** The splice applied, for a field that cannot be typed into — and for the tests. */
export function spliced(text: string, splice: Splice): Edited {
  const at = splice.from + splice.insert.length;
  return {
    text: text.slice(0, splice.from) + splice.insert + text.slice(splice.to),
    start: at,
    end: at,
  };
}
