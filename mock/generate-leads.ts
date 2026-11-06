/**
 * Generates mock/leads.json: fictional leads shaped like a real vtiger Leads module.
 * Every person, street and phone number here is made up. Phone numbers use
 * Ofcom's reserved drama range (07700 900xxx), and postcodes use the fictional
 * "ZZ" area, so nothing can match a real home.
 *
 *   npx tsx mock/generate-leads.ts
 */
import { writeFileSync } from "node:fs";

let seed = 20261106;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T;

const CANVASSERS = ["ALEX turner", "priya s", "Jordan", "sam k", "Chris"];
const STREETS = ["Example Road", "Sample Street", "Placeholder Avenue", "Fictional Close", "Demo Lane", "Mockingbird Way"];
const SURNAMES = ["Smith", "Jones", "Taylor", "Brown", "Williams", "Wilson"];
const OUTCOMES = [
  { status: "Sold", weight: 14, notes: ["Signed £4,250 3 windows + door", "Sold 6250 full house", "signed, deposit taken £3,980", ""] },
  { status: "Pitch&amp;Miss", weight: 22, notes: ["Pitched, too expensive", "Wants to think about it", "Getting other quotes"] },
  { status: "Blowout", weight: 18, notes: ["Partner at work, ring back", "No answer at door", "Not a convenient time", "cancelled on the day", "busy, had to leave", "Not interested now"] },
  { status: "UTC", weight: 10, notes: ["No answer x3", ""] },
  { status: "Re-App", weight: 8, notes: ["Rebook for next week"] },
  { status: "Booked", weight: 16, notes: [""] },
  { status: "Uncontacted", weight: 8, notes: [""] },
  { status: "Survey", weight: 2, notes: [""] }, // deliberately missing from the status map
  { status: "", weight: 2, notes: [""] },
];
const totalWeight = OUTCOMES.reduce((sum, o) => sum + o.weight, 0);
const pickOutcome = () => {
  let r = rand() * totalWeight;
  for (const outcome of OUTCOMES) if ((r -= outcome.weight) < 0) return outcome;
  return OUTCOMES[0]!;
};

const pad = (n: number) => String(n).padStart(2, "0");
const leads = Array.from({ length: 140 }, (_, i) => {
  const outcome = pickOutcome();
  const day = 1 + Math.floor(rand() * 31);
  const month = day > 28 ? 10 : pick([10, 11]);
  const date = `2026-${pad(month)}-${pad(Math.min(day, month === 11 ? 5 : 31))}`;
  const note = pick(outcome.notes);
  const sold = outcome.status === "Sold";
  return {
    id: `10x${1000 + i}`,
    lead_no: `LEA${5000 + i}`,
    firstname: pick(["Pat", "Robin", "Morgan", "Casey", "Jamie"]), // never requested by the app
    lastname: pick(SURNAMES), // never requested by the app
    phone: `07700 900${String(100 + i).slice(-3)}`, // never requested by the app
    email: `customer${i}@example.com`, // never requested by the app
    lane: `${1 + Math.floor(rand() * 120)}${rand() < 0.1 ? "A" : ""} ${pick(STREETS)}`,
    code: `ZZ${1 + Math.floor(rand() * 4)} ${1 + Math.floor(rand() * 9)}${pick(["AB", "CD", "EF", "GH"])}`,
    leadstatus: outcome.status,
    createdtime: `${date} ${pad(9 + Math.floor(rand() * 8))}:${pad(Math.floor(rand() * 60))}:00`,
    modifiedtime: `${date} ${pad(17 + Math.floor(rand() * 3))}:${pad(Math.floor(rand() * 60))}:00`,
    cf_101: date, // appointment date
    cf_102: `${pad(10 + Math.floor(rand() * 9))}:00`, // appointment time
    cf_103: sold && rand() < 0.5 ? `${3000 + Math.floor(rand() * 5000)}.00` : "", // sale amount (often left blank)
    cf_104: pick(CANVASSERS), // canvasser
    cf_105: note, // result note (free text)
    cf_106: "Demo Branch",
    cf_107: "", // rep result note
  };
});

writeFileSync(new URL("./leads.json", import.meta.url), `${JSON.stringify(leads, null, 2)}\n`);
console.log(`Wrote ${leads.length} fictional leads to mock/leads.json`);
