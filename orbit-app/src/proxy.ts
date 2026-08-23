import type { NextRequest } from "next/server";
import { franceSearchProxyV8 } from "@/lib/search/france-engine-v8";

export function proxy(request: NextRequest) {
  return franceSearchProxyV8(request);
}

export const config = {
  matcher: ["/api/search"],
};
