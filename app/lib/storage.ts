import { AsyncLocalStorage } from "node:async_hooks";
import { env as bindings } from "cloudflare:workers";

const storage = new AsyncLocalStorage<CloudflareEnv>();

// Vite's module runner captures imported bindings. Resolve them at access time
// using request context, rather than relying on live ESM binding overrides.
export const env = new Proxy({} as CloudflareEnv, {
  get(_target, key) {
    return Reflect.get(storage.getStore() ?? bindings, key);
  },
});

export function withStorage<T>(bindings: CloudflareEnv, callback: () => T): T {
  return storage.run(bindings, callback);
}
