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
    // The named Cloudflare Tunnel always forwards to localhost:3000. Do not
    // silently choose another port, or the tunnel can keep serving a previous
    // Vite process and mix its React modules with those from the new process.
    port: 3000,
    strictPort: true,
    allowedHosts: ["dev-free-spirit-dance.alexandru-croitoriu.dev"],
    // Vite's dev-time dependency modules are generated files. A cached HTML
    // document or module from an earlier optimization pass can pair a React
    // renderer with a different React instance, which produces the misleading
    // "useContext" null-dispatcher error. The tunnel is for development only,
    // so make every response explicitly non-cacheable.
    headers: {
      "Cache-Control": "no-store",
    },
  },
  plugins: [
    vinext({
      cache: { cdn: cdnAdapter() },
      images: { optimizer: imagesOptimizer() },
    }),
    cloudflare({
      config: (config) => {
        if (command !== "serve") return {};
        // The plugin merges returned arrays with the original config. Replace
        // this list in place so cloud-only secrets are neither required nor
        // accidentally loaded into the development Worker.
        config.secrets = { required: ["CLOUDFLARE_ACCESS_CLIENT_ID", "CLOUDFLARE_ACCESS_CLIENT_SECRET", "LOCAL_PRODUCTION_BACKUP_BRIDGE_SECRET"] };
        return {
        vars: { ...config.vars, LOCAL_STORAGE_ENABLED: "true" },
        d1_databases: localStorage.d1_databases,
        r2_buckets: localStorage.r2_buckets,
        };
      },
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
}));
