// Date helpers for the on-device backend.
//
// Moments are stored as epoch milliseconds. The API speaks the same local,
// timezone-less ISO strings as the desktop server ("2026-10-16T14:05:00"),
// and whole days are "YYYY-MM-DD" strings. Day arithmetic goes through the
// calendar (not +86400000) so daylight-saving changes never shift a due time.

const pad = (n) => String(n).padStart(2, "0");

export function ymdOf(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local ISO string without milliseconds, like Python's isoformat(timespec="seconds"). */
export function isoLocal(ms) {
  if (ms === null || ms === undefined) return null;
  const d = new Date(ms);
  return `${ymdOf(ms)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function todayYmd() {
  return ymdOf(Date.now());
}

/** "YYYY-MM-DD" -> the same string if it's a real date, else null. */
export function parseYmd(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Midnight at the start of a "YYYY-MM-DD" day, in ms. */
export function dayStart(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split("-").map(Number);
  return ymdOf(new Date(y, m - 1, d + days).getTime());
}

/** Same wall-clock time, `days` calendar days later. */
export function addDaysMs(ms, days) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()).getTime();
}

/** 0 = Monday ... 6 = Sunday (Python's weekday()). */
export function weekday(ymd) {
  return (new Date(dayStart(ymd)).getDay() + 6) % 7;
}

/** Whole days from `a` to `b` ("YYYY-MM-DD"). */
export function daysBetween(a, b) {
  return Math.round((dayStart(b) - dayStart(a)) / 86400000);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 5" */
export function formatDay(ymd) {
  const [, m, d] = ymd.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/**
 * Parse a local date-time like "2026-10-16T14:05", "2026-10-16 14:05:30.123456"
 * (the desktop database format), or a bare "2026-10-16" (midnight). Returns
 * ms or null.
 */
export function parseLocalDateTime(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?)?$/.exec(String(value ?? "").trim());
  if (!m) return null;
  const [y, mo, d, h = 0, mi = 0, s = 0] = m.slice(1, 7).map((v) => (v === undefined ? 0 : Number(v)));
  const ms = m[7] ? Math.floor(Number(m[7].padEnd(6, "0")) / 1000) : 0;
  if (h > 23 || mi > 59 || s > 59) return null;
  const date = new Date(y, mo - 1, d, h, mi, s, ms);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date.getTime();
}

/** A date input plus an optional time input (default end of day), or null. */
export function combineDateTime(dateValue, timeValue) {
  if (!dateValue) return null;
  return parseLocalDateTime(`${dateValue}T${timeValue || "23:59"}`);
}

/** "20261016-140500" for file names. */
export function fileStamp(ms = Date.now()) {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** "14:05" */
export function hhmm(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The desktop database's DATETIME text: "2026-10-16 14:05:00.000000". */
export function sqliteDateTime(ms) {
  if (ms === null || ms === undefined) return null;
  const d = new Date(ms);
  return `${ymdOf(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds() * 1000).padStart(6, "0")}`;
}
