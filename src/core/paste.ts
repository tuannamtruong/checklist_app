// K-9. What a pasted paragraph means in a line that makes one row: one row per
// line of it. The split is here rather than in the input because it is a
// question about text, and the layer that owns text questions is this one —
// `tags.ts` is the same shape, and the same rule keeps it testable without a
// browser.

/**
 * The titles a pasted block asks for, in the order they were written.
 *
 * Every line ending is one line ending: a paste from a Windows editor carries
 * `\r\n` and a paste from an old Mac one carries `\r`, and both mean the same
 * thing the user saw on screen.
 *
 * Blank lines are dropped rather than made into empty rows. A paragraph pasted
 * out of a document is usually double-spaced, and a run of untitled rows is not
 * what the person copying it meant — while an empty row is one keystroke away
 * for anybody who wants one.
 *
 * Each line is trimmed for the same reason a title is: the leading bullet a
 * word processor indents with is whitespace, and it belongs to the document
 * rather than to the task.
 */
export function splitPastedTitles(text: string): string[] {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}
