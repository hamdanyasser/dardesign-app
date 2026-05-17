/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", destination: "/atelier.html" },
      ],
    };
  },
};

export default nextConfig;
