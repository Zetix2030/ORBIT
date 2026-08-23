import type { NextRequest } from "next/server";
import { franceSearchProxyV6 } from "@/lib/search/france-engine-v6";

export function proxy(request: NextRequest) {
  return franceSearchProxyV6(request);
}

export const config = {
  matcher: ["/api/search"],
};
