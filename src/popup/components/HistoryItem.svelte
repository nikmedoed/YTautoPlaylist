<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { formatDateTime, formatDuration, resolveThumbnail } from '../utils'
  import type { HistoryEntry } from '../types'

  const dispatch = createEventDispatcher<{
    restore: { entry: HistoryEntry; index: number; event: MouseEvent }
  }>()

  export let entry: HistoryEntry
  export let index: number
  export let listLabel = ''
</script>

<li class="video-item" data-id={entry.id} data-position={index}>
  <img
    class="video-thumb"
    src={resolveThumbnail(entry)}
    alt=""
    loading="lazy"
    decoding="async"
  />
  <div class="video-body">
    <div class="video-title">{entry.title}</div>
    {#if entry.channelTitle || entry.duration || listLabel || entry.watchedAt}
      <div class="video-details">
        {#if entry.channelTitle}
          <span>{entry.channelTitle}</span>
        {/if}
        {#if entry.duration}
          {#if entry.channelTitle}
            <span class="video-details__sep" aria-hidden="true">•</span>
          {/if}
          <span>{formatDuration(entry.duration)}</span>
        {/if}
        {#if listLabel}
          {#if entry.channelTitle || entry.duration}
            <span class="video-details__sep" aria-hidden="true">•</span>
          {/if}
          <span class="list-label">{listLabel}</span>
        {/if}
        {#if entry.watchedAt}
          {#if entry.channelTitle || entry.duration || listLabel}
            <span class="video-details__sep" aria-hidden="true">•</span>
          {/if}
          <span>{formatDateTime(entry.watchedAt)}</span>
        {/if}
      </div>
    {/if}
  </div>
  <div class="video-actions history-actions">
    <button
      class="icon-button history-restore"
      type="button"
      title="Вернуть в очередь"
      aria-label="Вернуть в очередь"
      data-action="restore"
      onclick={(event) => dispatch('restore', { entry, index, event })}
    >
      ↺
    </button>
  </div>
</li>
