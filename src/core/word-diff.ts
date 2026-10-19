// Which words of two values differ — the conflict row's highlight, requirements.md §9.
//
// A longest common subsequence over words, with the whitespace between them
// kept as tokens of its own so the spans join back into exactly the strings
// that went in. Display only: nothing here decides anything a merge reads.

export interface DiffSpan {
  text: string;
  changed: boolean;
}

// ponytail: the table is O(n·m) in the words that differ after the shared
// prefix and suffix are cut; past this many cells the row draws unhighlighted.
// Myers' O((n+m)·d) diff if two long bodies that differ throughout turn out common.
const MAX_CELLS = 4_000_000;

/** `a` and `b` as spans, each word marked changed when the other side lacks it. */
export function wordDiff(a: string, b: string): { a: DiffSpan[]; b: DiffSpan[] } {
  const x = a.split(/(\s+)/).filter((t) => t !== '');
  const y = b.split(/(\s+)/).filter((t) => t !== '');

  let head = 0;
  while (head < x.length && head < y.length && x[head] === y[head]) head++;
  let tail = 0;
  while (tail < x.length - head && tail < y.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++;

  const xs = x.slice(head, x.length - tail);
  const ys = y.slice(head, y.length - tail);
  const n = xs.length;
  const m = ys.length;
  if (n * m > MAX_CELLS) return { a: [{ text: a, changed: false }], b: [{ text: b, changed: false }] };

  // lcs[i][j] is the common length of xs[i..] and ys[j..].
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] =
        xs[i] === ys[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }

  const left: DiffSpan[] = [];
  const right: DiffSpan[] = [];
  const push = (side: DiffSpan[], text: string, changed: boolean) => {
    const last = side[side.length - 1];
    if (last && last.changed === changed) last.text += text;
    else side.push({ text, changed });
  };
  const same = (text: string) => {
    push(left, text, false);
    push(right, text, false);
  };

  x.slice(0, head).forEach(same);
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && xs[i] === ys[j]) {
      same(xs[i++]);
      j++;
    } else if (j >= m || (i < n && lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) {
      push(left, xs[i++], true);
    } else {
      push(right, ys[j++], true);
    }
  }
  x.slice(x.length - tail).forEach(same);
  return { a: bridged(left), b: bridged(right) };
}

/**
 * The space between two changed words is drawn changed too, so a changed
 * phrase is one highlight rather than a row of separate ones.
 */
function bridged(spans: DiffSpan[]): DiffSpan[] {
  const out: DiffSpan[] = [];
  for (let k = 0; k < spans.length; k++) {
    const gap = spans[k];
    const prev = out[out.length - 1];
    if (prev?.changed && !gap.changed && /^\s+$/.test(gap.text) && spans[k + 1]?.changed) {
      prev.text += gap.text + spans[++k].text;
    } else if (prev && prev.changed === gap.changed) {
      prev.text += gap.text;
    } else {
      out.push({ ...gap });
    }
  }
  // A highlight starts and ends on a word, never on the space beside it.
  return out.flatMap((span) => {
    if (!span.changed) return [span];
    const [, lead, word, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(span.text)!;
    return [
      { text: lead, changed: false },
      { text: word, changed: true },
      { text: trail, changed: false },
    ].filter((part) => part.text !== '');
  });
}
