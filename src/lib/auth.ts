import { eq } from "drizzle-orm";
import { getDb, schema } from "./db/client";
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
 */
export async function getCurrentUser(): Promise<SessionUser> {
  const db = getDb();
  const email = env.devUserEmail;
  const existing = db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  if (existing) return existing;
  const user = { id: newId("u_"), email, name: "Development user" };
  db.insert(schema.users).values(user).run();
  return user;
}
