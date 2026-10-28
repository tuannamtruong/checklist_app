import { describe, expect, it } from 'vitest';
import {
  headingAt,
  nextHeading,
  parseBody,
  pictureNames,
  pictureSplice,
  plainText,
  listEnter,
  setHeading,
  tableAt,
  tableEnter,
  spliced,
  spliceOf,
  toggleBold,
  toggleCode,
  toggleList,
  toggleTable,
  type Block,
  type Span,
} from './markup';

/** The runs of one line, with the marked ones marked. */
function marks(spans: readonly Span[]): string {
  return spans
    .map((span) => {
      // B-11: the two marks nest, so the shape nests too — `<[x]>` is a
      // bold run inside code, and `[x]` is a bold run outside it.
      const marked = span.bold ? `[${span.text}]` : span.text;
      return span.code ? `<${marked}>` : marked;
    })
    .join('');
}

/**
 * A block as `kind: text`, with the marked runs marked, which is what a test
 * asserts about. B-12's table is `table*` when the first row is the header,
 * cells split by ` | ` and rows by ` // `.
 */
function shape(blocks: readonly Block[]): string[] {
  return blocks.map((block) => {
    if (block.table) {
      const rows = block.table.rows
        .map((row) => row.cells.map((cell) => marks(cell.spans)).join(' | '))
        .join(' // ');
      return `table${block.table.header ? '*' : ''}: ${rows}`;
    }
    return `${block.kind}${
      block.list ? `(${block.list.indent}${block.list.marker})` : ''
    }: ${marks(block.spans)}`;
  });
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
    expect(shape(parseBody('## **Packing** list'))).toEqual([
      'heading2: [Packing] list',
    ]);
  });

  it('leaves an unmatched or empty mark as the characters it is', () => {
    expect(shape(parseBody('two ** asterisks'))).toEqual([
      'paragraph: two ** asterisks',
    ]);
    expect(shape(parseBody('****'))).toEqual(['paragraph: ****']);
    expect(shape(parseBody('**open'))).toEqual(['paragraph: **open']);
  });

  it('keeps one block per line, blank lines included — B-3', () => {
    expect(shape(parseBody('a\n\nb'))).toEqual([
      'paragraph: a',
      'paragraph: ',
      'paragraph: b',
    ]);
    expect(parseBody('')).toEqual([{ kind: 'paragraph', spans: [] }]);
  });
});

describe('plainText — B-5', () => {
  it('takes the marks off', () => {
    expect(plainText('# Ferry\nLeaves at **07:40**.')).toBe(
      'Ferry\nLeaves at 07:40.',
    );
  });

  it('is the identity on a body carrying no marks', () => {
    const body = 'Ferry leaves at 07:40.\n\n  Passports are in the top drawer.';
    expect(plainText(body)).toBe(body);
  });

  it('lets a search term span what a mark used to interrupt', () => {
    expect(plainText('Leaves at **07:40** sharp').includes('07:40 sharp')).toBe(
      true,
    );
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
    expect(toggleBold('buy ', 4, 4)).toEqual({
      text: 'buy ****',
      start: 6,
      end: 6,
    });
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
    expect(setHeading(body, 6, 6, 0)).toEqual({
      text: 'Ferry\nPacking\nSocks',
      start: 6,
      end: 6,
    });
  });

  it('marks the first line when the body starts with a newline', () => {
    expect(setHeading('\nSocks', 0, 0, 1).text).toBe('# \nSocks');
  });

  it('marks every line a selection touches, and keeps them all selected — B-7', () => {
    // "Ferry\nPacking" selected, which is two lines and neither of them whole.
    const marked = setHeading('Ferry\nPacking\nSocks', 0, 13, 2);
    expect(marked.text).toBe('## Ferry\n## Packing\nSocks');
    // The same words are still selected, marks and all.
    expect(marked.text.slice(marked.start, marked.end)).toBe(
      'Ferry\n## Packing',
    );
  });
});

describe('code — B-8, B-9', () => {
  it('reads a fenced block as one block, whatever is inside it', () => {
    expect(
      shape(
        parseBody(
          'before\n```\ndocker compose up\n# not a heading\n```\nafter',
        ),
      ),
    ).toEqual([
      'paragraph: before',
      'code: <docker compose up\n# not a heading>',
      'paragraph: after',
    ]);
  });

  it('reads an empty block, and a language it draws nothing with', () => {
    expect(shape(parseBody('```\n```'))).toEqual(['code: <>']);
    expect(shape(parseBody('```js\nlet a = 1\n```'))).toEqual([
      'code: <let a = 1>',
    ]);
  });

  it('leaves an unclosed fence as the characters it is', () => {
    expect(shape(parseBody('```\nstill typing'))).toEqual([
      'paragraph: ```',
      'paragraph: still typing',
    ]);
  });

  it('reads an inline run, and takes bold and no other mark inside it — B-9, B-11', () => {
    expect(shape(parseBody('comes up with one `docker compose up`.'))).toEqual([
      'paragraph: comes up with one <docker compose up>.',
    ]);
    // The backtick is read first, so the run is found before the asterisks in
    // it are — and then the run is read for bold like anything else.
    expect(shape(parseBody('`**x**`'))).toEqual(['paragraph: <[x]>']);
    expect(shape(parseBody('`# not a heading`'))).toEqual([
      'paragraph: <# not a heading>',
    ]);
  });

  it('leaves an unmatched or empty backtick as the character it is', () => {
    expect(shape(parseBody('one ` tick'))).toEqual(['paragraph: one ` tick']);
    expect(shape(parseBody('``'))).toEqual(['paragraph: ``']);
  });

  it('reads bold inside a box, a line at a time — B-11', () => {
    expect(shape(parseBody('```\nplain\n**this one**\n```'))).toEqual([
      'code: <plain\n><[this one]>',
    ]);
    // A pair cannot reach across a line break, so a lone `**` is two
    // characters and the line below it is untouched.
    expect(shape(parseBody('```\n**open\nclose**\n```'))).toEqual([
      'code: <**open\nclose**>',
    ]);
    // And every other mark in there is still a character.
    expect(shape(parseBody('```\n# comment\n- flag\n```'))).toEqual([
      'code: <# comment\n- flag>',
    ]);
  });

  it('leaves a box carrying no bold as the one span it always was — B-11', () => {
    const [block] = parseBody('```\nnpm run dev\nnpm test\n```');
    expect(block?.spans.length).toBe(1);
  });

  it('matches search on the code, not on the fences — B-5', () => {
    expect(plainText('Run this:\n```\nnpm run dev\n```\nand wait.')).toBe(
      'Run this:\nnpm run dev\nand wait.',
    );
    expect(plainText('one `docker compose up`.')).toBe(
      'one docker compose up.',
    );
    // B-11. The bold marks come off inside code exactly as they do outside it,
    // or F-1 would stop matching a line because it was pointed at.
    expect(plainText('```\nrun **this**\n```')).toBe('run this');
    expect(plainText('a `**bold**` run')).toBe('a bold run');
  });
});

describe('toggleCode — B-8, B-9', () => {
  it('wraps a run inside one line, and unwraps it again', () => {
    const wrapped = toggleCode('run docker up now', 4, 13);
    expect(wrapped).toEqual({ text: 'run `docker up` now', start: 5, end: 14 });
    expect(toggleCode(wrapped.text, wrapped.start, wrapped.end).text).toBe(
      'run docker up now',
    );
  });

  it('makes an empty box on an empty line, with the caret inside it', () => {
    const boxed = toggleCode('Notes\n\nafter', 6, 6);
    expect(boxed.text).toBe('Notes\n```\n\n```\nafter');
    expect(boxed.start).toBe(10);
    expect(boxed.end).toBe(10);
  });

  it('fences every line a selection crosses', () => {
    // "b\nc" selected, which is two lines and neither of them whole.
    const boxed = toggleCode('a\nbb\ncc\nd', 3, 6);
    expect(boxed.text).toBe('a\n```\nbb\ncc\n```\nd');
    expect(boxed.text.slice(boxed.start, boxed.end)).toBe('bb\ncc');
  });

  it('takes the fences off from inside the block', () => {
    const bare = toggleCode('a\n```\nbb\ncc\n```\nd', 8, 8);
    expect(bare.text).toBe('a\nbb\ncc\nd');
    expect(bare.start).toBe(4);
  });

  it('opens a fresh block from a fence line rather than doing nothing', () => {
    expect(toggleCode('```\nbb\n```', 1, 1).text).toBe(
      '```\n```\n```\nbb\n```',
    );
  });
});

describe('lists — B-10', () => {
  it('reads both markers, and only with the space', () => {
    expect(shape(parseBody('- Socks\n2. Boots\n-5C outside\n1.no space'))).toEqual([
      'bullet(-): Socks',
      'number(2.): Boots',
      'paragraph: -5C outside',
      'paragraph: 1.no space',
    ]);
  });

  it('keeps the indent, so a typed sub-list is one', () => {
    expect(shape(parseBody('- Socks\n  - Thick ones'))).toEqual([
      'bullet(-): Socks',
      'bullet(  -): Thick ones',
    ]);
  });

  it('reads the other marks inside an item, and none in a heading of one', () => {
    expect(shape(parseBody('- **Thick** socks\n# - not a bullet'))).toEqual([
      'bullet(-): [Thick] socks',
      'heading1: - not a bullet',
    ]);
  });

  it('matches search on the item, not on the marker — B-5', () => {
    expect(plainText('- Socks\n3. Boots')).toBe('Socks\nBoots');
  });

  it('carries the marker onto the next line, and counts', () => {
    const bullet = listEnter('- Socks', 7, 7);
    expect(bullet && spliced('- Socks', bullet).text).toBe('- Socks\n- ');
    const numbered = listEnter('3. Boots', 8, 8);
    expect(numbered && spliced('3. Boots', numbered).text).toBe('3. Boots\n4. ');
  });

  it('keeps the indent the item had', () => {
    const nested = listEnter('- Socks\n  - Thick', 17, 17);
    expect(nested && spliced('- Socks\n  - Thick', nested).text).toBe('- Socks\n  - Thick\n  - ');
  });

  it('splits the item when the caret is inside it', () => {
    const split = listEnter('- Socks and boots', 8, 8);
    expect(split && spliced('- Socks and boots', split).text).toBe('- Socks \n- and boots');
  });

  it('ends the list on Enter with nothing in the item — B-10', () => {
    const done = listEnter('- Socks\n- ', 10, 10);
    expect(done && spliced('- Socks\n- ', done)).toEqual({
      text: '- Socks\n',
      start: 8,
      end: 8,
    });
  });

  it('leaves Enter alone where a list is not what it means', () => {
    // Not a list at all, a selection, before the marker, and inside a fence.
    expect(listEnter('Socks', 5, 5)).toBe(null);
    expect(listEnter('- Socks', 3, 7)).toBe(null);
    expect(listEnter('- Socks', 1, 1)).toBe(null);
    expect(listEnter('```\n- Socks\n```', 11, 11)).toBe(null);
  });
});

describe('toggleList — B-14', () => {
  it('makes every filled line it touches an item, counting the numbers down the run', () => {
    const text = 'top\nmilk\n\n- eggs\n  bread\nend';
    const from = text.indexOf('milk');
    const to = text.indexOf('bread') + 2;
    const numbered = toggleList(text, from, to, 'number');
    expect(numbered.text).toBe('top\n1. milk\n\n2. eggs\n  3. bread\nend');
    expect(numbered.text.slice(numbered.start, numbered.end)).toBe('1. milk\n\n2. eggs\n  3. bread');
    expect(toggleList(text, from, to, 'bullet').text).toBe('top\n- milk\n\n- eggs\n  - bread\nend');
  });

  it('takes the markers off when every line already is that kind of item', () => {
    const text = '1. milk\n2. eggs';
    expect(toggleList(text, 0, text.length, 'number').text).toBe('milk\neggs');
    // The other kind is a swap rather than an undo.
    expect(toggleList(text, 0, text.length, 'bullet').text).toBe('- milk\n- eggs');
  });
});

describe('tables — B-12', () => {
  it('reads a line fenced by pipes as a row, and only that', () => {
    expect(
      shape(parseBody('| Mon | 07:40 |\nTue at 08:10\na | b\n| Wed |')),
    ).toEqual([
      'table: Mon | 07:40',
      'paragraph: Tue at 08:10',
      'paragraph: a | b',
      'table: Wed',
    ]);
  });

  it('makes one table of the rows that touch, and ends it at the first line that is not one', () => {
    expect(shape(parseBody('| a | b |\n| c | d |\n\n| e |'))).toEqual([
      'table: a | b // c | d',
      'paragraph: ',
      'table: e',
    ]);
  });

  it('takes the dashes under the first row as the header, and does not draw them', () => {
    expect(shape(parseBody('| Day | Ferry |\n| --- | --- |\n| Mon | 07:40 |'))).toEqual([
      'table*: Day | Ferry // Mon | 07:40',
    ]);
    // The alignment is read and drawn with nothing — B-8's language word.
    expect(shape(parseBody('| Day |\n| :---: |\n| Mon |'))).toEqual([
      'table*: Day // Mon',
    ]);
  });

  it('draws a rule anywhere else as the row of dashes it is', () => {
    expect(shape(parseBody('| a |\n| b |\n| --- |'))).toEqual([
      'table: a // b // ---',
    ]);
  });

  it('trims the padding a person lined the pipes up with', () => {
    expect(shape(parseBody('|  a  |b|'))).toEqual(['table: a | b']);
  });

  it('reads bold and a run of code inside a cell, and nothing else', () => {
    expect(shape(parseBody('| **Mon** | `npm test` | # not a heading |'))).toEqual([
      'table: [Mon] | <npm test> | # not a heading',
    ]);
  });

  it('leaves a pipe inside a box of code alone — B-8', () => {
    expect(shape(parseBody('```\n| a | b |\n```'))).toEqual(['code: <| a | b |>']);
  });

  it('matches search on the cells, without the pipes — B-5', () => {
    expect(plainText('| Day | Ferry |\n| --- | --- |\n| Mon | 07:40 |')).toBe(
      'Day Ferry\nMon 07:40',
    );
  });

  it('opens the next row with the cells the row had, and the caret in the first', () => {
    const body = '| Mon | 07:40 |';
    const next = tableEnter(body, 6, 6);
    expect(next && spliced(body, next)).toEqual({
      text: '| Mon | 07:40 |\n|  |  |',
      start: 18,
      end: 18,
    });
    // The caret is between the two spaces, so typing makes the row a person
    // would have typed by hand.
    const typed = spliced(body, next!);
    expect(`${typed.text.slice(0, typed.start)}x${typed.text.slice(typed.start)}`).toBe(
      '| Mon | 07:40 |\n| x |  |',
    );
  });

  it('opens it under the line rather than splitting the row', () => {
    const body = '| Mon | 07:40 |';
    const split = tableEnter(body, 3, 3);
    expect(split && spliced(body, split).text).toBe('| Mon | 07:40 |\n|  |  |');
  });

  it('takes a row with nothing in it off, which is the way out', () => {
    const body = '| Mon |\n|  |';
    const out = tableEnter(body, 11, 11);
    expect(out && spliced(body, out).text).toBe('| Mon |\n');
  });

  it('is an ordinary Enter everywhere else', () => {
    expect(tableEnter('plain line', 4, 4)).toBeNull();
    expect(tableEnter('| a | b |', 0, 4)).toBeNull();
    expect(tableEnter('```\n| a |\n```', 6, 6)).toBeNull();
  });
});

describe('cell breaks — B-15', () => {
  it('draws <br> in a cell as a line break, and searches it as a space', () => {
    const [block] = parseBody('| Mon<br>Tue | 07:40<br/>08:10 <BR /> |');
    expect(block!.table!.rows[0]!.cells.map((cell) => cell.spans[0]!.text)).toEqual([
      'Mon\nTue',
      '07:40\n08:10 \n',
    ]);
    expect(plainText('| Mon<br>Tue |')).toBe('Mon Tue');
  });

  it('is four characters outside a table', () => {
    expect(plainText('Mon<br>Tue')).toBe('Mon<br>Tue');
  });
});

describe('escaped pipes — B-16', () => {
  it('reads \\| as a pipe inside its cell rather than the edge of one', () => {
    const [block] = parseBody('| a \\| b | c |');
    expect(block!.table!.rows[0]!.cells.map((cell) => cell.spans[0]!.text)).toEqual(['a | b', 'c']);
    expect(plainText('| a \\| b | c |')).toBe('a | b c');
  });

  it('does not close a row with one', () => {
    expect(parseBody('| a \\|')[0]!.kind).toBe('paragraph');
  });
});

describe('toggleTable — B-12', () => {
  it('writes a starter table on an empty line, with the caret in the first cell', () => {
    const made = toggleTable('Ferry\n\nafter', 6, 6);
    expect(made.text).toBe('Ferry\n|  |  |\n| --- | --- |\n|  |  |\nafter');
    expect(`${made.text.slice(0, made.start)}Day${made.text.slice(made.start)}`).toBe(
      'Ferry\n| Day |  |\n| --- | --- |\n|  |  |\nafter',
    );
  });

  it('opens it under a line that has something on it, rather than wrapping it', () => {
    const made = toggleTable('Ferry times', 5, 5);
    expect(made.text).toBe('Ferry times\n|  |  |\n| --- | --- |\n|  |  |');
    expect(made.start).toBe(14);
  });

  it('takes the pipes off from inside, and the rule line with them', () => {
    const body = 'Ferry\n| Day | Ferry |\n| --- | --- |\n| Mon | 07:40 |\nafter';
    const bare = toggleTable(body, 30, 30);
    expect(bare.text).toBe('Ferry\nDay Ferry\nMon 07:40\nafter');
    // The caret was on the rule line, which is gone: it lands at the end of
    // the row that line was describing.
    expect(bare.text.slice(0, bare.start)).toBe('Ferry\nDay Ferry');
  });

  it('keeps the caret on its own row when that row survives', () => {
    const body = '| Day | Ferry |\n| Mon | 07:40 |';
    const bare = toggleTable(body, 20, 20);
    expect(bare.text).toBe('Day Ferry\nMon 07:40');
    expect(bare.text.slice(0, bare.start)).toBe('Day Ferry\nMon 07:40');
  });

  it('says where the caret is, and reads no table inside a box of code', () => {
    expect(tableAt('| a | b |', 3)).toBe(true);
    expect(tableAt('plain\n| a | b |', 3)).toBe(false);
    expect(tableAt('```\n| a | b |\n```', 6)).toBe(false);
  });
});

describe('spliceOf — B-13', () => {
  it('is the one range a control changed, and applying it gives the control\'s body back', () => {
    const before = 'Pack the boots';
    const after = toggleBold(before, 9, 14).text;
    expect(spliceOf(before, after)).toEqual({ from: 9, to: 14, insert: '**boots**' });
    for (const [a, b] of [
      [before, after],
      [after, before],
      ['aaa', 'aa'],
      ['', 'x'],
      ['same', 'same'],
    ] as const) {
      expect(spliced(a, spliceOf(a, b)).text).toBe(b);
    }
  });
});

describe('pictures — P-1, P-2', () => {
  const NAME = 'pictures/0123456789abcdef0123456789abcdef.webp';

  it('draws a line that is only the mark, with its alt text as the one span', () => {
    expect(parseBody(`![the receipt](${NAME})`)).toEqual([
      {
        kind: 'picture',
        spans: [{ text: 'the receipt', bold: false, code: false }],
        picture: { name: NAME },
      },
    ]);
    expect(parseBody(`![](${NAME})`)[0]).toMatchObject({ kind: 'picture', spans: [] });
  });

  it('is characters anywhere else, and outside pictures/', () => {
    expect(parseBody(`see ![](${NAME})`)[0]?.kind).toBe('paragraph');
    expect(parseBody('![](elsewhere/x.webp)')[0]?.kind).toBe('paragraph');
    expect(parseBody('![](pictures/../checklist.1111aaaa.ops.jsonl)')[0]?.kind).toBe('paragraph');
  });

  it('is found by its words, never by its file name — B-5', () => {
    expect(plainText(`Paid\n![the receipt](${NAME})`)).toBe('Paid\nthe receipt');
  });

  it('names every picture a body points at, and none inside a code box', () => {
    const body = `![](${NAME})\n\`\`\`\n![](pictures/in-code.webp)\n\`\`\`\n![b](pictures/b.png)`;
    expect(pictureNames(body)).toEqual([NAME, 'pictures/b.png']);
    expect(pictureNames('no pictures here')).toEqual([]);
  });

  it('types the mark on a line of its own, and leaves the caret under it', () => {
    const mark = `![](${NAME})`;
    expect(spliced('', pictureSplice('', 0, 0, NAME))).toEqual({
      text: `${mark}\n`,
      start: mark.length + 1,
      end: mark.length + 1,
    });
    // Mid-line: the line is split around it.
    expect(spliced('ab', pictureSplice('ab', 1, 1, NAME)).text).toBe(`a\n${mark}\nb`);
    // At the end of a line that has a next: the newline already there is used.
    const edited = spliced('a\nb', pictureSplice('a\nb', 1, 1, NAME));
    expect(edited.text).toBe(`a\n${mark}\nb`);
    expect(edited.start).toBe(`a\n${mark}\n`.length);
  });
});
