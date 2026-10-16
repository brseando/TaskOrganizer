# PyInstaller spec for the Windows desktop build.
#
# Build with: pyinstaller windows/taskorganizer.spec
# (run.bat does this for you - see windows/build.bat)
#
# Produces a single dist/TaskOrganizer.exe with no console window, a tray
# icon, and Flask's templates/static folders bundled inside it.
import os

block_cipher = None

project_root = os.path.abspath(os.path.join(SPECPATH, ".."))
icon_path = os.path.join(SPECPATH, "icon.ico")

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

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="TaskOrganizer",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=icon_path if os.path.exists(icon_path) else None,
)
