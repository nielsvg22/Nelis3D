import { z } from "zod";
import { route, ownedProject, readJson, HttpError } from "@/lib/api";
import { MATERIALS, PRINTERS } from "@/lib/printing/profiles";
import { updateSettings } from "@/lib/services/projects";
import { getProject } from "@/lib/services/shared";
import { recheckVersion } from "@/lib/services/versions";

const schema = z.object({
  printerId: z.string().refine((v) => v in PRINTERS).optional(),
  material: z.string().refine((v) => v in MATERIALS).optional(),
  layerHeight: z.number().min(0.05).max(0.4).optional(),
  infill: z.number().min(0).max(100).optional(),
  supports: z.boolean().optional(),
  nozzle: z.number().min(0.2).max(1.0).optional(),
});

export const PATCH = route<{ id: string }>(async (req, { user, params }) => {
  ownedProject(user, params.id);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, "Invalid print settings");
  const settings = updateSettings(user.id, params.id, parsed.data);
  const p = getProject(params.id);
  if (p?.currentVersionId) await recheckVersion(params.id, p.currentVersionId, settings); // refresh the print check for the new material
  return { settings };
});
