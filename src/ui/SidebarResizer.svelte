<script lang="ts">
  // X-20. The grip on the sidebar's right edge, and the whole of the gesture.
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
  import { SIDEBAR_WIDTH, type ViewState } from '../app/view-state.svelte';

  let { view }: { view: ViewState } = $props();

  /** Where the drag began, so the width tracks the pointer rather than jumping. */
  let fromX = 0;
  let fromWidth = 0;

  const STEP = 16;

  function down(event: PointerEvent): void {
    const grip = event.currentTarget as HTMLElement;
    fromX = event.clientX;
    fromWidth = view.sidebarWidth;
    grip.setPointerCapture(event.pointerId);
    // Otherwise the drag selects the text it passes over.
    event.preventDefault();
  }

  function move(event: PointerEvent): void {
    const grip = event.currentTarget as HTMLElement;
    if (!grip.hasPointerCapture(event.pointerId)) return;
    view.setSidebarWidth(fromWidth + event.clientX - fromX);
  }

  function up(event: PointerEvent): void {
    const grip = event.currentTarget as HTMLElement;
    if (grip.hasPointerCapture(event.pointerId)) grip.releasePointerCapture(event.pointerId);
  }

  function key(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft') view.setSidebarWidth(view.sidebarWidth - STEP);
    else if (event.key === 'ArrowRight') view.setSidebarWidth(view.sidebarWidth + STEP);
    else if (event.key === 'Home') view.setSidebarWidth(SIDEBAR_WIDTH.default);
    else return;
    event.preventDefault();
  }
</script>

<button
  type="button"
  role="slider"
  aria-orientation="horizontal"
  aria-label="Resize sidebar"
  aria-valuenow={view.sidebarWidth}
  aria-valuemin={SIDEBAR_WIDTH.min}
  aria-valuemax={SIDEBAR_WIDTH.max}
  class="sidebar-grip absolute inset-y-0 -right-1 z-10 hidden w-2 cursor-col-resize hover:bg-accent-soft focus-visible:bg-accent-soft md:block"
  data-testid="sidebar-resize"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  onkeydown={key}
></button>
