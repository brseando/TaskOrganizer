// Starts the iPhone/Android version.
//
// The screens are the same files the desktop app uses (copied into static/
// by mobile/build.py). The only difference is where the data lives: instead
// of a Python server, backend/ answers the app's /api/... requests from data
// stored on this device.

import { localApi } from "./backend/index.js";

globalThis.taskOrganizerLocalApi = localApi;

// Ask the browser not to clear the app's data when the phone runs low on space.
navigator.storage?.persist?.().catch(() => {});

// Lets the app open with no internet connection, and makes it installable.
if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Offline support unavailable:", err));
}

// main.js starts the app as soon as it loads, so it has to be imported
// after the local API is installed above.
const [{ fetchFile, onStateChange, store, toast }, { saveFile }] = await Promise.all([import("./static/js/core.js"), import("./static/js/ui.js")]);

// Backup and CSV links point at the desktop server's download URLs. There's
// no server here, so make the file on the device and hand it to the share
// sheet ("Save to Files", Google Drive, email...).
document.addEventListener(
  "click",
  async (event) => {
    const link = event.target.closest('a[href^="/api/"]');
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      const { blob, filename } = await fetchFile(link.getAttribute("href"));
      if (await saveFile(blob, filename)) toast(`Saved "${filename}".`, "success");
    } catch (err) {
      toast(err.message || "Couldn't make the file.", "error");
    }
  },
  true
);

// Remember the theme so index.html can apply it before the first paint.
onStateChange(() => {
  try {
    localStorage.setItem("taskorganizer.theme", store.state.settings.theme);
  } catch {
    /* storage unavailable */
  }
});

await import("./static/js/main.js");
