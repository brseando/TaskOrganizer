"""Database models for the Task Organizer.

Tables:
- Category: a class or extracurricular that tasks belong to.
- Task: a single homework/assignment/todo item.
- TimeLog: one tracked session (stopwatch, focus timer, or manual entry)
  against a task.
- Settings: a single row of app-wide preferences.
- FocusTimer: a single row holding the state of the countdown / Pomodoro
  timer, so it survives page reloads and is shared by every open tab.

Compatibility rule: existing tables and columns are never renamed or
dropped - only new columns (with defaults) and new tables are added, and
`app/schema.py` adds them to older database files on startup. That keeps
every older `tasks.db` usable, and keeps upgraded files readable by older
builds of the app.
"""
from datetime import datetime, timedelta

from app.extensions import db

CATEGORY_KINDS = ("class", "extracurricular")
TASK_PRIORITIES = ("low", "medium", "high")
TASK_STATUSES = ("todo", "in_progress", "done")
TIME_LOG_SOURCES = ("stopwatch", "manual", "countdown", "pomodoro")
THEMES = ("system", "light", "dark")

WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
WEEKDAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

# Readable on both the light and dark themes; offered as defaults when
# creating a category.
CATEGORY_COLOR_PALETTE = [
    "#4cc9f0", "#4895ef", "#4361ee", "#3f37c9", "#7209b7",
    "#f72585", "#b5179e", "#f77f00", "#fcbf49", "#43aa8b",
    "#90be6d", "#577590",
]


def _iso(value):
    return value.isoformat(timespec="seconds") if value else None


class Category(db.Model):
    __tablename__ = "categories"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), nullable=False)
    kind = db.Column(db.String(20), nullable=False, default="class")
    color = db.Column(db.String(7), nullable=False, default="#4361ee")
    created_at = db.Column(db.DateTime, default=datetime.now)

    tasks = db.relationship(
        "Task", backref="category", cascade="all, delete-orphan", lazy=True
    )

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "kind": self.kind,
            "color": self.color,
        }


class Task(db.Model):
    __tablename__ = "tasks"

    id = db.Column(db.Integer, primary_key=True)
    category_id = db.Column(db.Integer, db.ForeignKey("categories.id"), nullable=False)

    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=True, default="")
    due_date = db.Column(db.DateTime, nullable=True)
    priority = db.Column(db.String(10), nullable=False, default="medium")
    estimated_minutes = db.Column(db.Integer, nullable=True)
    status = db.Column(db.String(20), nullable=False, default="todo")

    is_recurring = db.Column(db.Boolean, nullable=False, default=False)
    recurrence_interval_days = db.Column(db.Integer, nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.now)
    completed_at = db.Column(db.DateTime, nullable=True)

    time_logs = db.relationship(
        "TimeLog", backref="task", cascade="all, delete-orphan", lazy=True
    )

    @property
    def total_tracked_seconds(self):
        """Sum of all completed (and currently running) sessions."""
        return sum(log.duration_seconds for log in self.time_logs)

    @property
    def active_time_log(self):
        for log in self.time_logs:
            if log.end_time is None:
                return log
        return None

    @property
    def is_overdue(self):
        if not self.due_date or self.status == "done":
            return False
        return self.due_date < datetime.now()

    @property
    def is_due_soon(self, hours=48):
        if not self.due_date or self.status == "done":
            return False
        now = datetime.now()
        return now <= self.due_date <= now + timedelta(hours=hours)

    def spawn_next_occurrence(self):
        """Create the next occurrence of a recurring task after this one is completed."""
        if not self.is_recurring or not self.recurrence_interval_days:
            return None
        base_date = self.due_date or datetime.now()
        next_due = base_date + timedelta(days=self.recurrence_interval_days)
        next_task = Task(
            category_id=self.category_id,
            title=self.title,
            description=self.description,
            due_date=next_due,
            priority=self.priority,
            estimated_minutes=self.estimated_minutes,
            status="todo",
            is_recurring=True,
            recurrence_interval_days=self.recurrence_interval_days,
        )
        db.session.add(next_task)
        return next_task

    def to_dict(self):
        active = self.active_time_log
        tracked = self.total_tracked_seconds
        actual_minutes = tracked // 60
        return {
            "id": self.id,
            "category_id": self.category_id,
            "title": self.title,
            "description": self.description or "",
            "due_date": _iso(self.due_date),
            "priority": self.priority,
            "estimated_minutes": self.estimated_minutes,
            "status": self.status,
            "is_recurring": self.is_recurring,
            "recurrence_interval_days": self.recurrence_interval_days,
            "total_tracked_seconds": tracked,
            "actual_minutes": actual_minutes,
            "delta_minutes": (
                actual_minutes - self.estimated_minutes
                if self.estimated_minutes is not None
                else None
            ),
            "is_overdue": self.is_overdue,
            "is_due_soon": self.is_due_soon,
            "created_at": _iso(self.created_at),
            "completed_at": _iso(self.completed_at),
            "timer_running": active is not None,
            "timer_start_time": _iso(active.start_time) if active else None,
        }


class TimeLog(db.Model):
    __tablename__ = "time_logs"

    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey("tasks.id"), nullable=False)
    start_time = db.Column(db.DateTime, nullable=False, default=datetime.now)
    end_time = db.Column(db.DateTime, nullable=True)
    # True for time entered by hand (no timer used). Kept alongside `source`
    # because older databases only have this column.
    is_manual = db.Column(db.Boolean, nullable=False, default=False)
    # One of TIME_LOG_SOURCES. NULL on rows written by older versions; see
    # `effective_source`.
    source = db.Column(db.String(20), nullable=True)
    note = db.Column(db.Text, nullable=True)

    @property
    def duration_seconds(self):
        end = self.end_time or datetime.now()
        return max(0, int((end - self.start_time).total_seconds()))

    @property
    def effective_source(self):
        if self.source:
            return self.source
        return "manual" if self.is_manual else "stopwatch"

    def to_dict(self):
        return {
            "id": self.id,
            "task_id": self.task_id,
            "start_time": _iso(self.start_time),
            "end_time": _iso(self.end_time),
            "duration_seconds": self.duration_seconds,
            "is_manual": self.is_manual,
            "source": self.effective_source,
            "note": self.note or "",
        }


class Settings(db.Model):
    """A single-row table holding app-wide preferences."""
    __tablename__ = "settings"

    id = db.Column(db.Integer, primary_key=True)
    # Which weekdays define the "current time period" used for the
    # planned/estimated/actual totals (e.g. Mon-Fri school week).
    period_start_weekday = db.Column(db.Integer, nullable=False, default=0)  # Monday
    period_end_weekday = db.Column(db.Integer, nullable=False, default=6)  # Sunday
    # Shows the destructive Push/Pull "replace the whole database" controls.
    sync_enabled = db.Column(db.Boolean, nullable=False, default=False)

    daily_goal_minutes = db.Column(db.Integer, nullable=False, default=120)
    theme = db.Column(db.String(10), nullable=False, default="system")
    # Read once at startup by desktop/tray_app.py and run.py: when off the
    # server only listens on 127.0.0.1, so other devices can't reach it.
    lan_access_enabled = db.Column(db.Boolean, nullable=False, default=False)
    long_timer_warning_minutes = db.Column(db.Integer, nullable=False, default=180)
    pomodoro_work_minutes = db.Column(db.Integer, nullable=False, default=25)
    pomodoro_short_break_minutes = db.Column(db.Integer, nullable=False, default=5)
    pomodoro_long_break_minutes = db.Column(db.Integer, nullable=False, default=15)
    pomodoro_cycles = db.Column(db.Integer, nullable=False, default=4)
    sound_enabled = db.Column(db.Boolean, nullable=False, default=True)

    @classmethod
    def get(cls):
        settings = db.session.get(cls, 1)
        if settings is None:
            settings = cls(id=1, period_start_weekday=0, period_end_weekday=6)
            db.session.add(settings)
            db.session.commit()
        return settings

    @property
    def period_label(self):
        if self.period_start_weekday == self.period_end_weekday:
            return WEEKDAY_ABBR[self.period_start_weekday]
        return f"{WEEKDAY_ABBR[self.period_start_weekday]}\u2013{WEEKDAY_ABBR[self.period_end_weekday]}"

    def to_dict(self):
        return {
            "period_start_weekday": self.period_start_weekday,
            "period_end_weekday": self.period_end_weekday,
            "period_label": self.period_label,
            "sync_enabled": self.sync_enabled,
            "daily_goal_minutes": self.daily_goal_minutes,
            "theme": self.theme,
            "lan_access_enabled": self.lan_access_enabled,
            "long_timer_warning_minutes": self.long_timer_warning_minutes,
            "pomodoro_work_minutes": self.pomodoro_work_minutes,
            "pomodoro_short_break_minutes": self.pomodoro_short_break_minutes,
            "pomodoro_long_break_minutes": self.pomodoro_long_break_minutes,
            "pomodoro_cycles": self.pomodoro_cycles,
            "sound_enabled": self.sound_enabled,
        }


class FocusTimer(db.Model):
    """Single-row state for the countdown / Pomodoro timer.

    status: "idle", "running", "paused", or "finished" (the phase ran out
    and is waiting for the user to start the next one or dismiss it).
    phase: "work", "short_break", or "long_break" ("work" for plain
    countdowns). While a work phase linked to a task is running, an open
    TimeLog (time_log_id) records the time against that task.
    """
    __tablename__ = "focus_timer"

    id = db.Column(db.Integer, primary_key=True)
    mode = db.Column(db.String(20), nullable=False, default="countdown")
    status = db.Column(db.String(20), nullable=False, default="idle")
    phase = db.Column(db.String(20), nullable=False, default="work")
    task_id = db.Column(db.Integer, nullable=True)
    # Full length of the current phase (for progress display).
    duration_seconds = db.Column(db.Integer, nullable=False, default=0)
    # When the current running segment started, and how long it had left
    # then - pausing/resuming starts a new segment.
    started_at = db.Column(db.DateTime, nullable=True)
    segment_seconds = db.Column(db.Integer, nullable=False, default=0)
    remaining_at_pause = db.Column(db.Integer, nullable=True)
    completed_work_sessions = db.Column(db.Integer, nullable=False, default=0)
    time_log_id = db.Column(db.Integer, nullable=True)
    finished_at = db.Column(db.DateTime, nullable=True)

    @classmethod
    def get(cls):
        timer = db.session.get(cls, 1)
        if timer is None:
            timer = cls(id=1)
            db.session.add(timer)
            db.session.commit()
        return timer

    @property
    def ends_at(self):
        if self.status != "running" or not self.started_at:
            return None
        return self.started_at + timedelta(seconds=self.segment_seconds)

    @property
    def remaining_seconds(self):
        if self.status == "running":
            return max(0, int((self.ends_at - datetime.now()).total_seconds()))
        if self.status == "paused":
            return self.remaining_at_pause or 0
        return 0

    def to_dict(self):
        task = db.session.get(Task, self.task_id) if self.task_id else None
        return {
            "mode": self.mode,
            "status": self.status,
            "phase": self.phase,
            "task_id": task.id if task else None,
            "task_title": task.title if task else None,
            "category_color": task.category.color if task else None,
            "duration_seconds": self.duration_seconds,
            "remaining_seconds": self.remaining_seconds,
            "ends_at": _iso(self.ends_at),
            "finished_at": _iso(self.finished_at),
            "completed_work_sessions": self.completed_work_sessions,
        }
