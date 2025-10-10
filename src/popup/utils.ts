import type { HistoryEntry, VideoEntry } from './types'

const FALLBACK_THUMBNAIL = chrome.runtime.getURL('icon/icon.png')

export function resolveThumbnail(entry?: VideoEntry | HistoryEntry | null): string {
  if (entry && typeof entry.thumbnail === 'string' && entry.thumbnail.length > 0) {
    return entry.thumbnail
  }
  return FALLBACK_THUMBNAIL
}

export function formatDuration(
  duration?: string | number | null,
  fallback = '',
): string {
  if (!duration && duration !== 0) return fallback
  if (typeof duration === 'number') {
    const sec = Math.max(0, Math.round(duration))
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    if (h) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(duration))
  if (!match) return fallback
  const h = Number(match[1] || 0)
  const m = Number(match[2] || 0)
  const s = Number(match[3] || 0)
  if (h) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function formatDateTime(
  value?: number | string | Date | null,
  fallback = '',
): string {
  if (value === null || value === undefined) return fallback
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatShortDate(
  value?: number | string | Date | null,
  fallback = '',
): string {
  if (value === null || value === undefined) return fallback
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleDateString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

export function formatTime(value: number | string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

export function formatListName(name: string, freeze: boolean): string {
  return freeze ? `${name} (без удаления)` : name
}

