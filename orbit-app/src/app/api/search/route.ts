import { NextRequest } from "next/server";
import { proxy as searxngSearchProxy } from "@/proxy";

/*
 * ORBIT /api/search
 *
 * Search provider: SearXNG only.
 * No DuckDuckGo, Bing, Brave or Firecrawl fallback is used here.
 */
export async function POST(request: NextRequest) {
  return searxngSearchProxy(request);
}
