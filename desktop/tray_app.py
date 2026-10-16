"""Shared desktop entry point for Task Organizer (Windows and macOS).

This is what `windows/taskorganizer.spec` and `macos/taskorganizer.spec`
package with PyInstaller into `TaskOrganizer.exe` / `TaskOrganizer.app`.
All OS differences (data location, bundle vs. single exe) are handled by the
spec files and `app/__init__.py`. Launching the app:

- Starts the Flask app in a background thread. By default it only listens
  on 127.0.0.1, so nothing else on the network can reach it. If "Allow
  access from other devices" is turned on in Settings, it listens on
  0.0.0.0 instead (read once at startup, so changing it needs a restart),
  which lets a phone on the same WiFi open it - and triggers a one-time
  firewall "allow incoming connections?" prompt. There's no login, so
  anyone who can reach it then has full access.
- Opens the default browser once.
- Shows a tray/menu-bar icon (open the app, open the Focus timer, stop the
  running timer, quit), so the app keeps running after the browser tab is
  closed and can be shut down cleanly.
- If the app is already running (double-clicked a second time), it just
  reopens the browser instead of starting a second server.

Picking a port: 5000 is preferred, but something else may hold it (notably
macOS's AirPlay Receiver), so a small range is probed, and a port only
counts as "already running" if it answers our own `/__taskorganizer_ping`.

Can also be run directly with `python desktop/tray_app.py`.
"""
import os
import sys

# Windowed builds (console=False) have no real stdout/stderr; writing to them
# can raise or block forever and hang request handling. Redirect both
# before importing anything that might set up logging handlers.
if getattr(sys, "frozen", False):
    _null = open(os.devnull, "w")
    sys.stdout = _null
    sys.stderr = _null

import socket  # noqa: E402
import threading  # noqa: E402
import urllib.error  # noqa: E402
import urllib.request  # noqa: E402
import webbrowser  # noqa: E402
from pathlib import Path  # noqa: E402

from PIL import Image, ImageDraw  # noqa: E402
from pystray import Icon, Menu, MenuItem  # noqa: E402
from werkzeug.serving import make_server  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import create_app  # noqa: E402
from app.extensions import db  # noqa: E402
from app.models import Settings  # noqa: E402
from app.timers import active_log, stop_all_active_timers  # noqa: E402

# How this machine talks to its own server (single-instance probe and the
# browser tab we open). Loopback reaches a server bound to either 127.0.0.1
# or 0.0.0.0.
LOCAL_HOST = "127.0.0.1"
LAN_HOST = "0.0.0.0"

PORT_RANGE = range(5000, 5020)
PING_PATH = "/__taskorganizer_ping"
PING_MARKER = b"task-organizer-ok"
TIMER_POLL_SECONDS = 4


def _url_for(port, path="/"):
    return f"http://{LOCAL_HOST}:{port}{path}"


def _probe_port(port):
    """True if *our* app (not some unrelated service) is answering on this port."""
    try:
        with urllib.request.urlopen(_url_for(port, PING_PATH), timeout=0.4) as resp:
            return resp.status == 200 and PING_MARKER in resp.read()
    except (urllib.error.URLError, OSError, TimeoutError):
        return False


def _find_running_instance():
    for port in PORT_RANGE:
        if _probe_port(port):
            return port
    return None


def _can_bind(host, port):
    """Pre-check availability ourselves: werkzeug's make_server() calls
    sys.exit(1) on EADDRINUSE instead of raising.

    Deliberately no SO_REUSEADDR: on macOS it lets a wildcard bind succeed
    even when AirPlay Receiver holds the port, and connections then get
    split unpredictably between the two listeners.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind((host, port))
            return True
        except OSError:
            return False


def _make_icon_image():
    """A simple checklist-style icon, so no bundled asset is needed."""
    size = 64
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((4, 4, size - 4, size - 4), radius=12, fill=(37, 99, 235, 255))
    line_x0, line_x1 = 16, size - 16
    for y in (20, 32, 44):
        draw.line((line_x0, y, line_x1, y), fill=(255, 255, 255, 255), width=5)
    return image


class TrayApp:
    def __init__(self):
        self.flask_app = create_app()
        with self.flask_app.app_context():
            lan_enabled = Settings.get().lan_access_enabled
        self.bind_host = LAN_HOST if lan_enabled else LOCAL_HOST
        self.port, self.server = self._bind_server()
        # Lets the Settings page show the real address/port in use.
        self.flask_app.config["PORT"] = self.port
        self.flask_app.config["BIND_HOST"] = self.bind_host
        self.base_url = _url_for(self.port)
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.icon = None
        self.timer_running = False
        self._stop_polling = threading.Event()

    def _bind_server(self):
        for port in PORT_RANGE:
            if _can_bind(self.bind_host, port):
                # threaded=True: one slow/idle client connection would
                # otherwise block every other request, including our own
                # ping checks from later launches.
                return port, make_server(self.bind_host, port, self.flask_app, threaded=True)
        raise RuntimeError(
            f"Could not find a free port in {PORT_RANGE.start}-{PORT_RANGE.stop - 1}"
        )

    def start(self):
        self.server_thread.start()
        webbrowser.open(self.base_url)

        menu = Menu(
            MenuItem("Open Task Organizer", self._open_app, default=True),
            MenuItem("Open Focus timer", self._open_focus),
            MenuItem(
                "Stop running timer",
                self._stop_timer,
                visible=lambda item: self.timer_running,
            ),
            Menu.SEPARATOR,
            MenuItem("Quit", self._quit),
        )
        self.icon = Icon("TaskOrganizer", _make_icon_image(), "Task Organizer", menu)
        threading.Thread(target=self._poll_timer_state, daemon=True).start()
        self.icon.run()

    def _check_timer_running(self):
        with self.flask_app.app_context():
            running = active_log() is not None
            db.session.remove()
        return running

    def _poll_timer_state(self):
        """Some tray backends (Windows) only rebuild the menu on update_menu(),
        so refresh it whenever a timer starts or stops."""
        while not self._stop_polling.wait(TIMER_POLL_SECONDS):
            try:
                running = self._check_timer_running()
            except Exception:  # noqa: BLE001 - never let the poller kill the app
                continue
            if running != self.timer_running and self.icon is not None:
                self.timer_running = running
                self.icon.update_menu()

    def _open_app(self, icon=None, item=None):
        webbrowser.open(self.base_url)

    def _open_focus(self, icon=None, item=None):
        webbrowser.open(self.base_url + "#/focus")

    def _stop_timer(self, icon=None, item=None):
        with self.flask_app.app_context():
            stop_all_active_timers()
            db.session.commit()
            db.session.remove()
        self.timer_running = False
        if self.icon is not None:
            self.icon.update_menu()

    def _quit(self, icon=None, item=None):
        self._stop_polling.set()
        self.server.shutdown()
        self.server_thread.join(timeout=5)
        if self.icon is not None:
            self.icon.stop()


def main():
    existing_port = _find_running_instance()
    if existing_port is not None:
        webbrowser.open(_url_for(existing_port))
        return
    TrayApp().start()


if __name__ == "__main__":
    main()
