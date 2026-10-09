import { NextResponse, after } from "next/server";
import { ingestHandoff } from "@/lib/remediate/ingest";
import { store } from "@/lib/remediate/wiring";

export const maxDuration = 300;

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const outcome = await ingestHandoff(req.headers.get("authorization"), await req.text(), store);
    if (outcome.run) after(outcome.run);
    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (err) {
    // Usually the evidence store being unreachable.
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
}
