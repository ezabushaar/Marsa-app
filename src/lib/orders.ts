import type * as account from "../../vendor/contracts/routes/portal/account";
import type * as shop from "../../vendor/contracts/routes/portal/shop";

/** The pill colour of an order's stage. */
export function stageTone(stage: (typeof shop.PORTAL_ORDER_STAGES)[number]) {
  switch (stage) {
    case "on_credit_hold":
    case "ready_to_pay":
      return "warn" as const;
    case "cancelled":
      return "neg" as const;
    case "shipped":
    case "closed":
    case "confirmed":
      return "pos" as const;
    default:
      return "neutral" as const;
  }
}

/** Where a tracking number can be followed: UPS's own page for 1Z numbers, else a web search. */
export function trackingUrl(number: string): string {
  const n = number.trim();
  if (/^1Z[0-9A-Z]{16}$/i.test(n)) return `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}`;
  return `https://www.google.com/search?q=${encodeURIComponent(`${n} tracking`)}`;
}

/** The pill colour of a return's status. */
export function returnTone(status: (typeof account.PORTAL_RETURN_STATUSES)[number]) {
  if (status === "cancelled") return "neg" as const;
  if (status === "credited" || status === "replaced") return "pos" as const;
  if (status === "requested") return "warn" as const;
  return "neutral" as const;
}
