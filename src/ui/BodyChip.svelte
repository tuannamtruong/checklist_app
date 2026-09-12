<script lang="ts">
  // X-39. A task's way into its own body — K-12.
  //
  // A folder and a note are opened by the kind icon at the head of the row,
  // which is a link. A task's head is the checkbox, and a checkbox means `done`:
  // a second meaning on the one control a checklist is pressed for is the last
  // place a new one belongs. So this sits in the strip right of the title, with
  // A-1's tags and A-2's flag, and it is drawn on every task rather than only on
  // the ones with text in them — a way in that appears once there is something
  // behind it cannot be used to put the first thing behind it, and on a phone
  // there is nothing else: X-30's caret raises no sheet below `lg`.
  //
  // An `<a>` and never a button, so the route, Back, a middle click and X-8's
  // deep link are the browser's rather than this component's — the same argument
  // `TagChips` makes for the link on a tag. requirements.md §10.3.
  import { nodeHref } from '../app/router.svelte';
  import type { NodeId } from '../core/types';

  let {
    id,
    title,
    filled,
  }: {
    id: NodeId;
    /** For the label alone: what a screen reader is told it is opening. */
    title: string;
    /** Whether there is text behind it — one shade, never a second glyph. */
    filled: boolean;
  } = $props();

  // The colour says the state and the label says it again in words: a shade is
  // not something a screen reader can read, and A-9 makes the same argument
  // about a tag's tint.
  const label = $derived(
    filled ? `Open the note on ${title || 'untitled'}` : `Add a note to ${title || 'untitled'}`,
  );
</script>

<a
  href={nodeHref(id)}
  class="row-control row-icon shrink-0 hover:text-accent {filled ? 'text-ink-muted' : 'text-ink-faint'}"
  aria-label={label}
  title={label}
  data-testid="body-chip"
  data-has-body={filled}
  ondragstart={(event) => event.preventDefault()}
>
  <!-- Lines of text, which is the note icon's own bottom half: the two are the
       same thing drawn at two sizes, and neither of them is the kind icon a task
       already spends on its checkbox. -->
  <svg class="size-[1rem]" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="M4.5 6h11M4.5 10h11M4.5 14h6.5"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
    />
  </svg>
</a>
