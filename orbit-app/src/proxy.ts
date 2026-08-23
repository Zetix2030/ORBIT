import type { NextRequest } from "next/server";
import { franceSearchProxyV11 } from "@/lib/search/france-engine-v11";

export function proxy(request: NextRequest) {
  return franceSearchProxyV11(request);
}

export const config = {
  matcher: ["/api/search"],
};
