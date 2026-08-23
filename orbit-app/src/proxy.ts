import type { NextRequest } from "next/server";
import { franceSearchProxyV7 } from "@/lib/search/france-engine-v7";

export function proxy(request: NextRequest) {
  return franceSearchProxyV7(request);
}

export const config = {
  matcher: ["/api/search"],
};
