"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { analyzeFrame, feedbackFor, meanDiff, type Feedback, type FrameStats } from "@/lib/scan/analyzeFrame";
import { Button, Icon, ProgressBar, Spinner, cx } from "./ui";

const TARGET = 24;
const MIN = 10;
const SECTORS = 12;

interface Frame { id: number; blob: Blob; url: string; issues: string[]; included: boolean }

type Phase = "intro" | "capture" | "review" | "uploading";

/** iPhone-first walk-around scanner: live quality feedback, auto-capture on new angles, manual review. */
export function ScanCamera({ projectId, name }: { projectId?: string; name?: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("intro");
  const [frames, setFrames] = useState<Frame[]>([]);
  const [auto, setAuto] = useState(true);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sectors, setSectors] = useState(0);
  const [hasHeading, setHasHeading] = useState(false);
  const [flash, setFlash] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const work = useRef<HTMLCanvasElement | null>(null);
  const st = useRef({
    prev: null as Uint8ClampedArray | null,
    lastCapGray: null as Uint8ClampedArray | null,
    lastCapHeading: null as number | null,
    lastCapAt: 0,
    heading: null as number | null,
    sectors: new Set<number>(),
    startedAt: 0,
    noveltyLow: false,
    nextId: 1,
    last: null as FrameStats | null,
  });

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);
  useEffect(() => () => { stop(); frames.forEach((f) => URL.revokeObjectURL(f.url)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setError(null);
    if (!window.isSecureContext) {
      setError("The camera needs a secure connection (HTTPS). Open the app via https:// or use “Upload photos”.");
      return;
    }
    // iOS requires the motion permission to be requested inside a user gesture.
    try {
      const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
      if (DOE?.requestPermission) await DOE.requestPermission().catch(() => null);
    } catch { /* optional */ }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      streamRef.current = stream;
      setPhase("capture");
      st.current.startedAt = Date.now();
    } catch (e) {
      const n = (e as DOMException).name;
      setError(n === "NotAllowedError" ? "Camera access was denied. Allow it in your browser/iOS settings, or use “Upload photos”." : n === "NotFoundError" ? "No camera found on this device." : "Could not start the camera.");
    }
  }

  // attach stream once the <video> exists
  useEffect(() => {
    if (phase !== "capture" || !videoRef.current || !streamRef.current) return;
    const v = videoRef.current;
    v.srcObject = streamRef.current;
    v.play().catch(() => setError("Tap the screen to start the camera preview."));
  }, [phase]);

  // compass heading for angular coverage
  useEffect(() => {
    if (phase !== "capture") return;
    const onO = (e: DeviceOrientationEvent) => {
      const w = e as DeviceOrientationEvent & { webkitCompassHeading?: number };
      const h = w.webkitCompassHeading ?? (e.alpha != null ? (360 - e.alpha) % 360 : null);
      if (h != null && Number.isFinite(h)) {
        st.current.heading = h;
        setHasHeading(true);
      }
    };
    window.addEventListener("deviceorientation", onO, true);
    return () => window.removeEventListener("deviceorientation", onO, true);
  }, [phase]);

  const capture = useCallback(async (s: FrameStats | null) => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const scale = Math.min(1, 1920 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.9));
    if (!blob) return;
    const issues: string[] = [];
    if (s && s.sharpness < 18) issues.push("blurry");
    if (s && s.brightness < 55) issues.push("dark");
    const r = st.current;
    r.lastCapAt = Date.now();
    if (s) r.lastCapGray = s.gray;
    r.lastCapHeading = r.heading;
    if (r.heading != null) r.sectors.add(Math.floor((r.heading / 360) * SECTORS) % SECTORS);
    setSectors(r.sectors.size);
    setFrames((f) => [...f, { id: r.nextId++, blob, url: URL.createObjectURL(blob), issues, included: true }]);
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
    navigator.vibrate?.(15);
  }, []);

  // analysis loop (~4 Hz)
  useEffect(() => {
    if (phase !== "capture") return;
    const ctx = (work.current ??= document.createElement("canvas")).getContext("2d", { willReadFrequently: true })!;
    const id = setInterval(() => {
      const v = videoRef.current;
      if (!v || v.readyState < 2 || !v.videoWidth) return;
      const r = st.current;
      const s = analyzeFrame(v, ctx, r.prev);
      r.prev = s.gray;
      r.last = s;
      const novelty = r.lastCapGray ? meanDiff(s.gray, r.lastCapGray) : 99;
      const headingDelta = r.heading != null && r.lastCapHeading != null ? Math.abs(((r.heading - r.lastCapHeading + 540) % 360) - 180) : 0;
      const headingDelta2 = r.heading != null && r.lastCapHeading != null ? Math.min(Math.abs(r.heading - r.lastCapHeading), 360 - Math.abs(r.heading - r.lastCapHeading)) : 0;
      void headingDelta;
      const newView = r.lastCapGray ? novelty > 9 || headingDelta2 > 12 : true;
      r.noveltyLow = !!r.lastCapGray && !newView;
      setFeedback(feedbackFor(s, { captured: framesRef.current, sectors: r.sectors.size, hasHeading: r.heading != null, msSinceStart: Date.now() - r.startedAt, noveltyLow: r.noveltyLow }));
      const good = s.brightness >= 55 && s.brightness <= 230 && s.motion < 14 && s.sharpness >= 18;
      if (autoRef.current && good && newView && Date.now() - r.lastCapAt > 700 && framesRef.current < 60) void capture(s);
    }, 250);
    return () => clearInterval(id);
  }, [phase, capture]);

  const framesRef = useRef(0);
  framesRef.current = frames.length;
  const autoRef = useRef(auto);
  autoRef.current = auto;

  const included = frames.filter((f) => f.included);
  const countProgress = Math.min(1, frames.length / TARGET);
  const progress = Math.round((hasHeading ? 0.6 * countProgress + 0.4 * Math.min(1, sectors / SECTORS) : countProgress) * 100);
  const milestone = progress >= 100 ? 100 : progress >= 75 ? 75 : progress >= 50 ? 50 : progress >= 25 ? 25 : 0;

  function finishCapture() {
    stop();
    setPhase("review");
  }

  async function submit() {
    setPhase("uploading");
    setError(null);
    try {
      const fd = new FormData();
      included.forEach((f, i) => fd.append("files", f.blob, `frame-${String(i + 1).padStart(3, "0")}.jpg`));
      fd.append("source", "camera");
      if (projectId) {
        await api(`/api/projects/${projectId}/images`, { method: "POST", body: fd });
        router.push(`/projects/${projectId}`);
      } else {
        fd.append("name", name || "Scanned object");
        fd.append("mode", "reconstruct");
        const res = await api<{ id: string }>("/api/projects", { method: "POST", body: fd });
        router.push(`/projects/${res.id}`);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Upload failed. Check your connection and try again.");
      setPhase("review");
    }
  }

  // ───────────── UI ─────────────
  if (phase === "intro")
    return (
      <div className="card mx-auto max-w-lg p-6 text-center sm:p-8">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent"><Icon name="camera" className="size-7" /></span>
        <h2 className="mt-4 text-xl font-semibold tracking-tight">Scan your object</h2>
        <ol className="mx-auto mt-4 max-w-xs space-y-2 text-left text-sm text-ink-2">
          <li className="flex gap-2"><b className="text-ink">1.</b> Put the object on a plain surface with even light.</li>
          <li className="flex gap-2"><b className="text-ink">2.</b> Move slowly around it – about 360°, keeping it in view.</li>
          <li className="flex gap-2"><b className="text-ink">3.</b> Do a second, higher circle so the top is covered.</li>
        </ol>
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-black/[.03] p-3 text-left text-xs text-ink-3">
          <Icon name="lock" className="mt-0.5 size-4 shrink-0" />
          Photos are used only to build your model. Metadata (GPS etc.) is stripped. To analyse and reconstruct, they are sent to the configured AI services; delete them any time from the project.
        </p>
        {error && <p className="mt-3 rounded-xl bg-bad-soft p-3 text-sm text-bad" role="alert">{error}</p>}
        <div className="mt-5 flex flex-col gap-2">
          <Button variant="primary" size="lg" onClick={start}><Icon name="camera" className="size-5" /> Start camera</Button>
          <label className="cursor-pointer">
            <input type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (!files.length) return;
              setFrames(files.map((f, i) => ({ id: i + 1, blob: f, url: URL.createObjectURL(f), issues: [], included: true })));
              setPhase("review");
            }} />
            <span className="inline-flex h-12 w-full items-center justify-center rounded-full border border-line-strong bg-white text-[15px] font-medium hover:bg-bg">Use the iPhone camera app instead</span>
          </label>
        </div>
      </div>
    );

  if (phase === "capture")
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
        <div className="relative flex-1 overflow-hidden">
          <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 size-full object-cover" onClick={() => videoRef.current?.play()} />
          {flash && <div className="absolute inset-0 bg-white/70" />}
          <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent p-4 pt-[max(1rem,env(safe-area-inset-top))]">
            <p className="text-center text-sm font-medium">Move slowly around the object.</p>
            <div className="mx-auto mt-3 max-w-sm">
              <ProgressBar value={progress} />
              <div className="mt-1.5 flex justify-between text-[11px] text-white/70">
                {[0, 25, 50, 75, 100].map((m) => <span key={m} className={cx(milestone >= m && "font-semibold text-white")}>{m}%</span>)}
              </div>
              <p className="mt-1 text-center text-[11px] text-white/60">{frames.length} frames{hasHeading ? ` · ${sectors}/${SECTORS} angles` : ""}</p>
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex flex-col items-center gap-2 px-4">
            {feedback.map((f) => (
              <div key={f.id} className={cx("rise rounded-full px-3.5 py-1.5 text-[13px] font-medium backdrop-blur", f.level === "bad" ? "bg-bad/90" : f.level === "warn" ? "bg-warn/90" : "bg-white/20")}>
                {f.text}
              </div>
            ))}
          </div>
          {error && <div className="absolute inset-x-4 top-24 rounded-xl bg-bad/90 p-3 text-sm">{error}</div>}
        </div>
        <div className="safe-b flex items-center justify-between gap-3 bg-black px-5 pt-4">
          <button onClick={() => { stop(); setPhase("intro"); setFrames([]); }} className="w-20 text-left text-sm text-white/70">Cancel</button>
          <div className="flex flex-col items-center gap-2">
            <button onClick={() => capture(st.current.last)} aria-label="Capture photo" className="grid size-[68px] place-items-center rounded-full border-4 border-white/90 transition active:scale-90"><span className="size-[52px] rounded-full bg-white" /></button>
            <button onClick={() => setAuto((a) => !a)} className={cx("rounded-full px-3 py-1 text-[11px] font-medium", auto ? "bg-accent text-white" : "bg-white/15 text-white/70")}>Auto-capture {auto ? "on" : "off"}</button>
          </div>
          <div className="w-20 text-right">
            <button onClick={finishCapture} disabled={frames.length < 3} className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-30">Done</button>
          </div>
        </div>
        {frames.length > 0 && frames.length < MIN && (
          <div className="absolute inset-x-0 bottom-32 text-center text-[11px] text-white/60">Best results with at least {MIN} frames from all sides</div>
        )}
      </div>
    );

  // review / uploading
  const tooFew = included.length < MIN;
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Check your photos</h2>
          <p className="text-sm text-ink-3">{included.length} of {frames.length} selected. Tap a photo to include or exclude it.</p>
        </div>
        <Button size="sm" onClick={() => { setPhase("intro"); }} disabled={phase === "uploading"}><Icon name="plus" className="size-4" /> More photos</Button>
      </div>
      {tooFew && <p className="mb-3 rounded-xl bg-warn-soft p-3 text-sm text-warn"><Icon name="warn" className="mr-1.5 inline size-4" />Only {included.length} photos – reconstruction works best with {MIN}+ from different angles.</p>}
      {error && <p className="mb-3 rounded-xl bg-bad-soft p-3 text-sm text-bad" role="alert">{error}</p>}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
        {frames.map((f) => (
          <button key={f.id} onClick={() => setFrames((xs) => xs.map((x) => (x.id === f.id ? { ...x, included: !x.included } : x)))} className={cx("relative aspect-square overflow-hidden rounded-xl ring-2 transition", f.included ? "ring-transparent" : "opacity-40 ring-line-strong")} aria-pressed={f.included}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={f.url} alt={`Frame ${f.id}`} className="size-full object-cover" />
            {f.issues.length > 0 && <span className="absolute bottom-1 left-1 rounded-full bg-warn px-1.5 py-0.5 text-[10px] font-medium text-white">{f.issues[0]}</span>}
            {f.included && <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-accent text-white"><Icon name="check" className="size-3" /></span>}
          </button>
        ))}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={submit} variant="primary" size="lg" disabled={included.length === 0 || phase === "uploading"}>
          {phase === "uploading" ? <><Spinner /> Uploading…</> : projectId ? "Add to project" : "Create project"}
        </Button>
      </div>
    </div>
  );
}
