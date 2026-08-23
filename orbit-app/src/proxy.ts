import type { NextRequest } from "next/server";
import { franceSearchProxyV9 } from "@/lib/search/france-engine-v9";

export function proxy(request: NextRequest) {
  return franceSearchProxyV9(request);
}

export const config = {
  matcher: ["/api/search"],
};
