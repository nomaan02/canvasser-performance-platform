/**
 * A tiny stand-in for a vtiger CRM webservice, so the demo runs with no
 * real CRM and no credentials. It implements just enough of the real API:
 *
 *   GET  /webservice.php?operation=getchallenge&username=…
 *   POST /webservice.php  operation=login  (checks md5(token + access key))
 *   GET  /webservice.php?operation=query&sessionName=…&query=SELECT … FROM Leads …;
 *   POST /webservice.php  operation=logout
 *
 * It returns ONLY the columns a query asks for, just like the real thing, so
 * you can see the app never receives names, phone numbers or emails.
 *
 * Run it on its own:  npm run mock-crm   (then point CRM_BASE_URL at it)
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export const MOCK_USER = "demo";
export const MOCK_ACCESS_KEY = "demo-access-key";

type Lead = Record<string, string>;

const ok = (result: unknown) => JSON.stringify({ success: true, result });
const fail = (code: string, message: string) => JSON.stringify({ success: false, error: { code, message } });

function runQuery(sql: string, leads: Lead[]): Record<string, string | null>[] | string {
  const m = /^SELECT\s+(.+?)\s+FROM\s+Leads(?:\s+WHERE\s+(\w+)\s*>=\s*'([^']+)')?(?:\s+ORDER BY\s+(\w+))?(?:\s+LIMIT\s+(\d+)\s*,\s*(\d+))?\s*;$/is.exec(sql.trim());
  if (!m) return "Unsupported query in the mock CRM";
  const [, columns = "", whereField, whereValue, orderBy, offset, limit] = m;
  let rows = whereField ? leads.filter((lead) => (lead[whereField] ?? "") >= (whereValue ?? "")) : [...leads];
  if (columns.trim().toLowerCase() === "count(*)") return [{ count: String(rows.length) }];
  if (orderBy) rows.sort((a, b) => (a[orderBy] ?? "").localeCompare(b[orderBy] ?? "", undefined, { numeric: true }));
  const start = Number(offset ?? 0);
  rows = rows.slice(start, start + Math.min(Number(limit ?? 100), 100));
  const wanted = columns.split(",").map((c) => c.trim());
  return rows.map((row) => Object.fromEntries(wanted.map((col) => [col, row[col] ?? null])));
}

export function startMockCrm(port = 0): Promise<{ server: Server; baseUrl: string }> {
  const leads = JSON.parse(readFileSync(new URL("./leads.json", import.meta.url), "utf8")) as Lead[];
  const challenges = new Map<string, string>();
  const sessions = new Set<string>();

  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/webservice.php") {
      res.statusCode = 404;
      res.end(fail("NOT_FOUND", "Only /webservice.php exists"));
      return;
    }
    let params = url.searchParams;
    if (req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      params = new URLSearchParams(body);
    }

    switch (params.get("operation")) {
      case "getchallenge": {
        const token = randomBytes(8).toString("hex");
        challenges.set(params.get("username") ?? "", token);
        res.end(ok({ token, serverTime: Math.floor(Date.now() / 1000), expireTime: Math.floor(Date.now() / 1000) + 300 }));
        return;
      }
      case "login": {
        const user = params.get("username") ?? "";
        const expected = createHash("md5").update((challenges.get(user) ?? "") + MOCK_ACCESS_KEY).digest("hex");
        if (user !== MOCK_USER || params.get("accessKey") !== expected) {
          res.end(fail("INVALID_AUTH_TOKEN", "Invalid username or access key"));
          return;
        }
        const sessionName = randomBytes(12).toString("hex");
        sessions.add(sessionName);
        res.end(ok({ sessionName, userId: "19x1" }));
        return;
      }
      case "query": {
        if (!sessions.has(params.get("sessionName") ?? "")) {
          res.end(fail("INVALID_SESSIONID", "Session expired or invalid"));
          return;
        }
        const result = runQuery(params.get("query") ?? "", leads);
        res.end(typeof result === "string" ? fail("QUERY_SYNTAX_ERROR", result) : ok(result));
        return;
      }
      case "logout":
        sessions.delete(params.get("sessionName") ?? "");
        res.end(ok({ message: "successfull" }));
        return;
      default:
        res.end(fail("UNKNOWN_OPERATION", "Operation not supported by the mock CRM"));
    }
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const { port: actual } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${actual}` });
    });
  });
}

// `npm run mock-crm` starts it on a fixed port and keeps it running.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("crm-server.ts")) {
  const { baseUrl } = await startMockCrm(Number(process.env.MOCK_CRM_PORT ?? 8787));
  console.log(`Mock CRM running at ${baseUrl}/webservice.php`);
  console.log(`Log in with CRM_USER=${MOCK_USER} and CRM_ACCESS_KEY=${MOCK_ACCESS_KEY}. Press Ctrl+C to stop.`);
}
