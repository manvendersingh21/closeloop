import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ExploitHandoffV1, RemediationResultV1 } from "./handoff";

const example = (name: string) =>
  JSON.parse(readFileSync(path.join(__dirname, "../../contracts/examples", name), "utf8"));

describe("integration contract", () => {
  it("accepts the example handoff", () => {
    const r = ExploitHandoffV1.safeParse(example("FIND-001.handoff.json"));
    expect(r.error?.issues ?? []).toEqual([]);
  });

  it("accepts the example result", () => {
    const r = RemediationResultV1.safeParse(example("FIND-001.result.json"));
    expect(r.error?.issues ?? []).toEqual([]);
  });

  it("rejects handoffs outside the authorized lab", () => {
    const h = example("FIND-001.handoff.json");
    h.scope.environment = "production";
    expect(ExploitHandoffV1.safeParse(h).success).toBe(false);
  });

  it("rejects handoffs without a positive check", () => {
    const h = example("FIND-001.handoff.json");
    h.verification.checks = h.verification.checks.filter(
      (c: { kind: string }) => c.kind !== "positive",
    );
    expect(ExploitHandoffV1.safeParse(h).success).toBe(false);
  });
});
