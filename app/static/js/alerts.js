// Chime + notification when a focus timer ends.

let audioCtx = null;

// Browsers only allow audio after a user gesture, so create/resume the
// audio context on the first click anywhere.
export function installAudioUnlock() {
  const unlock = () => {
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch {
      /* no audio support */
    }
  };
  document.addEventListener("pointerdown", unlock);
  document.addEventListener("keydown", unlock);
}

export function playChime() {
  if (!audioCtx) return;
  const notes = [880, 1108.73, 1318.51];
  const start = audioCtx.currentTime + 0.02;
  for (let repeat = 0; repeat < 2; repeat++) {
    notes.forEach((freq, i) => {
      const t = start + repeat * 0.9 + i * 0.16;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.65);
    });
  }
}

export async function requestNotificationPermission() {
  if (!("Notification" in window) || Notification.permission !== "default") return;
  try {
    await Notification.requestPermission();
  } catch {
    /* ignored */
  }
}

export function notify(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body, tag: "task-organizer-focus" });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Phones (Android Chrome, iPhone home-screen apps) only allow
    // notifications through the service worker.
    navigator.serviceWorker?.getRegistration?.()
      .then((reg) => reg && reg.showNotification(title, { body, tag: "task-organizer-focus" }))
      .catch(() => {});
  }
}
