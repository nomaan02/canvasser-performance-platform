/**
 * Pure parsing of CRM lead rows into what the app keeps.
 *
 * Privacy rules enforced here:
 *   - free-text notes ("Result", "Rep Result") are read only to extract a sale
 *     price or a call-back reason. Only the number or the label leaves this
 *     file; the text itself is never returned, stored or logged;
 *   - the canvasser is kept by first name only;
 *   - the street and house number are parsed only so the lead can be matched
 *     to a door (UPRN); they are returned in `match`, not as a stored address.
 */
import type { CrmLeadRow } from "./fields.js";

export type AppStatus = "sale" | "pm" | "blowout" | "utc" | "re_app" | "confirmed" | "pending";
export type SaleAmountSource = "sale_amount" | "result" | "rep_result";
export type CrmDatetimeZone = "UTC" | "Europe/London";

export const CALLBACK_REASONS = ["utc", "no_outcome", "reapp", "single_sit", "not_convenient", "no_time", "rta", "rearrange", "no_answer"] as const;
export type CallbackReason = (typeof CALLBACK_REASONS)[number];

export type MatchInput = { crmId: string; postcode: string | null; number: number | null; suffix: string; street: string | null };

export type ParsedLead = {
  crmId: string;
  leadNumber: string | null;
  statusRaw: string | null;
  status: AppStatus | null;
  statusUnknown: boolean;
  createdAt: string;
  modifiedAt: string;
  appointmentAt: string | null;
  branch: string;
  saleAmount: number | null;
  saleAmountSource: SaleAmountSource | null;
  callbackReason: CallbackReason | null;
  postcode: string | null;
  postcodeSector: string | null;
  canvasser: string | null;
  match: MatchInput;
};

// ---- text clean-up -----------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };

/** vtiger may HTML-encode text ('Pitch&amp;Miss', 'St Mary&#039;s Road'). Decode before anything else. */
export function decodeCrmText(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  return raw.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1]?.toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

const POSTCODE = /^([A-Z]{1,2}[0-9][A-Z0-9]?)([0-9][A-Z]{2})$/;

/** 'bs78ab ' -> 'BS7 8AB'; anything that is not a full UK postcode -> null. */
export function normalisePostcode(raw: string | null | undefined): string | null {
  const compact = (raw ?? "").toUpperCase().replace(/\s+/g, "");
  const m = POSTCODE.exec(compact);
  return m ? `${m[1]} ${m[2]}` : null;
}

/** 'BS7 8AB' -> 'BS7 8'. */
export function postcodeSector(postcode: string | null): string | null {
  return postcode ? postcode.slice(0, -2) : null;
}

export type StreetParts = { number: number | null; suffix: string; street: string | null };

/**
 * First address line -> house number, letter and street. Handles
 * '23 Example Road', '23A Example Road', '21-23 Example Road', '23, Example Road',
 * 'Flat 2, 23 Example Road', multi-line and a trailing town after a comma.
 */
export function parseStreetLine(raw: string | null | undefined): StreetParts {
  const text = (raw ?? "")
    .replace(/\r?\n|\|/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return { number: null, suffix: "", street: null };

  const lead = /^(\d{1,4})(?:\s*-\s*\d{1,4})?([A-Za-z])?(?=[\s,]|$)[\s,]*(.*)$/.exec(text);
  const inner = lead ? null : /(?:^|[\s,])(\d{1,4})([A-Za-z])?[\s,]+([A-Za-z][^,]*)/.exec(text);
  const hit = lead ?? inner;
  if (!hit) return { number: null, suffix: "", street: firstPart(text) };

  const number = Number.parseInt(hit[1] ?? "", 10);
  return {
    number: Number.isFinite(number) && number > 0 ? number : null,
    suffix: (hit[2] ?? "").toUpperCase(),
    street: firstPart(hit[3] ?? ""),
  };
}

function firstPart(text: string): string | null {
  const part = (text.split(",")[0] ?? "").trim();
  return /[A-Za-z]/.test(part) ? part : null;
}

/** 'JOHN smith' -> 'John'; "o'neil" -> "O'neil"; blank -> null. First name only. */
export function firstNameOnly(raw: string | null | undefined): string | null {
  const m = /[A-Za-z][A-Za-z'-]*/.exec(raw ?? "");
  if (!m) return null;
  const word = m[0].toLowerCase();
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// ---- sale price ------------------------------------------------------------

/** CRM currency text -> pounds, or null when blank / zero / not a number. */
export function saleAmount(raw: string | null | undefined): number | null {
  const n = Number.parseFloat((raw ?? "").replace(/[£,\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  const pounds = Math.round(n * 100) / 100;
  return pounds > 0 && pounds < 1e10 ? pounds : null;
}

const POUND_MIN = 100;
const BARE_MIN = 300;
const PRICE_MAX = 100_000;
const POUND_PRICE = /£\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?(?![\d,])/g;
/** A bare 3–6 digit number not starting with 0, and not part of a time (11:45, 11.45), a phone number or a longer number. */
const BARE_PRICE = /(?<![\d:.,£])([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{2,5})(?![\d:,]|\.\d)/g;

function firstPrice(text: string, pattern: RegExp, min: number): number | null {
  for (const m of text.matchAll(pattern)) {
    const n = Number.parseInt((m[1] ?? "").replace(/,/g, ""), 10);
    if (Number.isFinite(n) && n >= min && n <= PRICE_MAX) return n;
  }
  return null;
}

/**
 * A price typed into free text ("Signed £2,534", "4792 windows x3").
 * A £ amount (£100–£100,000) wins; otherwise the first bare number from 300 to
 * 100,000. Times and phone numbers are skipped. Returns the number only.
 */
export function priceInText(raw: string | null | undefined): number | null {
  const text = (raw ?? "").replace(/\s+/g, " ");
  if (!text.trim()) return null;
  return firstPrice(text, POUND_PRICE, POUND_MIN) ?? firstPrice(text, BARE_PRICE, BARE_MIN);
}

/**
 * Real CRMs are messy: staff don't always fill the Sale Amount field and type
 * the price into a notes box instead. Sale Amount first; for a sold lead only,
 * then the price in Result, then in Rep Result.
 */
export function leadSaleAmount(
  status: AppStatus | null,
  amountField: string | null | undefined,
  resultText: string | null | undefined,
  repResultText: string | null | undefined,
): { amount: number | null; source: SaleAmountSource | null } {
  const amount = saleAmount(amountField);
  if (amount !== null) return { amount, source: "sale_amount" };
  if (status !== "sale") return { amount: null, source: null };
  const fromResult = priceInText(resultText);
  if (fromResult !== null) return { amount: fromResult, source: "result" };
  const fromRep = priceInText(repResultText);
  if (fromRep !== null) return { amount: fromRep, source: "rep_result" };
  return { amount: null, source: null };
}

// ---- call-back list ------------------------------------------------------------

/** Any of these in the notes keeps a lead OFF the call-back list, whatever else matches. */
const CALLBACK_NEVER: readonly RegExp[] = [
  /\b(titc|ritc)\b/i, // texted / rang in to cancel
  /\bcancel(l?ed|s|ling|lation)?\b/i,
  /not interested|\bn\/i\b|no interest/i,
  /chang(ed|e of) (their |her |his )?mind/i,
  /wrong (number|no\b|num)/i,
  /already (had|got|has|have|done)|had (it|them|the windows?|the doors?|windows?|doors?) done|\bwithin (the last )?\d+ ?(years?|yrs?)\b/i,
  /do not (call|contact)|don'?t (call|contact)|deceased|passed away/i,
];

/** Notes on a lost appointment ("blowout") that make it worth ringing back, in priority order. */
const CALLBACK_BLOWOUT: readonly [CallbackReason, RegExp][] = [
  ["single_sit", /single sit|\b(1|one)[ -]?leg(ger)?\b|\b(partner|hubby|husband|wife|other half)\b.{0,25}\b(not|wasn'?t|isn'?t|out|away|work|working|late)\b/i],
  ["not_convenient", /\b(not|wasn'?t|isn'?t|wasnt|isnt) (a )?(convenient|good time)|inconvenient|bad time/i],
  ["no_time", /\bno time\b|(didn'?t|did not|don'?t|dont|didnt) have (the )?time|not enough time|running late|in a rush|had to (go|leave)|\bbusy\b/i],
  ["rta", /\brta\b/i],
  ["rearrange", /call ?back|ring back|re-?book|re-?arrange|re-?app|another (day|time)|next week|tomorrow/i],
  ["no_answer", /no answer|\bnot in\b|nobody (in|home)|no show|didn'?t answer/i],
  ["utc", /\butc\b/i],
];

/**
 * "Unable to contact", no outcome and re-appointments are always call-backs;
 * a blowout is one when its notes give a reason. Any "never" note (cancelled,
 * not interested, wrong number …) wins. Returns the label only.
 */
export function callbackReason(
  status: AppStatus | null,
  statusUnknown: boolean,
  resultText: string | null | undefined,
  repResultText: string | null | undefined,
): CallbackReason | null {
  if (statusUnknown) return null;
  const notes = `${resultText ?? ""} ${repResultText ?? ""}`.replace(/\s+/g, " ");
  if (CALLBACK_NEVER.some((re) => re.test(notes))) return null;
  if (status === "utc") return "utc";
  if (status === null) return "no_outcome";
  if (status === "re_app") return "reapp";
  if (status !== "blowout") return null;
  for (const [reason, re] of CALLBACK_BLOWOUT) if (re.test(notes)) return reason;
  return null;
}

// ---- status and dates ------------------------------------------------------------

export type StatusResult = { statusRaw: string | null; status: AppStatus | null; unknown: boolean };

/** Blank -> "no outcome" (null). A value missing from the map is kept raw and flagged, never guessed. */
export function mapStatus(raw: string | null | undefined, map: ReadonlyMap<string, AppStatus>): StatusResult {
  const text = (raw ?? "").trim();
  if (!text) return { statusRaw: null, status: null, unknown: false };
  const status = map.get(text) ?? null;
  return { statusRaw: text, status, unknown: status === null };
}

const STAMP = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/;

/** Minutes London is ahead of UTC at a given instant (0 or 60). */
function londonOffsetMinutes(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - Math.floor(utcMs / 60000) * 60000) / 60000);
}

/** 'YYYY-MM-DD[ HH:MM[:SS]]' in the given zone -> ISO UTC string, or null. Handles BST/GMT changes. */
export function crmStampToIso(raw: string | null | undefined, zone: CrmDatetimeZone): string | null {
  const m = STAMP.exec((raw ?? "").trim());
  if (!m) return null;
  const [y, mo, d, h12, mi, s] = m.slice(1, 7).map((v) => Number(v ?? "0"));
  const meridiem = (m[7] ?? "").toUpperCase();
  if (meridiem && ((h12 ?? 0) < 1 || (h12 ?? 0) > 12)) return null;
  const h = meridiem === "PM" ? ((h12 ?? 0) % 12) + 12 : meridiem === "AM" ? (h12 ?? 0) % 12 : (h12 ?? 0);
  if (h > 23 || (mi ?? 0) > 59 || (s ?? 0) > 59) return null;
  const wall = Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 1, h, mi ?? 0, s ?? 0);
  const check = new Date(wall);
  if (Number.isNaN(wall) || check.getUTCFullYear() !== y || check.getUTCMonth() + 1 !== mo || check.getUTCDate() !== d) return null;
  if (zone === "UTC") return new Date(wall).toISOString();
  const first = wall - londonOffsetMinutes(wall) * 60000;
  const utc = wall - londonOffsetMinutes(first) * 60000;
  return new Date(utc).toISOString();
}

/** ISO instant -> 'YYYY-MM-DD HH:MM:SS' in the CRM's zone (for "modified since" queries). */
export function isoToCrmStamp(iso: string, zone: CrmDatetimeZone): string {
  const ms = Date.parse(iso);
  const shifted = zone === "UTC" ? ms : ms + londonOffsetMinutes(ms) * 60000;
  return new Date(shifted).toISOString().slice(0, 19).replace("T", " ");
}

/** Appointment date + time are typed in by office staff: always UK local time. */
export function appointmentToIso(date: string | null | undefined, time: string | null | undefined): string | null {
  const d = (date ?? "").trim();
  if (!d) return null;
  const t = (time ?? "").trim();
  return crmStampToIso(t ? `${d} ${t}` : d, "Europe/London");
}

// ---- one lead ------------------------------------------------------------

export class CrmParseError extends Error {}

export function parseLead(raw: CrmLeadRow, statusMap: ReadonlyMap<string, AppStatus>, zone: CrmDatetimeZone): ParsedLead {
  const text = (value: string | null | undefined) => decodeCrmText(value);
  const created = crmStampToIso(text(raw.createdAt), zone);
  const modified = crmStampToIso(text(raw.modifiedAt), zone);
  if (!created || !modified) throw new CrmParseError(`CRM lead ${raw.id}: unreadable created/modified time`);

  const postcode = normalisePostcode(text(raw.postcode));
  const street = parseStreetLine(text(raw.street));
  const status = mapStatus(text(raw.status), statusMap);
  const resultNote = text(raw.resultNote);
  const repResultNote = text(raw.repResultNote);
  const sale = leadSaleAmount(status.status, text(raw.saleAmount), resultNote, repResultNote);

  return {
    crmId: raw.id,
    leadNumber: (text(raw.leadNumber) ?? "").trim() || null,
    statusRaw: status.statusRaw,
    status: status.status,
    statusUnknown: status.unknown,
    createdAt: created,
    modifiedAt: modified,
    appointmentAt: appointmentToIso(text(raw.appointmentDate), text(raw.appointmentTime)),
    branch: (text(raw.branch) ?? "").trim() || "Unknown",
    saleAmount: sale.amount,
    saleAmountSource: sale.source,
    callbackReason: callbackReason(status.status, status.unknown, resultNote, repResultNote),
    postcode,
    postcodeSector: postcodeSector(postcode),
    canvasser: firstNameOnly(text(raw.canvasser)),
    match: { crmId: raw.id, postcode, number: street.number, suffix: street.suffix, street: street.street },
  };
}
