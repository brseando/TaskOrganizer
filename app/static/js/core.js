// Shared state, API access, formatting helpers, and small HTML builders.
//
// The whole app renders from one snapshot (GET /api/state), refreshed after
// every change and on a timer. Views read `store.state` and re-render from it.

export const store = {
  state: null,
  // { start, end } (YYYY-MM-DD) to view a custom period instead of the
  // configured one; affects the planned/estimated/actual totals.
  periodOverride: null,
  clockOffsetMs: 0,
};

const listeners = new Set();

export function onStateChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export class ApiError extends Error {}

// The phone version (mobile/) has no server. Its boot script installs this
// function, which answers the same /api/... requests from data kept on the
// device, so every view works unchanged.
function localApi() {
  return globalThis.taskOrganizerLocalApi || null;
}

/** True in the iPhone/Android version. */
export function isMobileApp() {
  return store.state?.app?.platform === "mobile";
}

export async function api(method, url, body) {
  if (localApi()) {
    const { status, data } = await localApi()(method, url, body);
    if (status >= 400 || (data && data.ok === false)) {
      throw new ApiError((data && data.error) || `Something went wrong (error ${status}).`);
    }
    return data;
  }
  const options = { method, headers: { Accept: "application/json" } };
  if (body instanceof FormData) {
    options.body = body;
  } else if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw new ApiError("Couldn't reach Task Organizer. Is the app still running?");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok || (data && data.ok === false)) {
    throw new ApiError((data && data.error) || `Something went wrong (HTTP ${res.status}).`);
  }
  return data;
}

/** Download a file from the API: { blob, filename }. */
export async function fetchFile(url) {
  if (localApi()) {
    const { status, data, file } = await localApi()("GET", url);
    if (!file) throw new ApiError((data && data.error) || `Something went wrong (error ${status}).`);
    return file;
  }
  const res = await fetch(url);
  if (!res.ok) throw new ApiError("Couldn't download the file.");
  const match = /filename="?([^";]+)"?/i.exec(res.headers.get("Content-Disposition") || "");
  return { blob: await res.blob(), filename: match ? match[1] : "download" };
}

let refreshInFlight = null;

export async function refresh({ fromPoll = false } = {}) {
  if (refreshInFlight) return refreshInFlight;
  const params = store.periodOverride
    ? `?start=${encodeURIComponent(store.periodOverride.start)}&end=${encodeURIComponent(store.periodOverride.end)}`
    : "";
  refreshInFlight = (async () => {
    try {
      const data = await api("GET", `/api/state${params}`);
      store.clockOffsetMs = new Date(data.server_time).getTime() - Date.now();
      store.state = data;
      listeners.forEach((fn) => fn({ fromPoll }));
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

// Run a mutation, then refresh. Errors are shown as a toast.
export async function mutate(method, url, body, successMessage) {
  try {
    const result = await api(method, url, body);
    await refresh();
    if (successMessage) toast(successMessage, "success");
    return result;
  } catch (err) {
    toast(err.message, "error");
    return null;
  }
}

/** Server-aligned "now" in ms, so timers agree even if this device's clock drifts. */
export function serverNow() {
  return Date.now() + store.clockOffsetMs;
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function getCategory(id) {
  return store.state?.categories.find((c) => c.id === Number(id)) || null;
}

export function getTask(id) {
  return store.state?.tasks.find((t) => t.id === Number(id)) || null;
}

export function openTasks() {
  return (store.state?.tasks || []).filter((t) => t.status !== "done");
}

export function sortByDue(a, b) {
  if (!a.due_date && !b.due_date) return a.title.localeCompare(b.title);
  if (!a.due_date) return 1;
  if (!b.due_date) return -1;
  return a.due_date.localeCompare(b.due_date);
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
export function sortByPriority(a, b) {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || sortByDue(a, b);
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export function toYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function toLocalInput(date) {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${toYmd(date)}T${hh}:${mm}`;
}

export function parseYmd(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function fmtTime(dateOrIso) {
  const date = typeof dateOrIso === "string" ? new Date(dateOrIso) : dateOrIso;
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function fmtShortDate(dateOrIso) {
  const date = typeof dateOrIso === "string" ? new Date(dateOrIso) : dateOrIso;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function fmtDateTime(iso) {
  const date = new Date(iso);
  return `${date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}, ${fmtTime(date)}`;
}

/** "Today 3:00 PM", "Tomorrow 11:59 PM", "Fri 9:00 AM", "Oct 30". */
export function fmtDue(iso) {
  const date = new Date(iso);
  const today = startOfDay(new Date());
  const diffDays = Math.round((startOfDay(date) - today) / 86400000);
  const isEndOfDay = date.getHours() === 23 && date.getMinutes() === 59;
  const time = isEndOfDay ? "" : ` ${fmtTime(date)}`;
  if (diffDays === 0) return `Today${time}`;
  if (diffDays === 1) return `Tomorrow${time}`;
  if (diffDays === -1) return `Yesterday${time}`;
  if (diffDays > 1 && diffDays < 7) return `${date.toLocaleDateString([], { weekday: "short" })}${time}`;
  const sameYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleDateString([], { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }) + time;
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

/** 5400 -> "1h 30m", 300 -> "5m", 0 -> "0m". */
export function fmtDuration(seconds) {
  const total = Math.max(0, Math.round((seconds || 0) / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function fmtMinutes(minutes) {
  return fmtDuration((minutes || 0) * 60);
}

/** Stopwatch-style: "1:05:09" or "05:09". */
export function fmtClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function secondsSince(iso) {
  return Math.max(0, (serverNow() - new Date(iso).getTime()) / 1000);
}

export function secondsUntil(iso) {
  return Math.max(0, (new Date(iso).getTime() - serverNow()) / 1000);
}

/** Signed difference as "+25m" / "-1h 5m". */
export function fmtDelta(seconds) {
  if (Math.abs(seconds) < 60) return "same";
  return `${seconds > 0 ? "+" : "\u2212"}${fmtDuration(Math.abs(seconds))}`;
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const ICONS = {
  play: '<svg viewBox="0 0 12 12"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor"/></svg>',
  stop: '<svg viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor"/></svg>',
  check: '<svg viewBox="0 0 12 12"><path d="M2.5 6.5l2.5 2.5 4.5-5.5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  search: '<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M11 11l3.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

export function playButton(task) {
  if (task.status === "done") return "";
  return task.timer_running
    ? `<button type="button" class="play-btn running" data-action="stop-timer" data-task-id="${task.id}" title="Stop timer">${ICONS.stop}</button>`
    : `<button type="button" class="play-btn" data-action="start-timer" data-task-id="${task.id}" title="Start timer">${ICONS.play}</button>`;
}

/** One task line, used by Today, Tasks, and anywhere else tasks are listed. */
export function taskRow(task, { showCategory = true, showDescription = false } = {}) {
  const done = task.status === "done";
  const classes = ["task-row"];
  if (done) classes.push("done");
  if (task.timer_running) classes.push("running");

  const bits = [];
  if (task.due_date && !done) {
    const cls = task.is_overdue ? "overdue" : task.is_due_soon ? "soon" : "";
    bits.push(`<span class="${cls}">${task.is_overdue ? "Overdue \u00b7 " : ""}${esc(fmtDue(task.due_date))}</span>`);
  }
  if (showCategory) {
    bits.push(`<span class="task-cat"><span class="dot" style="background:${esc(task.category_color)}"></span>${esc(task.category_name)}</span>`);
  }
  if (done) {
    bits.push(historyDelta(task));
    if (task.completed_at) bits.push(`<span>Done ${esc(fmtShortDate(task.completed_at))}</span>`);
  } else {
    if (task.estimated_minutes) bits.push(`<span>Est ${fmtMinutes(task.estimated_minutes)}</span>`);
    if (task.total_tracked_seconds > 0 || task.timer_running) {
      bits.push(
        task.timer_running
          ? `<span class="positive">Tracking <span class="mono" data-elapsed-since="${esc(task.timer_start_time)}" data-elapsed-base="${task.total_tracked_seconds - secondsSince(task.timer_start_time)}"></span></span>`
          : `<span>Tracked ${fmtDuration(task.total_tracked_seconds)}</span>`
      );
    }
    if (task.is_recurring) bits.push(`<span>Repeats every ${task.recurrence_interval_days}d</span>`);
  }
  if (showDescription && task.description) bits.push(`<span class="task-desc">${esc(task.description)}</span>`);

  const right = done
    ? `<button type="button" class="btn sm" data-action="reopen-task" data-task-id="${task.id}">Reopen</button>`
    : playButton(task);

  return `
    <li class="${classes.join(" ")}" data-action="open-task" data-task-id="${task.id}">
      <button type="button" class="task-check${done ? " done" : ""}" data-action="${done ? "reopen-task" : "complete-task"}" data-task-id="${task.id}" title="${done ? "Mark as not done" : "Mark done"}">${ICONS.check}</button>
      <div class="task-main">
        <div class="task-title-line">
          <span class="priority-flag priority-${esc(task.priority)}" title="${esc(task.priority)} priority"></span>
          <span class="task-title">${esc(task.title)}</span>
        </div>
        <div class="task-sub">${bits.join("")}</div>
      </div>
      <div class="task-right">${right}</div>
    </li>`;
}

export function historyDelta(task) {
  const actual = fmtMinutes(task.actual_minutes);
  if (task.estimated_minutes == null) return `<span>Actual ${actual} \u00b7 no estimate</span>`;
  const delta = task.delta_minutes || 0;
  let cls = "on";
  let text = "on target";
  if (delta > 0) {
    cls = "over";
    text = `${fmtMinutes(delta)} over`;
  } else if (delta < 0) {
    cls = "under";
    text = `${fmtMinutes(-delta)} under`;
  }
  return `<span>Est ${fmtMinutes(task.estimated_minutes)} \u00b7 Actual ${actual} \u00b7 <span class="history-delta ${cls}">${text}</span></span>`;
}

export function categoryOptions(selectedId, { includeEmpty = false } = {}) {
  const cats = store.state?.categories || [];
  const empty = includeEmpty ? `<option value="">Choose&hellip;</option>` : "";
  return (
    empty +
    cats
      .map((c) => `<option value="${c.id}" ${Number(selectedId) === c.id ? "selected" : ""}>${esc(c.name)}</option>`)
      .join("")
  );
}

/** <option>s for every open task, grouped by category. */
export function taskOptions(selectedId, { includeDone = false } = {}) {
  const state = store.state;
  if (!state) return "";
  return state.categories
    .map((c) => {
      const tasks = state.tasks
        .filter((t) => t.category_id === c.id && (includeDone || t.status !== "done" || t.id === Number(selectedId)))
        .sort(sortByDue);
      if (!tasks.length) return "";
      const opts = tasks
        .map((t) => `<option value="${t.id}" ${Number(selectedId) === t.id ? "selected" : ""}>${esc(t.title)}</option>`)
        .join("");
      return `<optgroup label="${esc(c.name)}">${opts}</optgroup>`;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

export function toast(message, type = "") {
  const root = document.getElementById("toast-root");
  if (!root) return;
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), type === "error" ? 6000 : 3000);
}
