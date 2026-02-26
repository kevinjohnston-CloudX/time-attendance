import https from "node:https";
import type {
  AdpConfig,
  AdpTokenResponse,
  AdpWorker,
  AdpWorkersResponse,
  AdpEarningEntry,
  AdpPayDataEvent,
  AdpPayDataRequest,
} from "./types";

/**
 * ADP Workforce Now API client.
 * Handles OAuth 2.0 client_credentials auth with mTLS certificates.
 */
export class AdpClient {
  private config: AdpConfig;
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(config: AdpConfig) {
    this.config = config;
  }

  /** Build an https.Agent with the mTLS cert and key. */
  private getAgent(): https.Agent {
    return new https.Agent({
      cert: Buffer.from(this.config.certBase64, "base64"),
      key: Buffer.from(this.config.keyBase64, "base64"),
    });
  }

  /** Authenticate and cache the bearer token. */
  async authenticate(): Promise<string> {
    // Return cached token if still valid (with 60s buffer)
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.token;
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    const res = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      // @ts-expect-error — Node fetch supports `agent` via dispatcher
      agent: this.getAgent(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`ADP auth failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as AdpTokenResponse;
    this.token = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
    return this.token;
  }

  /** Make an authenticated GET request to the ADP API. */
  private async get<T>(path: string): Promise<T> {
    const token = await this.authenticate();
    const url = `${this.config.apiUrl}${path}`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      // @ts-expect-error — Node fetch supports `agent` via dispatcher
      agent: this.getAgent(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`ADP API error (${res.status} ${path}): ${text}`);
    }

    return (await res.json()) as T;
  }

  /** Make an authenticated POST request to the ADP API. */
  private async post<T>(path: string, body: unknown): Promise<T> {
    const token = await this.authenticate();
    const url = `${this.config.apiUrl}${path}`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      // @ts-expect-error — Node fetch supports `agent` via dispatcher
      agent: this.getAgent(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`ADP API error (${res.status} POST ${path}): ${text}`);
    }

    return (await res.json()) as T;
  }

  /**
   * Push payroll earnings to ADP via the Pay Data Input API.
   * Groups entries by worker and sends in a single batch.
   */
  async pushPayrollBatch(entries: AdpEarningEntry[]): Promise<unknown> {
    // Group earnings by worker
    const byWorker = new Map<string, AdpEarningEntry[]>();
    for (const entry of entries) {
      const existing = byWorker.get(entry.associateOID) ?? [];
      existing.push(entry);
      byWorker.set(entry.associateOID, existing);
    }

    // Build ADP event payload
    const events: AdpPayDataEvent[] = [];
    for (const [associateOID, workerEntries] of byWorker) {
      events.push({
        data: {
          eventContext: {
            worker: { associateOID },
          },
          transform: {
            payDataInput: {
              payeePayInputs: [
                {
                  payrollProfilePayInputs: [
                    {
                      payInputs: [
                        {
                          earningInputs: workerEntries.map((e) => ({
                            earningCode: { codeValue: e.earningCode },
                            numberOfHours: { hoursValue: e.hoursValue },
                          })),
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        },
      });
    }

    const payload: AdpPayDataRequest = { events };
    return this.post("/events/payroll/v1/pay-data-input.add", payload);
  }

  /**
   * Fetch all workers, handling pagination.
   * ADP returns pages; repeat until an empty `workers` array is returned.
   */
  async getAllWorkers(): Promise<AdpWorker[]> {
    const allWorkers: AdpWorker[] = [];
    let skip = 0;
    const top = 100; // page size

    while (true) {
      const data = await this.get<AdpWorkersResponse>(
        `/hr/v2/workers?$top=${top}&$skip=${skip}`
      );

      if (!data.workers || data.workers.length === 0) break;

      allWorkers.push(...data.workers);
      skip += data.workers.length;

      // Safety: prevent infinite loops
      if (allWorkers.length > 50_000) break;
    }

    return allWorkers;
  }

  /**
   * Fetch the first page of workers (for connection testing).
   */
  async testConnection(): Promise<{ workerCount: number; firstPage: AdpWorker[] }> {
    const data = await this.get<AdpWorkersResponse>("/hr/v2/workers?$top=5");
    return {
      workerCount: data.meta?.totalCount ?? data.workers?.length ?? 0,
      firstPage: data.workers ?? [],
    };
  }
}

/** Read ADP config from environment variables. Returns null if not configured. */
export function getAdpConfig(): AdpConfig | null {
  const clientId = process.env.ADP_CLIENT_ID;
  const clientSecret = process.env.ADP_CLIENT_SECRET;
  const certBase64 = process.env.ADP_CERT_BASE64;
  const keyBase64 = process.env.ADP_KEY_BASE64;

  if (!clientId || !clientSecret || !certBase64 || !keyBase64) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    certBase64,
    keyBase64,
    apiUrl: process.env.ADP_API_URL || "https://api.adp.com",
    tokenUrl:
      process.env.ADP_TOKEN_URL ||
      "https://accounts.adp.com/auth/oauth/v2/token",
  };
}
