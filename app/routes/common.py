"""Small helpers shared by the route modules."""
import socket
from datetime import datetime

from flask import current_app, jsonify, request


def payload():
    """Request data as a dict, from a JSON body or a form post."""
    data = request.get_json(silent=True)
    if isinstance(data, dict):
        return data
    return request.form.to_dict()


def parse_int(value, minimum=None, maximum=None):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    if minimum is not None and number < minimum:
        return None
    if maximum is not None and number > maximum:
        return None
    return number


def parse_bool(value):
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("1", "true", "on", "yes")


def combine_date_time(date_value, time_value):
    """Combine a date input value and a time input value into a datetime,
    defaulting the time to end-of-day. None if no date was chosen."""
    if not date_value:
        return None
    time_value = time_value or "23:59"
    try:
        return datetime.fromisoformat(f"{date_value}T{time_value}")
    except ValueError:
        return None


def json_ok(**extra):
    return jsonify({"ok": True, **extra})


def json_error(message, status=400):
    return jsonify({"ok": False, "error": message}), status


def local_ip():
    """Best-effort LAN IP for this machine (None if the network is down).

    Connecting a UDP socket sends no packets; it just makes the OS pick the
    outgoing interface, whose address we then read.
    """
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.settimeout(0.5)
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
    except OSError:
        try:
            ip = socket.gethostbyname(socket.gethostname())
            return None if ip.startswith("127.") else ip
        except OSError:
            return None


def network_info(settings):
    port = current_app.config.get("PORT") or request.environ.get("SERVER_PORT") or 5000
    bind_host = current_app.config.get("BIND_HOST")
    return {
        "hostname": socket.gethostname(),
        "ip": local_ip(),
        "port": int(port),
        "lan_setting": settings.lan_access_enabled,
        # What the running server is actually listening on; differs from the
        # setting until the app is restarted. None when started some other way.
        "lan_active": bind_host == "0.0.0.0" if bind_host else None,
    }
