// A-1. The one place a tag is given its shape — requirements.md §4.1.
//
// A tag is normalised on the way in and the normal form is what is stored, so
// `Work`, `#work` and ` work ` are one tag. That is what a filter over one
// person's own checklist has to mean, and doing it here rather than at the
// input means a tag that arrives from a peer's file, from an older build or
// from a hand-edited log is normalised too.

/** Long enough for a phrase, short enough to render as a chip. */
const MAX_TAG = 32;

/** A row that needs a thirteenth tag is a row that wants a list. */
export const MAX_TAGS = 12;

/**
 * The normal form: no leading `#` (people type it and do not mean it as part of
 * the word), inner whitespace collapsed, case-folded, trimmed to length. An
 * empty result means the input was not a tag at all.
 */
export function cleanTag(raw: string): string {
  return raw
    .replace(/^#+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, MAX_TAG)
    .trim();
}

/**
 * A set, spelled as a sorted array: sorted so that two devices that added the
 * same tags in different orders hold the *same* value rather than two values a
 * conflict row would offer against each other.
 */
export function cleanTags(raw: readonly unknown[]): string[] {
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const tag = cleanTag(value);
    if (tag !== '') seen.add(tag);
  }
  return [...seen].sort().slice(0, MAX_TAGS);
}

/** True when the two hold the same tags — both are already sorted. */
export function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}

/** A-4: every selected tag must be on the row. AND, not OR. */
export function hasEveryTag(tags: readonly string[], wanted: Iterable<string>): boolean {
  for (const tag of wanted) if (!tags.includes(tag)) return false;
  return true;
}
