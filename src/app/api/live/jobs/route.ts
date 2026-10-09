import { NextResponse } from "next/server";
import { evidenceStore } from "@/lib/evidence-store";

export async function GET(): Promise<NextResponse> {
  const jobs = await evidenceStore.listJobs(20);
  return NextResponse.json({ jobs });
}
