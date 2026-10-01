import { NextResponse } from "next/server";
import { configInfo } from "@/lib/overskill";
import { creator, attribution } from "@/lib/creator-context";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ...configInfo(),
    creatorId: creator.id,
    attribution,
  });
}
