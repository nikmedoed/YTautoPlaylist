<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte'
  import type { PlaylistListMeta, VideoEntry } from '../types'
  import QueueVideoItem from './QueueVideoItem.svelte'

  export type QueueReorderEvent = { videoId: string; targetIndex: number }

  const dispatch = createEventDispatcher<{
    play: { entry: VideoEntry }
    remove: { entry: VideoEntry; event: MouseEvent }
    move: { entry: VideoEntry; targetListId: string }
    reorder: QueueReorderEvent
    keypress: { entry: VideoEntry; event: KeyboardEvent }
  }>()

  const {
    items = [],
    activeVideoId = null,
    currentListId = null,
    moveTargets = [],
  } = $props<{
    items?: VideoEntry[]
    activeVideoId?: string | null
    currentListId?: string | null
    moveTargets?: PlaylistListMeta[]
  }>()

  let listElement = $state<HTMLUListElement | null>(null)
  let openMenuVideoId = $state<string | null>(null)
  let dropIndicator: HTMLDivElement | null = null
  let dropLine: HTMLDivElement | null = null
  let currentDragElement: HTMLLIElement | null = null
  let currentHoverElement: HTMLLIElement | null = null

  const dragState = {
    videoId: null as string | null,
    dropIndex: null as number | null,
  }

  function ensureDropIndicator() {
    if (!listElement) return
    if (!dropIndicator) {
      dropIndicator = document.createElement('div')
      dropIndicator.className = 'queue-drop-indicator'
    }
    if (!dropLine) {
      dropLine = document.createElement('div')
      dropLine.className = 'queue-drop-indicator__line'
      dropIndicator.appendChild(dropLine)
    }
    if (!dropIndicator.parentElement) {
      listElement.appendChild(dropIndicator)
    }
  }

  function resetDragVisuals() {
    if (currentDragElement) {
      currentDragElement.classList.remove('dragging')
      currentDragElement = null
    }
    if (currentHoverElement) {
      currentHoverElement.classList.remove('drop-before', 'drop-after')
      currentHoverElement = null
    }
    if (dropIndicator?.parentElement) {
      dropIndicator.remove()
    }
    dragState.videoId = null
    dragState.dropIndex = null
  }

  function handleReorderStart(detail: {
    entry: VideoEntry
    element: HTMLLIElement
    event: DragEvent
  }) {
    const { entry, element, event } = detail
    const handle = event
      .composedPath()
      .find(
        (node): node is HTMLElement =>
          node instanceof HTMLElement && node.classList.contains('video-handle'),
      )
    if (!handle) {
      event.preventDefault()
      return
    }
    dragState.videoId = entry.id
    dragState.dropIndex = Array.from(listElement?.children ?? []).indexOf(element)
    currentDragElement = element
    element.classList.add('dragging')
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', entry.id)
    }
  }

  function handleReorderOver(detail: {
    element: HTMLLIElement
    event: DragEvent
  }) {
    if (!dragState.videoId || !listElement) return
    const { element, event } = detail
    if (!element) return
    if (!listElement.contains(element)) return
    event.preventDefault()
    if (element === currentDragElement) {
      if (currentHoverElement && currentHoverElement !== element) {
        currentHoverElement.classList.remove('drop-before', 'drop-after')
        currentHoverElement = null
      }
      if (dropIndicator?.parentElement) {
        dropIndicator.remove()
      }
      return
    }
    const items = Array.from(listElement.querySelectorAll<HTMLLIElement>('.video-item'))
    const index = items.indexOf(element)
    if (index === -1) return
    const rect = element.getBoundingClientRect()
    const before = event.clientY - rect.top < rect.height / 2
    element.classList.toggle('drop-before', before)
    element.classList.toggle('drop-after', !before)
    if (currentHoverElement && currentHoverElement !== element) {
      currentHoverElement.classList.remove('drop-before', 'drop-after')
    }
    currentHoverElement = element
    dragState.dropIndex = before ? index : index + 1
    ensureDropIndicator()
    if (dropIndicator) {
      const top = element.offsetTop + (before ? 0 : element.offsetHeight)
      dropIndicator.style.top = `${top}px`
    }
  }

  function handleReorderDrop(detail: { event: DragEvent }) {
    detail.event.preventDefault()
    if (!dragState.videoId || dragState.dropIndex === null) {
      resetDragVisuals()
      return
    }
    const payload = {
      videoId: dragState.videoId,
      targetIndex: dragState.dropIndex,
    }
    resetDragVisuals()
    dispatch('reorder', payload)
  }

  function handleReorderEnd() {
    resetDragVisuals()
  }

  function handlePlay(event: CustomEvent<{ entry: VideoEntry }>) {
    dispatch('play', event.detail)
  }

  function handleRemove(event: CustomEvent<{ entry: VideoEntry; event: MouseEvent }>) {
    dispatch('remove', event.detail)
  }

  function handleMove(event: CustomEvent<{ entry: VideoEntry; targetListId: string }>) {
    openMenuVideoId = null
    dispatch('move', event.detail)
  }

  function handleKeypress(event: CustomEvent<{ entry: VideoEntry; event: KeyboardEvent }>) {
    dispatch('keypress', event.detail)
  }

  function handleMenuToggle(event: CustomEvent<{ entry: VideoEntry; event: MouseEvent }>) {
    event.detail.event.stopPropagation()
    const id = event.detail.entry.id
    openMenuVideoId = openMenuVideoId === id ? null : id
  }

  function closeMenu(event?: MouseEvent) {
    if (event) {
      const target = event.target as HTMLElement | null
      if (target?.closest('.video-move-menu')) {
        return
      }
    }
    if (openMenuVideoId !== null) {
      openMenuVideoId = null
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      closeMenu()
    }
  }

  onDestroy(() => {
    if (dropIndicator?.parentElement) {
      dropIndicator.remove()
    }
  })
</script>

<svelte:window onclick={closeMenu} onkeydown={handleWindowKeydown} />

{#if items.length}
  <ul class="video-list" bind:this={listElement}>
    {#each items as item (item.id)}
      <QueueVideoItem
        entry={item}
        active={item.id === activeVideoId}
        listId={currentListId}
        moveTargets={moveTargets}
        menuOpen={openMenuVideoId === item.id}
        on:play={handlePlay}
        on:remove={handleRemove}
        on:move={handleMove}
        on:keypress={handleKeypress}
        on:requestMenuToggle={handleMenuToggle}
        on:dragstart={(event) => handleReorderStart(event.detail)}
        on:dragover={(event) => handleReorderOver(event.detail)}
        on:drop={(event) => handleReorderDrop(event.detail)}
        on:dragend={() => handleReorderEnd()}
      />
    {/each}
  </ul>
{:else}
  <p class="empty">Очередь пустая</p>
{/if}
