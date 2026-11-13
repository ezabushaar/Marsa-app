import type { PortalRole } from "../../vendor/contracts/portal";

/** The three portal roles in plain words (the ERP's own role table, PORTAL_ROLE_CAPS). */
export const ROLE_LABELS: Record<PortalRole, { label: string; about: string }> = {
  owner: { label: "Owner", about: "Orders, invoices and payments, team and addresses" },
  buyer: { label: "Buyer", about: "Orders only; no invoices or balances" },
  accounts: { label: "Accounts", about: "Invoices and payments; orders read-only" },
};
