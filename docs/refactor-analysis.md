<!-- Repository map for future cleanup. Documents module ownership and the current bias toward simpler files over extra helper layers. -->

# Refactor Notes

This extension is loaded from the repository root. Runtime JavaScript is written in
`src/` and bundled into committed `build/` files by `npm run build:local`.
Do not hand-edit `build/`.

## Current Shape

| Area | Files | Responsibility |
| --- | --- | --- |
| Background | `src/background/**`, `src/store/**`, `src/youtube-api/**` | Chrome message handling, persistent queue state, auto-collection, playback ownership, and YouTube API calls. |
| Content script | `src/content/**` | YouTube page integration: card buttons, inline queue, playback controls, page actions, navigation hooks, and injected styles. |
| Popup | `src/popup/**` | Main popup queue/history/playback UI and the list manager. Shared popup DOM helpers live under `src/popup/lib/`. |
| Settings | `src/settings/**` | Filter editing, quick-filter setup, video checks, and settings persistence UI. |
| Shared utilities | `src/time.js`, `src/progress.js`, `src/utils.js`, `src/addResultMessages.js` | Small cross-cutting formatters and data helpers. Reuse these before adding feature-local copies. |
| Tests | `tests/**` | Focused Node tests for helpers and fragile state paths. They do not cover the full browser extension flow. |

Every runtime source file should start with a short comment that says why the file
exists. Large exported functions should have a short comment only when the control
flow is not obvious from the name and parameters.

## Cleanup Rules

- Prefer direct code inside the owning module when a helper has one caller and
  does not hide real complexity.
- Share only utilities that are already reused, or that remove meaningful
  duplicated behavior such as date, duration, progress, and message formatting.
- Avoid wrapper modules that only rename imports or pass data through unchanged.
- Keep feature files under their domain folders; do not add flat files directly
  under `src/content/`, `src/popup/modules/`, or `src/settings/`.
- When touching background/content/popup flows, trace one concrete scenario
  end-to-end before patching symptoms.

## Fragile Areas

Auto-collection, playback ownership, manual add targeting, inline queue buttons,
and popup manager detail refreshes have all regressed before. For these areas,
check the state shape, message route, content-side UI state, and stale popup cache
before adding another fallback.
