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

  function emitDrag(type: 'dragstart' | 'dragover' | 'drop' | 'dragend', event: DragEvent) {
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
  draggable="true"
  ondragstart={(event) => emitDrag('dragstart', event)}
  ondragover={(event) => emitDrag('dragover', event)}
  ondrop={(event) => emitDrag('drop', event)}
  ondragend={(event) => emitDrag('dragend', event)}
>
  <button
    class="video-handle"
    type="button"
    aria-label="Перетащить видео"
    title="Перетащить видео"
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
    <div class="video-details">
      {#if entry.channelTitle}
        <span>{entry.channelTitle}</span>
      {/if}
      {#if entry.duration}
        <span>{formatDuration(entry.duration)}</span>
      {/if}
      {#if entry.publishedAt}
        <span>{formatShortDate(entry.publishedAt)}</span>
      {/if}
      {#if entry.addedAt}
        <span>добавлено {formatDateTime(entry.addedAt)}</span>
      {/if}
    </div>
  </div>
  <button
    class="video-move"
    type="button"
    title="Переместить в другой список"
    aria-label="Переместить в другой список"
    onclick={(event) => dispatch('move', { entry, event })}
  >
    ⋮
  </button>
  <button
    class="video-remove"
    type="button"
    title="Удалить"
    aria-label="Удалить"
    onclick={(event) => dispatch('remove', { entry, event })}
  >
    ×
  </button>
</li>
