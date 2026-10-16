"""Data for the Insights view."""
from datetime import date, timedelta

from flask import Blueprint, jsonify, request

from app import stats
from app.models import Settings
from app.routes.common import parse_int

bp = Blueprint("api_stats", __name__, url_prefix="/api")

MAX_RANGE_DAYS = 366


@bp.route("/stats")
def insights():
    """Range: ?start=&end= (YYYY-MM-DD), ?period=configured for the
    configured weekday period, or ?days=N ending today (default 14)."""
    settings = Settings.get()
    today = date.today()

    start = stats.parse_date(request.args.get("start"))
    end = stats.parse_date(request.args.get("end"))
    if request.args.get("period") == "configured":
        period_start, period_end = stats.current_period_bounds(
            settings.period_start_weekday, settings.period_end_weekday
        )
        start, end = period_start.date(), (period_end - timedelta(days=1)).date()
    elif not (start and end):
        days = parse_int(request.args.get("days"), minimum=1, maximum=MAX_RANGE_DAYS) or 14
        start, end = today - timedelta(days=days - 1), today

    if end < start:
        start, end = end, start
    if (end - start).days >= MAX_RANGE_DAYS:
        start = end - timedelta(days=MAX_RANGE_DAYS - 1)

    return jsonify(stats.build_insights(start, end, settings))


@bp.route("/stats/daily")
def daily():
    """{date: seconds} for a date range (the Calendar view's daily totals)."""
    start = stats.parse_date(request.args.get("start"))
    end = stats.parse_date(request.args.get("end"))
    if not (start and end) or end < start or (end - start).days >= MAX_RANGE_DAYS:
        return jsonify({"days": {}})
    totals = stats.daily_totals(start, end)
    return jsonify({"days": {d.isoformat(): secs for d, secs in totals.items()}})
