<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import type { PlaylistListMeta } from '../types'
  import { formatListName } from '../utils'

  const dispatch = createEventDispatcher<{ change: { listId: string }; manage: void }>()

  export let lists: PlaylistListMeta[] = []
  export let selectedId = ''
  export let disabled = false
</script>

<div class="list-bar">
  <label for="listSelect">Список</label>
  <select
    id="listSelect"
    bind:value={selectedId}
    disabled={disabled}
    on:change={(event) =>
      dispatch('change', { listId: (event.currentTarget as HTMLSelectElement).value })
    }
  >
    {#if !lists.length}
      <option value="">Списки не найдены</option>
    {:else}
      {#each lists as list (list.id)}
        <option value={list.id}>
          {list.id === 'default' ? list.name : formatListName(list.name, list.freeze)}
        </option>
      {/each}
    {/if}
  </select>
  <button class="secondary" type="button" on:click={() => dispatch('manage')}>
    Управление списками
  </button>
</div>
