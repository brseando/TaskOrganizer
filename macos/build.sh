#!/bin/bash
# One-time build script - run this on a Mac with Python 3 installed to
# produce dist/TaskOrganizer.app (and a zipped copy ready to send).
#
# Run it from a terminal:
#     bash macos/build.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -x ".venv/bin/python3" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
fi

echo "Installing dependencies..."
".venv/bin/python3" -m pip install --upgrade pip
".venv/bin/python3" -m pip install -r requirements.txt
".venv/bin/python3" -m pip install pyinstaller

echo
echo "Generating app icon..."
".venv/bin/python3" macos/make_icon.py

echo
echo "Building TaskOrganizer.app (this can take a minute)..."
".venv/bin/python3" -m PyInstaller macos/taskorganizer.spec --noconfirm

echo
echo "Zipping the app for distribution..."
rm -f dist/TaskOrganizer.zip
ditto -c -k --sequesterRsrc --keepParent dist/TaskOrganizer.app dist/TaskOrganizer.zip

echo
echo "============================================================"
echo "Done! The app is at dist/TaskOrganizer.app"
echo "A ready-to-send zip is at dist/TaskOrganizer.zip - send that"
echo "to anyone who wants to run it, they don't need Python or"
echo "anything else installed."
echo "============================================================"
