# How to record the app (Claude Code can do this itself)

A screen recording of DarDesign, made by Claude with **no screen-recorder app, no
npm install, no user in the loop**. It drives Chrome over the DevTools Protocol,
saves every painted frame as a JPEG, and joins them with ffmpeg.

Requirements: Chrome, Node 22+ (global `WebSocket`), `ffmpeg` on PATH. All three
are already on this machine.

## Run it

```bash
npm run dev                    # app on :3000
node scripts/record.mjs out.mp4 40    # record 40 seconds
```

`scripts/record.mjs` is ~90 lines and is the whole method. Edit the `story()`
function at the bottom to change what gets recorded.

## The one idea

`Page.startScreencast` gives you a JPEG **every time the page paints**. Collect
them with their arrival timestamps, write an ffmpeg concat list where each frame
carries its real duration, and you have a video at true speed.

## Six traps, each of which cost hours

1. **Never use `gdigrab`.** `ffmpeg -f gdigrab -i title=...` reads the window's
   GDI device context. Anything GPU-composited — every WebGL canvas in this app —
   comes back **solid black**, and the MP4 is valid, so it looks like it worked.
   It produced a clean 115-second all-black file. Screencast captures the
   composited surface and does not have this problem.

2. **Ack every frame.** `Page.screencastFrame` stops after ~5 frames unless you
   reply `Page.screencastFrameAck` with the frame's `sessionId`. The stream just
   goes quiet — no error.

3. **A still 3D viewport emits no frames.** `scene3d.ts` uses a dirty-flag render
   loop, so a Build Mode screen that isn't changing never repaints and never
   fires `screencastFrame`. A 90-second beat encoded to 3 frames. Fix: `hold()`
   drags the camera ~1px at a time for the duration. A slowly turning room also
   reads better on video than a frozen one.

4. **`transform` and `opacity` do not force a paint** — the GPU composites them
   without repainting. A pump animating `transform` recorded 90 seconds as 16
   frames. Animate `backgroundColor` instead. (This pump keeps *DOM* pages alive;
   it does not rescue the canvas, because the canvas is its own layer — that's
   what `hold()` is for.)

5. **Clamp the frame durations.** A pause where nothing paints shows up as one
   frame with a 40-second duration. Clamp to `[0.016, 6.0]`. Clamping at 1.0
   collapses every deliberate pause and turned a 90-second segment into 23.

6. **ffmpeg concat details.** It ignores the *last* `duration` line, so repeat the
   final `file` line. Use `-fps_mode cfr -r 30` (not the deprecated `-vsync vfr`).
   libx264 rejects an odd height, and `-c copy` refuses to join clips of
   different sizes — so letterbox every segment to one even size:
   `scale=W:H:force_original_aspect_ratio=decrease,pad=W:H:(ow-iw)/2:(oh-ih)/2,setsar=1`.

## Verify by looking

An MP4 with a plausible duration and size proves nothing — trap 1 produced
exactly that. Always extract a few frames and actually view them:

```bash
ffmpeg -ss 60 -i out.mp4 -frames:v 1 -vf scale=620:-2 check.jpg
```

Then open `check.jpg` with the Read tool.

## Recording something long

`scripts/record-demo.mjs` is the full-length version: it records in named segments,
encodes and **deletes each segment's frames before starting the next**, so peak
disk is one segment rather than the whole take, and a bad segment can be re-shot
alone (`node scripts/record-demo.mjs 6,7`). 20 minutes of frames is ~2.5 GB at 1100px/q62.

## What about the Chrome DevTools MCP?

It is configured on this project and it *is* useful here — but for a different
half of the job. `mcp__chrome-devtools__*` can navigate, click, fill, take
**screenshots**, read the console and the network. What it cannot do is produce a
**video**: `take_screenshot` returns one still, and there is no screencast tool.

So use both, each for what it is good at:

| job | tool |
|---|---|
| find the selector, check a button exists, see the console | Chrome DevTools MCP |
| rehearse the click path once, interactively | Chrome DevTools MCP |
| capture continuous video | `scripts/record.mjs` |

The practical loop: drive the page with the MCP until the path works and you know
every selector, then write those same steps into `story()` and record. That is
faster than debugging a click blind inside a 20-minute take.

They run separate Chrome instances (the MCP has its own profile under
`~/.cache/chrome-devtools-mcp/`), so don't expect the recorder to see a page the
MCP navigated — the script opens its own tab on `APP_URL`.

---
Verified 2026-08-19: `node scripts/record.mjs out.mp4 25` produced 202 frames / 36.3s, and the extracted frame shows the real landing page.
