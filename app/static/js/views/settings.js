// Settings: time period, goals, timers, appearance, network access, sync,
// backups, and keyboard shortcuts.

import { api, esc, fetchFile, isMobileApp, mutate, store, toast } from "../core.js";
import { requestNotificationPermission } from "../alerts.js";
import { confirmDialog, registerActions, registerForms, requestRender, saveFile } from "../ui.js";
import { applyTheme } from "../theme.js";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function weekdaySelect(name, value) {
  return `<select name="${name}">${WEEKDAYS.map((d, i) => `<option value="${i}" ${i === value ? "selected" : ""}>${d}</option>`).join("")}</select>`;
}

function numberRow(label, hint, name, value, { min, max, step = 1, suffix = "min" }) {
  return `
    <div class="setting-row">
      <div class="setting-text"><span>${label}</span>${hint ? `<small>${hint}</small>` : ""}</div>
      <label class="row" style="flex-wrap:nowrap"><input type="number" name="${name}" value="${value}" min="${min}" max="${max}" step="${step}"> <span class="muted small" style="min-width:1.8rem">${suffix}</span></label>
    </div>`;
}

function toggleRow(label, hint, name, checked) {
  return `
    <div class="setting-row">
      <div class="setting-text"><span>${label}</span>${hint ? `<small>${hint}</small>` : ""}</div>
      <label class="checkbox"><input type="checkbox" name="${name}" ${checked ? "checked" : ""}></label>
    </div>`;
}

function networkCard(state) {
  if (isMobileApp()) return "";
  const s = state.settings;
  const n = state.network;
  const pending = n.lan_active !== null && n.lan_active !== s.lan_access_enabled;
  const address = n.ip ? `http://${n.ip}:${n.port}` : null;
  return `
    <section class="card settings-card">
      <h2>Access from other devices</h2>
      <p class="muted">Lets a phone or tablet on the same WiFi open Task Organizer. There's no login, so anyone on that network could see and change your tasks. Leave it off on school or public WiFi.</p>
      <form data-form="settings-save" data-autosave>
        ${toggleRow("Allow access from other devices", "Takes effect the next time the app starts.", "lan_access_enabled", s.lan_access_enabled)}
      </form>
      ${pending ? `<div class="notice" style="margin-top:0.6rem">Restart Task Organizer (tray icon &rarr; Quit, then open it again) to ${s.lan_access_enabled ? "turn this on" : "turn this off"}.</div>` : ""}
      ${
        n.lan_active && address
          ? `<div class="notice info" style="margin-top:0.6rem">Open <strong>${esc(address)}</strong> on your phone's browser. If it can't connect, allow the app through the firewall (including "Public networks").</div>`
          : ""
      }
    </section>`;
}

function syncCard(state) {
  if (!state.settings.sync_enabled) return "";
  const mobile = isMobileApp();
  const where = mobile ? "(Files, iCloud Drive, Google Drive, or email it to yourself)" : "(a cloud folder, USB stick)";
  return `
    <section class="card settings-card">
      <h2>Sync database</h2>
      <p class="muted"><strong>Push</strong> saves a copy of this ${mobile ? "phone" : "computer"}'s data wherever you choose ${where}. <strong>Pull</strong> loads a copy back in and replaces everything here. Copies from the computer and phone versions work in either one. A safety copy of the current data is kept automatically.</p>
      <div class="row">
        <button type="button" class="btn primary" data-action="sync-push">&#8593; Push (save a copy)</button>
        <button type="button" class="btn" data-action="sync-pull">&#8595; Pull (load a copy)</button>
        ${state.app.can_undo_load ? `<button type="button" class="btn ghost" data-action="sync-undo-load">Undo the last Pull</button>` : ""}
        <input type="file" id="pull-input" ${mobile ? "" : 'accept=".db"'} hidden>
      </div>
    </section>`;
}

function dataCard(state) {
  const s = state.settings;
  const mobile = isMobileApp();
  return `
    <section class="card settings-card">
      <h2>Your data</h2>
      ${
        mobile
          ? `<p class="muted">Everything is stored inside this app, on this phone only. Removing the app from your home screen or clearing your browser's website data deletes it, so download a backup now and then.</p>`
          : `<p class="muted">Everything is stored in one file on this computer:</p>
            <div class="path-box">${esc(state.app.db_path)}</div>`
      }
      <div class="row" style="margin-top:0.8rem">
        <a class="btn" href="/api/backup/database">Download a backup</a>
        <a class="btn" href="/api/export/time-logs.csv" download>Export time logs (CSV)</a>
        ${state.app.is_frozen ? "" : `<a class="btn ghost" href="/api/backup/server">Download app code (.zip)</a>`}
      </div>
      <form data-form="settings-save" data-autosave style="margin-top:0.6rem">
        ${toggleRow("Show database sync (Push / Pull)", `For moving your data between ${mobile ? "devices, like from your computer to this phone" : "computers"}. Pull replaces everything, so it's hidden unless you need it.`, "sync_enabled", s.sync_enabled)}
      </form>
    </section>`;
}

function shortcutsCard() {
  if (isMobileApp()) return "";
  return `
    <section class="card settings-card">
      <h2>Keyboard shortcuts</h2>
      <div class="shortcut-list">
        <kbd>N</kbd><span>New task</span>
        <kbd>/</kbd><span>Search tasks</span>
        <kbd>T</kbd><span>Stop the running timer, or open Focus</span>
        <kbd>1</kbd><span>&ndash; <kbd>6</kbd> Switch views</span>
        <kbd>Esc</kbd><span>Close the open panel or dialog</span>
        <kbd>?</kbd><span>Show these shortcuts</span>
      </div>
    </section>`;
}

export const settingsView = {
  title: "Settings",

  render() {
    const state = store.state;
    const s = state.settings;
    const notif = "Notification" in window ? Notification.permission : "unsupported";

    return `
      <div class="page-header"><div><h1>Settings</h1><p class="muted">Changes save automatically.</p></div></div>
      <div class="settings-layout">
        <div class="stack">
          <section class="card settings-card">
            <h2>Time period</h2>
            <p class="muted">Which days count as "this period" for the planned, estimated, and actual totals. For example Monday&ndash;Friday for a school week.</p>
            <form data-form="settings-save" data-autosave>
              <div class="setting-row"><div class="setting-text"><span>Starts on</span></div>${weekdaySelect("period_start_weekday", s.period_start_weekday)}</div>
              <div class="setting-row"><div class="setting-text"><span>Ends on</span></div>${weekdaySelect("period_end_weekday", s.period_end_weekday)}</div>
            </form>
          </section>

          <section class="card settings-card">
            <h2>Goals &amp; timers</h2>
            <p class="muted">Your daily goal drives the progress ring and streaks.</p>
            <form data-form="settings-save" data-autosave>
              ${numberRow("Daily goal", "Set to 0 to turn goals off.", "daily_goal_minutes", s.daily_goal_minutes, { min: 0, max: 1440, step: 15 })}
              ${numberRow("Forgotten-timer warning", "Ask whether you're still working after a timer runs this long.", "long_timer_warning_minutes", s.long_timer_warning_minutes, { min: 10, max: 1440, step: 10 })}
              ${numberRow("Pomodoro focus length", "", "pomodoro_work_minutes", s.pomodoro_work_minutes, { min: 1, max: 240 })}
              ${numberRow("Short break", "", "pomodoro_short_break_minutes", s.pomodoro_short_break_minutes, { min: 1, max: 120 })}
              ${numberRow("Long break", "", "pomodoro_long_break_minutes", s.pomodoro_long_break_minutes, { min: 1, max: 240 })}
              ${numberRow("Sessions before a long break", "", "pomodoro_cycles", s.pomodoro_cycles, { min: 1, max: 12, suffix: "" })}
              ${toggleRow("Chime when a timer ends", "", "sound_enabled", s.sound_enabled)}
            </form>
            <div class="setting-row" style="border-top:1px solid var(--border)">
              <div class="setting-text"><span>${isMobileApp() ? "Notifications" : "Desktop notifications"}</span><small>${
                { granted: "On", denied: "Blocked in your browser's site settings", default: "Not allowed yet", unsupported: "Not available in this browser" }[notif]
              }</small></div>
              ${notif === "default" ? `<button type="button" class="btn sm" data-action="settings-notifications">Allow</button>` : ""}
            </div>
          </section>

          <section class="card settings-card">
            <h2>Appearance</h2>
            <div class="setting-row">
              <div class="setting-text"><span>Theme</span></div>
              <div class="segmented">
                ${["system", "light", "dark"]
                  .map((t) => `<button type="button" data-action="settings-theme" data-theme-choice="${t}" class="${s.theme === t ? "active" : ""}">${t[0].toUpperCase() + t.slice(1)}</button>`)
                  .join("")}
              </div>
            </div>
          </section>
        </div>

        <div class="stack">
          ${networkCard(state)}
          ${syncCard(state)}
          ${dataCard(state)}
          ${shortcutsCard()}
        </div>
      </div>`;
  },

  mount(root) {
    // Autosave: number inputs on change (not every keystroke), everything else immediately.
    root.querySelectorAll("form[data-autosave]").forEach((form) => {
      form.addEventListener("change", () => form.requestSubmit());
    });
    const pullInput = root.querySelector("#pull-input");
    if (pullInput) {
      pullInput.addEventListener("change", () => {
        const file = pullInput.files && pullInput.files[0];
        pullInput.value = "";
        uploadPulledFile(file);
      });
    }
  },
};

registerForms({
  "settings-save": async (form, values) => {
    await mutate("PATCH", "/api/settings", values, "Settings saved");
  },
});

// ---------------------------------------------------------------------------
// Sync: Push (save a copy) / Pull (replace with a copy). Uses native file
// dialogs where the browser supports them, with download/upload fallbacks.
// ---------------------------------------------------------------------------

async function pushDatabase() {
  try {
    const { blob, filename } = await fetchFile("/api/backup/database");
    const saved = await saveFile(blob, filename, {
      pickerTypes: [{ description: "Task Organizer database", accept: { "application/x-sqlite3": [".db"] } }],
    });
    if (saved) toast(`Saved "${filename}".`, "success");
  } catch (err) {
    toast(err.message || "Push failed.", "error");
  }
}

async function uploadPulledFile(file) {
  if (!file) return;
  const ok = await confirmDialog(
    "This replaces ALL current classes, tasks, and time logs with the selected file. A safety copy of the current data is kept. Continue?",
    { confirmText: "Replace my data", title: "Load this database?" }
  );
  if (!ok) return;
  const formData = new FormData();
  formData.append("db_file", file);
  try {
    await api("POST", "/api/database/pull", formData);
    toast("Database loaded. Reloading\u2026", "success");
    setTimeout(() => window.location.reload(), 600);
  } catch (err) {
    toast(err.message, "error");
  }
}

async function pullDatabase() {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: "Task Organizer database", accept: { "application/x-sqlite3": [".db"] } }],
        multiple: false,
      });
      await uploadPulledFile(await handle.getFile());
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
  }
  document.getElementById("pull-input")?.click();
}

registerActions({
  "settings-theme": async (el) => {
    const theme = el.dataset.themeChoice;
    applyTheme(theme);
    await mutate("PATCH", "/api/settings", { theme });
  },
  "settings-notifications": async () => {
    await requestNotificationPermission();
    requestRender();
  },
  "sync-push": () => pushDatabase(),
  "sync-pull": () => pullDatabase(),
  "sync-undo-load": async () => {
    const ok = await confirmDialog("Go back to the data you had before the last Pull? What's here now is kept as the safety copy.", {
      confirmText: "Go back",
      title: "Undo the last Pull?",
    });
    if (!ok) return;
    try {
      await api("POST", "/api/database/undo-load");
      toast("Restored. Reloading\u2026", "success");
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      toast(err.message, "error");
    }
  },
});
