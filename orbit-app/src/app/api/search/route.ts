import { NextRequest, NextResponse } from "next/server";
import { proxy as freeSearchProxy } from "@/proxy";

/*
 * ORBIT /api/search
 *
 * Firecrawl has been removed from the active search path.
 * The search engine now uses the free providers implemented in src/proxy.ts
 * (SearXNG first, DuckDuckGo fallback) plus the existing local parsing,
 * ranking, filtering and page-verification logic.
 */
export async function POST(request: NextRequest) {
  const response = await freeSearchProxy(request);

  /*
   * src/proxy.ts returns NextResponse.next() only when every free search
   * provider is unavailable. A route handler must return a real response,
   * so convert that situation into a clean JSON error instead of falling
   * through to the old Firecrawl implementation.
   */
  if (response.headers.get("x-middleware-next") === "1") {
    return NextResponse.json(
      {
        success: false,
        error:
          "Les moteurs de recherche gratuits sont temporairement indisponibles. Réessaie dans quelques secondes.",
        sourceCount: 0,
        candidateCount: 0,
        listingCount: 0,
        sources: [],
        listings: [],
        searchProvider: "SearXNG / DuckDuckGo",
        creditsUsed: null,
      },
      { status: 503 },
    );
  }

  return response;
}
