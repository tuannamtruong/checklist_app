// A-9. Which of the twelve tints a tag draws in — requirements.md §4.1.
//
// The colour is a function of the tag's own name, so it is the same on every
// device, in every view and after every reload without anything being stored,
// merged or chosen: two devices that have never spoken draw `errand` in the
// same tint because they hashed the same six letters. A stored colour would be
// a second field with a merge rule, for a decoration.
//
// **This returns a number, never a colour.** `src/app.css` is what decides what
// the twelve tints look like, exactly as it decides what `accent` looks like —
// a component that named a colour would be the bug, and so would this
// (§10.1 Themes). The number is a hue bucket: one of twelve steps around the
// wheel, which is far enough apart to tell two chips apart at a glance and few
// enough that the same tint means the same tag rather than a near-miss.

/** Twelve steps of 30°, which is what `.tag-chip` in `src/app.css` multiplies by. */
export const TAG_TINTS = 12;

/**
 * The tint for a tag, from the tag itself.
 *
 * FNV-1a because it is four lines, has no dependencies and scatters short
 * strings that differ by one letter — `town` and `towns` want different tints.
 * Nothing here reads a clock, a random source or storage, which is what makes
 * the colour reproducible rather than merely stable within one session.
 *
 * The tag is expected to be in `src/core/tags.ts`'s normal form, which every
 * tag in the store is: it is cleaned at the decoder as well as at the input, so
 * `Work` and `work` are one tag long before they reach a chip.
 */
export function tagTint(tag: string): number {
  let hash = 0x811c9dc5;
  for (let at = 0; at < tag.length; at += 1) {
    hash ^= tag.charCodeAt(at);
    // The FNV prime, as shifts: `hash * 16777619` overflows a double's exact
    // range, and `Math.imul` keeps it a 32-bit multiply on every engine.
    hash = Math.imul(hash, 0x01000193);
  }
  // `>>> 0` first: the hash is a signed 32-bit integer by now, and a negative
  // remainder would be a thirteenth tint that no CSS rule declares.
  return (hash >>> 0) % TAG_TINTS;
}
