"use client";

import { useState } from "react";
import type { ProjectDetailDTO, VersionDTO } from "@/lib/types";
import { MATERIALS, PRINTERS } from "@/lib/printing/profiles";
import { Badge, Button, Icon, Spinner, cx } from "../ui";
import { downloadExport } from "./download";

/**
 * “Print on K1 Max” – the honest workflow:
 *  1. checks (fit, print check)  2. orientation  3. download 3MF/STL → open in Creality Print → slice → print.
 * Direct sending needs G-code from a slicer + a printer connection (see lib/printing/connector.ts) – not faked here.
 */
export function PrintModal({ project, version, onClose }: { project: ProjectDetailDTO; version: VersionDTO; onClose: () => void }) {
  const printer = PRINTERS[project.settings.printerId] ?? PRINTERS["creality-k1-max"];
  const material = MATERIALS[project.settings.material] ?? MATERIALS.PLA;
  const report = version.report;
  const fit = report?.checks.find((c) => c.id === "volume");
  const best = report?.bestOrientation;
  const canOrient = !!best && best.rotation.some((r) => r !== 0) && best.fits;
  const [orient, setOrient] = useState<"as-is" | "best">(canOrient && (report?.orientations.find((o) => o.rotation.every((r) => r === 0))?.overhangPercent ?? 0) > 5 ? "best" : "as-is");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const blocked = fit?.status === "fail";

  async function dl(format: "3mf" | "stl") {
    setBusy(format);
    setError(null);
    const err = await downloadExport(project.id, version.id, format, orient);
    setBusy(null);
    if (err) setError(err);
    else setDone(format);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal aria-label="Print on K1 Max" onClick={onClose}>
      <div className="card scroll-thin max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-b-none p-5 sm:rounded-b-[18px] sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Print on {printer.name}</h2>
            <p className="text-sm text-ink-3">{project.name} · v{version.number}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-full text-ink-3 hover:bg-black/5"><Icon name="x" /></button>
        </div>

        <ol className="mt-5 space-y-4">
          <Step n={1} title="Checks" tone={report?.level === "fail" ? "bad" : report?.level === "warn" ? "warn" : "ok"}>
            <p className="text-sm text-ink-2">{fit?.status === "ok" ? `✅ Fits the build volume (${printer.buildVolume.x}×${printer.buildVolume.y}×${printer.buildVolume.z} mm).` : fit ? `❌ ${fit.title}.` : "—"}</p>
            <p className="text-sm text-ink-2">{report ? (report.level === "ok" ? "✅ Print check passed." : report.level === "warn" ? `⚠️ ${report.checks.filter((c) => c.status === "warn").length} warning(s) – review them in the print check.` : "❌ The print check found problems that will likely fail the print.") : ""}</p>
          </Step>

          <Step n={2} title="Orientation">
            <div className="space-y-1.5">
              <Choice active={orient === "as-is"} onClick={() => setOrient("as-is")} title="As modelled" sub={`${(report?.orientations.find((o) => o.rotation.every((r) => r === 0))?.overhangPercent ?? 0).toFixed(0)}% overhang`} />
              {canOrient && best && <Choice active={orient === "best"} onClick={() => setOrient("best")} title={`Recommended: ${best.label.toLowerCase()}`} sub={`${best.overhangPercent.toFixed(0)}% overhang`} badge="Less support" />}
            </div>
          </Step>

          <Step n={3} title="Profile in the file">
            <p className="text-sm text-ink-2">{material.name} · nozzle {project.settings.nozzle} mm · {project.settings.layerHeight} mm layers · {project.settings.infill}% infill · {material.nozzleTemp}/{material.bedTemp} °C</p>
            <p className="text-xs text-ink-3">Object is centred on the {printer.buildVolume.x}×{printer.buildVolume.y} mm plate. Final slicer settings are chosen in Creality Print.</p>
          </Step>
        </ol>

        {blocked && <p className="mt-4 rounded-xl bg-bad-soft p-3 text-sm text-bad">This model does not fit the printer. Fix it in the print check first (scale or re-orient).</p>}
        {error && <p className="mt-4 rounded-xl bg-bad-soft p-3 text-sm text-bad" role="alert">{error}</p>}

        <div className="mt-5 space-y-2">
          <Button variant="accent" size="lg" className="w-full" disabled={!!busy || blocked} onClick={() => dl("3mf")}>
            {busy === "3mf" ? <Spinner /> : <Icon name="download" className="size-5" />} Download 3MF for Creality Print
          </Button>
          <Button className="w-full" disabled={!!busy || blocked} onClick={() => dl("stl")}>{busy === "stl" ? <Spinner /> : <Icon name="download" className="size-4" />} Download STL</Button>
          <button disabled className="flex w-full items-center justify-between rounded-full border border-dashed border-line-strong px-4 py-2.5 text-left text-sm text-ink-3">
            <span>Send directly to the printer</span><Badge>Not available yet</Badge>
          </button>
        </div>

        {done && (
          <div className="rise mt-5 rounded-xl bg-ok-soft p-4 text-sm text-ink">
            <p className="font-medium text-ok">Downloaded {done.toUpperCase()}. Next:</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-ink-2">
              <li>Open <a className="underline" href={printer.slicer.url} target="_blank" rel="noreferrer">{printer.slicer.name}</a> and choose <b>{printer.name}</b>.</li>
              <li><b>File → Open</b> (or double-click the file) – the model sits centred on the plate.</li>
              <li>Pick {material.name} and press <b>Slice</b>, then send to the printer or save the G-code.</li>
            </ol>
          </div>
        )}
        <p className="mt-4 text-[11px] leading-relaxed text-ink-3">Direct printing needs sliced G-code and a connection to your printer (Moonraker/Klipper on the K1 Max). The app is structured for that — see README → Printer integration — but it is not enabled in this version.</p>
      </div>
    </div>
  );
}

function Step({ n, title, tone, children }: { n: number; title: string; tone?: "ok" | "warn" | "bad"; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className={cx("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold", tone === "bad" ? "bg-bad-soft text-bad" : tone === "warn" ? "bg-warn-soft text-warn" : "bg-black/5 text-ink-2")}>{n}</span>
      <div className="min-w-0 flex-1"><p className="mb-1 text-sm font-medium">{title}</p>{children}</div>
    </li>
  );
}
function Choice({ active, onClick, title, sub, badge }: { active: boolean; onClick: () => void; title: string; sub: string; badge?: string }) {
  return (
    <button onClick={onClick} aria-pressed={active} className={cx("flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition", active ? "border-accent bg-accent-soft/60" : "border-line hover:border-line-strong")}>
      <span><span className="font-medium">{title}</span> <span className="text-ink-3">· {sub}</span></span>
      {badge && <Badge tone="ok">{badge}</Badge>}
    </button>
  );
}
