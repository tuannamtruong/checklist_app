<script lang="ts">
  // K-3's full-page note body, and the two timings that keep it from flooding
  // the log.
  //
  // K-7: 1 s of quiet updates the store. S-20: an op is emitted on blur, on
  // navigating away, or after 60 s of continuous editing. A whole-body op is
  // orders of magnitude larger than a tick, so the emission trigger — not the
  // debounce — is what bounds the log's growth.
  import type { NodeId } from '../core/types';
  import type { Session } from '../app/Session.svelte';

  let { session, id }: { session: Session; id: NodeId } = $props();

  const STORE_DEBOUNCE_MS = 1_000;
  const EMIT_AFTER_MS = 60_000;

  // Filled by the effect below, which is also what keeps it in step with a body
  // that changed from outside.
  let draft = $state('');
  let typing = $state(false);
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let longEdit: ReturnType<typeof setTimeout> | null = null;

  // A body changed from outside — a peer's edit, in M2 — shows while this device
  // is not the one typing.
  $effect(() => {
    const body = session.tree.nodes[id]?.body ?? '';
    if (!typing) draft = body;
  });

  function stopTimers(): void {
    if (debounce !== null) clearTimeout(debounce);
    if (longEdit !== null) clearTimeout(longEdit);
    debounce = null;
    longEdit = null;
  }

  function onInput(): void {
    typing = true;
    if (debounce !== null) clearTimeout(debounce);
    debounce = setTimeout(() => session.stageBody(id, draft), STORE_DEBOUNCE_MS);
    if (longEdit === null) {
      longEdit = setTimeout(() => {
        session.stageBody(id, draft);
        session.commitBody(id);
        longEdit = null;
      }, EMIT_AFTER_MS);
    }
  }

  function onBlur(): void {
    stopTimers();
    typing = false;
    session.stageBody(id, draft);
    session.commitBody(id);
  }
</script>

<textarea
  bind:value={draft}
  class="min-h-64 w-full resize-y rounded-lg border border-line bg-surface-raised p-3 text-sm leading-relaxed outline-none focus:border-accent"
  placeholder="Write anything here."
  aria-label="Note body"
  data-testid="note-body"
  oninput={onInput}
  onblur={onBlur}
></textarea>
