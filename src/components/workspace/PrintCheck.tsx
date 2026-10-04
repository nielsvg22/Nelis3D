"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/client";
import type { PrintCheck as Check } from "@/lib/geometry/printability";
import type { ProjectDetailDTO, VersionDTO } from "@/lib/types";
import { Badge, Button, Icon, SectionTitle, Spinner, cx } from "../ui";

const TONE = { ok: "text-ok bg-ok-soft", warn: "text-warn bg-warn-soft", fail: "text-bad bg-bad-soft", skipped: "text-ink-3 bg-black/5" } as const;
const ICON = { ok: "check", warn: "warn", fail: "x", skipped: "check" } as const;

export function PrintCheck({ project, version, onChange }: { project: ProjectDetailDTO; version: VersionDTO; onChange: () => Promise<unknown> }) {
  const report = version.report;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fix(c: Check) {
    if (!report) return;
    setBusy(c.id);
    setError(null);
    try {
      if (c.fix === "repair") await api(`/api/projects/${project.id}/versions/${version.id}/repair`, { method: "POST" });
      else if (c.fix === "orient") {
        const best = report.bestOrientation;
        await api(`/api/projects/${project.id}/versions/${version.id}/orient`, { method: "POST", json: { rotation: best.rotation, label: best.label } });
      } else if (c.fix === "scale-to-fit") {
        const bv = { x: 300, y: 300, z: 300 };
        const d = version.dimensions;
        const f = Math.min(bv.x / d.x, bv.y / d.y, bv.z / d.z) * 0.98;
        await api(`/api/projects/${project.id}/dimensions`, { method: "POST", json: { versionId: version.id, x: d.x * f, uniform: true } });
      }
      await onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not apply the fix.");
    } finally {
      setBusy(null);
    }
  }

  if (!report) return null;
  const tone = report.level === "ok" ? "ok" : report.level === "warn" ? "warn" : "bad";
  return (
    <section>
      <SectionTitle aside={<Badge tone={tone}>{report.level === "ok" ? "Ready" : report.level === "warn" ? "Check" : "Problems"}</Badge>}>Print check</SectionTitle>
      <div className="card p-4">
        <p className={cx("text-sm font-medium", report.level === "ok" ? "text-ok" : report.level === "warn" ? "text-warn" : "text-bad")}>
          {report.level === "ok" ? "✅ " : report.level === "warn" ? "⚠️ " : "❌ "}{report.summary}
        </p>
        <ul className="mt-3 space-y-2.5">
          {report.checks.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              <span className={cx("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full", TONE[c.status])}><Icon name={ICON[c.status]} className="size-3" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">{c.title}</p>
                {c.status !== "ok" && <p className="text-xs text-ink-2">{c.detail}</p>}
                {c.fix && c.status !== "ok" && c.fix !== "thicken" && (
                  <Button size="sm" className="mt-1.5" onClick={() => fix(c)} disabled={!!busy}>
                    {busy === c.id ? <Spinner className="size-3" /> : <Icon name={c.fix === "repair" ? "wrench" : c.fix === "orient" ? "rotate" : "ruler"} className="size-3.5" />}
                    {c.fix === "repair" ? "Repair mesh" : c.fix === "orient" ? `Use “${report.bestOrientation.label.toLowerCase()}”` : "Scale to fit"}
                  </Button>
                )}
                {c.fix === "thicken" && c.status !== "ok" && <p className="mt-1 text-xs text-ink-3">Ask the assistant: “make the walls 1.6 mm thick”.</p>}
              </div>
            </li>
          ))}
        </ul>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 border-t hairline pt-3 text-xs text-ink-2">
          <dt>Volume</dt><dd className="text-right">{(report.stats.volumeMm3 / 1000).toFixed(1)} cm³</dd>
          <dt>Est. weight ({report.settings.material})</dt><dd className="text-right">≈ {report.stats.estimatedMassG.toFixed(0)} g</dd>
          <dt>Triangles</dt><dd className="text-right">{report.stats.triangles.toLocaleString()}</dd>
          {report.stats.minWallMm != null && <><dt>Thinnest wall (est.)</dt><dd className="text-right">{report.stats.minWallMm.toFixed(2)} mm</dd></>}
        </dl>
        {error && <p className="mt-2 text-xs text-bad" role="alert">{error}</p>}
      </div>
    </section>
  );
}
