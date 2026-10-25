// The /api/... endpoints, answered on the device: a JavaScript port of
// app/routes/*.py. Each handler gets the loaded database and returns the
// same JSON the desktop server would.
//
// handle() never touches storage itself; index.js loads the database, calls
// it, and saves the result only for successful changes. That gives every
// request the desktop's all-or-nothing behavior (a failed edit is "rolled
// back" simply by not saving).

import {
  addDaysYmd,
  combineDateTime,
  dayStart,
  daysBetween,
  fileStamp,
  hhmm,
  isoLocal,
  parseLocalDateTime,
  parseYmd,
  todayYmd,
  ymdOf,
} from "./dates.js";
import {
  CATEGORY_COLOR_PALETTE,
  CATEGORY_KINDS,
  TASK_PRIORITIES,
  THEMES,
  activeLogForTask,
  categoryToDict,
  deleteCategory,
  deleteTask,
  displayTitle,
  effectiveSource,
  findById,
  focusToDict,
  generalTask,
  insert,
  logDuration,
  serializeLog,
  serializeTask,
  settingsToDict,
  sortedCategories,
  spawnNextOccurrence,
  taskTrackedSeconds,
} from "./models.js";
import { buildInsights, currentPeriodBounds, dailyTotals, periodTotals, resolvePeriod, todaySummary } from "./stats.js";
import * as timers from "./timers.js";

const MAX_RANGE_DAYS = 366;

// ---------------------------------------------------------------------------
// Helpers (app/routes/common.py)
// ---------------------------------------------------------------------------

export class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Like Python's int(): whole numbers (or numeric strings) only. */
export function parseInt_(value, { minimum = null, maximum = null } = {}) {
  let number = null;
  if (typeof value === "number" && Number.isFinite(value)) number = Math.trunc(value);
  else if (typeof value === "boolean") number = value ? 1 : 0;
  else if (typeof value === "string" && /^\s*[+-]?\d+\s*$/.test(value)) number = Number(value.trim());
  if (number === null) return null;
  if (minimum !== null && number < minimum) return null;
  if (maximum !== null && number > maximum) return null;
  return number;
}

export function parseBool(value) {
  if (typeof value === "boolean") return value;
  return ["1", "true", "on", "yes"].includes(String(value).trim().toLowerCase());
}

const ok = (extra = {}) => ({ ok: true, ...extra });
const has = (data, key) => Object.prototype.hasOwnProperty.call(data, key);

function getOr404(db, table, id) {
  const row = findById(db, table, Number(id));
  if (!row) throw new HttpError("That item no longer exists. Try refreshing.", 404);
  return row;
}

// ---------------------------------------------------------------------------
// State snapshot (api_tasks.state)
// ---------------------------------------------------------------------------

function state(ctx) {
  const { db, now, query, info } = ctx;
  const settings = db.settings;
  const period = resolvePeriod(query.get("start"), query.get("end"), settings);
  const categories = sortedCategories(db);
  const { perCategory, totals } = periodTotals(db, period.start, period.end, categories, now);

  const todayStart = dayStart(todayYmd());
  const todayEnd = dayStart(addDaysYmd(todayYmd(), 1));
  const todayLogs = db.time_logs
    .filter((l) => l.start_time < todayEnd && (l.end_time === null || l.end_time > todayStart))
    .sort((a, b) => b.start_time - a.start_time);

  const openCounts = {};
  for (const t of db.tasks) {
    if (t.status !== "done" && !t.is_general) openCounts[t.category_id] = (openCounts[t.category_id] || 0) + 1;
  }

  return {
    server_time: isoLocal(now),
    settings: settingsToDict(settings),
    categories: categories.map((c) => ({ ...categoryToDict(c), open_count: openCounts[c.id] || 0, period: perCategory[c.id] })),
    tasks: db.tasks.map((t) => serializeTask(db, t, now)),
    period: {
      label: period.label,
      is_custom: period.isCustom,
      configured_label: settingsToDict(settings).period_label,
      start: ymdOf(period.start),
      end: addDaysYmd(ymdOf(period.end), -1),
      total_estimated_minutes: totals.estimated,
      total_planned_minutes: totals.planned,
      total_actual_minutes: totals.actual,
    },
    active_timer: timers.serializeActiveLog(db, timers.activeLog(db)),
    focus: focusToDict(db, db.focus_timer, now),
    today: todaySummary(db, settings, now),
    today_logs: todayLogs.map((l) => serializeLog(db, l, now)),
    // There's no server to reach from other devices on a phone.
    network: { hostname: "", ip: null, port: null, lan_setting: false, lan_active: null },
    color_palette: CATEGORY_COLOR_PALETTE,
    app: {
      platform: "mobile",
      db_path: "Stored in this app on this device",
      is_frozen: true,
      can_undo_load: Boolean(info.canUndoLoad),
    },
  };
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

function applyCategoryFields(category, data) {
  if (has(data, "name")) category.name = String(data.name ?? "").trim().slice(0, 80);
  if (CATEGORY_KINDS.includes(data.kind)) category.kind = data.kind;
  const color = String(data.color ?? "").trim();
  if (color.length === 7 && color.startsWith("#")) category.color = color;
}

function createCategory({ db, data, now }) {
  const category = { name: "", kind: "class", color: CATEGORY_COLOR_PALETTE[0], created_at: now };
  applyCategoryFields(category, data);
  if (!category.name) throw new HttpError("Give the class or activity a name.");
  insert(db, "categories", category);
  return ok({ category: categoryToDict(category) });
}

function editCategory({ db, data, params }) {
  const category = getOr404(db, "categories", params[0]);
  applyCategoryFields(category, data);
  if (!category.name) throw new HttpError("Give the class or activity a name.");
  return ok({ category: categoryToDict(category) });
}

function removeCategory({ db, params }) {
  deleteCategory(db, getOr404(db, "categories", params[0]).id);
  return ok();
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/** Copy any fields present in `data` onto the task; throws on invalid input. */
function applyTaskFields(db, task, data) {
  if (has(data, "category_id")) {
    const categoryId = parseInt_(data.category_id);
    if (!categoryId || !findById(db, "categories", categoryId)) throw new HttpError("Choose a class or activity.");
    task.category_id = categoryId;
  }
  if (has(data, "title")) task.title = String(data.title ?? "").trim().slice(0, 200);
  if (has(data, "description")) task.description = String(data.description ?? "").trim();
  if (has(data, "due_date")) task.due_date = combineDateTime(data.due_date, data.due_time);
  if (TASK_PRIORITIES.includes(data.priority)) task.priority = data.priority;
  if (has(data, "estimated_minutes")) task.estimated_minutes = parseInt_(data.estimated_minutes, { minimum: 0 });
  if (has(data, "is_recurring")) task.is_recurring = parseBool(data.is_recurring);
  if (has(data, "recurrence_interval_days")) task.recurrence_interval_days = parseInt_(data.recurrence_interval_days, { minimum: 1 });
  if (task.is_recurring && !task.recurrence_interval_days) throw new HttpError("Enter how many days apart the task repeats.");
  if (!task.title) throw new HttpError("Give the task a title.");
  if (!task.category_id) throw new HttpError("Choose a class or activity.");
}

function createTask({ db, data, now }) {
  const task = {
    category_id: null,
    title: "",
    description: "",
    due_date: null,
    priority: "medium",
    estimated_minutes: null,
    status: "todo",
    is_recurring: false,
    recurrence_interval_days: null,
    is_general: false,
    created_at: now,
    completed_at: null,
  };
  applyTaskFields(db, task, data);
  insert(db, "tasks", task);
  return ok({ task: serializeTask(db, task, now) });
}

function editTask({ db, data, params, now }) {
  const task = getOr404(db, "tasks", params[0]);
  if (task.is_general) throw new HttpError("General study time can't be edited like a task.");
  applyTaskFields(db, task, data);
  return ok({ task: serializeTask(db, task, now) });
}

function removeTask({ db, params }) {
  deleteTask(db, getOr404(db, "tasks", params[0]).id);
  return ok();
}

function completeTask({ db, params, now }) {
  const task = getOr404(db, "tasks", params[0]);
  if (task.is_general) throw new HttpError("General study time can't be marked done.");
  const active = activeLogForTask(db, task);
  if (active) active.end_time = now;
  task.status = "done";
  task.completed_at = now;
  const next = task.is_recurring ? spawnNextOccurrence(db, task, now) : null;
  return ok({ task: serializeTask(db, task, now), next_task: next ? serializeTask(db, next, now) : null });
}

function reopenTask({ db, params, now }) {
  const task = getOr404(db, "tasks", params[0]);
  // Back to "in progress" if time was already tracked on it.
  task.status = db.time_logs.some((l) => l.task_id === task.id) ? "in_progress" : "todo";
  task.completed_at = null;
  return ok({ task: serializeTask(db, task, now) });
}

// ---------------------------------------------------------------------------
// Stopwatch, manual entries, log editing (api_time)
// ---------------------------------------------------------------------------

function startTimer({ db, params, now }) {
  const task = getOr404(db, "tasks", params[0]);
  const log = timers.startStopwatch(db, task, now);
  return ok({ task_id: task.id, start_time: isoLocal(log.start_time) });
}

/** Track time on a class/activity as a whole (its general study task). */
function startCategoryTimer({ db, params, now }) {
  const task = generalTask(db, getOr404(db, "categories", params[0]), now);
  const log = timers.startStopwatch(db, task, now);
  return ok({ task_id: task.id, start_time: isoLocal(log.start_time) });
}

function stopTimer({ db, params, now }) {
  const task = getOr404(db, "tasks", params[0]);
  const active = activeLogForTask(db, task);
  if (active) {
    active.end_time = now;
    if (db.focus_timer.time_log_id === active.id) db.focus_timer.time_log_id = null;
  }
  return ok({ task_id: task.id, total_tracked_seconds: taskTrackedSeconds(db, task, now) });
}

function stopAnyTimer({ db, now }) {
  timers.stopAllActiveTimers(db, now);
  return ok();
}

function activeTimer({ db }) {
  const log = timers.activeLog(db);
  return log ? { active: true, ...timers.serializeActiveLog(db, log) } : { active: false };
}

function trimTimer({ db, data, now }) {
  const endTime = parseLocalDateTime(data.end_time);
  if (endTime === null) throw new HttpError("Pick the time you actually stopped.");
  const [log, error] = timers.trimActiveLog(db, endTime, now);
  if (error) throw new HttpError(error);
  return ok({ log: serializeLog(db, log, now) });
}

const logManualTime = (ctx) => addManualLog(ctx, getOr404(ctx.db, "tasks", ctx.params[0]));
const logManualCategoryTime = (ctx) => addManualLog(ctx, generalTask(ctx.db, getOr404(ctx.db, "categories", ctx.params[0]), ctx.now));

/** Add a finished session by hand. Defaults to ending "just now"; an optional date/time back-dates it. */
function addManualLog({ db, data, now }, task) {
  const minutes = parseInt_(data.minutes, { minimum: 1 });
  if (!minutes) throw new HttpError("Enter a number of minutes greater than 0.");

  let start = now - minutes * 60000;
  if (data.logged_date) {
    const combined = combineDateTime(data.logged_date, data.logged_time || "00:00");
    if (combined !== null) start = combined;
  }
  const log = insert(db, "time_logs", {
    task_id: task.id,
    start_time: start,
    end_time: start + minutes * 60000,
    is_manual: true,
    source: "manual",
    note: String(data.note ?? "").trim() || null,
  });
  return ok({ task: serializeTask(db, task, now), log: serializeLog(db, log, now) });
}

function listLogs({ db, query, now }) {
  let logs = db.time_logs;
  const taskId = parseInt_(query.get("task_id"));
  if (taskId) logs = logs.filter((l) => l.task_id === taskId);
  const start = parseYmd(query.get("start"));
  const end = parseYmd(query.get("end"));
  if (start) logs = logs.filter((l) => l.end_time === null || l.end_time > dayStart(start));
  if (end) logs = logs.filter((l) => l.start_time < dayStart(addDaysYmd(end, 1)));
  const limit = parseInt_(query.get("limit"), { minimum: 1, maximum: 5000 }) || 500;
  logs = [...logs].sort((a, b) => b.start_time - a.start_time).slice(0, limit);
  return { logs: logs.map((l) => serializeLog(db, l, now)) };
}

function editLog({ db, data, params, now }) {
  const log = getOr404(db, "time_logs", params[0]);
  if (has(data, "task_id")) {
    const taskId = parseInt_(data.task_id);
    if (!taskId || !findById(db, "tasks", taskId)) throw new HttpError("Choose a task.");
    log.task_id = taskId;
  }
  if (has(data, "start_time")) {
    const start = parseLocalDateTime(data.start_time);
    if (start === null) throw new HttpError("Enter a valid start time.");
    log.start_time = start;
  }
  if (log.end_time !== null) {
    if (has(data, "duration_minutes")) {
      const minutes = parseInt_(data.duration_minutes, { minimum: 1 });
      if (!minutes) throw new HttpError("Enter a duration of at least 1 minute.");
      log.end_time = log.start_time + minutes * 60000;
    } else if (has(data, "end_time")) {
      const end = parseLocalDateTime(data.end_time);
      if (end === null) throw new HttpError("Enter a valid end time.");
      log.end_time = end;
    }
    if (log.end_time <= log.start_time) throw new HttpError("The session has to end after it starts.");
  } else if (log.start_time > now) {
    throw new HttpError("A running session can't start in the future.");
  }
  if (has(data, "note")) log.note = String(data.note ?? "").trim() || null;
  return ok({ log: serializeLog(db, log, now) });
}

function removeLog({ db, params }) {
  const log = getOr404(db, "time_logs", params[0]);
  if (db.focus_timer.time_log_id === log.id) db.focus_timer.time_log_id = null;
  db.time_logs = db.time_logs.filter((l) => l.id !== log.id);
  return ok();
}

// ---------------------------------------------------------------------------
// Focus timer
// ---------------------------------------------------------------------------

const focusResponse = ({ db, now }) => ok({ focus: focusToDict(db, db.focus_timer, now) });

function focusStart(ctx) {
  const { db, data, now } = ctx;
  const mode = ["countdown", "pomodoro"].includes(data.mode) ? data.mode : "countdown";
  let taskId = parseInt_(data.task_id);
  if (taskId && !findById(db, "tasks", taskId)) throw new HttpError("That task no longer exists.");
  // A focus session on a class as a whole, not one of its tasks.
  const categoryId = parseInt_(data.category_id);
  if (categoryId && !taskId) {
    const category = findById(db, "categories", categoryId);
    if (!category) throw new HttpError("That class or activity no longer exists.");
    taskId = generalTask(db, category, now).id;
  }
  let minutes;
  if (mode === "pomodoro") {
    minutes = db.settings.pomodoro_work_minutes;
  } else {
    minutes = parseInt_(data.minutes, { minimum: 1, maximum: 24 * 60 });
    if (!minutes) throw new HttpError("Enter a length between 1 minute and 24 hours.");
  }
  timers.startFocus(db, mode, minutes, taskId, now);
  return focusResponse(ctx);
}

const focusAction = (fn) => (ctx) => {
  fn(ctx);
  return focusResponse(ctx);
};

// ---------------------------------------------------------------------------
// Stats (api_stats)
// ---------------------------------------------------------------------------

function insights({ db, query, now }) {
  const settings = db.settings;
  const today = todayYmd();
  let start = parseYmd(query.get("start"));
  let end = parseYmd(query.get("end"));
  if (query.get("period") === "configured") {
    const [periodStart, periodEnd] = currentPeriodBounds(settings.period_start_weekday, settings.period_end_weekday);
    start = ymdOf(periodStart);
    end = addDaysYmd(ymdOf(periodEnd), -1);
  } else if (!(start && end)) {
    const days = parseInt_(query.get("days"), { minimum: 1, maximum: MAX_RANGE_DAYS }) || 14;
    start = addDaysYmd(today, -(days - 1));
    end = today;
  }
  if (end < start) [start, end] = [end, start];
  if (daysBetween(start, end) >= MAX_RANGE_DAYS) start = addDaysYmd(end, -(MAX_RANGE_DAYS - 1));
  return buildInsights(db, start, end, settings, now);
}

function dailyStats({ db, query, now }) {
  const start = parseYmd(query.get("start"));
  const end = parseYmd(query.get("end"));
  if (!(start && end) || end < start || daysBetween(start, end) >= MAX_RANGE_DAYS) return { days: {} };
  return { days: Object.fromEntries(dailyTotals(db, start, end, now)) };
}

// ---------------------------------------------------------------------------
// Settings and CSV export (api_settings). Backups are in index.js.
// ---------------------------------------------------------------------------

const INT_SETTINGS = [
  ["period_start_weekday", 0, 6],
  ["period_end_weekday", 0, 6],
  ["daily_goal_minutes", 0, 24 * 60],
  ["long_timer_warning_minutes", 10, 24 * 60],
  ["pomodoro_work_minutes", 1, 240],
  ["pomodoro_short_break_minutes", 1, 120],
  ["pomodoro_long_break_minutes", 1, 240],
  ["pomodoro_cycles", 1, 12],
];
const BOOL_SETTINGS = ["sync_enabled", "lan_access_enabled", "sound_enabled"];

function updateSettings({ db, data }) {
  const settings = db.settings;
  for (const [field, minimum, maximum] of INT_SETTINGS) {
    if (!has(data, field)) continue;
    const value = parseInt_(data[field], { minimum, maximum });
    if (value === null) {
      const name = field.replaceAll("_", " ");
      throw new HttpError(`${name[0].toUpperCase()}${name.slice(1)} must be between ${minimum} and ${maximum}.`);
    }
    settings[field] = value;
  }
  for (const field of BOOL_SETTINGS) {
    if (has(data, field)) settings[field] = parseBool(data[field]);
  }
  if (THEMES.includes(data.theme)) settings.theme = data.theme;
  return ok({ settings: settingsToDict(settings) });
}

function csvField(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportTimeLogs({ db, query, now }) {
  let logs = db.time_logs;
  const start = parseYmd(query.get("start"));
  const end = parseYmd(query.get("end"));
  if (start) logs = logs.filter((l) => l.start_time >= dayStart(start));
  if (end) logs = logs.filter((l) => l.start_time < dayStart(addDaysYmd(end, 1)));

  const rows = [["date", "start", "end", "duration_minutes", "task", "category", "source", "note"]];
  for (const log of [...logs].sort((a, b) => a.start_time - b.start_time)) {
    const task = findById(db, "tasks", log.task_id);
    const category = findById(db, "categories", task.category_id);
    rows.push([
      ymdOf(log.start_time),
      hhmm(log.start_time),
      log.end_time !== null ? hhmm(log.end_time) : "running",
      (Math.round((logDuration(log, now) / 60) * 10) / 10).toFixed(1),
      displayTitle(db, task),
      category.name,
      effectiveSource(log),
      log.note || "",
    ]);
  }
  const csv = "﻿" + rows.map((r) => r.map(csvField).join(",") + "\r\n").join(""); // BOM so Excel reads UTF-8
  return {
    file: {
      blob: new Blob([csv], { type: "text/csv" }),
      filename: `time-logs-${fileStamp(now).slice(0, 8)}.csv`,
    },
  };
}

// ---------------------------------------------------------------------------
// Routing table
// ---------------------------------------------------------------------------

const ID = "(\\d+)";
const ROUTES = [
  ["GET", "/api/state", state],

  ["POST", "/api/categories", createCategory],
  ["PATCH POST", `/api/categories/${ID}`, editCategory],
  ["DELETE", `/api/categories/${ID}`, removeCategory],
  ["POST", `/api/categories/${ID}/timer/start`, startCategoryTimer],
  ["POST", `/api/categories/${ID}/timer/log`, logManualCategoryTime],

  ["POST", "/api/tasks", createTask],
  ["PATCH POST", `/api/tasks/${ID}`, editTask],
  ["DELETE", `/api/tasks/${ID}`, removeTask],
  ["POST", `/api/tasks/${ID}/complete`, completeTask],
  ["POST", `/api/tasks/${ID}/reopen`, reopenTask],
  ["POST", `/api/tasks/${ID}/timer/start`, startTimer],
  ["POST", `/api/tasks/${ID}/timer/stop`, stopTimer],
  ["POST", `/api/tasks/${ID}/timer/log`, logManualTime],

  ["POST", "/api/timer/stop", stopAnyTimer],
  ["GET", "/api/timer/active", activeTimer],
  ["POST", "/api/timer/trim", trimTimer],

  ["GET", "/api/logs", listLogs],
  ["PATCH POST", `/api/logs/${ID}`, editLog],
  ["DELETE", `/api/logs/${ID}`, removeLog],

  ["GET", "/api/focus", ({ db, now }) => focusToDict(db, db.focus_timer, now)],
  ["POST", "/api/focus/start", focusStart],
  ["POST", "/api/focus/next", focusAction(({ db, data, now }) => timers.nextPomodoroPhase(db, data.phase, now))],
  ["POST", "/api/focus/pause", focusAction(({ db, now }) => timers.pauseFocus(db, now))],
  ["POST", "/api/focus/resume", focusAction(({ db, now }) => timers.resumeFocus(db, now))],
  ["POST", "/api/focus/extend", focusAction(({ db, data, now }) => timers.extendFocus(db, parseInt_(data.minutes, { minimum: 1, maximum: 240 }) || 5, now))],
  ["POST", "/api/focus/cancel", focusAction(({ db, now }) => timers.cancelFocus(db, now))],

  ["GET", "/api/stats", insights],
  ["GET", "/api/stats/daily", dailyStats],

  ["GET", "/api/settings", ({ db }) => settingsToDict(db.settings)],
  ["PATCH POST", "/api/settings", updateSettings],
  ["GET", "/api/export/time-logs.csv", exportTimeLogs],
].map(([methods, pattern, handler]) => ({ methods: methods.split(" "), regex: new RegExp(`^${pattern}$`), handler }));

/** Find the handler for a request: { handler, params } or null. */
export function match(method, path) {
  for (const route of ROUTES) {
    const m = route.regex.exec(path);
    if (m && route.methods.includes(method)) return { handler: route.handler, params: m.slice(1) };
  }
  return null;
}
