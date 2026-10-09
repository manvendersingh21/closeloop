import { NextResponse } from "next/server";
import { z } from "zod";
import { createAndRunRemediation } from "@/lib/engine/pipeline";

const Body = z.object({
  findingId: z.string().min(1),
  fast: z.boolean().optional(),
});

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const job = await createAndRunRemediation(parsed.data.findingId, {
      delayMs: parsed.data.fast ? 80 : 320,
    });
    return NextResponse.json({ job });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
