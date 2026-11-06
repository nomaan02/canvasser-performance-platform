import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { assertReadOnlyCall, CRM_READ_OPERATIONS, CrmError } from "../src/crm/client.js";

test("only read operations are allowed", () => {
  for (const op of ["create", "update", "revise", "delete", "sync"]) {
    assert.throws(() => assertReadOnlyCall(op), CrmError, op);
  }
  for (const op of CRM_READ_OPERATIONS) {
    if (op !== "query") assert.doesNotThrow(() => assertReadOnlyCall(op));
  }
});

test("queries must be a single SELECT from Leads", () => {
  assert.doesNotThrow(() => assertReadOnlyCall("query", "SELECT id FROM Leads;"));
  assert.throws(() => assertReadOnlyCall("query", "SELECT id FROM Contacts;"));
  assert.throws(() => assertReadOnlyCall("query", "SELECT id FROM Leads; SELECT id FROM Leads;"));
  assert.throws(() => assertReadOnlyCall("query", "SELECT id FROM Leads"), /only one SELECT/);
});

test("the client source never names a write operation", () => {
  const source = readFileSync("src/crm/client.ts", "utf8");
  for (const op of ["create", "update", "revise", "delete"]) {
    assert.ok(!new RegExp(`operation:\\s*"${op}"`).test(source), `client.ts sends "${op}"`);
  }
});
