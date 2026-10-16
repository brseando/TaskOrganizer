"""Brings any older `tasks.db` up to the current schema, without losing data.

`db.create_all()` only creates tables that don't exist yet - it never alters
an existing table - so columns added after a database file was first
created have to be ALTER TABLE'd in by hand. There's no Alembic setup in this
project (overkill for a single-user SQLite file); instead every column added
since the first release is listed in COLUMN_MIGRATIONS, and only additive
changes are ever made.

Before touching a database that needs any change, a copy is saved next to it
as `tasks-pre-upgrade-<timestamp>.db`.
"""
import os
import shutil
from datetime import datetime

from sqlalchemy import inspect, text

from app.extensions import db

# (table, column, column DDL). Every entry must be nullable or have a
# DEFAULT, since SQLite can only add columns that existing rows can fill.
COLUMN_MIGRATIONS = [
    ("settings", "sync_enabled", "BOOLEAN NOT NULL DEFAULT 0"),
    ("settings", "daily_goal_minutes", "INTEGER NOT NULL DEFAULT 120"),
    ("settings", "theme", "VARCHAR(10) NOT NULL DEFAULT 'system'"),
    ("settings", "lan_access_enabled", "BOOLEAN NOT NULL DEFAULT 0"),
    ("settings", "long_timer_warning_minutes", "INTEGER NOT NULL DEFAULT 180"),
    ("settings", "pomodoro_work_minutes", "INTEGER NOT NULL DEFAULT 25"),
    ("settings", "pomodoro_short_break_minutes", "INTEGER NOT NULL DEFAULT 5"),
    ("settings", "pomodoro_long_break_minutes", "INTEGER NOT NULL DEFAULT 15"),
    ("settings", "pomodoro_cycles", "INTEGER NOT NULL DEFAULT 4"),
    ("settings", "sound_enabled", "BOOLEAN NOT NULL DEFAULT 1"),
    ("time_logs", "source", "VARCHAR(20)"),
    ("time_logs", "note", "TEXT"),
]

MAX_PRE_UPGRADE_BACKUPS = 5


def _pending_changes():
    """Return (missing_tables, missing_columns) for the current database."""
    inspector = inspect(db.engine)
    existing_tables = set(inspector.get_table_names())
    missing_tables = [t for t in db.metadata.tables if t not in existing_tables]

    missing_columns = []
    columns_by_table = {}
    for table, column, ddl in COLUMN_MIGRATIONS:
        if table not in existing_tables:
            continue  # create_all() will create it with every column already.
        if table not in columns_by_table:
            columns_by_table[table] = {c["name"] for c in inspector.get_columns(table)}
        if column not in columns_by_table[table]:
            missing_columns.append((table, column, ddl))

    return existing_tables, missing_tables, missing_columns


def _backup(db_path):
    instance_path = os.path.dirname(db_path)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = os.path.join(instance_path, f"tasks-pre-upgrade-{timestamp}.db")
    shutil.copy2(db_path, backup_path)

    backups = sorted(
        (f for f in os.listdir(instance_path) if f.startswith("tasks-pre-upgrade-") and f.endswith(".db")),
        reverse=True,
    )
    for stale in backups[MAX_PRE_UPGRADE_BACKUPS:]:
        try:
            os.remove(os.path.join(instance_path, stale))
        except OSError:
            pass
    return backup_path


def upgrade_database(db_path):
    """Create missing tables/columns. Safe to run on every startup.

    Returns the path of the safety backup if one was made, else None.
    Must be called inside an app context.
    """
    existing_tables, missing_tables, missing_columns = _pending_changes()

    backup_path = None
    is_existing_database = bool(existing_tables) and os.path.exists(db_path)
    if is_existing_database and (missing_tables or missing_columns):
        # Release pooled connections so the copy is a consistent snapshot.
        db.session.remove()
        db.engine.dispose()
        backup_path = _backup(db_path)

    db.create_all()
    if missing_columns:
        with db.engine.begin() as conn:
            for table, column, ddl in missing_columns:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))

    return backup_path
