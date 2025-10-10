<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import type { PlaylistListMeta } from '../types'
  import { formatListName } from '../utils'

  const dispatch = createEventDispatcher<{ change: { listId: string }; manage: void }>()

  const { lists = [], selectedId = '', disabled = false } = $props<{
    lists?: PlaylistListMeta[]
    selectedId?: string
    disabled?: boolean
  }>()
</script>

<div class="list-bar">
  <label for="listSelect">Список</label>
  <select
    id="listSelect"
    value={selectedId}
    disabled={disabled}
    onchange={(event) =>
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
  <button class="secondary" type="button" onclick={() => dispatch('manage')}>
    Управление списками
  </button>
</div>
