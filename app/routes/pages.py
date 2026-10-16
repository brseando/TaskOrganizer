"""HTML entry points."""
from flask import Blueprint, redirect, render_template

from app.models import Settings

bp = Blueprint("pages", __name__)


@bp.route("/__taskorganizer_ping")
def ping():
    """Lets desktop/tray_app.py tell whether a port is running *this* app
    (vs. something unrelated, like macOS's AirPlay Receiver on 5000)."""
    return "task-organizer-ok", 200


@bp.route("/")
def index():
    return render_template("app.html", theme=Settings.get().theme)


@bp.route("/manage")
def manage():
    return redirect("/#/tasks")
