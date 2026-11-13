import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * app.json holds the app's configuration; this file changes the one thing that depends on the build: whether ad
 * attribution is on (EXPO_PUBLIC_AD_ATTRIBUTION=on). When it is, the app asks for App Tracking Transparency
 * permission and the ERP may send purchase events to ad platforms, so Apple's privacy manifest must say the app
 * tracks (email and purchase history, used for Marsa's own advertising). Keep the App Store privacy answers and
 * Google Play Data safety form in step with this flag (STORE_SUBMISSION.md, MARKETING.md).
 */
export const AD_ATTRIBUTION = process.env.EXPO_PUBLIC_AD_ATTRIBUTION === "on";

const TRACKED = new Set(["NSPrivacyCollectedDataTypeEmailAddress", "NSPrivacyCollectedDataTypePurchaseHistory"]);

export default ({ config }: ConfigContext): ExpoConfig => {
  const base = config as ExpoConfig;
  if (!AD_ATTRIBUTION) return base;
  const manifest = base.ios?.privacyManifests ?? {};
  return {
    ...base,
    ios: {
      ...base.ios,
      privacyManifests: {
        ...manifest,
        NSPrivacyTracking: true,
        NSPrivacyCollectedDataTypes: (manifest.NSPrivacyCollectedDataTypes ?? []).map((d) =>
          TRACKED.has(d.NSPrivacyCollectedDataType)
            ? {
                ...d,
                NSPrivacyCollectedDataTypeTracking: true,
                NSPrivacyCollectedDataTypePurposes: [
                  ...d.NSPrivacyCollectedDataTypePurposes,
                  "NSPrivacyCollectedDataTypePurposeDeveloperAdvertising",
                ],
              }
            : d,
        ),
      },
    },
  };
};
