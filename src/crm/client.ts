/**
 * Read-only client for a vtiger-based CRM's webservice API.
 *
 * READ-ONLY BY CONSTRUCTION:
 *   - only the operations in CRM_READ_OPERATIONS can be sent;
 *   - `query` must be a single `SELECT ... FROM Leads` statement;
 *   - it refuses to run in a browser, so the access key never reaches a client bundle.
 *
 * `test/client.test.ts` fails if a write operation ever becomes callable.
 *
 * Login is vtiger's challenge/response handshake:
 *   1. GET  ?operation=getchallenge&username=…   → a one-time token
 *   2. POST operation=login, accessKey=md5(token + yourAccessKey) → a session name
 *   3. GET  ?operation=query&sessionName=…&query=SELECT …;
 */
import { createHash } from "node:crypto";

export const CRM_READ_OPERATIONS = ["getchallenge", "login", "listtypes", "describe", "query", "logout"] as const;
export type CrmReadOperation = (typeof CRM_READ_OPERATIONS)[number];

/** vtiger returns at most 100 rows per query. */
export const CRM_PAGE_SIZE = 100;

export class CrmError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

/** Throws unless the call is a permitted read. */
export function assertReadOnlyCall(operation: string, query?: string): asserts operation is CrmReadOperation {
  if (!(CRM_READ_OPERATIONS as readonly string[]).includes(operation)) {
    throw new CrmError(`Blocked CRM operation "${operation}": this app only reads from the CRM.`, "BLOCKED_OPERATION");
  }
  if (operation !== "query") return;
  const sql = (query ?? "").trim();
  const single = sql.endsWith(";") && !sql.slice(0, -1).includes(";");
  if (!single || !/^SELECT\s[\s\S]+\sFROM\s+Leads\b/i.test(sql)) {
    throw new CrmError("Blocked CRM query: only one SELECT ... FROM Leads statement is allowed.", "BLOCKED_QUERY");
  }
}

type CrmEnvelope<T> = { success: boolean; result?: T; error?: { code?: string; message?: string } };

export type CrmReader = {
  query<T>(sql: string): Promise<T[]>;
  close(): Promise<void>;
};

export type OpenCrmOptions = {
  baseUrl: string;
  user: string;
  accessKey: string;
  /** Minimum gap between requests, to stay gentle on a shared CRM server. Default 1,000 ms. */
  minIntervalMs?: number;
};

export async function openCrmReader(options: OpenCrmOptions): Promise<CrmReader> {
  if (typeof (globalThis as { window?: unknown }).window !== "undefined") {
    throw new CrmError("The CRM client is server-only.", "SERVER_ONLY");
  }
  if (!options.baseUrl) throw new CrmError("CRM_BASE_URL must be set.", "NO_BASE_URL");
  if (!options.user || !options.accessKey) throw new CrmError("CRM_USER and CRM_ACCESS_KEY must be set.", "NO_CREDENTIALS");

  const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/webservice.php`;
  const gap = options.minIntervalMs ?? 1000;
  let lastCall = 0;
  let session = "";

  const call = async <T>(method: "GET" | "POST", params: Record<string, string>): Promise<T> => {
    assertReadOnlyCall(params.operation ?? "", params.query);
    const wait = lastCall + gap - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastCall = Date.now();

    const body = new URLSearchParams(params);
    const response =
      method === "GET"
        ? await fetch(`${endpoint}?${body.toString()}`, { method: "GET", signal: AbortSignal.timeout(30_000) })
        : await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
            signal: AbortSignal.timeout(30_000),
          });
    if (!response.ok) throw new CrmError(`CRM HTTP ${response.status}`, `HTTP_${response.status}`);
    const json = (await response.json()) as CrmEnvelope<T>;
    if (!json.success || json.result === undefined) {
      throw new CrmError(`CRM refused: ${json.error?.message ?? "unknown error"}`, json.error?.code ?? "UNKNOWN");
    }
    return json.result;
  };

  const login = async () => {
    const challenge = await call<{ token: string }>("GET", { operation: "getchallenge", username: options.user });
    const accessKey = createHash("md5").update(challenge.token + options.accessKey).digest("hex");
    const result = await call<{ sessionName: string }>("POST", { operation: "login", username: options.user, accessKey });
    session = result.sessionName;
  };

  await login();

  return {
    async query<T>(sql: string): Promise<T[]> {
      try {
        return await call<T[]>("GET", { operation: "query", sessionName: session, query: sql });
      } catch (err) {
        // Sessions expire on the server; log in again once and retry.
        if (err instanceof CrmError && err.code === "INVALID_SESSIONID") {
          await login();
          return call<T[]>("GET", { operation: "query", sessionName: session, query: sql });
        }
        throw err;
      }
    },
    async close() {
      try {
        await call<unknown>("POST", { operation: "logout", sessionName: session });
      } catch {
        // Some vtiger installs refuse logout; the session expires on its own.
      }
    },
  };
}
