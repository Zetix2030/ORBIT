import type { NextRequest } from "next/server";
import { franceSearchProxyV3 } from "@/lib/search/france-engine-v3";

export function proxy(request: NextRequest) {
  return franceSearchProxyV3(request);
}

export const config = {
  matcher: ["/api/search"],
};
