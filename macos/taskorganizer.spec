# PyInstaller spec for the macOS desktop build.
#
# Build with: pyinstaller macos/taskorganizer.spec
# (build.sh does this for you - see macos/build.sh)
#
# Produces dist/TaskOrganizer.app - a normal double-clickable Mac app with
# a Dock icon, a menu bar icon, and Flask's templates/static folders
# bundled inside it.
import os

block_cipher = None

project_root = os.path.abspath(os.path.join(SPECPATH, ".."))
icon_path = os.path.join(SPECPATH, "icon.icns")

a = Analysis(
    [os.path.join(project_root, "desktop", "tray_app.py")],
    pathex=[project_root],
    binaries=[],
    datas=[
        (os.path.join(project_root, "app", "templates"), os.path.join("app", "templates")),
        (os.path.join(project_root, "app", "static"), os.path.join("app", "static")),
    ],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    cipher=block_cipher,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# Onefile mode isn't supported for macOS .app bundles (PyInstaller warns
# this becomes a hard error in v7+), so this uses the standard onedir +
# COLLECT + BUNDLE approach instead - a folder of files inside
# TaskOrganizer.app/Contents/MacOS, wrapped into a normal double-clickable
# app bundle.
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="TaskOrganizer",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=icon_path if os.path.exists(icon_path) else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="TaskOrganizer",
)

# No LSUIElement key here on purpose - leaving it unset keeps the normal
# Dock icon in addition to the menu bar icon that pystray adds at runtime.
app = BUNDLE(
    coll,
    name="TaskOrganizer.app",
    icon=icon_path if os.path.exists(icon_path) else None,
    bundle_identifier="com.taskorganizer.app",
    info_plist={
        "CFBundleName": "Task Organizer",
        "CFBundleDisplayName": "Task Organizer",
        "CFBundleShortVersionString": "1.0.0",
        "CFBundleVersion": "1.0.0",
        "NSHighResolutionCapable": True,
    },
)
