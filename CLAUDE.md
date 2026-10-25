# CLAUDE.md

Context for AI agents working on Task Organizer. The README is the user-facing
guide (install, build, publish); this file is the "how the code fits together"
summary. Read the README's "Project structure" section too.

## What it is

A personal task organizer + time tracker for a student: classes and
extracurriculars ("categories"), tasks under them, and timers that record
time sessions. No accounts, no cloud. One codebase, two runtimes:

- **Desktop (Windows/macOS)**: Flask + SQLAlchemy + SQLite (`app/`), wrapped
  in a tray/menu-bar app (`desktop/tray_app.py`), packaged with PyInstaller
  (`windows/`, `macos/`). The UI opens in the user's browser.
- **Phone (iPhone/Android)**: an installable PWA (`mobile/`). It reuses the
  exact same UI files, but `/api/...` calls are answered on the device by a
  JavaScript port of the server (`mobile/web/backend/`), with data in
  IndexedDB. Published to GitHub Pages by
  `.github/workflows/publish-phone-app.yml` on every push to `main` that
  touches `app/static/`, `app/templates/`, or `mobile/`.

## The one rule that bites: keep both backends in sync

Any change to server behavior must be made twice:

| Python (desktop)          | JavaScript (phone)                  |
| ------------------------- | ----------------------------------- |
| `app/models.py`           | `mobile/web/backend/models.js`      |
| `app/timers.py`           | `mobile/web/backend/timers.js`      |
| `app/stats.py`            | `mobile/web/backend/stats.js`       |
| `app/routes/*.py`         | `mobile/web/backend/routes.js` (+ backups in `index.js`) |
| `app/schema.py` (upgrades)| `mobile/web/backend/storage.js` `upgrade()` and `sqlite.js` import |

Both must return identical JSON; the shared UI can't tell them apart (it
checks `state.app.platform === "mobile"` only for small wording differences).

## Database compatibility rules

- Never rename or drop tables/columns. Only add columns (nullable or with a
  DEFAULT) and new tables. Old `tasks.db` files must keep opening, and
  upgraded files should stay readable by older builds.
- New column => add it to the model, to `COLUMN_MIGRATIONS` in
  `app/schema.py`, and on the phone side to `sqlite.js` (`SCHEMA`,
  `TABLE_COLUMNS`, `BOOLEAN_COLUMNS`/`DATETIME_COLUMNS` as needed, and a
  default in `importSqlite`) plus a default in `storage.js` `upgrade()`.
  `sqlite.js` `SCHEMA` must match what SQLAlchemy creates, because phone
  backups are loaded by the desktop app and vice versa.
- Phone rows store date-times as epoch ms; desktop uses naive local datetimes.

## Data model essentials

- `Category` (class/extracurricular) -> `Task` -> `TimeLog`. Every TimeLog
  belongs to a task (`task_id NOT NULL`); per-class stats join through the task.
- **General study**: each category can have one hidden task with
  `is_general = true` (title "General study"), created on demand by
  `timers.general_task()` / `generalTask()`. It holds time tracked on the
  class as a whole (the "Study" button on Tasks/Today, the "General study"
  choice in Focus and in Insights' "Add a time entry"). It is excluded from task
  lists, open counts, the calendar, and can't be completed or edited.
  Its API `title` is the display title "<Category> · General study".
  Endpoints: `POST /api/categories/<id>/timer/start`,
  `POST /api/categories/<id>/timer/log`, and `category_id` on
  `POST /api/focus/start`.
- Only one TimeLog is open at a time app-wide (starting any timer closes others).
- `FocusTimer` and `Settings` are single-row tables (id = 1).

## Frontend

Plain ES modules, no build step, no framework (`app/static/js/`).

- `core.js`: API client, `store.state` (the single `/api/state` snapshot
  every view renders from), formatting, shared HTML builders (`taskRow`,
  `taskOptions`), `toast()` (supports an action button, used for "Undo" after
  completing a task).
  Use `listedTasks()`/`openTasks()` rather than `state.tasks` when showing
  tasks to the user, so general study tasks stay hidden.
- `ui.js`: click/form delegation via `data-action="..."` / `data-form="..."`;
  register handlers with `registerActions({...})`.
- `main.js`: router (`#/today`, `#/tasks`, ...), sidebar, ticker, shared actions.
- `views/*.js`: one module per screen, each exporting `{ render(params), mount(root) }`.
- `drawer.js`: task details panel and task/category forms.
- Styles: `app/static/css/app.css` (light/dark via CSS variables);
  phone-only tweaks in `mobile/web/mobile.css`.

## Running and checking changes

- Desktop dev server: `pip install -r requirements.txt && python run.py`
  (http://localhost:5000). Use `TASKORGANIZER_DATA_DIR=/some/tmp/dir` to test
  against a throwaway database instead of `instance/tasks.db`.
- Phone build: `python mobile/build.py --serve` (http://localhost:8000).
- There is no test suite. Exercise the API with Flask's `app.test_client()`,
  and the phone backend by importing `mobile/web/backend/routes.js` in Node
  and calling `match(method, path).handler({ db, now, query, data, info, params })`.
- Phone users get updates automatically: pushing to `main` republishes, and
  the service worker (`mobile/web/sw.js`) picks up the new version the next
  time the app is opened online.
