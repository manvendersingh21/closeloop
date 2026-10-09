import { connection, NextResponse } from "next/server";
import { evidenceStore } from "@/lib/evidence-store";

export async function GET(): Promise<NextResponse> {
  await connection(); // always read live data; never prerender at build time
  const jobs = await evidenceStore.listJobs(20);
  return NextResponse.json({ jobs });
}
