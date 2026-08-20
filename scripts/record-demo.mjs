/* DarDesign demo recorder — segmented. This is the long-form companion to
 * scripts/record.mjs, which docs/RECORDING.md describes.
 *
 *   node scripts/record-demo.mjs          record every segment
 *   node scripts/record-demo.mjs 3,5      re-shoot only segments 3 and 5
 *
 * Method and traps: docs/RECORDING.md. Segmented because a nine-minute single
 * take that fails at minute eight costs nine minutes; here it costs one beat.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OUTDIR = path.resolve("scratchpad/segments");
const APP = process.env.APP_URL ?? "http://localhost:3000";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9421;
const FRAMES = path.join(OUTDIR, ".frames");
const ONLY = (process.argv[2] ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const W = 1100, H = 640;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on("unhandledRejection", (e) => console.log("  [tolerated]", String(e).slice(0, 90)));

fs.mkdirSync(OUTDIR, { recursive: true });
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

// The script exits with process.exit(0) and never closes Chrome, so the browser
// from the previous run keeps PORT bound. The next run's spawn then loses the
// race, attaches to the STALE browser, and records whatever that one is showing
// -- which is how three segments came back as "NO FRAMES" and a 1-frame clip.
// Kill whatever already holds the port before spawning.
try {
  const netstat = spawnSync("cmd",
    ["/c", "netstat -ano | findstr LISTENING | findstr :" + PORT],
    { encoding: "utf8" }).stdout || "";
  const lines = netstat.trim().split(/\r?\n/);
  const pids = [...new Set(lines.map((l) => l.trim().split(/\s+/).pop())
    .filter((x) => /^[0-9]+$/.test(x)))];
  for (const pid of pids) {
    spawnSync("taskkill", ["/PID", pid, "/F", "/T"], { encoding: "utf8" });
    console.log("killed stale chrome pid " + pid + " on port " + PORT);
  }
  if (pids.length) await sleep(1500);
} catch {}

spawn(CHROME, [
  "--remote-debugging-port=" + PORT,
  "--user-data-dir=" + path.join(OUTDIR, ".chrome"),
  "--no-first-run", "--no-default-browser-check",
  "--window-size=1420,920", "--force-device-scale-factor=1",
  "--autoplay-policy=no-user-gesture-required", "about:blank",
], { stdio: "ignore" });

let ws, id = 0, session;
const pending = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const j = await (await fetch("http://127.0.0.1:" + PORT + "/json/version")).json();
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
      const f = path.join(FRAMES, "f" + String(frames.length).padStart(6, "0") + ".jpg");
      fs.writeFileSync(f, Buffer.from(m.params.data, "base64"));
      frames.push({ f, dur: 0.1 });
    }
    send("Page.screencastFrameAck", { sessionId: m.params.sessionId });   // TRAP 2
  }
});
function send(method, params = {}) {
  const n = ++id;
  ws.send(JSON.stringify({ id: n, method, params, ...(session && { sessionId: session }) }));
  return new Promise((res, rej) => pending.set(n, { res, rej }));
}

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
({ sessionId: session } = await send("Target.attachToTarget", { targetId, flatten: true }));
await send("Page.enable");
await send("Runtime.enable");
await send("DOM.enable");

const js = (src) => send("Runtime.evaluate",
  { expression: "(" + src + ")()", awaitPromise: true, returnByValue: true })
  .then((r) => r.result && r.result.value);

// TRAP 4: backgroundColor forces a paint; transform/opacity are GPU-composited
// and produce no new frame at all.
const pump = () => js(`() => { if (window.__p) return; const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:.01;pointer-events:none';
  document.body.appendChild(d); window.__p = d; let i = 0;
  (function t(){ d.style.backgroundColor = (++i % 2) ? 'rgb(136,136,136)' : 'rgb(137,137,137)';
    requestAnimationFrame(t); })(); }`);

// TRAP 3: a still WebGL canvas never repaints, so it emits no frames. Drift the
// camera a pixel at a time instead of standing still.
const hold = (ms) => js(`async () => { const c = document.querySelector('canvas');
  const until = Date.now() + ${ms};
  if (!c) { await new Promise(r => setTimeout(r, ${ms})); return; }
  const b = c.getBoundingClientRect();
  let x = b.left + b.width * 0.5, y = b.top + b.height * 0.62, dir = 1, n = 0;
  const ev = (t, o) => c.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerId: 7, ...o }));
  while (Date.now() < until) {
    ev('pointerdown', { clientX: x, clientY: y, button: 0 });
    for (let i = 0; i < 6 && Date.now() < until; i++) { x += 0.9 * dir;
      ev('pointermove', { clientX: x, clientY: y }); await new Promise(r => setTimeout(r, 55)); }
    ev('pointerup', { clientX: x, clientY: y, button: 0 });
    if (++n % 14 === 0) dir *= -1;
  } }`);

const goto = async (url, settle = 4500) => {
  await send("Page.navigate", { url });
  await sleep(2200);
  try { await pump(); } catch { await sleep(600); try { await pump(); } catch {} }
  await sleep(Math.max(settle - 2200, 0));
};
const scroll = (to, step = 10) => js(`async () => { for (let y = 0; y < ${to}; y += ${step})
  { scrollTo(0, y); await new Promise(r => setTimeout(r, 26)); } }`);
const scrollTop = () => js("() => scrollTo(0,0)");

// Muted autoplay is the norm on LinkedIn, so the text has to carry the story.
const caption = (t, ms = 3400) => js(`async () => {
  let e = document.getElementById('__c');
  if (!e) { e = document.createElement('div'); e.id = '__c';
    e.style.cssText = 'position:fixed;left:50%;bottom:38px;transform:translateX(-50%);z-index:2147483647;'
      + 'pointer-events:none;font:600 21px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;color:#fff;'
      + 'background:rgba(12,16,26,.9);padding:12px 24px;border-radius:6px;opacity:0;'
      + 'transition:opacity .35s;max-width:80vw;text-align:center;box-shadow:0 6px 26px rgba(0,0,0,.35)';
    document.body.appendChild(e); }
  e.textContent = ${JSON.stringify(t)}; e.style.opacity = '1';
  await new Promise(r => setTimeout(r, ${ms}));
  e.style.opacity = '0'; await new Promise(r => setTimeout(r, 380)); }`);

const clickText = (re, ms = 900) => js(`async () => {
  const rx = new RegExp(${JSON.stringify(re)}, 'i');
  const side = document.querySelector('.app-sidebar');
  const b = [...document.querySelectorAll('button,a,[role=tab],[role=button]')]
    .filter(x => !side || !side.contains(x))
    .find(x => rx.test((x.textContent || '').replace(/\\s+/g, ' ')));
  if (!b) return 'MISS:' + ${JSON.stringify(re)};
  b.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 260));
  b.click(); await new Promise(r => setTimeout(r, ${ms})); return 'ok'; }`);

// React ignores a raw .value assignment; go through the native setter it patches.
const typeInto = (sel, text, ms = 1100) => js(`async () => {
  const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'MISS';
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const set = Object.getOwnPropertyDescriptor(proto, 'value').set;
  el.focus(); set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true }));
  const t = ${JSON.stringify(text)};
  for (let i = 1; i <= t.length; i++) { set.call(el, t.slice(0, i));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 26)); }
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, ${ms})); return 'ok'; }`);

// Some controls collide with nav text ("Plan the room" vs "Plan & usage"), so
// target those by class instead of by words. That collision navigated a whole
// take to /subscription and recorded it for forty seconds.
const clickSel = (sel, ms = 1000) => js(`async () => {
  const b = document.querySelector(${JSON.stringify(sel)});
  if (!b) return 'MISS:' + ${JSON.stringify(sel)};
  b.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 240));
  b.click(); await new Promise(r => setTimeout(r, ${ms})); return 'ok'; }`);

async function uploadPhoto(absPath) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const doc = await send("DOM.getDocument", { depth: 1 });
      const q = await send("DOM.querySelector",
        { nodeId: doc.root.nodeId, selector: "input[type=file]" });
      if (q.nodeId) {
        await send("DOM.setFileInputFiles", { files: [absPath], nodeId: q.nodeId });
        await sleep(2500);
        // The dropzone text changes once a file is accepted; that is the proof.
        const took = await js(`() => !/lay your photograph here/i.test(document.body.innerText)`);
        if (took) { console.log("    upload: ok (attempt " + attempt + ")"); return true; }
      }
    } catch (e) { /* retry */ }
    await sleep(1500);
  }
  console.log("    upload: FAILED after 5 attempts");
  return false;
}

// Clicking a culture card is only real if it ends up selected.
async function pickCulture(name) {
  for (let i = 0; i < 4; i++) {
    await clickText("^\s*" + name, 1200);
    const on = await js(`() => [...document.querySelectorAll('.style-card')]
      .some(c => /selected/.test(c.className) && new RegExp('^\\s*' + ${JSON.stringify(name)}, 'i')
        .test((c.textContent || '').trim()))`);
    if (on) return true;
    await sleep(900);
  }
  console.log("    pick " + name + ": FAILED");
  return false;
}

async function login() {
  await goto(APP + "/login", 4000);
  await typeInto("#email", "darwechzainab@gmail.com", 300);
  await typeInto("#password", "DarDesign2026!", 300);
  await clickText("^\\s*Sign in\\s*$", 3800);
}

// The panel has TWO .plan-go buttons: one runs the plan, one applies it.
// querySelector returns the first, so clicking only that computes a plan and
// leaves the room untouched — which is exactly how the first take came back
// with an empty room and a full panel.
const clickApply = (ms = 2600) => js(`async () => {
  const b = [...document.querySelectorAll('.plan-go')]
    .find(x => /^\s*apply/i.test((x.textContent || '')));
  if (!b) return 'NO-APPLY';
  b.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 260));
  b.click(); await new Promise(r => setTimeout(r, ${ms})); return 'applied'; }`);

// One brief, end to end: type it, run it, WAIT for the model, apply it.
// The wait is a poll rather than a fixed sleep: the planner takes anywhere from
// 11 to 35 seconds depending on the model and the brief, and a fixed hold that
// is too short clicks nothing and leaves the room untouched.
const applyReady = () => js(`() => [...document.querySelectorAll('.plan-go')]
  .some(x => /^\s*apply/i.test(x.textContent || ''))`);

async function planAndApply(text, maxWaitMs = 70000) {
  await clickText("Describe your room", 1400);
  await typeInto("textarea", text, 700);
  await clickSel(".plan-go", 1200);
  const until = Date.now() + maxWaitMs;
  let ready = false;
  while (Date.now() < until) {
    await hold(2000);                       // keeps the canvas emitting frames
    if (await applyReady()) { ready = true; break; }
  }
  if (!ready) { console.log("    apply: TIMED OUT after", maxWaitMs, "ms"); await hold(3000); return false; }
  const r = await clickApply(3000);
  console.log("    apply:", r);
  await hold(4500);
  return true;
}

// Build Mode persists its scene to localStorage, so a re-shoot inherits the
// previous take's furniture — and a caption that says "this is an empty room"
// then narrates over a full one. Wipe before any segment that claims empty.
const clearScene = () => js(`() => { let n = 0;
  for (const k of Object.keys(localStorage)) {
    if (/^dar-scene-v3:/.test(k)) { localStorage.removeItem(k); n++; }
  }
  sessionStorage.removeItem('dar-build-handoff');
  return 'cleared ' + n; }`);

// A live three-culture render on a borrowed T4 runs well past any fixed hold —
// the take above was still at 02:39 when the segment ended. Poll for the reveal
// instead, and keep the canvas painting while waiting.
const revealReady = () => js(`() => {
  const side = document.querySelector('.app-sidebar');
  return [...document.querySelectorAll('button')]
    .filter(b => !side || !side.contains(b))
    .some(b => /^\s*(KHALEEJI|MOROCCAN|LEBANESE)\s*$/.test((b.textContent || '').trim()));
}`);
async function waitForReveal(maxMs = 600000) {
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    await hold(2500);
    if (await revealReady()) return true;
  }
  return false;
}

// The theme and language toggles are icon-only buttons INSIDE the sidebar, and
// clickText deliberately excludes the sidebar, so they could never be hit.
const clickChrome = (which, ms = 2600) => js(`async () => {
  const side = document.querySelector('.app-sidebar') || document;
  const all = [...side.querySelectorAll('button')];
  const lang = all.find(b => /^\s*(ع|EN)\s*$/.test((b.textContent || '').trim()));
  const theme = all.find(b => b !== lang && /app-icon-button/.test(b.className || '')
    && !/language/.test(b.className || ''));
  const b = ${JSON.stringify("x")} === 'x' && ${JSON.stringify(0)} === 0
    ? (${JSON.stringify(which)} === 'lang' ? lang : theme) : null;
  if (!b) return 'MISS:' + ${JSON.stringify(which)};
  b.click(); await new Promise(r => setTimeout(r, ${ms}));
  return document.documentElement.getAttribute('data-theme') + '/' +
         document.documentElement.getAttribute('lang'); }`);

const CARDS = path.resolve("scripts/demo-cards").split(path.sep).join("/");

// An explainer card is just a local HTML page, so the paint pump covers it.
async function card(name, ms = 5200) {
  await goto("file:///" + CARDS + "/" + name + ".html", 3000);
  await hold(ms);
}

// Open the finished render in a REAL new tab and record it there. Two traps:
// Chrome blocks top-level data: navigation, so the data URL has to become a
// blob first; and the screencast is bound to one session, so the new tab needs
// its own attach + startScreencast or it records nothing at all.
async function openRenderInNewTab(ms = 7000) {
  const made = await js(`async () => {
    const imgs = [...document.querySelectorAll('img')]
      .filter(i => (i.src || '').startsWith('data:image') && i.naturalWidth > 400);
    if (!imgs.length) return 'NO-IMAGE';
    const src = imgs[imgs.length - 1].src;
    const blob = await (await fetch(src)).blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    return url;
  }`);
  if (typeof made !== "string" || made === "NO-IMAGE") {
    console.log("    newtab: no render image found");
    return false;
  }
  await sleep(1800);
  const got = await send("Target.getTargets");
  const tab = (got.targetInfos || [])
    .filter((t) => t.type === "page" && /^blob:/.test(t.url)).pop();
  if (!tab) { console.log("    newtab: blob tab not found"); return false; }

  await send("Page.stopScreencast");
  const att = await send("Target.attachToTarget", { targetId: tab.targetId, flatten: true });
  const prev = session;
  session = att.sessionId;                       // route sends to the new tab
  await send("Page.enable");
  await send("Runtime.enable");
  try { await pump(); } catch {}
  await send("Page.startScreencast",
    { format: "jpeg", quality: 64, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  await sleep(ms);
  await send("Page.stopScreencast");
  await send("Target.closeTarget", { targetId: tab.targetId });
  session = prev;                                // back to the app
  await send("Page.startScreencast",
    { format: "jpeg", quality: 64, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  await sleep(600);
  console.log("    newtab: recorded");
  return true;
}

/* ------------------------------ segments ------------------------------ */
const SEGMENTS = [];
const seg = (name, fn) => SEGMENTS.push({ name, fn });

/* ---------- chapters that need NO GPU ---------- */

seg("01-coldopen", async () => {
  await goto(APP + "/design", 6000);
  await clearScene();
  await goto(APP + "/design", 9000);
  await caption("This is an empty room.", 3000);
  await hold(2500);
  await caption("Watch what happens when you ask an AI for something absurd.", 4200);
  await planAndApply("Give me 50 coffee tables, 12 sofas and 25 chairs. Do not overlap anything.", 110000);
  await caption("Fifty coffee tables asked for.", 3000);
  await hold(3000);
  await caption("It understood — then the geometry engine kept only what actually fits.", 4800);
  await hold(6000);
});

seg("02-card-problem", async () => { await card("01-problem", 6000); });

seg("03-landing", async () => {
  await goto(APP, 6500);
  await caption("This is DarDesign.", 2800);
  await scroll(1400); await hold(1600);
  await caption("An AI interior designer for Lebanese, Khaleeji and Moroccan homes.", 4200);
  await scroll(3200); await hold(1800);
  await scroll(5200); await hold(2200);
  await caption("Every element it uses is named, in Arabic and English, and sourced.", 4400);
  await scroll(7000); await hold(2600);
});

seg("04-card-how", async () => { await card("02-howitworks", 7000); });

seg("11-card-gates", async () => { await card("03-gates", 8500); });

seg("12-scenarios", async () => {
  await goto(APP + "/design", 6000);
  await clearScene();
  await goto(APP + "/design", 9000);
  await caption("You describe the room. It designs it.", 3400);
  await planAndApply("Seven guests are coming tonight. Make it a warm Lebanese living room.");
  await caption("I gave it the goal — not coordinates, not a furniture list.", 4400);
  await hold(4000);
  await caption("Now change your mind.", 2600);
  await planAndApply("Make it Moroccan.");
  await caption("Furniture swapped. Seating pushed to the walls — a Moroccan convention.", 5000);
  await hold(4000);
  await caption("Ask for one specific change.", 2600);
  await planAndApply("Remove one chair.");
  await caption("One chair. Not a redesign.", 3200);
  await hold(3500);
  await caption("And ask for something that does not exist.", 3400);
  await planAndApply("Add a grand piano and an aquarium.");
  await caption("No grand piano in the catalogue — so it cannot invent one.", 5000);
  await hold(5000);
});

seg("13-buildmode", async () => {
  await goto(APP + "/design", 9000);
  await caption("Everything stays editable, in real centimetres.", 3600);
  await hold(3500);
  await clickText("^\\s*Plan\\s*$", 2600);
  await caption("A measured plan of the room.", 3000);
  await hold(3500);
  await clickText("^\\s*Corner\\s*$", 2600);
  await caption("Real materials, and four times of day.", 3400);
  await clickText("^\\s*Sunset\\s*$", 2400); await hold(3500);
  await clickText("^\\s*Night\\s*$", 2400);   await hold(3500);
  await clickText("^\\s*Morning\\s*$", 2400); await hold(3000);
  await clickText("^\\s*Afternoon\\s*$", 2000); await hold(2000);
  await caption("Undo takes back a whole AI plan in one step.", 3800);
  await clickText("^\\s*↶\\s*$", 1600);
  await clickText("^\\s*↶\\s*$", 1600);
  await hold(2500);
  await clickText("^\\s*↷\\s*$", 1600);
  await hold(3000);
});

seg("16-theme", async () => {
  await goto(APP + "/history", 7000);
  await caption("Two skins.", 2600);
  await hold(2000);
  console.log("    theme ->", await clickChrome("theme", 3000));
  await caption("Dark, for working at night.", 3200);
  await hold(3500);
  console.log("    theme ->", await clickChrome("theme", 3000));
  await caption("Light, tuned for a projector.", 3400);
  await hold(3500);
});

seg("17-arabic", async () => {
  await goto(APP + "/studio", 7000);
  await caption("And it is genuinely bilingual.", 3000);
  await hold(2000);
  console.log("    lang ->", await clickChrome("lang", 3400));
  await caption("Arabic, right to left — the layout mirrors, not just the words.", 4800);
  await hold(4500);
  await scroll(800); await hold(4000);
  console.log("    lang ->", await clickChrome("lang", 3000));
  await hold(2000);
});

seg("18-library", async () => {
  await goto(APP + "/history", 7000);
  await caption("Every design is saved, rated and searchable.", 3800);
  await scroll(1300); await hold(3000);
  await scroll(2700); await hold(3000);
  await goto(APP + "/others", 6500);
  await caption("There is a community gallery of other people's rooms.", 4200);
  await scroll(1500); await hold(3500);
  await goto(APP + "/subscription", 6500);
  await caption("And a real plan model — three free designs a week, or unlimited.", 4600);
  await scroll(900); await hold(4000);
});

seg("19-evaluation", async () => {
  await goto(APP + "/evaluation", 7500);
  await caption("It measures itself.", 3000);
  await scroll(1100); await hold(3500);
  await caption("SSIM for structure. LPIPS for perception. CLIP for culture.", 4600);
  await scroll(2400); await hold(3500);
  await caption("And where a value was never measured, it says so — never a zero.", 5000);
  await scroll(3800); await hold(4000);
});

seg("21-card-close", async () => { await card("05-close", 8500); });

/* ---------- chapters that REQUIRE a live GPU ---------- */

seg("05-upload", async () => {
  await goto(APP + "/studio", 8000);
  await scrollTop();
  await caption("It starts with a photograph of a real room.", 3400);
  await hold(2000);
  const up = await uploadPhoto(path.resolve("public/demo/alef-morais-IP0iPi0vB5w-unsplash/original.png"));
  if (!up) { await caption("(upload failed)", 2000); return; }
  await sleep(2500);
  await caption("Then you choose a house.", 2800);
  await pickCulture("Khaleeji"); await sleep(800);
  await pickCulture("Moroccan"); await sleep(800);
  await pickCulture("Lebanese"); await sleep(800);
  await pickCulture("All three"); await sleep(800);
  await caption("Lebanese, Khaleeji, Moroccan — all three, from one photograph.", 4600);
  await hold(2500);
});

seg("06-generate", async () => {
  await clickText("Begin the transformation", 2500);
  await caption("A real render, on a real GPU. No filter, no preset.", 4600);
  await hold(16000);
  await caption("It reads the photo once — depth, and segmentation.", 4400);
  await hold(20000);
  await caption("Then a separately trained model per culture does the rest.", 4600);
  const ok = await waitForReveal(600000);
  console.log("    reveal:", ok ? "arrived" : "not detected");
  await hold(4000);
});

seg("07-reveal", async () => {
  await caption("One photograph in. The same room, rebuilt.", 4200);
  await js(`async () => { const s = document.querySelector('[role=slider]');
    if (!s) return 'no slider';
    const b = s.getBoundingClientRect(); const y = b.top + b.height / 2;
    const ev = (t, x) => s.dispatchEvent(new PointerEvent(t,
      { bubbles: true, pointerId: 3, clientX: x, clientY: y }));
    ev('pointerdown', b.left + b.width / 2);
    let cur = b.left + b.width / 2;
    for (const to of [0.2, 0.85, 0.35, 0.65]) {
      const target = b.left + b.width * to; const step = (target - cur) / 32;
      for (let i = 0; i < 32; i++) { cur += step; ev('pointermove', cur);
        await new Promise(r => setTimeout(r, 30)); }
    }
    ev('pointerup', cur); return 'swept'; }`);
  await caption("Drag the divider: before, and after.", 3800);
  await clickText("^\\s*KHALEEJI\\s*$", 3200);
  await caption("Khaleeji.", 2600); await hold(4000);
  await clickText("^\\s*MOROCCAN\\s*$", 3200);
  await caption("Moroccan.", 2600); await hold(4000);
  await clickText("^\\s*LEBANESE\\s*$", 2600);
  await caption("Look at what did not move: the window, the corners, the depth.", 5000);
  await hold(3500);
});

seg("08-xray", async () => {
  await caption("It can prove what it understood.", 3400);
  await scroll(1000); await hold(2500);
  await js(`async () => {
    const root = document.querySelector('[class*=xray]');
    const el = root ? (root.querySelector('[role=slider]') || root.querySelector('input[type=range]') || root) : null;
    if (!el) return 'no xray control';
    const b = el.getBoundingClientRect(), y = b.top + b.height / 2;
    const ev = (t, x) => el.dispatchEvent(new PointerEvent(t,
      { bubbles: true, pointerId: 5, clientX: x, clientY: y }));
    ev('pointerdown', b.left + b.width * 0.5);
    let cur = b.left + b.width * 0.5;
    for (const to of [0.15, 0.9, 0.4]) {
      const t2 = b.left + b.width * to, st = (t2 - cur) / 34;
      for (let i = 0; i < 34; i++) { cur += st; ev('pointermove', cur);
        await new Promise(r => setTimeout(r, 30)); }
    }
    ev('pointerup', cur); return 'swept'; }`);
  await caption("Behind the render: the real depth map, and the labelled segmentation.", 5200);
  await hold(5000);
});

seg("09-understand", async () => {
  await clickText("^\\s*Understand\\s*$", 3600);
  await caption("Every element it detected, named in both languages.", 4400);
  await scroll(1100); await hold(3500);
  await caption("A measured plan, and the room's own depth in 3D.", 4400);
  await scroll(2400); await hold(3500);
  await scroll(3400); await hold(6000);
});

seg("10-edit", async () => {
  // There is no Edit tab: colour control and furniture placement are stacked
  // on the result page. The earlier take clicked a tab that does not exist and
  // simply scrolled past both.
  await caption("The render is not the end of it.", 3200);
  await scroll(1500); await hold(2500);
  console.log("    open colour:", await clickText("Change colour", 2600));
  await caption("Repaint a wall without generating anything again.", 4200);
  await hold(2500);
  console.log("    wall:", await clickText("^\s*Wall\s*$", 1600));
  // Presets carry the colour name as aria-label; pick a strong one.
  await js(`async () => {
    const b = [...document.querySelectorAll('button[aria-label]')]
      .filter(x => /rounded-lg/.test(x.className || ''));
    if (!b.length) return 'no swatch';
    b[Math.min(2, b.length - 1)].click();
    await new Promise(r => setTimeout(r, 900)); return 'picked'; }`);
  console.log("    preview:", await clickText("^\s*Preview\s*$", 5000));
  await hold(4000);
  await caption("Hue and saturation change. The brightness of every pixel is kept.", 5000);
  await hold(3000);
  console.log("    confirm:", await clickText("^\s*Confirm\s*$", 5000));
  await caption("So every shadow and highlight survives the repaint.", 4400);
  await hold(4500);
  await scroll(3600); await hold(3000);
  await caption("And real catalogue furniture can be placed into the finished render.", 4800);
  await scroll(4800); await hold(5000);
});

seg("14-render", async () => {
  await goto(APP + "/design", 9000);
  await caption("Now the part that makes this different.", 3400);
  await clickText("^\\s*Finish\\s*$", 4000);
  await hold(3500);
  await caption("DAR renders depth and segmentation from YOUR 3D scene.", 4800);
  await hold(5500);
  await clickText("Render with DAR", 3000);
  await caption("So the layout is conditioned, not guessed from a sentence.", 4800);
  const until = Date.now() + 240000;
  let done = false;
  while (Date.now() < until) {
    await hold(2500);
    const n = await js(`() => [...document.querySelectorAll('img')]
      .filter(i => (i.src || '').startsWith('data:image') && i.naturalWidth > 400).length`);
    if (typeof n === "number" && n >= 1) { done = true; break; }
  }
  console.log("    render:", done ? "arrived" : "not detected");
  await hold(4000);
  await caption("Open it full size.", 2800);
  await openRenderInNewTab(7000);
  await caption("Placement and viewpoint are held. Surface detail is still generated.", 5400);
  await hold(4000);
});

seg("15-card-holds", async () => { await card("04-holds", 7000); });

/* -------------------------------- run -------------------------------- */
function encode(name) {
  if (!frames.length) { console.log("  " + name + ": NO FRAMES"); return false; }
  frames.at(-1).dur = 1.2;
  const q = (f) => f.split(String.fromCharCode(92)).join("/");
  const list = path.join(FRAMES, "list.txt");
  // TRAP 5: clamp, or an idle pause becomes one 40-second still.
  // TRAP 6: concat ignores the LAST duration, so repeat the final file line.
  fs.writeFileSync(list,
    frames.map((f) => "file '" + q(f.f) + "'\nduration "
      + Math.min(Math.max(f.dur, 0.016), 6).toFixed(3)).join("\n")
    + "\nfile '" + q(frames.at(-1).f) + "'\n");
  const out = path.join(OUTDIR, name + ".mp4");
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list,
    "-vf", "scale=" + W + ":" + H + ":force_original_aspect_ratio=decrease,pad="
      + W + ":" + H + ":(ow-iw)/2:(oh-ih)/2:color=black,setsar=1",
    "-fps_mode", "cfr", "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { encoding: "utf8" });
  if (r.status !== 0) { console.log("  " + name + ": ENCODE FAILED", (r.stderr || "").slice(0, 300)); return false; }
  const secs = Number(spawnSync("ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out],
    { encoding: "utf8" }).stdout.trim());
  console.log("  " + name + ": " + frames.length + " frames -> " + secs.toFixed(1) + "s ("
    + (fs.statSync(out).size / 1048576).toFixed(1) + " MB)");
  for (const f of frames) { try { fs.rmSync(f.f); } catch {} }   // free disk per segment
  frames = []; lastAt = null;
  return true;
}

// Refuse to record blind. Three separate takes were lost to this: once the dev
// server had died and every frame was Chrome's ERR_CONNECTION_REFUSED page, and
// twice the page simply never painted and the segment came back as one frame.
// All three produced valid MP4s. Check the app answers, and check that frames
// are actually arriving, before spending minutes on a take.
{
  let ok = false;
  for (let i = 0; i < 3 && !ok; i++) {
    try {
      const r = await fetch(APP, { signal: AbortSignal.timeout(8000) });
      ok = r.ok;
    } catch {}
    if (!ok) await sleep(1500);
  }
  if (!ok) {
    console.log("ABORT: " + APP + " is not answering. Start the dev server first.");
    process.exit(1);
  }
  console.log("app reachable: " + APP);
}

await goto(APP, 4000);
console.log("signing in...");
await login();
console.log("signed in\n");

for (let i = 0; i < SEGMENTS.length; i++) {
  const s = SEGMENTS[i];
  const n = String(i + 1);
  if (ONLY.length && !ONLY.includes(n) && !ONLY.includes(s.name)) continue;
  console.log("[" + n + "] " + s.name + " ...");
  await send("Page.startScreencast",
    { format: "jpeg", quality: 64, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  on = true; await sleep(600);
  // Re-arm the paint pump for THIS segment: it lives on the document, so any
  // navigation since the last segment has thrown it away, and a page that never
  // repaints emits no screencast frames at all.
  try { await pump(); } catch {}
  {
    const before = frames.length;
    await js("() => document.body && (document.body.style.outline = '')");
    await sleep(1400);
    if (frames.length === before) {
      console.log("  WARNING: no frames in the first 2s — see traps 2/3/4");
    }
  }
  try { await s.fn(); } catch (e) { console.log("  [segment error]", String(e).slice(0, 120)); }
  on = false;
  await send("Page.stopScreencast"); await sleep(350);
  encode(s.name);
}
console.log("\ndone");
try { await send("Browser.close"); } catch {}
await sleep(600);
process.exit(0);
