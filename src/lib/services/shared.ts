import { eq } from "drizzle-orm";
import { getDb, schema } from "../db/client";

export const getProject = (id: string) => getDb().select().from(schema.projects).where(eq(schema.projects.id, id)).get();
