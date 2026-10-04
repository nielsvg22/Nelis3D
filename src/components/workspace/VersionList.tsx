"use client";

import { useState } from "react";
import { timeAgo } from "@/lib/client";
import type { ProjectDetailDTO } from "@/lib/types";
import { Badge, Icon, SectionTitle, cx } from "../ui";

const SOURCE: Record<string, string> = { reconstruct: "Scan", upload: "Upload", design: "Design", edit: "Edit", resize: "Resize", repair: "Repair", orient: "Orientation" };

export function VersionList({ project, onActivate }: { project: ProjectDetailDTO; onActivate: (id: string) => void }) {
  const versions = [...project.versions].reverse();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section>
      <SectionTitle aside={<span className="text-xs text-ink-3">{versions.length}</span>}>Versions</SectionTitle>
      {versions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong p-4 text-center text-sm text-ink-3">Every change you make is saved as a new version.</p>
      ) : (
        <ul className="space-y-1.5">
          {versions.map((v) => (
            <li key={v.id}>
              <button onClick={() => (v.isCurrent ? setOpen(open === v.id ? null : v.id) : onActivate(v.id))} className={cx("flex w-full items-center gap-3 rounded-xl border p-2 text-left transition", v.isCurrent ? "border-accent/40 bg-accent-soft/50" : "border-transparent hover:bg-black/[.03]")}>
                <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-gradient-to-b from-[#f6f7f9] to-[#eceef2]">
                  {v.hasPreview ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/projects/${project.id}/versions/${v.id}/preview`} alt="" className="size-full object-contain" /> : <Icon name="cube" className="size-5 text-ink-3/60" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-sm font-medium">v{v.number} <Badge>{SOURCE[v.source] ?? v.source}</Badge>{v.report?.level === "fail" && <Badge tone="bad">issues</Badge>}{v.report?.level === "warn" && <Badge tone="warn">check</Badge>}</div>
                  <p className="truncate text-xs text-ink-3">{v.prompt ?? "—"}</p>
                  <p className="text-[11px] text-ink-3">{timeAgo(v.createdAt)} · {v.dimensions.x.toFixed(0)}×{v.dimensions.y.toFixed(0)}×{v.dimensions.z.toFixed(0)} mm</p>
                </div>
                {v.isCurrent ? <Icon name="check" className="size-4 shrink-0 text-accent" /> : <span className="shrink-0 text-xs text-accent">Restore</span>}
              </button>
              {open === v.id && (
                <dl className="mx-2 mb-1 mt-1 space-y-1 rounded-xl bg-black/[.03] p-3 text-xs text-ink-2">
                  <div className="flex justify-between"><dt>Created</dt><dd>{new Date(v.createdAt).toLocaleString()}</dd></div>
                  <div className="flex justify-between"><dt>Triangles</dt><dd>{v.triangles.toLocaleString()}</dd></div>
                  <div className="flex justify-between"><dt>Settings</dt><dd>{v.settings?.material ?? "PLA"} · {v.settings?.layerHeight ?? 0.2} mm · {v.settings?.infill ?? 15}%</dd></div>
                  {v.prompt && <div><dt className="mb-0.5">Prompt</dt><dd className="text-ink">{v.prompt}</dd></div>}
                  {v.note && <div><dt className="mb-0.5">Note</dt><dd className="text-ink">{v.note}</dd></div>}
                </dl>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
