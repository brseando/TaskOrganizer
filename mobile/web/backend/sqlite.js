// Converts between the on-device data and the desktop app's tasks.db file
// (SQLite), so backups made on a phone open in the Windows/macOS app (via
// Settings -> Pull) and vice versa. Uses sql.js (SQLite compiled to
// WebAssembly, in vendor/sql.js), loaded only when a backup is made or loaded.

import { parseLocalDateTime, sqliteDateTime } from "./dates.js";
import { DEFAULT_FOCUS, DEFAULT_SETTINGS, emptyDatabase } from "./models.js";

const VENDOR = new URL("../vendor/sql.js/", import.meta.url);

let sqlJs = null;

function loadSqlJs() {
  sqlJs ||= new Promise((resolve, reject) => {
    if (globalThis.initSqlJs) return resolve(globalThis.initSqlJs);
    const script = document.createElement("script");
    script.src = new URL("sql-wasm.js", VENDOR).href;
    script.onload = () => resolve(globalThis.initSqlJs);
    script.onerror = () => reject(new Error("Couldn't load the backup tools. Check your connection and try again."));
    document.head.appendChild(script);
  }).then((initSqlJs) => initSqlJs({ locateFile: (file) => new URL(file, VENDOR).href }));
  sqlJs.catch(() => {
    sqlJs = null; // let the next attempt retry
  });
  return sqlJs;
}

// Exactly what the desktop app's SQLAlchemy models create (app/models.py).
const SCHEMA = `
CREATE TABLE categories (
	id INTEGER NOT NULL,
	name VARCHAR(80) NOT NULL,
	kind VARCHAR(20) NOT NULL,
	color VARCHAR(7) NOT NULL,
	created_at DATETIME,
	PRIMARY KEY (id)
);
CREATE TABLE settings (
	id INTEGER NOT NULL,
	period_start_weekday INTEGER NOT NULL,
	period_end_weekday INTEGER NOT NULL,
	sync_enabled BOOLEAN NOT NULL,
	daily_goal_minutes INTEGER NOT NULL,
	theme VARCHAR(10) NOT NULL,
	lan_access_enabled BOOLEAN NOT NULL,
	long_timer_warning_minutes INTEGER NOT NULL,
	pomodoro_work_minutes INTEGER NOT NULL,
	pomodoro_short_break_minutes INTEGER NOT NULL,
	pomodoro_long_break_minutes INTEGER NOT NULL,
	pomodoro_cycles INTEGER NOT NULL,
	sound_enabled BOOLEAN NOT NULL,
	PRIMARY KEY (id)
);
CREATE TABLE focus_timer (
	id INTEGER NOT NULL,
	mode VARCHAR(20) NOT NULL,
	status VARCHAR(20) NOT NULL,
	phase VARCHAR(20) NOT NULL,
	task_id INTEGER,
	duration_seconds INTEGER NOT NULL,
	started_at DATETIME,
	segment_seconds INTEGER NOT NULL,
	remaining_at_pause INTEGER,
	completed_work_sessions INTEGER NOT NULL,
	time_log_id INTEGER,
	finished_at DATETIME,
	PRIMARY KEY (id)
);
CREATE TABLE tasks (
	id INTEGER NOT NULL,
	category_id INTEGER NOT NULL,
	title VARCHAR(200) NOT NULL,
	description TEXT,
	due_date DATETIME,
	priority VARCHAR(10) NOT NULL,
	estimated_minutes INTEGER,
	status VARCHAR(20) NOT NULL,
	is_recurring BOOLEAN NOT NULL,
	recurrence_interval_days INTEGER,
	created_at DATETIME,
	completed_at DATETIME,
	PRIMARY KEY (id),
	FOREIGN KEY(category_id) REFERENCES categories (id)
);
CREATE TABLE time_logs (
	id INTEGER NOT NULL,
	task_id INTEGER NOT NULL,
	start_time DATETIME NOT NULL,
	end_time DATETIME,
	is_manual BOOLEAN NOT NULL,
	source VARCHAR(20),
	note TEXT,
	PRIMARY KEY (id),
	FOREIGN KEY(task_id) REFERENCES tasks (id)
);`;

// Column -> kind, for converting values. Anything not listed is copied as-is.
const DATETIME_COLUMNS = new Set(["created_at", "due_date", "completed_at", "start_time", "end_time", "started_at", "finished_at"]);
const BOOLEAN_COLUMNS = new Set(["is_recurring", "is_manual", "sync_enabled", "lan_access_enabled", "sound_enabled"]);

const TABLE_COLUMNS = {
  categories: ["id", "name", "kind", "color", "created_at"],
  tasks: ["id", "category_id", "title", "description", "due_date", "priority", "estimated_minutes", "status", "is_recurring", "recurrence_interval_days", "created_at", "completed_at"],
  time_logs: ["id", "task_id", "start_time", "end_time", "is_manual", "source", "note"],
  settings: ["id", ...Object.keys(DEFAULT_SETTINGS)],
  focus_timer: ["id", ...Object.keys(DEFAULT_FOCUS)],
};

function toSqlValue(column, value) {
  if (value === undefined || value === null) return null;
  if (DATETIME_COLUMNS.has(column)) return sqliteDateTime(value);
  if (BOOLEAN_COLUMNS.has(column)) return value ? 1 : 0;
  return value;
}

function fromSqlValue(column, value) {
  if (value === undefined || value === null) return null;
  if (DATETIME_COLUMNS.has(column)) return parseLocalDateTime(value);
  if (BOOLEAN_COLUMNS.has(column)) return Boolean(Number(value));
  return value;
}

/** The on-device data as the bytes of a desktop-compatible tasks.db file. */
export async function exportSqlite(db) {
  const SQL = await loadSqlJs();
  const out = new SQL.Database();
  try {
    out.run(SCHEMA);
    const write = (table, rows) => {
      const columns = TABLE_COLUMNS[table];
      const stmt = out.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`);
      for (const row of rows) stmt.run(columns.map((c) => toSqlValue(c, row[c])));
      stmt.free();
    };
    out.run("BEGIN");
    write("categories", db.categories);
    write("tasks", db.tasks);
    write("time_logs", db.time_logs);
    write("settings", [{ id: 1, ...db.settings }]);
    write("focus_timer", [{ id: 1, ...db.focus_timer }]);
    out.run("COMMIT");
    return out.export();
  } finally {
    out.close();
  }
}

const SQLITE_HEADER = "SQLite format 3\u0000";
const NOT_OURS = "That doesn't look like a Task Organizer database file.";

/**
 * Read a tasks.db file (from the desktop app, or a phone backup) into
 * on-device data. Older desktop files work too: missing columns and tables
 * get their defaults, like app/schema.py does. Throws Error(NOT_OURS) for
 * anything else.
 */
export async function importSqlite(bytes) {
  const header = String.fromCharCode(...bytes.slice(0, SQLITE_HEADER.length));
  if (header !== SQLITE_HEADER) throw new Error(NOT_OURS);

  const SQL = await loadSqlJs();
  let src;
  try {
    src = new SQL.Database(bytes);
  } catch {
    throw new Error(NOT_OURS);
  }
  try {
    const select = (sql) => {
      const [result] = src.exec(sql);
      if (!result) return [];
      return result.values.map((values) => Object.fromEntries(result.columns.map((c, i) => [c, values[i]])));
    };
    let tables;
    try {
      tables = new Set(select("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name));
    } catch {
      throw new Error(NOT_OURS);
    }
    if (!["categories", "tasks", "time_logs"].every((t) => tables.has(t))) throw new Error(NOT_OURS);

    const read = (table) =>
      (tables.has(table) ? select(`SELECT * FROM ${table} ORDER BY id`) : []).map((raw) => {
        const row = {};
        for (const column of TABLE_COLUMNS[table]) row[column] = fromSqlValue(column, raw[column]);
        return row;
      });

    const db = emptyDatabase();
    db.categories = read("categories");
    const categoryIds = new Set(db.categories.map((c) => c.id));
    // Drop rows whose parent is gone (SQLite doesn't enforce the foreign keys).
    db.tasks = read("tasks").filter((t) => categoryIds.has(t.category_id));
    const taskIds = new Set(db.tasks.map((t) => t.id));
    db.time_logs = read("time_logs").filter((l) => taskIds.has(l.task_id) && l.start_time !== null);
    for (const t of db.tasks) {
      t.description ??= "";
      t.priority ??= "medium";
      t.status ??= "todo";
      t.is_recurring ??= false;
    }
    for (const l of db.time_logs) l.is_manual ??= false;

    const withDefaults = (row, defaults) => {
      const out = { ...defaults };
      for (const key of Object.keys(defaults)) if (row && row[key] !== null && row[key] !== undefined) out[key] = row[key];
      return out;
    };
    db.settings = withDefaults(read("settings").find((r) => r.id === 1), DEFAULT_SETTINGS);
    db.focus_timer = withDefaults(read("focus_timer").find((r) => r.id === 1), DEFAULT_FOCUS);
    if (db.focus_timer.task_id !== null && !taskIds.has(db.focus_timer.task_id)) db.focus_timer.task_id = null;

    const nextId = (rows) => rows.reduce((max, r) => Math.max(max, r.id), 0) + 1;
    db.next_id = { categories: nextId(db.categories), tasks: nextId(db.tasks), time_logs: nextId(db.time_logs) };
    return db;
  } finally {
    src.close();
  }
}
