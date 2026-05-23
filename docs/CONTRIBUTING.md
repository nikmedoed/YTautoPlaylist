<!-- Contributor workflow notes. Covers local setup, validation, and repository conventions for making changes safely. -->

# Contributing Guide

Thank you for helping improve **YTautoPlaylist**! This guide explains how the project is organized, the expectations for pull requests, and the quality gates we run automatically.

## Project structure and key modules

The extension is broken down into a few focused modules:

- `src/background/` and `src/background.js` coordinate the background service worker that orchestrates syncing and reacts to browser events.
- `src/content/index.js` is the only content-script entrypoint. Feature code lives in domain folders:
  `core/` for lifecycle, navigation, message wiring, and shared state;
  `playback/` for player controls, watchdogs, and playback notifications;
  `inline-queue/` for the watch-page queue UI;
  `page-actions/` for add-current/add-visible/add-all controls;
  `video-cards/` for YouTube card detection and overlays;
  `collection/` for content-side collection helpers;
  `styles/` for injected content-script CSS fragments.
- `src/popup/` renders the popup UI and relies on the store helpers in `src/store/`.
- `src/popup/modules/` is split by UI domain: `collection/`, `manager/`, `queue/`, `history/`, `playback/`, and `shared/`. Do not add another flat `managerFoo.js` or `queueFoo.js` file under `modules/`.
- `src/settings/index.js` is the settings page entrypoint. Settings implementation lives in `filters/`, `quick-filter/`, `shared/`, and `video-check/`; `settings.html` and `icons.svg` are static runtime files.
- `src/store/index.js` is the public store entrypoint. Store implementation is split into `src/store/state/` for storage keys, schema sanitizing, serialization, persistence, and video progress metadata, and `src/store/actions/` for queue, list, playback, history, presentation, and auto-collect mutations. Keep new store code inside those folders instead of adding root-level `store*` or `state*` files.
- `src/playlist.js` and `src/store/` encapsulate playlist synchronization, persistence, and queue actions.
- `src/youtube-api/` contains the YouTube Data API layer: `transport.js` handles authenticated requests, `channels.js` handles subscriptions/channel metadata, `videos.js` handles uploads/search/video metadata, and `playlists.js` handles playlist operations.
- `src/filter.js`, `src/utils.js`, `src/time.js`, and `src/auth.js` implement filtering, utility helpers, scheduling, and authentication flows shared across the extension.
- `scripts/` contains automation utilities, including the packaging script and quality checks used in CI.

If you introduce new content-script files, put the full feature family in the matching domain folder. Do not leave one related file at `src/content/` root or split a single feature across root-level files. Add new top-level folders only when the responsibility does not fit the existing domains.

If you introduce new files or modules outside the existing domains, add them to the list above and briefly describe their responsibility so future contributors can find the relevant code quickly.

## Coding standards

- Keep every source file under **400 lines**. Larger files are difficult to review and maintain. The pre-commit checks and CI pipeline will fail if you exceed this limit.
- Prefer small, reusable modules over monolithic files. If a file approaches 350 lines, consider extracting helpers.
- Follow the ESLint recommendations enforced by `eslint.config.js`. Update the configuration only when the entire team agrees on the change.
- Legacy files that exceed the 400-line limit are tracked in `config/file-length-baseline.json`. If you touch one of those files, reduce its size and update the baseline entry accordingly.

## Testing requirements

Before sending a pull request:

1. Run `npm install` to ensure you have the current linting and Husky hooks.
2. Execute `npm run lint` to confirm the code is free of ESLint errors and warnings.
3. Execute `npm test` to run the integration tests in `tests/`.
4. Run `npm run check:files` to verify all tracked files meet the 400-line limit (the command ignores files listed in `config/file-length-baseline.json`).

All of these commands will be executed automatically by Husky and GitHub Actions, but running them locally helps you catch issues earlier.

## Git workflow

- Create feature branches with descriptive English names (for example, `feature/file-length-check`).
- Keep pull requests focused on a single change so reviews stay quick and targeted.
- Update documentation and tests alongside code changes whenever you add new features or modify existing behavior.

Thank you again for contributing! With your help we can keep YTautoPlaylist reliable and easy to maintain.
