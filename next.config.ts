import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  logging: {
    // Keep only non-GET requests and errors; silence framework noise for
    // polling GETs (/api/sessions, /api/dashboard, /api/sessions/[id]/progress)
    incomingRequests: {
      ignore: [/^GET \/(api\/(sessions|dashboard)|_next|\w{6,})/],
    },
    fetches: {
      fullUrl: false,
    },
  },
};

export default nextConfig;
