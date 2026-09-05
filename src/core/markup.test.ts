import { describe, expect, it } from 'vitest';
import {
  headingAt,
  nextHeading,
  parseBody,
  plainText,
  setHeading,
  toggleBold,
  type Block,
} from './markup';

/** A block as `kind: text`, with the bold runs marked, which is what a test asserts about. */
function shape(blocks: readonly Block[]): string[] {
  return blocks.map(
    (block) =>
      `${block.kind}: ${block.spans.map((span) => (span.bold ? `[${span.text}]` : span.text)).join('')}`,
  );
}

describe('parseBody — B-1', () => {
  it('reads the two heading levels, and only with the space', () => {
    expect(shape(parseBody('# Ferry\n## Packing\n#errand\nplain'))).toEqual([
      'heading1: Ferry',
      'heading2: Packing',
      'paragraph: #errand',
      'paragraph: plain',
    ]);
  });

  it('reads a bold run, and the text either side of it', () => {
    expect(shape(parseBody('Leaves at **07:40** sharp'))).toEqual([
      'paragraph: Leaves at [07:40] sharp',
    ]);
  });

  it('reads bold inside a heading', () => {
    expect(shape(parseBody('## **Packing** list'))).toEqual(['heading2: [Packing] list']);
  });

  it('leaves an unmatched or empty mark as the characters it is', () => {
    expect(shape(parseBody('two ** asterisks'))).toEqual(['paragraph: two ** asterisks']);
    expect(shape(parseBody('****'))).toEqual(['paragraph: ****']);
    expect(shape(parseBody('**open'))).toEqual(['paragraph: **open']);
  });

  it('keeps one block per line, blank lines included — B-3', () => {
    expect(shape(parseBody('a\n\nb'))).toEqual(['paragraph: a', 'paragraph: ', 'paragraph: b']);
    expect(parseBody('')).toEqual([{ kind: 'paragraph', spans: [] }]);
  });
});

describe('plainText — B-5', () => {
  it('takes the marks off', () => {
    expect(plainText('# Ferry\nLeaves at **07:40**.')).toBe('Ferry\nLeaves at 07:40.');
  });

  it('is the identity on a body carrying no marks', () => {
    const body = 'Ferry leaves at 07:40.\n\n  Passports are in the top drawer.';
    expect(plainText(body)).toBe(body);
  });

  it('lets a search term span what a mark used to interrupt', () => {
    expect(plainText('Leaves at **07:40** sharp').includes('07:40 sharp')).toBe(true);
  });
});

describe('toggleBold — B-4', () => {
  it('wraps the selection and keeps it selected', () => {
    expect(toggleBold('buy milk today', 4, 8)).toEqual({
      text: 'buy **milk** today',
      start: 6,
      end: 10,
    });
  });

  it('unwraps a selection that carries the marks', () => {
    expect(toggleBold('buy **milk** today', 4, 12)).toEqual({
      text: 'buy milk today',
      start: 4,
      end: 8,
    });
  });

  it('unwraps when the marks sit just outside the selection', () => {
    expect(toggleBold('buy **milk** today', 6, 10)).toEqual({
      text: 'buy milk today',
      start: 4,
      end: 8,
    });
  });

  it('inserts the pair and sits between the halves when nothing is selected', () => {
    expect(toggleBold('buy ', 4, 4)).toEqual({ text: 'buy ****', start: 6, end: 6 });
  });
});

describe('setHeading — B-4', () => {
  const body = 'Ferry\n## Packing\nSocks';

  it('reads the level the caret is on', () => {
    expect(headingAt(body, 0)).toBe(0);
    expect(headingAt(body, 8)).toBe(2);
    expect(headingAt(body, body.length)).toBe(0);
  });

  it('cycles the levels, which is what one control means — B-4', () => {
    expect([nextHeading(0), nextHeading(1), nextHeading(2)]).toEqual([1, 2, 0]);
  });

  it('marks the line the caret is on and nothing else', () => {
    expect(setHeading(body, 2, 2, 1)).toEqual({
      text: '# Ferry\n## Packing\nSocks',
      start: 4,
      end: 4,
    });
  });

  it('replaces a level rather than stacking one', () => {
    expect(setHeading(body, 10, 10, 1).text).toBe('Ferry\n# Packing\nSocks');
  });

  it('takes the mark off at level 0, and keeps the caret on the line', () => {
    expect(setHeading(body, 6, 6, 0)).toEqual({ text: 'Ferry\nPacking\nSocks', start: 6, end: 6 });
  });

  it('marks the first line when the body starts with a newline', () => {
    expect(setHeading('\nSocks', 0, 0, 1).text).toBe('# \nSocks');
  });

  it('marks every line a selection touches, and keeps them all selected — B-7', () => {
    // "Ferry\nPacking" selected, which is two lines and neither of them whole.
    const marked = setHeading('Ferry\nPacking\nSocks', 0, 13, 2);
    expect(marked.text).toBe('## Ferry\n## Packing\nSocks');
    // The same words are still selected, marks and all.
    expect(marked.text.slice(marked.start, marked.end)).toBe('Ferry\n## Packing');
  });
});
