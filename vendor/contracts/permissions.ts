/**
 * Every permission the system checks. The API guard, the services and the Control screens all read this one
 * list, so a button is shown exactly when the server would accept the action.
 */
export const PERMISSIONS = [
  "documents.sales.edit",
  "documents.price.approve_below_minimum",
  "credit.release_hold",
  "credit.change_limit",
  "stock.move",
  "stock.approve_over_receipt",
  "stock.approve_revaluation",
  "invoices.post",
  "credit_notes.post",
  "payments.record",
  "payments.void",
  "bills.post",
  "bills.pay",
  "vendor_bank.change",
  "cost.view",
  "journal.post_manual",
  "journal.reverse",
  "periods.close",
  "periods.reopen",
  "opening_balances.approve",
  "settings.manage",
  "audit.view",
  // Phase 1 remainder (docs/phases/phase-1-design.md §1)
  "users.manage",
  "settings.payments",
  "settings.accounting",
  "payments.enable_surcharge",
  "products.edit",
  "prices.edit",
  "prices.propose",
  "customers.edit",
  "customers.tax",
  "vendors.edit",
  "vendors.commercial",
  "warehouses.manage",
  "review_queue.resolve",
  "margin.view",
  "tieouts.run",
  "system.view",
  "system.manage",
  // Phase 2 (docs/phases/phase-2-design.md §1)
  "purchasing.edit",
  "purchasing.approve",
  "stock.reverse_receipt",
  "stock.approve_count",
  "stock.write_off",
  "bills.edit",
  "bills.approve_variance",
  "bills.change_due_date",
  "vendor_credits.post",
  // Phase 6 (docs/phases/phase-6-design.md §9): bank accounts, matching, reconciliation, batch deposits, payouts.
  "banking.reconcile",
  // Phase 6 slice 16b (Ez's decisions #40 and #24): send a customer statement; pause or resume an invoice's
  // reminders. Narrower than documents.sales.edit, so Finance sends statements without editing orders.
  "statements.send",
  // Phase 7 (CRM and the customer master): log contacts, follow-ups and owners; answer support tickets; merge
  // two customers (Admin only: plan "Merge needs Admin").
  "crm.edit",
  "support.edit",
  "customers.merge",
  // Phase 7: commission rules and recalculation; marking commissions paid (posts Dr 2050 / Cr bank); saved
  // reports and scheduled packs.
  "commissions.manage",
  "commissions.pay",
  "reports.manage",
  // Phase 7 (plan "Creators"): approve or decline creators, campaigns, sample shipments, content review.
  "creators.manage",
  // Phase 7 (plan "Home, analytics and reports"): set the monthly sales goals by company, store, role or person.
  "goals.manage",
  // Expenses (plan "Expenses"): record a bill-less expense and its receipt (Finance); approve one over $1,000
  // (a Manager, decision 44).
  "expenses.record",
  "expenses.approve",
  // Launch roles review (plan "More permissions: export customer data"): download the customer and CRM
  // account lists as CSV. Reading a customer on screen stays open to staff; taking the whole book away doesn't.
  "customers.export",
  // admin-w6 (D665): the Employees module. Manage people's records, user links and clock in/out (Manager);
  // see and change pay facts, emergency contacts and HR files (Finance, for payroll).
  "employees.manage",
  "hr.view",
  // Marsa Time T1 (docs/phases/time-clock-design.md §3.10, D720): clock yourself in and out (every staff role);
  // decide time exceptions for your team (Manager); work sites and anyone's time (Admin, Owner).
  "time.self",
  "time.approve",
  "time.manage",
  // E3 scheduling (roles-employees-time-plan Part B, D1091): build, publish and reschedule the schedule board and
  // decide schedule requests — for your team (Manager), anyone's (Admin, Owner).
  "employees.schedule",
  // Salesgent A2 (D1206): ask for a bad-debt write-off and record money recovered on one (Finance); approve one
  // someone else asked for (the approvals inbox, four eyes).
  "receivables.write_off",
  // E1 roles and access (roles-employees-time-plan Part A, D1350): create, clone, edit and deactivate roles and
  // their business rules and field visibility (Admin, Owner); manage sign-in access for the people in your own
  // team — invite, lock, reset, role and overrides, never beyond your own permissions (Manager).
  "roles.manage",
  "team.access",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ["owner", "admin", "manager", "finance", "sales", "warehouse", "viewer"] as const;
export type Role = (typeof ROLES)[number];

const P = (...p: Permission[]) => p;

/** Permissions only an Owner holds; Admin has everything else. */
export const OWNER_ONLY: readonly Permission[] = [
  "opening_balances.approve",
  "periods.reopen",
  "payments.enable_surcharge",
];

/**
 * The plan's permission table plus the phase 1 additions (phase-1-design.md §1). Owner has everything,
 * Admin everything but the Owner-only entries; Viewer can do nothing that writes.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS.filter((p) => !OWNER_ONLY.includes(p)),
  manager: P(
    "documents.sales.edit",
    "statements.send",
    "documents.price.approve_below_minimum",
    "credit.release_hold",
    "stock.move",
    "stock.approve_over_receipt",
    "stock.approve_revaluation",
    "invoices.post",
    "credit_notes.post",
    "payments.record",
    "bills.post",
    "cost.view",
    "products.edit",
    "prices.edit",
    "prices.propose",
    "customers.edit",
    "customers.tax",
    "vendors.edit",
    "margin.view",
    "system.view",
    "purchasing.edit",
    "purchasing.approve",
    "stock.reverse_receipt",
    "stock.approve_count",
    "stock.write_off",
    "bills.edit",
    "bills.approve_variance",
    "vendor_credits.post",
    // Phase 7
    "crm.edit",
    "support.edit",
    "commissions.manage",
    "reports.manage",
    "creators.manage",
    "goals.manage",
    // Decision 44: an expense over $1,000 waits for a Manager.
    "expenses.approve",
    // Launch roles review: the customer and CRM account exports.
    "customers.export",
    // admin-w6: Managers keep the Employees list (not pay: that is hr.view).
    "employees.manage",
    // Marsa Time (D720): Managers clock themselves and decide their team's time exceptions.
    "time.self",
    "time.approve",
    // E3 (D1091): Managers build and publish their team's schedule and decide its requests.
    "employees.schedule",
    // E1 (D1350): Managers manage their own team's sign-in access, never beyond their own permissions.
    "team.access",
  ),
  finance: P(
    "credit.release_hold",
    "credit.change_limit",
    "invoices.post",
    "credit_notes.post",
    "payments.record",
    "payments.void",
    "bills.post",
    "bills.pay",
    "vendor_bank.change",
    "cost.view",
    "journal.post_manual",
    "journal.reverse",
    "periods.close",
    "audit.view",
    "settings.payments",
    "settings.accounting",
    "customers.edit",
    "customers.tax",
    "vendors.edit",
    "vendors.commercial",
    "review_queue.resolve",
    "margin.view",
    "tieouts.run",
    "system.view",
    "purchasing.edit",
    "stock.approve_count",
    "bills.edit",
    "bills.approve_variance",
    "bills.change_due_date",
    "vendor_credits.post",
    "banking.reconcile",
    // Ez, 19 Oct 2026 (#40): Finance can send statements.
    "statements.send",
    // Phase 7
    "support.edit",
    "commissions.manage",
    "commissions.pay",
    "reports.manage",
    // Expenses: Finance records them.
    "expenses.record",
    // admin-w6: Finance reads pay facts for payroll.
    "hr.view",
    "time.self",
    // A2 (D1206): Finance asks for and approves bad-debt write-offs (never their own).
    "receivables.write_off",
  ),
  sales: P(
    "documents.sales.edit",
    "statements.send",
    "invoices.post",
    "payments.record",
    "cost.view",
    "prices.propose",
    "customers.edit",
    // Ez, 14 Oct 2026: Sales sees and sets customers' tax IDs and certificates; Warehouse and Viewer don't.
    "customers.tax",
    "margin.view",
    // Phase 7
    "crm.edit",
    "support.edit",
    "time.self",
  ),
  warehouse: P("stock.move", "cost.view", "time.self"),
  viewer: P(),
};

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/**
 * Every permission that can edit a lockable record; the lock routes declare this union and the service
 * checks the record type's own permission. A lockable type must use permissions from this list.
 */
export const LOCK_PERMISSIONS = [
  "products.edit",
  "prices.edit",
  "customers.edit",
  "vendors.edit",
  "documents.sales.edit",
  // Phase 2: purchase orders, bills, transfers and vendor credits open locked.
  "purchasing.edit",
  "bills.edit",
  "stock.move",
  "vendor_credits.post",
] as const satisfies readonly Permission[];

/**
 * Every permission an approval request can require; the approve and reject routes declare this union and the
 * service checks the request's own permission. requestApproval refuses any other.
 */
export const APPROVAL_PERMISSIONS = [
  "prices.edit",
  "documents.price.approve_below_minimum",
  "vendor_bank.change",
  "credit.release_hold",
  "stock.approve_over_receipt",
  "stock.approve_revaluation",
  "opening_balances.approve",
  // Phase 2: PO approval, bill variances, write-offs and count reviews.
  "purchasing.approve",
  "bills.approve_variance",
  "stock.write_off",
  "stock.approve_count",
  // Expenses: one over $1,000 (decision 44).
  "expenses.approve",
  // A2 (D1206): a bad-debt write-off.
  "receivables.write_off",
] as const satisfies readonly Permission[];
