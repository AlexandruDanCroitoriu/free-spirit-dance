import vinextHandler from "vinext/server/fetch-handler";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const publicHostname = new URL(env.PUBLIC_QR_BASE_URL).hostname;

    if (url.hostname === publicHostname && !/^\/s\/[^/]+\/?$/.test(url.pathname)) {
      return new Response("Not found", {
        status: 404,
        headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    return vinextHandler.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<CloudflareEnv>;
