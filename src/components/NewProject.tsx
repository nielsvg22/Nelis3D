"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { Button, Icon, Spinner, cx, type IconName } from "./ui";
import { ScanCamera } from "./ScanCamera";

type Tab = "scan" | "photos" | "model" | "describe";
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "scan", label: "Scan", icon: "camera" },
  { id: "photos", label: "Photos", icon: "image" },
  { id: "model", label: "3D model", icon: "cube" },
  { id: "describe", label: "Describe", icon: "sparkle" },
];

export function NewProject({ initialTab, projectId }: { initialTab: Tab; projectId?: string }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [name, setName] = useState("");
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-3xl font-semibold tracking-tight">{projectId ? "Add more photos" : "New project"}</h1>
      <p className="mb-6 text-sm text-ink-3">{projectId ? "New photos are added to your existing project." : "Start from a scan, photos, an existing model – or just describe what you need."}</p>
      {!projectId && (
        <div className="mb-6 flex gap-1 rounded-full bg-black/[.05] p-1" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cx("flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full text-sm font-medium transition", tab === t.id ? "bg-white shadow-sm" : "text-ink-2 hover:text-ink")}>
              <Icon name={t.icon} className="size-4" /> <span className="max-sm:hidden">{t.label}</span>
            </button>
          ))}
        </div>
      )}
      {!projectId && tab !== "scan" && (
        <label className="mb-5 block">
          <span className="mb-1.5 block text-xs font-medium text-ink-3">Project name (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Phone holder" maxLength={80} className="h-11 w-full rounded-xl border border-line-strong bg-white px-3.5 text-[15px] outline-none focus:border-accent" />
        </label>
      )}
      {tab === "scan" && <ScanWithName projectId={projectId} />}
      {tab === "photos" && <Uploader kind="photos" name={name} projectId={projectId} />}
      {tab === "model" && !projectId && <Uploader kind="model" name={name} />}
      {tab === "describe" && !projectId && <Describe name={name} />}
    </div>
  );
}

function ScanWithName({ projectId }: { projectId?: string }) {
  const [name, setName] = useState("");
  return (
    <div className="space-y-4">
      {!projectId && (
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-3">What are you scanning? (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Replacement knob" maxLength={80} className="h-11 w-full rounded-xl border border-line-strong bg-white px-3.5 text-[15px] outline-none focus:border-accent" />
        </label>
      )}
      <ScanCamera projectId={projectId} name={name} />
    </div>
  );
}

function Uploader({ kind, name, projectId }: { kind: "photos" | "model"; name: string; projectId?: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const accept = kind === "photos" ? "image/*,.heic,.heif" : ".stl,.obj,.3mf";

  function pick(list: FileList | null) {
    if (!list) return;
    const next = Array.from(list);
    setFiles(kind === "model" ? next.slice(0, 1) : [...files, ...next]);
    setError(null);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
      if (projectId) {
        await api(`/api/projects/${projectId}/images`, { method: "POST", body: fd });
        router.push(`/projects/${projectId}`);
      } else {
        fd.append("name", name);
        fd.append("source", "upload");
        fd.append("mode", kind === "photos" ? "reconstruct" : "modify");
        const res = await api<{ id: string }>("/api/projects", { method: "POST", body: fd });
        router.push(`/projects/${res.id}`);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Upload failed.");
      setBusy(false);
    }
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files); }}
        onClick={() => input.current?.click()}
        role="button" tabIndex={0} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        className={cx("card grid cursor-pointer place-items-center gap-2 border-dashed px-6 py-12 text-center transition", drag && "border-accent bg-accent-soft")}
      >
        <span className="grid size-12 place-items-center rounded-2xl bg-black/5 text-ink-2"><Icon name="upload" className="size-6" /></span>
        <p className="font-medium">{kind === "photos" ? "Drop photos here or tap to choose" : "Drop an STL, OBJ or 3MF file"}</p>
        <p className="text-sm text-ink-3">{kind === "photos" ? "Select many at once – 15–40 photos from all around the object work best." : "The model is checked, repaired where safe, and opened in the viewer."}</p>
        <input ref={input} type="file" accept={accept} multiple={kind === "photos"} className="sr-only" onChange={(e) => pick(e.target.files)} />
      </div>
      {files.length > 0 && (
        <div className="mt-4">
          {kind === "photos" ? (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
              {files.slice(0, 48).map((f, i) => (
                <div key={i} className="relative aspect-square overflow-hidden rounded-lg bg-black/5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={URL.createObjectURL(f)} alt="" className="size-full object-cover" onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)} />
                  <button onClick={(e) => { e.stopPropagation(); setFiles(files.filter((_, j) => j !== i)); }} className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-full bg-black/60 text-white" aria-label="Remove"><Icon name="x" className="size-3" /></button>
                </div>
              ))}
            </div>
          ) : (
            <p className="card flex items-center gap-2 p-3 text-sm"><Icon name="cube" className="size-5 text-ink-3" /> {files[0].name} <span className="text-ink-3">({(files[0].size / 1e6).toFixed(1)} MB)</span></p>
          )}
          <p className="mt-2 text-sm text-ink-3">{files.length} file{files.length === 1 ? "" : "s"} selected</p>
        </div>
      )}
      {error && <p className="mt-4 rounded-xl bg-bad-soft p-3 text-sm text-bad" role="alert">{error}</p>}
      <div className="mt-5 flex justify-end">
        <Button variant="primary" size="lg" disabled={!files.length || busy} onClick={submit}>{busy ? <><Spinner /> Uploading…</> : projectId ? "Add to project" : "Create project"}</Button>
      </div>
    </div>
  );
}

function Describe({ name }: { name: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("name", name || text.slice(0, 40));
      fd.append("mode", "functional");
      const { id } = await api<{ id: string }>("/api/projects", { method: "POST", body: fd });
      await api(`/api/projects/${id}/chat`, { method: "POST", json: { message: text } });
      router.push(`/projects/${id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }
  return (
    <div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={2000} placeholder="Describe the part you need – e.g. “A box with lid, inner size 80 × 50 × 30 mm” or “A wall hook for a 25 mm pipe”." className="w-full resize-none rounded-2xl border border-line-strong bg-white p-4 text-[15px] outline-none focus:border-accent" />
      {error && <p className="mt-3 rounded-xl bg-bad-soft p-3 text-sm text-bad" role="alert">{error}</p>}
      <div className="mt-4 flex justify-end"><Button variant="primary" size="lg" disabled={text.trim().length < 3 || busy} onClick={go}>{busy ? <><Spinner /> Creating…</> : "Design it"}</Button></div>
    </div>
  );
}
