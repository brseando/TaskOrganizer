// Stopwatch and focus-timer (countdown / Pomodoro) logic: a JavaScript port
// of app/timers.py.
//
// Only one time log is ever open at a time: starting the stopwatch on a
// task, or starting a focus work phase linked to a task, closes any other
// open session first.

import { isoLocal } from "./dates.js";
import { effectiveSource, findById, focusEndsAt, focusRemainingSeconds, insert } from "./models.js";

export function activeLog(db) {
  return db.time_logs.find((l) => l.end_time === null) || null;
}

function closeFocusLog(db, focus, at) {
  if (focus.time_log_id) {
    const log = findById(db, "time_logs", focus.time_log_id);
    if (log && log.end_time === null) log.end_time = Math.max(at, log.start_time);
  }
  focus.time_log_id = null;
}

export function stopAllActiveTimers(db, at) {
  for (const log of db.time_logs) {
    if (log.end_time === null) log.end_time = Math.max(at, log.start_time);
  }
  // The focus timer (if any) keeps counting down, but no longer records
  // time against its task.
  db.focus_timer.time_log_id = null;
}

function openLog(db, task, source, at) {
  stopAllActiveTimers(db, at);
  if (task.status === "todo") task.status = "in_progress";
  return insert(db, "time_logs", { task_id: task.id, start_time: at, end_time: null, is_manual: false, source, note: null });
}

export function startStopwatch(db, task, now) {
  return openLog(db, task, "stopwatch", now);
}

/**
 * Finish a focus phase whose time ran out (e.g. while the app was closed),
 * closing its task session at the moment the timer ended rather than
 * whenever someone next looked. Returns true if anything changed.
 */
export function syncFocusTimer(db, now) {
  const focus = db.focus_timer;
  const endsAt = focusEndsAt(focus);
  if (focus.status !== "running" || endsAt === null || endsAt > now) return false;
  closeFocusLog(db, focus, endsAt);
  if (focus.mode === "pomodoro" && focus.phase === "work") focus.completed_work_sessions += 1;
  focus.status = "finished";
  focus.finished_at = endsAt;
  focus.started_at = null;
  focus.remaining_at_pause = null;
  return true;
}

function startSegment(db, focus, seconds, now) {
  focus.status = "running";
  focus.started_at = now;
  focus.segment_seconds = seconds;
  focus.remaining_at_pause = null;
  focus.finished_at = null;
  if (focus.task_id && focus.phase === "work") {
    const task = findById(db, "tasks", focus.task_id);
    if (task && task.status !== "done") focus.time_log_id = openLog(db, task, focus.mode, now).id;
  }
}

/** Start a fresh countdown, or the first work phase of a Pomodoro cycle. */
export function startFocus(db, mode, minutes, taskId, now) {
  const focus = db.focus_timer;
  closeFocusLog(db, focus, now);
  focus.mode = mode;
  focus.phase = "work";
  focus.task_id = taskId;
  focus.completed_work_sessions = 0;
  focus.duration_seconds = minutes * 60;
  startSegment(db, focus, minutes * 60, now);
}

/** Start the break or work phase that follows (or `phaseOverride`, e.g. "work" to skip a break). */
export function nextPomodoroPhase(db, phaseOverride, now) {
  const settings = db.settings;
  const focus = db.focus_timer;
  closeFocusLog(db, focus, now);

  let phase;
  if (["work", "short_break", "long_break"].includes(phaseOverride)) {
    phase = phaseOverride;
  } else if (focus.phase === "work") {
    const cycles = Math.max(1, settings.pomodoro_cycles);
    const done = focus.completed_work_sessions;
    phase = done && done % cycles === 0 ? "long_break" : "short_break";
  } else {
    phase = "work";
  }

  const minutes = {
    work: settings.pomodoro_work_minutes,
    short_break: settings.pomodoro_short_break_minutes,
    long_break: settings.pomodoro_long_break_minutes,
  }[phase];
  focus.mode = "pomodoro";
  focus.phase = phase;
  focus.duration_seconds = minutes * 60;
  startSegment(db, focus, minutes * 60, now);
}

export function pauseFocus(db, now) {
  const focus = db.focus_timer;
  if (focus.status !== "running") return;
  focus.remaining_at_pause = focusRemainingSeconds(focus, now);
  closeFocusLog(db, focus, now);
  focus.status = "paused";
  focus.started_at = null;
}

export function resumeFocus(db, now) {
  const focus = db.focus_timer;
  if (focus.status === "paused") startSegment(db, focus, focus.remaining_at_pause || 0, now);
}

export function extendFocus(db, minutes, now) {
  const focus = db.focus_timer;
  const extra = minutes * 60;
  if (focus.status === "running") {
    focus.segment_seconds += extra;
    focus.duration_seconds += extra;
  } else if (focus.status === "paused") {
    focus.remaining_at_pause = (focus.remaining_at_pause || 0) + extra;
    focus.duration_seconds += extra;
  } else if (focus.status === "finished" && focus.mode === "countdown") {
    focus.duration_seconds = extra;
    startSegment(db, focus, extra, now);
  }
}

/** Stop the focus timer (or dismiss a finished one). Keeps task_id for next time. */
export function cancelFocus(db, now) {
  const focus = db.focus_timer;
  closeFocusLog(db, focus, now);
  focus.status = "idle";
  focus.started_at = null;
  focus.remaining_at_pause = null;
  focus.finished_at = null;
}

/** End the running session at an earlier time (for a forgotten timer). Returns [log, error]. */
export function trimActiveLog(db, endTime, now) {
  const log = activeLog(db);
  if (!log) return [null, "No timer is running."];
  if (endTime <= log.start_time) return [null, "The end time has to be after the session started."];
  log.end_time = Math.min(endTime, now);
  if (db.focus_timer.time_log_id === log.id) db.focus_timer.time_log_id = null;
  return [log, null];
}

export function serializeActiveLog(db, log) {
  if (!log) return null;
  const task = findById(db, "tasks", log.task_id);
  const category = findById(db, "categories", task.category_id);
  return {
    log_id: log.id,
    task_id: log.task_id,
    task_title: task.title,
    category_color: category.color,
    start_time: isoLocal(log.start_time),
    source: effectiveSource(log),
  };
}
