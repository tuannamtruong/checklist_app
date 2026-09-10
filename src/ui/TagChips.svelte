<script lang="ts">
  // A-1 and A-10. What a row's tags look like, and where tapping one goes.
  //
  // They were buttons that toggled a filter until the filter moved, then labels
  // that did nothing at all: `#/tags` is the one place a tag *narrows* anything
  // (§4.2), and a chip here is the way to that page rather than a second way of
  // choosing. Seeing `errand` on a row and wanting the rest of `errand` is one
  // question, and the chip is where the reader already is when they ask it.
  //
  // One tag, never the chosen set — the page's own chips are where AND-ing
  // belongs, or a chip on a row would mean two different things depending on a
  // page the reader may not have visited.
  //
  // A-9: the colour is the tag's own, derived from its name — `tagTint` picks
  // the sixteenth of the wheel and `.tag-chip` in `src/app.css` says what that
  // looks like. Nothing here names a colour, and nothing anywhere stores one.
  import { tagTint } from '../core/tag-colour';
  import { tagsHref } from '../app/router.svelte';

  // T-14 is driven by pointer events over a grip, and a browser drags a link by
  // itself: without this, grabbing a row by a chip would start the browser's own
  // link drag over the top of ours. `draggable="false"` is the same idea, and it
  // is the attribute Firefox ignores.


  let { tags }: { tags: readonly string[] } = $props();
</script>

{#each tags as tag (tag)}
  <a
    href={tagsHref([tag])}
    class="tag-chip shrink-0 rounded-full border px-1.5 text-xs hover:brightness-110"
    style="--tag-tint: {tagTint(tag)}"
    data-testid="tag-chip"
    data-tag={tag}
    title="Rows tagged {tag}"
    ondragstart={(event) => event.preventDefault()}
  >
    {tag}
  </a>
{/each}
