import { z } from "zod";
import { type RouteContract, day, isoTime, route, uuid } from "../http.js";
import type { Permission } from "../permissions.js";

/**
 * E3 scheduling (docs/phases/roles-employees-time-plan.md Part B; time-clock-design.md §3.7, §5; D1090–D1129): a
 * week board per work site — shifts drawn, moved and resized (or typed in the shift form), templates, roles and
 * headcount needed per day, conflicts flagged, an overtime forecast per person; draft until published, then every
 * change is a reschedule with a reason the person is told and the shift's history keeps; requests (time off, swap,
 * drop, pick up) for the manager's decision; My schedule on the phone and the desk; the optional login schedule.
 *
 * A published shift is what Marsa Time reads: the expected end, rules R3/R5/R7/R8, the forgot-to-clock-in nudge and
 * the late alert.
 */

export const SHIFT_STATUSES = ["draft", "published", "cancelled"] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];
export const SHIFT_STATUS_LABELS: Record<ShiftStatus, string> = {
  draft: "Draft",
  published: "Published",
  cancelled: "Canceled",
};

export const HISTORY_ACTIONS = [
  "created",
  "changed",
  "published",
  "rescheduled",
  "cancelled",
  "swapped",
  "dropped",
  "picked_up",
  "time_off",
] as const;
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];
export const HISTORY_ACTION_LABELS: Record<HistoryAction, string> = {
  created: "Created",
  changed: "Changed (draft)",
  published: "Published",
  rescheduled: "Rescheduled",
  cancelled: "Canceled",
  swapped: "Swapped",
  dropped: "Dropped",
  picked_up: "Picked up",
  time_off: "Opened for approved time off",
};

export const REQUEST_KINDS = ["time_off", "swap", "drop", "pickup"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];
export const REQUEST_KIND_LABELS: Record<RequestKind, string> = {
  time_off: "Time off",
  swap: "Swap",
  drop: "Drop a shift",
  pickup: "Pick up a shift",
};

/** colleague: a swap waiting for the colleague to accept; pending: waiting for the manager. */
export const REQUEST_STATUSES = ["colleague", "pending", "approved", "declined", "cancelled"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  colleague: "Waiting for the colleague",
  pending: "Waiting for the manager",
  approved: "Approved",
  declined: "Declined",
  cancelled: "Canceled",
};

/** Conflicts are warnings in words (D1097): the board flags them; nothing is refused for one. */
export const CONFLICT_KINDS = [
  "overlap",
  "time_off",
  "time_off_pending",
  "max_hours",
  "minor",
  "not_active",
] as const;
export type ConflictKind = (typeof CONFLICT_KINDS)[number];
export const CONFLICT_LABELS: Record<ConflictKind, string> = {
  overlap: "Overlaps another shift",
  time_off: "Approved time off",
  time_off_pending: "Time off asked",
  max_hours: "Over the week's hours",
  minor: "Under-18 limit",
  not_active: "Not active",
};

/** Overtime is past 40 hours in the workweek (FLSA); the board and the alert warn from 38 (design §2, §6 Q5). */
export const OVERTIME_WEEK_MIN = 2400;
export const OT_ALERT_MIN = 2280;
/** The week's hours a person is scheduled up to before the board flags it, unless their record says otherwise. */
export const DEFAULT_MAX_WEEK_MIN = 2400;

/**
 * Under-18 limits the board flags (D1098) — Indiana's rules for 16 and 17 year olds on a school week, the strictest
 * week we can't tell apart [Inference: the record holds "under 18", not the age or the school calendar; verify with
 * counsel]: at most 9 hours a day, 40 a week, 6 days; not before 6:00 AM, nor after 10:00 PM on a night before a
 * school day (Sunday–Thursday) or 11:30 PM otherwise; and the T3 meal rule (30 min in 6 h or more).
 */
export const MINOR_LIMITS = {
  dayMin: 540,
  weekMin: 2400,
  days: 6,
  earliest: 360,
  latestSchoolNight: 1320,
  latestOtherNight: 1410,
  mealMin: 30,
  mealShiftMin: 360,
} as const;

/** A login schedule lets the person sign in from this long before a published shift until this long after it. */
export const LOGIN_GRACE_MIN = 30;
export const LOGIN_OVERRIDE_MAX_HOURS = 12;
/** The forgot-to-clock-in nudges (D1108): 15 min before the start, then 10 min after it (and the manager's alert). */
export const STARTS_SOON_MIN = 15;
export const NOT_IN_AFTER_MIN = 10;
/** A shift is at most 16 hours. */
export const MAX_SHIFT_MIN = 960;
/** The board's drawing range per day (the keyboard form takes any time). */
export const BOARD_DAY_START_MIN = 300;
export const BOARD_DAY_END_MIN = 1440;
/** Dragging snaps to this many minutes. */
export const SNAP_MIN = 15;
/** On touch (D1897), a shift is picked up by holding it this long; a tap then drops it where it lands. */
export const LONG_PRESS_MS = 500;
/** A trade or a swap may name a colleague's shift this far ahead (My schedule lists them). */
export const SWAP_AHEAD_DAYS = 14;

/** "HH:MM" as the part-day time-off window and the school calendar take it. */
export const hhmmString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Times are HH:MM");

/**
 * The school calendar for the under-18 rules (D1898): term dates and holidays. With no terms (the default), every
 * Sunday–Thursday night is treated as a school night, as D1098 did; with terms, a night before a weekday inside a
 * term that isn't a holiday is a school night, and every other night isn't.
 */
export const schoolCalendarSchema = z
  .object({
    terms: z
      .array(
        z
          .object({ from: day, to: day })
          .strict()
          .refine((t) => t.to >= t.from, "A term ends after it starts"),
      )
      .max(20),
    holidays: z.array(day).max(200),
  })
  .strict();
export type SchoolCalendar = z.output<typeof schoolCalendarSchema>;
export const EMPTY_SCHOOL_CALENDAR: SchoolCalendar = { terms: [], holidays: [] };

/** 0 Sunday … 6 Saturday. */
const weekdayOf = (dayStr: string) => new Date(`${dayStr}T12:00:00Z`).getUTCDay();

/** A school day: a weekday inside a term that isn't a holiday. Without terms, nothing is known: null. */
export function isSchoolDay(dayStr: string, cal: SchoolCalendar | null | undefined): boolean | null {
  if (!cal || !cal.terms.length) return null;
  const wd = weekdayOf(dayStr);
  if (wd === 0 || wd === 6) return false;
  if (cal.holidays.includes(dayStr)) return false;
  return cal.terms.some((t) => dayStr >= t.from && dayStr <= t.to);
}

/** Is the night a shift ends on (starting on `dayStr`) before a school day? Without a calendar: Sunday–Thursday. */
export function isSchoolNight(dayStr: string, cal: SchoolCalendar | null | undefined): boolean {
  const d = new Date(`${dayStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  const tomorrow = d.toISOString().slice(0, 10);
  const known = isSchoolDay(tomorrow, cal);
  return known === null ? weekdayOf(dayStr) <= 4 : known;
}

export const SCHEDULE_EDIT: readonly Permission[] = ["employees.schedule"];
export const SCHEDULE_SELF: readonly Permission[] = ["time.self"];
export const SCHEDULE_READ_PERSON: readonly Permission[] = ["employees.schedule", "employees.manage"];

// ── Wall-clock helpers (pure; the board and the server share them) ─────────────

const formats = new Map<string, Intl.DateTimeFormat>();
function partsIn(at: Date, timeZone: string) {
  let f = formats.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formats.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** Minutes after midnight of a moment, on the wall clock of a time zone (and that day). */
export function wallClock(at: Date, timeZone: string): { day: string; minutes: number } {
  return partsIn(at, timeZone);
}

/** The moment a wall-clock time happens in a time zone (minutes may pass 1440: the next day). DST-safe. */
export function zonedInstant(dayStr: string, minutes: number, timeZone: string): Date {
  const [y, m, d] = dayStr.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d) + Math.round(minutes) * 60_000;
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const p = partsIn(new Date(t), timeZone);
    const [ly, lm, ld] = p.day.split("-").map(Number) as [number, number, number];
    const asUtc = Date.UTC(ly, lm - 1, ld) + p.minutes * 60_000;
    t = guess - (asUtc - t);
  }
  return new Date(t);
}

/** "08:30" → 510; null when it isn't a time. */
export function parseHhmm(s: string): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function hhmm(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** A shift's paid minutes: its length less its break. */
export const shiftPaidMinutes = (s: { start: string | Date; end: string | Date; breakMin: number }) =>
  Math.max(0, Math.round((new Date(s.end).getTime() - new Date(s.start).getTime()) / 60_000) - s.breakMin);

// ── Rows ───────────────────────────────────────────────────────────────────

const ref = z.object({ id: uuid, name: z.string() });
const person = z.object({ id: uuid, number: z.string(), name: z.string() });

export const conflictRow = z.object({ kind: z.enum(CONFLICT_KINDS), words: z.string() });

export const jobPin = z.object({
  name: z.string().trim().min(1).max(120),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const shiftRow = z.object({
  id: uuid,
  site: ref,
  /** Null: an open shift. */
  employee: person.nullable(),
  /** The day it starts on at its site (the board's column). */
  day,
  start: isoTime,
  end: isoTime,
  breakMin: z.number().int(),
  /** Paid minutes (length less the break). */
  minutes: z.number().int(),
  role: z.string().nullable(),
  templateId: uuid.nullable(),
  job: jobPin.nullable(),
  note: z.string().nullable(),
  status: z.enum(SHIFT_STATUSES),
  /** Published once: a change now is a reschedule (a reason, the person told). */
  wasPublished: z.boolean(),
  version: z.number().int(),
  conflicts: z.array(conflictRow),
  /** The caller may change it (their team, open shifts, or time.manage: everyone). */
  canEdit: z.boolean(),
  /** An open request on it (a drop, a swap, a pick up) — the board shows a chip. */
  request: z.object({ id: uuid, kind: z.enum(REQUEST_KINDS), status: z.enum(REQUEST_STATUSES) }).nullable(),
});

export const templateRow = z.object({
  id: uuid,
  name: z.string(),
  site: ref.nullable(),
  startTime: z.string(),
  endTime: z.string(),
  breakMin: z.number().int(),
  role: z.string().nullable(),
  active: z.boolean(),
});

export const boardPerson = z.object({
  employee: person,
  jobTitle: z.string().nullable(),
  minor: z.boolean(),
  maxWeekMin: z.number().int(),
  /** The caller may schedule this person. */
  canEdit: z.boolean(),
  /** Scheduled minutes this week at every site (drafts too). */
  scheduledMin: z.number().int(),
  /** Worked so far this week (the time clock). */
  workedMin: z.number().int(),
  /**
   * The overtime forecast (design §2): worked so far plus what is still scheduled (the whole week's schedule for a
   * week not started yet).
   */
  forecastMin: z.number().int(),
  /** forecast past 38 h: "warn"; past 40 h: "overtime". */
  forecast: z.enum(["ok", "warn", "overtime"]),
  loginSchedule: z.boolean(),
  /** Approved (or asked) time off on days of this week; `window` is a part-day's hours ("1:00 PM–3:00 PM"). */
  timeOff: z.array(
    z.object({ day, status: z.enum(["approved", "pending"]), window: z.string().nullable().optional() }),
  ),
});

export const board = route({
  id: "schedule.board",
  method: "GET",
  path: "/v1/schedule/board",
  access: { permission: SCHEDULE_EDIT },
  query: z.object({
    siteId: uuid.optional(),
    /** Any day of the week to show (the Sunday-to-Saturday workweek); default this week. */
    week: day.optional(),
  }),
  response: z.object({
    site: ref.nullable(),
    sites: z.array(ref.extend({ timezone: z.string() })),
    timezone: z.string(),
    week: z.object({
      start: day,
      days: z.array(day),
      /** Published once (the week's first publish). */
      publishedAt: isoTime.nullable(),
      /** Draft shifts waiting to be published (the button's count). */
      drafts: z.number().int(),
      /** Draft shifts the caller may publish. */
      publishable: z.number().int(),
      conflicts: z.number().int(),
    }),
    people: z.array(boardPerson),
    /** This site's shifts (and open shifts) this week. */
    shifts: z.array(shiftRow),
    /** The same people's shifts at other sites this week (read-only, for overlaps). */
    elsewhere: z.array(shiftRow),
    needs: z.array(
      z.object({ day, role: z.string(), headcount: z.number().int(), filled: z.number().int() }),
    ),
    templates: z.array(templateRow),
    /** Open requests the caller decides (the inbox count). */
    requests: z.number().int(),
    canEdit: z.boolean(),
  }),
});

const shiftFields = {
  employeeId: uuid.nullish(),
  start: isoTime,
  end: isoTime,
  breakMin: z.number().int().min(0).max(240).optional(),
  role: z.string().trim().max(60).nullish(),
  templateId: uuid.nullish(),
  job: jobPin.nullish(),
  note: z.string().trim().max(300).nullish(),
};

export const createShift = route({
  id: "schedule.shifts.create",
  method: "POST",
  path: "/v1/schedule/shifts",
  access: { permission: SCHEDULE_EDIT },
  idempotency: "required",
  status: 201,
  body: z.object({ siteId: uuid, ...shiftFields }).strict(),
  response: shiftRow,
});

export const updateShift = route({
  id: "schedule.shifts.update",
  method: "PATCH",
  path: "/v1/schedule/shifts/:id",
  access: { permission: SCHEDULE_EDIT },
  idempotency: "optional",
  params: z.object({ id: uuid }),
  body: z
    .object({
      siteId: uuid.optional(),
      employeeId: uuid.nullish(),
      start: isoTime.optional(),
      end: isoTime.optional(),
      breakMin: z.number().int().min(0).max(240).optional(),
      role: z.string().trim().max(60).nullish(),
      job: jobPin.nullish(),
      note: z.string().trim().max(300).nullish(),
      /** Required once published: what the person is told. */
      reason: z.string().trim().max(300).nullish(),
      version: z.number().int().optional(),
    })
    .strict(),
  response: shiftRow,
});

export const cancelShift = route({
  id: "schedule.shifts.cancel",
  method: "POST",
  path: "/v1/schedule/shifts/:id/cancel",
  access: { permission: SCHEDULE_EDIT },
  idempotency: "optional",
  params: z.object({ id: uuid }),
  body: z.object({ reason: z.string().trim().max(300).nullish() }).strict(),
  response: z.object({ ok: z.literal(true), notified: z.boolean() }),
});

export const shiftHistory = route({
  id: "schedule.shifts.history",
  method: "GET",
  path: "/v1/schedule/shifts/:id/history",
  access: { permission: SCHEDULE_EDIT },
  params: z.object({ id: uuid }),
  response: z.object({
    rows: z.array(
      z.object({
        id: uuid,
        action: z.enum(HISTORY_ACTIONS),
        /** "Tue 3 Nov 8:00 AM–4:30 PM · Ali Picker" before and after, in words. */
        before: z.string().nullable(),
        after: z.string().nullable(),
        reason: z.string().nullable(),
        notified: z.boolean(),
        by: z.string().nullable(),
        at: isoTime,
      }),
    ),
  }),
});

export const copyWeek = route({
  id: "schedule.copy_week",
  method: "POST",
  path: "/v1/schedule/copy-week",
  access: { permission: SCHEDULE_EDIT },
  idempotency: "required",
  body: z.object({ siteId: uuid, week: day }).strict(),
  response: z.object({ copied: z.number().int(), skipped: z.number().int() }),
});

export const publishWeek = route({
  id: "schedule.publish",
  method: "POST",
  path: "/v1/schedule/publish",
  access: { permission: SCHEDULE_EDIT },
  idempotency: "required",
  body: z.object({ siteId: uuid, week: day }).strict(),
  response: z.object({ published: z.number().int(), notified: z.number().int() }),
});

export const listTemplates = route({
  id: "schedule.templates.list",
  method: "GET",
  path: "/v1/schedule/templates",
  access: { permission: SCHEDULE_EDIT },
  response: z.object({ rows: z.array(templateRow) }),
});

const templateFields = {
  name: z.string().trim().min(1).max(60),
  siteId: uuid.nullish(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Times are HH:MM"),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Times are HH:MM"),
  breakMin: z.number().int().min(0).max(240).optional(),
  role: z.string().trim().max(60).nullish(),
};

export const createTemplate = route({
  id: "schedule.templates.create",
  method: "POST",
  path: "/v1/schedule/templates",
  access: { permission: SCHEDULE_EDIT },
  idempotency: "required",
  status: 201,
  body: z.object(templateFields).strict(),
  response: templateRow,
});

export const updateTemplate = route({
  id: "schedule.templates.update",
  method: "PATCH",
  path: "/v1/schedule/templates/:id",
  access: { permission: SCHEDULE_EDIT },
  idempotency: "optional",
  params: z.object({ id: uuid }),
  body: z
    .object({
      name: templateFields.name.optional(),
      siteId: uuid.nullish(),
      startTime: templateFields.startTime.optional(),
      endTime: templateFields.endTime.optional(),
      breakMin: templateFields.breakMin,
      role: templateFields.role,
      active: z.boolean().optional(),
    })
    .strict(),
  response: templateRow,
});

export const setNeed = route({
  id: "schedule.needs.set",
  method: "PUT",
  path: "/v1/schedule/needs",
  access: { permission: SCHEDULE_EDIT },
  idempotency: "optional",
  body: z
    .object({
      siteId: uuid,
      day,
      role: z.string().trim().min(1).max(60),
      /** 0 removes the line. */
      headcount: z.number().int().min(0).max(50),
    })
    .strict(),
  response: z.object({ ok: z.literal(true) }),
});

// ── Requests ───────────────────────────────────────────────────────────────

export const requestRow = z.object({
  id: uuid,
  kind: z.enum(REQUEST_KINDS),
  status: z.enum(REQUEST_STATUSES),
  employee: person,
  shift: shiftRow.omit({ conflicts: true, canEdit: true, request: true }).nullable(),
  colleague: person.nullable(),
  colleagueAnsweredAt: isoTime.nullable(),
  colleagueNote: z.string().nullable(),
  /** A trade (D1893): the colleague's shift the asker takes in return. */
  tradeShift: shiftRow.omit({ conflicts: true, canEdit: true, request: true }).nullable(),
  startsOn: day.nullable(),
  endsOn: day.nullable(),
  /** Part-day time off (D1895): the window on that day ("13:00", "15:00"); null for whole days. */
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  reason: z.string(),
  approver: ref.nullable(),
  decidedBy: ref.nullable(),
  decidedAt: isoTime.nullable(),
  decisionNote: z.string().nullable(),
  createdAt: isoTime,
  /** What approving it would cause, in words (an overlap, over the hours, shifts during the time off). */
  warnings: z.array(z.string()),
  /** The caller may approve or decline it now. */
  canDecide: z.boolean(),
});

export const listRequests = route({
  id: "schedule.requests.list",
  method: "GET",
  path: "/v1/schedule/requests",
  access: { permission: SCHEDULE_EDIT },
  query: z.object({ status: z.enum(["open", "decided"]).optional() }),
  response: z.object({ rows: z.array(requestRow), open: z.number().int() }),
});

export const createRequest = route({
  id: "schedule.requests.create",
  method: "POST",
  path: "/v1/schedule/requests",
  access: { permission: SCHEDULE_SELF },
  idempotency: "required",
  status: 201,
  body: z
    .object({
      kind: z.enum(REQUEST_KINDS),
      /** swap, drop, pickup. */
      shiftId: uuid.nullish(),
      /** swap: the colleague asked to take it. */
      colleagueEmployeeId: uuid.nullish(),
      /** swap: a trade — the colleague's published shift the asker takes in return. */
      tradeShiftId: uuid.nullish(),
      /** time off: whole days, inclusive. */
      startsOn: day.nullish(),
      endsOn: day.nullish(),
      /** time off on one day: part of it (both or neither; the first and last day must be the same). */
      startTime: hhmmString.nullish(),
      endTime: hhmmString.nullish(),
      reason: z.string().trim().min(1).max(300),
    })
    .strict(),
  response: requestRow,
});

export const answerSwap = route({
  id: "schedule.requests.colleague",
  method: "POST",
  path: "/v1/schedule/requests/:id/colleague",
  access: { permission: SCHEDULE_SELF },
  idempotency: "optional",
  params: z.object({ id: uuid }),
  body: z.object({ accept: z.boolean(), note: z.string().trim().max(300).nullish() }).strict(),
  response: requestRow,
});

export const cancelRequest = route({
  id: "schedule.requests.cancel",
  method: "POST",
  path: "/v1/schedule/requests/:id/cancel",
  access: { permission: SCHEDULE_SELF },
  idempotency: "optional",
  params: z.object({ id: uuid }),
  body: z.object({}).strict(),
  response: requestRow,
});

export const decideRequest = route({
  id: "schedule.requests.decide",
  method: "POST",
  path: "/v1/schedule/requests/:id/decide",
  access: { permission: SCHEDULE_EDIT },
  idempotency: "optional",
  params: z.object({ id: uuid }),
  body: z
    .object({
      approve: z.boolean(),
      /** Required to decline (the person is told why). */
      note: z.string().trim().max(300).nullish(),
    })
    .strict(),
  response: requestRow,
});

// ── My schedule ──────────────────────────────────────────────────────────────

const myShift = shiftRow.omit({ conflicts: true, canEdit: true });

export const mySchedule = route({
  id: "schedule.me",
  method: "GET",
  path: "/v1/schedule/me",
  access: { permission: SCHEDULE_SELF },
  response: z.object({
    /** Null when the sign-in isn't linked to an employee record. */
    employee: person.nullable(),
    today: day,
    thisWeek: z.object({ start: day, minutes: z.number().int(), shifts: z.array(myShift) }),
    nextWeek: z.object({ start: day, minutes: z.number().int(), shifts: z.array(myShift) }),
    nextShift: myShift.nullable(),
    /** My requests (the last 60 days), newest first. */
    requests: z.array(requestRow),
    /** Swaps colleagues asked me to take, waiting for my answer. */
    asks: z.array(requestRow),
    /** Published open shifts (from today) I may ask to pick up. */
    openShifts: z.array(myShift),
    /** People I can ask to swap with (active, with a sign-in). */
    colleagues: z.array(person),
    /** Colleagues' published shifts in the next two weeks I could take in a trade (D1893). */
    colleagueShifts: z.array(myShift),
    loginSchedule: z.boolean(),
    /** Schedule messages go by email too (D1891); My schedule's switch. */
    scheduleEmail: z.boolean(),
  }),
});

export const updateMySchedule = route({
  id: "schedule.me.update",
  method: "PATCH",
  path: "/v1/schedule/me",
  access: { permission: SCHEDULE_SELF },
  idempotency: "optional",
  body: z.object({ scheduleEmail: z.boolean() }).strict(),
  response: mySchedule.response,
});

// ── A person's schedule settings (the employee record's Schedule tab) ────────

export const personSchedule = route({
  id: "schedule.person",
  method: "GET",
  path: "/v1/schedule/people/:employeeId",
  access: { permission: SCHEDULE_READ_PERSON },
  params: z.object({ employeeId: uuid }),
  response: z.object({
    employee: person,
    loginSchedule: z.boolean(),
    maxWeekMin: z.number().int().nullable(),
    /** Published and draft shifts from today, the next 14 days. */
    upcoming: z.array(myShift),
    /** A one-off sign-in still open. */
    override: z.object({ until: isoTime, reason: z.string(), by: z.string().nullable() }).nullable(),
    canEdit: z.boolean(),
  }),
});

export const updatePerson = route({
  id: "schedule.person.update",
  method: "PATCH",
  path: "/v1/schedule/people/:employeeId",
  access: { permission: SCHEDULE_EDIT },
  idempotency: "optional",
  params: z.object({ employeeId: uuid }),
  body: z
    .object({
      loginSchedule: z.boolean().optional(),
      /** Hours a week before the board flags it; null = 40 h. */
      maxWeekMin: z.number().int().min(60).max(4800).nullish(),
    })
    .strict(),
  response: personSchedule.response,
});

export const grantLoginOverride = route({
  id: "schedule.login_override",
  method: "POST",
  path: "/v1/schedule/people/:employeeId/login-override",
  access: { permission: SCHEDULE_EDIT },
  idempotency: "optional",
  params: z.object({ employeeId: uuid }),
  body: z
    .object({
      hours: z.number().int().min(1).max(LOGIN_OVERRIDE_MAX_HOURS),
      reason: z.string().trim().min(1).max(300),
    })
    .strict(),
  response: personSchedule.response,
});

export const SCHEDULE_ROUTES = {
  board,
  createShift,
  updateShift,
  cancelShift,
  shiftHistory,
  copyWeek,
  publishWeek,
  listTemplates,
  createTemplate,
  updateTemplate,
  setNeed,
  listRequests,
  createRequest,
  answerSwap,
  cancelRequest,
  decideRequest,
  mySchedule,
  updateMySchedule,
  personSchedule,
  updatePerson,
  grantLoginOverride,
} satisfies Record<string, RouteContract>;
