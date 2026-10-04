"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import type { ProjectDetailDTO } from "@/lib/types";
import { Badge, Button, Icon, SectionTitle, Spinner, cx } from "../ui";

export function ScanPanel({ project, onChange, dimsRef }: { project: ProjectDetailDTO; onChange: () => Promise<unknown>; dimsRef: React.RefObject<HTMLDivElement | null> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const included = project.images.filter((i) => i.included).length;
  const cap = project.capabilities;
  const job = !!project.activeJob;

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await onChange();
    } catch (e) {
      setError(e instanceof ApiError ? `${e.message}${e.hint ? ` ${e.hint}` : ""}` : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const hasImages = project.images.length > 0;
  return (
    <div className="space-y-6">
      {hasImages && (
        <section>
          <SectionTitle aside={<span className="text-xs text-ink-3">{included}/{project.images.length} used</span>}>Scan photos</SectionTitle>
          <div className="grid grid-cols-4 gap-1.5">
            {project.images.map((img) => (
              <button key={img.id} disabled={job} onClick={() => run("img" + img.id, () => api(`/api/projects/${project.id}/images/${img.id}`, { method: "PATCH", json: { included: !img.included } }))} aria-pressed={img.included} title={img.issues.join(", ") || "Tap to include/exclude"} className={cx("relative aspect-square overflow-hidden rounded-lg bg-black/5 transition", !img.included && "opacity-35")}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/projects/${project.id}/images/${img.id}/thumb`} alt={`Photo ${img.position}`} className="size-full object-cover" loading="lazy" />
                {img.issues.length > 0 && <span className="absolute bottom-0.5 left-0.5 rounded bg-warn px-1 text-[9px] font-medium leading-4 text-white">{img.issues[0]}</span>}
              </button>
            ))}
          </div>
          {included < 8 && included > 0 && <p className="mt-2 text-xs text-warn">Few photos selected – more angles give a more reliable model.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={`/new?tab=photos&project=${project.id}`}><Button size="sm"><Icon name="plus" className="size-4" /> Add photos</Button></Link>
            <Link href={`/new?tab=scan&project=${project.id}`}><Button size="sm"><Icon name="camera" className="size-4" /> Rescan</Button></Link>
          </div>
          <div className="mt-3 space-y-2">
            <Button variant="accent" className="w-full" disabled={job || included === 0 || !cap.reconstruction.available || !!busy} onClick={() => run("rec", () => api(`/api/projects/${project.id}/reconstruct`, { method: "POST", json: {} }))}>
              {busy === "rec" ? <Spinner /> : <Icon name="cube" className="size-4" />} {project.versions.length ? "Reconstruct again" : "Build 3D model from scan"}
            </Button>
            {!cap.reconstruction.available && <p className="text-xs text-ink-3">{cap.reconstruction.reason}</p>}
            <Button className="w-full" size="sm" disabled={job || !cap.analysis.available || !!busy} onClick={() => run("an", () => api(`/api/projects/${project.id}/analyze`, { method: "POST" }))}>
              {busy === "an" ? <Spinner /> : <Icon name="sparkle" className="size-4" />} {project.analysis ? "Re-analyse object" : "Analyse object"}
            </Button>
            {!cap.analysis.available && <p className="text-xs text-ink-3">{cap.analysis.reason}</p>}
          </div>
          {error && <p className="mt-2 text-xs text-bad" role="alert">{error}</p>}
        </section>
      )}
      {project.analysis && <AnalysisCard project={project} onChange={onChange} dimsRef={dimsRef} />}
    </div>
  );
}

function AnalysisCard({ project, onChange, dimsRef }: { project: ProjectDetailDTO; onChange: () => Promise<unknown>; dimsRef: React.RefObject<HTMLDivElement | null> }) {
  const a = project.analysis!;
  const eff = { ...a.dimensions, ...a.userDimensions };
  const [vals, setVals] = useState({ x: eff.x.toFixed(0), y: eff.y.toFixed(0), z: eff.z.toFixed(0) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setVals({ x: eff.x.toFixed(0), y: eff.y.toFixed(0), z: eff.z.toFixed(0) }), [eff.x, eff.y, eff.z]); // eslint-disable-line react-hooks/exhaustive-deps

  async function apply() {
    const body: Record<string, number> = {};
    (["x", "y", "z"] as const).forEach((k) => {
      const n = parseFloat(vals[k].replace(",", "."));
      if (Number.isFinite(n) && Math.abs(n - eff[k]) > 0.05) body[k] = n;
    });
    if (!Object.keys(body).length) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/projects/${project.id}/analysis`, { method: "POST", json: { ...body, rescale: true } });
      await onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not apply dimensions.");
    } finally {
      setBusy(false);
    }
  }
  const changed = (["x", "y", "z"] as const).some((k) => Math.abs(parseFloat(vals[k].replace(",", ".")) - eff[k]) > 0.05);

  return (
    <section ref={dimsRef} className="scroll-mt-20">
      <SectionTitle aside={<Badge tone={a.confidence > 0.7 ? "ok" : a.confidence > 0.4 ? "warn" : "bad"}>{Math.round(a.confidence * 100)}% sure</Badge>}>Object analysis</SectionTitle>
      <div className="card space-y-3 p-4 text-sm">
        <div>
          <p className="font-medium">{a.objectName}</p>
          <p className="mt-0.5 text-ink-2">{a.description}</p>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-3">Size {a.userDimensions ? "(your measurement)" : `(AI estimate, ${a.dimensions.confidence} confidence)`}</p>
          <div className="grid grid-cols-3 gap-2">
            {([["x", "Width"], ["y", "Depth"], ["z", "Height"]] as const).map(([k, label]) => (
              <label key={k} className="block">
                <span className="text-[11px] text-ink-3">{label}</span>
                <div className="relative">
                  <input inputMode="decimal" value={vals[k]} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} className="h-9 w-full rounded-lg border border-line-strong bg-white pl-2.5 pr-8 text-sm outline-none focus:border-accent" />
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-ink-3">mm</span>
                </div>
              </label>
            ))}
          </div>
          {!a.userDimensions && <p className="mt-1.5 text-[11px] text-ink-3">{a.dimensions.basis}</p>}
          {changed && <Button size="sm" variant="primary" className="mt-2 w-full" onClick={apply} disabled={busy}>{busy ? <Spinner /> : null} Correct size{project.currentVersionId ? " & rescale model" : ""}</Button>}
          {error && <p className="mt-1 text-xs text-bad">{error}</p>}
        </div>
        <Detail title="Geometry" body={`${a.geometry} Symmetry: ${a.symmetry}.`} />
        {a.features.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-ink-3">Features</p>
            <ul className="space-y-1">{a.features.map((f, i) => <li key={i} className="flex items-start gap-1.5 text-[13px]"><Badge tone={f.functional ? "accent" : "neutral"}>{f.type.replace("_", " ")}</Badge><span>{f.description}</span></li>)}</ul>
          </div>
        )}
        {a.missingViews.length > 0 && <Detail title="Not visible in the photos" body={a.missingViews.join(", ")} warn />}
        {!a.reconstruction.feasible && <Detail title="Reconstruction looks difficult" body={a.reconstruction.reasons.join(" ")} warn />}
        <p className="text-[11px] text-ink-3">Analysed by {a.provider}. Estimates from photos are never exact – measure the real object when it matters.</p>
      </div>
    </section>
  );
}

function Detail({ title, body, warn }: { title: string; body: string; warn?: boolean }) {
  return (
    <div>
      <p className={cx("text-xs font-medium", warn ? "text-warn" : "text-ink-3")}>{title}</p>
      <p className="text-[13px] text-ink-2">{body}</p>
    </div>
  );
}
