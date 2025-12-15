# YTautoPlaylist

Automatic playlist collector from YouTube subscriptions.

Browser extension for managing personal YouTube watch queues without relying on YouTube playlists. The project began as an automatic playlist builder and has grown into a full-featured queue manager that keeps track of what you watch, fetches fresh videos from subscriptions, and lets you curate multiple independent lists.

## Build

Run `npm run build` to prepare a clean `dist/extension` directory with only the files required for packaging the browser extension. The script copies `manifest.json`, the `src/` tree, and the icons, then writes a production-ready `config.js` with `DEV_MODE = false` so branch-specific configuration files (docs, tests, `config.branch.js`, etc.) stay out of the published zip.

### Styling structure

Popup styles now live under `src/popup/styles/` split into smaller, page-focused files (`base.css`, `collection.css`, `queue.css`, `manager.css`). Each HTML entry point links only the slices it needs, which keeps styles reusable without forcing contributors to scroll through a single 1,000-line sheet.

## Key concepts

- **Queues instead of playlists.** Videos are stored inside the extension, not in YouTube playlists. The extension opens the selected video in the current tab, advances to the next item when playback ends, and automatically keeps the queue populated.
- **History-aware clean-up.** Watched entries are removed once they drop more than five positions behind the currently playing video. The last five completed videos remain available for quick backtracking.
- **Multiple lists.** Besides the default queue, you can create as many named lists as you need. Lists can be frozen (do not auto-remove watched items) or disposable. Videos can be moved between lists with drag-and-drop or via bulk actions.
- **Shared history.** Playback history is global, so moving to another list preserves your ability to jump back through the last watched videos.
- **Import/export.** Lists can be exported to a file and later imported either into a new list or merged with an existing one.
- **Automatic refills.** When the default list is about to run dry (only the current and one queued video remain), the subscription collector is triggered automatically to fetch more content.
- **Debug-friendly.** In debug builds the extension avoids persisting collection timestamps, making it easy to re-run data gathering without clearing storage.

## User interface overview

### Popup player panel

Clicking the toolbar icon opens the popup with playback controls and queue management tools:

1. **Playback controls.** "Previous" and "Next" buttons are rendered inside the YouTube player (right above the progress bar) and respond to both on-screen clicks and media keyboard keys. The popup controls mirror these actions.
2. **Queue list.** Each card shows the thumbnail, title, channel, publication date and action buttons:
   - Click anywhere on the card to start playback from that video.
   - Drag the left grab bar to reorder items.
   - Use the top-right cross to remove a video.
   - Use the move button (top-left) to transfer the video to another list.
3. **Quick actions.** Buttons above the list allow you to switch the active list, open the full management page, refresh the queue and toggle whether watched items should be auto-removed (available for non-default lists).
4. **History section.** The last ten watched videos are available at the bottom. Clicking an item resumes playback from that point. A separate button restores the most recent history item to the top of the active queue.

### Full management page

The dedicated page provides advanced tooling:

- **List selector.** The active list is highlighted. Buttons to create, import, export, rename, freeze/unfreeze auto-cleanup, merge or delete lists open modal dialogs. Deleting a list asks whether to move its videos to the default list or drop them.
- **Bulk operations.** Checkboxes to the left of each card allow multi-selection (with shift-click support). Bulk move and bulk delete actions operate on the selection. There are quick buttons to select all or clear the selection.
- **Video cards.** Cards match the popup layout, keeping thumbnails proportional and controls consistent. Drag-and-drop reordering is available here as well.
- **Progress monitor.** The subscription collector panel (when active) shows the current stage, overall progress bar, and a concise event log with the newest entries on top. Completed stages collapse automatically. The interface can run in the background if you do not need to observe it.

## Adding videos to queues

The extension augments YouTube pages with context-aware controls:

| Page type                                                                     | Buttons                   | Behaviour                                                                                                                                          |
| ----------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Video watch (`/watch`)                                                        | "Add current video"       | Adds the video being watched to the active queue. The button is hidden when the video already belongs to the queue that initiated playback.        |
| Channel sections (`/@channel/videos`, `/@channel/featured`) and the home page | "Add visible" / "Add all" | "Add visible" collects thumbnails currently loaded in the DOM. "Add all" scrolls the page, triggering lazy loading until every video is processed. |
| Playlist pages                                                                | Same as channel pages     | Works for official playlists and user-created collections.                                                                                         |

Additionally, each video thumbnail receives a compact add button in the top-left corner so you can quickly enqueue individual items without opening them. Buttons appear consistently across supported layouts without covering native YouTube controls.

Videos added through any method include their title, thumbnail, publication date and channel metadata so that the queue view always has rich context.

## Playback behaviour

- The extension only intercepts navigation when playback originates from the queue. Manual navigation by the user is respected.
- When the currently playing video finishes, the next item from the active queue opens automatically in the same tab.
- Selecting "Next" via the popup, the embedded buttons, or media keyboard keys moves the current video to history and starts the following entry.
- The "Previous" action pulls the most recent item from history, places it above the currently playing video and starts playback.
- If a non-default list reaches the end, the extension notifies you instead of auto-refreshing the list.

## Subscription collector UI

The collector can be launched from both the popup and the management page. It runs in the background but you can open the monitor to inspect the process:

- Overall progress indicator shows the share of completed stages.
- Each stage (e.g. "Fetching subscriptions", "Loading videos", "Filtering", "Appending to queue") displays its own progress and collapsible log.
- Log entries are concise human-readable updates with the newest messages on top.
- While the collector is active, status messages remain visible; when idle, the panel hides automatically.

## Development notes

- The default list cannot be removed or renamed. All other lists are fully editable.
- Exported list files contain the queue items together with metadata and can be re-imported at any time.
- Debug mode skips persisting the collector timestamp in storage so repeated runs are possible without manual clean-up.

## ToDo

- [ ] Получить инфо о видео для создания фильтра. Указываешь ссылку, получаем важную информацию и предварительно отображаем форму фильтров на основании. Далее можно поправить и сохранить. Это отдельная форма. При сохранении значения подставляются в карточку соответствующего канала, или новую карточку канала. Т.е. сначала настраиваем, потом смотрим (video analysis helper form that pre-fills channel filters from a URL).
- [ ] Новые фильтры
  - [ ] Фильтр "наличие в плейлисте". Скорее по наличию фразы в тайтле плейлиста. Надо смотреть структуры данных (playlist presence filter using playlist titles).
  - [ ] Фильтр на основе описания (description-based filtering).
- [ ] В случае какого-то сбоя работа должна "паузится" и сохраняться для продолжения. В логах должна быть информация что произошло и что будет далее. Если дошли до создания списка, то сохранять то что не добавили, чтобы закончить это в следующий заход. Если зависли на сборе информации, сохранить текущую инфу и продолжить. Это касается случаев, когда автоматически продолжить через несколько минут невозможно, т.е. пауза требует часов и суток, что ждать никто не будет (resumable state when long-running tasks fail mid-way).
- [ ] Локализация, поддержка английского (English UI localisation).
- [ ] Синхронизация списков между разными браузерами в рамках одного аккаунта.
- [ ] Настроить авторизацию, чтобы использовать расширение не только в dev браузере.

## Бонусные функции для работы с ютуб

- [ ] Возможность добавить фильтр находясь на канале, или прямо просматривая видео с предзаполнением полей: подхватить канал, название из видео, длительность, теги, тип.
- [ ] Комбинации фильтров через "и" и "или", чтобы можно было сделать: исключить трансляции с тегом X длиной больше 15 минут, исключить все шортсы кроме с Х в заголовке.

## License

[MIT](LICENSE)
