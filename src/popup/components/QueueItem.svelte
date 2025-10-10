<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import {
    formatDateTime,
    formatDuration,
    formatShortDate,
    resolveThumbnail,
  } from '../utils'
  import type { VideoEntry } from '../types'

  export type QueueItemEventDetail = {
    entry: VideoEntry
    index: number
    event: DragEvent
  }

  const dispatch = createEventDispatcher<{
    play: { entry: VideoEntry }
    remove: { entry: VideoEntry; event: MouseEvent }
    move: { entry: VideoEntry; event: MouseEvent }
    keyactivate: { entry: VideoEntry; event: KeyboardEvent }
    dragstart: QueueItemEventDetail
    dragover: QueueItemEventDetail
    drop: QueueItemEventDetail
    dragend: QueueItemEventDetail
  }>()

  export let entry: VideoEntry
  export let index: number
  export let active = false
  export let listId = ''

  type DragEventType = 'dragstart' | 'dragover' | 'drop' | 'dragend'

  function emitDrag(type: DragEventType, event: DragEvent) {
    dispatch(type, { entry, index, event })
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      dispatch('keyactivate', { entry, event })
    }
  }
</script>

<li
  class={`video-item${active ? ' active' : ''}`}
  data-id={entry.id}
  data-index={index}
  data-list-id={listId}
  ondragover={(event) => emitDrag('dragover', event)}
  ondrop={(event) => emitDrag('drop', event)}
>
  <button
    class="video-handle"
    type="button"
    aria-label="Перетащить видео"
    title="Перетащить видео"
    draggable="true"
    ondragstart={(event) => emitDrag('dragstart', event)}
    ondragend={(event) => emitDrag('dragend', event)}
  ></button>
  <img
    class="video-thumb"
    src={resolveThumbnail(entry)}
    alt=""
    loading="lazy"
    decoding="async"
  />
  <div
    class="video-body"
    role="button"
    tabindex="0"
    onclick={() => dispatch('play', { entry })}
    onkeydown={handleKeydown}
  >
    <div class="video-title">{entry.title}</div>
    {#if entry.channelTitle || entry.duration || entry.publishedAt || entry.addedAt}
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
        {#if entry.publishedAt}
          {#if entry.channelTitle || entry.duration}
            <span class="video-details__sep" aria-hidden="true">•</span>
          {/if}
          <span>{formatShortDate(entry.publishedAt)}</span>
        {/if}
        {#if entry.addedAt}
          {#if entry.channelTitle || entry.duration || entry.publishedAt}
            <span class="video-details__sep" aria-hidden="true">•</span>
          {/if}
          <span>добавлено {formatDateTime(entry.addedAt)}</span>
        {/if}
      </div>
    {/if}
  </div>
  <button
    class="icon-button video-move"
    type="button"
    title="Переместить в другой список"
    aria-label="Переместить в другой список"
    onclick={(event) => dispatch('move', { entry, event })}
  >
    ⇄
  </button>
  <button
    class="icon-button video-remove"
    type="button"
    title="Удалить"
    aria-label="Удалить"
    onclick={(event) => dispatch('remove', { entry, event })}
  >
    ✕
  </button>
</li>
