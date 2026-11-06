/**
 * Per-canvasser performance, the numbers behind each canvasser's personal dashboard.
 *
 * Funnel for a door-to-door lead:
 *   lead booked → appointment sat (pitched) → sold
 * "Blowout" = the appointment didn't happen; "UTC" = unable to contact.
 */
import type { CallbackReason, ParsedLead } from "../crm/parse.js";

export type CanvasserStats = {
  canvasser: string;
  leads: number;
  /** Outcome known: sold, pitched-and-missed, blowout or unable to contact. */
  resolved: number;
  pitched: number;
  sold: number;
  blowouts: number;
  /** Pitched ÷ resolved: how many booked leads turned into a real appointment. */
  leadToPitchRate: number | null;
  /** Sold ÷ pitched. */
  closeRate: number | null;
  salesValue: number;
  /** Leads worth ringing back, by reason. */
  callbacks: Partial<Record<CallbackReason, number>>;
};

const ratio = (top: number, bottom: number) => (bottom === 0 ? null : Math.round((top / bottom) * 1000) / 1000);

export function canvasserStats(leads: readonly ParsedLead[]): CanvasserStats[] {
  const byName = new Map<string, ParsedLead[]>();
  for (const lead of leads) {
    const name = lead.canvasser ?? "Unassigned";
    byName.set(name, [...(byName.get(name) ?? []), lead]);
  }

  return [...byName.entries()]
    .map(([canvasser, own]) => {
      const count = (...statuses: (string | null)[]) => own.filter((l) => statuses.includes(l.status)).length;
      const sold = count("sale");
      const pitched = sold + count("pm");
      const blowouts = count("blowout");
      const resolved = pitched + blowouts + count("utc");
      const callbacks: Partial<Record<CallbackReason, number>> = {};
      for (const lead of own) {
        if (lead.callbackReason) callbacks[lead.callbackReason] = (callbacks[lead.callbackReason] ?? 0) + 1;
      }
      return {
        canvasser,
        leads: own.length,
        resolved,
        pitched,
        sold,
        blowouts,
        leadToPitchRate: ratio(pitched, resolved),
        closeRate: ratio(sold, pitched),
        salesValue: own.reduce((sum, l) => sum + (l.status === "sale" ? (l.saleAmount ?? 0) : 0), 0),
        callbacks,
      };
    })
    .sort((a, b) => b.leads - a.leads || a.canvasser.localeCompare(b.canvasser));
}

const pct = (value: number | null) => (value === null ? "  –" : `${Math.round(value * 100)}%`.padStart(4));
const pounds = (value: number) => `£${value.toLocaleString("en-GB")}`;

/** A plain-text table for the terminal. */
export function formatStatsTable(stats: readonly CanvasserStats[]): string {
  const header = ["Canvasser", "Leads", "Pitched", "Sold", "Lead→pitch", "Close", "Sales", "Call-backs"];
  const rows = stats.map((s) => [
    s.canvasser,
    String(s.leads),
    String(s.pitched),
    String(s.sold),
    pct(s.leadToPitchRate),
    pct(s.closeRate),
    pounds(s.salesValue),
    String(Object.values(s.callbacks).reduce((a, b) => a + (b ?? 0), 0)),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i] ?? 0) : c.padStart(widths[i] ?? 0))).join("  ");
  return [line(header), widths.map((w) => "─".repeat(w)).join("  "), ...rows.map(line)].join("\n");
}
