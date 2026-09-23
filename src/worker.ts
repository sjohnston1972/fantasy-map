import { checkAccess, type AuthEnv } from "./api/auth";
import { handleImport, type ImportEnv } from "./api/import";

interface Env extends AuthEnv, ImportEnv {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, app: "fantasy-map", version: "0.5.0" });
    }

    if (url.pathname.startsWith("/api/import/")) {
      const who = await checkAccess(request, env);
      if (!who) return Response.json({ error: "sign in required" }, { status: 401 });
      return handleImport(request, env, url.pathname.slice("/api/import/".length));
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "not found" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
