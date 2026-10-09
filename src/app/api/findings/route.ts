import { NextResponse } from "next/server";
import { FIXTURES, listFindings } from "@/lib/fixtures";

export async function GET() {
  return NextResponse.json({
    findings: listFindings(),
    fixtures: FIXTURES.map((f) => ({
      id: f.id,
      name: f.name,
      description: f.description,
      entryFile: f.entryFile,
      findingId: f.finding.id,
    })),
  });
}
