"""Blueprint registration.

- pages: the single-page app shell, the /manage redirect, the ping route.
- api_tasks: the /api/state snapshot plus category and task CRUD.
- api_time: stopwatch, focus timer (countdown / Pomodoro), time log editing.
- api_stats: Insights data.
- api_settings: settings, backups, database sync, CSV export.
"""


def register_blueprints(app):
    from app.routes import api_settings, api_stats, api_tasks, api_time, pages

    for module in (pages, api_tasks, api_time, api_stats, api_settings):
        app.register_blueprint(module.bp)
