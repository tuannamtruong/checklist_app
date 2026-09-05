// B-1 to B-6. The only place a mark in a note body is spelled — requirements.md
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

export type BlockKind = 'heading1' | 'heading2' | 'paragraph';

export interface Span {
  text: string;
  bold: boolean;
}

export interface Block {
  kind: BlockKind;
  spans: readonly Span[];
}

/**
 * One block per line, blank lines included.
 *
 * A body is typed in a plain field, so every line break in it is one the person
 * made and one they expect to see — grouping runs of lines into paragraphs
 * would render something other than what was typed, which is exactly what B-3
 * promises not to do.
 */
export function parseBody(body: string): Block[] {
  return body.split('\n').map((line) => {
    if (line.startsWith(HEADING_2)) {
      return { kind: 'heading2' as const, spans: spansOf(line.slice(HEADING_2.length)) };
    }
    if (line.startsWith(HEADING_1)) {
      return { kind: 'heading1' as const, spans: spansOf(line.slice(HEADING_1.length)) };
    }
    return { kind: 'paragraph' as const, spans: spansOf(line) };
  });
}

/**
 * The bold runs of one line, and the plain text between them.
 *
 * An unmatched `**` is four literal characters rather than an error: a body is
 * text a person is halfway through typing, and a line that reformats itself the
 * moment a second asterisk lands is a line that fights the typing.
 */
function spansOf(line: string): Span[] {
  const spans: Span[] = [];
  let plain = '';
  let at = 0;
  const flush = (): void => {
    if (plain !== '') spans.push({ text: plain, bold: false });
    plain = '';
  };

  while (at < line.length) {
    if (line.startsWith(BOLD, at)) {
      const close = line.indexOf(BOLD, at + BOLD.length);
      // `****` closes immediately and marks nothing, so it stays literal.
      if (close > at + BOLD.length) {
        flush();
        spans.push({ text: line.slice(at + BOLD.length, close), bold: true });
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

  if (selected.startsWith(BOLD) && selected.endsWith(BOLD) && selected.length > BOLD.length * 2) {
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
