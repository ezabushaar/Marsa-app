import { z } from "zod";
import { isoTime, limitQuery, offsetQuery, page, route, uuid } from "../http.js";
import { PERMISSIONS, type Permission, ROLES } from "../permissions.js";

/** Emails are compared lower-cased and trimmed. */
export const email = z.string().trim().toLowerCase().pipe(z.string().email("Enter a valid email").max(254));
/** Long enough for any real password; longer inputs are refused before any hashing. */
export const password = z
  .string()
  .min(1, "Enter a password")
  .max(256, "Passwords are at most 256 characters");

export const signedInUser = z.object({
  id: uuid,
  name: z.string(),
  email: z.string(),
  role: z.enum(ROLES),
});

export const login = route({
  id: "auth.login",
  method: "POST",
  path: "/v1/auth/login",
  access: { public: true },
  body: z
    .object({
      /**
       * The shared email shape: anything else (often a password typed into the wrong box) is refused before it
       * reaches sign-in, so it is never looked up or audited.
       */
      email,
      password,
      /** Scripts and tests that use a Bearer token ask for it; the Control app uses the cookie only. */
      tokenInBody: z.boolean().optional(),
    })
    .strict(),
  response: z.object({
    user: signedInUser,
    permissions: z.array(z.enum(PERMISSIONS)),
    expiresAt: isoTime,
    token: z.string().optional(),
  }),
});

/** Works without a session: an absent or already revoked session still answers 204. */
export const logout = route({
  id: "auth.logout",
  method: "POST",
  path: "/v1/auth/logout",
  access: { public: true },
  noContent: true,
});

/** Always 202 with the same body, whether or not the account exists. */
export const requestPasswordReset = route({
  id: "auth.password_reset.request",
  method: "POST",
  path: "/v1/auth/password-reset/request",
  access: { public: true },
  status: 202,
  body: z.object({ email: z.string().trim().min(1).max(254) }).strict(),
  response: z.object({ accepted: z.literal(true) }),
});

/** Sets the password from a reset or invite link. Single use. */
export const confirmPasswordReset = route({
  id: "auth.password_reset.confirm",
  method: "POST",
  path: "/v1/auth/password-reset/confirm",
  access: { public: true },
  body: z.object({ token: z.string().min(1).max(200), newPassword: password }).strict(),
  noContent: true,
});

/** Change own password. A wrong current password counts toward the lockout. */
export const changePassword = route({
  id: "auth.password.change",
  method: "POST",
  path: "/v1/auth/password",
  access: { self: true },
  body: z.object({ currentPassword: password, newPassword: password }).strict(),
  noContent: true,
});

// ── People and roles ────────────────────────────────────────────────────

export const USER_STATUSES = ["active", "invited", "locked", "deactivated"] as const;

export const userRow = z.object({
  id: uuid,
  email: z.string(),
  name: z.string(),
  role: z.enum(ROLES),
  /** Extra single permissions on top of the role. */
  grants: z.array(z.enum(PERMISSIONS)),
  status: z.enum(USER_STATUSES),
  active: z.boolean(),
  lockedUntil: isoTime.nullable(),
  /** Newest of the last sign-in and the last request on any session (SetTeam "Last active"). */
  lastActiveAt: isoTime.nullable(),
  version: z.number().int(),
  createdAt: isoTime,
  /** E1 (D1352): the role's ref (a built-in's key or a custom role's id) and name. */
  roleId: z.string().nullish(),
  roleName: z.string().nullish(),
});

export const USER_SORTS = ["name", "role", "lastActive", "status"] as const;

export const listUsers = route({
  id: "users.list",
  method: "GET",
  path: "/v1/users",
  access: { permission: "users.manage" },
  query: z.object({
    includeInactive: z
      .enum(["true", "false", "1", "0"])
      .transform((v) => v === "true" || v === "1")
      .optional(),
    /** Matches the name or email. */
    search: z.string().trim().max(100).optional(),
    sort: z.enum(USER_SORTS).default("name"),
    dir: z.enum(["asc", "desc"]).default("asc"),
    limit: limitQuery,
    offset: offsetQuery,
  }),
  response: page(userRow),
});

/** A colleague as every signed-in person may see them: no email, no permissions. */
export const personRow = z.object({ id: uuid, name: z.string(), role: z.enum(ROLES), active: z.boolean() });

/**
 * The staff directory: names for pickers (sales rep, CRM owner) and the audit log's "Anyone" filter. Open to
 * every signed-in person because it carries only names and roles; people management stays on /v1/users.
 */
export const listPeople = route({
  id: "people.list",
  method: "GET",
  path: "/v1/people",
  access: { self: true },
  query: z.object({
    includeInactive: z
      .enum(["true", "false", "1", "0"])
      .transform((v) => v === "true" || v === "1")
      .optional(),
  }),
  response: z.object({ rows: z.array(personRow) }),
});

const reason = z.string().trim().max(500);
const idParams = z.object({ id: uuid });
/**
 * E1 (D1360): a person's access is changed by someone who manages everyone (users.manage) or, for the people in
 * their own team, a manager (team.access); the service checks the team and that the caller outranks them.
 */
const PEOPLE: readonly Permission[] = ["users.manage", "team.access"];
/** E1: a role's ref — a built-in's key or a custom role's uuid (the service checks it). */
const roleId = z.string().trim().min(1).max(64);

export const createUser = route({
  id: "users.create",
  method: "POST",
  path: "/v1/users",
  access: { permission: "users.manage" },
  idempotency: "required",
  body: z
    .object({
      email,
      name: z.string().trim().min(1, "Enter a name").max(200),
      role: z.enum(ROLES),
      /** E1: a custom role (or a built-in by key); the person takes that role's base as their kind. */
      roleId: roleId.optional(),
      grants: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length).optional(),
    })
    .strict(),
  response: userRow,
});

export const updateUser = route({
  id: "users.update",
  method: "PATCH",
  path: "/v1/users/:id",
  access: { permission: PEOPLE },
  idempotency: "optional",
  params: idParams,
  body: z
    .object({
      version: z.number().int().min(1),
      name: z.string().trim().min(1).max(200).optional(),
      /**
       * A new work (sign-in) email: refused when another person has it (409 email_taken). Both the old and the
       * new address are told; an invited person gets a fresh invite link at the new address. Only an Owner
       * changes their own email this way.
       */
      email: email.optional(),
      role: z.enum(ROLES).optional(),
      /** E1: give a custom role (or a built-in by key); wins over `role`. */
      roleId: roleId.optional(),
      reason: reason.optional(),
    })
    .strict(),
  response: userRow,
});

export const setUserGrants = route({
  id: "users.grants",
  method: "PUT",
  path: "/v1/users/:id/grants",
  access: { permission: "users.manage" },
  idempotency: "optional",
  params: idParams,
  body: z
    .object({
      version: z.number().int().min(1),
      grants: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length),
      reason: reason.optional(),
    })
    .strict(),
  response: userRow,
});

const versionAndReason = z
  .object({ version: z.number().int().min(1), reason: reason.min(1, "Say why") })
  .strict();

export const deactivateUser = route({
  id: "users.deactivate",
  method: "POST",
  path: "/v1/users/:id/deactivate",
  access: { permission: "users.manage" },
  idempotency: "optional",
  params: idParams,
  body: versionAndReason,
  response: userRow,
});

export const reactivateUser = route({
  id: "users.reactivate",
  method: "POST",
  path: "/v1/users/:id/reactivate",
  access: { permission: "users.manage" },
  idempotency: "optional",
  params: idParams,
  body: versionAndReason,
  response: userRow,
});

const optionalReason = z.object({ reason: reason.optional() }).strict();

export const unlockUser = route({
  id: "users.unlock",
  method: "POST",
  path: "/v1/users/:id/unlock",
  access: { permission: PEOPLE },
  idempotency: "optional",
  params: idParams,
  body: optionalReason,
  response: userRow,
});

export const revokeUserSessions = route({
  id: "users.sessions.revoke",
  method: "POST",
  path: "/v1/users/:id/sessions/revoke",
  access: { permission: PEOPLE },
  idempotency: "optional",
  params: idParams,
  body: optionalReason,
  response: z.object({ revoked: z.number().int() }),
});

export const resendInvite = route({
  id: "users.invite",
  method: "POST",
  path: "/v1/users/:id/invite",
  access: { permission: PEOPLE },
  idempotency: "optional",
  params: idParams,
  body: optionalReason,
  response: userRow,
});

/**
 * Owner/Admin sends a password-reset email for a person (Settings › Team › Edit). Same link and template as
 * Forgot password; older reset links stop working. Loud refusals (unlike the public forgot flow).
 */
export const sendPasswordReset = route({
  id: "users.password_reset",
  method: "POST",
  path: "/v1/users/:id/password-reset",
  access: { permission: PEOPLE },
  idempotency: "optional",
  params: idParams,
  body: optionalReason,
  response: userRow,
});

// ── Notifications ───────────────────────────────────────────────────────

/**
 * The notification centre's tabs (U14, D580): All, Mentions, Approvals and Alerts. A notification belongs to
 * one group by its kind; pending approvals and the system's open alerts join the Approvals and Alerts tabs from
 * their own reads (`approvals.list`, `work.alerts`).
 */
export const NOTIFICATION_GROUPS = ["mentions", "approvals", "alerts", "other"] as const;
export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];

const APPROVAL_KINDS = new Set([
  "approval_decided",
  "approval_invalidated",
  "return_approval_needed",
  // E3: a schedule request waits for the manager.
  "schedule_request",
]);
const ALERT_KINDS = new Set([
  "account_locked",
  "vendor_bank_changed",
  "bin_count_needed",
  // P10 (D1984): a sales line's shortage transfer waits for the warehouse to dispatch it.
  "transfer_requested",
  "website_refund_kept",
  "website_product_deleted",
  "website_refund_duplicate",
  "website_shipped_waiting",
  "history_refund_review",
  "legacy_paid_over",
  // EasyPost (D2193): the carrier reports a problem with a shipped parcel.
  "tracking_exception",
]);

/** Which tab a notification shows under besides All. */
export function notificationGroup(kind: string): NotificationGroup {
  if (kind === "mention") return "mentions";
  if (APPROVAL_KINDS.has(kind)) return "approvals";
  if (ALERT_KINDS.has(kind)) return "alerts";
  return "other";
}

export const notificationRow = z.object({
  id: uuid,
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  createdAt: isoTime,
  readAt: isoTime.nullable(),
  /** U14: hidden from the bell until then (null when not snoozed, or the time has passed). */
  snoozedUntil: isoTime.nullable(),
});

/** The caller's own notifications, unread first, newest first. Snoozed ones stay out until their time. */
export const listNotifications = route({
  id: "notifications.list",
  method: "GET",
  path: "/v1/notifications",
  access: { self: true },
  query: z.object({ limit: limitQuery, offset: offsetQuery }),
  response: page(notificationRow).extend({ unread: z.number().int() }),
});

/**
 * The bell's cheap poll (U14, D581): the unread count (snoozed ones left out) and when the newest one arrived,
 * so the panel reads the full list only when it is opened or something new came in.
 */
export const countNotifications = route({
  id: "notifications.count",
  method: "GET",
  path: "/v1/notifications/count",
  access: { self: true },
  response: z.object({ unread: z.number().int(), latestAt: isoTime.nullable() }),
});

export const markNotificationRead = route({
  id: "notifications.read",
  method: "POST",
  path: "/v1/notifications/:id/read",
  access: { self: true },
  params: idParams,
  noContent: true,
});

/** Mark all read (U14): every unread notification of the caller's, snoozed ones included. */
export const markAllNotificationsRead = route({
  id: "notifications.read_all",
  method: "POST",
  path: "/v1/notifications/read-all",
  access: { self: true },
  idempotency: "optional",
  body: z.object({}).strict().default({}),
  response: z.object({ marked: z.number().int() }),
});

/** The longest a notification can be snoozed. */
export const MAX_SNOOZE_DAYS = 14;

/**
 * Snooze (U14, D582): the notification leaves the bell and the unread count until `until` (in the future, at
 * most 14 days away), then comes back unread. `until: null` brings it back now. Snoozing again moves the time.
 */
export const snoozeNotification = route({
  id: "notifications.snooze",
  method: "POST",
  path: "/v1/notifications/:id/snooze",
  access: { self: true },
  idempotency: "optional",
  params: idParams,
  body: z.object({ until: isoTime.nullable() }).strict(),
  response: notificationRow,
});
