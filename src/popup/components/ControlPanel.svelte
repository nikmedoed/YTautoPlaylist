<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import type { Capabilities } from '../types'

  export type ControlActions = 'add-current' | 'add-page' | 'collect' | 'play-next'

  const dispatch = createEventDispatcher<{ action: { type: ControlActions } }>()

  export let capabilities: Capabilities
  export let loadings: { addCurrent: boolean; addPage: boolean; collect: boolean; playNext: boolean }
</script>

<section class="controls">
  <div class="control-row control-row--actions">
    <button
      type="button"
      disabled={!capabilities.canAddCurrent || loadings.addCurrent}
      on:click={() => dispatch('action', { type: 'add-current' })}
    >
      Добавить текущее
    </button>
    <button
      type="button"
      disabled={!capabilities.canAddPage || loadings.addPage}
      on:click={() => dispatch('action', { type: 'add-page' })}
    >
      Добавить со страницы
    </button>
    <button type="button" disabled={loadings.collect} on:click={() => dispatch('action', { type: 'collect' })}>
      Собрать из подписок
    </button>
  </div>
  <div class="control-row control-row--secondary">
    <button
      id="playNext"
      class="secondary"
      type="button"
      disabled={loadings.playNext}
      on:click={() => dispatch('action', { type: 'play-next' })}
    >
      Следующее
    </button>
  </div>
</section>
