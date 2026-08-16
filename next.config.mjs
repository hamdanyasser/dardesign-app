/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets a production build run without clobbering a live `next dev` server,
  // which shares the same directory and breaks if two processes write it:
  //   NEXT_DIST_DIR=.next-build npm run build
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The home route ("/") now renders the merged cinematic landing
  // (src/app/page.tsx → CinemaLanding). The previous rewrite to the static
  // public/atelier.html has been removed. The old standalone export is still
  // reachable directly at /atelier.html if needed for reference.

  // Hide the dev-only on-screen indicator (the floating "N · 1 Issue" pill).
  // It is a DEV overlay and never ships in a production build, but this app is
  // demonstrated from `next dev` in front of a room, and a red error badge over
  // the landing reads as "the software is broken" whatever it actually says.
  //
  // This hides the BADGE, not the errors: the Next 16 docs are explicit that
  // "Next.js will still surface any compile or runtime errors that were
  // encountered", and they still appear in the browser console and the dev
  // server output. Nothing is being silenced, only un-drawn.
  devIndicators: false,
};

export default nextConfig;
