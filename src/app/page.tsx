import Link from "next/link";
import { Button, Icon, Badge } from "@/components/ui";
import { ProjectsGrid } from "@/components/ProjectsGrid";
import { getCurrentUser } from "@/lib/auth";
import { getProvider } from "@/lib/ai/registry";
import { listProjects } from "@/lib/services/projects";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();
  const projects = await listProjects(user.id);
  const cap = getProvider().capabilities();
  const missing = [!cap.analysis.available && "ANTHROPIC_API_KEY", !cap.reconstruction.available && "MESHY_API_KEY"].filter(Boolean);

  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
      <section className="py-14 text-center sm:py-24">
        <Badge tone="accent"><Icon name="printer" className="size-3.5" /> Made for the Creality K1 Max</Badge>
        <h1 className="mx-auto mt-5 max-w-3xl text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
          Turn real objects into <span className="text-accent">printable</span> 3D models.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-balance text-base text-ink-2 sm:text-lg">
          Scan with your phone, tell the AI what you need, and get a real, checked mesh – ready for Creality Print.
        </p>
        <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <Link href="/new?tab=scan"><Button variant="primary" size="lg" className="w-full"><Icon name="camera" className="size-5" /> Scan object</Button></Link>
          <Link href="/new?tab=photos"><Button size="lg" className="w-full"><Icon name="image" className="size-5" /> Upload photos</Button></Link>
          <Link href="/new?tab=model"><Button size="lg" className="w-full"><Icon name="cube" className="size-5" /> Upload existing 3D model</Button></Link>
        </div>
        <p className="mt-4 text-sm text-ink-3">or <Link href="/new?tab=describe" className="underline underline-offset-2 hover:text-ink">design a part from a description</Link></p>
      </section>

      {missing.length > 0 && (
        <div className="card mb-10 flex items-start gap-3 border-warn/30 bg-warn-soft/60 p-4 text-sm">
          <Icon name="warn" className="mt-0.5 size-5 shrink-0 text-warn" />
          <div>
            <p className="font-medium text-warn">AI services not fully configured</p>
            <p className="text-ink-2">
              {!cap.analysis.available && "Photo analysis is off. "}
              {!cap.reconstruction.available && "Photo → 3D reconstruction is off. "}
              Add {missing.map((m, i) => <span key={String(m)}>{i > 0 && " and "}<code className="rounded bg-black/5 px-1">{m}</code></span>)} to <code className="rounded bg-black/5 px-1">.env.local</code>. Uploading and editing 3D models, offline templates, print checks and export work without keys.
            </p>
          </div>
        </div>
      )}

      <section>
        <div className="mb-4 flex items-end justify-between">
          <h2 className="text-xl font-semibold tracking-tight">Recent projects</h2>
          {projects.length > 4 && <Link href="/projects" className="text-sm text-accent hover:underline">View all</Link>}
        </div>
        <ProjectsGrid initial={projects} limit={4} />
      </section>
    </main>
  );
}
