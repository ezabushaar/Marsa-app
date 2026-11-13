import Constants from "expo-constants";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import * as Tracking from "expo-tracking-transparency";
import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { type PortalEventName, trackEvents } from "@contracts/routes/portal/shop";
import { call } from "@/api/client";

/**
 * The app's one analytics pipe. Every event goes first-party to Marsa ERP (`POST /v1/portal/events`, the same
 * funnel the web portal records), batched and sent in the background. The ERP is the only place that may forward
 * events to Google Analytics, Meta, TikTok or Snap (server-side, with its own keys), and only for people whose
 * `ad` consent is `granted` (MARKETING.md). The app itself loads no ad SDK and never reads the advertising ID.
 *
 * Every event carries: where the person came from (utm_* and the ad click ids from the link that opened the app,
 * kept 30 days), the platform, the app version, and the ad-measurement consent.
 */

export type AdConsent = "granted" | "denied" | "unknown";

/** Ad attribution is on for this build (EXPO_PUBLIC_AD_ATTRIBUTION=on, see app.config.ts). */
export const AD_ATTRIBUTION = process.env.EXPO_PUBLIC_AD_ATTRIBUTION === "on";

const ATTRIBUTION_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "ref",
  "fbclid",
  "ttclid",
  "gclid",
  "ScCid",
] as const;
const ATTRIBUTION_DAYS = 30;
const STORE_ATTRIBUTION = "marsa.attribution";
const STORE_CONSENT = "marsa.adConsent";
const STORE_ORDERS = "marsa.ordersPlaced";

type Props = Record<string, string | number | boolean | null>;
type Queued = { name: PortalEventName; at: string; route?: string; props?: Props };

const sessionId = `app${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
let queue: Queued[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let attribution: Props = {};
let consent: AdConsent = "unknown";
let started = false;

const appVersion = Constants.expoConfig?.version ?? "";

async function readStore(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}
async function writeStore(key: string, value: string) {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {}
}

/** Keeps the campaign fields of a link that opened the app (a newer campaign replaces an older one). */
async function captureLink(url: string | null) {
  if (!url) return;
  try {
    const { queryParams } = Linking.parse(url);
    const found: Props = {};
    for (const k of ATTRIBUTION_KEYS) {
      const v = queryParams?.[k];
      if (typeof v === "string" && v) found[k] = v.slice(0, 200);
    }
    if (Object.keys(found).length === 0) return;
    attribution = found;
    await writeStore(STORE_ATTRIBUTION, JSON.stringify({ at: Date.now(), values: found }));
  } catch {}
}

/** Loads the kept campaign and consent, and listens for links. Called once at app start. */
export async function startAnalytics() {
  if (started) return;
  started = true;
  const saved = await readStore(STORE_ATTRIBUTION);
  if (saved) {
    try {
      const { at, values } = JSON.parse(saved) as { at: number; values: Props };
      if (Date.now() - at < ATTRIBUTION_DAYS * 86_400_000) attribution = values;
    } catch {}
  }
  const c = await readStore(STORE_CONSENT);
  if (c === "granted" || c === "denied") consent = c;
  if (AD_ATTRIBUTION && Platform.OS === "ios") {
    // The system answer wins: turning tracking off in iOS Settings turns it off here too.
    try {
      const p = await Tracking.getTrackingPermissionsAsync();
      if (p.status === "denied") consent = "denied";
      if (p.status === "granted" && c !== "denied") consent = "granted";
    } catch {}
  }
  await captureLink(await Linking.getInitialURL());
  Linking.addEventListener("url", ({ url }) => void captureLink(url));
  AppState.addEventListener("change", (s) => {
    if (s !== "active") void flush();
  });
}

/** The person's ad-measurement choice (Account › Privacy choices, and the iOS prompt). */
export function getAdConsent(): AdConsent {
  if (!AD_ATTRIBUTION) return "denied";
  return consent;
}

export async function setAdConsent(next: "granted" | "denied") {
  consent = next;
  await writeStore(STORE_CONSENT, next);
}

/**
 * Asks once, at a calm moment (after the first order is sent): iOS shows Apple's tracking prompt; Android has
 * no prompt, so measurement stays on until the person turns it off in Account › Privacy choices.
 */
export async function askAdConsentOnce() {
  if (!AD_ATTRIBUTION || consent !== "unknown") return;
  if (Platform.OS !== "ios") {
    await setAdConsent("granted");
    return;
  }
  try {
    const p = await Tracking.requestTrackingPermissionsAsync();
    await setAdConsent(p.granted ? "granted" : "denied");
  } catch {}
}

function clean(props?: Props): Props {
  const out: Props = {};
  for (const [k, v] of Object.entries(props ?? {})) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(k) || v === undefined) continue;
    out[k] = typeof v === "string" ? v.slice(0, 200) : v;
    if (Object.keys(out).length >= 9) break;
  }
  return out;
}

/** Records one event. Never throws, never blocks the screen. */
export function track(name: PortalEventName, props?: Props, route?: string) {
  const base: Props = {
    src: "app",
    os: Platform.OS,
    v: appVersion,
    ad: getAdConsent(),
    ...attribution,
  };
  // The ERP keeps at most 20 facts per event: the event's own first, then where the person came from.
  const merged = Object.fromEntries(Object.entries({ ...clean(props), ...base }).slice(0, 20)) as Props;
  queue.push({ name, at: new Date().toISOString(), ...(route ? { route } : {}), props: merged });
  if (queue.length >= 20) void flush();
  else if (!timer) timer = setTimeout(() => void flush(), 4000);
}

/** Sends what is queued (in batches of 50); a failed batch is dropped, never retried forever. */
export async function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  while (queue.length) {
    const batch = queue.slice(0, 50);
    queue = queue.slice(50);
    try {
      await call(trackEvents, { body: { sessionId, device: "phone", events: batch } });
    } catch {
      return;
    }
  }
}

/** Records a screen view once per mount (and again when `key` changes, e.g. another product). */
export function useTrackView(name: PortalEventName, props?: Props, key?: string | null) {
  const last = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    // `key: null` means "not ready yet" (the record is still loading): wait for it.
    if (key === null) return;
    const k = key ?? "";
    if (last.current === k) return;
    last.current = k;
    track(name, props);
  }, [name, key]);
}

/** Counts this phone's sent orders (for the review prompt and the consent ask). */
export async function countOrderPlaced(): Promise<number> {
  const n = Number((await readStore(STORE_ORDERS)) ?? "0") + 1;
  await writeStore(STORE_ORDERS, String(n));
  return n;
}
