<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import {
    addRuntimeMessageListener,
    fetchControlCapabilities,
    openListsManager,
    sendMessage,
  } from './api'
  import type {
    Capabilities,
    CollectionLogEntry,
    CollectionProgressEvent,
    CollectionState,
    PlaylistListMeta,
    PlaylistPresentation,
    StatusKind,
    StatusMessage,
    VideoEntry,
    HistoryEntry,
  } from './types'
  import { formatListName, formatTime } from './utils'
  import QueueItem, { type QueueItemEventDetail } from './components/QueueItem.svelte'
  import HistoryItem from './components/HistoryItem.svelte'

  const MAX_COLLECTION_LOG_ITEMS = 8

  const STAGE_TITLES: Record<string, string> = {
    start: 'Подготовка',
    channels: 'Получение подписок',
    playlists: 'Загрузка плейлистов',
    aggregate: 'Сбор результатов',
    filter: 'Фильтрация',
    prepareAdd: 'Подготовка к добавлению',
    adding: 'Добавление в очередь',
    complete: 'Готово',
    error: 'Ошибка',
  }

  const PHASE_TO_STAGE: Record<string, string> = {
    start: 'start',
    channelsLoaded: 'channels',
    playlistFetch: 'playlists',
    playlistFetched: 'playlists',
    aggregate: 'aggregate',
    filtering: 'filter',
    filtered: 'filter',
    readyToAdd: 'prepareAdd',
    adding: 'adding',
    complete: 'complete',
    error: 'error',
  }

  let status = $state<StatusMessage | null>(null)
  let presentation = $state<PlaylistPresentation | null>(null)
  let listSelection = $state('')
  let isSwitchingList = $state(false)
  let loadings = $state({
    addCurrent: false,
    addPage: false,
    collect: false,
    playNext: false,
  })
  let capabilities = $state<Capabilities>({
    canAddCurrent: false,
    canAddPage: false,
    context: 'unknown',
    controlling: false,
  })
  let collection = $state<CollectionState>({
    active: false,
    collapsed: true,
    stageId: null,
    stageTitle: null,
    counters: '',
    entries: [],
    errorMessage: null,
  })

  const lists = $derived((presentation?.lists ?? []) as PlaylistListMeta[])
  const queueItems = $derived((presentation?.currentQueue?.queue ?? []) as VideoEntry[])
  const historyItems = $derived((presentation?.history ?? []) as HistoryEntry[])
  const activeVideoId = $derived(presentation?.currentVideoId ?? null)
  const queueFreezeLabel = $derived(
    presentation?.currentQueue?.freeze ? 'Список без удаления' : '',
  )
  const queueCountLabel = $derived(() => {
    const count = presentation?.currentQueue?.queue.length ?? 0
    return count > 0 ? `${count}` : '0'
  })
  const historyView = $derived(
    historyItems.map((item, index) => ({
      item,
      index,
      listLabel: resolveListLabel(item.listId),
    })),
  )

  let statusTimeout: ReturnType<typeof setTimeout> | null = null
  let queueListEl = $state<HTMLUListElement | null>(null)
  const dragState = {
    videoId: null as string | null,
    listId: null as string | null,
    dropIndex: null as number | null,
  }
  let currentDragItem: HTMLElement | null = null
  let currentHoverItem: HTMLElement | null = null
  let queueDropIndicator: HTMLDivElement | null = null
  let queueDropLine: HTMLDivElement | null = null

  type MoveMenuState = {
    visible: boolean
    x: number
    y: number
    videoId: string | null
    listId: string | null
  }

  let moveMenuState = $state<MoveMenuState>({
    visible: false,
    x: 0,
    y: 0,
    videoId: null,
    listId: null,
  })

  const moveTargets = $derived(() => {
    const currentId = presentation?.currentQueue?.id ?? presentation?.currentListId ?? ''
    return lists.filter((list) => list.id !== currentId)
  })

  $effect(() => {
    const next = presentation?.currentQueue?.id ?? presentation?.currentListId ?? ''
    if (listSelection !== next) {
      listSelection = next
    }
  })

  function setStatus(text: string, kind: StatusKind = 'info', timeout = 3000) {
    status = { text, kind, persist: timeout === 0 }
    if (statusTimeout) {
      clearTimeout(statusTimeout)
      statusTimeout = null
    }
    if (timeout > 0) {
      statusTimeout = setTimeout(() => {
        status = null
        statusTimeout = null
      }, timeout)
    }
  }

  function clearStatus() {
    if (statusTimeout) {
      clearTimeout(statusTimeout)
      statusTimeout = null
    }
    status = null
  }

  function ensureQueueDropIndicator() {
    if (!queueListEl) return
    if (!queueDropIndicator) {
      queueDropIndicator = document.createElement('div')
      queueDropIndicator.className = 'queue-drop-indicator'
    }
    if (!queueDropLine) {
      queueDropLine = document.createElement('div')
      queueDropLine.className = 'queue-drop-indicator__line'
      queueDropIndicator.appendChild(queueDropLine)
    }
    if (!queueDropIndicator.parentElement) {
      queueListEl.appendChild(queueDropIndicator)
    }
  }

  function resetDragVisuals() {
    if (currentDragItem) {
      currentDragItem.classList.remove('dragging')
      currentDragItem = null
    }
    if (currentHoverItem) {
      currentHoverItem.classList.remove('drop-before', 'drop-after')
      currentHoverItem = null
    }
    if (queueDropIndicator?.parentElement) {
      queueDropIndicator.remove()
    }
    dragState.videoId = null
    dragState.listId = null
    dragState.dropIndex = null
  }

  function handleQueueItemDragStart({ entry, index, event }: QueueItemEventDetail) {
    const handle = (event.target as HTMLElement | null)?.closest('.video-handle')
    if (!handle) {
      event.preventDefault()
      return
    }
    const item = handle.closest<HTMLLIElement>('.video-item')
    if (!item) {
      event.preventDefault()
      return
    }
    dragState.videoId = entry.id
    dragState.listId = presentation?.currentQueue?.id ?? null
    dragState.dropIndex = index
    item.classList.add('dragging')
    currentDragItem = item
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', entry.id)
    }
  }

  function handleQueueItemDragOver({ event }: QueueItemEventDetail) {
    if (!dragState.videoId || !queueListEl) return
    const target = event.currentTarget as HTMLLIElement | null
    if (!target) return
    event.preventDefault()
    if (target === currentDragItem) {
      if (currentHoverItem && currentHoverItem !== target) {
        currentHoverItem.classList.remove('drop-before', 'drop-after')
        currentHoverItem = null
      }
      if (queueDropIndicator?.parentElement) {
        queueDropIndicator.remove()
      }
      return
    }
    const items = Array.from(queueListEl.querySelectorAll<HTMLLIElement>('.video-item'))
    const index = items.indexOf(target)
    if (index === -1) return
    const rect = target.getBoundingClientRect()
    const before = event.clientY - rect.top < rect.height / 2
    target.classList.toggle('drop-before', before)
    target.classList.toggle('drop-after', !before)
    if (currentHoverItem && currentHoverItem !== target) {
      currentHoverItem.classList.remove('drop-before', 'drop-after')
    }
    currentHoverItem = target
    dragState.dropIndex = before ? index : index + 1
    ensureQueueDropIndicator()
    if (queueDropIndicator) {
      const top = target.offsetTop + (before ? 0 : target.offsetHeight)
      queueDropIndicator.style.top = `${top}px`
    }
  }

  function handleQueueContainerDragOver(event: DragEvent) {
    if (!dragState.videoId || !queueListEl) return
    const targetItem = (event.target as HTMLElement | null)?.closest<HTMLLIElement>(
      '.video-item',
    )
    if (targetItem) return
    event.preventDefault()
    dragState.dropIndex = queueItems.length
    if (currentHoverItem) {
      currentHoverItem.classList.remove('drop-before', 'drop-after')
      currentHoverItem = null
    }
    ensureQueueDropIndicator()
    if (queueDropIndicator) {
      queueDropIndicator.style.top = `${queueListEl.scrollHeight}px`
    }
  }

  async function commitQueueReorder(event: DragEvent) {
    if (!dragState.videoId || dragState.dropIndex === null) {
      resetDragVisuals()
      return
    }
    event.preventDefault()
    try {
      const response = await sendMessage<PlaylistPresentation>('playlist:reorder', {
        videoId: dragState.videoId,
        targetIndex: dragState.dropIndex,
      })
      await applyStateResult(response)
      setStatus('Порядок обновлён', 'info')
    } catch (error) {
      console.error(error)
      setStatus('Не удалось изменить порядок', 'error', 3000)
    } finally {
      resetDragVisuals()
    }
  }

  async function handleQueueItemDrop({ event }: QueueItemEventDetail) {
    await commitQueueReorder(event)
  }

  async function handleQueueContainerDrop(event: DragEvent) {
    await commitQueueReorder(event)
  }

  function handleQueueItemDragEnd() {
    resetDragVisuals()
  }

  function handleQueueItemKeyActivate({ entry, event }: { entry: VideoEntry; event: KeyboardEvent }) {
    event.preventDefault()
    handleQueuePlay(entry)
  }

  function openMoveMenu(entry: VideoEntry, event: MouseEvent) {
    event.stopPropagation()
    const target = event.currentTarget as HTMLElement | null
    if (!target) return
    const rect = target.getBoundingClientRect()
    moveMenuState.x = rect.right - 180
    moveMenuState.y = rect.bottom + 6
    moveMenuState.videoId = entry.id
    moveMenuState.listId = presentation?.currentQueue?.id ?? null
    moveMenuState.visible = true
  }

  function closeMoveMenu() {
    moveMenuState.visible = false
    moveMenuState.videoId = null
    moveMenuState.listId = null
  }

  async function moveVideoTo(targetListId: string) {
    if (!moveMenuState.videoId) return
    try {
      const response = await sendMessage<PlaylistPresentation>('playlist:moveVideo', {
        videoId: moveMenuState.videoId,
        targetListId,
      })
      await applyStateResult(response)
      setStatus('Видео перемещено', 'success')
    } catch (error) {
      console.error(error)
      setStatus('Не удалось переместить видео', 'error', 3000)
    } finally {
      closeMoveMenu()
    }
  }

  function handleWindowClick(event: MouseEvent) {
    if (!moveMenuState.visible) return
    const target = event.target as HTMLElement | null
    if (!target?.closest('[data-move-menu]')) {
      closeMoveMenu()
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && moveMenuState.visible) {
      closeMoveMenu()
    }
  }

  function diffQueueLength(next: PlaylistPresentation | null | undefined): number {
    const prevLength = presentation?.currentQueue?.queue.length ?? 0
    const nextLength = next?.currentQueue?.queue.length ?? 0
    return nextLength - prevLength
  }

  async function refreshPresentation(showError = false) {
    try {
      const next = await sendMessage<PlaylistPresentation>('playlist:getState')
      presentation = next ?? null
    } catch (error) {
      console.error('Failed to refresh playlist state', error)
      if (showError) {
        setStatus('Не удалось загрузить очередь', 'error', 4000)
      }
    }
  }

  async function applyStateResult(result: unknown, onDiff?: (diff: number) => void) {
    if (!result) {
      await refreshPresentation()
      return
    }
    if (
      typeof result === 'object' &&
      result !== null &&
      'state' in (result as Record<string, unknown>)
    ) {
      const state = (result as Record<string, unknown>).state as PlaylistPresentation
      if (onDiff) onDiff(diffQueueLength(state))
      presentation = state
      return
    }
    if (
      typeof result === 'object' &&
      result !== null &&
      'currentQueue' in (result as Record<string, unknown>)
    ) {
      const state = result as PlaylistPresentation
      if (onDiff) onDiff(diffQueueLength(state))
      presentation = state
      return
    }
    await refreshPresentation()
  }

  async function changeList(listId: string) {
    if (!listId || listId === presentation?.currentQueue?.id || isSwitchingList) {
      return
    }
    isSwitchingList = true
    setStatus('Переключаю список...', 'info', 0)
    try {
      const next = await sendMessage<PlaylistPresentation>('playlist:setCurrentList', {
        listId,
      })
      await applyStateResult(next)
      setStatus('Список переключён', 'success')
    } catch (error) {
      console.error('Failed to switch list', error)
      setStatus('Не удалось переключить список', 'error', 4000)
    } finally {
      isSwitchingList = false
    }
  }

  async function handleAdd(scope: 'current' | 'page') {
    if (scope === 'current' && !capabilities.canAddCurrent) return
    if (scope === 'page' && !capabilities.canAddPage) return
    const key = scope === 'current' ? 'addCurrent' : 'addPage'
    if (loadings[key]) return
    loadings[key] = true
    setStatus('Ищу видео...', 'info')
    try {
      const collect = await sendMessage<{ error?: string; videoIds?: string[] }>(
        'collector:collect',
        { scope },
      )
      if (collect?.error) {
        if (collect.error === 'NOT_ALLOWED') {
          setStatus('Эта кнопка недоступна на текущей странице', 'info', 3500)
        } else {
          setStatus('Не получилось собрать список', 'error', 4000)
        }
        return
      }
      const ids = Array.isArray(collect?.videoIds) ? collect.videoIds : []
      if (!ids.length) {
        setStatus('Видео не найдены', 'info')
        return
      }
      const response = await sendMessage<PlaylistPresentation>('playlist:addByIds', {
        videoIds: ids,
      })
      await applyStateResult(response, (diff) => {
        if (diff > 0) {
          setStatus(`Добавлено ${diff} видео`, 'success')
        } else {
          setStatus('Все видео уже в очереди', 'info')
        }
      })
    } catch (error) {
      console.error('Failed to add from scope', error)
      setStatus('Ошибка добавления видео', 'error', 4000)
    } finally {
      loadings[key] = false
    }
  }

  async function handleCollect() {
    if (loadings.collect) return
    loadings.collect = true
    setStatus('Собираю новые видео...', 'info', 0)
    collection.active = true
    collection.errorMessage = null
    try {
      const result = await sendMessage<{ state?: PlaylistPresentation }>(
        'playlist:collectSubscriptions',
      )
      if (result?.state) {
        presentation = result.state
      }
    } catch (error) {
      console.error('Collect subscriptions failed', error)
      setStatus('Не удалось собрать подписки', 'error', 4000)
    } finally {
      loadings.collect = false
    }
  }

  async function handlePlayNext() {
    if (loadings.playNext) return
    loadings.playNext = true
    setStatus('Переходим к следующему...', 'info')
    try {
      const response = await sendMessage<
        PlaylistPresentation | { handled?: boolean; state?: PlaylistPresentation }
      >('playlist:playNext')
      if (
        response &&
        typeof response === 'object' &&
        'handled' in response &&
        response.handled === false
      ) {
        setStatus('Следующее видео не найдено', 'info')
      }
      await applyStateResult(response as PlaylistPresentation)
      setStatus('Следующее видео запущено', 'success')
    } catch (error) {
      console.error('Failed to play next', error)
      setStatus('Не удалось переключиться', 'error', 4000)
    } finally {
      loadings.playNext = false
    }
  }

  async function handleQueuePlay(entry: VideoEntry) {
    if (!entry?.id) return
    setStatus('Запускаю видео...', 'info')
    try {
      const response = await sendMessage<PlaylistPresentation>('playlist:play', {
        videoId: entry.id,
        listId: presentation?.currentQueue?.id ?? presentation?.currentListId,
      })
      await applyStateResult(response)
      setStatus('Видео запущено', 'success')
    } catch (error) {
      console.error('Failed to start video', error)
      setStatus('Не удалось запустить видео', 'error', 4000)
    }
  }

  async function handleQueueRemove(entry: VideoEntry, event?: Event) {
    event?.stopPropagation()
    if (!entry?.id) return
    try {
      const response = await sendMessage<PlaylistPresentation>('playlist:remove', {
        videoId: entry.id,
        listId: presentation?.currentQueue?.id ?? presentation?.currentListId,
      })
      await applyStateResult(response)
      setStatus('Видео удалено', 'info')
    } catch (error) {
      console.error('Failed to remove video', error)
      setStatus('Не удалось удалить видео', 'error', 3000)
    }
  }

  async function handleHistoryRestore(entry: HistoryEntry, position: number, event: Event) {
    event.stopPropagation()
    setStatus('Возвращаю видео...', 'info')
    try {
      const response = await sendMessage<PlaylistPresentation>('playlist:playPrevious', {
        position,
        placement: 'beforeCurrent',
      })
      await applyStateResult(response)
      setStatus('Видео вернулось в очередь', 'success')
    } catch (error) {
      console.error('Failed to restore history entry', error)
      setStatus('Не удалось вернуть видео', 'error', 3000)
    }
  }

  async function updateCapabilities() {
    const caps = await fetchControlCapabilities()
    capabilities = caps
  }

  function buildCounters(event: CollectionProgressEvent): string {
    const parts: string[] = []
    const maybeNumber = (value: unknown): value is number =>
      typeof value === 'number' && Number.isFinite(value)
    if (maybeNumber(event.playlistsDone) && maybeNumber(event.playlistsTotal)) {
      parts.push(`${event.playlistsDone}/${event.playlistsTotal} плейлистов`)
    }
    if (maybeNumber(event.fetched)) {
      parts.push(`найдено ${event.fetched}`)
    }
    if (maybeNumber(event.filtered)) {
      parts.push(`отфильтровано ${event.filtered}`)
    }
    if (maybeNumber(event.ready)) {
      parts.push(`готово ${event.ready}`)
    }
    if (maybeNumber(event.added)) {
      parts.push(`добавлено ${event.added}`)
    }
    return parts.join(' • ')
  }

  function appendCollectionLog(event: CollectionProgressEvent, stageId: string) {
    const detail = buildCounters(event)
    const entry: CollectionLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      message: event.message || STAGE_TITLES[stageId] || 'Состояние',
      timestamp: Date.now(),
      detail,
      kind: event.phase === 'error' ? 'error' : 'info',
    }
    collection.entries = [entry, ...collection.entries].slice(0, MAX_COLLECTION_LOG_ITEMS)
  }

  function handleCollectionEvent(raw: CollectionProgressEvent) {
    if (!raw || typeof raw.phase !== 'string') return
    const stageId = PHASE_TO_STAGE[raw.phase] ?? 'start'
    const stageTitle = STAGE_TITLES[stageId] ?? STAGE_TITLES.start
    if (raw.phase === 'start') {
      collection.entries = []
      collection.collapsed = false
      collection.errorMessage = null
    }
    collection.active = raw.phase !== 'complete' && raw.phase !== 'error'
    collection.stageId = stageId
    collection.stageTitle = stageTitle
    collection.counters = buildCounters(raw)
    if (raw.message || collection.counters) {
      appendCollectionLog(raw, stageId)
    }
    if (raw.phase === 'complete') {
      collection.errorMessage = null
      setStatus('Сбор подписок завершён', 'success')
    } else if (raw.phase === 'error') {
      const message = String(raw.message || 'Ошибка сбора подписок')
      collection.errorMessage = message
      setStatus(message, 'error', 5000)
    }
  }

  function handleRuntimeMessage(message: unknown) {
    if (!message || typeof message !== 'object') return
    const payload = message as Record<string, unknown>
    if (payload.type === 'playlist:stateUpdated' && payload.state) {
      presentation = payload.state as PlaylistPresentation
    } else if (payload.type === 'playlist:collectProgress') {
      const event =
        (payload.event as CollectionProgressEvent | undefined) ??
        (message as CollectionProgressEvent)
      if (event) handleCollectionEvent(event)
    }
  }

  function toggleCollectionCollapsed() {
    if (!collection.entries.length) return
    collection.collapsed = !collection.collapsed
  }

  function listOptionLabel(item: PlaylistListMeta): string {
    return item.id === 'default' ? item.name : formatListName(item.name, item.freeze)
  }

  function resolveListLabel(listId: string | null | undefined): string | null {
    if (!listId || !presentation?.lists) return null
    const match = presentation.lists.find((list) => list.id === listId)
    if (!match) return null
    return formatListName(match.name, match.freeze)
  }

  onMount(() => {
    refreshPresentation(true)
    updateCapabilities()
    const unsubscribe = addRuntimeMessageListener(handleRuntimeMessage)
    const capabilityTimer = setInterval(updateCapabilities, 60_000)
    return () => {
      unsubscribe()
      clearInterval(capabilityTimer)
    }
  })

  onDestroy(() => {
    if (statusTimeout) {
      clearTimeout(statusTimeout)
      statusTimeout = null
    }
  })
</script>

<svelte:window onfocus={updateCapabilities} />

<div class="list-bar">
  <label for="listSelect">Список</label>
  <select
    id="listSelect"
    bind:value={listSelection}
    disabled={isSwitchingList}
    onchange={(event) => changeList((event.currentTarget as HTMLSelectElement).value)}
  >
    {#if !lists.length}
      <option value="">Списки не найдены</option>
    {:else}
      {#each lists as list (list.id)}
        <option value={list.id}>{listOptionLabel(list)}</option>
      {/each}
    {/if}
  </select>
  <button class="secondary" type="button" onclick={openListsManager}>
    Управление списками
  </button>
</div>

<section class="controls">
  <div class="control-row control-row--actions">
    <button
      type="button"
      disabled={!capabilities.canAddCurrent || loadings.addCurrent}
      onclick={() => handleAdd('current')}
    >
      Добавить текущее
    </button>
    <button
      type="button"
      disabled={!capabilities.canAddPage || loadings.addPage}
      onclick={() => handleAdd('page')}
    >
      Добавить со страницы
    </button>
    <button type="button" disabled={loadings.collect} onclick={handleCollect}>
      Собрать из подписок
    </button>
  </div>
  <div class="control-row control-row--secondary">
    <button
      id="playNext"
      class="secondary"
      type="button"
      disabled={loadings.playNext}
      onclick={handlePlayNext}
    >
      Следующее
    </button>
  </div>
</section>

<section
  id="status"
  role="status"
  aria-live="polite"
  aria-atomic="true"
  data-visible={status ? '1' : '0'}
  data-kind={status?.kind ?? 'info'}
>
  <span>{status?.text ?? ''}</span>
  <button
    type="button"
    class="status-close"
    aria-label="Скрыть уведомление"
    onclick={clearStatus}
  >
    ×
  </button>
</section>

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
        <button class="secondary" type="button" onclick={toggleCollectionCollapsed}>
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

<section class="queue">
  <header>
    <div>
      <h3>Очередь</h3>
      {#if queueFreezeLabel}
        <span class="queue-subtitle">{queueFreezeLabel}</span>
      {/if}
    </div>
    <span id="queueCount">{queueCountLabel}</span>
  </header>
  {#if queueItems.length}
    <ul
      id="queueList"
      class="video-list"
      bind:this={queueListEl}
      ondragover={handleQueueContainerDragOver}
      ondrop={handleQueueContainerDrop}
    >
      {#each queueItems as item, index (item.id)}
        <QueueItem
          entry={item}
          {index}
          listId={presentation?.currentQueue?.id ?? ''}
          active={item.id === activeVideoId}
          on:play={({ detail }) => handleQueuePlay(detail.entry)}
          on:keyactivate={({ detail }) => handleQueueItemKeyActivate(detail)}
          on:move={({ detail }) => openMoveMenu(detail.entry, detail.event)}
          on:remove={({ detail }) => handleQueueRemove(detail.entry, detail.event)}
          on:dragstart={({ detail }) => handleQueueItemDragStart(detail)}
          on:dragover={({ detail }) => handleQueueItemDragOver(detail)}
          on:drop={({ detail }) => handleQueueItemDrop(detail)}
          on:dragend={() => handleQueueItemDragEnd()}
        />
      {/each}
    </ul>
  {:else}
    <p class="empty">Очередь пустая</p>
  {/if}
</section>

<section class="history">
  <header>
    <h3>Последние 10</h3>
  </header>
  {#if historyView.length}
    <ul id="historyList" class="video-list">
      {#each historyView as { item, index, listLabel } (item.id + index)}
        <HistoryItem
          entry={item}
          {index}
          {listLabel}
          on:restore={({ detail }) => handleHistoryRestore(detail.entry, detail.index, detail.event)}
        />
      {/each}
    </ul>
  {:else}
    <p class="empty">Истории пока нет</p>
  {/if}
</section>

<style>
  .queue-subtitle {
    display: block;
    font-size: 11px;
    opacity: 0.7;
    margin-top: 2px;
  }

  .list-label {
    background: rgba(0, 0, 0, 0.25);
    border-radius: 10px;
    padding: 2px 8px;
  }

  .video-body {
    background: none;
    border: none;
    text-align: left;
    color: inherit;
    padding: 10px 40px 10px 14px;
  }

  .video-body:focus-visible {
    outline: 2px solid rgba(244, 67, 54, 0.7);
    outline-offset: 2px;
  }

  #status {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .status-close {
    border: none;
    background: transparent;
    color: inherit;
    font-size: 18px;
    line-height: 1;
    padding: 0;
    cursor: pointer;
  }

  .status-close:hover {
    opacity: 0.85;
  }
</style>
