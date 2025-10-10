# YTautoPlaylist

Automatic playlist collector from YouTube subscriptions.

Browser extension for managing personal YouTube watch queues without relying on YouTube playlists. The project began as an automatic playlist builder and has grown into a full-featured queue manager that keeps track of what you watch, fetches fresh videos from subscriptions, and lets you curate multiple independent lists.

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

| Page type | Buttons | Behaviour |
| --- | --- | --- |
| Video watch (`/watch`) | "Add current video" | Adds the video being watched to the active queue. The button is hidden when the video already belongs to the queue that initiated playback. |
| Channel sections (`/@channel/videos`, `/@channel/featured`) and the home page | "Add visible" / "Add all" | "Add visible" collects thumbnails currently loaded in the DOM. "Add all" scrolls the page, triggering lazy loading until every video is processed. |
| Playlist pages | Same as channel pages | Works for official playlists and user-created collections. |

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

- Install dependencies once with `npm install`.
- During UI work run `npm run dev` and open `http://localhost:5173/src/popup/popup.html` to see the popup with hot module reload. This preview is served by Vite and does **not** update the packaged extension automatically.
- To produce a Chrome-loadable build run `npm run build:extension`. The script compiles the Svelte sources with Vite and stages the result, together with `manifest.json` and icons, inside `build/extension`.
- Load the unpacked extension from `build/extension` via `chrome://extensions` (enable Developer Mode → "Load unpacked"). After every rebuild, click the "Reload" button next to the extension entry so Chrome picks up the new `assets/*.js` bundle and HTML.
- `npm run build` outputs to `dist/` for static hosting; it will not refresh the extension directory.
- To clean build artifacts remove the `dist/` and `build/extension/` folders.
- The default list cannot be removed or renamed. All other lists are fully editable.
- Exported list files contain the queue items together with metadata and can be re-imported at any time.
- Debug mode skips persisting the collector timestamp in storage so repeated runs are possible without manual clean-up.

## ToDo

- [ ] Уведомление, что фильтры сохранили и более удобная кнопка для сохранения, чтобы не надо было листать вниз (better in-card filter editing UX with inline save notifications). К примеру прямо в карточке, если вносишь изменения. И обновляет данные по конкретной карточке, а не всем.
- [ ] Получить инфо о видео для создания фильтра. Указываешь ссылку, получаем важную информацию и предварительно отображаем форму фильтров на основании. Далее можно поправить и сохранить. Это отдельная форма. При сохранении значения подставляются в карточку соответствующего канала, или новую карточку канала. Т.е. сначала настраиваем, потом смотрим (video analysis helper form that pre-fills channel filters from a URL).
- [ ] Фильтр "наличие в плейлисте". Скорее по наличию фразы в тайтле плейлиста. Надо смотреть структуры данных (playlist presence filter using playlist titles).
- [ ] Фильтр на основе описания (description-based filtering).
- [ ] В случае какого-то сбоя работа должна "паузится" и сохраняться для продолжения. В логах должна быть информация что произошло и что будет далее. Если дошли до создания списка, то сохранять то что не добавили, чтобы закончить это в следующий заход. Если зависли на сборе информации, сохранить текущую инфу и продолжить. Это касается случаев, когда автоматически продолжить через несколько минут невозможно, т.е. пауза требует часов и суток, что ждать никто не будет (resumable state when long-running tasks fail mid-way).
- [ ] Локализация, поддержка английского (English UI localisation).
- [x] Интерфейс отображающий ход работы сбора плейлиста по api из подписок. Там должен быть прогресс как общий, так и по этапам, а также лог событий в удобном формате. Пройденные без ошибок этапы скрывать спойлерами. Текущий этап отображать в логе. Новые записи добавлять сверху, чтобы не прокручивать страницу. В итоге смотришь на добавление: идёт прогресс, внизу логи.
  - [x] Возможность не смотреть на логи (работа в фоне)
  - [x] Возможность вызывать интерфейс добавления
- [x] Не создавать список воспроизведения, а управлять списками. Собрать список дешево, а вот плейлист - дорого. Плюс плейлисты тратят ресурсы, тупят, лагают.
  - [x] Расширением управлять и переключать на следующее видео.
  - [x] Удалять просмотренные из списка, но сохранять возможность вернуться назад на 5 видео, т.е. удалять всё что далее последних 5 видео.
  - [x] На уровне расширения позволять что-то докинуть в очередь, легко и быстро удалить из очереди.
  - [x] Сделать возможность ведения нескольких списков: основной, отложить, и вручную созданные.
  - [x] Чтобы можно было самому создавать сколько угодно списков. И чтобы можно было быстро перетащить видео из основного в побочный, бех глюков поменять порядок видео в списке.
  - [x] Чтобы в любой момент можно было зайти на страницу и добавить вручную любое видео в список. Или автоматически добавить все, несколько.
  - [x] Управление плейлистами вести через папап и отдельную страницу.
    - [x] Текущий плейлист + кнопка пехода на страницу управления в попапе. Также там быстрые кнопка для переноса и удаления видео, обновления списка, переключения на другой лист.
    - [x] На странице управления уже более мощный интерфейс, возможность создавать листы, менеджерить их, переименовать, слиять.
- [ ] Комбинации фильтров через "и" и "или", чтобы можно было сделать: исключить трансляции с тегом X длиной больше 15 минут, исключить все шортсы кроме с Х в заголовке.

## Бонусные функции для работы с ютуб

- [x] Возможность добавить все видео со страницы в список расширения или список "очередь ютуб" или список "смотреть позже". Т.е. прокикать на странице кнопки, или собрать ссылки и добавить в очередь в прямом порядке. Встраивать на подходящую страницу кнопки для быстрых действий.
- [ ] Удалить просмотренные из текущего списка
  - [ ] Кнопка "удалить выше" - прокликать удаление из плейлиста от конкретного ввидео до начала, т.е. вверх
  - [ ] Если смотришь плейлист, то из списка воспроизведения прокликать удаление
- [ ] Возможность добавить фильтр находясь на канале, или прямо просматривая видео с предзаполнением полей: подхватить канал, название из видео, длительность, теги, тип.
- [ ] Дополнительные инструменты для продвинутой работы с плейлистами YouTube (additional power-user tools for manipulating YouTube playlists directly).

## License

[MIT](LICENSE)
