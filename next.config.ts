import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com', // Google Photos CDN
      },
      {
        protocol: 'https',
        hostname: 'drive.google.com',
      },
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com', // Cloudinary
      },
    ],
  },
  experimental: {
    // Increase body size limit for large image uploads (50MB)
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
};

export default nextConfig;
