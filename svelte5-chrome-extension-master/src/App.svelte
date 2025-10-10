<script lang="ts">
  import { onMount } from "svelte";
  import { theme, initializeTheme } from "./lib/stores/theme";

  import ThemeToggle from "./lib/components/ThemeToggle.svelte";
  import Sidebar from "./lib/components/Sidebar.svelte";
  import MainContent from "./lib/components/MainContent.svelte";

  onMount(() => {
    initializeTheme();
  });
</script>

<div class="h-screen bg-base-100" data-theme={$theme}>
  <div class="flex h-full">
    <Sidebar />
    <main class="flex-1 p-4">
      <div class="flex justify-end mb-4">
        <ThemeToggle />
      </div>
      <MainContent />
    </main>
  </div>
</div>
