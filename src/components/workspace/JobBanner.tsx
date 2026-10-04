"use client";

import Link from "next/link";
import type { JobDTO } from "@/lib/types";
import { Button, Icon, ProgressBar, Spinner } from "../ui";

const LABEL: Record<JobDTO["kind"], string> = { analyze: "Analysing object", reconstruct: "Building 3D model from photos", chat: "Working on your request" };

export function JobBanner({ job }: { job: JobDTO }) {
  return (
    <div className="card rise p-4" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-sm font-medium"><Spinner className="text-accent" /> {LABEL[job.kind]}<span className="ml-auto font-mono text-xs text-ink-3">{job.progress}%</span></div>
      <div className="mt-3"><ProgressBar value={job.progress} indeterminate={job.progress < 6} /></div>
      <p className="mt-2 text-xs text-ink-3">{job.stage ?? "Queued"}{job.kind === "reconstruct" ? " · this can take a few minutes. You can leave this page – the job keeps running and you'll find the result in your project." : ""}</p>
    </div>
  );
}

/** Shown when analysis/reconstruction failed – never pretend success; offer the four recovery paths. */
export function ErrorRecovery({ job, projectId, onDescribe, onEnterDimensions, onForce }: { job: JobDTO; projectId: string; onDescribe: () => void; onEnterDimensions: () => void; onForce?: () => void }) {
  const notConfigured = job.errorCode === "NOT_CONFIGURED";
  const headline =
    job.kind === "reconstruct" && !notConfigured
      ? "I can't reliably reconstruct a 3D model from this scan."
      : notConfigured
        ? "This feature isn't configured yet."
        : "That didn't work.";
  return (
    <div className="card rise border-bad/20 p-5" role="alert">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-bad-soft text-bad"><Icon name="warn" className="size-5" /></span>
        <div className="min-w-0">
          <p className="font-medium">{headline}</p>
          {job.error && <p className="mt-1 text-sm text-ink-2">{job.error}</p>}
          {notConfigured && <p className="mt-1 text-sm text-ink-3">See the README → “AI providers” for how to add the API key. Meanwhile you can still describe a part or upload a 3D model.</p>}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Link href={`/new?tab=scan&project=${projectId}`}><Button className="w-full" size="sm"><Icon name="camera" className="size-4" /> Scan again</Button></Link>
        <Link href={`/new?tab=photos&project=${projectId}`}><Button className="w-full" size="sm"><Icon name="image" className="size-4" /> Add more photos</Button></Link>
        <Button size="sm" onClick={onEnterDimensions}><Icon name="ruler" className="size-4" /> Enter dimensions</Button>
        <Button size="sm" onClick={onDescribe}><Icon name="sparkle" className="size-4" /> Describe the model</Button>
      </div>
      {onForce && job.kind === "reconstruct" && !notConfigured && (
        <button onClick={onForce} className="mt-3 text-xs text-ink-3 underline underline-offset-2 hover:text-ink">Try anyway with these photos</button>
      )}
    </div>
  );
}
