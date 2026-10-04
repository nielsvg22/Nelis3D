import { z } from "zod";
import { route, ownedProject, readJson, HttpError } from "@/lib/api";
import { exportVersion, type ExportFormat } from "@/lib/services/exports";
import { activateVersion, getVersion, loadVersionMesh, orientVersion, repairVersion, saveVersionPreview } from "@/lib/services/versions";
import { getStorage } from "@/lib/storage";

type P = { id: string; vid: string; action: string };

export const GET = route<P>(async (req, { user, params }) => {
  ownedProject(user, params.id);
  const v = getVersion(params.id, params.vid);
  if (!v) throw new HttpError(404, "Version not found");
  switch (params.action) {
    case "mesh": {
      const buf = await getStorage().get(v.storageKey);
      return new Response(new Uint8Array(buf), { headers: { "Content-Type": "model/stl", "Cache-Control": "private, max-age=31536000, immutable" } });
    }
    case "preview": {
      if (!v.previewKey) throw new HttpError(404, "No preview yet");
      const buf = await getStorage().get(v.previewKey);
      return new Response(new Uint8Array(buf), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=300" } });
    }
    case "export": {
      const q = new URL(req.url).searchParams;
      const format = (q.get("format") ?? "3mf") as ExportFormat;
      if (format !== "stl" && format !== "3mf") throw new HttpError(400, "format must be stl or 3mf");
      const out = await exportVersion(params.id, v.id, format, { orient: q.get("orient") === "best" ? "best" : "as-is", force: q.get("force") === "1" });
      return new Response(new Uint8Array(out.bytes), {
        headers: { "Content-Type": out.contentType, "Content-Disposition": `attachment; filename="${out.filename}"`, "X-Print-Orientation": out.orientation },
      });
    }
    default:
      throw new HttpError(404, "Unknown action");
  }
});

export const POST = route<P>(async (req, { user, params }) => {
  ownedProject(user, params.id);
  const v = getVersion(params.id, params.vid);
  if (!v) throw new HttpError(404, "Version not found");
  switch (params.action) {
    case "activate":
      activateVersion(params.id, v.id);
      return { ok: true };
    case "preview": {
      const buf = Buffer.from(await req.arrayBuffer());
      if (buf.length < 100 || buf.length > 2_000_000) throw new HttpError(400, "Invalid preview image");
      if (v.previewKey) return { ok: true, skipped: true };
      await saveVersionPreview(params.id, v.id, buf);
      return { ok: true };
    }
    case "repair": {
      const nv = await repairVersion(params.id, v.id);
      return { versionId: nv.id };
    }
    case "orient": {
      const body = z.object({ rotation: z.tuple([z.number(), z.number(), z.number()]), label: z.string().optional() }).safeParse(await readJson(req));
      if (!body.success) throw new HttpError(400, "Invalid rotation");
      const nv = await orientVersion(params.id, v.id, body.data.rotation, body.data.label);
      return { versionId: nv.id };
    }
    default:
      throw new HttpError(404, "Unknown action");
  }
});

void loadVersionMesh;
