"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/client";
import type { ProjectSummaryDTO } from "@/lib/types";
import { ProjectCard } from "./ProjectCard";
import { Button, Icon } from "./ui";

export function ProjectsGrid({ initial, limit }: { initial: ProjectSummaryDTO[]; limit?: number }) {
  const [items, setItems] = useState(initial);
  const [confirm, setConfirm] = useState<ProjectSummaryDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = limit ? items.slice(0, limit) : items;

  async function remove() {
    if (!confirm) return;
    setBusy(true);
    try {
      await api(`/api/projects/${confirm.id}`, { method: "DELETE" });
      setItems((xs) => xs.filter((x) => x.id !== confirm.id));
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0)
    return (
      <div className="card grid place-items-center gap-3 px-6 py-14 text-center">
        <span className="grid size-12 place-items-center rounded-2xl bg-black/5 text-ink-3"><Icon name="cube" className="size-6" /></span>
        <div>
          <p className="font-medium">No projects yet</p>
          <p className="text-sm text-ink-3">Scan an object or upload photos to start.</p>
        </div>
        <Link href="/new"><Button variant="primary">Start a project</Button></Link>
      </div>
    );

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((p) => <ProjectCard key={p.id} p={p} onDelete={setConfirm} />)}
      </div>
      {confirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-sm" role="dialog" aria-modal>
          <div className="card w-full max-w-sm p-6">
            <h3 className="text-lg font-semibold">Delete “{confirm.name}”?</h3>
            <p className="mt-1.5 text-sm text-ink-2">This permanently removes the project, all scan photos, every model version and all exports. This cannot be undone.</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button>
              <Button variant="danger" onClick={remove} disabled={busy}>{busy ? "Deleting…" : "Delete forever"}</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
