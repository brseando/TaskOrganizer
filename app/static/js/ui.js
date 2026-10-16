// Modals, confirm dialogs, the period picker, and the delegated action
// registry: any element with data-action="name" runs the handler registered
// under that name when clicked, and any <form data-form="name"> runs the
// registered form handler on submit, so re-rendered HTML never needs
// listeners re-attached.

import { esc, isMobileApp } from "./core.js";

const actions = {};
const forms = {};

// Set by main.js; lets views re-render the current view without importing main.
let renderHook = () => {};
export function setRenderHook(fn) {
  renderHook = fn;
}
export function requestRender() {
  renderHook();
}

export function registerActions(map) {
  Object.assign(actions, map);
}

export function registerForms(map) {
  Object.assign(forms, map);
}

export function installDelegation() {
  document.addEventListener("click", async (event) => {
    const el = event.target.closest("[data-action]");
    if (!el || !actions[el.dataset.action]) return;
    if (el.tagName === "A" && el.getAttribute("href")?.startsWith("#")) {
      // Let hash links navigate normally unless the handler wants it.
    } else {
      event.preventDefault();
    }
    event.stopPropagation();
    if (el.disabled || el.dataset.busy) return;
    // Ignore repeat clicks (e.g. a double-click on Start) until the action finishes.
    el.dataset.busy = "1";
    try {
      await actions[el.dataset.action](el, event);
    } finally {
      delete el.dataset.busy;
    }
  });

  document.addEventListener("submit", async (event) => {
    const form = event.target;
    const handler = forms[form.dataset.form];
    if (!handler) return;
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      await handler(form, formValues(form), event);
    } finally {
      if (submit && submit.isConnected) submit.disabled = false;
    }
  });
}

/** Form contents as a plain object. Checkboxes become true/false. */
export function formValues(form) {
  const values = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === "checkbox") values[el.name] = el.checked;
    else if (el.type === "radio") {
      if (el.checked) values[el.name] = el.value;
    } else values[el.name] = el.value;
  }
  return values;
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

const modalStack = [];

export function isModalOpen() {
  return modalStack.length > 0;
}

export function openModal({ title, body, size = "", onMount, onClose }) {
  const root = document.getElementById("modal-root");
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal ${size}" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h2>${esc(title)}</h2>
        <button type="button" class="icon-button" data-modal-close aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">${body}</div>
    </div>`;
  root.appendChild(backdrop);

  const modal = {
    el: backdrop.querySelector(".modal"),
    close() {
      const i = modalStack.indexOf(modal);
      if (i >= 0) modalStack.splice(i, 1);
      backdrop.remove();
      if (onClose) onClose();
    },
  };
  modalStack.push(modal);

  backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) modal.close();
  });
  backdrop.addEventListener("click", (event) => {
    if (event.target.closest("[data-modal-close]")) modal.close();
  });

  if (onMount) onMount(modal.el, modal);
  const firstInput = modal.el.querySelector("input:not([type=hidden]):not([type=checkbox]), select, textarea");
  if (firstInput && !firstInput.dataset.noAutofocus) firstInput.focus();
  return modal;
}

export function closeTopModal() {
  const top = modalStack[modalStack.length - 1];
  if (top) {
    top.close();
    return true;
  }
  return false;
}

export function confirmDialog(message, { confirmText = "Delete", danger = true, title = "Are you sure?" } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const modal = openModal({
      title,
      size: "narrow",
      body: `
        <p style="margin-top:0">${esc(message)}</p>
        <div class="form-actions">
          <button type="button" class="btn" data-answer="no">Cancel</button>
          <button type="button" class="btn ${danger ? "danger" : "primary"}" data-answer="yes">${esc(confirmText)}</button>
        </div>`,
      onMount(el) {
        el.querySelector('[data-answer="yes"]').focus();
        el.addEventListener("click", (event) => {
          const btn = event.target.closest("[data-answer]");
          if (!btn) return;
          answered = true;
          modal.close();
          resolve(btn.dataset.answer === "yes");
        });
      },
      onClose() {
        if (!answered) resolve(false);
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Saving files: a save dialog where the browser has one (desktop Chrome/Edge),
// the share sheet on phones ("Save to Files", Drive, email...), otherwise a
// plain download. Returns false if the person cancelled.
// ---------------------------------------------------------------------------

export async function saveFile(blob, filename, { pickerTypes } = {}) {
  if (isMobileApp()) {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return true;
      } catch (err) {
        if (err && err.name === "AbortError") return false;
        // Phones only allow the share sheet right after a tap, and preparing
        // the file may have taken too long, so ask for one more tap.
        return new Promise((resolve) => {
          let sharing = false;
          const modal = openModal({
            title: "Your file is ready",
            size: "narrow",
            body: `
              <p style="margin-top:0">${esc(filename)}</p>
              <div class="form-actions">
                <button type="button" class="btn" data-modal-close>Cancel</button>
                <button type="button" class="btn primary" data-share-file>Save or share&hellip;</button>
              </div>`,
            onMount(el) {
              el.querySelector("[data-share-file]").addEventListener("click", () => {
                const shared = navigator.share({ files: [file] });
                sharing = true;
                modal.close();
                shared.then(
                  () => resolve(true),
                  () => resolve(false)
                );
              });
            },
            onClose: () => {
              if (!sharing) resolve(false);
            },
          });
        });
      }
    }
  } else if (pickerTypes && window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: filename, types: pickerTypes });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (err) {
      if (err && err.name === "AbortError") return false;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

// ---------------------------------------------------------------------------
// Period picker: configured weekday period vs a custom date range.
// ---------------------------------------------------------------------------

export function openPeriodPicker({ configuredLabel, current, onApply }) {
  const isCustom = Boolean(current);
  openModal({
    title: "Choose a time period",
    size: "narrow",
    body: `
      <form data-period-form class="stack" style="gap:0.8rem">
        <label class="checkbox"><input type="radio" name="mode" value="configured" ${isCustom ? "" : "checked"}> Day-to-day period (${esc(configuredLabel)})</label>
        <label class="checkbox"><input type="radio" name="mode" value="custom" ${isCustom ? "checked" : ""}> Custom date range</label>
        <div class="grid grid-2 custom-range ${isCustom ? "" : "hidden"}">
          <label class="field"><span>From</span><input type="date" name="start" value="${esc(current?.start || "")}"></label>
          <label class="field"><span>To</span><input type="date" name="end" value="${esc(current?.end || "")}"></label>
        </div>
        <div class="form-actions">
          <button type="button" class="btn" data-modal-close>Cancel</button>
          <button type="submit" class="btn primary">Apply</button>
        </div>
      </form>`,
    onMount(el, modal) {
      const form = el.querySelector("[data-period-form]");
      const range = form.querySelector(".custom-range");
      form.addEventListener("change", () => {
        range.classList.toggle("hidden", form.mode.value !== "custom");
      });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (form.mode.value === "custom") {
          if (!form.start.value || !form.end.value) {
            (form.start.value ? form.end : form.start).focus();
            return;
          }
          onApply({ start: form.start.value, end: form.end.value });
        } else {
          onApply(null);
        }
        modal.close();
      });
    },
  });
}
