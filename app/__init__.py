"""Flask application factory for the Task Organizer."""
import os
import platform
import sys

from flask import Flask

from app.extensions import db


def _instance_path(is_frozen):
    """Where tasks.db lives.

    TASKORGANIZER_DATA_DIR overrides everything (used for testing against a
    copy of a database). Otherwise, in the packaged app, PyInstaller's
    temporary extraction directory would be wiped after the app closes, so
    the database needs a persistent writable location, which differs by OS.
    """
    override = os.environ.get("TASKORGANIZER_DATA_DIR")
    if override:
        return os.path.abspath(override)
    if not is_frozen:
        return None
    if platform.system() == "Darwin":
        # Unsigned .app bundles launched from Downloads/Mail/AirDrop run from
        # a randomized read-only mirror ("app translocation") until moved,
        # so writing next to the app is unreliable. Application Support is
        # always writable and is the Mac-standard place for this.
        return os.path.join(os.path.expanduser("~/Library/Application Support"), "TaskOrganizer")
    # Windows exe: keep the database next to it, so it travels with the folder.
    return os.path.join(os.path.dirname(sys.executable), "instance")


def create_app():
    is_frozen = getattr(sys, "frozen", False)
    instance_path = _instance_path(is_frozen)
    if instance_path:
        app = Flask(__name__, instance_relative_config=True, instance_path=instance_path)
    else:
        app = Flask(__name__, instance_relative_config=True)

    app.config["IS_FROZEN"] = is_frozen

    os.makedirs(app.instance_path, exist_ok=True)
    db_path = os.path.join(app.instance_path, "tasks.db")

    app.config["DB_PATH"] = db_path
    app.config["PROJECT_ROOT"] = os.path.dirname(app.root_path)
    app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{db_path}"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.json.sort_keys = False
    # No accounts/auth in this app, so a fixed local secret is fine.
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "taskorganizer-local-secret")

    db.init_app(app)

    from app import models  # noqa: F401  (ensures models are registered)
    from app.routes import register_blueprints
    from app.schema import upgrade_database

    register_blueprints(app)

    with app.app_context():
        upgrade_database(db_path)

    return app
