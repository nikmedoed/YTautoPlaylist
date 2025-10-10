<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import {
    addRuntimeMessageListener,
    fetchControlCapabilities,
    openListsManager,
    sendMessage,
  } from './api'
  import CollectionProgress from './components/CollectionProgress.svelte'
  import ControlPanel, { type ControlActions } from './components/ControlPanel.svelte'
  import HistoryList, { type HistoryListItem } from './components/HistoryList.svelte'
  import ListSelector from './components/ListSelector.svelte'
  import QueueList, { type QueueReorderEvent } from './components/QueueList.svelte'
  import StatusBanner from './components/StatusBanner.svelte'
  import type {
    Capabilities,
    CollectionLogEntry,
    CollectionProgressEvent,
    CollectionState,
    HistoryEntry,
    PlaylistListMeta,
    PlaylistPresentation,
    StatusKind,
    StatusMessage,
    VideoEntry,
  } from './types'
  import { formatListName } from './utils'

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
  const moveTargets = $derived(() => {
    const currentId = presentation?.currentQueue?.id ?? presentation?.currentListId ?? ''
    return lists.filter((list) => list.id !== currentId)
  })
  const historyView = $derived<HistoryListItem[]>(() =>
    historyItems.map((item, index) => ({
      item,
      index,
      listLabel: resolveListLabel(item.listId),
    })),
  )

  let statusTimeout: ReturnType<typeof setTimeout> | null = null

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

  async function handleQueueMove(entry: VideoEntry, targetListId: string) {
    if (!entry?.id || !targetListId) return
    try {
      const response = await sendMessage<PlaylistPresentation>('playlist:moveVideo', {
        videoId: entry.id,
        targetListId,
      })
      await applyStateResult(response)
      setStatus('Видео перемещено', 'success')
    } catch (error) {
      console.error('Failed to move video', error)
      setStatus('Не удалось переместить видео', 'error', 3000)
    }
  }

  async function handleQueueReorder(event: QueueReorderEvent) {
    if (!event.videoId) return
    try {
      const response = await sendMessage<PlaylistPresentation>('playlist:reorder', {
        videoId: event.videoId,
        targetIndex: event.targetIndex,
      })
      await applyStateResult(response)
      setStatus('Порядок обновлён', 'info')
    } catch (error) {
      console.error(error)
      setStatus('Не удалось изменить порядок', 'error', 3000)
    }
  }

  function handleQueueKeypress(event: KeyboardEvent, entry: VideoEntry) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleQueuePlay(entry)
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

  function resolveListLabel(listId: string | null | undefined): string | null {
    if (!listId || !presentation?.lists) return null
    const match = presentation.lists.find((list) => list.id === listId)
    if (!match) return null
    return formatListName(match.name, match.freeze)
  }

  function handleListChange(event: CustomEvent<{ listId: string }>) {
    const { listId } = event.detail
    listSelection = listId
    changeList(listId)
  }

  async function handleManageLists() {
    try {
      await openListsManager()
    } finally {
      await refreshPresentation()
    }
  }

  function handleControlAction(event: CustomEvent<{ type: ControlActions }>) {
    switch (event.detail.type) {
      case 'add-current':
        handleAdd('current')
        break
      case 'add-page':
        handleAdd('page')
        break
      case 'collect':
        handleCollect()
        break
      case 'play-next':
        handlePlayNext()
        break
    }
  }

  function handleQueueEvent(event: CustomEvent<{ entry: VideoEntry }>) {
    handleQueuePlay(event.detail.entry)
  }

  function handleQueueRemoveEvent(
    event: CustomEvent<{ entry: VideoEntry; event: MouseEvent }>,
  ) {
    handleQueueRemove(event.detail.entry, event.detail.event)
  }

  function handleQueueMoveEvent(
    event: CustomEvent<{ entry: VideoEntry; targetListId: string }>,
  ) {
    handleQueueMove(event.detail.entry, event.detail.targetListId)
  }

  function handleQueueKeypressEvent(
    event: CustomEvent<{ entry: VideoEntry; event: KeyboardEvent }>,
  ) {
    handleQueueKeypress(event.detail.event, event.detail.entry)
  }

  function handleHistoryRestoreEvent(
    event: CustomEvent<{ entry: HistoryEntry; position: number; event: Event }>,
  ) {
    handleHistoryRestore(event.detail.entry, event.detail.position, event.detail.event)
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

<ListSelector
  lists={lists}
  selectedId={listSelection}
  disabled={isSwitchingList}
  on:change={handleListChange}
  on:manage={handleManageLists}
/>

<ControlPanel capabilities={capabilities} loadings={loadings} on:action={handleControlAction} />

<StatusBanner status={status} onClose={clearStatus} />

<CollectionProgress collection={collection} on:toggle={toggleCollectionCollapsed} />

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
  <QueueList
    items={queueItems}
    activeVideoId={activeVideoId}
    currentListId={presentation?.currentQueue?.id ?? null}
    moveTargets={moveTargets}
    on:play={handleQueueEvent}
    on:remove={handleQueueRemoveEvent}
    on:move={handleQueueMoveEvent}
    on:reorder={(event) => handleQueueReorder(event.detail)}
    on:keypress={handleQueueKeypressEvent}
  />
</section>

<section class="history">
  <header>
    <h3>Последние 10</h3>
  </header>
  <HistoryList items={historyView} on:restore={handleHistoryRestoreEvent} />
</section>
