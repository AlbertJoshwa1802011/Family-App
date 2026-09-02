/**
 * Google People API (Contacts) helpers.
 *
 * Bidirectional sync: pull connections into D1, push local creates/updates
 * back as Google contacts. Phone-address-book entries appear here once the
 * phone is set to back up contacts to the signed-in Google account.
 */
import { GOOGLE_SCOPES } from "./google";

const PEOPLE = "https://people.googleapis.com/v1";
const PERSON_FIELDS = "names,emailAddresses,phoneNumbers,biographies,metadata";

export class PeopleError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "PeopleError";
  }
}

export interface GooglePerson {
  resourceName: string;
  etag?: string;
  names?: { displayName?: string; givenName?: string; familyName?: string }[];
  emailAddresses?: { value?: string }[];
  phoneNumbers?: { value?: string }[];
  biographies?: { value?: string }[];
}

export interface ConnectionsPage {
  connections: GooglePerson[];
  nextSyncToken?: string;
  nextPageToken?: string;
}

function personName(p: GooglePerson): string {
  const n = p.names?.[0];
  const display = n?.displayName?.trim();
  if (display) return display;
  return [n?.givenName, n?.familyName].filter(Boolean).join(" ").trim() || "Unnamed";
}

export function flattenPerson(p: GooglePerson): {
  resourceName: string;
  etag: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
} {
  return {
    resourceName: p.resourceName,
    etag: p.etag ?? null,
    name: personName(p),
    email: p.emailAddresses?.[0]?.value?.trim() || null,
    phone: p.phoneNumbers?.[0]?.value?.trim() || null,
    notes: p.biographies?.[0]?.value?.trim() || null,
  };
}

export async function listConnections(
  accessToken: string,
  opts: { syncToken?: string | null; pageToken?: string | null } = {},
): Promise<ConnectionsPage> {
  const params = new URLSearchParams({
    personFields: PERSON_FIELDS,
    pageSize: "200",
    requestSyncToken: "true",
  });
  if (opts.syncToken) params.set("syncToken", opts.syncToken);
  if (opts.pageToken) params.set("pageToken", opts.pageToken);

  const res = await fetch(`${PEOPLE}/people/me/connections?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 410) {
    throw new PeopleError("sync_token_expired", 410);
  }
  if (!res.ok) {
    throw new PeopleError(`People list failed: ${await res.text()}`, res.status);
  }

  const body = (await res.json()) as {
    connections?: GooglePerson[];
    nextSyncToken?: string;
    nextPageToken?: string;
  };
  return {
    connections: body.connections ?? [],
    nextSyncToken: body.nextSyncToken,
    nextPageToken: body.nextPageToken,
  };
}

export async function createGoogleContact(
  accessToken: string,
  input: { name: string; email?: string | null; phone?: string | null; notes?: string | null },
): Promise<GooglePerson> {
  const person: Record<string, unknown> = {
    names: [{ givenName: input.name }],
  };
  if (input.email) person.emailAddresses = [{ value: input.email }];
  if (input.phone) person.phoneNumbers = [{ value: input.phone }];
  if (input.notes) {
    person.biographies = [{ value: input.notes, contentType: "TEXT_PLAIN" }];
  }

  const res = await fetch(`${PEOPLE}/people:createContact`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(person),
  });
  if (!res.ok) {
    throw new PeopleError(`createContact failed: ${await res.text()}`, res.status);
  }
  return (await res.json()) as GooglePerson;
}

export async function updateGoogleContact(
  accessToken: string,
  resourceName: string,
  input: {
    name: string;
    email?: string | null;
    phone?: string | null;
    notes?: string | null;
    etag?: string | null;
  },
): Promise<GooglePerson> {
  const person: Record<string, unknown> = {
    names: [{ givenName: input.name }],
    emailAddresses: input.email ? [{ value: input.email }] : [],
    phoneNumbers: input.phone ? [{ value: input.phone }] : [],
    biographies: input.notes
      ? [{ value: input.notes, contentType: "TEXT_PLAIN" }]
      : [],
  };
  if (input.etag) person.etag = input.etag;

  const params = new URLSearchParams({
    updatePersonFields: "names,emailAddresses,phoneNumbers,biographies",
  });
  const res = await fetch(`${PEOPLE}/${resourceName}:updateContact?${params}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(person),
  });
  if (!res.ok) {
    throw new PeopleError(`updateContact failed: ${await res.text()}`, res.status);
  }
  return (await res.json()) as GooglePerson;
}

export async function deleteGoogleContact(
  accessToken: string,
  resourceName: string,
): Promise<void> {
  const res = await fetch(`${PEOPLE}/${resourceName}:deleteContact`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new PeopleError(`deleteContact failed: ${await res.text()}`, res.status);
  }
}

export { GOOGLE_SCOPES };
