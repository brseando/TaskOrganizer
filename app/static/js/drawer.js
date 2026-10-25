// Task drawer (details, timer, sessions), plus the task and category forms.

import {
  ICONS,
  addDays,
  api,
  categoryOptions,
  esc,
  fmtDateTime,
  fmtDue,
  fmtDuration,
  fmtMinutes,
  fmtShortDate,
  fmtTime,
  getCategory,
  getTask,
  mutate,
  secondsSince,
  store,
  toLocalInput,
  toYmd,
  toast,
} from "./core.js";
import { confirmDialog, formValues, openModal, registerActions } from "./ui.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SOURCE_LABELS = { stopwatch: "Stopwatch", manual: "Manual", countdown: "Countdown", pomodoro: "Pomodoro" };

// ---------------------------------------------------------------------------
// Task form (create + edit)
// ---------------------------------------------------------------------------

export function openTaskForm({ task = null, categoryId = null, dueDate = null } = {}) {
  const state = store.state;
  if (!state.categories.length) {
    toast("Add a class or activity first.", "error");
    openCategoryForm();
    return;
  }
  const isEdit = Boolean(task);
  const selectedCat = task?.category_id ?? categoryId ?? state.categories[0].id;
  const dueYmd = task?.due_date ? task.due_date.slice(0, 10) : dueDate || "";
  const dueTime = task?.due_date ? task.due_date.slice(11, 16) : "23:59";
  const priority = task?.priority || "medium";

  const today = new Date();
  const weekdayButtons = [];
  for (let i = 2; i < 8; i++) {
    const d = addDays(today, i);
    weekdayButtons.push(`<button type="button" data-due="${toYmd(d)}">${WEEKDAYS[d.getDay()]}</button>`);
  }

  openModal({
    title: isEdit ? "Edit task" : "New task",
    size: "wide",
    body: `
      <form class="form-grid" data-task-form>
        <label class="field full"><span>Title</span>
          <input type="text" name="title" required maxlength="200" value="${esc(task?.title || "")}" placeholder="e.g. Problem Set 4">
        </label>
        <label class="field"><span>Class / activity</span>
          <select name="category_id" required>${categoryOptions(selectedCat)}</select>
        </label>
        <div class="field"><span>Priority</span>
          <div class="segmented" data-segment="priority">
            ${["low", "medium", "high"]
              .map((p) => `<button type="button" data-value="${p}" class="${p === priority ? "active" : ""}">${p[0].toUpperCase() + p.slice(1)}</button>`)
              .join("")}
          </div>
          <input type="hidden" name="priority" value="${esc(priority)}">
        </div>
        <div class="field full"><span>Due date</span>
          <div class="quick-picks" data-due-picks>
            <button type="button" data-due="${toYmd(today)}">Today</button>
            <button type="button" data-due="${toYmd(addDays(today, 1))}">Tomorrow</button>
            ${weekdayButtons.join("")}
            <button type="button" data-due="">No date</button>
          </div>
          <div class="row" style="margin-top:0.35rem">
            <input type="date" name="due_date" value="${esc(dueYmd)}" style="width:auto">
            <input type="time" name="due_time" value="${esc(dueTime)}" style="width:auto">
            <button type="button" class="btn sm ghost" data-eod>End of day</button>
          </div>
        </div>
        <div class="field"><span>Estimated time <span class="field-hint">(minutes)</span></span>
          <input type="number" name="estimated_minutes" min="0" step="5" value="${task?.estimated_minutes ?? ""}" placeholder="e.g. 60">
          <div class="quick-picks" data-est-picks>
            ${[15, 30, 45, 60, 90, 120].map((m) => `<button type="button" data-est="${m}">${fmtMinutes(m)}</button>`).join("")}
          </div>
        </div>
        <div class="field"><span>Repeats</span>
          <label class="checkbox"><input type="checkbox" name="is_recurring" ${task?.is_recurring ? "checked" : ""}> Repeat after it's done</label>
          <label class="row small muted" data-repeat-row>every
            <input type="number" name="recurrence_interval_days" min="1" value="${task?.recurrence_interval_days ?? 7}" style="width:80px"> days
          </label>
        </div>
        <label class="field full"><span>Notes</span>
          <textarea name="description" rows="3" placeholder="Optional details">${esc(task?.description || "")}</textarea>
        </label>
        <div class="form-actions full">
          <button type="button" class="btn" data-modal-close>Cancel</button>
          <button type="submit" class="btn primary">${isEdit ? "Save changes" : "Add task"}</button>
        </div>
      </form>`,
    onMount(el, modal) {
      const form = el.querySelector("[data-task-form]");
      const markDuePick = () => {
        form.querySelectorAll("[data-due]").forEach((b) => b.classList.toggle("active", b.dataset.due === form.due_date.value && form.due_date.value !== ""));
      };
      const markEstPick = () => {
        form.querySelectorAll("[data-est]").forEach((b) => b.classList.toggle("active", b.dataset.est === form.estimated_minutes.value));
      };
      const syncRepeat = () => {
        form.querySelector("[data-repeat-row]").style.display = form.is_recurring.checked ? "flex" : "none";
      };
      markDuePick();
      markEstPick();
      syncRepeat();

      form.addEventListener("click", (event) => {
        const due = event.target.closest("[data-due]");
        if (due) {
          form.due_date.value = due.dataset.due;
          markDuePick();
        }
        const est = event.target.closest("[data-est]");
        if (est) {
          form.estimated_minutes.value = est.dataset.est;
          markEstPick();
        }
        if (event.target.closest("[data-eod]")) form.due_time.value = "23:59";
        const seg = event.target.closest('[data-segment="priority"] button');
        if (seg) {
          form.priority.value = seg.dataset.value;
          seg.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === seg));
        }
      });
      form.due_date.addEventListener("input", markDuePick);
      form.estimated_minutes.addEventListener("input", markEstPick);
      form.is_recurring.addEventListener("change", syncRepeat);

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const values = formValues(form);
        const result = isEdit
          ? await mutate("PATCH", `/api/tasks/${task.id}`, values, "Task updated")
          : await mutate("POST", "/api/tasks", values, "Task added");
        if (result) modal.close();
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Category form
// ---------------------------------------------------------------------------

export function openCategoryForm(category = null) {
  const palette = store.state?.color_palette || ["#4361ee"];
  const used = new Set((store.state?.categories || []).map((c) => c.color));
  const color = category?.color || palette.find((c) => !used.has(c)) || palette[0];
  const kind = category?.kind || "class";

  openModal({
    title: category ? "Edit class or activity" : "New class or activity",
    size: "narrow",
    body: `
      <form class="stack" style="gap:0.9rem" data-category-form>
        <label class="field"><span>Name</span>
          <input type="text" name="name" required maxlength="80" value="${esc(category?.name || "")}" placeholder="e.g. Thermodynamics">
        </label>
        <div class="field"><span>Type</span>
          <div class="segmented" data-segment="kind">
            <button type="button" data-value="class" class="${kind === "class" ? "active" : ""}">Class</button>
            <button type="button" data-value="extracurricular" class="${kind === "extracurricular" ? "active" : ""}">Extracurricular</button>
          </div>
          <input type="hidden" name="kind" value="${esc(kind)}">
        </div>
        <div class="field"><span>Color</span>
          <div class="swatches">
            ${palette.map((c) => `<button type="button" class="swatch ${c === color ? "active" : ""}" data-color="${c}" style="background:${c}" title="${c}"></button>`).join("")}
            <input type="color" name="color" value="${esc(color)}" title="Custom color">
          </div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn" data-modal-close>Cancel</button>
          <button type="submit" class="btn primary">${category ? "Save" : "Add"}</button>
        </div>
      </form>`,
    onMount(el, modal) {
      const form = el.querySelector("[data-category-form]");
      form.addEventListener("click", (event) => {
        const sw = event.target.closest("[data-color]");
        if (sw) {
          form.color.value = sw.dataset.color;
          form.querySelectorAll(".swatch").forEach((b) => b.classList.toggle("active", b === sw));
        }
        const seg = event.target.closest('[data-segment="kind"] button');
        if (seg) {
          form.kind.value = seg.dataset.value;
          seg.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === seg));
        }
      });
      form.color.addEventListener("input", () => form.querySelectorAll(".swatch").forEach((b) => b.classList.remove("active")));
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const values = formValues(form);
        const result = category
          ? await mutate("PATCH", `/api/categories/${category.id}`, values, "Saved")
          : await mutate("POST", "/api/categories", values, `Added "${values.name}"`);
        if (result) modal.close();
      });
    },
  });
}

export async function deleteCategory(category) {
  const count = store.state.tasks.filter((t) => t.category_id === category.id && !t.is_general).length;
  const ok = await confirmDialog(
    `Delete "${category.name}"${count ? ` and its ${count} task${count === 1 ? "" : "s"} (including their tracked time)` : ""}? This can't be undone.`
  );
  if (ok) await mutate("DELETE", `/api/categories/${category.id}`, undefined, "Deleted");
}

export async function deleteTask(task) {
  const ok = await confirmDialog(`Delete "${task.title}" and its tracked time? This can't be undone.`);
  if (!ok) return false;
  const result = await mutate("DELETE", `/api/tasks/${task.id}`, undefined, "Task deleted");
  return Boolean(result);
}

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------

const drawer = {
  taskId: null,
  logs: null,
  logFormOpen: false,
  editingLogId: null,
};

export function isDrawerOpen() {
  return drawer.taskId !== null;
}

export function isDrawerBusy() {
  return drawer.logFormOpen || drawer.editingLogId !== null;
}

export function openTaskDrawer(taskId) {
  drawer.taskId = Number(taskId);
  drawer.logs = null;
  drawer.logFormOpen = false;
  drawer.editingLogId = null;
  renderDrawer();
  loadLogs();
}

export function closeDrawer() {
  drawer.taskId = null;
  document.getElementById("drawer-root").innerHTML = "";
}

async function loadLogs() {
  const id = drawer.taskId;
  if (id === null) return;
  try {
    const data = await api("GET", `/api/logs?task_id=${id}`);
    if (drawer.taskId !== id) return;
    drawer.logs = data.logs;
    renderDrawer();
  } catch (err) {
    toast(err.message, "error");
  }
}

/** Called after every state refresh. */
export function refreshDrawer({ fromPoll }) {
  if (drawer.taskId === null) return;
  if (fromPoll && isDrawerBusy()) return;
  renderDrawer();
  if (!fromPoll) loadLogs();
}

function sessionHtml(log) {
  const start = new Date(log.start_time);
  const running = !log.end_time;
  if (drawer.editingLogId === log.id) {
    return `
      <form class="inline-form" data-log-edit="${log.id}" style="margin:0.4rem 0">
        <label class="field"><span>Started</span><input type="datetime-local" name="start_time" value="${toLocalInput(start)}" required></label>
        ${
          running
            ? `<div class="field"><span>Duration</span><span class="muted small">Still running</span></div>`
            : `<label class="field"><span>Minutes</span><input type="number" name="duration_minutes" min="1" value="${Math.max(1, Math.round(log.duration_seconds / 60))}" required></label>`
        }
        <label class="field full"><span>Note</span><input type="text" name="note" value="${esc(log.note)}" placeholder="Optional"></label>
        <div class="form-actions full">
          <button type="button" class="btn sm" data-action="drawer-cancel-log-edit">Cancel</button>
          <button type="submit" class="btn sm primary">Save</button>
        </div>
      </form>`;
  }
  const range = running ? `${fmtTime(start)} \u2013 now` : `${fmtTime(start)} \u2013 ${fmtTime(log.end_time)}`;
  return `
    <div class="session-item">
      <div class="session-main">
        <div><strong class="num">${running ? `<span class="mono" data-elapsed-since="${esc(log.start_time)}"></span>` : fmtDuration(log.duration_seconds)}</strong>
          <span class="muted small">\u00b7 ${esc(fmtShortDate(start))}, ${esc(range)}</span></div>
        ${log.note ? `<div class="session-note">${esc(log.note)}</div>` : ""}
      </div>
      <span class="chip">${SOURCE_LABELS[log.source] || log.source}</span>
      <button type="button" class="icon-button small" data-action="drawer-edit-log" data-log-id="${log.id}" title="Edit session">&#9998;</button>
      <button type="button" class="icon-button small" data-action="drawer-delete-log" data-log-id="${log.id}" title="Delete session">&times;</button>
    </div>`;
}

function renderDrawer() {
  const root = document.getElementById("drawer-root");
  const task = getTask(drawer.taskId);
  if (!task) {
    closeDrawer();
    return;
  }
  const category = getCategory(task.category_id);
  const done = task.status === "done";
  const tracked = task.total_tracked_seconds;
  const est = task.estimated_minutes;
  const pct = est ? Math.min(100, (tracked / 60 / est) * 100) : 0;
  const over = est && tracked / 60 > est;

  const general = task.is_general;
  const statusChip = general
    ? `<span class="chip">General study</span>`
    : done
    ? `<span class="chip success">Done</span>`
    : task.is_overdue
      ? `<span class="chip danger">Overdue</span>`
      : task.status === "in_progress"
        ? `<span class="chip accent">In progress</span>`
        : `<span class="chip">To do</span>`;

  const timerBtn = done
    ? ""
    : task.timer_running
      ? `<button type="button" class="btn danger" data-action="stop-timer" data-task-id="${task.id}">${ICONS.stop} Stop <span class="mono" data-elapsed-since="${esc(task.timer_start_time)}"></span></button>`
      : `<button type="button" class="btn success" data-action="start-timer" data-task-id="${task.id}">${ICONS.play} Start timer</button>`;

  const logs = drawer.logs;
  let sessionsHtml;
  if (logs === null) sessionsHtml = `<div class="empty-inline">Loading&hellip;</div>`;
  else if (!logs.length) sessionsHtml = `<div class="empty-inline">No time tracked yet.</div>`;
  else sessionsHtml = logs.map(sessionHtml).join("");

  const now = new Date();
  const manualForm = drawer.logFormOpen
    ? `
      <form class="inline-form" data-manual-log style="margin-bottom:0.6rem">
        <label class="field"><span>Minutes</span><input type="number" name="minutes" min="1" required placeholder="e.g. 30"></label>
        <div class="field"><span>Quick</span><div class="quick-picks">${[15, 30, 60].map((m) => `<button type="button" data-minutes="${m}">${fmtMinutes(m)}</button>`).join("")}</div></div>
        <label class="field"><span>Date <span class="field-hint">(optional)</span></span><input type="date" name="logged_date" max="${toYmd(now)}"></label>
        <label class="field"><span>Start time</span><input type="time" name="logged_time"></label>
        <label class="field full"><span>Note</span><input type="text" name="note" placeholder="Optional"></label>
        <p class="full small muted" style="margin:0">Leave the date empty to log it as ending just now.</p>
        <div class="form-actions full">
          <button type="button" class="btn sm" data-action="drawer-toggle-log-form">Cancel</button>
          <button type="submit" class="btn sm primary">Log time</button>
        </div>
      </form>`
    : "";

  root.innerHTML = `
    <div class="drawer-backdrop" data-action="close-drawer"></div>
    <aside class="drawer" role="dialog" aria-label="Task details">
      <div class="drawer-header">
        <div style="flex:1;min-width:0">
          <div class="row small muted" style="margin-bottom:0.3rem">
            <span class="dot" style="background:${esc(category?.color)}"></span>${esc(category?.name)} ${statusChip}
          </div>
          <h2>${esc(task.title)}</h2>
        </div>
        <button type="button" class="icon-button" data-action="close-drawer" aria-label="Close">&times;</button>
      </div>
      <div class="drawer-body">
        <div class="row">
          ${timerBtn}
          ${done ? "" : `<a class="btn" href="#/focus?${general ? `cat=${task.category_id}` : `task=${task.id}`}" data-action="close-drawer-nav">Focus</a>`}
          ${
            general
              ? ""
              : done
              ? `<button type="button" class="btn" data-action="reopen-task" data-task-id="${task.id}">Reopen</button>`
              : `<button type="button" class="btn" data-action="complete-task" data-task-id="${task.id}">${ICONS.check.replace("<svg", '<svg width="12" height="12"')} Mark done</button>`
          }
          ${
            general
              ? ""
              : `<span class="spacer"></span>
          <button type="button" class="btn ghost" data-action="edit-task" data-task-id="${task.id}">Edit</button>
          <button type="button" class="btn ghost danger-outline" data-action="delete-task" data-task-id="${task.id}">Delete</button>`
          }
        </div>

        ${
          general
            ? `<div class="detail-grid">
          <div><div class="detail-label">Tracked</div><div class="detail-value num">${task.timer_running ? `<span data-elapsed-since="${esc(task.timer_start_time)}" data-elapsed-base="${tracked - secondsSince(task.timer_start_time)}" data-format="duration"></span>` : fmtDuration(tracked)}</div></div>
        </div>
        <p class="muted small">Time studying ${esc(category?.name)} in general, not tied to a specific task. It counts towards the class in Insights.</p>`
            : `<div class="detail-grid">
          <div><div class="detail-label">Due</div><div class="detail-value">${task.due_date ? esc(fmtDue(task.due_date)) : "No due date"}</div></div>
          <div><div class="detail-label">Priority</div><div class="detail-value row" style="gap:0.4rem"><span class="priority-flag priority-${esc(task.priority)}"></span>${esc(task.priority[0].toUpperCase() + task.priority.slice(1))}</div></div>
          <div>
            <div class="detail-label">Tracked${est ? ` of ${fmtMinutes(est)} estimate` : ""}</div>
            <div class="detail-value num">${task.timer_running ? `<span data-elapsed-since="${esc(task.timer_start_time)}" data-elapsed-base="${tracked - secondsSince(task.timer_start_time)}" data-format="duration"></span>` : fmtDuration(tracked)}</div>
            ${est ? `<div class="progress"><span class="${over ? "over" : ""}" style="width:${pct}%"></span></div>` : ""}
          </div>
          <div><div class="detail-label">Repeats</div><div class="detail-value">${task.is_recurring ? `Every ${task.recurrence_interval_days} days` : "No"}</div></div>
          ${task.due_date ? `<div><div class="detail-label">Due exactly</div><div class="detail-value">${esc(fmtDateTime(task.due_date))}</div></div>` : ""}
          ${done && task.completed_at ? `<div><div class="detail-label">Completed</div><div class="detail-value">${esc(fmtDateTime(task.completed_at))}</div></div>` : ""}
        </div>`
        }

        ${task.description ? `<div class="drawer-section"><h3>Notes</h3><div class="description">${esc(task.description)}</div></div>` : ""}

        <div class="drawer-section">
          <div class="row" style="margin-bottom:0.4rem">
            <h3 style="margin:0">Time sessions</h3>
            <span class="spacer"></span>
            ${drawer.logFormOpen ? "" : `<button type="button" class="btn sm" data-action="drawer-toggle-log-form">+ Log time</button>`}
          </div>
          ${manualForm}
          ${sessionsHtml}
        </div>
      </div>
    </aside>`;

  const manual = root.querySelector("[data-manual-log]");
  if (manual) {
    manual.addEventListener("click", (event) => {
      const quick = event.target.closest("[data-minutes]");
      if (quick) manual.minutes.value = quick.dataset.minutes;
    });
    manual.addEventListener("submit", async (event) => {
      event.preventDefault();
      const result = await mutate("POST", `/api/tasks/${task.id}/timer/log`, formValues(manual), "Time logged");
      if (result) {
        drawer.logFormOpen = false;
        renderDrawer();
      }
    });
    manual.minutes.focus();
  }

  const editForm = root.querySelector("[data-log-edit]");
  if (editForm) {
    editForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const result = await mutate("PATCH", `/api/logs/${editForm.dataset.logEdit}`, formValues(editForm), "Session updated");
      if (result) {
        drawer.editingLogId = null;
        renderDrawer();
      }
    });
  }
  tickNow();
}

// Fill live timers immediately rather than waiting for the next tick.
function tickNow() {
  document.dispatchEvent(new CustomEvent("tick-now"));
}

registerActions({
  "close-drawer": () => closeDrawer(),
  "close-drawer-nav": (el) => {
    closeDrawer();
    window.location.hash = el.getAttribute("href");
  },
  "drawer-toggle-log-form": () => {
    drawer.logFormOpen = !drawer.logFormOpen;
    renderDrawer();
  },
  "drawer-edit-log": (el) => {
    drawer.editingLogId = Number(el.dataset.logId);
    renderDrawer();
  },
  "drawer-cancel-log-edit": () => {
    drawer.editingLogId = null;
    renderDrawer();
  },
  "drawer-delete-log": async (el) => {
    const ok = await confirmDialog("Delete this time session?");
    if (ok) await mutate("DELETE", `/api/logs/${el.dataset.logId}`, undefined, "Session deleted");
  },
});
