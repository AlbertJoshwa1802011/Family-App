import type { Db } from "../db/client";
import { schema } from "../db/client";

export interface NewNotification {
  userId: string;
  familyId?: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
}

/** Inserts an in-app notification. Returns the generated id. */
export async function createNotification(
  db: Db,
  n: NewNotification,
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.notifications).values({
    id,
    userId: n.userId,
    familyId: n.familyId,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
  });
  return id;
}
