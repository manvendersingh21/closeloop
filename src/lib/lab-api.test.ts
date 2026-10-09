import type { AddressInfo } from "net";
import type { Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TOKEN = "test-token";
process.env.WORKLOAD_TOKEN = TOKEN;

const VULNERABLE = JSON.stringify({
  statements: [
    { sid: "BroadRead", effect: "allow", actions: ["data:read"], resources: ["*"] },
    { sid: "OrdersWrite", effect: "allow", actions: ["orders:write"], resources: ["orders"] },
  ],
});
const FIXED = JSON.stringify({
  statements: [
    { sid: "AppRead", effect: "allow", actions: ["data:read"], resources: ["app/*"] },
    { sid: "OrdersWrite", effect: "allow", actions: ["orders:write"], resources: ["orders"] },
  ],
});

async function boot(policy: string) {
  const { createApp } = await import("../../lab/api/server.mjs");
  const server: Server = createApp(policy);
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (method: string, path: string, auth = true) =>
    fetch(base + path, { method, headers: auth ? { authorization: `Bearer ${TOKEN}` } : {} }).then((r) => r.status);
  return { server, call };
}

describe.each([
  ["vulnerable policy", VULNERABLE, 200],
  ["fixed policy", FIXED, 403],
])("lab-api with %s", (_name, policy, canaryStatus) => {
  let ctx: Awaited<ReturnType<typeof boot>>;
  beforeAll(async () => (ctx = await boot(policy)));
  afterAll(() => ctx.server.close());

  it("rejects requests without the workload token", async () => {
    expect(await ctx.call("GET", "/data/app/config.json", false)).toBe(401);
  });
  it(`canary read returns ${canaryStatus}`, async () => {
    expect(await ctx.call("GET", "/data/canary/secret.txt")).toBe(canaryStatus);
  });
  it("app read still works", async () => {
    expect(await ctx.call("GET", "/data/app/config.json")).toBe(200);
  });
  it("order write still works", async () => {
    expect(await ctx.call("POST", "/orders")).toBe(201);
  });
});
