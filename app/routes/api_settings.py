"""Settings, backups, database Push/Pull sync, and CSV export."""
import csv
import io
import os
import shutil
import sqlite3
import zipfile
from datetime import datetime, timedelta

from flask import Blueprint, Response, current_app, jsonify, request, send_file

from app.extensions import db
from app.models import THEMES, Settings, TimeLog
from app.routes.common import json_error, json_ok, parse_bool, parse_int, payload
from app.schema import upgrade_database
from app.stats import day_start, parse_date

bp = Blueprint("api_settings", __name__)

# (field, minimum, maximum) for integer settings.
_INT_SETTINGS = [
    ("period_start_weekday", 0, 6),
    ("period_end_weekday", 0, 6),
    ("daily_goal_minutes", 0, 24 * 60),
    ("long_timer_warning_minutes", 10, 24 * 60),
    ("pomodoro_work_minutes", 1, 240),
    ("pomodoro_short_break_minutes", 1, 120),
    ("pomodoro_long_break_minutes", 1, 240),
    ("pomodoro_cycles", 1, 12),
]
_BOOL_SETTINGS = ["sync_enabled", "lan_access_enabled", "sound_enabled"]


@bp.route("/api/settings")
def get_settings():
    return jsonify(Settings.get().to_dict())


@bp.route("/api/settings", methods=["PATCH", "POST"])
def update_settings():
    settings = Settings.get()
    data = payload()

    for field, minimum, maximum in _INT_SETTINGS:
        if field in data:
            value = parse_int(data.get(field), minimum=minimum, maximum=maximum)
            if value is None:
                return json_error(f"{field.replace('_', ' ').capitalize()} must be between {minimum} and {maximum}.")
            setattr(settings, field, value)
    for field in _BOOL_SETTINGS:
        if field in data:
            setattr(settings, field, parse_bool(data.get(field)))
    if data.get("theme") in THEMES:
        settings.theme = data["theme"]

    db.session.commit()
    return json_ok(settings=settings.to_dict())


# ---------------------------------------------------------------------------
# Backups
# ---------------------------------------------------------------------------

@bp.route("/api/backup/database")
@bp.route("/manage/backup/database")
def download_database():
    db_path = current_app.config["DB_PATH"]
    if not os.path.exists(db_path):
        return json_error("No database file exists yet.", status=404)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return send_file(
        db_path,
        as_attachment=True,
        download_name=f"tasks-backup-{timestamp}.db",
        mimetype="application/x-sqlite3",
    )


# Never worth including in a "whole app" zip: virtualenvs, bytecode, the
# live database (it has its own download), VCS metadata, build output.
_SERVER_BACKUP_EXCLUDED_DIRS = {
    ".venv", ".venv_test", ".venv_win_smoke", "__pycache__", "instance", ".git", "dist", "build",
}


@bp.route("/api/backup/server")
def download_server():
    if current_app.config.get("IS_FROZEN"):
        return json_error("The app code backup isn't available in the packaged app.", status=404)

    project_root = current_app.config["PROJECT_ROOT"]
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(project_root):
            dirs[:] = [d for d in dirs if d not in _SERVER_BACKUP_EXCLUDED_DIRS]
            for filename in files:
                file_path = os.path.join(root, filename)
                zf.write(file_path, os.path.relpath(file_path, project_root))
    buffer.seek(0)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return send_file(
        buffer,
        as_attachment=True,
        download_name=f"taskorganizer-backup-{timestamp}.zip",
        mimetype="application/zip",
    )


# ---------------------------------------------------------------------------
# Pull: replace the whole database with an uploaded copy
# ---------------------------------------------------------------------------

_SQLITE_HEADER = b"SQLite format 3\x00"
_REQUIRED_TABLES = {"categories", "tasks", "time_logs"}
_MAX_PRE_PULL_BACKUPS = 5


def _prune_pre_pull_backups(instance_path):
    backups = sorted(
        (f for f in os.listdir(instance_path) if f.startswith("tasks-pre-pull-") and f.endswith(".db")),
        reverse=True,
    )
    for stale in backups[_MAX_PRE_PULL_BACKUPS:]:
        try:
            os.remove(os.path.join(instance_path, stale))
        except OSError:
            pass


def _is_task_organizer_db(path):
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        finally:
            conn.close()
    except sqlite3.Error:
        return False
    return _REQUIRED_TABLES <= tables


@bp.route("/api/database/pull", methods=["POST"])
def pull_database():
    if not Settings.get().sync_enabled:
        # Guards the API itself, not just the hidden button.
        return json_error("Database sync is turned off. Enable it in Settings first.", status=403)

    upload = request.files.get("db_file")
    if not upload or not upload.filename:
        return json_error("Choose a database file to pull.")
    header = upload.stream.read(len(_SQLITE_HEADER))
    upload.stream.seek(0)
    if header != _SQLITE_HEADER:
        return json_error("That doesn't look like a Task Organizer database file.")

    db_path = current_app.config["DB_PATH"]
    instance_path = os.path.dirname(db_path)
    tmp_path = db_path + ".incoming"
    upload.save(tmp_path)
    if not _is_task_organizer_db(tmp_path):
        os.remove(tmp_path)
        return json_error("That doesn't look like a Task Organizer database file.")

    if os.path.exists(db_path):
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        shutil.copy2(db_path, os.path.join(instance_path, f"tasks-pre-pull-{timestamp}.db"))
        _prune_pre_pull_backups(instance_path)

    # Copy page-by-page instead of os.replace: on Windows, replacing a file
    # fails while any handle (another request thread, antivirus, iCloud) has it open.
    db.session.remove()
    db.engine.dispose()
    src = sqlite3.connect(tmp_path)
    dst = sqlite3.connect(db_path, timeout=15)
    try:
        src.backup(dst)
    finally:
        src.close()
        dst.close()
    try:
        os.remove(tmp_path)
    except OSError:
        pass

    # The pulled file may come from an older version of the app.
    upgrade_database(db_path)
    return json_ok()


# ---------------------------------------------------------------------------
# CSV export
# ---------------------------------------------------------------------------

@bp.route("/api/export/time-logs.csv")
def export_time_logs():
    query = TimeLog.query
    start = parse_date(request.args.get("start"))
    end = parse_date(request.args.get("end"))
    if start:
        query = query.filter(TimeLog.start_time >= day_start(start))
    if end:
        query = query.filter(TimeLog.start_time < day_start(end + timedelta(days=1)))

    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["date", "start", "end", "duration_minutes", "task", "category", "source", "note"])
    for log in query.order_by(TimeLog.start_time).all():
        writer.writerow(
            [
                log.start_time.date().isoformat(),
                log.start_time.strftime("%H:%M"),
                log.end_time.strftime("%H:%M") if log.end_time else "running",
                round(log.duration_seconds / 60, 1),
                log.task.title,
                log.task.category.name,
                log.effective_source,
                log.note or "",
            ]
        )

    timestamp = datetime.now().strftime("%Y%m%d")
    return Response(
        "\ufeff" + out.getvalue(),  # BOM so Excel opens it as UTF-8
        mimetype="text/csv",
        headers={"Content-Disposition": f'attachment; filename="time-logs-{timestamp}.csv"'},
    )
