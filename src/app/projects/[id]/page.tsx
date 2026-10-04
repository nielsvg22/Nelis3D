import { notFound } from "next/navigation";
import { Workspace } from "@/components/workspace/Workspace";
import { getCurrentUser } from "@/lib/auth";
import { getProjectDetail } from "@/lib/services/projects";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const project = getProjectDetail(user.id, id);
  if (!project) notFound();
  return <Workspace initial={project} />;
}
