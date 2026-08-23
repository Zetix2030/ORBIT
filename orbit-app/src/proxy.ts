import type { NextRequest } from "next/server";
import { franceSearchProxyV5 } from "@/lib/search/france-engine-v5";

export function proxy(request: NextRequest) {
  return franceSearchProxyV5(request);
}

export const config = {
  matcher: ["/api/search"],
};
