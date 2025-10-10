<script lang="ts">
  import type { StatusMessage } from '../types'

  const { status = null, onClose } = $props<{
    status?: StatusMessage | null
    onClose: () => void
  }>()
</script>

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
    onclick={onClose}
  >
    ×
  </button>
</section>

<style>
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
