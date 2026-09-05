// B-7. Where a run of a textarea's own text sits on the screen.
//
// A textarea has no range geometry: `Range` and `getClientRects` see one
// replaced element, not the lines inside it, so there is no way to ask a field
// where its third word is. The text is therefore laid out a second time in a
// mirror element wearing the field's own metrics, and the run is measured
// there — which is exact for wrapped lines too, because the mirror wraps at the
// same width the field does.
//
// This is a UI module and not a logic one: it reads the document, which
// code-standard.md §3 forbids below the shell.

/** Everything that can move a glyph. Anything else is decoration. */
const METRICS = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontVariant',
  'letterSpacing',
  'wordSpacing',
  'lineHeight',
  'textTransform',
  'textIndent',
  'tabSize',
] as const;

export interface TextRect {
  /** Viewport coordinates, so a `fixed` element can use them unchanged. */
  top: number;
  left: number;
  height: number;
}

/**
 * The top-left of the run starting at `start`, and the height of its first
 * line. A selection spanning several lines is measured from where it begins,
 * because that is where the eye is and where the control has to appear.
 *
 * Returns null when the field cannot be measured — detached, or display:none —
 * rather than a rect at the origin, which would put a control in the corner.
 */
export function textRect(field: HTMLTextAreaElement, start: number): TextRect | null {
  const box = field.getBoundingClientRect();
  if (box.width === 0 && box.height === 0) return null;

  const style = getComputedStyle(field);
  const mirror = document.createElement('div');
  for (const property of METRICS) mirror.style[property] = style[property];
  // The mirror carries no padding or border of its own: the field's are added
  // to the answer below, which keeps this correct whatever the box-sizing is.
  mirror.style.position = 'absolute';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.width = `${contentWidth(field, style)}px`;

  const before = document.createTextNode(field.value.slice(0, start));
  const marker = document.createElement('span');
  // One character, so the span has a line box to be measured on. A caret at the
  // end of the text sits on a line that holds nothing otherwise.
  marker.textContent = field.value.slice(start, start + 1) || '.';
  mirror.append(before, marker, document.createTextNode(field.value.slice(start + 1) + '.'));
  document.body.append(mirror);

  const top = marker.offsetTop;
  const left = marker.offsetLeft;
  const height = marker.offsetHeight;
  mirror.remove();

  return {
    top: box.top + edge(style, 'Top') + top - field.scrollTop,
    left: box.left + edge(style, 'Left') + left - field.scrollLeft,
    height,
  };
}

/** Where the text starts inside the field: its border plus its padding. */
function edge(style: CSSStyleDeclaration, side: 'Top' | 'Left'): number {
  return (
    parseFloat(style[`border${side}Width`] || '0') + parseFloat(style[`padding${side}`] || '0')
  );
}

/** `clientWidth` already excludes the border and the scrollbar; padding is ours to drop. */
function contentWidth(field: HTMLTextAreaElement, style: CSSStyleDeclaration): number {
  const padding = parseFloat(style.paddingLeft || '0') + parseFloat(style.paddingRight || '0');
  return Math.max(0, field.clientWidth - padding);
}
