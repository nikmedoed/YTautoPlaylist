<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import type { HistoryEntry } from '../types'
  import { formatDateTime, formatDuration, resolveThumbnail } from '../utils'

  export type HistoryListItem = {
    item: HistoryEntry
    index: number
    listLabel: string | null
  }

  const dispatch = createEventDispatcher<{
    restore: { entry: HistoryEntry; position: number; event: Event }
  }>()

  const { items = [] } = $props<{ items?: HistoryListItem[] }>()
</script>

{#if items.length}
  <ul id="historyList" class="video-list">
    {#each items as { item, index, listLabel } (item.id + index)}
      <li class="video-item" data-id={item.id} data-position={index}>
        <img
          class="video-thumb"
          src={resolveThumbnail(item)}
          alt=""
          loading="lazy"
          decoding="async"
        />
        <div class="video-body">
          <div class="video-title">{item.title}</div>
          <div class="video-details">
            {#if item.channelTitle}
              <span>{item.channelTitle}</span>
            {/if}
            {#if item.duration}
              <span>{formatDuration(item.duration)}</span>
            {/if}
            {#if listLabel}
              <span class="list-label">{listLabel}</span>
            {/if}
            {#if item.watchedAt}
              <span>{formatDateTime(item.watchedAt)}</span>
            {/if}
          </div>
        </div>
        <button
          class="history-restore"
          type="button"
          title="Вернуть в очередь"
          aria-label="Вернуть в очередь"
          onclick={(event) => dispatch('restore', { entry: item, position: index, event })}
        >
          ↺
        </button>
      </li>
    {/each}
  </ul>
{:else}
  <p class="empty">Истории пока нет</p>
{/if}
