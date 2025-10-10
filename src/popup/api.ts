import type { Capabilities } from './types'

type MessagePayload = Record<string, unknown>

const defaultCapabilities: Capabilities = {
  canAddCurrent: false,
  canAddPage: false,
  context: 'unknown',
  controlling: false,
}

function logMessagingError(type: string, error: unknown) {
  if (!error) return
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (message && /receiving end/i.test(message)) {
    return
  }
  console.error('Message failed', type, error)
}

export async function sendMessage<T = unknown>(
  type: string,
  payload: MessagePayload = {},
): Promise<T | undefined> {
  try {
    const response = await chrome.runtime.sendMessage({ type, ...payload })
    return response as T
  } catch (error) {
    logMessagingError(type, error)
    throw error
  }
}

export function addRuntimeMessageListener(
  listener: (message: unknown, sender: chrome.runtime.MessageSender) => void,
): () => void {
  const handler: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (
    message,
    sender,
  ) => {
    listener(message, sender)
  }
  chrome.runtime.onMessage.addListener(handler)
  return () => chrome.runtime.onMessage.removeListener(handler)
}

export async function fetchControlCapabilities(): Promise<Capabilities> {
  if (!chrome?.tabs?.query) {
    return { ...defaultCapabilities, context: 'extension' }
  }
  try {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    })
    if (!activeTab || !activeTab.id || !activeTab.url) {
      return { ...defaultCapabilities }
    }
    const isYoutube = /https?:\/\/(www\.)?youtube\.com/i.test(activeTab.url)
    if (!isYoutube) {
      return { ...defaultCapabilities, context: 'external' }
    }
    const response = await chrome.tabs.sendMessage(activeTab.id, {
      type: 'collector:getCapabilities',
    })
    if (response && typeof response === 'object') {
      return {
        canAddCurrent: Boolean((response as Record<string, unknown>).canAddCurrent),
        canAddPage: Boolean((response as Record<string, unknown>).canAddPage),
        context:
          (response as Record<string, unknown>).context === 'external'
            ? 'external'
            : (response as Record<string, unknown>).context === 'extension'
            ? 'extension'
            : 'tab',
        controlling: Boolean((response as Record<string, unknown>).controlling),
      }
    }
    return { ...defaultCapabilities }
  } catch {
    return { ...defaultCapabilities }
  }
}

export function openListsManager(): void {
  const url = chrome.runtime.getURL('src/popup/lists.html')
  chrome.tabs.create({ url })
}

