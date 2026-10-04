import { ProjectsGrid } from "@/components/ProjectsGrid";
import { getCurrentUser } from "@/lib/auth";
import { listProjects } from "@/lib/services/projects";
import Link from "next/link";
import { Button, Icon } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "My Projects – Nelis3D" };

export default async function ProjectsPage() {
  const user = await getCurrentUser();
  const projects = await listProjects(user.id);
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">My Projects</h1>
          <p className="mt-1 text-sm text-ink-3">{projects.length} project{projects.length === 1 ? "" : "s"}</p>
        </div>
        <Link href="/new"><Button variant="primary"><Icon name="plus" /> New project</Button></Link>
      </div>
      <ProjectsGrid initial={projects} />
    </main>
  );
}
