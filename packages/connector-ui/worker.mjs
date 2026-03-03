export default {
  async fetch(request, env) {
    if (!env.ASSETS) {
      return new Response('ASSETS binding is missing. Check wrangler.toml [assets].binding', {
        status: 500
      });
    }

    // Wrangler static assets binding.
    // SPA fallback: rewrite unknown paths (e.g. /link) to /index.html.
    const res = await env.ASSETS.fetch(request);
    if (res.status !== 404) return res;

    const url = new URL(request.url);
    // If it looks like a file (has extension), keep 404.
    if (/\.[a-z0-9]+$/i.test(url.pathname)) return res;

    const indexUrl = new URL(request.url);
    indexUrl.pathname = '/index.html';
    return env.ASSETS.fetch(new Request(indexUrl.toString(), request));
  }
};
