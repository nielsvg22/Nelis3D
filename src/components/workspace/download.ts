/** Downloads an export via fetch so server-side blocks (e.g. “doesn't fit the printer”) surface as messages instead of a JSON page. */
export async function downloadExport(projectId: string, versionId: string, format: "stl" | "3mf", orient: "as-is" | "best"): Promise<string | null> {
  const res = await fetch(`/api/projects/${projectId}/versions/${versionId}/export?format=${format}&orient=${orient}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return body.error ?? "Export failed";
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `model.${format}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return null;
}
