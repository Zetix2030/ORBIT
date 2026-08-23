import type { NextRequest } from "next/server";
import { franceSearchProxyV4 } from "@/lib/search/france-engine-v4";

export function proxy(request: NextRequest) {
  return franceSearchProxyV4(request);
}

export const config = {
  matcher: ["/api/search"],
};
