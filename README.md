# Task Organizer & Time Tracker

A personal task organizer: keep track of classes, extracurriculars, and
homework, and see how much time you actually spend on each one.

It comes in two versions that share the same screens:

| Version | Where it lives | How it runs |
| --- | --- | --- |
| **Windows & macOS** | `app/`, `desktop/`, `windows/`, `macos/` | A small background app. Double-click it once, a tray/menu-bar icon appears, and the app opens in a normal browser tab. Data is a SQLite file on the computer. |
| **iPhone & Android** | `mobile/` | An installable web app. Friends open a link and tap "Add to Home Screen". It gets its own icon, runs full screen, works offline, and keeps its data on the phone. See [the phone app](#5-phone-app-iphone--android). |

There are no cloud services, no accounts, and nothing to pay for. Each
computer or phone keeps its own data; you can move data between them with
backup files.

## What's in it

- **Today**: a greeting, your tracked time against a daily goal (with a
  streak counter), how today compares with yesterday and your 7-day average,
  whatever timer is running, a quick-add box, and your overdue, due-today,
  and upcoming tasks plus today's time sessions.
- **Tasks**: every task, grouped by class or activity. You can search,
  filter by status, priority, or due date, sort, and see completed history.
  A period bar shows planned, remaining, and actual time for "this period"
  (Mon–Sun by default; you can pick any range). Each class or activity has a
  **Study** button that times general studying on that class without
  picking a task.
- **Calendar**: month and week views of due dates, with the time you
  tracked on each day. Click a day to add a task due then.
- **Focus**: a countdown timer ("give me 45 minutes on this"), a Pomodoro
  timer (focus/break cycles), or a plain stopwatch. Time on a linked task, or
  on a class as a whole ("General study"), is recorded automatically. When a timer ends you get a chime and a desktop
  notification, even if the tab is in the background.
- **Insights**: time per day (stacked by class), totals by class, a
  six-month heatmap, busiest weekdays, goal streaks, and how accurate your
  time estimates are. Any time session can be edited or deleted, you can add
  missed time by hand, and you can export everything to CSV.
- **Settings**: daily goal, Pomodoro lengths, the "forgotten timer"
  warning, sound, light/dark/system theme, which days make up a period,
  opt-in access from other devices, and backups.

Other helpers:

- **Task details panel**: click any task to see its notes, progress against
  its estimate, and every time session, which you can edit inline.
- **Forgotten-timer banner**: if a timer has been running longer than your
  warning threshold (3 hours by default), the app asks whether you're still
  working and lets you set when you actually stopped.
- **Undo**: the "marked done" message has an **Undo** button that reopens
  the task right away.
- **Repeating tasks**: completing a repeating task creates the next one.
- **Keyboard shortcuts**: `N` new task, `/` search, `T` stop the running
  timer (or open Focus), `1`–`6` switch views, `?` show all shortcuts,
  `Esc` close panels.

## Table of contents

1. [Try it locally first](#1-try-it-locally-first)
2. [Build the app (one-time)](#2-build-the-app-one-time)
3. [Send it to someone / distribute it](#3-send-it-to-someone--distribute-it)
4. [Day-to-day usage](#4-day-to-day-usage)
5. [Phone app (iPhone & Android)](#5-phone-app-iphone--android)
6. [Opening the computer version from a phone on your WiFi](#6-opening-the-computer-version-from-a-phone-on-your-wifi)
7. [Data & backups](#7-data--backups)
8. [Troubleshooting](#8-troubleshooting)
9. [Project structure](#9-project-structure)

---

## 1. Try it locally first

Sections 1–4 are about the Windows/macOS version. The phone version is in
[section 5](#5-phone-app-iphone--android).

This is useful while you're changing the code, before building the packaged
app. You'll need Python 3 installed.

```bash
cd TaskOrganizer
python3 -m venv .venv
source .venv/bin/activate        # on Windows: .venv\Scripts\activate
pip install -r requirements.txt
python run.py
```

Open `http://localhost:5000`. Press `Ctrl+C` in the terminal to stop it. By
default this uses a local SQLite file at `instance/tasks.db`.

Useful environment variables:

| Variable | What it does |
| --- | --- |
| `PORT` | Port to listen on (default `5000`). |
| `FLASK_DEBUG=1` | Auto-reload on code changes, with detailed errors. |
| `TASKORGANIZER_DATA_DIR` | Use a database in another folder, e.g. a throwaway copy for testing. |

> If port 5000 is already in use (common on macOS because of AirPlay
> Receiver), run `PORT=5050 python run.py` (PowerShell:
> `$env:PORT=5050; python run.py`) and use that port in the URL.

You can also run the tray/menu-bar version straight from Python (no build
needed) with `python desktop/tray_app.py` instead of `run.py`.

---

## 2. Build the app (one-time)

This packages everything into a single standalone app that runs without
Python installed. **PyInstaller can't cross-compile**, so each platform's
app has to be built on that platform. This is a one-time step for whoever
maintains the code, not something each recipient has to do.

### Windows

On a Windows machine with [Python 3](https://python.org/downloads) installed:

1. Copy or clone this project folder onto the Windows PC.
2. Double-click `windows\build.bat`, or run `windows\build.bat` from a
   terminal.

The script is safe to re-run. It creates a virtual environment (`.venv`),
installs the requirements plus PyInstaller, generates the app icon
(`windows/icon.ico`), and runs PyInstaller with `windows/taskorganizer.spec`.
When it finishes, you'll have `dist\TaskOrganizer.exe`.

### macOS

On a Mac with [Python 3](https://python.org/downloads) installed (or the one
that ships with the Xcode Command Line Tools):

1. Copy or clone this project folder onto the Mac.
2. Run `bash macos/build.sh` from a terminal.

The script is safe to re-run. It creates a virtual environment, installs the
requirements plus PyInstaller, generates `macos/icon.icns`, builds a proper
`.app` with `macos/taskorganizer.spec`, and zips it with `ditto` (the
Mac-safe way to zip an app bundle). When it finishes, you'll have
`dist/TaskOrganizer.app` and `dist/TaskOrganizer.zip`.

---

## 3. Send it to someone / distribute it

- **Windows**: `dist\TaskOrganizer.exe` is the whole app, so just send that
  one file. The recipient doesn't need Python or this repository. They save
  the `.exe` somewhere (ideally its own folder, since its data file is
  created next to it; see [Data & backups](#7-data--backups)) and
  double-click it.
- **macOS**: send `dist/TaskOrganizer.zip`. The recipient unzips it and can
  put `TaskOrganizer.app` anywhere (its data lives in Application Support,
  not next to the app).

---

## 4. Day-to-day usage

- **Opening the app**: double-click `TaskOrganizer.exe` (Windows) or
  `TaskOrganizer.app` (macOS). A browser tab opens on the Today view.
  - On Windows, an icon appears in the system tray (bottom-right of the
    taskbar, possibly under the "^" overflow arrow).
  - On macOS, an icon appears in the menu bar, and the app shows a Dock
    icon while it's running.
- **Closing the browser tab does not stop the app.** It keeps running in
  the background, so timers keep counting. The tray/menu-bar icon has:
  - **Open Task Organizer**: reopens the app in your browser.
  - **Open Focus timer**: jumps straight to the Focus view.
  - **Stop running timer**: only shown while a timer is running.
  - **Quit**: stops the background app. A running timer is saved and
    keeps counting from when it started the next time you open the app; the
    forgotten-timer banner will help you fix it if you forgot about it.
- **Opening the app again** while it's already running just reopens the
  browser tab instead of starting a second copy.
- **Only one timer runs at a time.** Starting a timer on another task (or
  starting a focus session) stops the current one first.
- **Starting automatically on login** isn't set up by default.
  - Windows: press `Win+R`, type `shell:startup`, and put a shortcut to the
    `.exe` in the folder that opens.
  - macOS: open **System Settings → General → Login Items** and add
    `TaskOrganizer.app` under "Open at Login".

---

## 5. Phone app (iPhone & Android)

The phone version is the same app with the same screens, packaged as an
installable web app (a "PWA"). There is no app store and nothing to pay for:
you publish it once to a free GitHub Pages website, and friends install it
from that link. One version covers both iPhone and Android.

How it differs from the computer version:

- **Data stays on each phone.** The app works fully offline and nothing is
  sent anywhere. Each person's tasks live only on their own phone, and the
  phone and computer versions don't sync automatically (see
  [moving data](#moving-data-between-the-computer-and-a-phone)).
- **Timer alerts only fire while the app is open.** Phones pause web apps
  in the background. A running timer still records the right amount of time,
  and you get the chime/notification when you come back to the app.
- Settings has no "Access from other devices" card or keyboard shortcuts.

### 5a. Publish it (one time, for whoever maintains the code)

You need a free [GitHub](https://github.com) account and
[Git](https://git-scm.com/downloads).

1. On GitHub, click **New repository**, name it (for example
   `TaskOrganizer`), and make it **Public**. Free GitHub Pages sites need a
   public repository. Only the app's code becomes public, never anyone's
   tasks: those stay on each phone. Your local `tasks.db` is excluded by
   `.gitignore`.
2. Upload this project folder. From a terminal in the project folder:

   ```bash
   git init
   git add .
   git commit -m "Task Organizer"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/TaskOrganizer.git
   git push -u origin main
   ```

3. In the repository on GitHub, go to **Settings → Pages**, and under
   **Build and deployment → Source** choose **GitHub Actions**.
4. Go to the **Actions** tab and open **Publish phone app**. If it hasn't
   run yet (or failed because step 3 wasn't done), click **Run workflow**.
   After a minute or so it shows a green check.
5. Your app is now at **`https://YOUR-USERNAME.github.io/TaskOrganizer/`**
   (the address is also shown on the **Settings → Pages** screen). That's
   the link you send to friends.

**Updating it later:** commit and push your changes
(`git add . && git commit -m "..." && git push`). The workflow rebuilds and
republishes automatically. Phones pick up the new version the next time the
app is opened with an internet connection. If someone doesn't see it, have
them close the app fully and open it again.

**Without GitHub:** run `python mobile/build.py` and upload the
`mobile/dist` folder to any static web host that uses HTTPS. For example,
drag it onto [Netlify Drop](https://app.netlify.com/drop). The site has to
be HTTPS for installing and offline use to work.

**Trying it on your computer first:** `python mobile/build.py --serve`
builds the app and serves it at `http://localhost:8000`. It also prints an
address you can open from a phone on the same WiFi, which is good for a
quick look. Installing and offline use only work from the HTTPS (GitHub
Pages) link.

### 5b. Install it on an iPhone

1. Open the link in **Safari**.
2. Tap the **Share** button (the square with an arrow pointing up; on
   newer iOS it may be under the **⋯** button at the bottom).
3. Scroll down and tap **Add to Home Screen**, then **Add**.
4. Open **Tasks** from your home screen. Always use this icon rather than
   the Safari tab, because the home-screen app keeps its own data.

Optional: to get a notification when a focus timer ends, open the app from
the home screen, go to **Focus** or **Settings**, and tap **Allow
notifications**. This needs iOS 16.4 or newer.

### 5c. Install it on an Android phone

1. Open the link in **Chrome**.
2. Tap **Install** if a prompt appears at the bottom. Otherwise tap the
   **⋮** menu, then **Install app** (or **Add to Home screen → Install**).
3. Open **Tasks** from your home screen or app drawer.

Optional: tap **Allow notifications** on the **Focus** or **Settings** page
to get a notification when a focus timer ends.

### Moving data between the computer and a phone

Backup files are interchangeable: a backup from the computer version loads
on a phone, and a phone backup loads on the computer.

1. On the device that **has** the data: **Settings → Your data →** turn on
   **Show database sync**, then tap **Push (save a copy)**. On a phone this
   opens the share sheet. Choose **Save to Files**, Google Drive, or email
   it to yourself.
2. Get the file onto the other device (AirDrop, email, iCloud Drive,
   Google Drive, USB…).
3. On the device that should **receive** it: turn on **Show database sync**
   too, tap **Pull (load a copy)**, and pick the file. This **replaces**
   everything on that device. If you change your mind, the phone app has
   an **Undo the last Pull** button.

### Keep a backup

Removing the app from your home screen, or clearing Safari/Chrome website
data, deletes the phone's tasks. Now and then tap **Settings → Your data →
Download a backup** and save the file somewhere safe.

---

## 6. Opening the computer version from a phone on your WiFi

This is an alternative to the phone app: the phone just shows the computer's
data, and only works while the computer is on and on the same WiFi. By
default the app is only reachable from the computer it runs on. To open it
from a phone or tablet on the same WiFi:

1. Go to **Settings → Access from other devices** and turn on **Allow access
   from other devices**.
2. Quit the app from the tray/menu-bar icon and open it again (the setting
   takes effect at startup).
3. The sidebar and the Settings page now show an address like
   `http://192.168.1.42:5000`. Type it into your phone's browser.

There's no login: anyone who can reach that address on your WiFi has the
same access as you. Only turn this on for a home network you trust, not
school, work, or public WiFi.

---

## 7. Data & backups

- **Where your data lives**
  - **Windows**: `instance\tasks.db`, created next to `TaskOrganizer.exe`
    the first time it runs. Moving the `.exe` together with its `instance`
    folder brings your data along.
  - **macOS**: `~/Library/Application Support/TaskOrganizer/tasks.db`. It
    isn't kept next to the app because macOS sometimes runs unsigned apps
    from a temporary read-only copy ("app translocation").
  - **Phone app**: stored inside the app on the phone (the browser's
    storage for that website). See [the phone app](#keep-a-backup).
  - The Settings page always shows the exact path in use.
- **Old databases keep working.** Database files from earlier versions of
  Task Organizer (including the original Raspberry Pi dashboard) open
  without any manual steps: the app adds the new columns and tables it
  needs and leaves your classes, tasks, and time logs untouched.
- **Automatic pre-upgrade backup**: before it changes an existing database,
  the app saves a copy next to it named
  `tasks-pre-upgrade-YYYYMMDD-HHMMSS.db` (the newest five are kept). If
  anything ever looks wrong after an update, quit the app and rename that
  copy back to `tasks.db`.
- **Manual backups**: **Settings → Your data → Download a backup** saves a
  timestamped copy of the database wherever you like.
- **Export**: **Export time logs (CSV)** (in Settings, or on Insights for
  the selected range) opens in Excel, Numbers, or Google Sheets.
- **Moving data between computers**: turn on **Show database sync** in
  Settings to get **Push** (send your database to another running copy) and
  **Pull** (replace this computer's data with a downloaded database file).
  Pull keeps a backup of what it replaces, and older database files are
  upgraded automatically after a pull.
- **Want to start over?** Quit the app, delete the database file for your
  platform (above), and start it again. A fresh empty database is created.
- **Keeping the database in iCloud/OneDrive/Dropbox**: avoid running the app
  on two computers against the same synced database file at the same time.
  The sync service can't merge two SQLite files and one copy's changes will
  be lost. Use backups or Push/Pull instead.

---

## 8. Troubleshooting

- **The app opens on a port other than 5000**: if port 5000 is taken
  (often by macOS's AirPlay Receiver), the app automatically tries 5001,
  5002, and so on. Use the tray icon's **Open Task Organizer** rather than
  a bookmarked URL, since it always knows the port in use.
- **No sound or notification when a timer ends**: browsers only allow sound
  after you've clicked somewhere on the page once, so click anywhere in the
  app after opening it. For notifications, click **Enable notifications** on
  the Focus page and allow them when the browser asks. Also check that
  **Sound** is on in Settings and that your system isn't in Do Not Disturb /
  Focus mode.
- **A phone can't connect** (after turning on access from other devices and
  restarting the app):
  - **Windows Firewall**: the first time the app listens on the network,
    Windows may ask whether to allow it. Click **Allow access** and tick both
    "Private" and "Public" networks if offered. macOS shows a similar
    "accept incoming connections" prompt.
  - **Client isolation**: many school, work, and guest networks block
    devices from talking to each other. Try a home network.
  - Use the exact address shown in the sidebar/Settings; the IP changes if
    your computer reconnects to WiFi.
- **"Windows protected your PC" / unknown publisher**: expected for an
  unsigned personal app. Click **More info**, then **Run anyway**.
- **macOS says "Apple could not verify…"**: right-click (or Control-click)
  `TaskOrganizer.app`, choose **Open**, then **Open** again. You only need to
  do this the first time.
- **Nothing seems to happen when opening the app**: give it a few seconds
  to start the server. If no tab opens, check whether the tray/menu-bar icon
  appeared and use **Open Task Organizer**.
- **Antivirus flags the app**: this can happen with any unsigned
  PyInstaller app. It's a false positive; the packaged app contains only
  what's in this repository.
- **Phone app shows an old version**: it updates the next time it's opened
  with an internet connection. Close it completely (swipe it away in the
  app switcher) and open it again.
- **iPhone: "Add to Home Screen" is missing**: make sure you're in Safari
  (not an in-app browser such as Instagram's or Gmail's). Scroll down in the
  share sheet, or tap **Edit Actions** to add it.
- **Android: no "Install" option**: use Chrome, and make sure you opened the
  `https://` GitHub Pages link, not a `http://` test address.
- **Phone app timer didn't alert me**: phones pause web apps in the
  background, so the alert appears when you return to the app. The tracked
  time is still correct.
- **Rebuilding after code changes**: re-run `windows\build.bat` or
  `macos/build.sh`. Rebuilding never touches existing database files.

---

## 9. Project structure

The screens (`app/static/` and `app/templates/app.html`) are shared by every
version. The Windows/macOS app serves them from a small Python server; the
phone app copies them and swaps the server for a JavaScript port of it that
runs on the phone (`mobile/web/backend/`). If you change server logic in
`app/*.py` or `app/routes/`, make the same change in the matching
`mobile/web/backend/` file.

```
TaskOrganizer/
  app/                    Shared by every version
    __init__.py           App factory: picks the data folder, runs database upgrades
    extensions.py         Shared SQLAlchemy instance
    models.py             Category, Task, TimeLog, Settings, FocusTimer models
    schema.py             Additive database upgrades + pre-upgrade backup copies
    stats.py              Per-day totals (split at midnight), streaks, insights
    timers.py             Stopwatch, countdown, and Pomodoro logic
    routes/
      pages.py            Serves the single-page app (/manage redirects to it)
      api_tasks.py        /api/state, classes/activities, tasks
      api_time.py         Timers, focus sessions, time-log editing
      api_stats.py        /api/stats for Insights and the calendar
      api_settings.py     Settings, backups, CSV export, database push/pull
      common.py           Shared request/response helpers
    templates/
      app.html            Page shell (sidebar, view area, modals)
    static/
      css/app.css         All styles, light and dark themes
      js/main.js          Router, sidebar, live clocks, shortcuts, polling
      js/core.js          API client, shared state, formatting helpers
      js/ui.js            Click/form delegation, modals, period picker
      js/drawer.js        Task details panel, task and class forms
      js/charts.js        Small SVG charts (bars, ring, heatmap)
      js/alerts.js        Chime + desktop notifications
      js/theme.js         Light/dark/system theme switching
      js/views/           today, tasks, calendar, focus, insights, settings
  desktop/
    tray_app.py           Tray/menu-bar icon + background server (packaged entry point)
  windows/                build.bat, make_icon.py, taskorganizer.spec
  macos/                  build.sh, make_icon.py, taskorganizer.spec
  mobile/                 iPhone & Android (installable web app)
    build.py              Assembles the app into mobile/dist/ (--serve to try it)
    make_icons.py         Redraws the home-screen icons
    web/
      boot.js             Starts the phone app: installs the on-device backend, loads the shared UI
      backend/            JavaScript port of the server, data kept in IndexedDB
        routes.js         The same /api/... endpoints as app/routes/
        models.js         Data model and JSON (app/models.py)
        stats.js          Totals, streaks, insights (app/stats.py)
        timers.js         Stopwatch, countdown, Pomodoro (app/timers.py)
        storage.js        Saving on the device
        sqlite.js         Reads/writes desktop-compatible tasks.db backups
        dates.js          Date helpers
      sw.js               Offline support (file list filled in by build.py)
      manifest.webmanifest  App name, icon, colors for the home screen
      mobile.css          Notch/home-bar spacing and other phone tweaks
      icons/              Home-screen icons
      vendor/sql.js/      SQLite for the browser (MIT license), used for backups
    dist/                 Built phone app (created by build.py, gitignored)
  .github/workflows/
    publish-phone-app.yml Builds mobile/ and publishes it to GitHub Pages
  CLAUDE.md               Notes for AI coding agents working on this code
  run.py                  Plain dev entry point (`python run.py`)
  requirements.txt
  instance/tasks.db       Local dev database (created automatically, gitignored)
  dist/                   Built app (created by the build scripts, gitignored)
```
