// Focus: countdown timer, Pomodoro cycles, and the stopwatch - each can be
// linked to a task, or to a class as a whole ("general study"), so the time
// is recorded against it.

import {
  ICONS,
  esc,
  fmtClock,
  fmtDuration,
  getCategory,
  getTask,
  isMobileApp,
  mutate,
  parseTaskChoice,
  store,
  taskOptions,
  toast,
} from "../core.js";
import { registerActions, requestRender } from "../ui.js";
import { requestNotificationPermission } from "../alerts.js";

const PRESETS = [15, 25, 45, 60];
const PHASE_LABELS = { work: "Focus", short_break: "Short break", long_break: "Long break" };

const ui = {
  tab: null, // countdown | pomodoro | stopwatch (null = follow the timer state)
  minutes: 25,
  // What to track time on, as a taskOptions() value: a task id, "cat:<id>"
  // for general study on a class, or null for no task.
  choice: null,
};

/** The picker value for a task, using "cat:<id>" for a class's general study task. */
function choiceForTask(task) {
  return task.is_general ? `cat:${task.category_id}` : String(task.id);
}

function choiceExists(choice) {
  const { task_id: taskId, category_id: categoryId } = parseTaskChoice(choice);
  return categoryId ? Boolean(getCategory(categoryId)) : Boolean(getTask(taskId));
}

const RING_SIZE = 280;
const RING_STROKE = 14;
const RING_R = (RING_SIZE - RING_STROKE) / 2;
const RING_C = 2 * Math.PI * RING_R;

function bigRing({ center, fraction, color, countdownUntil, durationSeconds }) {
  const offset = RING_C * (1 - Math.max(0, Math.min(1, fraction)));
  return `
    <div class="focus-ring">
      <svg viewBox="0 0 ${RING_SIZE} ${RING_SIZE}">
        <circle cx="${RING_SIZE / 2}" cy="${RING_SIZE / 2}" r="${RING_R}" fill="none" stroke="var(--surface-3)" stroke-width="${RING_STROKE}"/>
        <circle cx="${RING_SIZE / 2}" cy="${RING_SIZE / 2}" r="${RING_R}" fill="none" stroke="${color}" stroke-width="${RING_STROKE}"
          stroke-linecap="round" stroke-dasharray="${RING_C}" stroke-dashoffset="${offset}"
          ${countdownUntil ? `data-ring-until="${esc(countdownUntil)}" data-ring-duration="${durationSeconds}" data-ring-c="${RING_C}"` : ""}/>
      </svg>
      <div class="focus-ring-center">${center}</div>
    </div>`;
}

function taskPicker(selectedId) {
  return `
    <label class="field"><span>Work on</span>
      <select id="focus-task">
        <option value="">No task (just a timer)</option>
        ${taskOptions(selectedId, { byCategory: true })}
      </select>
    </label>`;
}

function taskLabel(title, color) {
  if (!title) return `<div class="focus-task muted">Not linked to a task</div>`;
  return `<div class="focus-task"><span class="dot" style="background:${esc(color)}"></span><span class="cat-name">${esc(title)}</span></div>`;
}

function cycleDots(focus, settings) {
  const cycles = settings.pomodoro_cycles;
  const completed = focus.completed_work_sessions;
  let done = completed % cycles;
  const startedNewCycle = focus.phase === "work" && focus.status !== "finished";
  if (completed > 0 && done === 0 && !startedNewCycle) done = cycles;
  return `<div class="cycle-dots" title="${focus.completed_work_sessions} focus session(s) done">${Array.from({ length: cycles }, (_, i) => `<span class="${i < done ? "done" : ""}"></span>`).join("")}</div>`;
}

function activeFocusHtml(focus, settings) {
  const isPomodoro = focus.mode === "pomodoro";
  const phase = isPomodoro ? PHASE_LABELS[focus.phase] : "Countdown";
  const isBreak = focus.phase !== "work";
  const color = isBreak ? "var(--success)" : "var(--accent)";

  if (focus.status === "finished") {
    let actions;
    if (isPomodoro && focus.phase === "work") {
      const done = focus.completed_work_sessions;
      const longNext = done % settings.pomodoro_cycles === 0;
      actions = `
        <button type="button" class="btn primary lg" data-action="focus-next">Start ${longNext ? "long" : "short"} break</button>
        <button type="button" class="btn lg" data-action="focus-next" data-phase="work">Skip break</button>`;
    } else if (isPomodoro) {
      actions = `<button type="button" class="btn primary lg" data-action="focus-next">Start next focus session</button>`;
    } else {
      actions = `
        <button type="button" class="btn primary lg" data-action="focus-extend" data-minutes="5">+5 minutes</button>
        <button type="button" class="btn lg" data-action="focus-restart">Start again</button>`;
    }
    return `
      <div class="finished-banner">
        <div class="focus-phase">${esc(phase)} finished</div>
        <h2>${isBreak ? "Break's over" : "Time's up!"}</h2>
        ${focus.task_title && !isBreak ? `<p class="muted">The time was recorded on <strong>${esc(focus.task_title)}</strong>.</p>` : ""}
      </div>
      ${isPomodoro ? cycleDots(focus, settings) : ""}
      <div class="focus-controls">
        ${actions}
        <button type="button" class="btn ghost lg" data-action="focus-cancel">Done</button>
      </div>`;
  }

  const running = focus.status === "running";
  const fraction = focus.duration_seconds ? 1 - focus.remaining_seconds / focus.duration_seconds : 0;
  return `
    ${bigRing({
      fraction,
      color,
      countdownUntil: running ? focus.ends_at : null,
      durationSeconds: focus.duration_seconds,
      center: `
        <div class="focus-phase">${esc(phase)}${running ? "" : " \u00b7 paused"}</div>
        <div class="focus-time" ${running ? `data-countdown-until="${esc(focus.ends_at)}"` : ""}>${fmtClock(focus.remaining_seconds)}</div>
        <div class="faint small">of ${fmtDuration(focus.duration_seconds)}</div>`,
    })}
    ${taskLabel(isBreak ? null : focus.task_title, focus.category_color)}
    ${isPomodoro ? cycleDots(focus, settings) : ""}
    <div class="focus-controls">
      ${
        running
          ? `<button type="button" class="btn lg" data-action="focus-pause">Pause</button>`
          : `<button type="button" class="btn primary lg" data-action="focus-resume">Resume</button>`
      }
      <button type="button" class="btn lg" data-action="focus-extend" data-minutes="5">+5 min</button>
      <button type="button" class="btn ghost lg danger-outline" data-action="focus-cancel">Stop</button>
    </div>`;
}

function setupHtml(tab, state) {
  const settings = state.settings;
  if (tab === "stopwatch") {
    const timer = state.active_timer;
    if (timer) {
      return `
        ${bigRing({
          fraction: 1,
          color: "var(--success)",
          center: `
            <div class="focus-phase">Stopwatch</div>
            <div class="focus-time" data-elapsed-since="${esc(timer.start_time)}"></div>
            <div class="faint small">since ${new Date(timer.start_time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>`,
        })}
        ${taskLabel(timer.task_title, timer.category_color)}
        <div class="focus-controls">
          <button type="button" class="btn danger lg" data-action="stop-timer" data-task-id="${timer.task_id}">${ICONS.stop} Stop</button>
        </div>`;
    }
    return `
      <div class="focus-setup">
        <p class="muted" style="margin:0">Counts up until you stop it. Every second is recorded on the task or class.</p>
        ${taskPicker(ui.choice)}
        <button type="button" class="btn success lg" data-action="focus-stopwatch-start">${ICONS.play} Start stopwatch</button>
      </div>`;
  }

  if (tab === "pomodoro") {
    return `
      <div class="focus-setup">
        <p class="muted" style="margin:0">
          ${settings.pomodoro_work_minutes} min focus, ${settings.pomodoro_short_break_minutes} min break, and a
          ${settings.pomodoro_long_break_minutes} min break after every ${settings.pomodoro_cycles} sessions.
          <a href="#/settings">Change lengths</a>
        </p>
        ${taskPicker(ui.choice)}
        <button type="button" class="btn primary lg" data-action="focus-start" data-mode="pomodoro">Start ${settings.pomodoro_work_minutes}-minute focus</button>
      </div>`;
  }

  return `
    <div class="focus-setup">
      <div class="preset-grid">
        ${PRESETS.map((m) => `<button type="button" data-action="focus-preset" data-minutes="${m}" class="${ui.minutes === m ? "active" : ""}">${m}<small>min</small></button>`).join("")}
      </div>
      <label class="field"><span>Custom length <span class="field-hint">(minutes)</span></span>
        <input type="number" id="focus-minutes" min="1" max="1440" value="${ui.minutes}">
      </label>
      ${taskPicker(ui.choice)}
      <button type="button" class="btn primary lg" data-action="focus-start" data-mode="countdown">Start countdown</button>
    </div>`;
}

function sidePanel(state) {
  const focusLogs = state.today_logs.filter((l) => l.source === "countdown" || l.source === "pomodoro");
  const focusSeconds = focusLogs.reduce((sum, l) => sum + l.duration_seconds, 0);
  const notifState = "Notification" in window ? Notification.permission : "unsupported";
  return `
    <div class="stack">
      <section class="card">
        <div class="card-header"><h2>Today</h2></div>
        <div class="grid grid-2">
          <div><div class="stat-label">Tracked</div><div class="big-number" style="font-size:1.4rem">${fmtDuration(state.today.today_seconds)}</div></div>
          <div><div class="stat-label">Focus time</div><div class="big-number" style="font-size:1.4rem">${fmtDuration(focusSeconds)}</div><div class="faint small">Countdown &amp; Pomodoro</div></div>
        </div>
      </section>
      <section class="card">
        <div class="card-header"><h2>When a timer ends</h2></div>
        <p class="muted small" style="margin-top:0">${
          isMobileApp()
            ? `You'll hear a chime${state.settings.sound_enabled ? "" : " (currently off in Settings)"} and see a notification while Task Organizer is open. Phones pause web apps in the background, so if you switch away, the time is still recorded correctly and you'll be alerted when you come back.`
            : `You'll hear a chime${state.settings.sound_enabled ? "" : " (currently off in Settings)"} and see a desktop notification, even from another tab.`
        }</p>
        ${
          notifState === "default"
            ? `<button type="button" class="btn sm" data-action="enable-notifications">Allow ${isMobileApp() ? "" : "desktop "}notifications</button>`
            : notifState === "denied"
              ? `<p class="small faint">Notifications are blocked for this site in your browser settings.</p>`
              : notifState === "granted"
                ? `<p class="small positive">${isMobileApp() ? "Notifications" : "Desktop notifications"} are on.</p>`
                : `<p class="small faint">This browser can't show notifications here.</p>`
        }
      </section>
    </div>`;
}

export const focusView = {
  title: "Focus",

  render(params) {
    const state = store.state;
    const focus = state.focus;
    const focusActive = focus.status !== "idle";

    const requestedTask = getTask(params.get("task"));
    const requestedCat = getCategory(params.get("cat"));
    if (requestedTask) ui.choice = choiceForTask(requestedTask);
    else if (requestedCat) ui.choice = `cat:${requestedCat.id}`;
    else if (ui.choice && !choiceExists(ui.choice)) ui.choice = null;
    if (ui.choice === null && getTask(focus.task_id)) ui.choice = choiceForTask(getTask(focus.task_id));

    let tab = ui.tab;
    if (focusActive) tab = focus.mode;
    else if (!tab) tab = state.active_timer ? "stopwatch" : "countdown";

    const main = focusActive ? activeFocusHtml(focus, state.settings) : setupHtml(tab, state);
    const tabs = [
      ["countdown", "Countdown"],
      ["pomodoro", "Pomodoro"],
      ["stopwatch", "Stopwatch"],
    ];

    return `
      <div class="page-header">
        <div><h1>Focus</h1><p class="muted">Set a timer for yourself. Time on a linked task is tracked automatically.</p></div>
        <div class="segmented">
          ${tabs
            .map(
              ([id, label]) =>
                `<button type="button" data-action="focus-tab" data-tab="${id}" class="${tab === id ? "active" : ""}" ${focusActive && id !== tab ? "disabled" : ""}>${label}</button>`
            )
            .join("")}
        </div>
      </div>
      <div class="focus-layout">
        <section class="card focus-main">${main}</section>
        ${sidePanel(state)}
      </div>`;
  },

  mount(root) {
    const select = root.querySelector("#focus-task");
    if (select) select.addEventListener("change", () => (ui.choice = select.value || null));
    const minutes = root.querySelector("#focus-minutes");
    if (minutes) {
      minutes.addEventListener("input", () => {
        ui.minutes = Number(minutes.value) || ui.minutes;
        root.querySelectorAll('[data-action="focus-preset"]').forEach((b) => b.classList.toggle("active", Number(b.dataset.minutes) === Number(minutes.value)));
      });
    }
  },
};

const rerender = requestRender;

registerActions({
  "focus-tab": (el) => {
    ui.tab = el.dataset.tab;
    rerender();
  },
  "focus-preset": (el) => {
    ui.minutes = Number(el.dataset.minutes);
    rerender();
  },
  "focus-start": async (el) => {
    requestNotificationPermission();
    const mode = el.dataset.mode;
    const body = { mode, ...parseTaskChoice(ui.choice) };
    if (mode === "countdown") {
      const input = document.getElementById("focus-minutes");
      body.minutes = Number(input?.value) || ui.minutes;
      ui.minutes = body.minutes;
    }
    await mutate("POST", "/api/focus/start", body);
  },
  "focus-restart": async () => {
    const focus = store.state.focus;
    await mutate("POST", "/api/focus/start", {
      mode: "countdown",
      minutes: Math.round(focus.duration_seconds / 60) || ui.minutes,
      task_id: focus.task_id,
    });
  },
  "focus-next": (el) => mutate("POST", "/api/focus/next", el.dataset.phase ? { phase: el.dataset.phase } : {}),
  "focus-pause": () => mutate("POST", "/api/focus/pause"),
  "focus-resume": () => mutate("POST", "/api/focus/resume"),
  "focus-extend": (el) => mutate("POST", "/api/focus/extend", { minutes: Number(el.dataset.minutes) || 5 }),
  "focus-cancel": () => mutate("POST", "/api/focus/cancel"),
  "focus-stopwatch-start": async () => {
    const { task_id: taskId, category_id: categoryId } = parseTaskChoice(ui.choice);
    if (!taskId && !categoryId) {
      toast("Pick a task or class for the stopwatch to track time on.", "error");
      document.getElementById("focus-task")?.focus();
      return;
    }
    await mutate("POST", categoryId ? `/api/categories/${categoryId}/timer/start` : `/api/tasks/${taskId}/timer/start`);
  },
  "enable-notifications": async () => {
    await requestNotificationPermission();
    rerender();
  },
});
