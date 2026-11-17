"use client";

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: opts.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
    ...opts,
    body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data };
}

export function deviceId() {
  try {
    let id = localStorage.getItem("sg-device");
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
      localStorage.setItem("sg-device", id);
    }
    return id;
  } catch {
    return "web";
  }
}

export function fmtTime(iso) {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
}

export function fmtDay(iso) {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

export function fmtAgo(iso) {
  if (!iso) return "";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return s <= 3 ? "just now" : `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function fmtDur(s) {
  s = Math.max(0, Math.floor(s || 0));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/* deterministic local avatar — initials + hue from seed. No external API, so
   it can't break/rate-limit the way the old dicebear URLs did. */
export function avatarFor(seed) {
  const s = String(seed || "user");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const digits = s.replace(/\D/g, "");
  const initials = digits ? digits.slice(-2) : s.replace(/[^a-z]/gi, "").slice(0, 2).toUpperCase() || "?";
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128'>` +
    `<rect width='128' height='128' fill='hsl(${hue},55%,52%)'/>` +
    `<text x='64' y='80' font-size='46' font-family='Arial,Helvetica,sans-serif' font-weight='600' fill='rgba(255,255,255,.95)' text-anchor='middle'>${initials}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/* -------- synthesized sounds (no assets needed) -------- */

let ac = null;
function ctx() {
  if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch {} }
  if (ac && ac.state === "suspended") ac.resume().catch(() => {});
  return ac;
}

function tone(freq, t0, dur, gain = 0.12, type = "sine") {
  const a = ctx();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, a.currentTime + t0);
  g.gain.exponentialRampToValueAtTime(gain, a.currentTime + t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + t0);
  o.stop(a.currentTime + t0 + dur + 0.05);
}

export const sfx = {
  msgIn() { tone(880, 0, 0.12, 0.1); tone(1320, 0.08, 0.14, 0.08); },
  msgOut() { tone(660, 0, 0.1, 0.08); },
};

let ringTimer = null;
export function ringtoneStart() {
  ringtoneStop();
  const cycle = () => { tone(440, 0, 0.4, 0.09); tone(480, 0.5, 0.4, 0.09); };
  cycle();
  ringTimer = setInterval(cycle, 2000);
}
export function ringtoneStop() {
  if (ringTimer) { clearInterval(ringTimer); ringTimer = null; }
}

let outTimer = null;
export function outRingStart() {
  outRingStop();
  const cycle = () => { tone(425, 0, 1.0, 0.07); };
  cycle();
  outTimer = setInterval(cycle, 3000);
}
export function outRingStop() {
  if (outTimer) { clearInterval(outTimer); outTimer = null; }
}

/* -------- push + OS notifications -------- */

function urlB64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/* registers the SW + subscribes web-push; works for user and admin sessions */
export async function subscribePush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  const reg = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
  await navigator.serviceWorker.ready;
  const k = await (await fetch("/api/push/key", { cache: "no-store" })).json();
  if (!k?.key) throw new Error("Push is not configured on this server");
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlB64ToUint8Array(k.key),
  });
  await api("/api/push/subscribe", { method: "POST", body: sub.toJSON() });
  return true;
}

/* OS-level notification while the tab is open but not focused — needs
   Notification.permission granted (push subscription covers closed tabs). */
export function osNotify(title, body, tag) {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if (document.visibilityState === "visible" && document.hasFocus()) return;
    const n = new Notification(title, {
      body,
      tag: tag || "support",
      icon: "/app/icon-192.png?v=3",
      badge: "/app/icon-192.png?v=3",
      renotify: true,
    });
    n.onclick = () => { try { window.focus(); } catch {} n.close(); };
  } catch {}
}

/* -------- message helpers -------- */

export function isSticker(m) {
  return typeof m === "string" && m.startsWith("sticker:");
}
export function stickerKind(m) {
  return m?.startsWith("sticker:emoji:") ? "emoji" : "img";
}
export function stickerValue(m) {
  return m?.startsWith("sticker:emoji:") ? m.slice(14) : m?.slice(8);
}

export function callInfo(m) {
  try {
    const v = typeof m === "string" ? JSON.parse(m) : m;
    if (v && typeof v === "object" && "status" in v) return v;
  } catch {}
  return null;
}

/* downloads a vCard 3.0 (.vcf) with the avatar baked in as base64 PNG —
   agents tap it to import the customer into their phone contacts */
export async function downloadContact({ name, phone, avatarSrc }) {
  let photoB64 = "";
  try {
    photoB64 = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = c.height = 128;
          c.getContext("2d").drawImage(img, 0, 0, 128, 128);
          resolve((c.toDataURL("image/png").split(",")[1]) || "");
        } catch { resolve(""); }
      };
      img.onerror = () => resolve("");
      img.src = avatarSrc;
    });
  } catch {}

  const esc = (s) =>
    String(s ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/[;,:]/g, (m) => "\\" + m)
      .replace(/\r?\n/g, "\\n");

  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${esc(name)}`,
    `TEL;TYPE=CELL,VOICE:${String(phone || "").replace(/[^\d+]/g, "")}`,
  ];
  if (photoB64) lines.push(`PHOTO;ENCODING=b;TYPE=PNG:${photoB64}`);
  lines.push("END:VCARD");

  // RFC 2426: fold content lines at 75 chars, continuation lines start with a space
  const folded = [];
  for (const l of lines) {
    if (l.length <= 75) { folded.push(l); continue; }
    folded.push(l.slice(0, 75));
    for (let i = 75; i < l.length; i += 74) folded.push(" " + l.slice(i, i + 74));
  }

  const blob = new Blob([folded.join("\r\n")], { type: "text/vcard" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(name || "contact").replace(/[^\w -]/g, "").trim() || "contact"}.vcf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
