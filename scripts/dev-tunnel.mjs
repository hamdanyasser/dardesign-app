#!/usr/bin/env node
/**
 * DarDesign — one-command dev launcher against a live backend tunnel.
 *
 *   npm run dev:tunnel https://nut-resist-wal-crossing.trycloudflare.com
 *   npm run dev:tunnel            # reuse the URL already in .env.local
 *
 * The Kaggle notebook prints a fresh cloudflared/ngrok URL every session. This
 * script does the three chores that used to be manual — write .env.local,
 * confirm the backend is actually answering, start Next — so a new session is
 * one paste instead of a checklist.
 *
 * Flags (npm needs `--` before them: `npm run dev:tunnel -- <url> --set-only`):
 *   --set-only   write .env.local and health-check, but don't start Next
 *   --no-check   skip the /healthz probe (offline UI work)
 *   --any-port   allow a port other than 3000 (backend CORS must be widened)
 * Anything else is forwarded to `next dev`.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(ROOT, ".env.local");
const ENV_KEY = "NEXT_PUBLIC_API_URL";

const c = {
  gold: (s) => `\x1b[33m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

/* ── args ────────────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const setOnly = argv.includes("--set-only");
const noCheck = argv.includes("--no-check");
const anyPort = argv.includes("--any-port");
const OWN_FLAGS = new Set(["--set-only", "--no-check", "--any-port"]);
const rest = argv.filter((a) => !OWN_FLAGS.has(a));

// The URL is the first arg that looks like one. Everything else goes to Next,
// so `npm run dev:tunnel <url> -p 3001` works.
const urlIdx = rest.findIndex((a) => /^(https?:\/\/|[\w-]+\.[\w.-]+)/i.test(a));
const rawUrl = urlIdx === -1 ? null : rest[urlIdx];
const nextArgs = rest.filter((_, i) => i !== urlIdx);

/** Trim, add https:// if the scheme was left off, drop trailing slashes/paths. */
function normalize(input) {
  let s = String(input).trim().replace(/^["']|["']$/g, "");
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  // Tolerate pasting a full endpoint (…/healthz, …/redesign) — keep the origin.
  return u.origin;
}

function readEnvUrl() {
  if (!fs.existsSync(ENV_FILE)) return null;
  const m = fs
    .readFileSync(ENV_FILE, "utf8")
    .match(new RegExp(`^\\s*${ENV_KEY}\\s*=\\s*(.+)\\s*$`, "m"));
  const v = m?.[1]?.trim();
  return v && !v.includes("your-current-subdomain") ? v : null;
}

function writeEnvUrl(url) {
  const line = `${ENV_KEY}=${url}`;
  const re = new RegExp(`^\\s*${ENV_KEY}\\s*=.*$`, "m");
  if (fs.existsSync(ENV_FILE)) {
    const cur = fs.readFileSync(ENV_FILE, "utf8");
    const next = re.test(cur)
      ? cur.replace(re, line)
      : `${cur.replace(/\s*$/, "")}\n${line}\n`;
    if (next !== cur) fs.writeFileSync(ENV_FILE, next);
    return;
  }
  fs.writeFileSync(
    ENV_FILE,
    `# DarDesign frontend env — written by scripts/dev-tunnel.mjs (gitignored).\n` +
      `# The backend tunnel URL rotates every Kaggle session; re-run\n` +
      `#   npm run dev:tunnel <new-url>\n` +
      `# to point the app at the new one.\n${line}\n`,
  );
}

/* ── resolve the URL ─────────────────────────────────────────────────────── */

const url = rawUrl ? normalize(rawUrl) : readEnvUrl();
if (!url) {
  console.error(c.red("No backend URL."));
  console.error(
    `Pass the URL the Kaggle notebook printed:\n  ${c.gold(
      "npm run dev:tunnel https://<something>.trycloudflare.com",
    )}\nIt is remembered in .env.local, so later runs can just be ${c.gold(
      "npm run dev:tunnel",
    )}.`,
  );
  process.exit(1);
}
if (rawUrl && normalize(rawUrl) === null) {
  console.error(c.red(`Not a usable URL: ${rawUrl}`));
  process.exit(1);
}

const previous = readEnvUrl();
writeEnvUrl(url);
console.log(`${c.gold("backend")}  ${url}${previous === url ? c.dim("  (unchanged)") : ""}`);

/* ── health check ────────────────────────────────────────────────────────── */

async function healthz(attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(`${url}/healthz`, {
        headers: { "ngrok-skip-browser-warning": "true" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === attempts) throw e;
      console.log(c.dim(`  …tunnel not answering yet (${i}/${attempts}), retrying`));
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

if (!noCheck) {
  try {
    const h = await healthz();
    const mode = h.light_mode ? "LIGHT (placeholder PNGs)" : "real SDXL + LoRA";
    console.log(
      `${c.green("healthy")}  v${h.version} · ${mode} · queue ${h.queue_depth ?? 0}`,
    );
  } catch (e) {
    console.log(`${c.red("unreachable")}  ${e.message}`);
    console.log(
      c.dim(
        "  The landing page and /studio UI still load; only the redesign call will fail.\n" +
          "  Check the Kaggle notebook is still running and that the URL is the current one.",
      ),
    );
  }
}

if (setOnly) process.exit(0);

/* ── start Next ──────────────────────────────────────────────────────────── */

/**
 * Refuse to start when :3000 is taken. Next would quietly fall back to :3001,
 * and the backend's CORS allowlist is localhost:3000 / 127.0.0.1:3000 only — so
 * the UI would load and then every /redesign call would die on an opaque
 * network error. Better to say so here.
 */
// Probe by connecting, not by binding: on Windows a bind to 127.0.0.1:3000
// succeeds even while another server holds the port, so a bind test lies.
function portFree(port) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const done = (free) => {
      sock.destroy();
      resolve(free);
    };
    sock.setTimeout(1500);
    sock.once("connect", () => done(false)); // someone answered — port taken
    sock.once("timeout", () => done(true));
    sock.once("error", () => done(true)); // ECONNREFUSED — nothing there
    sock.connect(port, "127.0.0.1");
  });
}

const wantsCustomPort = nextArgs.some((a) => a === "-p" || a.startsWith("--port"));
if (!anyPort && !wantsCustomPort && !(await portFree(3000))) {
  console.error(`\n${c.red("Port 3000 is already in use.")}`);
  console.error(
    "The backend only allows CORS from localhost:3000, so a fallback port would\n" +
      "load the UI but fail every redesign call. Free it first:\n" +
      c.gold(
        process.platform === "win32"
          ? "  Get-NetTCPConnection -LocalPort 3000 -State Listen | " +
              "ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"
          : "  kill $(lsof -ti:3000)",
      ) +
      `\n(or re-run with ${c.gold("-- --any-port")} if the backend's ` +
      "DARDESIGN_ALLOWED_ORIGINS was widened.)",
  );
  process.exit(1);
}

const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
if (!fs.existsSync(nextBin)) {
  console.log(c.dim("Installing dependencies (first run only)…"));
  const install = spawnSync("npm", ["install"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (install.status !== 0) process.exit(install.status ?? 1);
}

console.log(`${c.gold("frontend")} http://localhost:3000\n`);

// Pass the URL through the environment too: process env beats .env.local, so
// the running server is pinned to the URL we just verified either way.
const child = spawn(process.execPath, [nextBin, "dev", ...nextArgs], {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, [ENV_KEY]: url },
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
