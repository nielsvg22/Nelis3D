import { NewProject } from "@/components/NewProject";

export const metadata = { title: "New project – Nelis3D" };

export default async function NewPage({ searchParams }: { searchParams: Promise<{ tab?: string; project?: string }> }) {
  const { tab, project } = await searchParams;
  const initial = (["scan", "photos", "model", "describe"].includes(tab ?? "") ? tab : "scan") as "scan" | "photos" | "model" | "describe";
  return (
    <main className="mx-auto px-4 py-8 sm:px-6 sm:py-12">
      <NewProject initialTab={initial} projectId={project} />
    </main>
  );
}
