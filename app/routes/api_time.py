"""Stopwatch, focus timer (countdown / Pomodoro), and time log editing."""
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request

from app import timers
from app.extensions import db
from app.models import FocusTimer, Settings, Task, TimeLog
from app.routes.api_tasks import serialize_log, serialize_task
from app.routes.common import combine_date_time, json_error, json_ok, parse_int, payload
from app.stats import day_start, parse_date

bp = Blueprint("api_time", __name__, url_prefix="/api")


@bp.before_app_request
def finish_expired_focus_timer():
    if request.path.startswith("/api/"):
        timers.sync_focus_timer()


# ---------------------------------------------------------------------------
# Stopwatch
# ---------------------------------------------------------------------------

@bp.route("/tasks/<int:task_id>/timer/start", methods=["POST"])
def start_timer(task_id):
    task = db.get_or_404(Task, task_id)
    log = timers.start_stopwatch(task)
    db.session.commit()
    return json_ok(task_id=task.id, start_time=log.start_time.isoformat(timespec="seconds"))


@bp.route("/tasks/<int:task_id>/timer/stop", methods=["POST"])
def stop_timer(task_id):
    task = db.get_or_404(Task, task_id)
    active = task.active_time_log
    if active:
        active.end_time = datetime.now()
        focus = FocusTimer.get()
        if focus.time_log_id == active.id:
            focus.time_log_id = None
        db.session.commit()
    return json_ok(task_id=task.id, total_tracked_seconds=task.total_tracked_seconds)


@bp.route("/timer/stop", methods=["POST"])
def stop_any_timer():
    """Stop whatever session is running (keyboard shortcut / tray menu)."""
    timers.stop_all_active_timers()
    db.session.commit()
    return json_ok()


@bp.route("/timer/active")
def active_timer():
    log = timers.active_log()
    if not log:
        return jsonify({"active": False})
    return jsonify({"active": True, **timers.serialize_active_log(log)})


@bp.route("/timer/trim", methods=["POST"])
def trim_timer():
    end_time = timers.parse_local_datetime(payload().get("end_time"))
    if not end_time:
        return json_error("Pick the time you actually stopped.")
    log, error = timers.trim_active_log(end_time)
    if error:
        return json_error(error)
    db.session.commit()
    return json_ok(log=serialize_log(log))


# ---------------------------------------------------------------------------
# Manual entries and log editing
# ---------------------------------------------------------------------------

@bp.route("/tasks/<int:task_id>/timer/log", methods=["POST"])
def log_manual_time(task_id):
    """Add a finished session by hand. Defaults to ending "just now"; an
    optional date/time back-dates it."""
    task = db.get_or_404(Task, task_id)
    data = payload()

    minutes = parse_int(data.get("minutes"), minimum=1)
    if not minutes:
        return json_error("Enter a number of minutes greater than 0.")

    start_time = datetime.now() - timedelta(minutes=minutes)
    if data.get("logged_date"):
        combined = combine_date_time(data.get("logged_date"), data.get("logged_time") or "00:00")
        if combined:
            start_time = combined

    log = TimeLog(
        task_id=task.id,
        start_time=start_time,
        end_time=start_time + timedelta(minutes=minutes),
        is_manual=True,
        source="manual",
        note=(data.get("note") or "").strip() or None,
    )
    db.session.add(log)
    db.session.commit()
    return json_ok(task=serialize_task(task), log=serialize_log(log))


@bp.route("/logs")
def list_logs():
    query = TimeLog.query
    task_id = parse_int(request.args.get("task_id"))
    if task_id:
        query = query.filter(TimeLog.task_id == task_id)
    start = parse_date(request.args.get("start"))
    end = parse_date(request.args.get("end"))
    if start:
        query = query.filter(db.or_(TimeLog.end_time.is_(None), TimeLog.end_time > day_start(start)))
    if end:
        query = query.filter(TimeLog.start_time < day_start(end + timedelta(days=1)))
    limit = parse_int(request.args.get("limit"), minimum=1, maximum=5000) or 500
    logs = query.order_by(TimeLog.start_time.desc()).limit(limit).all()
    return jsonify({"logs": [serialize_log(log) for log in logs]})


@bp.route("/logs/<int:log_id>", methods=["PATCH", "POST"])
def edit_log(log_id):
    log = db.get_or_404(TimeLog, log_id)
    data = payload()

    if "task_id" in data:
        task_id = parse_int(data.get("task_id"))
        if not task_id or not db.session.get(Task, task_id):
            return json_error("Choose a task.")
        log.task_id = task_id
    if "start_time" in data:
        start = timers.parse_local_datetime(data.get("start_time"))
        if not start:
            return json_error("Enter a valid start time.")
        log.start_time = start
    if log.end_time is not None:
        if "duration_minutes" in data:
            minutes = parse_int(data.get("duration_minutes"), minimum=1)
            if not minutes:
                return json_error("Enter a duration of at least 1 minute.")
            log.end_time = log.start_time + timedelta(minutes=minutes)
        elif "end_time" in data:
            end = timers.parse_local_datetime(data.get("end_time"))
            if not end:
                return json_error("Enter a valid end time.")
            log.end_time = end
        if log.end_time <= log.start_time:
            db.session.rollback()
            return json_error("The session has to end after it starts.")
    elif log.start_time > datetime.now():
        db.session.rollback()
        return json_error("A running session can't start in the future.")
    if "note" in data:
        log.note = (data.get("note") or "").strip() or None

    db.session.commit()
    return json_ok(log=serialize_log(log))


@bp.route("/logs/<int:log_id>", methods=["DELETE"])
def delete_log(log_id):
    log = db.get_or_404(TimeLog, log_id)
    focus = FocusTimer.get()
    if focus.time_log_id == log.id:
        focus.time_log_id = None
    db.session.delete(log)
    db.session.commit()
    return json_ok()


# ---------------------------------------------------------------------------
# Focus timer (countdown / Pomodoro)
# ---------------------------------------------------------------------------

def _focus_response():
    db.session.commit()
    return json_ok(focus=FocusTimer.get().to_dict())


@bp.route("/focus")
def focus_state():
    return jsonify(FocusTimer.get().to_dict())


@bp.route("/focus/start", methods=["POST"])
def focus_start():
    data = payload()
    mode = data.get("mode") if data.get("mode") in ("countdown", "pomodoro") else "countdown"
    task_id = parse_int(data.get("task_id"))
    if task_id and not db.session.get(Task, task_id):
        return json_error("That task no longer exists.")

    if mode == "pomodoro":
        minutes = Settings.get().pomodoro_work_minutes
    else:
        minutes = parse_int(data.get("minutes"), minimum=1, maximum=24 * 60)
        if not minutes:
            return json_error("Enter a length between 1 minute and 24 hours.")

    timers.start_focus(mode, minutes, task_id)
    return _focus_response()


@bp.route("/focus/next", methods=["POST"])
def focus_next():
    timers.next_pomodoro_phase(payload().get("phase"))
    return _focus_response()


@bp.route("/focus/pause", methods=["POST"])
def focus_pause():
    timers.pause_focus()
    return _focus_response()


@bp.route("/focus/resume", methods=["POST"])
def focus_resume():
    timers.resume_focus()
    return _focus_response()


@bp.route("/focus/extend", methods=["POST"])
def focus_extend():
    minutes = parse_int(payload().get("minutes"), minimum=1, maximum=240) or 5
    timers.extend_focus(minutes)
    return _focus_response()


@bp.route("/focus/cancel", methods=["POST"])
def focus_cancel():
    timers.cancel_focus()
    return _focus_response()
