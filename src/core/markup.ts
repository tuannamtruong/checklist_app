// B-1 to B-12. The only place a mark in a note body is spelled — requirements.md
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

/** B-9. Inline code is one backtick each side, within one line. It reads `**` inside it — B-11. */
const CODE = '`';

/**
 * B-10. A list item: `- ` or `3. `, after whatever indent it carries. The space
 * is required for the reason a heading's is — `-5C` is a temperature, not a
 * bullet — and the number is read as typed rather than renumbered, because B-3
 * renders what is in the string and nothing else.
 */
const LIST = /^([ \t]*)(-|\d{1,9}\.) (.*)$/;

/**
 * B-12. A row of a table: a line fenced by a pipe at each end, with at least
 * one cell between them. Both pipes are required for the reason a heading needs
 * its space — `a | b` is a sentence with a pipe in it, and only the pair of them
 * says "these are columns".
 */
const TABLE_ROW = /^\|.*\|$/;

/**
 * B-12. The line under the first row that makes it the header. The colons are
 * an alignment this build reads and draws nothing with — B-8's rule for the
 * word after a fence, applied to the one other thing a table is pasted in with.
 */
const TABLE_RULE = /^:?-+:?$/;

/** B-12. What Enter opens: a cell with room to type in, and a caret between the two spaces. */
const EMPTY_CELL = '  |';

/** B-12. What the control writes: two columns, which is what "split this in two" means. */
const TABLE_COLUMNS = 2;

export type BlockKind =
  | 'heading1'
  | 'heading2'
  | 'paragraph'
  | 'code'
  | 'bullet'
  | 'number'
  | 'table';

export interface Span {
  text: string;
  bold: boolean;
  /**
   * B-9. A run of code — inline, or a line of B-8's box. `bold` is the one
   * other mark it can carry (B-11); every other mark is a character in here.
   */
  code: boolean;
}

/** B-12. One cell: a line's worth of marks, which is bold and a run of code. */
export interface Cell {
  spans: readonly Span[];
}

export interface TableRow {
  cells: readonly Cell[];
}

/**
 * B-12. The rows of one table, and whether the first of them is the header —
 * which it is when the line under it is the dashes. The rule line itself is not
 * a row: it says something about the row above rather than holding anything.
 */
export interface Table {
  rows: readonly TableRow[];
  header: boolean;
}

export interface Block {
  kind: BlockKind;
  /**
   * The marked runs of the block. A `table` carries none of its own — its text
   * is in the cells — so everything reading a body has to read `table` beside
   * this, which is why there are two readers of it and no more: `plainText`
   * here, and `NoteBody` on screen.
   */
  spans: readonly Span[];
  /** B-10. A list item's own marker — `-`, or the number as typed — and its indent. */
  list?: { marker: string; indent: string };
  /** B-12. The rows, when this block is a table. */
  table?: Table;
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
      // B-11. Every mark in here is a character except `**`: a `#` is a comment
      // and a `- ` is a flag, but the reason a long box is on screen is usually
      // one line in it, and bold is how that line is pointed at.
      blocks.push({
        kind: 'code',
        spans: fencedSpans(lines.slice(at + 1, close)),
      });
      at = close + 1;
      continue;
    }
    // B-12. The other construct that spans lines, and the one with no mark
    // saying where it ends: every line is read on its own and the table stops
    // at the first line that is not a row, so a table being typed can never
    // swallow the note under it the way an unclosed fence would.
    if (isTableRow(line)) {
      const end = tableEnd(lines, at);
      blocks.push(tableBlock(lines.slice(at, end)));
      at = end;
      continue;
    }
    blocks.push(lineBlock(line));
    at += 1;
  }
  return blocks;
}

/** B-12. A line fenced by pipes, whatever it carries between them. */
function isTableRow(line: string): boolean {
  const bare = line.trimEnd();
  return bare.length > 1 && TABLE_ROW.test(bare);
}

/** The line after the last row of the table opened at `from`. */
function tableEnd(lines: readonly string[], from: number): number {
  let at = from;
  while (at < lines.length && isTableRow(lines[at]!)) at += 1;
  return at;
}

/**
 * B-12. The cells of one row: the text between the pipes, each trimmed, because
 * the pipes a person lines up are spaces they do not mean.
 */
function cellsOf(line: string): string[] {
  const bare = line.trimEnd();
  return bare
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

/** B-12. Whether the line is the dashes that make the row above it the header. */
function isTableRule(line: string): boolean {
  const cells = cellsOf(line);
  return cells.length > 0 && cells.every((cell) => TABLE_RULE.test(cell));
}

/**
 * B-12. The rows drawn, and whether the first is the header.
 *
 * A rule line is the header's mark and never a row, and it is read in the one
 * place Markdown puts it — directly under the first row. Anywhere else it is a
 * row of dashes, because B-3 draws what is in the string and a row that
 * disappeared from the middle of a table would be the string arguing back.
 */
function tableBlock(lines: readonly string[]): Block {
  const header = lines.length > 1 && isTableRule(lines[1]!);
  const drawn = header ? [lines[0]!, ...lines.slice(2)] : lines;
  return {
    kind: 'table',
    spans: [],
    table: {
      header,
      rows: drawn.map((line) => ({
        cells: cellsOf(line).map((cell) => ({ spans: spansOf(cell) })),
      })),
    },
  };
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
 * is read first and the run it opens is found before any asterisk in it is —
 * which is what keeps a `**` *outside* the run from reaching into it — and the
 * run is then read for bold like anything else, so `` `**x**` `` is a bold `x`
 * in code (B-9, B-11).
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
        spans.push(...boldRuns(line.slice(at + CODE.length, close), true));
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
 * B-11. The bold runs of a fenced block, read a line at a time.
 *
 * Per line because every other mark in this parser is per line, and because a
 * pair that could reach across a line break would let something typed at the
 * bottom of a box turn the top of it bold. The newlines are spans of their own,
 * so `plainText` still joins the block back into the text that was typed.
 *
 * An empty block is one empty span rather than none: the box is drawn from the
 * spans, and a block with nothing in it is still a block.
 */
function fencedSpans(lines: readonly string[]): Span[] {
  const spans: Span[] = [];
  // Two plain runs in a row are one run: the line breaks are what would
  // otherwise cut a box carrying no bold at all into a span per line, and a
  // block that reads the same way it did before B-11 is a block nothing else
  // has to learn about.
  const push = (text: string, bold: boolean): void => {
    const last = spans[spans.length - 1];
    if (last !== undefined && !last.bold && !bold) last.text += text;
    else spans.push({ text, bold, code: true });
  };
  lines.forEach((line, at) => {
    if (at > 0) push('\n', false);
    for (const run of boldRuns(line, true)) push(run.text, run.bold);
  });
  return spans.length === 0 ? [{ text: '', bold: false, code: true }] : spans;
}

/**
 * B-11. The `**` runs of one piece of text, with `code` carried onto every span
 * it makes — the rule an inline run and a line of B-8's box share, so bold is
 * the same two characters inside code as outside it.
 *
 * `spansOf` scans a *paragraph* with its own loop rather than calling this,
 * because there the two marks interleave: the backtick is read first, so a bold
 * pair that opens before a code run and closes after it keeps the run inside
 * itself. Here there is no backtick left to read — the run has already been
 * found — so a single pass over the text is the whole rule.
 *
 * An unmatched `**` is two literal characters rather than an error, for the
 * reason `spansOf` gives: a body is text somebody is halfway through typing.
 */
function boldRuns(text: string, code: boolean): Span[] {
  const spans: Span[] = [];
  let plain = '';
  let at = 0;
  const flush = (): void => {
    if (plain !== '') spans.push({ text: plain, bold: false, code });
    plain = '';
  };

  while (at < text.length) {
    if (text.startsWith(BOLD, at)) {
      const close = text.indexOf(BOLD, at + BOLD.length);
      // `****` closes immediately and marks nothing, so it stays literal.
      if (close > at + BOLD.length) {
        flush();
        spans.push({ text: text.slice(at + BOLD.length, close), bold: true, code });
        at = close + BOLD.length;
        continue;
      }
    }
    plain += text[at];
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
    .map((block) =>
      block.table === undefined
        ? block.spans.map((span) => span.text).join('')
        : // B-12. A table is its cells with a space between them: the pipes come
          // off like every other mark, so "Mon 07:40" is what F-1 matches and
          // what the snippet shows.
          block.table.rows
            .map((row) =>
              row.cells
                .map((cell) => cell.spans.map((span) => span.text).join(''))
                .join(' '),
            )
            .join('\n'),
    )
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
  /**
   * Where the caret goes, when it is not the end of what was inserted — B-12's
   * new row is opened whole and typed into the middle of, which a list's marker
   * never was.
   */
  caret?: number;
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

/**
 * B-14. The lines a selection touches, made one list: every line with
 * something on it gets the marker — `- `, or `1. `, `2. ` counted down the run —
 * in place of any marker it carried, after its own indent. When every such line
 * already is that kind of item the markers come off instead, so one control is
 * both directions, which is `toggleCode`'s shape.
 *
 * The whole run is left selected, so the controls stay beside it and a second
 * press takes back the first.
 */
export function toggleList(
  text: string,
  start: number,
  end: number,
  kind: 'bullet' | 'number',
): Edited {
  const from = lineStart(text, start);
  const to = lineEnd(text, end);
  const lines = text.slice(from, to).split('\n');
  const items = lines.map((line) => LIST.exec(line));
  const ofKind = (item: RegExpExecArray | null): boolean =>
    item !== null && (item[2] === '-') === (kind === 'bullet');
  const off = lines.every((line, at) => line.trim() === '' || ofKind(items[at]!));
  let count = 0;
  const next = lines
    .map((line, at) => {
      if (line.trim() === '') return line;
      const item = items[at]!;
      const indent = item ? item[1]! : /^[ \t]*/.exec(line)![0];
      const rest = item ? item[3]! : line.slice(indent.length);
      if (off) return indent + rest;
      count += 1;
      return indent + (kind === 'bullet' ? '- ' : `${count}. `) + rest;
    })
    .join('\n');
  return { text: text.slice(0, from) + next + text.slice(to), start: from, end: from + next.length };
}

/** The marker the next item carries: the same bullet, or the next number. */
function nextMarker(marker: string): string {
  if (marker === '-') return '- ';
  return `${Number(marker.slice(0, -1)) + 1}. `;
}

/**
 * B-12. Whether the caret is in a table, which is what the control shows and
 * what decides which way it writes. A row inside a fenced block is not one: a
 * pipe in a box of code is a pipe.
 */
export function tableAt(text: string, caret: number): boolean {
  return tableAround(lineRanges(text), caret, caret) !== null;
}

/**
 * B-12. The contiguous rows around the caret, and `null` when it is not in a
 * table. The rows are found from the caret's own line outwards, which is the
 * same walk `parseBody` does from the top.
 */
function tableAround(
  lines: readonly Line[],
  start: number,
  end: number,
): { open: number; close: number } | null {
  if (fenceAround(lines, start, end) !== null) return null;
  const at = lineAt(lines, start);
  if (!isTableRow(lines[at]!.text)) return null;
  let open = at;
  let close = at;
  while (open > 0 && isTableRow(lines[open - 1]!.text)) open -= 1;
  while (close < lines.length - 1 && isTableRow(lines[close + 1]!.text)) close += 1;
  return { open, close };
}

/**
 * B-12. The fourth control, and one control for both directions — the shape
 * `toggleCode` has, and for the same reason: a second button for "not a table"
 * teaches nothing the first one does not.
 *
 * Outside a table it writes a starter — two columns, the header rule and one
 * row — on the caret's own line when that line is empty and on a fresh line
 * under it when it is not, with the caret in the first cell. Inside one it
 * takes the pipes off, a line per row and the rule line gone, which is the
 * table undone rather than deleted.
 *
 * Everything it writes is characters a person could have typed, so the field's
 * own undo reverses it — B-4's rule, which is what keeps a control from having
 * a state of its own.
 */
export function toggleTable(text: string, start: number, end: number): Edited {
  const lines = lineRanges(text);
  const table = tableAround(lines, start, end);
  if (table !== null) return untable(text, lines, table, start);

  const from = lineStart(text, start);
  const to = lineEnd(text, end);
  const empty = `|${EMPTY_CELL.repeat(TABLE_COLUMNS)}`;
  const rule = `|${' --- |'.repeat(TABLE_COLUMNS)}`;
  const written = `${empty}\n${rule}\n${empty}`;
  // A line with something on it keeps it: a table is a block of its own, and
  // wrapping the sentence that was there in pipes would make it a cell.
  const blank = text.slice(from, to).trim() === '';
  const at = blank ? from : to + 1;
  // Between the two spaces of the first cell, which is where Enter leaves it too.
  const caret = at + 2;
  return {
    text: blank
      ? text.slice(0, from) + written + text.slice(to)
      : `${text.slice(0, to)}\n${written}${text.slice(to)}`,
    start: caret,
    end: caret,
  };
}

/**
 * B-12. The pipes off every row of one table: a line per row, its cells joined
 * by a space, and the rule line gone because it is a mark rather than content.
 *
 * The caret is kept on the row it was on, at the end of it — the row is a
 * different length now, and the end of the line is the one place in it that
 * still means what it meant.
 */
function untable(
  text: string,
  lines: readonly Line[],
  table: { open: number; close: number },
  caret: number,
): Edited {
  const rows = lines.slice(table.open, table.close + 1).map((line) => line.text);
  const ruled = rows.length > 1 && isTableRule(rows[1]!);
  const kept = rows
    .map((row, at) => ({ row, at }))
    .filter((row) => !(ruled && row.at === 1));
  const plain = kept.map((row) => cellsOf(row.row).join(' ').trim());

  const from = lines[table.open]!.from;
  const on = lineAt(lines, caret) - table.open;
  // A caret on the rule line has no line of its own left to sit on, so it
  // lands at the end of the row that line was describing — the one above it.
  const held = Math.max(0, kept.findIndex((row) => row.at === on));
  const before = plain.slice(0, held);
  const at =
    from + before.reduce((sum, line) => sum + line.length + 1, 0) + (plain[held]?.length ?? 0);
  return {
    text: text.slice(0, from) + plain.join('\n') + text.slice(lines[table.close]!.to),
    start: at,
    end: at,
  };
}

/**
 * B-12. What Enter means on a row of a table, and `null` when it means what
 * Enter always meant — requirements.md §4.3.
 *
 * It opens the next row with the same number of empty cells and puts the caret
 * in the first of them, so the second row of a table costs what the second item
 * of a list costs. **Enter on a row with nothing in any cell takes the row off**,
 * which is B-10's way out of a list applied to a table.
 *
 * It never *splits* a row, which is where it differs from `listEnter` on
 * purpose: a caret halfway along an item leaves two items, while a caret
 * halfway along a row would leave two lines that are each half a row and
 * neither of them a table. The new row therefore opens under the line whatever
 * the caret was doing on it.
 */
export function tableEnter(text: string, start: number, end: number): Splice | null {
  // A selection Enter replaces what is selected, which is the browser's own
  // rule and not a table question.
  if (start !== end) return null;
  const lines = lineRanges(text);
  // Inside a fenced block Enter is Enter: a pipe in code is a pipe.
  if (fenceAround(lines, start, end) !== null) return null;

  const line = lines[lineAt(lines, start)]!;
  if (!isTableRow(line.text)) return null;

  const cells = cellsOf(line.text);
  if (cells.every((cell) => cell === '')) return { from: line.from, to: line.to, insert: '' };

  const row = `|${EMPTY_CELL.repeat(cells.length)}`;
  return {
    from: line.to,
    to: line.to,
    insert: `\n${row}`,
    // Between the two spaces of the first cell: `| x |` is what typing then
    // makes of it, which is the row the person would have typed by hand.
    caret: line.to + 3,
  };
}

/**
 * B-13. The one range `before` and `after` differ in — the common head and
 * tail are left out. A control returns a whole body, and a whole body assigned
 * to the field empties its undo stack; this splice is what is typed instead, so
 * `Ctrl-Z` takes the control's edit back like any other typing.
 */
export function spliceOf(before: string, after: string): Splice {
  let from = 0;
  while (from < before.length && from < after.length && before[from] === after[from]) from += 1;
  let tail = 0;
  while (
    tail < before.length - from &&
    tail < after.length - from &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1;
  }
  return { from, to: before.length - tail, insert: after.slice(from, after.length - tail) };
}

/** The splice applied, for a field that cannot be typed into — and for the tests. */
export function spliced(text: string, splice: Splice): Edited {
  const at = splice.caret ?? splice.from + splice.insert.length;
  return {
    text: text.slice(0, splice.from) + splice.insert + text.slice(splice.to),
    start: at,
    end: at,
  };
}
