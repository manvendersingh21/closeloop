// Minimal Akash Console API client (https://console-api.akash.network, x-api-key auth).
// Only what the executor needs: read a deployment, patch one service's env.

const BASE = process.env.AKASH_CONSOLE_API_URL || "https://console-api.akash.network";

export interface AkashClient {
  getDeployment(dseq: string): Promise<{ state: string; leases: unknown[] }>;
  /** Merges `env` into the named service and sends the deployment update + manifest. */
  patchServiceEnv(dseq: string, service: string, env: Record<string, string>): Promise<void>;
}

async function call(path: string, init: RequestInit = {}, attempt = 1): Promise<unknown> {
  const key = process.env.AKASH_CONSOLE_API_KEY;
  if (!key) throw new Error("AKASH_CONSOLE_API_KEY is not set");
  const res = await fetch(BASE + path, {
    ...init,
    headers: { "x-api-key": key, "content-type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(60_000),
  });
  // 409: concurrent definition change; 503: KMS briefly unreachable. Both are documented as safe to resend.
  if ((res.status === 409 || res.status === 503) && attempt < 3) {
    await new Promise((r) => setTimeout(r, 1500 * attempt));
    return call(path, init, attempt + 1);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`Akash ${init.method || "GET"} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

export const akashClient: AkashClient = {
  async getDeployment(dseq) {
    const body = (await call(`/v1/deployments/${encodeURIComponent(dseq)}`)) as {
      data: { deployment: { state: string }; leases?: unknown[] };
    };
    return { state: body.data.deployment.state, leases: body.data.leases ?? [] };
  },

  async patchServiceEnv(dseq, service, env) {
    await call(`/v1/deployments/${encodeURIComponent(dseq)}`, {
      method: "PATCH",
      body: JSON.stringify({ data: { services: { [service]: { env } } } }),
    });
  },
};
