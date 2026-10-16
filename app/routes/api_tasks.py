"""The /api/state snapshot the frontend renders from, plus category and task CRUD."""
from datetime import date, datetime, timedelta

from flask import Blueprint, current_app, jsonify, request

from app import stats
from app.extensions import db
from app.models import (
    CATEGORY_COLOR_PALETTE,
    CATEGORY_KINDS,
    TASK_PRIORITIES,
    Category,
    FocusTimer,
    Settings,
    Task,
    TimeLog,
)
from app.routes.common import (
    combine_date_time,
    json_error,
    json_ok,
    network_info,
    parse_bool,
    parse_int,
    payload,
)
from app.timers import active_log, serialize_active_log

bp = Blueprint("api_tasks", __name__, url_prefix="/api")


def serialize_task(task):
    data = task.to_dict()
    data["category_name"] = task.category.name
    data["category_color"] = task.category.color
    return data


def serialize_log(log):
    data = log.to_dict()
    data["task_title"] = log.task.title
    data["category_id"] = log.task.category_id
    data["category_color"] = log.task.category.color
    return data


@bp.route("/state")
def state():
    settings = Settings.get()
    period_start, period_end, period_label, is_custom = stats.resolve_period(
        request.args.get("start"), request.args.get("end"), settings
    )
    categories = Category.query.order_by(Category.kind, Category.name).all()
    per_category, totals = stats.period_totals(period_start, period_end, categories)

    today_start = stats.day_start(date.today())
    today_end = today_start + timedelta(days=1)
    today_logs = (
        TimeLog.query.filter(TimeLog.start_time < today_end)
        .filter(db.or_(TimeLog.end_time.is_(None), TimeLog.end_time > today_start))
        .order_by(TimeLog.start_time.desc())
        .all()
    )

    tasks = Task.query.all()
    open_counts = {}
    for t in tasks:
        if t.status != "done":
            open_counts[t.category_id] = open_counts.get(t.category_id, 0) + 1

    return jsonify(
        {
            "server_time": datetime.now().isoformat(timespec="seconds"),
            "settings": settings.to_dict(),
            "categories": [
                {
                    **c.to_dict(),
                    "open_count": open_counts.get(c.id, 0),
                    "period": per_category[c.id],
                }
                for c in categories
            ],
            "tasks": [serialize_task(t) for t in tasks],
            "period": {
                "label": period_label,
                "is_custom": is_custom,
                "configured_label": settings.period_label,
                "start": period_start.date().isoformat(),
                "end": (period_end - timedelta(days=1)).date().isoformat(),
                "total_estimated_minutes": totals["estimated"],
                "total_planned_minutes": totals["planned"],
                "total_actual_minutes": totals["actual"],
            },
            "active_timer": serialize_active_log(active_log()),
            "focus": FocusTimer.get().to_dict(),
            "today": stats.today_summary(settings),
            "today_logs": [serialize_log(log) for log in today_logs],
            "network": network_info(settings),
            "color_palette": CATEGORY_COLOR_PALETTE,
            "app": {
                "db_path": current_app.config["DB_PATH"],
                "is_frozen": current_app.config["IS_FROZEN"],
            },
        }
    )


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------

def _apply_category_fields(category, data):
    if "name" in data:
        category.name = (data.get("name") or "").strip()[:80]
    if data.get("kind") in CATEGORY_KINDS:
        category.kind = data["kind"]
    color = (data.get("color") or "").strip()
    if len(color) == 7 and color.startswith("#"):
        category.color = color


@bp.route("/categories", methods=["POST"])
def create_category():
    data = payload()
    category = Category(kind="class", color=CATEGORY_COLOR_PALETTE[0])
    _apply_category_fields(category, data)
    if not category.name:
        return json_error("Give the class or activity a name.")
    db.session.add(category)
    db.session.commit()
    return json_ok(category=category.to_dict())


@bp.route("/categories/<int:category_id>", methods=["PATCH", "POST"])
def edit_category(category_id):
    category = db.get_or_404(Category, category_id)
    _apply_category_fields(category, payload())
    if not category.name:
        db.session.rollback()
        return json_error("Give the class or activity a name.")
    db.session.commit()
    return json_ok(category=category.to_dict())


@bp.route("/categories/<int:category_id>", methods=["DELETE"])
def delete_category(category_id):
    category = db.get_or_404(Category, category_id)
    db.session.delete(category)
    db.session.commit()
    return json_ok()


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------

def _apply_task_fields(task, data):
    """Copy any fields present in `data` onto the task. Returns an error
    message, or None."""
    if "category_id" in data:
        category_id = parse_int(data.get("category_id"))
        if not category_id or not db.session.get(Category, category_id):
            return "Choose a class or activity."
        task.category_id = category_id
    if "title" in data:
        task.title = (data.get("title") or "").strip()[:200]
    if "description" in data:
        task.description = (data.get("description") or "").strip()
    if "due_date" in data:
        task.due_date = combine_date_time(data.get("due_date"), data.get("due_time"))
    if data.get("priority") in TASK_PRIORITIES:
        task.priority = data["priority"]
    if "estimated_minutes" in data:
        task.estimated_minutes = parse_int(data.get("estimated_minutes"), minimum=0)
    if "is_recurring" in data:
        task.is_recurring = parse_bool(data.get("is_recurring"))
    if "recurrence_interval_days" in data:
        task.recurrence_interval_days = parse_int(data.get("recurrence_interval_days"), minimum=1)
    if task.is_recurring and not task.recurrence_interval_days:
        return "Enter how many days apart the task repeats."
    if not task.title:
        return "Give the task a title."
    if not task.category_id:
        return "Choose a class or activity."
    return None


@bp.route("/tasks", methods=["POST"])
def create_task():
    task = Task(priority="medium", status="todo", is_recurring=False)
    error = _apply_task_fields(task, payload())
    if error:
        return json_error(error)
    db.session.add(task)
    db.session.commit()
    return json_ok(task=serialize_task(task))


@bp.route("/tasks/<int:task_id>", methods=["PATCH", "POST"])
def edit_task(task_id):
    task = db.get_or_404(Task, task_id)
    error = _apply_task_fields(task, payload())
    if error:
        db.session.rollback()
        return json_error(error)
    db.session.commit()
    return json_ok(task=serialize_task(task))


@bp.route("/tasks/<int:task_id>", methods=["DELETE"])
def delete_task(task_id):
    task = db.get_or_404(Task, task_id)
    db.session.delete(task)
    db.session.commit()
    return json_ok()


@bp.route("/tasks/<int:task_id>/complete", methods=["POST"])
def complete_task(task_id):
    task = db.get_or_404(Task, task_id)
    now = datetime.now()
    active = task.active_time_log
    if active:
        active.end_time = now
    task.status = "done"
    task.completed_at = now
    next_task = task.spawn_next_occurrence() if task.is_recurring else None
    db.session.commit()
    return json_ok(task=serialize_task(task), next_task=serialize_task(next_task) if next_task else None)


@bp.route("/tasks/<int:task_id>/reopen", methods=["POST"])
def reopen_task(task_id):
    task = db.get_or_404(Task, task_id)
    task.status = "todo"
    task.completed_at = None
    db.session.commit()
    return json_ok(task=serialize_task(task))
