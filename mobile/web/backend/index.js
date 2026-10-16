// Entry point of the on-device backend. The shared UI (app/static/js/core.js)
// calls localApi() instead of fetch() when it's installed, so every screen
// works the same as on the desktop, with the data kept on this device.
//
// Returns { status, data } for JSON, or { status, file: { blob, filename } }
// for downloads.

import { fileStamp } from "./dates.js";
import { HttpError, match } from "./routes.js";
import { exportSqlite, importSqlite } from "./sqlite.js";
import { BEFORE_LAST_LOAD, exists, loadDatabase, read, saveDatabase, upgrade, withLock, write } from "./storage.js";
import { syncFocusTimer } from "./timers.js";

function payload(body) {
  if (body instanceof FormData) return Object.fromEntries(body.entries());
  return body && typeof body === "object" ? body : {};
}

// ---------------------------------------------------------------------------
// Backups (the on-device side of api_settings.py)
// ---------------------------------------------------------------------------

async function downloadBackup(db, now) {
  const bytes = await exportSqlite(db);
  return {
    file: {
      blob: new Blob([bytes], { type: "application/x-sqlite3" }),
      filename: `tasks-backup-${fileStamp(now)}.db`,
    },
  };
}

/** Pull: replace everything with an uploaded tasks.db (from a phone or a computer). */
async function loadBackup(db, data) {
  if (!db.settings.sync_enabled) {
    throw new HttpError("Database sync is turned off. Enable it in Settings first.", 403);
  }
  const file = data.db_file;
  if (!(file instanceof Blob) || !file.size) throw new HttpError("Choose a database file to pull.");
  let incoming;
  try {
    incoming = await importSqlite(new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    throw new HttpError(err.message);
  }
  await write(BEFORE_LAST_LOAD, db);
  await saveDatabase(incoming);
  return { ok: true };
}

/** Swap back to the data from before the last Pull (doing it twice redoes the Pull). */
async function undoLoad(db) {
  const previous = await read(BEFORE_LAST_LOAD);
  if (!previous) throw new HttpError("There's no earlier copy to go back to.", 404);
  await write(BEFORE_LAST_LOAD, db);
  await saveDatabase(upgrade(previous));
  return { ok: true };
}

const SPECIAL_ROUTES = {
  "GET /api/backup/database": ({ db, now }) => downloadBackup(db, now),
  "POST /api/database/pull": ({ db, data }) => loadBackup(db, data),
  "POST /api/database/undo-load": ({ db }) => undoLoad(db),
};

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

export function localApi(method, url, body) {
  const parsed = new URL(url, "http://local");
  const path = parsed.pathname;
  return withLock(async () => {
    const db = await loadDatabase();
    // Finish a focus phase that ran out while the app was closed (the
    // desktop server does this before every request).
    if (syncFocusTimer(db, Date.now())) await saveDatabase(db);

    const ctx = {
      db,
      now: Date.now(),
      query: parsed.searchParams,
      data: payload(body),
      info: { canUndoLoad: path === "/api/state" && (await exists(BEFORE_LAST_LOAD)) },
    };

    try {
      const special = SPECIAL_ROUTES[`${method} ${path}`];
      if (special) {
        const result = await special(ctx);
        return result.file ? { status: 200, file: result.file } : { status: 200, data: result };
      }
      const route = match(method, path);
      if (!route) return { status: 404, data: { ok: false, error: "That isn't available in the phone version." } };
      const result = route.handler({ ...ctx, params: route.params });
      if (method !== "GET") await saveDatabase(db);
      return result.file ? { status: 200, file: result.file } : { status: 200, data: result };
    } catch (err) {
      if (err instanceof HttpError) return { status: err.status, data: { ok: false, error: err.message } };
      throw err;
    }
  });
}
