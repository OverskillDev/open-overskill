import { NextResponse } from "next/server";
import { creator, contextAsMarkdown, suggestions } from "@/lib/creator-context";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    creator,
    contextMarkdown: contextAsMarkdown(),
    suggestions,
  });
}
