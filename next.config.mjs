/** @type {import('next').NextConfig} */
const nextConfig = {
  // The home route ("/") now renders the merged cinematic landing
  // (src/app/page.tsx → CinemaLanding). The previous rewrite to the static
  // public/atelier.html has been removed. The old standalone export is still
  // reachable directly at /atelier.html if needed for reference.
};

export default nextConfig;
