// Keeps the app's data in the browser's IndexedDB on this device.
//
// The whole dataset is one record ("current"); it's small enough that
// reading and rewriting it per change is instant. Every request runs under
// a Web Lock so two open copies of the app can't overwrite each other.

import { DEFAULT_FOCUS, DEFAULT_SETTINGS, emptyDatabase } from "./models.js";

const IDB_NAME = "task-organizer";
const STORE = "data";
const CURRENT = "current";
// The data as it was before the last "Pull" (load a backup), for Undo.
export const BEFORE_LAST_LOAD = "before-last-load";

let idb = null;

function open() {
  idb ||= new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("This browser won't let Task Organizer save data. Private browsing can cause this."));
  });
  idb.catch(() => {
    idb = null;
  });
  return idb;
}

async function run(mode, fn) {
  const conn = await open();
  return new Promise((resolve, reject) => {
    const tx = conn.transaction(STORE, mode);
    const request = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error("Couldn't save your data."));
  });
}

export const read = (key) => run("readonly", (store) => store.get(key));
export const write = (key, value) => run("readwrite", (store) => store.put(value, key));
export const exists = async (key) => (await run("readonly", (store) => store.count(key))) > 0;

/** Run `fn` while holding the app-wide data lock (where the browser supports it). */
export function withLock(fn) {
  if (navigator.locks?.request) return navigator.locks.request("task-organizer-data", fn);
  return fn();
}

/**
 * Fill in anything added since the data was saved, so data from an older
 * version of the app keeps working (the on-device version of app/schema.py).
 */
export function upgrade(db) {
  const fresh = emptyDatabase();
  for (const key of Object.keys(fresh)) db[key] ??= fresh[key];
  db.settings = { ...DEFAULT_SETTINGS, ...db.settings };
  db.focus_timer = { ...DEFAULT_FOCUS, ...db.focus_timer };
  for (const task of db.tasks) task.is_general ??= false;
  return db;
}

export async function loadDatabase() {
  const db = await read(CURRENT);
  return upgrade(db || emptyDatabase());
}

export const saveDatabase = (db) => write(CURRENT, db);
