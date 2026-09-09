<script lang="ts">
  // A-1. What a row's tags look like, and nothing more.
  //
  // They were buttons that toggled the filter until the filter moved: `#/tags`
  // is the one place a tag chooses anything now (§4.2), so a chip here is a
  // label. It is deliberately not a link to `#/tags/<tag>` either — a row is
  // dragged (T-14, T-16) and its title is typed, and a navigation sitting in
  // the middle of that is a place a thumb lands by accident.
  let { tags }: { tags: readonly string[] } = $props();
</script>

{#each tags as tag (tag)}
  <span
    class="shrink-0 rounded-full border border-line px-1.5 text-xs text-ink-muted"
    data-testid="tag-chip"
    data-tag={tag}
  >
    {tag}
  </span>
{/each}
