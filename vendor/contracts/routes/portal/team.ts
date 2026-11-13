import { z } from "zod";
import { type RouteContract, isoTime, route, uuid } from "../../http.js";
import { PORTAL_ROLES } from "../../portal.js";
import { email } from "../auth.js";

/**
 * The customer's people on the portal (WAccount "People at your store"), for Owners (portal: team). Slice 5
 * `p5-portal-identity`. A person is named by id only within the session's customer: another customer's id and
 * a random id answer the same 404. The last active Owner can't be demoted or deactivated (409 last_owner).
 */

export const PORTAL_USER_STATUSES = ["invited", "active", "deactivated"] as const;

export const teamMemberRow = z.object({
  id: uuid,
  name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  role: z.enum(PORTAL_ROLES),
  status: z.enum(PORTAL_USER_STATUSES),
  lastLoginAt: isoTime.nullable(),
  /** The signed-in person's own row. */
  you: z.boolean(),
  version: z.number().int(),
});

const userParams = z.object({ userId: uuid });
const version = z.number().int().min(1);
const phone = z.string().trim().max(40).nullable().optional();

export const listTeam = route({
  id: "portal.team.list",
  method: "GET",
  path: "/v1/portal/team",
  access: { portal: "team" },
  response: z.object({ rows: z.array(teamMemberRow) }),
});

/** Invites a teammate: an email with a set-password link (7 days). */
export const inviteTeamMember = route({
  id: "portal.team.invite",
  method: "POST",
  path: "/v1/portal/team/invite",
  access: { portal: "team" },
  idempotency: "required",
  status: 201,
  body: z
    .object({
      name: z.string().trim().min(1, "Enter a name").max(200),
      email,
      phone,
      role: z.enum(PORTAL_ROLES),
    })
    .strict(),
  response: teamMemberRow,
});

export const updateTeamMember = route({
  id: "portal.team.update",
  method: "PATCH",
  path: "/v1/portal/team/:userId",
  access: { portal: "team" },
  idempotency: "optional",
  params: userParams,
  body: z
    .object({
      version,
      name: z.string().trim().min(1).max(200).optional(),
      phone,
      role: z.enum(PORTAL_ROLES).optional(),
    })
    .strict(),
  response: teamMemberRow,
});

/** Signs them out everywhere; their orders and history stay. */
export const deactivateTeamMember = route({
  id: "portal.team.deactivate",
  method: "POST",
  path: "/v1/portal/team/:userId/deactivate",
  access: { portal: "team" },
  idempotency: "optional",
  params: userParams,
  body: z.object({ version }).strict(),
  response: teamMemberRow,
});

export const reactivateTeamMember = route({
  id: "portal.team.reactivate",
  method: "POST",
  path: "/v1/portal/team/:userId/reactivate",
  access: { portal: "team" },
  idempotency: "optional",
  params: userParams,
  body: z.object({ version }).strict(),
  response: teamMemberRow,
});

/**
 * UX audit ACC-6 (D1649): "Resend invite" for someone still Invited: a fresh set-password link and its email
 * (`portal_team_invite`). Refused once they have a password (`already_active`) or are deactivated.
 */
export const resendTeamInvite = route({
  id: "portal.team.resend_invite",
  method: "POST",
  path: "/v1/portal/team/:userId/resend-invite",
  access: { portal: "team" },
  idempotency: "optional",
  params: userParams,
  body: z.object({ version }).strict(),
  response: teamMemberRow,
});

export const ROUTES = {
  listTeam,
  inviteTeamMember,
  updateTeamMember,
  deactivateTeamMember,
  reactivateTeamMember,
  resendTeamInvite,
} satisfies Record<string, RouteContract>;
