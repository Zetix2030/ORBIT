import type { NextRequest } from "next/server";
import { franceSearchProxy } from "@/lib/search/france-engine";

export function proxy(request: NextRequest) {
  return franceSearchProxy(request);
}

export const config = {
  matcher: ["/api/search"],
};
