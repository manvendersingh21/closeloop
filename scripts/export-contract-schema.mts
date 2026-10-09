// Writes JSON Schemas for the integration contract so the discovery agent can
// validate in any language (e.g. Python `jsonschema`). Run: pnpm contract:schema
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { z } from "zod";
import { ExploitHandoffV1, IngestAccepted, RemediationResultV1 } from "../src/contracts/handoff.ts";

const out = path.join(import.meta.dirname, "../contracts/schema");
mkdirSync(out, { recursive: true });

const schemas = {
  "exploit-handoff.v1.schema.json": ExploitHandoffV1,
  "remediation-result.v1.schema.json": RemediationResultV1,
  "ingest-accepted.schema.json": IngestAccepted,
};

for (const [file, schema] of Object.entries(schemas)) {
  writeFileSync(path.join(out, file), JSON.stringify(z.toJSONSchema(schema, { io: "input" }), null, 2) + "\n");
  console.log("wrote contracts/schema/" + file);
}
