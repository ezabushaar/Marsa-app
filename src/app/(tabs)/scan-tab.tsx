import { Redirect } from "expo-router";

/** The Scan tab's slot: its button opens the scanner, so this screen only shows if reached by a link. */
export default function ScanTab() {
  return <Redirect href="/scan" />;
}
