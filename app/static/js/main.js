// App bootstrap: routing, sidebar, polling, the once-a-second ticker (live
// timers, tab title, focus-finished alerts), the forgotten-timer banner,
// shared actions, and keyboard shortcuts.

import { installAudioUnlock, notify, playChime } from "./alerts.js";
import {
  ICONS,
  api,
  esc,
  fmtClock,
  fmtDuration,
  getCategory,
  getTask,
  mutate,
  onStateChange,
  refresh,
  secondsSince,
  secondsUntil,
  store,
  toLocalInput,
  toast,
} from "./core.js";
import {
  closeDrawer,
  deleteCategory,
  deleteTask,
  isDrawerOpen,
  openCategoryForm,
  openTaskDrawer,
  openTaskForm,
  refreshDrawer,
} from "./drawer.js";
import { applyTheme } from "./theme.js";
import {
  closeTopModal,
  installDelegation,
  isModalOpen,
  openModal,
  registerActions,
  registerForms,
  setRenderHook,
} from "./ui.js";
import { calendarView } from "./views/calendar.js";
import { focusView } from "./views/focus.js";
import { insightsView } from "./views/insights.js";
import { settingsView } from "./views/settings.js";
import { tasksView } from "./views/tasks.js";
import { todayView } from "./views/today.js";

const VIEWS = {
  today: todayView,
  tasks: tasksView,
  calendar: calendarView,
  focus: focusView,
  insights: insightsView,
  settings: settingsView,
};
const VIEW_ORDER = ["today", "tasks", "calendar", "focus", "insights", "settings"];
const POLL_MS = 30000;
const PHASE_LABELS = { work: "Focus", short_break: "Short break", long_break: "Long break" };

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

function currentRoute() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = hash.split("?");
  const name = VIEWS[path] ? path : "today";
  return { name, params: new URLSearchParams(query) };
}

function isEditingInView() {
  const el = document.activeElement;
  if (!el || !el.closest("#view")) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

function renderView() {
  if (!store.state) return;
  const { name, params } = currentRoute();
  const view = VIEWS[name];
  const root = document.getElementById("view");
  const scrollY = window.scrollY;
  const sameView = root.dataset.view === name;
  root.innerHTML = view.render(params);
  root.dataset.view = name;
  if (view.mount) view.mount(root, params);
  if (sameView) window.scrollTo(0, scrollY);
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === name));
  tick();
}

function renderAll({ fromPoll = false } = {}) {
  const state = store.state;
  if (!state) return;
  applyTheme(state.settings.theme);
  renderSidebar();
  renderBanner(true);
  refreshDrawer({ fromPoll });

  const view = VIEWS[currentRoute().name];
  if (view.onStateChange) view.onStateChange({ fromPoll });
  const busy = isEditingInView() || (view.isBusy && view.isBusy());
  if (fromPoll && busy) return;
  renderView();
}

setRenderHook(renderView);

window.addEventListener("hashchange", () => {
  document.body.classList.remove("sidebar-open");
  window.scrollTo(0, 0);
  renderView();
  renderSidebar();
});

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function renderSidebar() {
  const state = store.state;
  const { name, params } = currentRoute();
  const activeCat = name === "tasks" ? Number(params.get("cat")) : null;

  document.getElementById("sidebar-categories").innerHTML = state.categories.length
    ? state.categories
        .map(
          (c) => `
        <li><a href="#/tasks?cat=${c.id}" class="${activeCat === c.id ? "active" : ""}">
          <span class="dot" style="background:${esc(c.color)}"></span>
          <span class="cat-name">${esc(c.name)}</span>
          <span class="count">${c.open_count || ""}</span>
        </a></li>`
        )
        .join("")
    : `<li class="empty">None yet</li>`;

  const timer = state.active_timer;
  const focus = state.focus;
  let chip = "";
  if (focus.status === "running" || focus.status === "paused") {
    const label = focus.mode === "pomodoro" ? PHASE_LABELS[focus.phase] : "Countdown";
    chip = `
      <a class="timer-chip" href="#/focus" style="--chip-color:${focus.phase === "work" ? "var(--accent)" : "var(--success)"};text-decoration:none;color:inherit">
        <div class="timer-chip-body">
          <div class="timer-chip-label">${esc(label)}${focus.status === "paused" ? " \u00b7 paused" : ""}</div>
          <div class="timer-chip-title">${esc(focus.task_title || "No task")}</div>
        </div>
        <span class="timer-chip-time mono" ${focus.status === "running" ? `data-countdown-until="${esc(focus.ends_at)}"` : ""}>${fmtClock(focus.remaining_seconds)}</span>
      </a>`;
  } else if (timer) {
    chip = `
      <div class="timer-chip" data-action="open-task" data-task-id="${timer.task_id}" style="--chip-color:${esc(timer.category_color)}">
        <div class="timer-chip-body">
          <div class="timer-chip-label">Tracking</div>
          <div class="timer-chip-title">${esc(timer.task_title)}</div>
          <div class="timer-chip-time mono" data-elapsed-since="${esc(timer.start_time)}"></div>
        </div>
        <button type="button" class="play-btn running" data-action="stop-timer" data-task-id="${timer.task_id}" title="Stop timer (T)">${ICONS.stop}</button>
      </div>`;
  } else if (focus.status === "finished") {
    chip = `<a class="timer-chip" href="#/focus" style="text-decoration:none;color:inherit"><div class="timer-chip-body"><div class="timer-chip-label">Focus</div><div class="timer-chip-title">Time's up</div></div></a>`;
  }
  document.getElementById("sidebar-timer").innerHTML = chip;

  const n = state.network;
  document.getElementById("sidebar-network").innerHTML =
    n.lan_active && n.ip ? `<span title="Other devices on this WiFi can open this address">${esc(n.hostname)} \u00b7 ${esc(n.ip)}:${n.port}</span>` : "";
}

// ---------------------------------------------------------------------------
// Forgotten-timer banner
// ---------------------------------------------------------------------------

let bannerKey = "";

function snoozeKey(logId) {
  return `taskorganizer.timerSnooze.${logId}`;
}

function bannerShouldShow() {
  const state = store.state;
  const timer = state?.active_timer;
  if (!timer) return null;
  const elapsed = secondsSince(timer.start_time);
  const threshold = state.settings.long_timer_warning_minutes * 60;
  const snoozedUntil = Number(localStorage.getItem(snoozeKey(timer.log_id))) || 0;
  return elapsed >= Math.max(threshold, snoozedUntil) ? timer : null;
}

function renderBanner(force = false) {
  const timer = bannerShouldShow();
  const key = timer ? String(timer.log_id) : "";
  if (!force && key === bannerKey) return;
  bannerKey = key;
  const area = document.getElementById("banner-area");
  if (!timer) {
    area.innerHTML = "";
    return;
  }
  // Don't wipe the time the user is picking.
  if (!force || !area.contains(document.activeElement)) {
    const start = new Date(timer.start_time);
    const suggested = new Date(Math.min(Date.now(), start.getTime() + 60 * 60000));
    area.innerHTML = `
      <div class="banner">
        <div class="banner-text">
          <strong>Still working on "${esc(timer.task_title)}"?</strong>
          <span class="muted">The timer has been running for <span data-elapsed-since="${esc(timer.start_time)}" data-format="duration"></span>.</span>
        </div>
        <button type="button" class="btn sm" data-action="banner-keep" data-log-id="${timer.log_id}">Yes, keep going</button>
        <button type="button" class="btn sm danger" data-action="stop-any-timer">Stop now</button>
        <form class="row" data-form="banner-trim" style="flex-wrap:nowrap">
          <span class="small muted nowrap">I stopped at</span>
          <input type="datetime-local" name="end_time" value="${toLocalInput(suggested)}" min="${toLocalInput(start)}" max="${toLocalInput(new Date())}" required>
          <button type="submit" class="btn sm">Save</button>
        </form>
      </div>`;
  }
}

// ---------------------------------------------------------------------------
// Ticker
// ---------------------------------------------------------------------------

let alertedFor = null;

function updateTitle() {
  const state = store.state;
  if (!state) return;
  const focus = state.focus;
  const timer = state.active_timer;
  let title = "Task Organizer";
  if (focus.status === "running" && focus.ends_at) {
    const label = focus.mode === "pomodoro" ? PHASE_LABELS[focus.phase] : "Focus";
    title = `${fmtClock(secondsUntil(focus.ends_at))} \u00b7 ${label} \u2013 Task Organizer`;
  } else if (focus.status === "finished") {
    title = "Time's up! \u2013 Task Organizer";
  } else if (timer) {
    title = `${fmtClock(secondsSince(timer.start_time))} \u00b7 ${timer.task_title}`;
  }
  if (document.title !== title) document.title = title;

  const mobile = document.getElementById("mobile-timer");
  if (mobile) {
    mobile.textContent =
      focus.status === "running" && focus.ends_at
        ? fmtClock(secondsUntil(focus.ends_at))
        : timer
          ? fmtClock(secondsSince(timer.start_time))
          : "";
  }
}

function checkFocusFinished() {
  const focus = store.state?.focus;
  if (!focus || focus.status !== "running" || !focus.ends_at) return;
  if (secondsUntil(focus.ends_at) > 0 || alertedFor === focus.ends_at) return;
  alertedFor = focus.ends_at;
  const isBreak = focus.phase !== "work";
  const title = isBreak ? "Break's over" : "Time's up!";
  const body = isBreak
    ? "Ready for the next focus session?"
    : focus.task_title
      ? `Focus session on "${focus.task_title}" finished.`
      : "Your countdown finished.";
  if (store.state.settings.sound_enabled) playChime();
  notify(title, body);
  toast(`${title} ${body}`, "success");
  refresh();
}

function tick() {
  document.querySelectorAll("[data-elapsed-since]").forEach((el) => {
    const seconds = (Number(el.dataset.elapsedBase) || 0) + secondsSince(el.dataset.elapsedSince);
    el.textContent = el.dataset.format === "duration" ? fmtDuration(seconds) : fmtClock(seconds);
  });
  document.querySelectorAll("[data-countdown-until]").forEach((el) => {
    el.textContent = fmtClock(Math.ceil(secondsUntil(el.dataset.countdownUntil)));
  });
  document.querySelectorAll("[data-ring-until]").forEach((el) => {
    const duration = Number(el.dataset.ringDuration) || 1;
    const c = Number(el.dataset.ringC);
    const fraction = 1 - secondsUntil(el.dataset.ringUntil) / duration;
    el.setAttribute("stroke-dashoffset", String(c * (1 - Math.max(0, Math.min(1, fraction)))));
  });
  const clock = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  document.querySelectorAll("[data-clock]").forEach((el) => {
    if (el.textContent !== clock) el.textContent = clock;
  });
  updateTitle();
  checkFocusFinished();
  renderBanner();
}

document.addEventListener("tick-now", tick);

// ---------------------------------------------------------------------------
// Shared actions
// ---------------------------------------------------------------------------

registerActions({
  "toggle-sidebar": () => document.body.classList.toggle("sidebar-open"),
  "open-task": (el) => openTaskDrawer(el.dataset.taskId),
  "new-task": (el) => openTaskForm({ categoryId: el.dataset.categoryId ? Number(el.dataset.categoryId) : null, dueDate: el.dataset.due || null }),
  "edit-task": (el) => {
    const task = getTask(el.dataset.taskId);
    if (task) openTaskForm({ task });
  },
  "delete-task": async (el) => {
    const task = getTask(el.dataset.taskId);
    if (task && (await deleteTask(task))) closeDrawer();
  },
  "start-timer": (el) => mutate("POST", `/api/tasks/${el.dataset.taskId}/timer/start`),
  "start-category-timer": (el) => mutate("POST", `/api/categories/${el.dataset.categoryId}/timer/start`),
  "stop-timer": (el) => mutate("POST", `/api/tasks/${el.dataset.taskId}/timer/stop`),
  "stop-any-timer": () => mutate("POST", "/api/timer/stop", undefined, "Timer stopped"),
  "complete-task": async (el) => {
    const task = getTask(el.dataset.taskId);
    const result = await mutate("POST", `/api/tasks/${el.dataset.taskId}/complete`);
    if (result && task) {
      toast(result.next_task ? `Done! Next "${task.title}" scheduled.` : `Marked "${task.title}" done.`, "success", {
        action: { label: "Undo", onClick: () => undoComplete(task, result.next_task) },
      });
    }
  },
  "reopen-task": (el) => mutate("POST", `/api/tasks/${el.dataset.taskId}/reopen`, undefined, "Task reopened"),
  "new-category": () => openCategoryForm(),
  "edit-category": (el) => {
    const cat = getCategory(el.dataset.categoryId);
    if (cat) openCategoryForm(cat);
  },
  "delete-category": async (el) => {
    const cat = getCategory(el.dataset.categoryId);
    if (cat) await deleteCategory(cat);
  },
  "banner-keep": (el) => {
    const timer = store.state.active_timer;
    if (!timer) return;
    const elapsed = secondsSince(timer.start_time);
    const threshold = store.state.settings.long_timer_warning_minutes * 60;
    localStorage.setItem(snoozeKey(el.dataset.logId), String(Math.round(elapsed + threshold)));
    renderBanner(true);
  },
  "show-shortcuts": () => showShortcuts(),
});

/** Reopen a task that was just completed, removing the repeat it scheduled. */
async function undoComplete(task, nextTask) {
  try {
    if (nextTask) await api("DELETE", `/api/tasks/${nextTask.id}`);
    await api("POST", `/api/tasks/${task.id}/reopen`);
    toast(`Reopened "${task.title}".`, "success");
  } catch (err) {
    toast(err.message, "error");
  }
  await refresh();
}

registerForms({
  "banner-trim": async (form, values) => {
    await mutate("POST", "/api/timer/trim", values, "Timer stopped at the time you picked");
  },
});

function showShortcuts() {
  openModal({
    title: "Keyboard shortcuts",
    size: "narrow",
    body: `
      <div class="shortcut-list">
        <kbd>N</kbd><span>New task</span>
        <kbd>/</kbd><span>Search tasks</span>
        <kbd>T</kbd><span>Stop the running timer, or open Focus</span>
        <kbd>1</kbd><span>Today</span>
        <kbd>2</kbd><span>Tasks</span>
        <kbd>3</kbd><span>Calendar</span>
        <kbd>4</kbd><span>Focus</span>
        <kbd>5</kbd><span>Insights</span>
        <kbd>6</kbd><span>Settings</span>
        <kbd>Esc</kbd><span>Close the open panel or dialog</span>
      </div>`,
  });
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (closeTopModal()) return;
    if (isDrawerOpen()) {
      closeDrawer();
      return;
    }
    document.body.classList.remove("sidebar-open");
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    return;
  }

  const target = event.target;
  const typing = target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
  if (typing || event.ctrlKey || event.metaKey || event.altKey || isModalOpen() || !store.state) return;

  const key = event.key.toLowerCase();
  if (key === "n") {
    event.preventDefault();
    const { name, params } = currentRoute();
    openTaskForm({ categoryId: name === "tasks" ? Number(params.get("cat")) || null : null });
  } else if (key === "/") {
    event.preventDefault();
    closeDrawer();
    if (currentRoute().name !== "tasks") window.location.hash = "#/tasks";
    setTimeout(() => tasksView.focusSearch(), 0);
  } else if (key === "t") {
    event.preventDefault();
    if (store.state.active_timer) mutate("POST", "/api/timer/stop", undefined, "Timer stopped");
    else window.location.hash = "#/focus";
  } else if (key === "?") {
    showShortcuts();
  } else if (/^[1-6]$/.test(key)) {
    window.location.hash = `#/${VIEW_ORDER[Number(key) - 1]}`;
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

installDelegation();
installAudioUnlock();
onStateChange(renderAll);

async function poll() {
  try {
    await refresh({ fromPoll: true });
  } catch (err) {
    console.error(err);
  }
}

(async function start() {
  try {
    await refresh();
  } catch (err) {
    document.getElementById("view").innerHTML = `<div class="empty-state"><h3>Couldn't load your tasks</h3><p>${esc(err.message)}</p></div>`;
  }
  setInterval(tick, 1000);
  setInterval(poll, POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") poll();
  });
})();
