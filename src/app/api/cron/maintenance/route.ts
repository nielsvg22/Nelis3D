import { NextResponse } from "next/server";
import { maintenance } from "@/lib/jobs/queue";
import { env } from "@/lib/env";

export const maxDuration = 300;

/** Daily safety net (see vercel.json): finishes orphaned jobs, purges expired scan photos. */
export async function GET(req: Request) {
  if (env.isServerless && (!env.cronSecret || req.headers.get("authorization") !== `Bearer ${env.cronSecret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await maintenance());
}
