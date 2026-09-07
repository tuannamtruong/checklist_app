<script lang="ts">
  // X-20 and X-24. The grip on a column's edge, and the whole of both gestures:
  // the sidebar's right edge and the note pane's left one are the same drag with
  // the sign flipped, so the second divider is a call site rather than a second
  // file.
  //
  // Pointer events rather than a mouse-only drag, for the reason T-14 uses them
  // (`drag.svelte.ts`): a tablet is wide enough for the `md` layout and has no
  // mouse at all. The capture is what makes the drag survive the pointer
  // leaving the two-pixel strip — without it, a fast drag drops on the first
  // frame that overshoots.
  //
  // It is a button carrying `role="slider"` rather than a decorated div: it is
  // focusable, the arrow keys move it a step at a time — the only way to reach
  // it without a pointing device — and what a reader announces is the width
  // itself. `Home` puts the column back where it started.
  //
  // The width itself is not held here. It is bounded and stored in
  // `view-state.svelte.ts`, so a caller cannot get a width the grip would refuse.
  let {
    width,
    min,
    max,
    initial,
    label,
    testid,
    sign = 1,
    class: klass,
    onwidth,
  }: {
    width: number;
    min: number;
    max: number;
    initial: number;
    label: string;
    testid: string;
    /** +1 when dragging right widens the column, -1 when dragging left does. */
    sign?: 1 | -1;
    class: string;
    onwidth: (px: number) => void;
  } = $props();

  /** Where the drag began, so the width tracks the pointer rather than jumping. */
  let fromX = 0;
  let fromWidth = 0;

  const STEP = 16;

  function down(event: PointerEvent): void {
    const grip = event.currentTarget as HTMLElement;
    fromX = event.clientX;
    fromWidth = width;
    grip.setPointerCapture(event.pointerId);
    // Otherwise the drag selects the text it passes over.
    event.preventDefault();
  }

  function move(event: PointerEvent): void {
    const grip = event.currentTarget as HTMLElement;
    if (!grip.hasPointerCapture(event.pointerId)) return;
    onwidth(fromWidth + sign * (event.clientX - fromX));
  }

  function up(event: PointerEvent): void {
    const grip = event.currentTarget as HTMLElement;
    if (grip.hasPointerCapture(event.pointerId)) grip.releasePointerCapture(event.pointerId);
  }

  // The keys move the *divider*, not the width: right is right on both edges,
  // which is the only reading that matches what the hand just did with it.
  function key(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft') onwidth(width - sign * STEP);
    else if (event.key === 'ArrowRight') onwidth(width + sign * STEP);
    else if (event.key === 'Home') onwidth(initial);
    else return;
    event.preventDefault();
  }
</script>

<button
  type="button"
  role="slider"
  aria-orientation="horizontal"
  aria-label={label}
  aria-valuenow={width}
  aria-valuemin={min}
  aria-valuemax={max}
  class="width-grip {klass}"
  data-testid={testid}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  onkeydown={key}
></button>
