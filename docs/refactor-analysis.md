<!-- Refactor map for the repository. Records oversized files, responsibility boundaries, and follow-up cleanup areas. -->

# Large File Refactor Analysis

This document highlights every file in the repository that currently exceeds 400 lines and outlines why each one is a candidate for refactoring. The goal is to make future changes to the queue controls and related features safer by splitting responsibilities into smaller, testable units and removing redundant logic.

## Content Script Layout

The content script now builds from `src/content/index.js`; this is the only file that should remain at the content root. Feature families are grouped by domain:

| Folder | Responsibility |
| --- | --- |
| `src/content/core/` | Content lifecycle, diagnostics, navigation hooks, runtime message wiring, and shared content state |
| `src/content/playback/` | YouTube player controls, playback actions, watchdogs, player error handling, and playback notifications |
| `src/content/inline-queue/` | Watch-page inline queue shell, items, drag/drop, move menu, scroll focus, navigation, and state sync |
| `src/content/page-actions/` | Floating add-current/add-visible/add-all actions, result formatting, host selection, and view helpers |
| `src/content/video-cards/` | Video card discovery, target parsing, overlays, preview controls, progress badges, and add flow |
| `src/content/collection/` | Content-side collection helpers and auto-collect progress notifications |
| `src/content/styles/` | CSS template fragments injected by `src/content/styles/index.js` |

New content-script code should go into one of these folders. If a feature needs several files, keep the whole set together instead of leaving one file at the content root.

## Popup And Settings Layout

Popup page entrypoints stay at `src/popup/popup.js` and `src/popup/lists.js`. Shared modules are grouped by domain:

| Folder | Responsibility |
| --- | --- |
| `src/popup/modules/collection/` | Collection progress, cooldown, stage log, summary, and formatting |
| `src/popup/modules/manager/` | List manager rendering, detail actions, modal flows, drag/drop, selection, and list switching |
| `src/popup/modules/queue/` | Queue rendering and queue drag/drop |
| `src/popup/modules/history/` | History rendering and restore actions |
| `src/popup/modules/playback/` | Popup playback metadata helpers |
| `src/popup/modules/shared/` | Status and add-result message helpers |

Settings builds from `src/settings/index.js`. Static runtime files stay at `src/settings/settings.html` and `src/settings/icons.svg`; implementation is grouped into `filters/`, `quick-filter/`, `shared/`, and `video-check/`.

## Summary of Oversized Files

| File | Lines | Primary Concerns |
| --- | --- | --- |
| `src/popup/popup.js` | 928 | Popup player entrypoint still coordinates many controllers and DOM nodes |
| `src/popup/lists.js` | 848 | Popup manager entrypoint still owns high-level page orchestration |
| `src/settings/settings.html` | 643 | Bulky inline styles and markup without partials |
| `src/content/inline-queue/index.js` | 601 | Inline queue shell still owns rendering orchestration |
| `src/content/video-cards/index.js` | 519 | Card discovery and decoration coordinator still has broad DOM heuristics |

## Detailed Notes

### `src/popup/popup.js` (1159 lines)
**Role:** The popup entrypoint owns DOM querying, controller wiring, auto-collect flows, playback state management, and background messaging in one place.【F:src/popup/popup.js†L6-L224】【F:src/popup/popup.js†L321-L427】

**Pain points:**
- UI state, throttled timers, and transport calls are intermixed, making it difficult to reason about or test individual behaviours (e.g., playback control relies on both DOM flags and background responses in a single function).【F:src/popup/popup.js†L389-L427】【F:src/popup/popup.js†L650-L758】
- Auto-collect cooldowns, status updates, and queue change detection all live here, leading to duplication with other modules and making regressions likely when tweaking a single concern.【F:src/popup/popup.js†L145-L224】【F:src/popup/popup.js†L760-L800】

**Refactor ideas:**
- Extract auto-collect cooldown and progress handling into a dedicated service module shared between popup and manager screens.
- Move playback state orchestration into a `playbackControls` module that exposes a state machine and DOM adaptor, leaving this file to coordinate modules.
- Split message formatting (`formatAddResultMessage`, etc.) into a shared utility for queue feedback so both popup and page actions use the same logic.

### `src/popup/lists.js` (957 lines)
**Role:** Implements the manager view inside the popup, including DOM setup, drag-and-drop, modal flows, collection triggers, and selection state in one file.【F:src/popup/lists.js†L14-L158】

**Pain points:**
- Rendering, async data loading, and UI event wiring are tightly coupled, making it hard to reuse list rendering elsewhere or to test selection logic without the DOM.【F:src/popup/lists.js†L320-L406】【F:src/popup/lists.js†L409-L471】
- Modal lifecycle logic, playlist creation, import/export, and status reporting sit beside each other, duplicating patterns already present in `popup.js`.【F:src/popup/lists.js†L735-L798】

**Refactor ideas:**
- Extract a `listsStore` facade that handles `loadState`, `loadListDetails`, and data transformations, leaving this file to focus on rendering.
- Move modal orchestration into separate modules (`createListModal`, `importModal`, `editModal`) that expose init/dispose hooks.
- Introduce view components (e.g., functions returning DOM nodes) for list cards and video rows to remove inline DOM construction.

### `src/store/` (completed split)
**Role:** Central store API for queue/list/playback state and Chrome storage persistence.

**Current structure:**
- `src/store/index.js` is the only public store entrypoint.
- `src/store/actions/` contains domain mutations: `queue.js`, `lists.js`, `playback.js`, `history.js`, `presentation.js`, and `autoCollect.js`, with shared mutation helpers in `core.js`.
- `src/store/state/` contains persistence and schema code: `constants.js`, `sanitizers.js`, `serialization.js`, `storage.js`, `videoProgress.js`, `autoCollectTimestamp.js`, and `utils.js`.

**Follow-up ideas:**
- Keep new store modules inside `actions/` or `state/`; do not reintroduce root-level `store*` or `state*` files.
- The old `src/playlistStore.js` compatibility entrypoint was removed after callers switched to `src/store/index.js`.

### `src/background/` (completed handler split)
**Role:** Background service worker orchestration.

**Current structure:**
- `messages.js` is only the runtime message registry.
- `handlers/collection.js`, `handlers/lists.js`, `handlers/options.js`, `handlers/playback.js`, and `handlers/queue.js` own domain handlers.
- `services.js`, `collector.js`, `tabs.js`, `channel.js`, `playback.js`, and `collectionSync.js` provide shared background services.

### `src/youtube-api/` (completed split)
**Role:** Owns YouTube Data API integration through domain modules instead of a single root-level connector file.

**Current structure:**
- `transport.js` handles authenticated API calls, token refresh, and test injection via `__setCallApi`.
- `channels.js` handles subscriptions, upload playlist lookup, and channel metadata cache.
- `videos.js` handles upload/search traversal, video metadata, Shorts detection, and collection fetch windows.
- `playlists.js` handles playlist item reads, playlist creation, playlist membership checks, and batch playlist insertion.

**Follow-up ideas:**
- Keep future API helpers in this folder and import exact domain modules directly.
- Avoid adding a root barrel that hides which API surface a caller depends on.

### `src/content/video-cards/index.js` (494 lines)
**Role:** Detects video/playlist cards on the page, extracts IDs, and applies inline controls with fallback heuristics.【F:src/content/video-cards/index.js†L17-L160】

**Pain points:**
- Complex heuristics, DOM traversal, and dataset parsing are embedded together, making it hard to add new card types without risking regressions.
- Shares constants and CSS class knowledge with other files but without a common abstraction.

**Refactor ideas:**
- Introduce dedicated parsers for playlist vs. video cards and a registry of heuristics.
- Share dataset parsing helpers with other controllers to avoid duplicated logic.

### `src/settings/` (completed module split)
**Role:** Settings page entrypoint and helpers.

**Current structure:**
- `index.js` is the settings page entrypoint.
- `filters/` owns rows, sections, persistence, and mutation helpers.
- `quick-filter/` owns quick-filter builder, DOM, renderers, and apply logic.
- `shared/` owns formatting, runtime calls, and save UI helpers.
- `video-check/` owns check-video result rendering.

### `src/popup/styles/collection.css` (447 lines)
**Role:** Styles the popup UI, including status toasts, collection widgets, list manager, and playback controls in a single stylesheet.【F:src/popup/styles/collection.css†L1-L160】

**Pain points:**
- Styles for unrelated components share the same file, making it difficult to reason about dependencies or reuse classes.

**Refactor ideas:**
- Break into feature-scoped stylesheets (`status.css`, `collection.css`, `manager.css`) and load only what each view needs.

### `src/settings/settings.html` (445 lines)
**Role:** Hosts the settings page markup with substantial inline CSS and HTML templates for dynamic rows.【F:src/settings/settings.html†L1-L160】

**Pain points:**
- Inline styles and markup sit together, limiting reuse and causing duplication with `settings.js` templates.

**Refactor ideas:**
- Extract inline CSS into external stylesheets shared with the script module.
- Move repeated card markup into `<template>` elements or partial HTML files to simplify maintenance.

