/**
 * Pull leads from the CRM and parse them.
 *
 * vtiger caps each query at 100 rows, so we count first and then page with
 * `ORDER BY id LIMIT offset, 100`. Ordering by id (not modified time) keeps
 * pages stable if a lead is edited while we're reading.
 */
import { CRM_PAGE_SIZE, type CrmReader } from "./client.js";
import { selectList, toLogicalRow, type FieldMap } from "./fields.js";
import { CrmParseError, isoToCrmStamp, parseLead, type AppStatus, type CrmDatetimeZone, type ParsedLead } from "./parse.js";

export type SyncOptions = {
  fieldMap: FieldMap;
  statusMap: ReadonlyMap<string, AppStatus>;
  /** The time zone the CRM stores created/modified times in. */
  zone: CrmDatetimeZone;
  /** Only leads modified at or after this ISO time. Omit for a full backfill. */
  since?: string;
};

export type SyncResult = {
  leads: ParsedLead[];
  rowsRead: number;
  /** CRM status values with no entry in the status map, and how often they appeared. */
  unknownStatuses: Record<string, number>;
  /** Rows that could not be parsed (ids only; never the row contents). */
  rejected: { crmId: string; reason: string }[];
};

export async function syncLeads(crm: CrmReader, options: SyncOptions): Promise<SyncResult> {
  const { fieldMap } = options;
  const where = options.since ? ` WHERE ${fieldMap.modifiedAt} >= '${isoToCrmStamp(options.since, options.zone)}'` : "";

  const [counted] = await crm.query<{ count: string }>(`SELECT count(*) FROM Leads${where};`);
  const total = Number.parseInt(counted?.count ?? "0", 10);

  const rows: Record<string, string | null>[] = [];
  for (let offset = 0; offset < total; offset += CRM_PAGE_SIZE) {
    const page = await crm.query<Record<string, string | null>>(
      `SELECT ${selectList(fieldMap)} FROM Leads${where} ORDER BY id LIMIT ${offset}, ${CRM_PAGE_SIZE};`,
    );
    rows.push(...page);
    if (page.length < CRM_PAGE_SIZE) break;
  }

  const result: SyncResult = { leads: [], rowsRead: rows.length, unknownStatuses: {}, rejected: [] };
  for (const raw of rows) {
    const row = toLogicalRow(raw, fieldMap);
    try {
      const lead = parseLead(row, options.statusMap, options.zone);
      if (lead.statusUnknown && lead.statusRaw) {
        result.unknownStatuses[lead.statusRaw] = (result.unknownStatuses[lead.statusRaw] ?? 0) + 1;
      }
      result.leads.push(lead);
    } catch (err) {
      if (!(err instanceof CrmParseError)) throw err;
      result.rejected.push({ crmId: row.id, reason: err.message });
    }
  }
  return result;
}

export function loadStatusMap(json: Record<string, string>): Map<string, AppStatus> {
  const valid = new Set<AppStatus>(["sale", "pm", "blowout", "utc", "re_app", "confirmed", "pending"]);
  const map = new Map<string, AppStatus>();
  for (const [crmValue, status] of Object.entries(json)) {
    if (crmValue.startsWith("_")) continue;
    if (!valid.has(status as AppStatus)) throw new Error(`Status map: "${crmValue}" maps to unknown status "${status}"`);
    map.set(crmValue, status as AppStatus);
  }
  return map;
}
