import { eq } from "drizzle-orm";
import { first, getDb, schema } from "../db/client";

export const getProject = async (id: string) => first((await getDb()).select().from(schema.projects).where(eq(schema.projects.id, id)));
