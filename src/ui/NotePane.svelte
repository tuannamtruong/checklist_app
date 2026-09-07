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
  // the route names a note, and the one piece of state it owns — whether the
  // sheet is peeked or open — is a gesture rather than a setting, so it resets
  // whenever the pane's note changes and never reaches `localStorage`.
  import { listAbove } from '../core/tree';
  import { ROOT, type NodeId } from '../core/types';
  import type { Session } from '../app/Session.svelte';
  import { NOTE_WIDTH, type ViewState } from '../app/view-state.svelte';
  import type { RowFocus } from './focus.svelte';
  import Breadcrumbs from './Breadcrumbs.svelte';
  import NoteBody from './NoteBody.svelte';
  import PageTitle from './PageTitle.svelte';
  import QuickAdd from './QuickAdd.svelte';
  import TagEditor from './TagEditor.svelte';
  import TreeView from './TreeView.svelte';
  import WidthGrip from './WidthGrip.svelte';
  import { nodeHref } from '../app/router.svelte';

  let {
    session,
    view,
    focus,
    id,
  }: { session: Session; view: ViewState; focus: RowFocus; id: NodeId } = $props();

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
  class="fixed inset-x-0 bottom-0 z-20 flex flex-col rounded-t-2xl border-t border-line bg-surface-raised shadow-lg
         lg:sticky lg:inset-auto lg:top-0 lg:z-auto lg:h-dvh lg:w-[var(--note-width)] lg:shrink-0
         lg:rounded-none lg:border-t-0 lg:border-l lg:shadow-none
         {expanded ? 'top-0 max-h-none' : 'max-h-[60dvh]'} lg:top-0 lg:max-h-none"
  style="--note-width: {view.notePaneWidth}px"
  aria-label="Note"
  data-testid="note-pane"
  data-expanded={expanded}
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

  <div class="flex shrink-0 items-center gap-2 px-4 py-2">
    <div class="min-w-0 flex-1"><Breadcrumbs {session} {id} /></div>
    <!-- Above the peek's tap layer: everything on a peeked sheet means "open
         this" except the one control that means the opposite — §10.3. -->
    <a
      href={closeHref}
      class="row-control relative z-20 shrink-0 rounded px-2 py-1 text-ink-faint hover:text-ink"
      aria-label="Close the note"
      data-testid="note-close"
    >
      ✕
    </a>
  </div>

  <div
    class="flex min-h-0 flex-1 flex-col gap-4 px-4 pt-1 pb-6 lg:overflow-y-auto
           {expanded ? 'overflow-y-auto' : 'overflow-hidden'}"
  >
    <PageTitle {session} {id} />

    <TagEditor {session} {id} />

    {#if node?.kind === 'note'}
      <NoteBody {session} {id} compact />
    {/if}

    <!-- K-4's children, and K-8's line directly above them rather than at the
         head of the pane: a pane that opened with an input would be a note you
         cannot read — requirements.md §4. A-4's bar is not repeated here; the
         page behind this one already says what is filtered, and the filter
         reaches this tree through `TreeView` regardless.

         Hidden on a peeked sheet, and hidden in CSS rather than by not being
         rendered: a peek is the note's *text*, so measuring the note's list into
         its height would put every note at X-22's 60% cap and make "as tall as
         its content" mean nothing. Above `lg` there is no peek and the list is
         always here — §10.3. -->
    <div class="flex-col gap-4 {expanded ? 'flex' : 'hidden'} lg:flex" data-testid="note-children">
      <div class="flex max-w-xl">
        <QuickAdd {session} {view} {focus} parent={id} />
      </div>

      <TreeView {session} {view} {focus} parent={id} />
    </div>
  </div>

  <!-- X-22. One transparent layer over the whole peeked sheet, so a tap on the
       body, the title or the breadcrumbs all mean "open it". Without it the tap
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
