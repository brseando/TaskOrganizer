"""Builds the iPhone/Android app into mobile/dist/.

The phone version is an installable web app ("Add to Home Screen") that
reuses the desktop app's screens. This script assembles it:

- mobile/web/*            -> dist/          (phone-only files: boot script,
                                             on-device backend, icons, ...)
- app/static/*            -> dist/static/   (the shared UI: views, styles)
- app/templates/app.html  -> dist/index.html (same page shell, pointed at
                                             the phone files)
- mobile/web/sw.js        -> dist/sw.js     (with this build's file list)

Usage:
    python mobile/build.py          build into mobile/dist/
    python mobile/build.py --serve  build, then serve it at http://localhost:8000

Only the Python standard library is needed. GitHub Actions runs this on
every push (see .github/workflows/publish-phone-app.yml).
"""
import argparse
import functools
import hashlib
import http.server
import json
import re
import shutil
import socket
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "mobile" / "web"
DIST = ROOT / "mobile" / "dist"
SHARED_STATIC = ROOT / "app" / "static"
TEMPLATE = ROOT / "app" / "templates" / "app.html"

# Added to the shared page's <head>: home-screen app metadata, phone styles,
# and the saved theme applied before first paint (the desktop server does
# that part in the template).
HEAD_EXTRAS = """\
  <meta name="theme-color" content="#2563eb">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="Tasks">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
  <link rel="stylesheet" href="mobile.css">
  <script>
    try {
      const theme = localStorage.getItem("taskorganizer.theme");
      if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
    } catch {}
  </script>
"""


def _replace_once(text, pattern, replacement, what):
    new_text, count = re.subn(pattern, replacement, text, count=1)
    if count != 1:
        raise SystemExit(f"build.py: couldn't find the {what} in {TEMPLATE.relative_to(ROOT)}. Update build.py to match it.")
    return new_text


def render_index():
    """The desktop page shell, minus the Flask template tags, plus the phone extras."""
    html = TEMPLATE.read_text(encoding="utf-8")
    html = _replace_once(html, r"\{% if theme.*?%\}.*?\{% endif %\}", "", "theme attribute")
    html = _replace_once(
        html,
        r'<meta name="viewport" content="[^"]*">',
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
        "viewport tag",
    )
    html = _replace_once(
        html,
        r"""<script type="module" src="\{\{ url_for\('static', filename='js/main.js'\) \}\}"></script>""",
        '<script type="module" src="boot.js"></script>',
        "main.js script tag",
    )
    html = re.sub(r"""\{\{ url_for\('static', filename='([^']+)'\) \}\}""", r"static/\1", html)
    html = _replace_once(html, r"</head>", HEAD_EXTRAS + "</head>", "</head> tag")
    if "{{" in html or "{%" in html:
        raise SystemExit("build.py: the page shell has template tags this script doesn't know how to handle.")
    return html


def build():
    if DIST.exists():
        shutil.rmtree(DIST)
    shutil.copytree(WEB, DIST, ignore=shutil.ignore_patterns("sw.js", ".DS_Store"))
    shutil.copytree(SHARED_STATIC, DIST / "static", ignore=shutil.ignore_patterns(".DS_Store"))
    (DIST / "index.html").write_text(render_index(), encoding="utf-8")

    files = sorted(p.relative_to(DIST).as_posix() for p in DIST.rglob("*") if p.is_file())
    digest = hashlib.sha256()
    for name in files:
        digest.update(name.encode())
        digest.update((DIST / name).read_bytes())
    version = digest.hexdigest()[:12]

    sw = (WEB / "sw.js").read_text(encoding="utf-8")
    sw = sw.replace("__BUILD_VERSION__", version).replace("__PRECACHE_FILES__", json.dumps(["./", *files], indent=2))
    (DIST / "sw.js").write_text(sw, encoding="utf-8")

    print(f"Built the phone app ({len(files) + 1} files, version {version}) in {DIST.relative_to(ROOT)}/")


def _lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
    except OSError:
        return None


def serve(port):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(DIST))
    handler.extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".webmanifest": "application/manifest+json", ".wasm": "application/wasm"}
    server = http.server.ThreadingHTTPServer(("0.0.0.0", port), handler)
    print(f"\nServing on http://localhost:{port}  (Ctrl+C to stop)")
    ip = _lan_ip()
    if ip:
        print(f"On a phone on the same WiFi: http://{ip}:{port}")
        print("(Good for a quick look. Installing and offline use need the HTTPS link from GitHub Pages.)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--serve", action="store_true", help="serve the built app after building")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    build()
    if args.serve:
        serve(args.port)


if __name__ == "__main__":
    main()
