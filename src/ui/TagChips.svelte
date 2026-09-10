<script lang="ts">
  // A-1. What a row's tags look like, and nothing more.
  //
  // They were buttons that toggled the filter until the filter moved: `#/tags`
  // is the one place a tag chooses anything now (§4.2), so a chip here is a
  // label. It is deliberately not a link to `#/tags/<tag>` either — a row is
  // dragged (T-14, T-16) and its title is typed, and a navigation sitting in
  // the middle of that is a place a thumb lands by accident.
  //
  // A-9: the colour is the tag's own, derived from its name — `tagTint` picks
  // the twelfth of the wheel and `.tag-chip` in `src/app.css` says what that
  // looks like. Nothing here names a colour, and nothing anywhere stores one.
  import { tagTint } from '../core/tag-colour';

  let { tags }: { tags: readonly string[] } = $props();
</script>

{#each tags as tag (tag)}
  <span
    class="tag-chip shrink-0 rounded-full border px-1.5 text-xs"
    style="--tag-tint: {tagTint(tag)}"
    data-testid="tag-chip"
    data-tag={tag}
  >
    {tag}
  </span>
{/each}
