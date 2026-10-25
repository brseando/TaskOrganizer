// The on-device data model: a JavaScript port of app/models.py.
//
// All data lives in one plain object (see emptyDatabase) that storage.js
// keeps in IndexedDB. Rows use the same field names as the desktop SQLite
// tables, with date-times as epoch ms, so sqlite.js can convert either way.

import { addDaysMs, isoLocal } from "./dates.js";

export const CATEGORY_KINDS = ["class", "extracurricular"];
export const TASK_PRIORITIES = ["low", "medium", "high"];
export const THEMES = ["system", "light", "dark"];
export const WEEKDAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const GENERAL_TASK_TITLE = "General study";

export const CATEGORY_COLOR_PALETTE = [
  "#4cc9f0", "#4895ef", "#4361ee", "#3f37c9", "#7209b7",
  "#f72585", "#b5179e", "#f77f00", "#fcbf49", "#43aa8b",
  "#90be6d", "#577590",
];

export const DEFAULT_SETTINGS = {
  period_start_weekday: 0,
  period_end_weekday: 6,
  sync_enabled: false,
  daily_goal_minutes: 120,
  theme: "system",
  lan_access_enabled: false,
  long_timer_warning_minutes: 180,
  pomodoro_work_minutes: 25,
  pomodoro_short_break_minutes: 5,
  pomodoro_long_break_minutes: 15,
  pomodoro_cycles: 4,
  sound_enabled: true,
};

export const DEFAULT_FOCUS = {
  mode: "countdown",
  status: "idle",
  phase: "work",
  task_id: null,
  duration_seconds: 0,
  started_at: null,
  segment_seconds: 0,
  remaining_at_pause: null,
  completed_work_sessions: 0,
  time_log_id: null,
  finished_at: null,
};

export function emptyDatabase() {
  return {
    categories: [],
    tasks: [],
    time_logs: [],
    settings: { ...DEFAULT_SETTINGS },
    focus_timer: { ...DEFAULT_FOCUS },
    next_id: { categories: 1, tasks: 1, time_logs: 1 },
  };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export function insert(db, table, row) {
  row.id = db.next_id[table]++;
  db[table].push(row);
  return row;
}

export function findById(db, table, id) {
  return db[table].find((row) => row.id === id) || null;
}

/** Delete a category or task along with everything under it (like the desktop cascade). */
export function deleteCategory(db, id) {
  db.tasks.filter((t) => t.category_id === id).forEach((t) => deleteTask(db, t.id));
  db.categories = db.categories.filter((c) => c.id !== id);
}

export function deleteTask(db, id) {
  db.time_logs = db.time_logs.filter((l) => l.task_id !== id);
  db.tasks = db.tasks.filter((t) => t.id !== id);
}

/** Categories ordered by kind, then name (the desktop sort). */
export function sortedCategories(db) {
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return [...db.categories].sort((a, b) => cmp(a.kind, b.kind) || cmp(a.name, b.name) || a.id - b.id);
}

// ---------------------------------------------------------------------------
// Time logs and tasks
// ---------------------------------------------------------------------------

export function logDuration(log, now) {
  return Math.max(0, Math.floor(((log.end_time ?? now) - log.start_time) / 1000));
}

export function effectiveSource(log) {
  if (log.source) return log.source;
  return log.is_manual ? "manual" : "stopwatch";
}

export function taskLogs(db, task) {
  return db.time_logs.filter((l) => l.task_id === task.id);
}

export function taskTrackedSeconds(db, task, now) {
  return taskLogs(db, task).reduce((sum, l) => sum + logDuration(l, now), 0);
}

export function activeLogForTask(db, task) {
  return taskLogs(db, task).find((l) => l.end_time === null) || null;
}

/** "Math · General study" for a category's general study task, else the title. */
export function displayTitle(db, task) {
  if (!task.is_general) return task.title;
  return `${findById(db, "categories", task.category_id).name} \u00b7 ${GENERAL_TASK_TITLE}`;
}

/** The category's "general study" task, created the first time it's needed. */
export function generalTask(db, category, now) {
  return (
    db.tasks.find((t) => t.category_id === category.id && t.is_general) ||
    insert(db, "tasks", {
      category_id: category.id,
      title: GENERAL_TASK_TITLE,
      description: "",
      due_date: null,
      priority: "medium",
      estimated_minutes: null,
      status: "in_progress",
      is_recurring: false,
      recurrence_interval_days: null,
      is_general: true,
      created_at: now,
      completed_at: null,
    })
  );
}

/** The next copy of a repeating task, added after this one is completed. */
export function spawnNextOccurrence(db, task, now) {
  if (!task.is_recurring || !task.recurrence_interval_days) return null;
  return insert(db, "tasks", {
    category_id: task.category_id,
    title: task.title,
    description: task.description,
    due_date: addDaysMs(task.due_date ?? now, task.recurrence_interval_days),
    priority: task.priority,
    estimated_minutes: task.estimated_minutes,
    status: "todo",
    is_recurring: true,
    recurrence_interval_days: task.recurrence_interval_days,
    is_general: false,
    created_at: now,
    completed_at: null,
  });
}

// ---------------------------------------------------------------------------
// Serializers (same JSON as the desktop server)
// ---------------------------------------------------------------------------

export function categoryToDict(c) {
  return { id: c.id, name: c.name, kind: c.kind, color: c.color };
}

export function taskToDict(db, task, now) {
  const active = activeLogForTask(db, task);
  const tracked = taskTrackedSeconds(db, task, now);
  const actualMinutes = Math.floor(tracked / 60);
  const open = task.due_date !== null && task.status !== "done";
  return {
    id: task.id,
    category_id: task.category_id,
    title: displayTitle(db, task),
    is_general: Boolean(task.is_general),
    description: task.description || "",
    due_date: isoLocal(task.due_date),
    priority: task.priority,
    estimated_minutes: task.estimated_minutes,
    status: task.status,
    is_recurring: task.is_recurring,
    recurrence_interval_days: task.recurrence_interval_days,
    total_tracked_seconds: tracked,
    actual_minutes: actualMinutes,
    delta_minutes: task.estimated_minutes !== null ? actualMinutes - task.estimated_minutes : null,
    is_overdue: open && task.due_date < now,
    is_due_soon: open && now <= task.due_date && task.due_date <= now + 48 * 3600 * 1000,
    created_at: isoLocal(task.created_at),
    completed_at: isoLocal(task.completed_at),
    timer_running: active !== null,
    timer_start_time: active ? isoLocal(active.start_time) : null,
  };
}

export function serializeTask(db, task, now) {
  const category = findById(db, "categories", task.category_id);
  return { ...taskToDict(db, task, now), category_name: category.name, category_color: category.color };
}

export function logToDict(log, now) {
  return {
    id: log.id,
    task_id: log.task_id,
    start_time: isoLocal(log.start_time),
    end_time: isoLocal(log.end_time),
    duration_seconds: logDuration(log, now),
    is_manual: log.is_manual,
    source: effectiveSource(log),
    note: log.note || "",
  };
}

export function serializeLog(db, log, now) {
  const task = findById(db, "tasks", log.task_id);
  const category = findById(db, "categories", task.category_id);
  return { ...logToDict(log, now), task_title: displayTitle(db, task), category_id: task.category_id, category_color: category.color };
}

export function periodLabel(settings) {
  const { period_start_weekday: start, period_end_weekday: end } = settings;
  return start === end ? WEEKDAY_ABBR[start] : `${WEEKDAY_ABBR[start]}–${WEEKDAY_ABBR[end]}`;
}

export function settingsToDict(settings) {
  const s = settings;
  return {
    period_start_weekday: s.period_start_weekday,
    period_end_weekday: s.period_end_weekday,
    period_label: periodLabel(s),
    sync_enabled: s.sync_enabled,
    daily_goal_minutes: s.daily_goal_minutes,
    theme: s.theme,
    lan_access_enabled: s.lan_access_enabled,
    long_timer_warning_minutes: s.long_timer_warning_minutes,
    pomodoro_work_minutes: s.pomodoro_work_minutes,
    pomodoro_short_break_minutes: s.pomodoro_short_break_minutes,
    pomodoro_long_break_minutes: s.pomodoro_long_break_minutes,
    pomodoro_cycles: s.pomodoro_cycles,
    sound_enabled: s.sound_enabled,
  };
}

// ---------------------------------------------------------------------------
// Focus timer
// ---------------------------------------------------------------------------

export function focusEndsAt(focus) {
  if (focus.status !== "running" || focus.started_at === null) return null;
  return focus.started_at + focus.segment_seconds * 1000;
}

export function focusRemainingSeconds(focus, now) {
  if (focus.status === "running") return Math.max(0, Math.trunc((focusEndsAt(focus) - now) / 1000));
  if (focus.status === "paused") return focus.remaining_at_pause || 0;
  return 0;
}

export function focusToDict(db, focus, now) {
  const task = focus.task_id ? findById(db, "tasks", focus.task_id) : null;
  const category = task ? findById(db, "categories", task.category_id) : null;
  return {
    mode: focus.mode,
    status: focus.status,
    phase: focus.phase,
    task_id: task ? task.id : null,
    task_title: task ? displayTitle(db, task) : null,
    category_color: category ? category.color : null,
    duration_seconds: focus.duration_seconds,
    remaining_seconds: focusRemainingSeconds(focus, now),
    ends_at: isoLocal(focusEndsAt(focus)),
    finished_at: isoLocal(focus.finished_at),
    completed_work_sessions: focus.completed_work_sessions,
  };
}
