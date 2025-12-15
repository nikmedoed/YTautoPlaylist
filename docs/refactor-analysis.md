# Large File Refactor Analysis

This document highlights every file in the repository that currently exceeds 400 lines and outlines why each one is a candidate for refactoring. The goal is to make future changes to the queue controls and related features safer by splitting responsibilities into smaller, testable units and removing redundant logic.

## Summary of Oversized Files

| File | Lines | Primary Concerns |
| --- | --- | --- |
| `src/popup/popup.js` | 1159 | UI wiring, messaging, playback logic, and collection state mixed together |
| `src/popup/lists.js` | 957 | Popup manager UI, selection logic, modal orchestration, and network calls in a single script |
| `src/store/store.js` | 861 | Playlist mutations, history management, and playback state intertwined |
| `src/content/pageActions.js` | 829 | Inline action UI, throttling, analytics, and background requests combined |
| `src/background/messageHandlers.js` | 678 | Heterogeneous message handlers without routing layers |
| `src/content/playerControls.js` | 577 | Notification UI, auto-collect updates, and player coordination handled together |
| `src/store/state.js` | 544 | Persistence, migration, sanitization, and state access bundled |
| `src/youTubeApiConnectors.js` | 513 | Authentication, API retries, collection helpers, and data shaping combined |
| `src/content/videoCards.js` | 494 | DOM scraping, heuristics, retry management, and inline control updates |
| `src/settings/settings.js` | 477 | Settings UI rendering, filter persistence, API calls, and validation mixed |
| `src/content/styles.js` | 461 | 450+ lines of template literal CSS in JS |
| `src/popup/styles/collection.css` | 447 | Monolithic stylesheet covering unrelated popup areas |
| `src/settings/settings.html` | 445 | Bulky inline styles and markup without partials |

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

### `src/store/store.js` (861 lines)
**Role:** Central mutation layer for playlists, history, playback state, and notifications, built on top of the lower-level state module.【F:src/store/store.js†L1-L83】

**Pain points:**
- Single file mixes queue mutations, history compaction, and playback pointer management, so seemingly simple changes (like removing videos) impact multiple areas.【F:src/store/store.js†L334-L395】【F:src/store/store.js†L446-L479】
- Many helpers perform similar sanitisation or state lookups, suggesting they belong in distinct modules (`queueMutations`, `history`, `autoCollectMeta`).

**Refactor ideas:**
- Split into domain-specific modules (`lists`, `history`, `autoCollect`, `playback`) that share a common `withState` helper.
- Promote notification-queue manipulation to its own module so message handlers can depend on a minimal API.

### `src/content/pageActions.js` (829 lines)
**Role:** Drives inline page actions (add current, add visible, add all) including UI controls, tooltips, analytics, throttled status messages, and communication with the background script.【F:src/content/pageActions.js†L6-L158】

**Pain points:**
- UI construction and behaviour logic share functions, making it hard to reuse the same buttons on other page layouts or tests.【F:src/content/pageActions.js†L58-L110】
- Add-result formatting duplicates popup logic and mixes status string building with DOM updates, leading to inconsistent messaging between surfaces.【F:src/content/pageActions.js†L141-L158】

**Refactor ideas:**
- Separate DOM creation (toggle, action list, stop button) from behaviour controllers that manage timers and background messages.
- Share queue feedback utilities with the popup to avoid drift.
- Split long handler functions (`handleAddVisibleFromPage`, etc.) into pipeline helpers (discover cards → fetch metadata → add entries) with clear responsibilities.

### `src/background/messageHandlers.js` (678 lines)
**Role:** Single registry handling every runtime message, from queue mutations and collection triggers to playlist exports.【F:src/background/messageHandlers.js†L1-L45】

**Pain points:**
- No routing structure—handler functions directly implement business logic, call store mutations, trigger notifications, and gather responses, so edge cases leak between message types.【F:src/background/messageHandlers.js†L51-L143】
- Manual deduplication and validation repeated across handlers (e.g., `handleAddByIds`, `handleRemoveVideos`, `handleMoveVideos`).

**Refactor ideas:**
- Introduce a message router that maps message types to smaller handler modules (queue, lists, playback, collection).
- Centralise ID parsing/deduplication utilities shared by handlers.
- Move presentation-state shaping into a separate service to keep message handlers thin.

### `src/content/playerControls.js` (577 lines)
**Role:** Controls the in-player overlay, including toast notifications, auto-collect progress, and playback button state on the YouTube page.【F:src/content/playerControls.js†L1-L160】

**Pain points:**
- Notification rendering, auto-collect status translation, and control-state management live together, complicating unit testing and reuse between popup and inline UI.
- Auto-collect messaging duplicates logic in the popup collection controller, increasing maintenance risk.【F:src/content/playerControls.js†L96-L160】

**Refactor ideas:**
- Extract notification presentation into a shared module consumed by both the player and popup.
- Introduce a controller class that receives state updates from the background script and manipulates DOM via smaller view helpers.

### `src/store/state.js` (544 lines)
**Role:** Low-level persistence layer handling Chrome storage access, migrations, sanitisation, and default-state composition.【F:src/store/state.js†L1-L152】

**Pain points:**
- Storage migration logic, schema sanitisation, and runtime mutation helpers coexist, making the file difficult to navigate and increasing regression risk during storage changes.【F:src/store/state.js†L320-L430】

**Refactor ideas:**
- Separate migration and sanitisation into dedicated files; keep this module focused on state getters/setters.
- Extract persistence adapters (Chrome storage vs. in-memory fallback) for easier testing.

### `src/youTubeApiConnectors.js` (513 lines)
**Role:** Abstraction for YouTube Data API, covering authentication, retries, playlist/channel lookups, and helper utilities for subscription collection.【F:src/youTubeApiConnectors.js†L7-L160】

**Pain points:**
- Authentication retry logic, channel caching, and collection helpers are tightly coupled, making it hard to reuse API pieces independently.【F:src/youTubeApiConnectors.js†L7-L127】

**Refactor ideas:**
- Split HTTP transport (`callApi`), channel/subscription services, and playlist creation helpers into separate modules.
- Wrap API calls in typed service functions with explicit inputs/outputs, reducing reliance on implicit object shapes.

### `src/content/videoCards.js` (494 lines)
**Role:** Detects video/playlist cards on the page, extracts IDs, and applies inline controls with fallback heuristics.【F:src/content/videoCards.js†L17-L160】

**Pain points:**
- Complex heuristics, DOM traversal, and dataset parsing are embedded together, making it hard to add new card types without risking regressions.
- Shares constants and CSS class knowledge with other files but without a common abstraction.

**Refactor ideas:**
- Introduce dedicated parsers for playlist vs. video cards and a registry of heuristics.
- Share dataset parsing helpers with other controllers to avoid duplicated logic.

### `src/settings/settings.js` (477 lines)
**Role:** Handles settings page bootstrapping, filter row rendering, toast display, and YouTube API-backed dropdowns in one file.【F:src/settings/settings.js†L37-L139】

**Pain points:**
- DOM template cloning, persistence, and validation logic is interwoven, making the settings page brittle and hard to extend (e.g., toast, import/export, API calls in the same scope).【F:src/settings/settings.js†L113-L139】

**Refactor ideas:**
- Split into modules for filter group rendering, persistence/service calls, and UI feedback (toasts, validation messages).
- Convert repeated template usage into reusable helper classes/functions living under a `settings` namespace.

### `src/content/styles.js` (461 lines)
**Role:** Injects an enormous template literal containing all inline CSS used by the content scripts.【F:src/content/styles.js†L1-L320】

**Pain points:**
- Hard to maintain and diff because the CSS lives inside JavaScript; constants must stay in sync with other modules (`THUMB_HOST_CLASS`, etc.).

**Refactor ideas:**
- Move CSS into static files (e.g., imported stylesheets) or split template strings per feature (player controls, page actions, card badges).

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

