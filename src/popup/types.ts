export interface PlaylistListMeta {
  id: string
  name: string
  freeze: boolean
  length: number
}

export interface VideoEntry {
  id: string
  title: string
  channelId?: string
  channelTitle?: string
  thumbnail?: string
  publishedAt?: string | null
  duration?: string | number | null
  addedAt?: number
}

export interface HistoryEntry extends VideoEntry {
  watchedAt?: number
  listId?: string | null
}

export interface PlaylistQueue {
  id: string
  name: string
  freeze: boolean
  queue: VideoEntry[]
  currentIndex: number | null
}

export interface PlaylistPresentation {
  lists: PlaylistListMeta[]
  currentListId: string
  activeListId: string | null
  currentVideoId: string | null
  currentTabId: number | null
  currentQueue: PlaylistQueue | null
  history: HistoryEntry[]
}

export type StatusKind = 'info' | 'success' | 'error'

export interface StatusMessage {
  text: string
  kind: StatusKind
  persist?: boolean
}

export interface Capabilities {
  canAddCurrent: boolean
  canAddPage: boolean
  context: 'unknown' | 'extension' | 'external' | 'tab' | 'player'
  controlling?: boolean
}

export interface CollectionProgressEvent {
  phase: string
  message?: string
  [key: string]: unknown
}

export interface CollectionLogEntry {
  id: string
  message: string
  timestamp: number
  detail?: string
  kind: StatusKind
}

export interface CollectionState {
  active: boolean
  collapsed: boolean
  stageId: string | null
  stageTitle: string | null
  counters: string
  entries: CollectionLogEntry[]
  errorMessage: string | null
}

