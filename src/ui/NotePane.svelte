<script lang="ts">
  // X-21 and X-22. The note, drawn beside the list above `lg` and over it below
  // — one component and one breakpoint, because a phone is a narrower desktop
  // rather than a second application (X-1). requirements.md §10.3.
  //
  // `lg` rather than X-2's `md`: the sidebar asks whether there is room for a
  // column of nav, and this asks whether there is room for two columns of
  // content. At 768px the answer is no — the list would be left with less width
  // than one of its own rows needs.
  //
  // Nothing here is a route and nothing here is stored. The pane exists because
  // the route names a note or because the caret is in one (X-30), and the one
  // piece of state it owns — whether the sheet is peeked or open — is a gesture
  // rather than a setting, so it resets whenever the pane's note changes and
  // never reaches `localStorage`.
  //
  // A caret-raised pane is the column and never the sheet: below `lg` it would
  // cover the row being typed into with the phone's keyboard under it, so the
  // caret raises nothing there and the icon still opens the sheet — §10.3.
  import { listAbove } from '../core/tree';
  import { ROOT, type NodeId } from '../core/types';
  import type { Session } from '../app/Session.svelte';
  import { NOTE_WIDTH, type ViewState } from '../app/view-state.svelte';
  import type { RowFocus } from './focus.svelte';
  import NoteBody from './NoteBody.svelte';
  import PageTitle from './PageTitle.svelte';
  import QuickAdd from './QuickAdd.svelte';
  import TagEditor from './TagEditor.svelte';
  import WidthGrip from './WidthGrip.svelte';
  import { nodeHref } from '../app/router.svelte';

  let {
    session,
    view,
    focus,
    id,
    fromCaret = false,
    onclose,
  }: {
    session: Session;
    view: ViewState;
    focus: RowFocus;
    id: NodeId;
    /** X-30. Whether the caret raised this pane rather than the route. */
    fromCaret?: boolean;
    /** What ✕ does when there is no route to leave — §10.3. */
    onclose?: () => void;
  } = $props();

  const node = $derived(session.tree.nodes[id]);

  // Closing the note is leaving the route it is on, which lands on exactly the
  // list already drawn behind it — the pane never navigates anywhere new. That
  // is `listAbove` and not the parent for the reason X-21 walks it: a note under
  // a note would otherwise close onto its parent's *pane*, which is a note
  // opening rather than a note closing.
  const list = $derived(listAbove(session.tree, id));
  const closeHref = $derived(list === ROOT ? '#/' : nodeHref(list));

  /**
   * X-22, and below `lg` only: above it the pane is a column and there is
   * nothing to expand. Reset per note — a peek is a gesture, so the next note
   * opens at its own peek rather than inheriting this one's — §10.3.
   */
  let expanded = $state(false);
  $effect(() => {
    id;
    expanded = false;
  });
</script>

<!-- Below `lg` a sheet on the bottom edge, above it a column that stays put
     while the list beside it scrolls. `max-h-[60dvh]` over an auto height is the
     whole of X-22's sizing rule: a note short enough to fit is shown whole and a
     long one is cut at 60%, with nothing measured and nothing to re-measure when
     a peer's edit changes the body under it (X-10). -->
<aside
  class="fixed inset-x-0 bottom-0 z-20 {fromCaret ? 'hidden lg:flex' : 'flex'} flex-col rounded-t-2xl border-t border-line bg-surface-raised shadow-lg
         lg:sticky lg:inset-auto lg:top-0 lg:z-auto lg:h-dvh lg:w-[var(--note-width)] lg:shrink-0
         lg:rounded-none lg:border-t-0 lg:border-l lg:shadow-none
         {expanded ? 'top-0 max-h-none' : 'max-h-[60dvh]'} lg:top-0 lg:max-h-none"
  style="--note-width: {view.notePaneWidth}px"
  aria-label="Note"
  data-testid="note-pane"
  data-expanded={expanded}
  data-from-caret={fromCaret}
>
  <!-- X-24. The divider is this pane's left edge, so the drag runs the other
       way: right is narrower. Above `lg` only — the sheet's width is the
       viewport's, and a grip on it would resize nothing. The custom property is
       what keeps the stored width out of the sheet's rules — Shell.svelte makes
       the same argument for the sidebar's. -->
  <WidthGrip
    width={view.notePaneWidth}
    min={NOTE_WIDTH.min}
    max={view.noteWidthMax}
    initial={NOTE_WIDTH.default}
    sign={-1}
    label="Resize the note"
    testid="note-resize"
    class="absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize hover:bg-accent-soft focus-visible:bg-accent-soft lg:block"
    onwidth={(px) => view.setNotePaneWidth(px)}
  />
  <!-- The grip says the sheet has somewhere to go, and says nothing at all on a
       desktop, where the pane is already as open as it gets. -->
  <div class="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line lg:hidden" aria-hidden="true"></div>

  <!-- X-31. The top row is K-8's add line, in the place the breadcrumbs held
       until the pane stopped being the note's page: the left column is the
       note's path drawn as the rows around it, so a breadcrumb here said that
       again in words and offered the reader a way out of the note they just
       opened. The line adds to the note, and the row it makes is drawn under
       the note's own row on the left — K-10's group in the place X-27 already
       puts it on a phone. -->
  <div class="flex shrink-0 items-center gap-2 px-4 py-2">
    <QuickAdd {session} {focus} parent={id} />
    <!-- Above the peek's tap layer: everything on a peeked sheet means "open
         this" except the one control that means the opposite — §10.3. -->
    {#if fromCaret}
      <!-- X-30. Nothing to navigate away from: the pane is the caret's, so
           closing it is putting the caret down. -->
      <button
        type="button"
        class="row-control relative z-20 shrink-0 rounded px-2 py-1 text-ink-faint hover:text-ink"
        aria-label="Close the note"
        data-testid="note-close"
        onclick={() => onclose?.()}
      >
        ✕
      </button>
    {:else}
      <a
        href={closeHref}
        class="row-control relative z-20 shrink-0 rounded px-2 py-1 text-ink-faint hover:text-ink"
        aria-label="Close the note"
        data-testid="note-close"
      >
        ✕
      </a>
    {/if}
  </div>

  <div
    class="flex min-h-0 flex-1 flex-col gap-4 px-4 pt-1 pb-6 lg:overflow-y-auto
           {expanded ? 'overflow-y-auto' : 'overflow-hidden'}"
  >
    <PageTitle {session} {id} />

    <TagEditor {session} {id} />

    <!-- X-31. `fill` rather than the page's floor: the pane opened to be
         written in, and a five-line field under half a window of nothing is the
         one thing it must not be. On the sheet it changes nothing — there is no
         free space to distribute under an auto height, so X-22's "as tall as
         the note" and the peek's floor both stand. -->
    {#if node?.kind === 'note'}
      <NoteBody {session} {id} compact fill />
    {/if}
  </div>

  <!-- X-22. One transparent layer over the whole peeked sheet, so a tap on the
       body, the title or the add line all mean "open it". Without it the tap
       would land in B-3's always-mounted textarea and the phone would put a
       caret and a keyboard into text the reader can see 60% of — §10.3. -->
  {#if !expanded}
    <button
      type="button"
      class="absolute inset-0 z-10 lg:hidden"
      aria-label="Open the note"
      data-testid="note-expand"
      onclick={() => (expanded = true)}
    ></button>
  {/if}
</aside>
