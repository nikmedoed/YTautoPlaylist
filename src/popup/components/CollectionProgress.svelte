<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import type { CollectionState } from '../types'
  import { formatTime } from '../utils'

  const dispatch = createEventDispatcher<{ toggle: void }>()

  export let collection: CollectionState
</script>

{#if collection.active || collection.entries.length}
  <section
    id="collectionProgress"
    class={`collection${collection.collapsed ? ' collapsed' : ''}${
      !collection.active && !collection.errorMessage ? ' finished' : ''
    }${collection.errorMessage ? ' error' : ''}`}
  >
    <header>
      <div class="collection-info">
        <h4>Сбор подписок</h4>
        <span>{collection.stageTitle ?? 'Ожидание'}</span>
      </div>
      <div class="collection-actions">
        <span>{collection.counters}</span>
        <button class="secondary" type="button" on:click={() => dispatch('toggle')}>
          {collection.collapsed ? 'Показать логи' : 'Скрыть логи'}
        </button>
      </div>
    </header>
    <div class="collection-body">
      <ul class="collection-log">
        {#if !collection.entries.length}
          <li class="collection-stage__log">Логи пока отсутствуют</li>
        {:else}
          {#each collection.entries as entry (entry.id)}
            <li class="collection-stage">
              <details open>
                <summary>
                  <span class="collection-stage__title">{entry.message}</span>
                  <span class="collection-stage__meta">{formatTime(entry.timestamp)}</span>
                </summary>
                {#if entry.detail}
                  <div class="collection-stage__body">
                    <div class="collection-stage__log">{entry.detail}</div>
                  </div>
                {/if}
              </details>
            </li>
          {/each}
        {/if}
      </ul>
      {#if collection.errorMessage}
        <p class="collection-stage__log">{collection.errorMessage}</p>
      {/if}
    </div>
  </section>
{/if}
