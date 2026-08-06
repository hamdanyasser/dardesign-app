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
};

export default nextConfig;
