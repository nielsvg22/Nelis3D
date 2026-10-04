"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { ProjectDetailDTO } from "@/lib/types";

/**
 * Holds the project state and keeps it fresh: polls while a background job runs (1.5 s),
 * so the user can leave and come back – the server job keeps going.
 */
export function useProject(initial: ProjectDetailDTO) {
  const [project, setProject] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const p = await api<ProjectDetailDTO>(`/api/projects/${initial.id}`);
      if (alive.current) {
        setProject(p);
        setError(null);
      }
      return p;
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Connection problem");
      return null;
    }
  }, [initial.id]);

  const polling = !!project.activeJob;
  useEffect(() => {
    if (!polling) return;
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, [polling, refresh]);

  useEffect(() => {
    alive.current = true;
    const onVis = () => !document.hidden && refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive.current = false;
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  return { project, refresh, error, setProject };
}
