import type { NextRequest } from "next/server";
import { franceSearchProxyV2 } from "@/lib/search/france-engine-v2";

export function proxy(request: NextRequest) {
  return franceSearchProxyV2(request);
}

export const config = {
  matcher: ["/api/search"],
};
