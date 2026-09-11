import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { cdnAdapter } from "@vinext/cloudflare/cache/cdn-adapter";
import { imagesOptimizer } from "@vinext/cloudflare/images/images-optimizer";

import localStorage from "./wrangler.local.json" with { type: "json" };

export default defineConfig(({ command }) => ({
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  server: {
    allowedHosts: ["dev-free-spirit-dance.alexandru-croitoriu.dev"],
  },
  plugins: [
    vinext({
      cache: { cdn: cdnAdapter() },
      images: { optimizer: imagesOptimizer() },
    }),
    cloudflare({
      config: (config) => command === "serve" ? {
        vars: { ...config.vars, LOCAL_STORAGE_ENABLED: "true" },
        d1_databases: [...(config.d1_databases ?? []), ...localStorage.d1_databases],
        r2_buckets: [...(config.r2_buckets ?? []), ...localStorage.r2_buckets],
      } : {},
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
}));
