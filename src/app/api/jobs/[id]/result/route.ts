import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { buildResult } from "@/lib/result";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const expected = Buffer.from(`Bearer ${process.env.CLOSELOOP_INGEST_TOKEN ?? ""}`);
  const provided = Buffer.from(req.headers.get("authorization") ?? "");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const result = await buildResult(id);
  if (!result) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(result);
}
