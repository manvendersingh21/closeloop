import { connection, NextResponse } from "next/server";

const CONFIG_KEYS = [
  "OPENAI_API_KEY",
  "CLICKHOUSE_URL",
  "CLICKHOUSE_USER",
  "CLICKHOUSE_PASSWORD",
  "CLICKHOUSE_DATABASE",
  "CLOSELOOP_INGEST_TOKEN",
  "AKASH_CONSOLE_API_KEY",
  "AKASH_LAB_DSEQ",
  "LAB_BASE_URL",
  "LAB_WORKLOAD_TOKEN",
  "GUILD_AI_API_KEY",
  "GUILD_OWNER",
  "GUILD_WORKSPACE",
  "GUILD_REVIEWER_AGENT",
  "GITHUB_TOKEN",
  "CLOSELOOP_PR_REPO",
] as const;

/** Minimum set needed to run the loop end to end. */
const REQUIRED: readonly (typeof CONFIG_KEYS)[number][] = [
  "CLICKHOUSE_URL",
  "CLICKHOUSE_USER",
  "CLICKHOUSE_PASSWORD",
  "CLICKHOUSE_DATABASE",
  "CLOSELOOP_INGEST_TOKEN",
  "AKASH_CONSOLE_API_KEY",
  "LAB_BASE_URL",
  "LAB_WORKLOAD_TOKEN",
  "OPENAI_API_KEY",
];

export async function GET() {
  // Opt out of build-time prerendering so env presence reflects the running container.
  await connection();
  // Presence only: never echo values.
  const config = Object.fromEntries(CONFIG_KEYS.map((k) => [k, Boolean(process.env[k])])) as Record<
    (typeof CONFIG_KEYS)[number],
    boolean
  >;
  return NextResponse.json({
    ok: true,
    service: "closeloop",
    llm: Boolean(process.env.NVIDIA_API_KEY),
    ready: REQUIRED.every((k) => config[k]),
    config,
    ts: new Date().toISOString(),
  });
}
