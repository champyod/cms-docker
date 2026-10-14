import type { NextConfig } from "next";

const basePath = process.env.PANEL_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  /* config options here */
  basePath,
  env: {
    // Why inlined: basePath is fixed at build time, and a URL the panel hands to fetch,
    // EventSource, or a plain href never passes through Next's own prefixing.
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  output: "standalone",
  experimental: {
    // WHY set explicitly: a server action buffers its body, and the framework
    // default is 1 MB, which would silently cap an action upload before the
    // panel's own limit (10 MB for statement/attachment, 50 MB for testcases)
    // and the proxy's 100 MB. This makes the ceiling the panel's largest cap.
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
