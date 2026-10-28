<script lang="ts">
  // P-1, P-5. One picture in a body's rendered half, or the symbol that says it
  // cannot be found — a file that is missing, has not arrived yet, or does not
  // hash to its name. It is looked for again on every cycle, which is what
  // `generation` is: a picture still on its way draws once it lands.
  import type { Pictures } from '../app/pictures.svelte';

  let { pictures, name, alt }: { pictures: Pictures; name: string; alt: string } = $props();

  /** Undefined while the first look is out, so nothing flashes "not found" on the way in. */
  let url = $state<string | null | undefined>(undefined);

  $effect(() => {
    void pictures.generation;
    let live = true;
    void pictures.url(name).then((found) => {
      if (live) url = found;
    });
    return () => {
      live = false;
    };
  });
</script>

{#if url}
  <img
    src={url}
    {alt}
    class="my-2 block max-h-[28rem] max-w-full rounded-lg border border-line"
    data-testid="picture"
  />
{:else if url === null}
  <div
    class="my-2 flex w-fit items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2 text-xs text-ink-faint"
    data-testid="picture-missing"
  >
    <svg class="size-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
      <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
      <path d="m2.5 13.5 4-4 3 3 2-2 6 6" />
      <path d="m3 3 14 14" />
    </svg>
    Picture not found
  </div>
{/if}
