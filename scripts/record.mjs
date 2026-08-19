/* Record the running app to an MP4, with no recorder app and no npm install.
 *
 *   npm run dev
 *   node scripts/record.mjs out.mp4 40
 *
 * Chrome paints -> Page.screencastFrame gives us a JPEG -> ffmpeg joins them
 * with their real arrival times. Traps and why they exist: docs/RECORDING.md
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(process.argv[2] ?? "out.mp4");
const SECONDS = Number(process.argv[3] ?? 30);
const APP = process.env.APP_URL ?? "http://localhost:3000";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9401;
const DIR = path.join(path.dirname(OUT), ".frames");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// One CDP hiccup must not destroy a long take.
process.on("unhandledRejection", (e) => console.log("  [tolerated]", String(e).slice(0, 100)));

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

spawn(CHROME, [`--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(DIR, "..", ".chrome")}`,
  "--no-first-run", "--no-default-browser-check",
  "--window-size=1420,920", "--force-device-scale-factor=1", "about:blank"],
  { stdio: "ignore" });

let ws, id = 0, session;
const pending = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    if (j.webSocketDebuggerUrl) { ws = new WebSocket(j.webSocketDebuggerUrl); break; }
  } catch {}
  await sleep(500);
}
await new Promise((r) => ws.addEventListener("open", r));

let frames = [], lastAt = null, on = false;
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  } else if (m.method === "Page.screencastFrame") {
    const now = Date.now();
    if (lastAt && frames.length) frames.at(-1).dur = (now - lastAt) / 1000;
    lastAt = now;
    if (on) {
      const f = path.join(DIR, `f${String(frames.length).padStart(6, "0")}.jpg`);
      fs.writeFileSync(f, Buffer.from(m.params.data, "base64"));
      frames.push({ f, dur: 0.1 });
    }
    // TRAP 2: without this ack the stream dies after ~5 frames, silently.
    send("Page.screencastFrameAck", { sessionId: m.params.sessionId });
  }
});
function send(method, params = {}) {
  const n = ++id;
  ws.send(JSON.stringify({ id: n, method, params, ...(session && { sessionId: session }) }));
  return new Promise((res, rej) => pending.set(n, { res, rej }));
}

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
({ sessionId: session } = await send("Target.attachToTarget", { targetId, flatten: true }));
await send("Page.enable"); await send("Runtime.enable");

const js = (fn) => send("Runtime.evaluate",
  { expression: `(${fn})()`, awaitPromise: true, returnByValue: true }).then(r => r.result?.value);

// TRAP 4: backgroundColor forces a PAINT. transform/opacity are GPU-composited
// and produce no new frame. Keeps DOM pages emitting frames while idle.
const pump = () => js(`() => { if (window.__p) return; const d = document.createElement('div');
  d.style.cssText='position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:.01;pointer-events:none';
  document.body.appendChild(d); window.__p = d; let i = 0;
  (function t(){ d.style.backgroundColor = (++i%2)?'rgb(136,136,136)':'rgb(137,137,137)';
    requestAnimationFrame(t); })(); }`);

// TRAP 3: a still WebGL canvas never repaints, so it emits NO frames. Drift the
// camera instead of standing still. Falls back to a plain wait with no canvas.
const hold = (ms) => js(`async () => { const c = document.querySelector('canvas');
  const until = Date.now() + ${ms};
  if (!c) { await new Promise(r=>setTimeout(r,${ms})); return; }
  const b = c.getBoundingClientRect();
  let x = b.left+b.width*.5, y = b.top+b.height*.62, dir = 1, n = 0;
  const ev = (t,o) => c.dispatchEvent(new PointerEvent(t,{bubbles:true,pointerId:7,...o}));
  while (Date.now() < until) {
    ev('pointerdown',{clientX:x,clientY:y,button:0});
    for (let i=0;i<6 && Date.now()<until;i++) { x += 0.9*dir;
      ev('pointermove',{clientX:x,clientY:y}); await new Promise(r=>setTimeout(r,55)); }
    ev('pointerup',{clientX:x,clientY:y,button:0});
    if (++n % 14 === 0) dir *= -1;                    // drift back, never spin away
  } }`);

const goto = async (url, settle = 4000) => {
  await send("Page.navigate", { url });
  await sleep(2000);
  try { await pump(); } catch { await sleep(600); try { await pump(); } catch {} }
  await sleep(Math.max(settle - 2000, 0));
};
const scroll = (to, step = 12) => js(`async () => { for (let y=0;y<${to};y+=${step})
  { scrollTo(0,y); await new Promise(r=>setTimeout(r,24)); } }`);
const caption = (t, ms = 3000) => js(`async () => {
  let e = document.getElementById('__c');
  if (!e) { e = document.createElement('div'); e.id='__c';
    e.style.cssText='position:fixed;left:50%;bottom:42px;transform:translateX(-50%);z-index:2147483647;'+
    'pointer-events:none;font:500 18px/1.45 system-ui,sans-serif;color:#fff;background:rgba(10,10,15,.88);'+
    'padding:10px 20px;border-radius:4px;opacity:0;transition:opacity .4s';
    document.body.appendChild(e); }
  e.textContent = ${JSON.stringify(t)}; e.style.opacity='1';
  await new Promise(r=>setTimeout(r,${ms})); e.style.opacity='0'; }`);

/* ---- EDIT THIS: what gets recorded ---------------------------------- */
async function story() {
  await goto(APP, 5000);
  await caption("DarDesign — the landing", 3000);
  await scroll(4000);
  await sleep(Math.max(SECONDS * 1000 - 20000, 2000));
}
/* --------------------------------------------------------------------- */

await goto(APP, 4000);
await send("Page.startScreencast",
  { format: "jpeg", quality: 62, maxWidth: 1100, maxHeight: 700, everyNthFrame: 1 });
on = true; await sleep(800);
console.log("recording…");
await story();
on = false;
await send("Page.stopScreencast");
await sleep(400);

if (!frames.length) { console.log("NO FRAMES — see traps 2/3/4 in docs/RECORDING.md"); process.exit(1); }
frames.at(-1).dur = 1.5;
const q = (f) => f.split(String.fromCharCode(92)).join("/");
const list = path.join(DIR, "list.txt");
// TRAP 5: clamp, or one idle pause becomes a 40-second still.
// TRAP 6: concat ignores the LAST duration, so the final file line is repeated.
fs.writeFileSync(list,
  frames.map(f => `file '${q(f.f)}'\nduration ${Math.min(Math.max(f.dur, .016), 6).toFixed(3)}`).join("\n")
  + `\nfile '${q(frames.at(-1).f)}'\n`);

// TRAP 6: libx264 rejects an odd height; letterbox to one even size.
const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list,
  "-vf", "scale=1100:640:force_original_aspect_ratio=decrease,pad=1100:640:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1",
  "-fps_mode", "cfr", "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
  "-pix_fmt", "yuv420p", "-movflags", "+faststart", OUT], { encoding: "utf8" });
if (r.status !== 0) { console.log("ENCODE FAILED", (r.stderr || "").slice(0, 400)); process.exit(1); }

fs.rmSync(DIR, { recursive: true, force: true });
console.log(`${frames.length} frames -> ${OUT} (${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB)`);
process.exit(0);
