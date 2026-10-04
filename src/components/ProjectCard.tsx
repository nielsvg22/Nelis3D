"use client";

import Link from "next/link";
import { useState } from "react";
import { timeAgo } from "@/lib/client";
import type { ProjectSummaryDTO } from "@/lib/types";
import { Badge, Icon, Spinner, cx } from "./ui";

export function PreviewThumb({ projectId, current, className }: { projectId: string; current: ProjectSummaryDTO["current"]; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={cx("grid place-items-center overflow-hidden bg-gradient-to-b from-[#f6f7f9] to-[#eceef2]", className)}>
      {current?.hasPreview && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/projects/${projectId}/versions/${current.id}/preview`} alt="3D preview" className="size-full object-contain p-3" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <Icon name="cube" className="size-9 text-ink-3/60" />
      )}
    </div>
  );
}

export function ProjectCard({ p, onDelete }: { p: ProjectSummaryDTO; onDelete?: (p: ProjectSummaryDTO) => void }) {
  return (
    <div className="card group relative overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lg">
      <Link href={`/projects/${p.id}`} className="block" aria-label={`Open ${p.name}`}>
        <PreviewThumb projectId={p.id} current={p.current} className="aspect-[4/3]" />
        <div className="p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate font-medium">{p.name}</h3>
            {p.activeJob ? <Badge tone="accent"><Spinner className="size-3" /> {p.activeJob.progress}%</Badge> : p.current ? <Badge>v{p.current.number}</Badge> : <Badge tone="warn">No model</Badge>}
          </div>
          <p className="mt-0.5 text-[13px] text-ink-3">Updated {timeAgo(p.updatedAt)}</p>
        </div>
      </Link>
      {onDelete && (
        <button onClick={() => onDelete(p)} aria-label={`Delete ${p.name}`} className="absolute right-2.5 top-2.5 grid size-8 place-items-center rounded-full bg-white/90 text-ink-3 opacity-0 shadow-sm ring-1 ring-black/5 transition hover:text-bad focus:opacity-100 group-hover:opacity-100 max-sm:opacity-100">
          <Icon name="trash" />
        </button>
      )}
    </div>
  );
}
