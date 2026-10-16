"""Time-tracking aggregation: per-day totals, periods, streaks, accuracy.

All day-based totals clip each session to the day(s) it actually covers, so
a session from 11pm to 1am counts one hour towards each day.
"""
from collections import defaultdict
from datetime import date, datetime, time as dtime, timedelta

from app.extensions import db
from app.models import Category, Task, TimeLog, WEEKDAY_ABBR

HEATMAP_WEEKS = 26


def format_day(d):
    # Built by hand because "%-d" (no leading zero) isn't supported on Windows.
    return f"{d:%b} {d.day}"


def day_start(d):
    return datetime.combine(d, dtime.min)


def parse_date(value):
    try:
        return date.fromisoformat((value or "").strip())
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Periods
# ---------------------------------------------------------------------------

def current_period_bounds(start_weekday, end_weekday, today=None):
    """Return (start, end_exclusive) datetimes for the configured weekday
    period (0=Monday..6=Sunday) that contains today - or, if today falls
    outside it (e.g. Saturday with a Mon-Fri period), the upcoming one.
    """
    today = today or date.today()
    length_days = (end_weekday - start_weekday) % 7 + 1
    days_since_start = (today.weekday() - start_weekday) % 7

    period_start = today - timedelta(days=days_since_start)
    if days_since_start >= length_days:
        period_start += timedelta(days=7)

    return day_start(period_start), day_start(period_start + timedelta(days=length_days))


def resolve_period(start_str, end_str, settings):
    """Return (period_start, period_end_exclusive, label, is_custom).

    An explicit start/end (YYYY-MM-DD) overrides the configured period.
    """
    start_date = parse_date(start_str)
    end_date = parse_date(end_str)
    if start_date and end_date:
        if end_date < start_date:
            start_date, end_date = end_date, start_date
        if start_date == end_date:
            label = format_day(start_date)
        else:
            label = f"{format_day(start_date)}\u2013{format_day(end_date)}"
        return day_start(start_date), day_start(end_date + timedelta(days=1)), label, True

    period_start, period_end = current_period_bounds(
        settings.period_start_weekday, settings.period_end_weekday
    )
    return period_start, period_end, settings.period_label, False


# ---------------------------------------------------------------------------
# Daily totals
# ---------------------------------------------------------------------------

def _split_by_day(start, end):
    """Yield (date, seconds) for each calendar day the interval touches."""
    cursor = start
    while cursor < end:
        next_midnight = day_start(cursor.date() + timedelta(days=1))
        chunk_end = min(end, next_midnight)
        yield cursor.date(), (chunk_end - cursor).total_seconds()
        cursor = chunk_end


def _logs_overlapping(range_start, range_end):
    """(TimeLog, category_id) pairs for every session overlapping the range."""
    return (
        db.session.query(TimeLog, Task.category_id)
        .join(Task, TimeLog.task_id == Task.id)
        .filter(TimeLog.start_time < range_end)
        .filter(db.or_(TimeLog.end_time.is_(None), TimeLog.end_time > range_start))
        .all()
    )


def seconds_by_day_and_category(range_start, range_end):
    """{date: {category_id: seconds}} for time inside [range_start, range_end)."""
    now = datetime.now()
    result = defaultdict(lambda: defaultdict(float))
    for log, category_id in _logs_overlapping(range_start, range_end):
        start = max(log.start_time, range_start)
        end = min(log.end_time or now, range_end)
        for day, seconds in _split_by_day(start, end):
            result[day][category_id] += seconds
    return result


def seconds_by_category(range_start, range_end):
    totals = defaultdict(float)
    for by_cat in seconds_by_day_and_category(range_start, range_end).values():
        for cat_id, seconds in by_cat.items():
            totals[cat_id] += seconds
    return {cat_id: int(secs) for cat_id, secs in totals.items()}


def daily_totals(start_date, end_date):
    """{date: seconds} for every day from start_date to end_date inclusive."""
    raw = seconds_by_day_and_category(day_start(start_date), day_start(end_date + timedelta(days=1)))
    totals = {}
    d = start_date
    while d <= end_date:
        totals[d] = int(sum(raw.get(d, {}).values()))
        d += timedelta(days=1)
    return totals


def _all_time_daily_totals():
    first = db.session.query(db.func.min(TimeLog.start_time)).scalar()
    today = date.today()
    if not first:
        return {today: 0}
    return daily_totals(min(first.date(), today), today)


def streaks(goal_seconds, totals=None):
    """Current and longest run of consecutive days meeting the daily goal.

    Today only extends the current streak once it's met; not having met it
    yet doesn't break a streak that ran through yesterday.
    """
    totals = totals if totals is not None else _all_time_daily_totals()
    if goal_seconds <= 0:
        return {"current": 0, "longest": 0}

    longest = run = 0
    for d in sorted(totals):
        run = run + 1 if totals[d] >= goal_seconds else 0
        longest = max(longest, run)

    today = date.today()
    current = 0
    d = today if totals.get(today, 0) >= goal_seconds else today - timedelta(days=1)
    while totals.get(d, 0) >= goal_seconds:
        current += 1
        d -= timedelta(days=1)

    return {"current": current, "longest": longest}


def today_summary(settings):
    today = date.today()
    totals = _all_time_daily_totals()
    last_7 = [totals.get(today - timedelta(days=i), 0) for i in range(1, 8)]
    today_by_cat = seconds_by_category(day_start(today), day_start(today + timedelta(days=1)))
    goal_seconds = settings.daily_goal_minutes * 60
    return {
        "today_seconds": totals.get(today, 0),
        "yesterday_seconds": totals.get(today - timedelta(days=1), 0),
        "avg_7_seconds": int(sum(last_7) / 7),
        "today_by_category": today_by_cat,
        "goal_seconds": goal_seconds,
        "streak": streaks(goal_seconds, totals),
    }


# ---------------------------------------------------------------------------
# Planned / estimated / actual totals for a period (per category)
# ---------------------------------------------------------------------------

def period_totals(period_start, period_end, categories):
    """Per-category and overall minutes for the period:

    - estimated: estimates of still-open tasks due in the period (shrinks as
      tasks get done - "what's left").
    - planned: estimates of every task due in the period, done or not (a
      stable total to compare against actual).
    - actual: tracked time inside the period, regardless of due dates.
    """
    actual_by_cat = seconds_by_category(period_start, period_end)
    per_category = {}
    totals = {"estimated": 0, "planned": 0, "actual": 0}
    for cat in categories:
        in_period = [t for t in cat.tasks if t.due_date and period_start <= t.due_date < period_end]
        estimated = sum(t.estimated_minutes or 0 for t in in_period if t.status != "done")
        planned = sum(t.estimated_minutes or 0 for t in in_period)
        actual = actual_by_cat.get(cat.id, 0) // 60
        per_category[cat.id] = {"estimated": estimated, "planned": planned, "actual": actual}
        totals["estimated"] += estimated
        totals["planned"] += planned
        totals["actual"] += actual
    return per_category, totals


# ---------------------------------------------------------------------------
# Estimate accuracy
# ---------------------------------------------------------------------------

def _accuracy_summary(tasks):
    rows = []
    for t in tasks:
        actual_minutes = t.total_tracked_seconds / 60
        rows.append((t.estimated_minutes, actual_minutes))
    if not rows:
        return None
    pct_diffs = [(actual - est) / est * 100 for est, actual in rows]
    return {
        "count": len(rows),
        "avg_pct_diff": round(sum(pct_diffs) / len(pct_diffs)),
        "total_estimated_minutes": int(sum(est for est, _ in rows)),
        "total_actual_minutes": int(sum(actual for _, actual in rows)),
        "within_10pct": sum(1 for p in pct_diffs if abs(p) <= 10),
        "over": sum(1 for p in pct_diffs if p > 10),
        "under": sum(1 for p in pct_diffs if p < -10),
    }


def estimate_accuracy():
    """How tracked time compared to estimates on completed tasks.

    Only tasks with both an estimate and some tracked time count - an
    untracked task would otherwise read as "100% under".
    """
    done = Task.query.filter(Task.status == "done", Task.estimated_minutes > 0).all()
    measured = [t for t in done if t.total_tracked_seconds > 0]

    by_category = []
    for cat in Category.query.order_by(Category.name).all():
        summary = _accuracy_summary([t for t in measured if t.category_id == cat.id])
        if summary:
            by_category.append({"id": cat.id, "name": cat.name, "color": cat.color, **summary})

    recent = sorted(measured, key=lambda t: t.completed_at or datetime.min, reverse=True)[:10]
    return {
        "overall": _accuracy_summary(measured),
        "untracked_count": len(done) - len(measured),
        "by_category": by_category,
        "recent": [
            {
                "id": t.id,
                "title": t.title,
                "category_color": t.category.color,
                "estimated_minutes": t.estimated_minutes,
                "actual_minutes": t.total_tracked_seconds // 60,
                "completed_at": t.completed_at.isoformat(timespec="seconds") if t.completed_at else None,
            }
            for t in recent
        ],
    }


# ---------------------------------------------------------------------------
# Full Insights payload
# ---------------------------------------------------------------------------

def build_insights(start_date, end_date, settings):
    today = date.today()
    categories = Category.query.order_by(Category.kind, Category.name).all()
    cat_lookup = {c.id: c for c in categories}

    range_start = day_start(start_date)
    range_end = day_start(end_date + timedelta(days=1))
    raw = seconds_by_day_and_category(range_start, range_end)

    days = []
    d = start_date
    while d <= end_date:
        by_cat = {cat_id: int(secs) for cat_id, secs in raw.get(d, {}).items()}
        days.append({"date": d.isoformat(), "total": sum(by_cat.values()), "by_category": by_cat})
        d += timedelta(days=1)

    # Averages only count days that have actually happened.
    elapsed_days = [day for day in days if date.fromisoformat(day["date"]) <= today]
    total_seconds = sum(day["total"] for day in days)
    active_days = sum(1 for day in days if day["total"] > 0)
    best = max(days, key=lambda day: day["total"]) if days else None
    goal_seconds = settings.daily_goal_minutes * 60

    cat_totals = defaultdict(int)
    for day in days:
        for cat_id, secs in day["by_category"].items():
            cat_totals[cat_id] += secs
    breakdown = [
        {
            "id": cat_id,
            "name": cat_lookup[cat_id].name if cat_id in cat_lookup else "Deleted",
            "color": cat_lookup[cat_id].color if cat_id in cat_lookup else "#888888",
            "seconds": secs,
            "share": (secs / total_seconds) if total_seconds else 0,
        }
        for cat_id, secs in sorted(cat_totals.items(), key=lambda kv: kv[1], reverse=True)
    ]

    weekday_sums = [0] * 7
    weekday_counts = [0] * 7
    for day in elapsed_days:
        wd = date.fromisoformat(day["date"]).weekday()
        weekday_sums[wd] += day["total"]
        weekday_counts[wd] += 1
    weekday_avg = [
        {"label": WEEKDAY_ABBR[i], "seconds": int(weekday_sums[i] / weekday_counts[i]) if weekday_counts[i] else 0}
        for i in range(7)
    ]

    all_totals = _all_time_daily_totals()
    heat_end = today
    heat_start = heat_end - timedelta(days=HEATMAP_WEEKS * 7 - 1)
    heat_start -= timedelta(days=heat_start.weekday())  # align to Monday
    heatmap = []
    d = heat_start
    while d <= heat_end:
        heatmap.append({"date": d.isoformat(), "seconds": all_totals.get(d, 0)})
        d += timedelta(days=1)

    last_7 = [all_totals.get(today - timedelta(days=i), 0) for i in range(1, 8)]
    last_30 = [all_totals.get(today - timedelta(days=i), 0) for i in range(1, 31)]

    return {
        "range": {
            "start": start_date.isoformat(),
            "end": end_date.isoformat(),
            "label": f"{format_day(start_date)}\u2013{format_day(end_date)}",
        },
        "categories": [c.to_dict() for c in categories],
        "days": days,
        "summary": {
            "total_seconds": total_seconds,
            "active_days": active_days,
            "elapsed_days": len(elapsed_days),
            "avg_per_day_seconds": int(total_seconds / len(elapsed_days)) if elapsed_days else 0,
            "avg_per_active_day_seconds": int(total_seconds / active_days) if active_days else 0,
            "best_day": best if best and best["total"] > 0 else None,
            "goal_met_days": sum(1 for day in elapsed_days if goal_seconds and day["total"] >= goal_seconds),
        },
        "comparisons": {
            "today_seconds": all_totals.get(today, 0),
            "yesterday_seconds": all_totals.get(today - timedelta(days=1), 0),
            "avg_7_seconds": int(sum(last_7) / 7),
            "avg_30_seconds": int(sum(last_30) / 30),
        },
        "goal_seconds": goal_seconds,
        "streak": streaks(goal_seconds, all_totals),
        "breakdown": breakdown,
        "weekday_avg": weekday_avg,
        "heatmap": heatmap,
        "accuracy": estimate_accuracy(),
    }
