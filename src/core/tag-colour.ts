// A-9. Which of the sixteen tints a tag draws in — requirements.md §4.1.
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
// (§10.1 Themes). The number is a hue bucket: one of sixteen steps around an
// `oklch` wheel, which is far enough apart to tell two chips apart at a glance
// and few enough that the same tint means the same tag rather than a near-miss.
// The steps are even *by perception* rather than by `hsl` degree, which is what
// makes a blue, a teal and a purple as likely and as strong as a red — half an
// `hsl` wheel at one saturation is red through green, so an even sixteenth of
// it was not an even sixteenth of what anybody saw.

/** Sixteen steps of 22.5°, which is what `.tag-chip` in `src/app.css` multiplies by. */
export const TAG_TINTS = 16;

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
  // The remainder reads the low bits, and an FNV-1a's low bits are the ones it
  // mixes worst: eight ordinary tags landed on four tints, which is what "they
  // are all red or green" looked like from the outside. One avalanche step —
  // xor-shift, multiply, xor-shift, the finaliser shape — scatters the whole
  // word down into them before the bucket is taken. It is still a pure function
  // of the name, which is the only property A-9 needs of it.
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x2545f491);
  hash ^= hash >>> 13;
  // `>>> 0` first: the hash is a signed 32-bit integer by now, and a negative
  // remainder would be a seventeenth tint that no CSS rule declares.
  return (hash >>> 0) % TAG_TINTS;
}
