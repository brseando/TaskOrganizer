// Time-tracking aggregation: a JavaScript port of app/stats.py.
//
// All day-based totals clip each session to the day(s) it actually covers,
// so a session from 11pm to 1am counts one hour towards each day.

import { addDaysYmd, dayStart, formatDay, isoLocal, parseYmd, todayYmd, weekday, ymdOf } from "./dates.js";
import { WEEKDAY_ABBR, categoryToDict, findById, periodLabel, sortedCategories, taskTrackedSeconds } from "./models.js";

const HEATMAP_WEEKS = 26;

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

/**
 * [start, endExclusive] ms for the configured weekday period (0=Monday)
 * containing today, or the upcoming one if today falls outside it.
 */
export function currentPeriodBounds(startWeekday, endWeekday, today = todayYmd()) {
  const lengthDays = (((endWeekday - startWeekday) % 7) + 7) % 7 + 1;
  const daysSinceStart = (((weekday(today) - startWeekday) % 7) + 7) % 7;
  let periodStart = addDaysYmd(today, -daysSinceStart);
  if (daysSinceStart >= lengthDays) periodStart = addDaysYmd(periodStart, 7);
  return [dayStart(periodStart), dayStart(addDaysYmd(periodStart, lengthDays))];
}

/** { start, end, label, isCustom }. An explicit start/end overrides the configured period. */
export function resolvePeriod(startStr, endStr, settings) {
  let startDate = parseYmd(startStr);
  let endDate = parseYmd(endStr);
  if (startDate && endDate) {
    if (endDate < startDate) [startDate, endDate] = [endDate, startDate];
    const label = startDate === endDate ? formatDay(startDate) : `${formatDay(startDate)}–${formatDay(endDate)}`;
    return { start: dayStart(startDate), end: dayStart(addDaysYmd(endDate, 1)), label, isCustom: true };
  }
  const [start, end] = currentPeriodBounds(settings.period_start_weekday, settings.period_end_weekday);
  return { start, end, label: periodLabel(settings), isCustom: false };
}

// ---------------------------------------------------------------------------
// Daily totals
// ---------------------------------------------------------------------------

/** Map<"YYYY-MM-DD", Map<categoryId, seconds>> for time inside [rangeStart, rangeEnd). */
export function secondsByDayAndCategory(db, rangeStart, rangeEnd, now) {
  const result = new Map();
  for (const log of db.time_logs) {
    if (!(log.start_time < rangeEnd && (log.end_time === null || log.end_time > rangeStart))) continue;
    const task = findById(db, "tasks", log.task_id);
    if (!task) continue;
    let cursor = Math.max(log.start_time, rangeStart);
    const end = Math.min(log.end_time ?? now, rangeEnd);
    while (cursor < end) {
      const day = ymdOf(cursor);
      const chunkEnd = Math.min(end, dayStart(addDaysYmd(day, 1)));
      if (!result.has(day)) result.set(day, new Map());
      const byCat = result.get(day);
      byCat.set(task.category_id, (byCat.get(task.category_id) || 0) + (chunkEnd - cursor) / 1000);
      cursor = chunkEnd;
    }
  }
  return result;
}

/** { categoryId: seconds } */
export function secondsByCategory(db, rangeStart, rangeEnd, now) {
  const totals = new Map();
  for (const byCat of secondsByDayAndCategory(db, rangeStart, rangeEnd, now).values()) {
    for (const [catId, seconds] of byCat) totals.set(catId, (totals.get(catId) || 0) + seconds);
  }
  const out = {};
  for (const [catId, seconds] of totals) out[catId] = Math.trunc(seconds);
  return out;
}

/** Map<"YYYY-MM-DD", seconds> for every day from startDate to endDate inclusive. */
export function dailyTotals(db, startDate, endDate, now) {
  const raw = secondsByDayAndCategory(db, dayStart(startDate), dayStart(addDaysYmd(endDate, 1)), now);
  const totals = new Map();
  for (let d = startDate; d <= endDate; d = addDaysYmd(d, 1)) {
    let sum = 0;
    for (const seconds of (raw.get(d) || new Map()).values()) sum += seconds;
    totals.set(d, Math.trunc(sum));
  }
  return totals;
}

function allTimeDailyTotals(db, now) {
  const today = ymdOf(now);
  if (!db.time_logs.length) return new Map([[today, 0]]);
  const first = ymdOf(Math.min(...db.time_logs.map((l) => l.start_time)));
  return dailyTotals(db, first < today ? first : today, today, now);
}

/**
 * Current and longest run of consecutive days meeting the daily goal. Today
 * only extends the current streak once it's met; not having met it yet
 * doesn't break a streak that ran through yesterday.
 */
export function streaks(goalSeconds, totals, today) {
  if (goalSeconds <= 0) return { current: 0, longest: 0 };
  let longest = 0;
  let run = 0;
  for (const d of [...totals.keys()].sort()) {
    run = totals.get(d) >= goalSeconds ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  let current = 0;
  let d = (totals.get(today) || 0) >= goalSeconds ? today : addDaysYmd(today, -1);
  while ((totals.get(d) || 0) >= goalSeconds) {
    current += 1;
    d = addDaysYmd(d, -1);
  }
  return { current, longest };
}

function averageOfLast(totals, today, days) {
  let sum = 0;
  for (let i = 1; i <= days; i++) sum += totals.get(addDaysYmd(today, -i)) || 0;
  return Math.trunc(sum / days);
}

export function todaySummary(db, settings, now) {
  const today = ymdOf(now);
  const totals = allTimeDailyTotals(db, now);
  const goalSeconds = settings.daily_goal_minutes * 60;
  return {
    today_seconds: totals.get(today) || 0,
    yesterday_seconds: totals.get(addDaysYmd(today, -1)) || 0,
    avg_7_seconds: averageOfLast(totals, today, 7),
    today_by_category: secondsByCategory(db, dayStart(today), dayStart(addDaysYmd(today, 1)), now),
    goal_seconds: goalSeconds,
    streak: streaks(goalSeconds, totals, today),
  };
}

// ---------------------------------------------------------------------------
// Planned / estimated / actual totals for a period (per category)
// ---------------------------------------------------------------------------

/**
 * - estimated: estimates of still-open tasks due in the period ("what's left").
 * - planned: estimates of every task due in the period, done or not.
 * - actual: tracked time inside the period, regardless of due dates.
 */
export function periodTotals(db, periodStart, periodEnd, categories, now) {
  const actualByCat = secondsByCategory(db, periodStart, periodEnd, now);
  const perCategory = {};
  const totals = { estimated: 0, planned: 0, actual: 0 };
  for (const cat of categories) {
    const inPeriod = db.tasks.filter((t) => t.category_id === cat.id && t.due_date !== null && periodStart <= t.due_date && t.due_date < periodEnd);
    const estimated = inPeriod.filter((t) => t.status !== "done").reduce((sum, t) => sum + (t.estimated_minutes || 0), 0);
    const planned = inPeriod.reduce((sum, t) => sum + (t.estimated_minutes || 0), 0);
    const actual = Math.floor((actualByCat[cat.id] || 0) / 60);
    perCategory[cat.id] = { estimated, planned, actual };
    totals.estimated += estimated;
    totals.planned += planned;
    totals.actual += actual;
  }
  return { perCategory, totals };
}

// ---------------------------------------------------------------------------
// Estimate accuracy
// ---------------------------------------------------------------------------

function accuracySummary(rows) {
  if (!rows.length) return null;
  const pctDiffs = rows.map(([est, actual]) => ((actual - est) / est) * 100);
  return {
    count: rows.length,
    avg_pct_diff: Math.round(pctDiffs.reduce((a, b) => a + b, 0) / pctDiffs.length),
    total_estimated_minutes: Math.trunc(rows.reduce((sum, [est]) => sum + est, 0)),
    total_actual_minutes: Math.trunc(rows.reduce((sum, [, actual]) => sum + actual, 0)),
    within_10pct: pctDiffs.filter((p) => Math.abs(p) <= 10).length,
    over: pctDiffs.filter((p) => p > 10).length,
    under: pctDiffs.filter((p) => p < -10).length,
  };
}

/** Tracked time vs estimates on completed tasks that have both. */
function estimateAccuracy(db, now) {
  const done = db.tasks.filter((t) => t.status === "done" && t.estimated_minutes > 0);
  const tracked = new Map(done.map((t) => [t.id, taskTrackedSeconds(db, t, now)]));
  const measured = done.filter((t) => tracked.get(t.id) > 0);
  const rowsFor = (tasks) => tasks.map((t) => [t.estimated_minutes, tracked.get(t.id) / 60]);

  const byCategory = [];
  const byName = [...db.categories].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id - b.id));
  for (const cat of byName) {
    const summary = accuracySummary(rowsFor(measured.filter((t) => t.category_id === cat.id)));
    if (summary) byCategory.push({ id: cat.id, name: cat.name, color: cat.color, ...summary });
  }

  const recent = [...measured].sort((a, b) => (b.completed_at ?? -Infinity) - (a.completed_at ?? -Infinity)).slice(0, 10);
  return {
    overall: accuracySummary(rowsFor(measured)),
    untracked_count: done.length - measured.length,
    by_category: byCategory,
    recent: recent.map((t) => ({
      id: t.id,
      title: t.title,
      category_color: findById(db, "categories", t.category_id).color,
      estimated_minutes: t.estimated_minutes,
      actual_minutes: Math.floor(tracked.get(t.id) / 60),
      completed_at: isoLocal(t.completed_at),
    })),
  };
}

// ---------------------------------------------------------------------------
// Full Insights payload
// ---------------------------------------------------------------------------

export function buildInsights(db, startDate, endDate, settings, now) {
  const today = ymdOf(now);
  const categories = sortedCategories(db);
  const catLookup = new Map(categories.map((c) => [c.id, c]));

  const raw = secondsByDayAndCategory(db, dayStart(startDate), dayStart(addDaysYmd(endDate, 1)), now);
  const days = [];
  for (let d = startDate; d <= endDate; d = addDaysYmd(d, 1)) {
    const byCat = {};
    let total = 0;
    for (const [catId, seconds] of raw.get(d) || new Map()) {
      byCat[catId] = Math.trunc(seconds);
      total += byCat[catId];
    }
    days.push({ date: d, total, by_category: byCat });
  }

  // Averages only count days that have actually happened.
  const elapsedDays = days.filter((day) => day.date <= today);
  const totalSeconds = days.reduce((sum, day) => sum + day.total, 0);
  const activeDays = days.filter((day) => day.total > 0).length;
  const best = days.reduce((top, day) => (top === null || day.total > top.total ? day : top), null);
  const goalSeconds = settings.daily_goal_minutes * 60;

  const catTotals = new Map();
  for (const day of days) {
    for (const [catId, seconds] of Object.entries(day.by_category)) {
      catTotals.set(Number(catId), (catTotals.get(Number(catId)) || 0) + seconds);
    }
  }
  const breakdown = [...catTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([catId, seconds]) => ({
      id: catId,
      name: catLookup.has(catId) ? catLookup.get(catId).name : "Deleted",
      color: catLookup.has(catId) ? catLookup.get(catId).color : "#888888",
      seconds,
      share: totalSeconds ? seconds / totalSeconds : 0,
    }));

  const weekdaySums = [0, 0, 0, 0, 0, 0, 0];
  const weekdayCounts = [0, 0, 0, 0, 0, 0, 0];
  for (const day of elapsedDays) {
    const wd = weekday(day.date);
    weekdaySums[wd] += day.total;
    weekdayCounts[wd] += 1;
  }
  const weekdayAvg = WEEKDAY_ABBR.map((label, i) => ({
    label,
    seconds: weekdayCounts[i] ? Math.trunc(weekdaySums[i] / weekdayCounts[i]) : 0,
  }));

  const allTotals = allTimeDailyTotals(db, now);
  let heatStart = addDaysYmd(today, -(HEATMAP_WEEKS * 7 - 1));
  heatStart = addDaysYmd(heatStart, -weekday(heatStart)); // align to Monday
  const heatmap = [];
  for (let d = heatStart; d <= today; d = addDaysYmd(d, 1)) {
    heatmap.push({ date: d, seconds: allTotals.get(d) || 0 });
  }

  return {
    range: { start: startDate, end: endDate, label: `${formatDay(startDate)}–${formatDay(endDate)}` },
    categories: categories.map(categoryToDict),
    days,
    summary: {
      total_seconds: totalSeconds,
      active_days: activeDays,
      elapsed_days: elapsedDays.length,
      avg_per_day_seconds: elapsedDays.length ? Math.trunc(totalSeconds / elapsedDays.length) : 0,
      avg_per_active_day_seconds: activeDays ? Math.trunc(totalSeconds / activeDays) : 0,
      best_day: best && best.total > 0 ? best : null,
      goal_met_days: elapsedDays.filter((day) => goalSeconds && day.total >= goalSeconds).length,
    },
    comparisons: {
      today_seconds: allTotals.get(today) || 0,
      yesterday_seconds: allTotals.get(addDaysYmd(today, -1)) || 0,
      avg_7_seconds: averageOfLast(allTotals, today, 7),
      avg_30_seconds: averageOfLast(allTotals, today, 30),
    },
    goal_seconds: goalSeconds,
    streak: streaks(goalSeconds, allTotals, today),
    breakdown,
    weekday_avg: weekdayAvg,
    heatmap,
    accuracy: estimateAccuracy(db, now),
  };
}
