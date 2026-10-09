// Applies db/clickhouse.sql statement by statement over the ClickHouse HTTP
// interface (POST body = statement, basic auth from env). Idempotent.
import { readFileSync } from "node:fs";
import path from "node:path";

try {
  process.loadEnvFile(".env");
} catch {
  // .env is optional; env may come from the shell
}

const url = process.env.CLICKHOUSE_URL;
const user = process.env.CLICKHOUSE_USER ?? "default";
const password = process.env.CLICKHOUSE_PASSWORD ?? "";

if (!url) {
  console.error("error: CLICKHOUSE_URL is not set");
  process.exit(1);
}

const authHeader = () => ({
  Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`,
});

function stripComments(statement) {
  return statement
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .trim();
}

const sqlPath = path.resolve(process.cwd(), "db/clickhouse.sql");
const sql = readFileSync(sqlPath, "utf8");
const statements = sql
  .split(";\n\n")
  .map(stripComments)
  .filter((statement) => statement.length > 0);

let failed = false;
for (const statement of statements) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { ...authHeader() },
      body: statement,
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`FAIL (${res.status}): ${statement.split("\n")[0]}`);
      console.error(text);
      failed = true;
      break;
    }
    console.log(`ok: ${statement.split("\n")[0]}`);
  } catch (err) {
    console.error(`FAIL (network): ${statement.split("\n")[0]}`);
    console.error(err instanceof Error ? err.message : String(err));
    failed = true;
    break;
  }
}

process.exit(failed ? 1 : 0);
