import { z } from "zod";
import {
  type RouteContract,
  boolQuery,
  centsString,
  day,
  isoTime,
  limitQuery,
  offsetQuery,
  route,
  uuid,
} from "../../http.js";
import { invoiceDocData } from "../documents.js";
import { MAX_CENTS_INPUT } from "../sales.js";
import { portalOrderView } from "./shop.js";

/**
 * Invoices, statement, pay links, accept terms, store credit, tax exemption and payment methods on the portal
 * (docs/phases/phase-5-design.md §3.2 Pay and Public, §6 slice 7 `p5-portal-money`; decision 7: ACH and card on
 * every pay link, check stays a Net-terms option).
 *
 * - Signed in (pay: Owners and Accounts; a Buyer gets 403 `portal_forbidden`): every record is the session
 *   customer's, so another customer's invoice and a random id answer the same 404 `not_found` (also when the id
 *   is in the body: `invoices/pay`, `store-credit/apply`).
 * - Public, by code (`pay/:code`, rate limited 30/min/IP): the one link's invoices only, never another document;
 *   a wrong code is a 404. The amount is re-read at checkout (part payments fill the oldest invoice first;
 *   anything a charge brings beyond what is open becomes store credit). The card fee shows only while the
 *   surcharge is on and reviewed, never on Net terms nor in CO, CT, MA, NY.
 * - `fake-pay/:ref` is the fake processor's hosted page (staging and tests; 404 with any other processor).
 *
 * Refusals the screens show in plain words: `link_expired`, `link_paid`, `link_replaced`, `link_cancelled`
 * (the pay page can't be paid; `message` says why), `nothing_due` (a payment is on its way), `over_amount_due`
 * (details.dueCents), `invoice_not_open`, `payments_unavailable` (503), `terms_not_offered`, `terms_paused`
 * (details.overdueCents), `on_credit_hold`, `already_accepted`, `already_paid`, `order_not_ready`,
 * `stale_version`, `no_credit`, `over_allocated` (details.capCents), `certificate_expired`, `invalid_state`,
 * `unsupported_file_type` (415), `file_too_large` (413).
 */

const version = z.number().int().min(1);
const idParams = z.object({ id: uuid });
const centsInput = z.union([
  z.number().int().min(1).max(MAX_CENTS_INPUT),
  z
    .string()
    .regex(/^\d+$/)
    .refine(
      (s) => BigInt(s) >= 1n && BigInt(s) <= BigInt(MAX_CENTS_INPUT),
      "Between $0.01 and $100,000,000,000.00",
    ),
]);
const pdfBytes = z.custom<Uint8Array>((v) => v instanceof Uint8Array, "Expected PDF bytes");

export const PORTAL_INVOICE_TABS = ["open", "paid", "all"] as const;
export const PORTAL_INVOICE_STATUSES = [
  "current",
  "overdue",
  "part_paid",
  "paid",
  "credited",
  "voided",
] as const;
export const PAY_METHODS = ["ach", "card"] as const;
export const PAY_PAGE_STATUSES = ["open", "paid", "expired", "replaced", "cancelled"] as const;
export const PAY_LINK_KINDS = ["invoice", "order", "invoices"] as const;
export const PAY_LINK_STATUSES = ["pending", "paid", "failed", "expired", "cancelled"] as const;
export const CREDIT_HISTORY_KINDS = ["overpayment", "credit_note", "applied", "refunded"] as const;
export const CERTIFICATE_STATUSES = ["pending_review", "approved", "rejected"] as const;
export const SAVED_METHOD_KINDS = ["ach", "card"] as const;
export const FAKE_PAY_OUTCOMES = ["pay", "clear", "fail"] as const;

// ── Shapes ──────────────────────────────────────────────────────────────

export const aging = z.object({
  current: centsString,
  days_1_30: centsString,
  days_31_60: centsString,
  days_61_90: centsString,
  over_90: centsString,
});

const termsOut = z.object({ code: z.string(), label: z.string(), creditLimitCents: centsString });

export const portalInvoiceRow = z.object({
  id: uuid,
  number: z.string(),
  orderNumber: z.string().nullable(),
  invoiceDate: day,
  dueDate: day,
  status: z.enum(PORTAL_INVOICE_STATUSES),
  /** "Current", "Overdue 10 days", "Paid" … */
  statusLabel: z.string(),
  daysOverdue: z.number().int(),
  totalCents: centsString,
  balanceCents: centsString,
  /** Can be selected to pay together (something is left to pay, not counting a payment on its way). */
  payable: z.boolean(),
});

export const portalInvoices = z.object({
  terms: termsOut,
  aging,
  totalDueCents: centsString,
  rows: z.array(portalInvoiceRow),
  total: z.number().int(),
  counts: z.object({ open: z.number().int(), paid: z.number().int(), all: z.number().int() }),
});

export const portalStatement = z.object({
  asOf: day,
  terms: termsOut,
  aging,
  totalDueCents: centsString,
  rows: z.array(
    z.object({
      id: uuid,
      number: z.string(),
      invoiceDate: day,
      orderNumber: z.string().nullable(),
      dueDate: day,
      daysOverdue: z.number().int(),
      statusLabel: z.string(),
      balanceCents: centsString,
    }),
  ),
});

export const portalPaymentRow = z.object({
  id: uuid,
  kind: z.enum(["payment", "credit_note"]),
  date: day,
  reference: z.string().nullable(),
  /** ach, card, check, cash, wire; "credit" for a credit note. */
  method: z.string(),
  status: z.enum(["processing", "posted", "voided"]),
  /** "Received", "Processing", "Returned: R01 …", "Credit". */
  statusLabel: z.string(),
  appliedTo: z.array(z.string()),
  amountCents: centsString,
});

/**
 * PAY-9 (D1712): how a card fee is worked out on any amount paid toward these invoices, so a part payment (or the
 * amount left after store credit) shows its exact charge before the processor's page. Null: no fee applies.
 */
export const cardFeeFormula = z.object({
  percentBp: z.number().int(),
  fixedCents: z.number().int(),
  capCents: z.number().int().nullable(),
});
export type CardFeeFormula = z.infer<typeof cardFeeFormula>;

/** The card fee on `amountCents` by a formula: percent (half-up) plus the fixed part, never above the cap. */
export function cardFeeFor(amountCents: bigint | string, f: CardFeeFormula | null | undefined): bigint {
  const amount = BigInt(amountCents);
  if (!f || amount <= 0n) return 0n;
  const fee = (amount * BigInt(f.percentBp) + 5000n) / 10000n + BigInt(f.fixedCents);
  if (f.capCents === null) return fee;
  return fee < BigInt(f.capCents) ? fee : BigInt(f.capCents);
}

export const payMethodOut = z.object({
  method: z.enum(PAY_METHODS),
  label: z.string(),
  feeCents: centsString,
  totalCents: centsString,
  note: z.string(),
  /** PAY-9 (D1712): the card fee's formula for any other amount; null or left out when no fee applies. */
  fee: cardFeeFormula.nullable().optional(),
});

/** The public pay page (WPayInvoice, WReviewPay): the link's own invoices only. */
export const payPage = z.object({
  code: z.string(),
  status: z.enum(PAY_PAGE_STATUSES),
  /** Plain words when it can't be paid any more. */
  message: z.string().nullable(),
  customerName: z.string(),
  expiresAt: isoTime,
  invoices: z.array(
    z.object({
      id: uuid,
      number: z.string(),
      invoiceDate: day,
      dueDate: day,
      orderNumber: z.string().nullable(),
      totalCents: centsString,
      balanceCents: centsString,
      overdue: z.boolean(),
      /** "Overdue since 3 Oct", "Due 20 Oct". */
      dueLabel: z.string(),
    }),
  ),
  totalCents: centsString,
  processingCents: centsString,
  /** ACH and card, always (decision 7); the card fee only while the surcharge is on and reviewed. */
  methods: z.array(payMethodOut),
  allowPartial: z.boolean(),
  /** Expired, replaced or cancelled: the page offers "Send me a new link" (UX audit 2026-11 PAY-2). */
  canResend: z.boolean(),
  /** Who to call or WhatsApp: the customer's rep (when they have one), Marsa's phone, WhatsApp and email. */
  contact: z.object({
    repName: z.string().nullable(),
    phone: z.string().nullable(),
    whatsappUrl: z.string().nullable(),
    email: z.string().nullable(),
  }),
});

export const PAY_RESEND_STATUSES = [
  "sent",
  "already_sent",
  "too_many",
  "no_email",
  "nothing_due",
  "open",
] as const;

export const payResendOut = z.object({
  status: z.enum(PAY_RESEND_STATUSES),
  /** Plain words for the page. */
  message: z.string(),
  /** Where it went, masked ("j•••@shop.com"). */
  sentTo: z.string().nullable(),
});

export const codeLink = z.object({
  id: uuid,
  code: z.string().nullable(),
  url: z.string(),
  kind: z.enum(PAY_LINK_KINDS),
  status: z.enum(PAY_LINK_STATUSES),
  amountCents: centsString,
  expiresAt: isoTime,
  invoiceIds: z.array(uuid),
});

export const checkoutOut = z.object({
  attemptId: uuid,
  /** The processor's hosted page: send the customer there. */
  url: z.string(),
  method: z.enum(PAY_METHODS),
  amountCents: centsString,
  feeCents: centsString,
  chargeCents: centsString,
});

export const storeCredit = z.object({
  balanceCents: centsString,
  sources: z.array(
    z.object({
      kind: z.enum(["overpayment", "credit_note"]),
      id: uuid,
      reference: z.string().nullable(),
      date: day,
      leftCents: centsString,
    }),
  ),
  history: z.array(
    z.object({
      date: day,
      kind: z.enum(CREDIT_HISTORY_KINDS),
      reference: z.string().nullable(),
      what: z.string(),
      /** Credit in is positive, credit used or paid back negative. */
      amountCents: centsString,
    }),
  ),
});

export const certificateOut = z.object({
  id: uuid,
  state: z.string(),
  certificateNumber: z.string(),
  expiresOn: day.nullable(),
  status: z.enum(CERTIFICATE_STATUSES),
  /** "Waiting for review", "Approved", "Not accepted". */
  statusLabel: z.string(),
  expired: z.boolean(),
  reviewNote: z.string().nullable(),
  reviewedAt: isoTime.nullable(),
  file: z.object({ id: uuid, name: z.string() }).nullable(),
  createdAt: isoTime,
});

export const taxExemption = z.object({
  /** An approved, unexpired certificate is on file. */
  onFile: z.boolean(),
  certificates: z.array(certificateOut),
  addresses: z.array(
    z.object({
      id: uuid,
      kind: z.enum(["billing", "ship_to"]),
      label: z.string().nullable(),
      city: z.string(),
      state: z.string(),
      taxStatus: z.enum(["taxable", "exempt"]),
      taxRatePpm: z.number().int().nullable(),
      /** "Kennewick WA 8.8%", "Waiting for Marsa to set the rate", "Tax exempt". */
      rateLabel: z.string(),
    }),
  ),
});

export const paymentMethods = z.object({
  rows: z.array(
    z.object({
      /** The processor's id ("pm_…"). */
      id: z.string(),
      kind: z.enum(SAVED_METHOD_KINDS),
      label: z.string(),
      last4: z.string(),
      expires: z.string().nullable(),
      isDefault: z.boolean(),
      verified: z.boolean(),
      feeNote: z.string(),
    }),
  ),
  /** "Stripe": card and bank details never touch Marsa's database. */
  storedBy: z.string(),
});

/** UX S4 (PAY-5): a saved bank account or card offered first on the pay page. */
export const paySavedMethod = z.object({
  /** The processor's id ("pm_…"). */
  id: z.string(),
  kind: z.enum(SAVED_METHOD_KINDS),
  /** "Bank ••6789", "Visa ••4242". */
  label: z.string(),
  brand: z.string().nullable(),
  last4: z.string(),
  isDefault: z.boolean(),
});

/**
 * UX S4 (D970): what the signed-in pay page shows for some invoices, worked out without making a pay link: the open
 * invoices (oldest first), the total, ACH and card with the card fee, saved methods and store credit.
 */
export const payQuoteOut = z.object({
  customerName: z.string(),
  invoices: payPage.shape.invoices,
  totalCents: centsString,
  processingCents: centsString,
  methods: z.array(payMethodOut),
  allowPartial: z.boolean(),
  /** Plain words when nothing is left to pay. */
  message: z.string().nullable(),
  savedMethods: z.array(paySavedMethod),
  storeCreditCents: centsString,
});

export const payNowOut = z.object({
  /** checkout: send the person to `url`; credit: store credit paid it all, nothing goes to the processor. */
  kind: z.enum(["checkout", "credit"]),
  url: z.string().nullable(),
  attemptId: uuid.nullable(),
  code: z.string().nullable(),
  method: z.enum(PAY_METHODS),
  amountCents: centsString,
  feeCents: centsString,
  chargeCents: centsString,
  creditAppliedCents: centsString,
  /** An earlier press's open checkout was handed back (nothing new at the processor). */
  reused: z.boolean(),
  invoices: z.array(z.object({ id: uuid, number: z.string(), balanceCents: centsString })),
});

export const RECEIPT_STATUSES = ["waiting", "processing", "paid", "failed", "expired"] as const;

/** UX S4 (PAY-3): the signed-in receipt the processor sends the person back to. */
export const paymentReceipt = z.object({
  attemptId: uuid,
  status: z.enum(RECEIPT_STATUSES),
  title: z.string(),
  message: z.string(),
  method: z.enum(PAY_METHODS),
  methodLabel: z.string(),
  amountCents: centsString,
  feeCents: centsString,
  chargeCents: centsString,
  /** The payment's number once it is recorded. */
  reference: z.string().nullable(),
  paymentId: uuid.nullable(),
  startedAt: isoTime,
  paidAt: isoTime.nullable(),
  invoices: z.array(
    z.object({
      id: uuid,
      number: z.string(),
      appliedCents: centsString.nullable(),
      balanceCents: centsString,
    }),
  ),
});

// ── Invoices, statement, payments ───────────────────────────────────────

export const listInvoices = route({
  id: "portal.invoices.list",
  method: "GET",
  path: "/v1/portal/invoices",
  access: { portal: "pay" },
  query: z.object({ tab: z.enum(PORTAL_INVOICE_TABS).optional(), limit: limitQuery, offset: offsetQuery }),
  response: portalInvoices,
});

/**
 * WInvoice (Avara wave F, D1860): one invoice as the PDF prints it (DInvoice's data, built for the session's
 * customer only), for the in-portal document view. Read-only: the figures are the posted invoice's.
 */
export const portalInvoiceView = z.object({
  id: uuid,
  /** "Invoice INV-2026-0118". */
  title: z.string(),
  /** "INV-2026-0118.pdf". */
  filename: z.string(),
  /** Can be paid from here (posted with something left to pay, not counting a payment on its way). */
  payable: z.boolean(),
  doc: invoiceDocData,
});

export const getInvoice = route({
  id: "portal.invoices.get",
  method: "GET",
  path: "/v1/portal/invoices/:id",
  access: { portal: "pay" },
  params: idParams,
  response: portalInvoiceView,
});

export const invoicePdf = route({
  id: "portal.invoices.pdf",
  method: "GET",
  path: "/v1/portal/invoices/:id/pdf",
  access: { portal: "pay" },
  params: idParams,
  query: z.object({ download: boolQuery }),
  response: pdfBytes,
});

/** WInvoices "Select invoices to pay together": a pay link for exactly these (made, or the pending one). */
export const payInvoices = route({
  id: "portal.invoices.pay",
  method: "POST",
  path: "/v1/portal/invoices/pay",
  access: { portal: "pay" },
  idempotency: "required",
  body: z
    .object({
      invoiceIds: z.array(uuid).min(1).max(100),
      /** A part to pay (oldest invoice first); the pay page starts there. */
      amountCents: centsInput.optional(),
    })
    .strict(),
  response: z.object({
    code: z.string(),
    url: z.string(),
    link: codeLink,
    page: payPage,
    amountCents: centsString.nullable(),
  }),
});

/**
 * UX S4 (D970): the signed-in pay page's amounts, fees, methods, saved methods and store credit for these invoices
 * (comma-separated ids, at most 100), read without making or touching any pay link.
 */
export const payQuote = route({
  id: "portal.invoices.pay_quote",
  method: "GET",
  path: "/v1/portal/invoices/pay-quote",
  access: { portal: "pay" },
  query: z.object({
    invoices: z
      .string()
      .max(3_800)
      .regex(/^[0-9a-fA-F-]{36}(,[0-9a-fA-F-]{36}){0,99}$/, "Comma-separated invoice ids"),
  }),
  response: payQuoteOut,
});

/**
 * UX S4 (D970–D973): Pay on the signed-in pay page. Store credit first when asked (oldest invoice first), then the
 * pay link for exactly the invoices still open (made only now) and the processor's hosted checkout, which returns to
 * the portal's receipt. The same press again gets the same open checkout back (and the key replays a retry), so a
 * double tap never makes two charges. `kind: "credit"` when the credit paid it all.
 */
export const payNow = route({
  id: "portal.invoices.pay_now",
  method: "POST",
  path: "/v1/portal/invoices/pay-now",
  access: { portal: "pay" },
  idempotency: "required",
  body: z
    .object({
      invoiceIds: z.array(uuid).min(1).max(100),
      method: z.enum(PAY_METHODS),
      /** A part (oldest invoice first), after any store credit. */
      amountCents: centsInput.optional(),
      /** One of the customer's saved methods, of `method`'s kind (PAY-5). */
      savedMethodId: z.string().min(1).max(200).optional(),
      useStoreCredit: z.boolean().optional(),
    })
    .strict(),
  response: payNowOut,
});

/** UX S4 (PAY-3, D974): where a checkout of the session customer stands, for the "Payment received" page. */
export const getPaymentReceipt = route({
  id: "portal.payments.receipt",
  method: "GET",
  path: "/v1/portal/payments/attempts/:id",
  access: { portal: "pay" },
  params: idParams,
  response: paymentReceipt,
});

export const getStatement = route({
  id: "portal.statement.get",
  method: "GET",
  path: "/v1/portal/statement",
  access: { portal: "pay" },
  response: portalStatement,
});

export const statementPdf = route({
  id: "portal.statement.pdf",
  method: "GET",
  path: "/v1/portal/statement/pdf",
  access: { portal: "pay" },
  query: z.object({ download: boolQuery }),
  response: pdfBytes,
});

export const listPayments = route({
  id: "portal.payments.list",
  method: "GET",
  path: "/v1/portal/payments",
  access: { portal: "pay" },
  query: z.object({ limit: limitQuery, offset: offsetQuery }),
  response: z.object({ rows: z.array(portalPaymentRow) }),
});

// ── Review and pay (WReviewPay) ─────────────────────────────────────────

/** Accept the order's Net terms instead of paying now (decision 47): it is then released to the warehouse. */
export const acceptTerms = route({
  id: "portal.orders.accept_terms",
  method: "POST",
  path: "/v1/portal/orders/:id/accept-terms",
  access: { portal: "pay" },
  idempotency: "optional",
  params: idParams,
  body: z.object({ version }).strict(),
  response: portalOrderView,
});

// ── Store credit ────────────────────────────────────────────────────────

export const getStoreCredit = route({
  id: "portal.store_credit.get",
  method: "GET",
  path: "/v1/portal/store-credit",
  access: { portal: "pay" },
  response: storeCredit,
});

/** Use store credit on an open invoice (Dr 2610 / Cr 1100 through the payment and credit-note services). */
export const applyStoreCredit = route({
  id: "portal.store_credit.apply",
  method: "POST",
  path: "/v1/portal/store-credit/apply",
  access: { portal: "pay" },
  idempotency: "required",
  body: z.object({ invoiceId: uuid, amountCents: centsInput.optional() }).strict(),
  response: z.object({
    appliedCents: centsString,
    creditLeftCents: centsString,
    invoice: z.object({ id: uuid, number: z.string().nullable(), balanceCents: centsString }),
  }),
});

// ── Tax exemption ───────────────────────────────────────────────────────

export const getTaxExemption = route({
  id: "portal.tax_exemption.get",
  method: "GET",
  path: "/v1/portal/tax-exemption",
  access: { portal: "pay" },
  response: taxExemption,
});

/** The certificate's PDF or photo as the body, with its own Content-Type; reviewed by Marsa. */
export const uploadCertificate = route({
  id: "portal.tax_exemption.certificate",
  method: "POST",
  path: "/v1/portal/tax-exemption/certificates",
  access: { portal: "pay" },
  idempotency: "optional",
  rawBody: true,
  status: 201,
  query: z.object({
    state: z.string().trim().length(2),
    certificateNumber: z.string().trim().min(1).max(64),
    expiresOn: day.optional(),
    name: z.string().trim().min(1).max(200),
  }),
  response: certificateOut,
});

// ── Payment methods (at the processor) ──────────────────────────────────

const methodParams = z.object({ id: z.string().min(1).max(200) });

export const listPaymentMethods = route({
  id: "portal.payment_methods.list",
  method: "GET",
  path: "/v1/portal/payment-methods",
  access: { portal: "pay" },
  response: paymentMethods,
});

export const setupPaymentMethod = route({
  id: "portal.payment_methods.setup",
  method: "POST",
  path: "/v1/portal/payment-methods/setup",
  access: { portal: "pay" },
  idempotency: "optional",
  body: z.object({ kind: z.enum(SAVED_METHOD_KINDS) }).strict(),
  response: z.object({ url: z.string() }),
});

export const removePaymentMethod = route({
  id: "portal.payment_methods.remove",
  method: "DELETE",
  path: "/v1/portal/payment-methods/:id",
  access: { portal: "pay" },
  idempotency: "optional",
  params: methodParams,
  response: paymentMethods,
});

export const defaultPaymentMethod = route({
  id: "portal.payment_methods.default",
  method: "POST",
  path: "/v1/portal/payment-methods/:id/default",
  access: { portal: "pay" },
  idempotency: "optional",
  params: methodParams,
  body: z.object({}).strict(),
  response: paymentMethods,
});

// ── Public: the pay page by code ────────────────────────────────────────

const codeParams = z.object({ code: z.string().min(1).max(32) });

export const getPayPage = route({
  id: "portal.pay.get",
  method: "GET",
  path: "/v1/portal/pay/:code",
  access: { public: true },
  params: codeParams,
  response: payPage,
});

/**
 * "Send me a new link" on an expired, replaced or cancelled link: a fresh link for what is still open on its
 * invoices, emailed only to the customer's email on file (the body takes no address). Rate limited per IP, one
 * per link every 15 minutes, five a day per customer; audited.
 */
export const resendPayLink = route({
  id: "portal.pay.resend",
  method: "POST",
  path: "/v1/portal/pay/:code/resend",
  access: { public: true },
  idempotency: "optional",
  params: codeParams,
  body: z.object({}).strict().default({}),
  response: payResendOut,
});

/** A hosted checkout at the processor for what is open now, or the part asked for (oldest invoice first). */
export const checkout = route({
  id: "portal.pay.checkout",
  method: "POST",
  path: "/v1/portal/pay/:code/checkout",
  access: { public: true },
  idempotency: "optional",
  params: codeParams,
  body: z.object({ method: z.enum(PAY_METHODS), amountCents: centsInput.optional() }).strict(),
  response: checkoutOut,
});

// ── Public: the fake processor's hosted page (staging and tests) ────────

const refParams = z.object({ ref: z.string().min(1).max(100) });

export const fakePayPage = route({
  id: "portal.fake_pay.get",
  method: "GET",
  path: "/v1/portal/fake-pay/:ref",
  access: { public: true },
  params: refParams,
  response: z.object({
    ref: z.string(),
    kind: z.enum(["checkout", "setup"]),
    method: z.enum(PAY_METHODS),
    reference: z.string(),
    amountCents: centsString,
    feeCents: centsString,
    chargeCents: centsString,
    status: z.string(),
  }),
});

/** Pay / Fail (and, for an ACH, Clear): stores the processor's event, processed by the inbox like any other. */
export const fakePayComplete = route({
  id: "portal.fake_pay.complete",
  method: "POST",
  path: "/v1/portal/fake-pay/:ref",
  access: { public: true },
  idempotency: "optional",
  params: refParams,
  body: z
    .object({ outcome: z.enum(FAKE_PAY_OUTCOMES), failureMessage: z.string().max(200).nullable().optional() })
    .strict(),
  response: z.object({ eventIds: z.array(uuid), methodId: z.string().nullable() }),
});

export const ROUTES = {
  listInvoices,
  getInvoice,
  invoicePdf,
  payInvoices,
  payQuote,
  payNow,
  getPaymentReceipt,
  getStatement,
  statementPdf,
  listPayments,
  acceptTerms,
  getStoreCredit,
  applyStoreCredit,
  getTaxExemption,
  uploadCertificate,
  listPaymentMethods,
  setupPaymentMethod,
  removePaymentMethod,
  defaultPaymentMethod,
  getPayPage,
  checkout,
  resendPayLink,
  fakePayPage,
  fakePayComplete,
} satisfies Record<string, RouteContract>;
