<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import type { PlaylistListMeta, VideoEntry } from '../types'
  import {
    formatDateTime,
    formatDuration,
    formatShortDate,
    resolveThumbnail,
  } from '../utils'

  const dispatch = createEventDispatcher<{
    play: { entry: VideoEntry }
    remove: { entry: VideoEntry; event: MouseEvent }
    move: { entry: VideoEntry; targetListId: string }
    requestMenuToggle: { entry: VideoEntry; event: MouseEvent }
    keypress: { entry: VideoEntry; event: KeyboardEvent }
    dragstart: { entry: VideoEntry; element: HTMLLIElement; event: DragEvent }
    dragover: { entry: VideoEntry; element: HTMLLIElement; event: DragEvent }
    drop: { entry: VideoEntry; element: HTMLLIElement; event: DragEvent }
    dragend: { entry: VideoEntry; element: HTMLLIElement; event: DragEvent }
  }>()

  const {
    entry,
    active = false,
    listId = null,
    menuOpen = false,
    moveTargets = [],
  } = $props<{
    entry: VideoEntry
    active?: boolean
    listId?: string | null
    menuOpen?: boolean
    moveTargets?: PlaylistListMeta[]
  }>()

  let element: HTMLLIElement | null = null

  function handlePlay(event: MouseEvent) {
    event.stopPropagation()
    dispatch('play', { entry })
  }

  function handleBodyKeydown(event: KeyboardEvent) {
    dispatch('keypress', { entry, event })
  }

  function handleRemove(event: MouseEvent) {
    event.stopPropagation()
    dispatch('remove', { entry, event })
  }

  function toggleMenu(event: MouseEvent) {
    event.stopPropagation()
    dispatch('requestMenuToggle', { entry, event })
  }

  function handleMove(targetListId: string) {
    if (!targetListId) return
    dispatch('move', { entry, targetListId })
  }

  function forwardDrag(
    type: 'dragstart' | 'dragover' | 'drop' | 'dragend',
    event: DragEvent,
  ) {
    if (!element) return
    dispatch(type, { entry, element, event } as never)
  }
</script>

<li
  class={`video-item${active ? ' active' : ''}`}
  bind:this={element}
  data-id={entry.id}
  data-list-id={listId ?? ''}
  draggable={true}
  on:dragstart={(event) => forwardDrag('dragstart', event)}
  on:dragover={(event) => forwardDrag('dragover', event)}
  on:drop={(event) => forwardDrag('drop', event)}
  on:dragend={(event) => forwardDrag('dragend', event)}
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
    on:click={handlePlay}
    on:keydown={handleBodyKeydown}
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
    data-menu-open={menuOpen ? '1' : '0'}
    on:click={toggleMenu}
  >
    ⋮
  </button>
  <button
    class="video-remove"
    type="button"
    title="Удалить"
    aria-label="Удалить"
    on:click={handleRemove}
  >
    ×
  </button>
  {#if menuOpen}
    <div class="video-move-menu">
      {#if moveTargets.length}
        <span class="video-move-menu__title">Переместить в...</span>
        <ul>
          {#each moveTargets as target (target.id)}
            <li>
              <button type="button" on:click={() => handleMove(target.id)}>
                {target.name}
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <span class="video-move-menu__empty">Других списков нет</span>
      {/if}
    </div>
  {/if}
</li>

<style>
  .video-move-menu {
    position: absolute;
    right: 8px;
    bottom: 36px;
    background: rgba(17, 17, 17, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 180px;
    box-shadow: 0 12px 24px rgba(0, 0, 0, 0.45);
    z-index: 10;
  }

  .video-move-menu__title {
    font-size: 12px;
    opacity: 0.8;
  }

  .video-move-menu ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .video-move-menu button {
    width: 100%;
    background: #d32f2f;
    border-radius: 4px;
    padding: 6px 8px;
    font-size: 12px;
  }

  .video-move-menu button:hover {
    background: #f44336;
  }

  .video-move-menu__empty {
    font-size: 12px;
    opacity: 0.65;
  }
</style>
