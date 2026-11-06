import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { startMockCrm, MOCK_ACCESS_KEY, MOCK_USER } from "../mock/crm-server.js";
import { CrmError, openCrmReader } from "../src/crm/client.js";
import { loadFieldMap } from "../src/crm/fields.js";
import { loadStatusMap, syncLeads } from "../src/crm/sync.js";

let mock: Awaited<ReturnType<typeof startMockCrm>>;
before(async () => {
  mock = await startMockCrm();
});
after(() => mock.server.close());

const options = () => ({
  fieldMap: loadFieldMap(),
  statusMap: loadStatusMap(JSON.parse(readFileSync("config/status-map.json", "utf8"))),
  zone: "Europe/London" as const,
});

test("a wrong access key is refused", async () => {
  await assert.rejects(openCrmReader({ baseUrl: mock.baseUrl, user: MOCK_USER, accessKey: "wrong", minIntervalMs: 0 }), CrmError);
});

test("pages through every lead (140 leads = 2 pages of 100)", async () => {
  const crm = await openCrmReader({ baseUrl: mock.baseUrl, user: MOCK_USER, accessKey: MOCK_ACCESS_KEY, minIntervalMs: 0 });
  const result = await syncLeads(crm, options());
  await crm.close();
  assert.equal(result.rowsRead, 140);
  assert.equal(new Set(result.leads.map((l) => l.crmId)).size, 140);
});

test("'modified since' filters on the server", async () => {
  const crm = await openCrmReader({ baseUrl: mock.baseUrl, user: MOCK_USER, accessKey: MOCK_ACCESS_KEY, minIntervalMs: 0 });
  const all = await syncLeads(crm, options());
  const recent = await syncLeads(crm, { ...options(), since: "2026-11-01T00:00:00Z" });
  await crm.close();
  assert.ok(recent.rowsRead > 0 && recent.rowsRead < all.rowsRead);
  assert.ok(recent.leads.every((l) => l.modifiedAt >= "2026-11-01"));
});

test("unknown statuses are flagged, not guessed", async () => {
  const crm = await openCrmReader({ baseUrl: mock.baseUrl, user: MOCK_USER, accessKey: MOCK_ACCESS_KEY, minIntervalMs: 0 });
  const result = await syncLeads(crm, options());
  await crm.close();
  assert.ok((result.unknownStatuses.Survey ?? 0) > 0);
  assert.ok(result.leads.filter((l) => l.statusRaw === "Survey").every((l) => l.status === null && l.statusUnknown));
});
