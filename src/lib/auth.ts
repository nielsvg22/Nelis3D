import { eq } from "drizzle-orm";
import { first, getDb, schema } from "./db/client";
import { env } from "./env";
import { newId } from "./ids";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

/**
 * Authentication seam. v1 returns a single development user.
 * To add real accounts (Auth.js / Clerk / Supabase), resolve the user from the request session here –
 * every route and service already receives the user id and filters on it.
 * On Vercel, keep Vercel Authentication (deployment protection) enabled until real accounts exist.
 */
export async function getCurrentUser(): Promise<SessionUser> {
  const db = await getDb();
  const email = env.devUserEmail;
  const existing = await first(db.select().from(schema.users).where(eq(schema.users.email, email)));
  if (existing) return existing;
  const user = { id: newId("u_"), email, name: "Development user" };
  await db.insert(schema.users).values(user).onConflictDoNothing();
  return (await first(db.select().from(schema.users).where(eq(schema.users.email, email))))!;
}
