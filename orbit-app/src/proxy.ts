import type { NextRequest } from "next/server";
import { franceSearchProxyV10 } from "@/lib/search/france-engine-v10";

export function proxy(request: NextRequest) {
  return franceSearchProxyV10(request);
}

export const config = {
  matcher: ["/api/search"],
};
