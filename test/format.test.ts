import assert from "node:assert/strict";
import { test } from "node:test";
import { day, money, percentBp, plural } from "../src/lib/format.ts";
import { trackingUrl } from "../src/lib/orders.ts";

test("money formats cents strings and numbers", () => {
  assert.equal(money("137054"), "$1,370.54");
  assert.equal(money(5), "$0.05");
  assert.equal(money("-2500"), "−$25.00");
  assert.equal(money(null), "");
});

test("day keeps the calendar day", () => {
  assert.equal(day("2026-11-03"), "Nov 3, 2026");
  assert.equal(day("2026-01-31", false), "Jan 31");
});

test("percent and plural", () => {
  assert.equal(percentBp(3550), "36%");
  assert.equal(plural(1, "unit"), "1 unit");
  assert.equal(plural(1200, "unit"), "1,200 units");
});

test("UPS numbers track on ups.com", () => {
  assert.match(trackingUrl("1Z999AA10123456784"), /^https:\/\/www\.ups\.com\/track/);
  assert.match(trackingUrl("9400100000000000000000"), /google\.com/);
});
