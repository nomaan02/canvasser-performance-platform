import assert from "node:assert/strict";
import { test } from "node:test";
import {
  callbackReason,
  crmStampToIso,
  decodeCrmText,
  firstNameOnly,
  leadSaleAmount,
  normalisePostcode,
  parseStreetLine,
  priceInText,
} from "../src/crm/parse.js";

test("postcodes are normalised or rejected", () => {
  assert.equal(normalisePostcode(" zz18ab "), "ZZ1 8AB");
  assert.equal(normalisePostcode("ZZ12 3CD"), "ZZ12 3CD");
  assert.equal(normalisePostcode("not a postcode"), null);
});

test("street lines split into number, letter and street", () => {
  assert.deepEqual(parseStreetLine("23A Example Road"), { number: 23, suffix: "A", street: "Example Road" });
  assert.deepEqual(parseStreetLine("21-23 Example Road"), { number: 21, suffix: "", street: "Example Road" });
  assert.deepEqual(parseStreetLine("Flat 2, 23 Example Road, Townsville"), { number: 23, suffix: "", street: "Example Road" });
  assert.deepEqual(parseStreetLine(""), { number: null, suffix: "", street: null });
});

test("HTML entities from vtiger are decoded", () => {
  assert.equal(decodeCrmText("Pitch&amp;Miss"), "Pitch&Miss");
  assert.equal(decodeCrmText("St Mary&#039;s Road"), "St Mary's Road");
});

test("canvassers are kept by first name only", () => {
  assert.equal(firstNameOnly("ALEX turner"), "Alex");
  assert.equal(firstNameOnly("  "), null);
});

test("prices are found in free text, but times and phone numbers are not", () => {
  assert.equal(priceInText("Signed £4,250 3 windows"), 4250);
  assert.equal(priceInText("sold 6250 full house"), 6250);
  assert.equal(priceInText("back at 11:45, call 07700 900123"), null);
  assert.equal(priceInText(""), null);
});

test("the Sale Amount field wins; notes are only read for sold leads", () => {
  assert.deepEqual(leadSaleAmount("sale", "5000.00", "£4,000", null), { amount: 5000, source: "sale_amount" });
  assert.deepEqual(leadSaleAmount("sale", "", "Signed £4,250", null), { amount: 4250, source: "result" });
  assert.deepEqual(leadSaleAmount("pm", "", "quoted £4,250", null), { amount: null, source: null });
});

test("call-back reasons", () => {
  assert.equal(callbackReason("blowout", false, "Partner at work, ring back", null), "single_sit");
  assert.equal(callbackReason("blowout", false, "cancelled on the day", null), null);
  assert.equal(callbackReason("utc", false, "", null), "utc");
  assert.equal(callbackReason(null, false, "", null), "no_outcome");
  assert.equal(callbackReason("sale", false, "Signed", null), null);
});

test("UK local times convert to UTC across the clock change", () => {
  assert.equal(crmStampToIso("2026-07-01 10:00:00", "Europe/London"), "2026-07-01T09:00:00.000Z"); // BST
  assert.equal(crmStampToIso("2026-12-01 10:00:00", "Europe/London"), "2026-12-01T10:00:00.000Z"); // GMT
  assert.equal(crmStampToIso("2026-02-30 10:00", "UTC"), null);
});
