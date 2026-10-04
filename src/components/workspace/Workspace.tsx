"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { useProject } from "@/hooks/useProject";
import { api } from "@/lib/client";
import { PRINTERS } from "@/lib/printing/profiles";
import type { ProjectDetailDTO } from "@/lib/types";
import { ModelViewer } from "../ModelViewer";
import { Button, Icon, cx } from "../ui";
import { ChatPanel, type ChatHandle } from "./ChatPanel";
import { ErrorRecovery, JobBanner } from "./JobBanner";
import { ModelPanel } from "./ModelPanel";
import { ScanPanel } from "./ScanPanel";
import { VersionList } from "./VersionList";

export function Workspace({ initial }: { initial: ProjectDetailDTO }) {
  const router = useRouter();
  const { project, refresh, error } = useProject(initial);
  const chat = useRef<ChatHandle>(null);
  const dimsRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"chat" | "model">("chat");
  const [name, setName] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const current = project.versions.find((v) => v.id === project.currentVersionId) ?? null;
  const printer = PRINTERS[project.settings.printerId] ?? PRINTERS["creality-k1-max"];

  const activate = useCallback(async (id: string) => {
    await api(`/api/projects/${project.id}/versions/${id}/activate`, { method: "POST" });
    await refresh();
  }, [project.id, refresh]);

  const onSnapshot = useCallback(async (blob: Blob) => {
    if (!current || current.hasPreview) return;
    await fetch(`/api/projects/${project.id}/versions/${current.id}/preview`, { method: "POST", body: blob }).catch(() => null);
    refresh();
  }, [current, project.id, refresh]);

  async function rename() {
    if (name && name.trim() && name !== project.name) {
      await api(`/api/projects/${project.id}`, { method: "PATCH", json: { name } });
      await refresh();
    }
    setName(null);
  }
  async function remove() {
    setDeleting(true);
    await api(`/api/projects/${project.id}`, { method: "DELETE" }).catch(() => null);
    router.push("/projects");
    router.refresh();
  }
  async function forceReconstruct() {
    await api(`/api/projects/${project.id}/reconstruct`, { method: "POST", json: { force: true } }).catch(() => null);
    refresh();
  }
  const goDescribe = () => { setTab("chat"); chat.current?.focus(""); };
  const goDimensions = () => {
    if (project.analysis) dimsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    else { setTab("chat"); chat.current?.focus("The object is about __ mm wide, __ mm deep and __ mm high. "); }
  };

  const job = project.activeJob;
  const failed = project.lastFailedJob && project.lastFailedJob.kind !== "chat" ? project.lastFailedJob : null;
  const meshUrl = current ? `/api/projects/${project.id}/versions/${current.id}/mesh` : null;

  return (
    <div className="mx-auto grid max-w-[1800px] gap-4 p-3 sm:p-4 lg:h-[calc(100dvh-3.5rem)] lg:grid-cols-[19rem_minmax(0,1fr)_24rem] lg:overflow-hidden xl:grid-cols-[20rem_minmax(0,1fr)_26rem]">
      {/* LEFT – project / scan / versions */}
      <aside className="card scroll-thin order-3 overflow-y-auto p-4 lg:order-none">
        <div className="mb-5">
          <Link href="/projects" className="mb-2 inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink">← Projects</Link>
          {name === null ? (
            <h1 className="cursor-text truncate text-xl font-semibold tracking-tight" onClick={() => setName(project.name)} title="Click to rename">{project.name}</h1>
          ) : (
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={rename} onKeyDown={(e) => e.key === "Enter" && rename()} maxLength={80} className="w-full rounded-lg border border-accent bg-white px-2 py-1 text-xl font-semibold outline-none" />
          )}
          <p className="mt-0.5 text-xs text-ink-3">{project.versions.length} version{project.versions.length === 1 ? "" : "s"} · {project.images.length} photo{project.images.length === 1 ? "" : "s"}</p>
        </div>
        <div className="space-y-6">
          <ScanPanel project={project} onChange={refresh} dimsRef={dimsRef} />
          <VersionList project={project} onActivate={activate} />
          <section className="border-t hairline pt-4">
            <p className="mb-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-3"><Icon name="lock" className="mt-0.5 size-3.5 shrink-0" /> Camera images are only used to build this model. Delete them or the whole project at any time.</p>
            <div className="flex flex-wrap gap-2">
              {project.images.length > 0 && (
                <Button size="sm" variant="ghost" onClick={async () => { await api(`/api/projects/${project.id}/images`, { method: "DELETE" }); refresh(); }}>Delete photos</Button>
              )}
              <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}><Icon name="trash" className="size-3.5" /> Delete project</Button>
            </div>
          </section>
        </div>
      </aside>

      {/* CENTER – viewer */}
      <section className="order-1 flex min-h-0 flex-col gap-3 lg:order-none">
        {error && <div className="rounded-xl bg-warn-soft px-3 py-2 text-xs text-warn">Connection problem – retrying… ({error})</div>}
        <div className="card relative min-h-[44dvh] flex-1 overflow-hidden lg:min-h-0">
          <ModelViewer url={meshUrl} meshKey={current?.id ?? null} bed={printer.buildVolume} onSnapshot={current && !current.hasPreview ? onSnapshot : undefined} className="absolute inset-0"
            emptyHint={<div className="space-y-1"><Icon name="cube" className="mx-auto size-10 text-ink-3/50" /><p className="font-medium text-ink-2">No 3D model yet</p><p>{project.images.length ? "Build one from your scan photos, or describe a part in the chat." : "Describe a part in the chat or upload a model."}</p></div>} />
        </div>
        {job && job.kind !== "chat" && <JobBanner job={job} />}
        {!job && failed && <ErrorRecovery job={failed} projectId={project.id} onDescribe={goDescribe} onEnterDimensions={goDimensions} onForce={project.images.length ? forceReconstruct : undefined} />}
        {current && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-ink-3">
            <span className="font-medium text-ink">v{current.number}</span>
            <span>{current.dimensions.x.toFixed(1)} × {current.dimensions.y.toFixed(1)} × {current.dimensions.z.toFixed(1)} mm</span>
            <span>{current.triangles.toLocaleString()} triangles</span>
            {current.note && <span className="truncate">{current.note}</span>}
          </div>
        )}
      </section>

      {/* RIGHT – chat + model info (stacked on mobile, tabbed on desktop) */}
      <aside className="order-2 flex min-h-0 flex-col gap-3 lg:order-none">
        <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="hidden border-b hairline p-1.5 lg:flex" role="tablist">
            {(["chat", "model"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx("flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl text-sm font-medium transition", tab === t ? "bg-black/[.05]" : "text-ink-3 hover:text-ink")}>
                <Icon name={t === "chat" ? "sparkle" : "cube"} className="size-4" /> {t === "chat" ? "AI chat" : "Model & print"}
              </button>
            ))}
          </div>
          <div className={cx("min-h-0 flex-1", tab === "chat" ? "block" : "lg:hidden")}>
            <h2 className="px-4 pt-4 text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3 lg:hidden">AI chat</h2>
            <div className="h-[28rem] lg:h-full"><ChatPanel ref={chat} project={project} onChange={refresh} onActivateVersion={activate} /></div>
          </div>
          <div className={cx("scroll-thin min-h-0 flex-1 overflow-y-auto", tab === "model" ? "block" : "lg:hidden")}>
            <ModelPanel project={project} version={current} onChange={refresh} />
          </div>
        </div>
        <p className="hidden px-1 text-[11px] text-ink-3 lg:block">AI: {project.providerId}. Estimates are not measurements – always verify dimensions before printing.</p>
      </aside>

      {confirmDelete && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-sm" role="dialog" aria-modal>
          <div className="card w-full max-w-sm p-6">
            <h3 className="text-lg font-semibold">Delete this project?</h3>
            <p className="mt-1.5 text-sm text-ink-2">All photos, model versions and exports are permanently removed.</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</Button>
              <Button variant="danger" onClick={remove} disabled={deleting}>{deleting ? "Deleting…" : "Delete forever"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
