"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { MATERIALS } from "@/lib/printing/profiles";
import type { ProjectDetailDTO, VersionDTO } from "@/lib/types";
import { Button, Icon, SectionTitle, Spinner } from "../ui";
import { PrintCheck } from "./PrintCheck";
import { PrintModal } from "./PrintModal";
import { downloadExport } from "./download";

type Axis = "x" | "y" | "z";

export function ModelPanel({ project, version, onChange }: { project: ProjectDetailDTO; version: VersionDTO | null; onChange: () => Promise<unknown> }) {
  const [printOpen, setPrintOpen] = useState(false);
  if (!version)
    return <div className="p-6 text-center text-sm text-ink-3">No model yet. Build one from a scan, upload a 3D file, or ask the assistant to design a part.</div>;
  return (
    <div className="space-y-6 p-4">
      <Dimensions project={project} version={version} onChange={onChange} />
      <PrintCheck project={project} version={version} onChange={onChange} />
      <Settings project={project} onChange={onChange} />
      <Export project={project} version={version} onPrint={() => setPrintOpen(true)} />
      {printOpen && <PrintModal project={project} version={version} onClose={() => setPrintOpen(false)} />}
    </div>
  );
}

function Dimensions({ project, version, onChange }: { project: ProjectDetailDTO; version: VersionDTO; onChange: () => Promise<unknown> }) {
  const d = version.dimensions;
  const [vals, setVals] = useState({ x: d.x.toFixed(1), y: d.y.toFixed(1), z: d.z.toFixed(1) });
  const [lock, setLock] = useState(true);
  const [edited, setEdited] = useState<Axis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ver = useRef(version.id);
  useEffect(() => { ver.current = version.id; setVals({ x: d.x.toFixed(1), y: d.y.toFixed(1), z: d.z.toFixed(1) }); setEdited(null); }, [version.id, d.x, d.y, d.z]);

  function edit(axis: Axis, raw: string) {
    const n = parseFloat(raw.replace(",", "."));
    const next = { ...vals, [axis]: raw };
    if (lock && Number.isFinite(n) && n > 0) {
      const f = n / d[axis];
      (["x", "y", "z"] as Axis[]).filter((k) => k !== axis).forEach((k) => (next[k] = (d[k] * f).toFixed(1)));
    }
    setVals(next);
    setEdited(axis);
  }
  const changed = (["x", "y", "z"] as Axis[]).some((k) => Math.abs(parseFloat(vals[k]) - d[k]) > 0.04);

  async function apply(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/projects/${project.id}/dimensions`, { method: "POST", json: { versionId: version.id, ...body } });
      await onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not resize.");
    } finally {
      setBusy(false);
    }
  }
  const submit = () => {
    if (lock && edited) return apply({ [edited]: parseFloat(vals[edited]), uniform: true });
    const body: Record<string, number> = {};
    (["x", "y", "z"] as Axis[]).forEach((k) => { if (Math.abs(parseFloat(vals[k]) - d[k]) > 0.04) body[k] = parseFloat(vals[k]); });
    return apply({ ...body, uniform: false });
  };

  return (
    <section>
      <SectionTitle aside={<span className="text-xs text-ink-3">v{version.number}</span>}>Dimensions</SectionTitle>
      <div className="card p-4">
        <div className="grid grid-cols-3 gap-2">
          {([["x", "Width"], ["y", "Depth"], ["z", "Height"]] as const).map(([k, label]) => (
            <label key={k} className="block">
              <span className="text-[11px] text-ink-3">{label} (X/Y/Z)</span>
              <div className="relative">
                <input inputMode="decimal" value={vals[k]} onChange={(e) => edit(k, e.target.value)} onKeyDown={(e) => e.key === "Enter" && changed && submit()} className="h-10 w-full rounded-lg border border-line-strong bg-white pl-2.5 pr-8 text-sm outline-none focus:border-accent" aria-label={`${label} in millimetres`} />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-ink-3">mm</span>
              </div>
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-2">
            <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} className="accent-accent" /> Keep proportions
          </label>
          <div className="ml-auto flex gap-1.5">
            <Button size="sm" disabled={busy} onClick={() => apply({ x: d.x * 0.9, uniform: true })}>−10%</Button>
            <Button size="sm" disabled={busy} onClick={() => apply({ x: d.x * 1.1, uniform: true })}>+10%</Button>
          </div>
        </div>
        {changed && <Button variant="primary" className="mt-3 w-full" size="sm" onClick={submit} disabled={busy}>{busy ? <Spinner /> : null} Apply as new version</Button>}
        {error && <p className="mt-2 text-xs text-bad" role="alert">{error}</p>}
      </div>
    </section>
  );
}

function Settings({ project, onChange }: { project: ProjectDetailDTO; onChange: () => Promise<unknown> }) {
  const s = project.settings;
  const [busy, setBusy] = useState(false);
  async function patch(p: Record<string, unknown>) {
    setBusy(true);
    try {
      await api(`/api/projects/${project.id}/settings`, { method: "PATCH", json: p });
      await onChange();
    } finally {
      setBusy(false);
    }
  }
  const sel = "h-9 w-full rounded-lg border border-line-strong bg-white px-2 text-sm outline-none focus:border-accent";
  return (
    <section>
      <SectionTitle aside={busy ? <Spinner className="size-3" /> : undefined}>Print settings</SectionTitle>
      <div className="card space-y-3 p-4 text-sm">
        <div className="flex items-center justify-between rounded-lg bg-black/[.03] px-3 py-2">
          <span className="flex items-center gap-2"><Icon name="printer" className="size-4 text-ink-3" /> Creality K1 Max</span>
          <span className="text-xs text-ink-3">300 × 300 × 300 mm</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label><span className="text-[11px] text-ink-3">Material</span>
            <select className={sel} value={s.material} onChange={(e) => patch({ material: e.target.value })}>{Object.values(MATERIALS).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
          <label><span className="text-[11px] text-ink-3">Layer height</span>
            <select className={sel} value={s.layerHeight} onChange={(e) => patch({ layerHeight: Number(e.target.value) })}>{[0.12, 0.16, 0.2, 0.24, 0.28].map((v) => <option key={v} value={v}>{v} mm</option>)}</select></label>
          <label><span className="text-[11px] text-ink-3">Infill</span>
            <select className={sel} value={s.infill} onChange={(e) => patch({ infill: Number(e.target.value) })}>{[5, 10, 15, 20, 30, 50, 100].map((v) => <option key={v} value={v}>{v}%</option>)}</select></label>
          <label className="flex items-end gap-2 pb-2"><input type="checkbox" checked={s.supports} onChange={(e) => patch({ supports: e.target.checked })} className="accent-accent" /><span className="text-sm">Supports</span></label>
        </div>
      </div>
    </section>
  );
}

function Export({ project, version, onPrint }: { project: ProjectDetailDTO; version: VersionDTO; onPrint: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function dl(f: "stl" | "3mf") {
    setBusy(f);
    setError(null);
    const e = await downloadExport(project.id, version.id, f, "as-is");
    setBusy(null);
    if (e) setError(e);
  }
  return (
    <section>
      <SectionTitle>Export</SectionTitle>
      <div className="space-y-2">
        <Button variant="primary" size="lg" className="w-full" onClick={onPrint}><Icon name="printer" className="size-5" /> Print on K1 Max</Button>
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={!!busy} onClick={() => dl("stl")}>{busy === "stl" ? <Spinner /> : <Icon name="download" className="size-4" />} STL</Button>
          <Button disabled={!!busy} onClick={() => dl("3mf")}>{busy === "3mf" ? <Spinner /> : <Icon name="download" className="size-4" />} 3MF</Button>
        </div>
        {error && <p className="text-xs text-bad" role="alert">{error}</p>}
        <p className="text-[11px] text-ink-3">Files are named like <code>{project.name.toLowerCase().replace(/\s+/g, "-")}-v{version.number}.3mf</code> and open directly in Creality Print.</p>
      </div>
    </section>
  );
}
