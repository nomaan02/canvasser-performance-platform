/**
 * npm run sync
 *
 * Reads leads from a real (or mock) vtiger CRM using the settings in .env,
 * and prints each canvasser's numbers. Read-only: it cannot change the CRM.
 */
import { readFileSync } from "node:fs";
import { openCrmReader } from "./crm/client.js";
import { loadFieldMap } from "./crm/fields.js";
import type { CrmDatetimeZone } from "./crm/parse.js";
import { loadStatusMap, syncLeads } from "./crm/sync.js";
import { canvasserStats, formatStatsTable } from "./report/canvasser.js";

try {
  process.loadEnvFile();
} catch {
  // No .env file: fall back to real environment variables.
}

const zone = (process.env.CRM_TIMEZONE ?? "Europe/London") as CrmDatetimeZone;
const crm = await openCrmReader({
  baseUrl: process.env.CRM_BASE_URL ?? "",
  user: process.env.CRM_USER ?? "",
  accessKey: process.env.CRM_ACCESS_KEY ?? "",
});
try {
  const result = await syncLeads(crm, {
    fieldMap: loadFieldMap(process.env.CRM_FIELD_MAP ?? "config/crm-fields.json"),
    statusMap: loadStatusMap(JSON.parse(readFileSync(process.env.CRM_STATUS_MAP ?? "config/status-map.json", "utf8"))),
    zone,
    since: process.env.SYNC_SINCE || undefined,
  });
  console.log(`${result.rowsRead} leads read\n`);
  console.log(formatStatsTable(canvasserStats(result.leads)));
} finally {
  await crm.close();
}
