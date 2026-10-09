import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "closeloop",
    llm: Boolean(process.env.NVIDIA_API_KEY),
    ts: new Date().toISOString(),
  });
}
