import { describe, expect, it } from 'vitest';
import { splitPastedTitles } from './paste';

describe('splitPastedTitles', () => {
  it('makes one title per line', () => {
    expect(splitPastedTitles('Milk\nBread\nEggs')).toEqual(['Milk', 'Bread', 'Eggs']);
  });

  it('reads every line ending the same way', () => {
    expect(splitPastedTitles('Milk\r\nBread\rEggs')).toEqual(['Milk', 'Bread', 'Eggs']);
  });

  it('drops the blank lines a double-spaced paragraph carries', () => {
    expect(splitPastedTitles('Milk\n\n  \nBread\n')).toEqual(['Milk', 'Bread']);
  });

  it('trims what the document indented with', () => {
    expect(splitPastedTitles('  Milk \n\tBread')).toEqual(['Milk', 'Bread']);
  });

  it('is one title when there is one line, and none when there is nothing', () => {
    expect(splitPastedTitles('Milk')).toEqual(['Milk']);
    expect(splitPastedTitles('   \n\n')).toEqual([]);
  });
});
