/**
 * Drizzle schema — the SINGLE SOURCE OF TRUTH for the database.
 * SQL migrations are generated from this via `npm run db:generate` (drizzle-kit) and
 * applied to D1 with `wrangler d1 migrations apply`. Do not hand-edit migrations to add
 * columns; change the schema here and regenerate.
 */
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch())`;

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  googleSub: text("google_sub").notNull().unique(),
  email: text("email").notNull(),
  name: text("name"),
  picture: text("picture"),
  // UI preference: large-text / high-contrast "Simple mode" (esp. for elderly
  // members). A per-USER pref synced across that user's devices — NOT inferred
  // from family `dependent` records (the logged-in session is always a 'user').
  prefersSimpleMode: integer("prefers_simple_mode", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("created_at").notNull().default(now),
  lastLoginAt: integer("last_login_at"),
});

export const families = sqliteTable("families", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerUserId: text("owner_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  driveFolderId: text("drive_folder_id"),
  // ISO 4217; one currency per family. Additive and default-safe.
  defaultCurrency: text("default_currency").notNull().default("USD"),
  createdAt: integer("created_at").notNull().default(now),
});

export const familyMembers = sqliteTable(
  "family_members",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    // NULLABLE: dependents (children, elderly relatives) have no Google account.
    // For memberType='dependent', userId is null and displayName is used instead.
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    // memberType distinguishes a real authenticated user from a managed dependent.
    memberType: text("member_type", { enum: ["user", "dependent"] })
      .notNull()
      .default("user"),
    // Used when userId is null (dependent). For 'user' members the name comes from users.name.
    displayName: text("display_name"),
    dateOfBirth: text("date_of_birth"), // ISO yyyy-mm-dd, optional (useful for children)
    // Wedding / relationship anniversary — ISO yyyy-mm-dd, optional.
    anniversaryDate: text("anniversary_date"),
    role: text("role", { enum: ["owner", "admin", "member"] })
      .notNull()
      .default("member"),
    status: text("status", { enum: ["active", "invited", "removed"] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    // NULLs are distinct in SQLite unique indexes, so multiple dependents
    // (userId=null) can coexist in one family while real users stay unique.
    unique("uq_family_user").on(t.familyId, t.userId),
    index("idx_member_user").on(t.userId),
  ],
);

export const invites = sqliteTable(
  "invites",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    // Store only the HASH of the invite token (treat like a password).
    tokenHash: text("token_hash").notNull().unique(),
    role: text("role", { enum: ["admin", "member"] })
      .notNull()
      .default("member"),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    acceptedAt: integer("accepted_at"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("idx_invite_email").on(t.email)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(now),
    expiresAt: integer("expires_at").notNull(),
    idleExpiresAt: integer("idle_expires_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull().default(now),
    userAgent: text("user_agent"),
  },
  (t) => [index("idx_session_expires").on(t.expiresAt)],
);

export const documents = sqliteTable(
  "documents",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    category: text("category").notNull().default("other"),
    subjectMemberId: text("subject_member_id").references(
      () => familyMembers.id,
      { onDelete: "set null" },
    ),
    description: text("description"),
    expiryDate: text("expiry_date"), // ISO yyyy-mm-dd
    issuedDate: text("issued_date"),
    currentFileId: text("current_file_id"),
    visibility: text("visibility", { enum: ["family", "private"] })
      .notNull()
      .default("family"),
    status: text("status", { enum: ["active", "trashed"] })
      .notNull()
      .default("active"),
    trashedAt: integer("trashed_at"),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    index("idx_doc_family_expiry").on(t.familyId, t.expiryDate),
    index("idx_doc_family_status").on(t.familyId, t.status),
  ],
);

export const files = sqliteTable(
  "files",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    /** Where bytes live. New uploads default to R2; legacy Drive rows stay `drive`. */
    storageProvider: text("storage_provider", { enum: ["r2", "drive"] })
      .notNull()
      .default("r2"),
    /** R2 object key when storageProvider = 'r2'. */
    r2Key: text("r2_key"),
    /** Google Drive file id when storageProvider = 'drive'. Nullable for R2-only rows. */
    driveFileId: text("drive_file_id"),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    version: integer("version").notNull().default(1),
    isCurrent: integer("is_current", { mode: "boolean" })
      .notNull()
      .default(true),
    status: text("status", { enum: ["active", "deleted"] })
      .notNull()
      .default("active"),
    deletedAt: integer("deleted_at"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("idx_file_doc_current").on(t.documentId, t.isCurrent)],
);

export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
  },
  (t) => [unique("uq_family_tag").on(t.familyId, t.name)],
);

export const documentTags = sqliteTable(
  "document_tags",
  {
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.tagId] }),
    index("idx_doctag_tag").on(t.tagId),
  ],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    familyId: text("family_id").references(() => families.id, {
      onDelete: "cascade",
    }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    read: integer("read", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("idx_notif_user_read").on(t.userId, t.read, t.createdAt)],
);

export const remindersLog = sqliteTable(
  "reminders_log",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    windowDays: integer("window_days").notNull(),
    channel: text("channel", { enum: ["in_app", "email"] }).notNull(),
    sentAt: integer("sent_at").notNull().default(now),
  },
  (t) => [
    unique("uq_reminder").on(t.documentId, t.userId, t.windowDays, t.channel),
  ],
);

export const reminderPrefs = sqliteTable("reminder_prefs", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  emailEnabled: integer("email_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  pushEnabled: integer("push_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  windowsJson: text("windows_json").notNull().default("[30,7,1]"),
  // Where reminders are delivered. NULL = the account's sign-in address.
  // Set this to route reminders to a different inbox than the Google login.
  reminderEmail: text("reminder_email"),
  // Monday morning digest of the week's money + expiries.
  digestEnabled: integer("digest_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
});

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id").references(() => families.id, {
      onDelete: "cascade",
    }),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Dot-namespaced taxonomy: `<domain>.<verb_pasttense>` (e.g. document.downloaded,
    // member.role_changed, secret.revealed, auth.login). See worker/lib/audit.ts ACTIONS.
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    // Small, NON-sensitive context only (titles, old→new role). Never secret values.
    meta: text("meta"),
    // 'security' tags auth/role/reveal/admin events so the admin view can filter them.
    severity: text("severity", { enum: ["info", "security"] })
      .notNull()
      .default("info"),
    // Snapshot of the TARGET's visibility at write time, so the family activity feed
    // can hide other members' private-item actions without re-joining the (possibly
    // deleted) target. Mirrors documents.visibility semantics.
    visibility: text("visibility", { enum: ["family", "private"] })
      .notNull()
      .default("family"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    index("idx_audit_family_time").on(t.familyId, t.createdAt),
    index("idx_audit_actor_time").on(t.actorUserId, t.createdAt),
    index("idx_audit_family_sev_time").on(t.familyId, t.severity, t.createdAt),
  ],
);

// ── Calendar / Events ────────────────────────────────────────────────────────

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    startAt: integer("start_at").notNull(), // unix timestamp (seconds)
    endAt: integer("end_at"), // null = single-instant / all-day
    allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
    location: text("location"),
    // type = what kind of event (gathering, appointment, milestone, other)
    type: text("type", {
      enum: ["gathering", "appointment", "milestone", "other"],
    })
      .notNull()
      .default("other"),
    // status = lifecycle (soft-delete and cancel are separate from type)
    status: text("status", { enum: ["active", "cancelled", "trashed"] })
      .notNull()
      .default("active"),
    trashedAt: integer("trashed_at"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
    // Google Calendar event id on the user's primary calendar (best-effort sync).
    googleCalendarEventId: text("google_calendar_event_id"),
  },
  (t) => [
    index("idx_event_family_start").on(t.familyId, t.startAt),
    index("idx_event_family_status_start").on(t.familyId, t.status, t.startAt),
  ],
);

// Members tagged as attendees/participants for an event.
export const eventAttendees = sqliteTable(
  "event_attendees",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => familyMembers.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.memberId] })],
);

// Documents linked to an event (e.g. insurance card linked to a hospital visit).
export const eventDocuments = sqliteTable(
  "event_documents",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.documentId] })],
);

// Deduplicate event reminders (parallel to reminders_log for documents).
export const eventRemindersLog = sqliteTable(
  "event_reminders_log",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    windowDays: integer("window_days").notNull(),
    channel: text("channel", { enum: ["in_app", "email"] }).notNull(),
    sentAt: integer("sent_at").notNull().default(now),
  },
  (t) => [
    unique("uq_event_reminder").on(
      t.eventId,
      t.userId,
      t.windowDays,
      t.channel,
    ),
  ],
);

// ── Tasks ────────────────────────────────────────────────────────────────────

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    notes: text("notes"),
    assignedToMemberId: text("assigned_to_member_id").references(
      () => familyMembers.id,
      { onDelete: "set null" },
    ),
    dueDate: text("due_date"), // ISO yyyy-mm-dd; null = no deadline
    status: text("status", { enum: ["open", "done", "archived"] })
      .notNull()
      .default("open"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    relatedDocumentId: text("related_document_id").references(
      () => documents.id,
      { onDelete: "set null" },
    ),
    relatedEventId: text("related_event_id").references(() => events.id, {
      onDelete: "set null",
    }),
    referredTaskId: text("referred_task_id"),
    subtasksJson: text("subtasks_json"),
    reminderDate: text("reminder_date"),
    remindMemberId: text("remind_member_id").references(() => familyMembers.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    index("idx_task_family_status").on(t.familyId, t.status),
    index("idx_task_assignee").on(t.assignedToMemberId),
  ],
);

// ── Emergency Contacts ───────────────────────────────────────────────────────

export const contacts = sqliteTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    relationship: text("relationship"), // Doctor, School, Plumber, …
    phone: text("phone"),
    email: text("email"),
    notes: text("notes"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
    /** Google People API resource name (`people/c...`) when synced. */
    googleResourceName: text("google_resource_name"),
    googleEtag: text("google_etag"),
    lastPushedAt: integer("last_pushed_at"),
  },
  (t) => [
    index("idx_contact_family").on(t.familyId),
    unique("uq_contact_google_resource").on(t.familyId, t.googleResourceName),
  ],
);

// Platform authenticator (Face ID / fingerprint / Windows Hello) per user.
export const deviceCredentials = sqliteTable(
  "device_credentials",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Base64url credential id from the authenticator. */
    credentialId: text("credential_id").notNull().unique(),
    /** JWK JSON of the ES256 public key. */
    publicKeyJwk: text("public_key_jwk").notNull(),
    counter: integer("counter").notNull().default(0),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("idx_device_cred_user").on(t.userId)],
);

// Fallback 6-digit PIN when WebAuthn is unavailable (desktop without biometrics).
export const devicePins = sqliteTable("device_pins", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  pinHash: text("pin_hash").notNull(),
  salt: text("salt").notNull(),
  createdAt: integer("created_at").notNull().default(now),
});

// ── Member Health Notes ──────────────────────────────────────────────────────

export const memberHealth = sqliteTable("member_health", {
  memberId: text("member_id")
    .primaryKey()
    .references(() => familyMembers.id, { onDelete: "cascade" }),
  bloodType: text("blood_type"),
  allergies: text("allergies"), // free-text (or comma-separated list)
  medications: text("medications"),
  doctorName: text("doctor_name"),
  doctorPhone: text("doctor_phone"),
  notes: text("notes"),
  updatedAt: integer("updated_at").notNull().default(now),
});

// ── Document Comments ────────────────────────────────────────────────────────

export const documentComments = sqliteTable(
  "document_comments",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
    deletedAt: integer("deleted_at"),
  },
  (t) => [index("idx_comment_doc").on(t.documentId, t.createdAt)],
);

// ── Secrets Vault (client-side encrypted; the Worker never sees plaintext) ─────
//
// Encryption model: HYBRID. A per-family Vault Data Key (VDK) encrypts every
// item client-side; the VDK is wrapped per member (KEK from passkey-PRF or
// passphrase) plus an owner escrow copy for recovery. Every `*_cipher` /
// `wrapped_*` column holds base64url ciphertext the server stores opaquely.

// One logical vault per family. Holds the crypto scheme version + KDF defaults.
export const vaults = sqliteTable("vaults", {
  id: text("id").primaryKey(),
  familyId: text("family_id")
    .notNull()
    .references(() => families.id, { onDelete: "cascade" })
    .unique(),
  // Bump when algorithms change → enables re-wrap/forward-compat without a schema change.
  schemeVersion: integer("scheme_version").notNull().default(1),
  // KDF defaults for the passphrase path (Web Crypto has PBKDF2, not Argon2).
  kdfParams: text("kdf_params")
    .notNull()
    .default('{"alg":"PBKDF2-SHA256","iter":600000}'),
  createdAt: integer("created_at").notNull().default(now),
});

// Wrapped copies of the family VDK — one per member, plus escrow rows
// (memberId NULL + isEscrow=1 → owner-recovery wrap).
export const vaultKeys = sqliteTable(
  "vault_keys",
  {
    id: text("id").primaryKey(),
    vaultId: text("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    memberId: text("member_id").references(() => familyMembers.id, {
      onDelete: "cascade",
    }),
    isEscrow: integer("is_escrow", { mode: "boolean" })
      .notNull()
      .default(false),
    wrapMethod: text("wrap_method", {
      enum: ["passkey", "passphrase", "recovery_code", "ecdh_grant"],
    }).notNull(),
    wrappedDek: text("wrapped_dek").notNull(), // base64url(wrap(VDK))
    wrapIv: text("wrap_iv"), // base64url IV when GCM-wrapped
    kdfSalt: text("kdf_salt"), // base64url salt (passphrase/recovery paths)
    kdfParams: text("kdf_params"), // JSON override of vaults.kdfParams
    // For ecdh_grant: ephemeral pubkey the grantee uses to derive the unwrap key.
    grantEphemeralPubkey: text("grant_ephemeral_pubkey"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    index("idx_vaultkey_vault").on(t.vaultId),
    index("idx_vaultkey_member").on(t.memberId),
    unique("uq_vaultkey_member_method").on(
      t.vaultId,
      t.memberId,
      t.wrapMethod,
    ),
  ],
);

// Per-member long-lived ECDH public key for receiving VDK grants/re-wraps.
export const vaultMemberKeys = sqliteTable("vault_member_keys", {
  memberId: text("member_id")
    .primaryKey()
    .references(() => familyMembers.id, { onDelete: "cascade" }),
  publicKey: text("public_key").notNull(), // base64url SPKI P-256 pubkey (cleartext OK)
  wrappedPrivkey: text("wrapped_privkey").notNull(), // privkey wrapped by member KEK
  privkeyIv: text("privkey_iv").notNull(),
  createdAt: integer("created_at").notNull().default(now),
});

// Registered WebAuthn credentials (passkey PRF unlock + step-up assertions).
export const vaultPasskeys = sqliteTable(
  "vault_passkeys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull().unique(), // base64url
    publicKey: text("public_key").notNull(), // COSE pubkey for assertion verify
    signCount: integer("sign_count").notNull().default(0),
    transports: text("transports"), // JSON ["internal","hybrid"]
    label: text("label"), // "Mom's iPhone"
    prfSalt: text("prf_salt").notNull(), // fixed per-credential PRF input salt
    createdAt: integer("created_at").notNull().default(now),
    lastUsedAt: integer("last_used_at"),
  },
  (t) => [index("idx_passkey_user").on(t.userId)],
);

// A secret. Sensitive fields are ciphertext; only blind tags + metadata are queryable.
// `cipher` holds the metadata blob (title/username/url/notes); `secret_cipher` holds the
// high-sensitivity value separately so list views decrypt metadata without the secret.
export const vaultItems = sqliteTable(
  "vault_items",
  {
    id: text("id").primaryKey(),
    vaultId: text("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    // Denormalized for fast family scoping (matches the app's family_id-heavy queries).
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    ownerMemberId: text("owner_member_id").references(
      () => familyMembers.id,
      { onDelete: "set null" },
    ),
    type: text("type", {
      enum: ["login", "wifi", "bank", "card", "pin", "note", "totp_seed", "other"],
    })
      .notNull()
      .default("other"),
    // Same semantics as documents.visibility. 'private' = only owner can see/decrypt.
    visibility: text("visibility", { enum: ["family", "private"] })
      .notNull()
      .default("family"),
    // private + escrowExcluded → sealed under a per-item subkey (vault_item_keys), no escrow.
    escrowExcluded: integer("escrow_excluded", { mode: "boolean" })
      .notNull()
      .default(false),
    voiceReadable: integer("voice_readable", { mode: "boolean" })
      .notNull()
      .default(false),
    cipher: text("cipher").notNull(), // base64url ciphertext (metadata blob)
    iv: text("iv").notNull(), // base64url 12-byte IV
    secretCipher: text("secret_cipher"), // separate blob for the high-sensitivity value
    secretIv: text("secret_iv"),
    // Blind indexes (HMAC-SHA256 under a separate blind-index key) for server-side filtering.
    blindTitle: text("blind_title"),
    blindAccount: text("blind_account"),
    blindIssuer: text("blind_issuer"),
    status: text("status", { enum: ["active", "trashed"] })
      .notNull()
      .default("active"),
    trashedAt: integer("trashed_at"),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    index("idx_vitem_family_status").on(t.familyId, t.status),
    index("idx_vitem_blind_title").on(t.blindTitle),
    index("idx_vitem_blind_account").on(t.blindAccount),
  ],
);

// Trigram blind tags for prefix/substring search (parallel to document_tags join pattern).
export const vaultBlindTags = sqliteTable(
  "vault_blind_tags",
  {
    itemId: text("item_id")
      .notNull()
      .references(() => vaultItems.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(), // HMAC(BIK, trigram), base64url
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.tag] }),
    index("idx_vbtag_tag").on(t.tag), // the search index
  ],
);

// Per-item subkey, ONLY for private + escrowExcluded items (sealed under member KEK).
export const vaultItemKeys = sqliteTable("vault_item_keys", {
  itemId: text("item_id")
    .primaryKey()
    .references(() => vaultItems.id, { onDelete: "cascade" }),
  memberId: text("member_id")
    .notNull()
    .references(() => familyMembers.id, { onDelete: "cascade" }),
  wrappedKey: text("wrapped_key").notNull(), // item subkey wrapped by member KEK
  wrapIv: text("wrap_iv").notNull(),
});

// Version history (undo/audit) — parallels files versioning + soft-delete style.
export const vaultItemVersions = sqliteTable(
  "vault_item_versions",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => vaultItems.id, { onDelete: "cascade" }),
    cipher: text("cipher").notNull(),
    iv: text("iv").notNull(),
    editedByMemberId: text("edited_by_member_id").references(
      () => familyMembers.id,
      { onDelete: "set null" },
    ),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("idx_vitemver_item").on(t.itemId, t.createdAt)],
);

// ── Generic modules (the extensible "boring problems" long tail) ──────────────
//
// One table absorbs many future record-keeping modules (subscriptions, warranties,
// insurance, bills, vehicles, credentials, wiki, checklists, important dates …).
// Common fields are promoted to real columns (indexable); module-specific fields
// live in JSON `data`, validated per-type by a Zod schema in worker/modules.
export const items = sqliteTable(
  "items",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    // Module discriminator, e.g. 'subscription' | 'warranty' | 'insurance' | 'bill' | …
    type: text("type").notNull(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subjectMemberId: text("subject_member_id").references(
      () => familyMembers.id,
      { onDelete: "set null" },
    ),
    title: text("title").notNull(),
    // Generic "this has a date that should drive reminders" (renewal/expiry/service).
    dueDate: text("due_date"), // ISO yyyy-mm-dd
    amountCents: integer("amount_cents"),
    data: text("data"), // JSON blob (module-specific, Zod-validated per type)
    visibility: text("visibility", { enum: ["family", "private"] })
      .notNull()
      .default("family"),
    status: text("status", { enum: ["active", "trashed"] })
      .notNull()
      .default("active"),
    trashedAt: integer("trashed_at"),
    searchText: text("search_text"), // denormalized for cross-module search
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    index("idx_item_family_type_status").on(t.familyId, t.type, t.status),
    index("idx_item_family_due").on(t.familyId, t.dueDate), // reminder scan + "expiring soon"
    index("idx_item_search").on(t.familyId, t.searchText),
  ],
);

// Dedupe log for generic `items` reminders (parallel to reminders_log/event_reminders_log).
export const itemRemindersLog = sqliteTable(
  "item_reminders_log",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    windowDays: integer("window_days").notNull(),
    channel: text("channel", { enum: ["in_app", "email"] }).notNull(),
    sentAt: integer("sent_at").notNull().default(now),
  },
  (t) => [
    unique("uq_item_reminder").on(
      t.itemId,
      t.userId,
      t.windowDays,
      t.channel,
    ),
  ],
);

/**
 * Dedupe log for birthday / anniversary reminder emails.
 * Keyed by (memberId, kind, year, windowDays, channel) so each window fires once
 * per calendar year per member.
 */
export const lifeEventRemindersLog = sqliteTable(
  "life_event_reminders_log",
  {
    id: text("id").primaryKey(),
    memberId: text("member_id")
      .notNull()
      .references(() => familyMembers.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // "birthday" | "anniversary"
    kind: text("kind").notNull(),
    // Calendar year of the occurrence we reminded about (e.g. 2026).
    occurrenceYear: integer("occurrence_year").notNull(),
    windowDays: integer("window_days").notNull(),
    channel: text("channel", { enum: ["in_app", "email"] }).notNull(),
    sentAt: integer("sent_at").notNull().default(now),
  },
  (t) => [
    unique("uq_life_event_reminder").on(
      t.memberId,
      t.kind,
      t.occurrenceYear,
      t.windowDays,
      t.channel,
    ),
  ],
);

// ── Platform / maintainer ops (NOT per-family — application-wide) ─────────────

// Platform-level admins. Distinct from per-family roles. Runtime source of truth;
// the FIRST admin is bootstrapped lazily from env.PLATFORM_ADMIN_EMAILS (no
// self-promotion endpoint). See worker/middleware/requirePlatformAdmin.ts.
export const platformAdmins = sqliteTable("platform_admins", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  level: text("level", { enum: ["maintainer", "superadmin"] })
    .notNull()
    .default("maintainer"),
  grantedBy: text("granted_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: integer("created_at").notNull().default(now),
});

// Time-series storage/usage metrics. Long-narrow (metric/value) so NEW metrics
// never require a migration. scope='global' for D1/KV totals; 'family' for per-family rollups.
export const storageSnapshots = sqliteTable(
  "storage_snapshots",
  {
    id: text("id").primaryKey(),
    capturedAt: integer("captured_at").notNull().default(now),
    scope: text("scope", { enum: ["global", "family"] }).notNull(),
    familyId: text("family_id").references(() => families.id, {
      onDelete: "cascade",
    }),
    // e.g. 'd1_bytes','d1_freelist_bytes','kv_keys_total','drive_bytes_active','rows_audit_log'
    metric: text("metric").notNull(),
    value: integer("value").notNull(), // bytes or counts
  },
  (t) => [
    index("idx_snap_metric_time").on(t.metric, t.capturedAt),
    index("idx_snap_family_time").on(t.familyId, t.capturedAt),
  ],
);

// Observable maintenance-job run history (reminders, purge, metrics, cleanup, retention …).
export const jobRuns = sqliteTable(
  "job_runs",
  {
    id: text("id").primaryKey(),
    jobKey: text("job_key").notNull(),
    trigger: text("trigger", { enum: ["cron", "manual"] }).notNull(),
    triggeredBy: text("triggered_by").references(() => users.id, {
      onDelete: "set null",
    }),
    status: text("status", { enum: ["running", "ok", "error"] })
      .notNull()
      .default("running"),
    startedAt: integer("started_at").notNull().default(now),
    finishedAt: integer("finished_at"),
    stats: text("stats"), // JSON result counts (mirrors cron RunStats)
    error: text("error"),
  },
  (t) => [index("idx_jobrun_key_time").on(t.jobKey, t.startedAt)],
);

// Application-wide cloud-storage backend account. Single active row (id='default'):
// all families' document files live in THIS account's Drive, not per-family-owner
// Drives. Configured by a platform admin via the /admin/storage connect flow. The
// OAuth refresh + access tokens live in KV (storage:refresh_token / storage:access_token),
// NEVER in this table and NEVER exposed to the browser — D1 holds only config.
export const storageAccounts = sqliteTable("storage_accounts", {
  id: text("id").primaryKey(),
  provider: text("provider", { enum: ["google_drive"] })
    .notNull()
    .default("google_drive"),
  // Email of the connected storage account (e.g. albertjoshrock101@gmail.com).
  email: text("email"),
  // Root Drive folder under which per-family subfolders are created.
  rootFolderId: text("root_folder_id"),
  status: text("status", { enum: ["connected", "disconnected"] })
    .notNull()
    .default("disconnected"),
  connectedBy: text("connected_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: integer("created_at").notNull().default(now),
  updatedAt: integer("updated_at").notNull().default(now),
});

// ── Expenses ─────────────────────────────────────────────────────────────────
// Personal expense tracking. Every expense belongs to the member who recorded
// it and is `private` by default: only its creator can read it. Marking one
// `family` opts it in to the shared household view. See worker/lib/expenses/.

export const expenseCategories = sqliteTable(
  "expense_categories",
  {
    id: text("id").primaryKey(),
    // NULL = global built-in category shared across families.
    familyId: text("family_id").references(() => families.id, {
      onDelete: "cascade",
    }),
    // One level of nesting only: a child's parent must itself be a root.
    // Enforced in app code (SQLite can't express it as a constraint).
    parentCategoryId: text("parent_category_id").references(
      (): AnySQLiteColumn => expenseCategories.id,
      { onDelete: "cascade" },
    ),
    name: text("name").notNull(),
    icon: text("icon"),
    color: text("color"),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    archivedAt: integer("archived_at"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    unique("uq_expense_category_name").on(t.familyId, t.parentCategoryId, t.name),
    index("idx_expense_category_family_archived").on(t.familyId, t.archived),
  ],
);

export const expenses = sqliteTable(
  "expenses",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    // memberType='user' enforced in app code — never a dependent.
    paidByMemberId: text("paid_by_member_id")
      .notNull()
      .references(() => familyMembers.id),
    // Attribution only (any member type); no effect on who can see the row.
    subjectMemberId: text("subject_member_id").references(() => familyMembers.id, {
      onDelete: "set null",
    }),
    categoryId: text("category_id").references(() => expenseCategories.id, {
      onDelete: "set null",
    }),
    // Nested expenses: Google Pay (root) → individual spends (children).
    // Depths 0 (root), 1 (child), 2 (grandchild). Enforced in app code —
    // parent.nestDepth must be < 2 when attaching. Cascade delete removes
    // the whole subtree when a parent is hard-deleted (soft-trash is app-level).
    parentExpenseId: text("parent_expense_id").references(
      (): AnySQLiteColumn => expenses.id,
      { onDelete: "cascade" },
    ),
    nestDepth: integer("nest_depth").notNull().default(0),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    expenseDate: text("expense_date").notNull(),
    merchant: text("merchant"),
    description: text("description"),
    paymentMethod: text("payment_method"),
    // Reserved for shared splits; personal expenses are always "none".
    splitType: text("split_type", {
      enum: ["none", "equal", "exact", "percentage"],
    })
      .notNull()
      .default("none"),
    // Private by default — the privacy guarantee the feature is built on.
    visibility: text("visibility", { enum: ["family", "private"] })
      .notNull()
      .default("private"),
    status: text("status", { enum: ["active", "trashed"] })
      .notNull()
      .default("active"),
    trashedAt: integer("trashed_at"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientRequestId: text("client_request_id"),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    unique("uq_expense_client_request").on(
      t.familyId,
      t.createdByUserId,
      t.clientRequestId,
    ),
    index("idx_expense_family_date").on(t.familyId, t.expenseDate),
    index("idx_expense_family_status").on(t.familyId, t.status),
    index("idx_expense_created_by").on(t.createdByUserId),
    index("idx_expense_paid_by").on(t.paidByMemberId),
    index("idx_expense_category").on(t.categoryId),
    index("idx_expense_parent").on(t.parentExpenseId),
  ],
);

// ── Financial plan ───────────────────────────────────────────────────────────
// The money model behind the overview: what comes in (incomes), what is already
// committed every period (commitments — EMIs, insurance, SIPs, giving), what is
// being saved for (wishlist), and the targets that turn those into a spendable
// allowance. Everything here follows the same privacy rule as expenses: owned by
// the member who created it, private unless explicitly shared, no role bypass.

export const incomes = sqliteTable(
  "incomes",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    cadence: text("cadence", {
      enum: ["monthly", "weekly", "biweekly", "yearly", "one_off"],
    })
      .notNull()
      .default("monthly"),
    // Which day the money lands — drives the "since payday" window.
    dayOfMonth: integer("day_of_month"),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    visibility: text("visibility", { enum: ["family", "private"] })
      .notNull()
      .default("private"),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    index("idx_income_family_owner").on(t.familyId, t.ownerUserId),
    index("idx_income_active").on(t.familyId, t.active),
  ],
);

export const commitments = sqliteTable(
  "commitments",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: [
        "emi",
        "loan",
        "insurance",
        "investment",
        "subscription",
        "giving",
        "rent",
        "utility",
        "other",
      ],
    }).notNull(),
    name: text("name").notNull(),
    notes: text("notes"),
    // Giving (tithe, sponsorship) is usually a share of income rather than a
    // fixed sum, so the amount can be expressed either way.
    amountKind: text("amount_kind", { enum: ["fixed", "percent_of_income"] })
      .notNull()
      .default("fixed"),
    amountMinor: integer("amount_minor"),
    percentBp: integer("percent_bp"),
    currency: text("currency").notNull(),
    cadence: text("cadence", {
      enum: ["weekly", "monthly", "quarterly", "yearly"],
    })
      .notNull()
      .default("monthly"),
    dayOfMonth: integer("day_of_month"),
    dayOfWeek: integer("day_of_week"),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
    // For EMIs / fixed-term policies: the term length. Remaining installments
    // are derived from this plus startDate, never stored (it can't drift).
    totalInstallments: integer("total_installments"),
    categoryId: text("category_id").references(() => expenseCategories.id, {
      onDelete: "set null",
    }),
    // When true the cron records the expense automatically on the due date.
    autoLog: integer("auto_log", { mode: "boolean" }).notNull().default(false),
    remindDaysBefore: integer("remind_days_before").notNull().default(3),
    status: text("status", { enum: ["active", "paused", "completed"] })
      .notNull()
      .default("active"),
    visibility: text("visibility", { enum: ["family", "private"] })
      .notNull()
      .default("private"),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    index("idx_commitment_family_owner").on(t.familyId, t.ownerUserId),
    index("idx_commitment_status").on(t.familyId, t.status),
    index("idx_commitment_kind").on(t.familyId, t.kind),
  ],
);

// One row per commitment per period. Doubles as the cron's dedupe key (so a
// re-run can't double-log) and as the paid/unpaid ledger the UI reads.
export const commitmentPayments = sqliteTable(
  "commitment_payments",
  {
    id: text("id").primaryKey(),
    commitmentId: text("commitment_id")
      .notNull()
      .references(() => commitments.id, { onDelete: "cascade" }),
    // yyyy-mm for monthly, yyyy-Www for weekly, yyyy-Qn / yyyy for the rest.
    periodKey: text("period_key").notNull(),
    dueDate: text("due_date").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    paid: integer("paid", { mode: "boolean" }).notNull().default(false),
    paidAt: integer("paid_at"),
    // Set when the due-date reminder went out. Doubles as the cron's dedupe
    // flag, so a re-run on the same day can't re-notify.
    remindedAt: integer("reminded_at"),
    expenseId: text("expense_id").references(() => expenses.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    unique("uq_commitment_period").on(t.commitmentId, t.periodKey),
    index("idx_commitment_payment_due").on(t.dueDate, t.paid),
  ],
);

// Per-user planning knobs. Composite key: settings are per member per family.
export const financialSettings = sqliteTable(
  "financial_settings",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    // How the savings goal is expressed.
    savingsTargetKind: text("savings_target_kind", {
      enum: ["none", "amount", "percent"],
    })
      .notNull()
      .default("none"),
    savingsTargetMinor: integer("savings_target_minor"),
    savingsTargetPercentBp: integer("savings_target_percent_bp"),
    // The day the monthly cycle restarts — usually payday, not the 1st.
    paydayDayOfMonth: integer("payday_day_of_month").notNull().default(1),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.userId, t.familyId] })],
);

export const categoryBudgets = sqliteTable(
  "category_budgets",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => expenseCategories.id, { onDelete: "cascade" }),
    monthlyLimitMinor: integer("monthly_limit_minor").notNull(),
    currency: text("currency").notNull(),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [unique("uq_category_budget").on(t.userId, t.categoryId)],
);

export const wishlistItems = sqliteTable(
  "wishlist_items",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    notes: text("notes"),
    url: text("url"),
    estimatedCostMinor: integer("estimated_cost_minor").notNull(),
    currency: text("currency").notNull(),
    // 1 = highest. A small fixed scale keeps sorting meaningful.
    priority: integer("priority").notNull().default(3),
    targetDate: text("target_date"),
    categoryId: text("category_id").references(() => expenseCategories.id, {
      onDelete: "set null",
    }),
    status: text("status", {
      enum: ["wanted", "saving", "purchased", "dropped"],
    })
      .notNull()
      .default("wanted"),
    purchasedExpenseId: text("purchased_expense_id").references(
      () => expenses.id,
      { onDelete: "set null" },
    ),
    purchasedAt: integer("purchased_at"),
    visibility: text("visibility", { enum: ["family", "private"] })
      .notNull()
      .default("private"),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    index("idx_wishlist_family_owner").on(t.familyId, t.ownerUserId),
    index("idx_wishlist_status_priority").on(t.familyId, t.status, t.priority),
  ],
);

// ── Church / collection funds (manual audit ledger) ──────────────────────────
// Sensitive shared pots (e.g. Razorpay offerings): contributions land in a
// member's bank; spends happen during the month; month-start settle reconciles.
// All amounts are amountMinor; payer names are free-text for now (optional
// member link). Settlements snapshot a period and refuse duplicates.

export const fundAccounts = sqliteTable(
  "fund_accounts",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    currency: text("currency").notNull(),
    notes: text("notes"),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    index("idx_fund_accounts_family_status").on(t.familyId, t.status),
  ],
);

export const fundContributions = sqliteTable(
  "fund_contributions",
  {
    id: text("id").primaryKey(),
    fundId: text("fund_id")
      .notNull()
      .references(() => fundAccounts.id, { onDelete: "cascade" }),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    // Free-text payer for church collections; optional member link when known.
    payerName: text("payer_name").notNull(),
    payerMemberId: text("payer_member_id").references(() => familyMembers.id, {
      onDelete: "set null",
    }),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    paidAt: integer("paid_at").notNull(),
    note: text("note"),
    externalRef: text("external_ref"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    index("idx_fund_contrib_fund_paid").on(t.fundId, t.paidAt),
    index("idx_fund_contrib_family").on(t.familyId),
  ],
);

export const fundSpends = sqliteTable(
  "fund_spends",
  {
    id: text("id").primaryKey(),
    fundId: text("fund_id")
      .notNull()
      .references(() => fundAccounts.id, { onDelete: "cascade" }),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    spendDate: text("spend_date").notNull(),
    merchant: text("merchant"),
    description: text("description"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    index("idx_fund_spends_fund_date").on(t.fundId, t.spendDate),
    index("idx_fund_spends_family").on(t.familyId),
  ],
);

export const fundSettlements = sqliteTable(
  "fund_settlements",
  {
    id: text("id").primaryKey(),
    fundId: text("fund_id")
      .notNull()
      .references(() => fundAccounts.id, { onDelete: "cascade" }),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    // yyyy-mm — one settlement snapshot per fund per calendar month.
    periodKey: text("period_key").notNull(),
    contributionsMinor: integer("contributions_minor").notNull(),
    spendsMinor: integer("spends_minor").notNull(),
    remainingMinor: integer("remaining_minor").notNull(),
    settledAt: integer("settled_at").notNull(),
    settledByUserId: text("settled_by_user_id")
      .notNull()
      .references(() => users.id),
    note: text("note"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    unique("uq_fund_settlement_period").on(t.fundId, t.periodKey),
    index("idx_fund_settlements_family").on(t.familyId),
  ],
);

export const fundActivity = sqliteTable(
  "fund_activity",
  {
    id: text("id").primaryKey(),
    fundId: text("fund_id")
      .notNull()
      .references(() => fundAccounts.id, { onDelete: "cascade" }),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metaJson: text("meta_json"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    index("idx_fund_activity_fund_created").on(t.fundId, t.createdAt),
  ],
);

// Settlements against live church-contribution funds (external source of truth
// for collected + spent). Family Vault only records "I settled this month".
export const churchSettlements = sqliteTable(
  "church_settlements",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    fundSlug: text("fund_slug").notNull(),
    periodKey: text("period_key").notNull(), // yyyy-mm
    collectedMinor: integer("collected_minor").notNull(),
    spentMinor: integer("spent_minor").notNull(),
    remainingMinor: integer("remaining_minor").notNull(),
    settledAt: integer("settled_at").notNull(),
    settledByUserId: text("settled_by_user_id")
      .notNull()
      .references(() => users.id),
    note: text("note"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    unique("uq_church_settlement_period").on(t.familyId, t.fundSlug, t.periodKey),
    index("idx_church_settlements_family").on(t.familyId, t.settledAt),
  ],
);
