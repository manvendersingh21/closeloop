import { NextResponse } from "next/server";
import { evidenceStore } from "@/lib/evidence-store";
import { buildResult } from "@/lib/result";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const job = await evidenceStore.getJob(id);
  if (!job) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const [result, handoff, events] = await Promise.all([
    buildResult(id),
    evidenceStore.getHandoff(job.finding_id),
    evidenceStore.getEvents(id),
  ]);
  return NextResponse.json({ result, handoff, events });
}
