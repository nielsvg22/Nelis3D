import { NextResponse } from "next/server";
import { getCurrentUser, type SessionUser } from "./auth";
import { AiError } from "./ai/types";
import { getOwnedProject } from "./services/projects";
import { NotManifoldError } from "./geometry/manifold";
import { CadSpecError } from "./geometry/cadspec";
import { ExportBlockedError } from "./services/exports";
import { env } from "./env";

/** Vercel functions reject request bodies > 4.5 MB; stay a bit below so we can answer with a clear message. */
export const MAX_BODY_BYTES = env.isServerless ? 4_000_000 : 200_000_000;

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

type Ctx<P> = { params: Promise<P> };

/** Wraps a handler: resolves params + user, converts thrown errors into JSON with sensible status codes. */
export function route<P extends Record<string, string | string[]> = Record<string, string>>(
  fn: (req: Request, args: { user: SessionUser; params: P }) => Promise<Response | object>,
) {
  return async (req: Request, ctx: Ctx<P>) => {
    try {
      const user = await getCurrentUser();
      const out = await fn(req, { user, params: await ctx.params });
      return out instanceof Response ? out : NextResponse.json(out);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
      if (e instanceof AiError) return NextResponse.json({ error: e.message, hint: e.hint, code: e.code }, { status: e.code === "NOT_CONFIGURED" ? 501 : 422 });
      if (e instanceof ExportBlockedError) return NextResponse.json({ error: e.message, code: "EXPORT_BLOCKED" }, { status: 409 });
      if (e instanceof NotManifoldError || e instanceof CadSpecError) return NextResponse.json({ error: e.message, code: e.name }, { status: 422 });
      console.error("[api]", e);
      return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
    }
  };
}

export async function ownedProject(user: SessionUser, id: string) {
  const p = await getOwnedProject(user.id, id);
  if (!p) throw new HttpError(404, "Project not found");
  return p;
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

export async function filesFrom(req: Request, field = "files"): Promise<{ form: FormData; files: File[] }> {
  const form = await req.formData().catch(() => {
    throw new HttpError(400, "Expected multipart form data");
  });
  return { form, files: form.getAll(field).filter((f): f is File => typeof f !== "string") };
}
