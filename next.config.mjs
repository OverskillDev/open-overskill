/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.OPEN_OVERSKILL_BUILD_DIR || ".next",
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
