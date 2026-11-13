import { Share } from "react-native";
import { PORTAL_URL } from "@/config";
import { track } from "./analytics";

/**
 * "Invite another store": a link to the wholesale application carrying this store's customer number (`ref`) and
 * campaign tags, so the ERP and Google Analytics can credit the referral when the new store applies.
 */
export function referralLink(customerNumber: string) {
  const q = new URLSearchParams({
    ref: customerNumber,
    utm_source: "app",
    utm_medium: "referral",
    utm_campaign: "store_invite",
  });
  return `${PORTAL_URL}/apply?${q.toString()}`;
}

export async function shareReferral(customerNumber: string, from: string) {
  const url = referralLink(customerNumber);
  track("apply_link_copied", { from, ref: customerNumber });
  await Share.share({
    message: `I order our fragrances wholesale from Marsa: great prices, fast restocks, and an app that reorders by scanning the shelf. Apply here: ${url}`,
  });
}
