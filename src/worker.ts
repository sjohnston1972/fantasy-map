import { checkAccess, type AuthEnv } from "./api/auth";
import { handleImport, type ImportEnv } from "./api/import";
import { handleGallery, handleGalleryAdmin, type GalleryEnv } from "./api/gallery";
import { handlePublic } from "./api/packs";

interface Env extends AuthEnv, ImportEnv, GalleryEnv {
  ASSETS: Fetcher;
  PUBLIC_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, app: "fantasy-map", version: "0.16.0" });
    }

    if (url.pathname.startsWith("/api/import/")) {
      const who = await checkAccess(request, env);
      if (!who) return Response.json({ error: "sign in required" }, { status: 401 });
      const path = url.pathname.slice("/api/import/".length);
      if (path === "gallery" || path.startsWith("gallery/")) return handleGalleryAdmin(request, env, path.slice("gallery".length));
      return handleImport(request, env, path);
    }

    // Public symbol packs and catalogue (read only), limited per visitor (spec: rate limiting
    // on the catalogue API).
    if (url.pathname.startsWith("/api/packs/") || url.pathname === "/api/catalogue") {
      const visitor = request.headers.get("CF-Connecting-IP") ?? "local";
      if (env.PUBLIC_LIMIT && !(await env.PUBLIC_LIMIT.limit({ key: visitor })).success) {
        return Response.json({ error: "too many requests, slow down" }, { status: 429, headers: { "Retry-After": "10" } });
      }
      const res = await handlePublic(request, env, url.pathname.slice("/api/".length));
      if (res) return res;
    }

    // Public map gallery: browse, thumbnails and publish (publishing has its own tighter limit).
    if (url.pathname === "/api/gallery" || url.pathname.startsWith("/api/gallery/")) {
      const visitor = request.headers.get("CF-Connecting-IP") ?? "local";
      if (env.PUBLIC_LIMIT && !(await env.PUBLIC_LIMIT.limit({ key: visitor })).success) {
        return Response.json({ error: "too many requests, slow down" }, { status: 429, headers: { "Retry-After": "10" } });
      }
      return handleGallery(request, env, url.pathname.slice("/api/gallery".length));
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "not found" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
