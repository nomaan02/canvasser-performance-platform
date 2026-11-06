/**
 * The CRM fields this app reads, by meaning rather than by raw field name.
 *
 * Every vtiger install names its custom fields differently (cf_123, cf_456 …),
 * so the mapping lives in config/crm-fields.json, not in code.
 *
 * DATA MINIMISATION: customer first names, emails and phone numbers are not in
 * this list, so they are never requested from the CRM in the first place.
 */
import { readFileSync } from "node:fs";

export const LOGICAL_FIELDS = [
  "id",
  "leadNumber",
  "street",
  "postcode",
  "status",
  "createdAt",
  "modifiedAt",
  "appointmentDate",
  "appointmentTime",
  "saleAmount",
  "canvasser",
  "resultNote",
  "branch",
  "repResultNote",
] as const;

export type LogicalField = (typeof LOGICAL_FIELDS)[number];
export type FieldMap = Record<LogicalField, string>;

/** One CRM row, keyed by logical field name. */
export type CrmLeadRow = Partial<Record<LogicalField, string | null>> & { id: string };

export function loadFieldMap(path = "config/crm-fields.json"): FieldMap {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
  const missing = LOGICAL_FIELDS.filter((field) => typeof raw[field] !== "string" || !raw[field]);
  if (missing.length > 0) throw new Error(`${path} is missing: ${missing.join(", ")}`);
  return Object.fromEntries(LOGICAL_FIELDS.map((field) => [field, raw[field]])) as FieldMap;
}

/** The comma-separated column list for a SELECT. */
export function selectList(map: FieldMap): string {
  return LOGICAL_FIELDS.map((field) => map[field]).join(", ");
}

/** A raw CRM row (keyed by CRM field name) → a row keyed by logical field name. */
export function toLogicalRow(raw: Record<string, string | null>, map: FieldMap): CrmLeadRow {
  const row: CrmLeadRow = { id: String(raw[map.id] ?? "") };
  for (const field of LOGICAL_FIELDS) {
    if (field !== "id") row[field] = raw[map[field]] ?? null;
  }
  return row;
}
