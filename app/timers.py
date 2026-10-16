"""Stopwatch and focus-timer (countdown / Pomodoro) logic.

Only one TimeLog is ever open at a time, app-wide: starting the stopwatch
on a task, or starting a focus work phase linked to a task, closes any other
open session first.

Callers are responsible for committing the session.
"""
from datetime import datetime

from app.extensions import db
from app.models import FocusTimer, Settings, Task, TimeLog


def active_log():
    return TimeLog.query.filter_by(end_time=None).first()


def _close_focus_log(focus, at):
    if focus.time_log_id:
        log = db.session.get(TimeLog, focus.time_log_id)
        if log and log.end_time is None:
            log.end_time = max(at, log.start_time)
    focus.time_log_id = None


def stop_all_active_timers(at=None):
    at = at or datetime.now()
    for log in TimeLog.query.filter_by(end_time=None).all():
        log.end_time = max(at, log.start_time)
    # The focus timer (if any) keeps counting down, but no longer records
    # time against its task.
    FocusTimer.get().time_log_id = None


def _open_log(task, source, at):
    stop_all_active_timers(at)
    if task.status == "todo":
        task.status = "in_progress"
    log = TimeLog(task_id=task.id, start_time=at, source=source, is_manual=False)
    db.session.add(log)
    db.session.flush()
    return log


def start_stopwatch(task):
    return _open_log(task, "stopwatch", datetime.now())


def sync_focus_timer():
    """Finish a focus phase whose time ran out (e.g. while no browser tab was
    open), closing its task session at the moment the timer ended rather
    than whenever someone next looked. Returns the FocusTimer.
    """
    focus = FocusTimer.get()
    if focus.status == "running" and focus.ends_at and focus.ends_at <= datetime.now():
        ends_at = focus.ends_at
        _close_focus_log(focus, ends_at)
        if focus.mode == "pomodoro" and focus.phase == "work":
            focus.completed_work_sessions += 1
        focus.status = "finished"
        focus.finished_at = ends_at
        focus.started_at = None
        focus.remaining_at_pause = None
        db.session.commit()
    return focus


def _start_segment(focus, seconds, now):
    focus.status = "running"
    focus.started_at = now
    focus.segment_seconds = seconds
    focus.remaining_at_pause = None
    focus.finished_at = None
    if focus.task_id and focus.phase == "work":
        task = db.session.get(Task, focus.task_id)
        if task and task.status != "done":
            focus.time_log_id = _open_log(task, focus.mode, now).id


def start_focus(mode, minutes, task_id=None):
    """Start a fresh countdown, or the first work phase of a Pomodoro cycle."""
    now = datetime.now()
    focus = FocusTimer.get()
    _close_focus_log(focus, now)
    focus.mode = mode
    focus.phase = "work"
    focus.task_id = task_id
    focus.completed_work_sessions = 0
    focus.duration_seconds = minutes * 60
    _start_segment(focus, minutes * 60, now)
    return focus


def next_pomodoro_phase(phase_override=None):
    """After a Pomodoro phase finishes: start the following break or work
    phase (or `phase_override`, e.g. "work" to skip a break)."""
    settings = Settings.get()
    focus = FocusTimer.get()
    now = datetime.now()
    _close_focus_log(focus, now)

    if phase_override in ("work", "short_break", "long_break"):
        phase = phase_override
    elif focus.phase == "work":
        cycles = max(1, settings.pomodoro_cycles)
        done = focus.completed_work_sessions
        phase = "long_break" if done and done % cycles == 0 else "short_break"
    else:
        phase = "work"

    minutes = {
        "work": settings.pomodoro_work_minutes,
        "short_break": settings.pomodoro_short_break_minutes,
        "long_break": settings.pomodoro_long_break_minutes,
    }[phase]
    focus.mode = "pomodoro"
    focus.phase = phase
    focus.duration_seconds = minutes * 60
    _start_segment(focus, minutes * 60, now)
    return focus


def pause_focus():
    focus = FocusTimer.get()
    if focus.status == "running":
        now = datetime.now()
        focus.remaining_at_pause = focus.remaining_seconds
        _close_focus_log(focus, now)
        focus.status = "paused"
        focus.started_at = None
    return focus


def resume_focus():
    focus = FocusTimer.get()
    if focus.status == "paused":
        _start_segment(focus, focus.remaining_at_pause or 0, datetime.now())
    return focus


def extend_focus(minutes):
    focus = FocusTimer.get()
    extra = minutes * 60
    if focus.status == "running":
        focus.segment_seconds += extra
        focus.duration_seconds += extra
    elif focus.status == "paused":
        focus.remaining_at_pause = (focus.remaining_at_pause or 0) + extra
        focus.duration_seconds += extra
    elif focus.status == "finished" and focus.mode == "countdown":
        focus.duration_seconds = extra
        _start_segment(focus, extra, datetime.now())
    return focus


def cancel_focus():
    """Stop the focus timer (or dismiss a finished one). Keeps task_id so
    the Focus view can preselect the same task next time."""
    focus = FocusTimer.get()
    _close_focus_log(focus, datetime.now())
    focus.status = "idle"
    focus.started_at = None
    focus.remaining_at_pause = None
    focus.finished_at = None
    return focus


def trim_active_log(end_time):
    """End the running session at an earlier time (for a forgotten timer)."""
    log = active_log()
    if not log:
        return None, "No timer is running."
    now = datetime.now()
    if end_time <= log.start_time:
        return None, "The end time has to be after the session started."
    if end_time > now:
        end_time = now
    log.end_time = end_time
    focus = FocusTimer.get()
    if focus.time_log_id == log.id:
        focus.time_log_id = None
    return log, None


def serialize_active_log(log):
    if not log:
        return None
    return {
        "log_id": log.id,
        "task_id": log.task_id,
        "task_title": log.task.title,
        "category_color": log.task.category.color,
        "start_time": log.start_time.isoformat(timespec="seconds"),
        "source": log.effective_source,
    }


def parse_local_datetime(value):
    """Parse 'YYYY-MM-DDTHH:MM[:SS]' (from datetime-local inputs)."""
    try:
        return datetime.fromisoformat((value or "").strip())
    except ValueError:
        return None
