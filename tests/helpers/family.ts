/**
 * The standard multi-user cast, shared by every scheduling suite.
 *
 * One family with the full range of member kinds, because multi-user bugs live
 * in the members people forget: the dependent with no account, the member who
 * is not the creator, the invited-but-not-yet-active relative, the removed
 * ex-member, and the stranger in another family.
 */
import { app } from "../../worker/index";
import {
  createTestEnv,
  seedActor,
  seedDependent,
  seedFamily,
  seedInactiveActor,
  seedUser,
  type TestEnv,
} from "./testEnv";

export interface Cast {
  t: TestEnv;
  familyId: string;
  otherFamilyId: string;
  dad: ReturnType<typeof seedActor>;
  mum: ReturnType<typeof seedActor>;
  teen: ReturnType<typeof seedActor>;
  timmy: { id: string };
  gran: ReturnType<typeof seedInactiveActor>;
  expelled: ReturnType<typeof seedInactiveActor>;
  stranger: ReturnType<typeof seedActor>;
}

export function seedCast(): Cast {
  const t = createTestEnv();
  const founder = seedUser(t.sqlite);
  const familyId = seedFamily(t.sqlite, founder.id, "The Family").id;

  const dad = seedActor(t.sqlite, familyId, "owner", { name: "Dad" });
  const mum = seedActor(t.sqlite, familyId, "admin", { name: "Mum" });
  const teen = seedActor(t.sqlite, familyId, "member", { name: "Teen" });
  const timmy = seedDependent(t.sqlite, familyId, "Timmy");
  const gran = seedInactiveActor(t.sqlite, familyId, "invited");
  const expelled = seedInactiveActor(t.sqlite, familyId, "removed");

  const outsiderUser = seedUser(t.sqlite);
  const otherFamilyId = seedFamily(t.sqlite, outsiderUser.id, "Other Family").id;
  const stranger = seedActor(t.sqlite, otherFamilyId, "owner", { name: "Stranger" });

  return { t, familyId, otherFamilyId, dad, mum, teen, timmy, gran, expelled, stranger };
}

/** Authenticated JSON request. Origin is set so the CSRF middleware allows it. */
export function request(
  t: TestEnv,
  method: string,
  path: string,
  cookie: string,
  body?: object,
) {
  return app.request(
    path,
    {
      method,
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: body ? JSON.stringify(body) : undefined,
    },
    t.env,
  );
}

/** Three days out, on the hour — far enough that no reminder window fires. */
export const SOON = Math.floor(Date.now() / 1000) + 3 * 86_400;

export interface CreatedEvent {
  id: string;
  updatedAt: number;
}

/** Creates an event and returns its id, failing loudly if creation did not 201. */
export async function createEvent(
  t: TestEnv,
  cookie: string,
  familyId: string,
  overrides: Record<string, unknown> = {},
): Promise<CreatedEvent> {
  const res = await request(t, "POST", "/api/events", cookie, {
    familyId,
    title: "Dentist",
    startAt: SOON,
    endAt: SOON + 3600,
    type: "appointment",
    ...overrides,
  });
  if (res.status !== 201) {
    throw new Error(`event create failed: ${res.status} ${await res.text()}`);
  }
  const { event } = (await res.json()) as { event: CreatedEvent };
  return event;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
}

/** Every in-app notification currently addressed to this user. */
export async function notificationsFor(
  t: TestEnv,
  cookie: string,
): Promise<Notification[]> {
  const res = await request(t, "GET", "/api/notifications", cookie);
  const body = (await res.json()) as { notifications: Notification[] };
  return body.notifications;
}

/** Notifications of one type, the usual assertion target. */
export async function notificationsOfType(
  t: TestEnv,
  cookie: string,
  type: string,
): Promise<Notification[]> {
  return (await notificationsFor(t, cookie)).filter((n) => n.type === type);
}
