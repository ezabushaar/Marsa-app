/** Cents (a number or a string of cents) as dollars: 137054 → "$1,370.54". */
export function money(cents: number | string | bigint | null | undefined): string {
  if (cents === null || cents === undefined || cents === "") return "";
  const big =
    typeof cents === "bigint" ? cents : BigInt(typeof cents === "number" ? Math.round(cents) : cents);
  const negative = big < 0n;
  const abs = negative ? -big : big;
  const dollars = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const rest = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "−" : ""}$${dollars}.${rest}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 14, 2026" for a YYYY-MM-DD day (no time zone shift: a day is a day). */
export function day(d: string | null | undefined, withYear = true): string {
  if (!d) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return d;
  const label = `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
  return withYear ? `${label}, ${m[1]}` : label;
}

/** Today as YYYY-MM-DD in the device's zone. */
export function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "35%" from basis points. */
export function percentBp(bp: number | null | undefined): string {
  return bp == null ? "" : `${Math.round(bp / 100)}%`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}
