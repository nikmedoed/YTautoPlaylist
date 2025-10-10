<script lang="ts">
  import { MENU_ITEMS } from "../constants/menu";
</script>

<aside class="w-16 bg-base-200 p-2">
  <nav class="flex flex-col gap-4">
    {#each MENU_ITEMS as item}
      <button class="btn btn-ghost btn-square" onclick={item.action}>
        <span class="text-xl" title={item.label}>{item.icon}</span>
      </button>
    {/each}
  </nav>
</aside>
