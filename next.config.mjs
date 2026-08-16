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

  // Hide the dev-only on-screen indicator (the floating circle at bottom-left).
  // It never shipped to users — it renders only under `next dev` — so this
  // changes nothing about a production build; it just keeps it out of demo
  // screenshots. Compile and runtime errors are still reported, in the terminal
  // and the browser console.
  //
  // `false` is the Next 16 spelling. The 14/15 sub-options (`buildActivity`,
  // `buildActivityPosition`, `appIsrStatus`) were REMOVED in v16 — setting one
  // here would be silently ignored rather than erroring.
  devIndicators: false,
};

export default nextConfig;
