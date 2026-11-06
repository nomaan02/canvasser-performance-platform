/**
 * npm run demo
 *
 * Runs the whole CRM → dashboard pipeline against a mock CRM with fictional
 * leads. No accounts, keys or internet connection needed.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { startMockCrm, MOCK_ACCESS_KEY, MOCK_USER } from "../mock/crm-server.js";
import { openCrmReader } from "./crm/client.js";
import { loadFieldMap } from "./crm/fields.js";
import { loadStatusMap, syncLeads } from "./crm/sync.js";
import { canvasserStats, formatStatsTable } from "./report/canvasser.js";

const step = (n: number, text: string) => console.log(`\n\x1b[1m${n}. ${text}\x1b[0m`);

const { server, baseUrl } = await startMockCrm();
try {
  step(1, `Starting a mock CRM at ${baseUrl}`);
  const crm = await openCrmReader({ baseUrl, user: MOCK_USER, accessKey: MOCK_ACCESS_KEY, minIntervalMs: 0 });
  console.log("   Logged in with the challenge/response handshake ✓");

  step(2, "Reading leads (read-only, 100 per page)");
  const fieldMap = loadFieldMap();
  const statusMap = loadStatusMap(JSON.parse(readFileSync("config/status-map.json", "utf8")));
  const result = await syncLeads(crm, { fieldMap, statusMap, zone: "Europe/London" });
  await crm.close();
  console.log(`   ${result.rowsRead} leads read, ${result.rejected.length} rejected`);
  const unknown = Object.entries(result.unknownStatuses);
  if (unknown.length > 0) {
    console.log(`   ⚠ Statuses not in config/status-map.json (kept, flagged, not guessed): ${unknown.map(([s, n]) => `"${s}" ×${n}`).join(", ")}`);
  }

  step(3, "Privacy check");
  const sample = JSON.stringify(result.leads);
  const mockRows = JSON.parse(readFileSync("mock/leads.json", "utf8")) as Record<string, string>[];
  const notes = [...new Set(mockRows.map((row) => row.cf_105 ?? "").filter(Boolean))];
  const leaked = ["firstname", "lastname", "phone", "email", "07700", ...notes].filter((needle) => sample.includes(needle));
  console.log(
    leaked.length === 0
      ? `   No names, phone numbers, emails or any of the ${notes.length} free-text notes in the parsed data ✓`
      : `   ✗ Found: ${leaked.join(", ")}`,
  );

  step(4, "Canvasser dashboard numbers");
  const stats = canvasserStats(result.leads);
  console.log(formatStatsTable(stats));

  mkdirSync("output", { recursive: true });
  writeFileSync("output/canvasser-report.json", `${JSON.stringify(stats, null, 2)}\n`);
  console.log("\nSaved to output/canvasser-report.json");
} finally {
  server.close();
}
