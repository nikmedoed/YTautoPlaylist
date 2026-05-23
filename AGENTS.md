<!-- Codex working notes for this repository. Covers fragile extension flows, build rules, and validation commands that should guide future edits. -->

You are able to use the Svelte MCP server, where you have access to comprehensive Svelte 5 and SvelteKit documentation. Here's how to use the available tools effectively:

## Available MCP Tools:

### 1. list-sections

Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.
When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

### 2. get-documentation

Retrieves full documentation content for specific sections. Accepts single or multiple sections.
After calling the list-sections tool, you MUST analyze the returned documentation sections (especially the use_cases field) and then use the get-documentation tool to fetch ALL documentation sections that are relevant for the user's task.

### 3. svelte-autofixer

Analyzes Svelte code and returns issues and suggestions.
You MUST use this tool whenever writing Svelte code before sending it to the user. Keep calling it until no issues or suggestions are returned.

### 4. playground-link

Generates a Svelte Playground link with the provided code.
After completing the code, ask the user if they want a playground link. Only call this tool after user confirmation and NEVER if code was written to files in their project.

## Project Handoff Notes

The current project is a YouTube extension with a fragile state flow between:
- background store/state sync
- content scripts on youtube.com
- popup manager UI

Recent work touched many areas and regressions happened multiple times. Do not assume the current behavior is fully fixed. When the user reports breakage, inspect the exact code path first instead of layering another workaround.

### High-risk areas

- Auto-collect from subscriptions
  - Files: `src/background/collectionSync.js`, `src/playlist.js`, `src/youtube-api/channels.js`, `src/youtube-api/videos.js`, `src/store/actions/autoCollect.js`, `src/store/state/`
  - Intended algorithm:
    - if `lastRunAt` is missing -> collect last 7 days
    - if `lastRunAt` exists -> collect from it
    - update `lastRunAt` only after a successful full collect + add stage
    - store `lastRunAt` as the successful run start timestamp
  - Current protection:
    - cooldown bypass was removed
    - fetch uses a 48h overlap window to reduce misses from late YouTube API indexing
    - already existing queue IDs are excluded before filtering to reduce overlap cost
  - Residual risk:
    - skipped videos may still exist; if reported again, trace a specific missing video/channel through `getNewVideos` and `filterVideos`

- Playback / next video / end-of-video handling
  - Files: `src/background/playback.js`, `src/background/messages.js`, `src/content/playback/controls.js`, `src/content/core/messages.js`, `src/content/core/navigation.js`
  - Known fragile points:
    - ownership of the active playback tab
    - `player:videoEnded` races
    - YouTube navigation start/finish timing
    - content-side `setControlsActive(...)` and queue state sync
  - Important fix already made:
    - `src/content/core/messages.js` must use `currentQueue.queue`, not a nonexistent `queue` field

- Manual add / list targeting
  - Files: `src/content/page-actions/index.js`, `src/content/video-cards/index.js`, `src/popup/popup.js`, `src/background/services.js`
  - Important fix already made:
    - manual add actions now pass explicit `listId`
  - Reason:
    - background `currentListId` can drift because of playback/state changes, causing videos to be added to the wrong list

- Inline playlist on the YouTube watch page
  - Files: `src/content/inline-queue/index.js`, `src/content/video-cards/index.js`, `src/content/styles/index.js`
  - Important fix already made:
    - add-overlay buttons must not appear inside `.yta-inline-queue`
  - If this regresses, inspect `enhanceVideoCards(...)` first

- Popup manager UI
  - Files: `src/popup/lists.js`, `src/popup/lists.html`, `src/popup/modules/*`
  - Recent addition:
    - button `Удалить просмотренные` removes videos in the current list with `videoProgress > 95` after confirmation

### Validation notes

- Build layout:
  - Load the repository root in `chrome://extensions`; `manifest.json` stays in the root.
  - Hand-edit runtime/static files in place: `manifest.json`, `src/**/*.html`, `src/**/*.css`, `src/settings/icons.svg`, and `icon/icon.png`.
  - Keep non-runtime design/source assets outside the extension package, e.g. `assets/`.
  - Hand-edit JavaScript source in `src/`.
  - Content script source is rooted at `src/content/index.js`; feature files belong under `src/content/core/`, `playback/`, `inline-queue/`, `page-actions/`, `video-cards/`, `collection/`, or `styles/`.
  - Do not add isolated feature files directly under `src/content/`; keep related content-script files together in a domain folder.
  - Settings source is rooted at `src/settings/index.js`; feature files belong under `filters/`, `quick-filter/`, `shared/`, or `video-check/`.
  - Popup modules are grouped under `src/popup/modules/collection/`, `manager/`, `queue/`, `history/`, `playback/`, and `shared/`; do not add flat prefixed module files.
  - `build/` is generated JavaScript output and is committed so the extension works from a fresh checkout.
  - Do not hand-edit anything in `build/`; update `src/` and run `npm run build:local`.
  - `npm run dev` watches JavaScript sources and rebuilds `build/`.
  - Static edits do not need a build step; reload the extension to see them.
  - `npm run build` creates a clean minified release folder.

- Tests are limited and mostly cover API/helpers, not the full extension flow
- Useful commands:
  - `npm run build:local`
  - `npm test`
  - `npm run lint`
- After content/background changes, the extension must be reloaded in `chrome://extensions` and the YouTube tab must be fully refreshed

### Working rule for future fixes

If a new regression appears:
- do not assume the last patch is correct
- trace one concrete scenario end-to-end
- verify whether the failure is in:
  - store state
  - background message routing
  - content-script local UI state
  - popup stale details/cache
