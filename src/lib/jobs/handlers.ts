import { eq } from "drizzle-orm";
import { AiError, type ChatContext } from "../ai/types";
import { getProvider } from "../ai/registry";
import { getDb, schema } from "../db/client";
import { buildCadSpec, CadSpecError } from "../geometry/cadspec";
import { NotManifoldError } from "../geometry/manifold";
import { applyEditOps } from "../geometry/ops";
import { bounds, dimensions, placeOnBed, rotateMesh, scaleMesh } from "../geometry/mesh";
import { repairMesh } from "../geometry/repair";
import { resolveProfile } from "../printing/profiles";
import { addMessage } from "../services/projects";
import { loadIncludedImages, loadReconstructionImages } from "../services/scans";
import { createVersion, loadVersionMesh } from "../services/versions";
import { enqueueJob, getJob, updateJob } from "./queue";

const { projects, modelVersions, prompts } = schema;

type Result = Record<string, unknown> | void;

export async function runHandler(jobId: string): Promise<Result> {
  const job = getJob(jobId)!;
  const progress = async (p: number, stage: string) => updateJob(jobId, { progress: Math.max(1, Math.min(99, Math.round(p))), stage });
  switch (job.kind) {
    case "analyze":
      return analyze(job.projectId, progress);
    case "reconstruct":
      return reconstruct(jobId, job.projectId, job.state ?? {}, progress);
    case "chat":
      return chat(job.projectId, String(job.input?.message ?? ""), progress);
  }
}

type Progress = (p: number, stage: string) => Promise<void>;

async function analyze(projectId: string, progress: Progress) {
  const db = getDb();
  const provider = getProvider();
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get()!;
  await progress(10, "Preparing photos");
  const images = await loadIncludedImages(projectId, 8);
  const current = project.currentVersionId ? db.select().from(modelVersions).where(eq(modelVersions.id, project.currentVersionId)).get() : null;
  if (images.length === 0 && !current) throw new AiError("LOW_QUALITY_INPUT", "There is nothing to analyse yet – add photos or upload a model.");
  const mesh = current ? await loadVersionMesh(current) : undefined;
  await progress(35, images.length ? "Analysing the object" : "Measuring the model");
  const analysis = await provider.analyzeObject({ images, mesh, hint: project.name });
  const prev = project.analysis?.userDimensions;
  db.update(projects).set({ analysis: prev ? { ...analysis, userDimensions: prev } : analysis, updatedAt: new Date() }).where(eq(projects.id, projectId)).run();
  const summary = `I analysed **${analysis.objectName}**. ${analysis.description} Estimated size: ${analysis.dimensions.x.toFixed(0)} × ${analysis.dimensions.y.toFixed(0)} × ${analysis.dimensions.z.toFixed(0)} mm (${analysis.dimensions.confidence} confidence) – please check and correct it if needed.${analysis.questions.length ? "\n\n" + analysis.questions.map((q) => `• ${q}`).join("\n") : ""}`;
  addMessage(projectId, "assistant", summary, null, { kind: "analysis" });
  return { feasible: analysis.reconstruction.feasible };
}

async function reconstruct(jobId: string, projectId: string, state: Record<string, unknown>, progress: Progress) {
  const db = getDb();
  const provider = getProvider();
  let project = db.select().from(projects).where(eq(projects.id, projectId)).get()!;
  const images = await loadReconstructionImages(projectId, 4);
  if (images.length === 0) throw new AiError("LOW_QUALITY_INPUT", "There are no selected photos to reconstruct from.");

  if (!project.analysis && provider.capabilities().analysis.available) {
    await progress(3, "Analysing the object first");
    await analyze(projectId, async () => {});
    project = db.select().from(projects).where(eq(projects.id, projectId)).get()!;
  }
  if (project.analysis && !project.analysis.reconstruction.feasible && !state.force) {
    throw new AiError("LOW_QUALITY_INPUT", "The photos do not look suitable for a reliable reconstruction.", project.analysis.reconstruction.reasons.join(" "));
  }

  const result = await provider.reconstructModel({
    images,
    analysis: project.analysis,
    state,
    saveState: (s) => updateJob(jobId, { state: s }),
    onProgress: progress,
  });

  await progress(90, "Cleaning up the mesh");
  let mesh = result.mesh;
  if (result.upAxis === "y") mesh = rotateMesh(mesh, 90, 0, 0); // glTF/OBJ are Y-up, printers are Z-up
  const cleaned = repairMesh(mesh);
  mesh = cleaned.mesh;
  if (mesh.indices.length < 200) throw new AiError("RECONSTRUCTION_FAILED", "The reconstruction produced almost no geometry.");
  const raw = dimensions(mesh);
  if (!(raw.x > 0 && raw.y > 0 && raw.z > 0)) throw new AiError("RECONSTRUCTION_FAILED", "The reconstruction is flat or degenerate.");

  // Scale: the service returns an arbitrary size. Anchor the LARGEST dimension to the user's/AI's estimate.
  let scaleNote = "Scale is not known from photos alone";
  if (!result.scaleKnown) {
    const a = project.analysis;
    const est = a ? { ...a.dimensions, ...a.userDimensions } : null;
    const target = est ? Math.max(est.x, est.y, est.z) : 100;
    const s = target / Math.max(raw.x, raw.y, raw.z);
    mesh = scaleMesh(mesh, s, s, s);
    scaleNote = est ? `Scaled so the largest side is ${target.toFixed(0)} mm (${a!.userDimensions ? "your measurement" : "AI estimate – please verify"})` : "No size estimate available – defaulted to 100 mm. Please enter the real dimensions";
  }
  mesh = placeOnBed(mesh);
  await progress(95, "Saving model");
  const v = await createVersion({
    projectId,
    mesh,
    source: "reconstruct",
    prompt: "Reconstructed from scan photos",
    note: [scaleNote, ...cleaned.actions].join(". "),
    provider: result.provider,
  });
  const d = dimensions(mesh);
  addMessage(
    projectId,
    "assistant",
    `Model v${v.number} is ready: ${d.x.toFixed(1)} × ${d.y.toFixed(1)} × ${d.z.toFixed(1)} mm. ${scaleNote}. Check the print report on the right and tell me what you want to do with it.`,
    v.id,
    { kind: "reconstruct" },
  );
  return { versionId: v.id };
}

function buildContext(projectId: string): ChatContext & { _hasPhotos: boolean } {
  const db = getDb();
  const p = db.select().from(projects).where(eq(projects.id, projectId)).get()!;
  const versions = db.select().from(modelVersions).where(eq(modelVersions.projectId, projectId)).all().sort((a, b) => a.number - b.number);
  const cur = versions.find((v) => v.id === p.currentVersionId) ?? null;
  const history = db.select().from(prompts).where(eq(prompts.projectId, projectId)).all().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return {
    projectName: p.name,
    mode: p.mode,
    analysis: p.analysis ?? null,
    currentMesh: null,
    currentDimensions: cur ? { x: cur.dimX, y: cur.dimY, z: cur.dimZ } : null,
    currentVersionNumber: cur?.number ?? null,
    versions: versions.map((v) => ({ number: v.number, prompt: v.prompt, source: v.source, dimensions: { x: v.dimX, y: v.dimY, z: v.dimZ } })),
    history: history.filter((h) => h.role !== "system").map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
    settings: resolveProfile(p.printSettings).settings,
    report: cur?.report ?? null,
    _hasPhotos: !!db.select({ id: schema.scanImages.id }).from(schema.scanImages).where(eq(schema.scanImages.projectId, projectId)).get(),
  };
}

async function chat(projectId: string, message: string, progress: Progress) {
  const db = getDb();
  const provider = getProvider();
  const ctx = buildContext(projectId);
  const p = db.select().from(projects).where(eq(projects.id, projectId)).get()!;
  const cur = p.currentVersionId ? db.select().from(modelVersions).where(eq(modelVersions.id, p.currentVersionId)).get() : null;
  if (cur) ctx.currentMesh = await loadVersionMesh(cur);
  // the user's message is already stored in `prompts`; remove it from the history we pass as context
  if (ctx.history.at(-1)?.role === "user" && ctx.history.at(-1)?.content === message) ctx.history.pop();

  await progress(15, "Thinking");
  try {
    const plan = await provider.planTurn({ message, context: ctx });
    switch (plan.kind) {
      case "reply":
        addMessage(projectId, "assistant", plan.reply);
        return { kind: "reply" };
      case "reconstruct": {
        if (!ctx._hasPhotos) {
          addMessage(projectId, "assistant", "There are no scan photos in this project yet. Scan the object or upload photos first.");
          return { kind: "reply" };
        }
        addMessage(projectId, "assistant", plan.reply);
        const id = enqueueJob(projectId, "reconstruct");
        return { kind: "reconstruct", jobId: id };
      }
      case "modify": {
        if (!ctx.currentMesh) {
          addMessage(projectId, "assistant", "There is no model to modify yet. Reconstruct one from the scan, upload a 3D model, or ask me to design a part.");
          return { kind: "reply" };
        }
        await progress(55, "Applying changes");
        const mesh = await applyEditOps(ctx.currentMesh, plan.ops);
        const v = await createVersion({ projectId, mesh: placeOnBed(mesh), source: "edit", prompt: message, note: plan.label, parentVersionId: cur!.id });
        addMessage(projectId, "assistant", `${plan.reply}\n\nSaved as **v${v.number}** · ${plan.label}`, v.id, { kind: "edit" });
        return { kind: "modify", versionId: v.id };
      }
      case "design": {
        await progress(55, "Building the 3D geometry");
        const mesh = await buildCadSpec(plan.spec);
        const v = await createVersion({ projectId, mesh: placeOnBed(mesh), source: "design", prompt: message, note: plan.spec.name, parentVersionId: cur?.id ?? null, provider: provider.id });
        addMessage(projectId, "assistant", `${plan.reply}\n\nSaved as **v${v.number}** · ${plan.spec.name}`, v.id, { kind: "design", spec: plan.spec as unknown as Record<string, unknown> });
        return { kind: "design", versionId: v.id };
      }
    }
  } catch (e) {
    const friendly = friendlyError(e);
    addMessage(projectId, "assistant", friendly, null, { kind: "error" });
    throw e;
  }
}

function friendlyError(e: unknown): string {
  if (e instanceof AiError) return `${e.message}${e.hint ? ` ${e.hint}` : ""}`;
  if (e instanceof NotManifoldError) return `${e.message} You can try “Repair mesh” in the print check first.`;
  if (e instanceof CadSpecError) return `I could not build that design: ${e.message}`;
  return "Something went wrong while processing that request. Nothing was changed.";
}

void bounds;
