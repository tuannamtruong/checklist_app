// Fractional index keys — sync-flow.md §5.5. A key is a base-62 string, so a
// gap between two siblings can always be subdivided; floats run out of
// precision, strings do not.
//
// The key is an integer part plus a fraction. The integer part is what makes
// appending and prepending O(1) in key length, which §5.5 asks for: a new task
// at the bottom of a list is the common operation, and a plain midpoint scheme
// grows the key on every one of them. Only an interior split grows a key.
//
// The digits are ASCII-ordered, so comparing two keys as strings compares them
// as numbers. That is the whole reason the ordering reads as a sort rather than
// a walk, and it is what lets a half-synced file cost one absent row instead of
// a truncated list — §5.1.

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZERO = DIGITS[0]!;
const LAST = DIGITS[DIGITS.length - 1]!;

/** The first key ever minted into an empty sibling list. */
export const FIRST_KEY = 'a' + ZERO;

class OrderKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderKeyError';
  }
}

/**
 * The head character encodes how many digits the integer part has: `a`..`z`
 * counts up from 2 for non-negative magnitudes, `A`..`Z` counts down for
 * negative ones. That is why a prepend can keep shortening without ever
 * colliding with an append.
 */
function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2;
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2;
  throw new OrderKeyError(`invalid order key head: ${head}`);
}

function integerPart(key: string): string {
  const length = integerLength(key[0]!);
  if (length > key.length) throw new OrderKeyError(`order key too short: ${key}`);
  return key.slice(0, length);
}

function validateInteger(int: string): void {
  if (int.length !== integerLength(int[0]!)) {
    throw new OrderKeyError(`invalid integer part of order key: ${int}`);
  }
}

/**
 * A trailing zero would give one position two spellings, and every comparison
 * in the tree assumes one position is one string.
 */
export function isOrderKey(key: string): boolean {
  try {
    validateOrderKey(key);
    return true;
  } catch {
    return false;
  }
}

function validateOrderKey(key: string): void {
  if (key === 'A' + ZERO.repeat(26)) throw new OrderKeyError(`invalid order key: ${key}`);
  const int = integerPart(key);
  const fraction = key.slice(int.length);
  if (fraction.endsWith(ZERO)) throw new OrderKeyError(`order key has a trailing zero: ${key}`);
}

function incrementInteger(x: string): string | null {
  validateInteger(x);
  const [head, ...digits] = x.split('');
  let carry = true;
  for (let i = digits.length - 1; carry && i >= 0; i--) {
    const d = DIGITS.indexOf(digits[i]!) + 1;
    if (d === DIGITS.length) digits[i] = ZERO;
    else {
      digits[i] = DIGITS[d]!;
      carry = false;
    }
  }
  if (!carry) return head + digits.join('');
  if (head === 'Z') return 'a' + ZERO;
  if (head === 'z') return null;
  const next = String.fromCharCode(head!.charCodeAt(0) + 1);
  if (next > 'a') digits.push(ZERO);
  else digits.pop();
  return next + digits.join('');
}

function decrementInteger(x: string): string | null {
  validateInteger(x);
  const [head, ...digits] = x.split('');
  let borrow = true;
  for (let i = digits.length - 1; borrow && i >= 0; i--) {
    const d = DIGITS.indexOf(digits[i]!) - 1;
    if (d === -1) digits[i] = LAST;
    else {
      digits[i] = DIGITS[d]!;
      borrow = false;
    }
  }
  if (!borrow) return head + digits.join('');
  if (head === 'a') return 'Z' + LAST;
  if (head === 'A') return null;
  const prev = String.fromCharCode(head!.charCodeAt(0) - 1);
  if (prev < 'Z') digits.push(LAST);
  else digits.pop();
  return prev + digits.join('');
}

/** A fraction strictly between two fractions, where `null` means "no bound". */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new OrderKeyError(`${a} >= ${b}`);
  if (a.endsWith(ZERO) || (b !== null && b.endsWith(ZERO))) {
    throw new OrderKeyError('midpoint of a fraction with a trailing zero');
  }
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(a[0]!) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b[0]!) : DIGITS.length;
  if (digitB - digitA > 1) return DIGITS[Math.round(0.5 * (digitA + digitB))]!;
  // The two digits are consecutive, so the answer is one digit longer.
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[digitA]! + midpoint(a.slice(1), null);
}

/**
 * A key strictly between `before` and `after`, either of which may be `null` for
 * "the start of the list" and "the end of the list".
 *
 * Two devices splitting one gap derive the *same* key, which is expected and
 * not a bug: the sort is `(order, orderBy, id)` and the tiebreak in
 * sync-flow.md §5.3 is what makes it total.
 */
export function keyBetween(before: string | null, after: string | null): string {
  if (before !== null) validateOrderKey(before);
  if (after !== null) validateOrderKey(after);
  if (before !== null && after !== null && before >= after) {
    throw new OrderKeyError(`${before} >= ${after}`);
  }

  if (before === null) {
    if (after === null) return FIRST_KEY;
    const int = integerPart(after);
    const fraction = after.slice(int.length);
    if (int === 'A' + ZERO.repeat(26)) return int + midpoint('', fraction);
    if (int < after) return int;
    const decremented = decrementInteger(int);
    if (decremented === null) throw new OrderKeyError('order keys exhausted at the start');
    return decremented;
  }

  if (after === null) {
    const int = integerPart(before);
    const fraction = before.slice(int.length);
    const incremented = incrementInteger(int);
    return incremented === null ? int + midpoint(fraction, null) : incremented;
  }

  const intBefore = integerPart(before);
  const fractionBefore = before.slice(intBefore.length);
  const intAfter = integerPart(after);
  const fractionAfter = after.slice(intAfter.length);
  if (intBefore === intAfter) return intBefore + midpoint(fractionBefore, fractionAfter);
  const incremented = incrementInteger(intBefore);
  if (incremented === null) throw new OrderKeyError('order keys exhausted at the end');
  if (incremented < after) return incremented;
  return intBefore + midpoint(fractionBefore, null);
}

/**
 * The total order over siblings — T-2. The key alone is not total, because two
 * devices can mint one key concurrently; device id then node id close it, and
 * every device computes the identical result — sync-flow.md §5.3.
 */
export function compareSiblings(
  a: { order: string; orderBy: string; id: string },
  b: { order: string; orderBy: string; id: string },
): number {
  if (a.order !== b.order) return a.order < b.order ? -1 : 1;
  if (a.orderBy !== b.orderBy) return a.orderBy < b.orderBy ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}
