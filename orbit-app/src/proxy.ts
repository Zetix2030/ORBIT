import type { NextRequest } from "next/server";
import { proxy as searchProxy } from "@/lib/search/proxy-v2";

export function proxy(request: NextRequest) {
  return searchProxy(request);
}

export const config = {
  matcher: ["/api/search"],
};
