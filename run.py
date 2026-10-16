"""Plain development entry point: `python run.py`.

Listens on 127.0.0.1 only, unless "Allow access from other devices" is
turned on in Settings (then 0.0.0.0, so a phone on the same WiFi can reach
it). The setting is read at startup, so restart after changing it.
Environment variables: PORT (default 5000), FLASK_DEBUG=1,
TASKORGANIZER_DATA_DIR (use a database in another folder).
"""
import os

from app import create_app
from app.models import Settings

app = create_app()

if __name__ == "__main__":
    with app.app_context():
        host = "0.0.0.0" if Settings.get().lan_access_enabled else "127.0.0.1"
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    port = int(os.environ.get("PORT", "5000"))
    app.config["PORT"] = port
    app.config["BIND_HOST"] = host
    app.run(host=host, port=port, debug=debug)
