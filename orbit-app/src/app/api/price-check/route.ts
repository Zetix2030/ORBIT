import { NextResponse } from "next/server";

import {
  parsePriceFromText,
  sanitizePropertyPrice,
} from "@/lib/search/price";

type PriceCheckBody = {
  url?: string;
  title?: string;
  currency?: string;
  surface?: number;
};

type SearxResult = {
  url?: string;
  title?: string;
  content?: string;
};

type SearxResponse = {
  results?: SearxResult[];
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function host(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function extractPagePriceText(html: string) {
  const chunks: string[] = [];

  const patterns = [
    /["']price["']\s*:\s*["']?([0-9][0-9\s.,]*)["']?/gi,
    /["']listPrice["']\s*:\s*["']?([0-9][0-9\s.,]*)["']?/gi,
    /["']priceCurrency["']\s*:\s*["']([A-Z]{3})["']/gi,
    /(?:itemprop|property|name)=["'][^"']*(?:price|amount)[^"']*["'][^>]*(?:content|value)=["']([^"']+)["']/gi,
    /(?:content|value)=["']([^"']+)["'][^>]*(?:itemprop|property|name)=["'][^"']*(?:price|amount)[^"']*["']/gi,
    /(?:og:description|twitter:description)[^>]+content=["']([^"']+)["']/gi,
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const value = clean(match[1]);
      if (value) chunks.push(value);
      if (chunks.length >= 40) break;
    }
  }

  const jsonLd = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1] ?? "")
    .join(" ");

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";

  return decodeHtml(`${title} ${chunks.join(" listing price ")} ${jsonLd}`)
    .replace(/\s+/g, " ")
    .slice(0, 180_000);
}

async function checkDirectPage(
  url: string,
  currency: string,
  surface?: number,
) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return undefined;

    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) {
      return undefined;
    }

    const html = (await response.text()).slice(0, 1_500_000);
    const parsed = parsePriceFromText(extractPagePriceText(html), currency);
    const price = sanitizePropertyPrice(
      parsed.value,
      parsed.currency ?? currency,
      surface,
      parsed.confidence,
    );

    if (!price) return undefined;

    return {
      price,
      currency: parsed.currency ?? currency,
      confidence: "confirmed" as const,
      source: "page" as const,
    };
  } catch {
    return undefined;
  }
}

function titleKeywords(title: string) {
  return clean(title)
    .replace(/[|\-–—]+/g, " ")
    .split(" ")
    .filter((word) => word.length >= 4)
    .slice(0, 10)
    .join(" ");
}

async function checkSearchFallback(
  url: string,
  title: string,
  currency: string,
  surface?: number,
) {
  const domain = host(url);
  if (!domain) return undefined;

  const base = (process.env.SEARXNG_URL ?? "http://localhost:8080").replace(/\/$/, "");
  const query = `site:${domain} ${titleKeywords(title)} price for sale`;

  try {
    const searchUrl = new URL(`${base}/search`);
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("format", "json");
    searchUrl.searchParams.set("safesearch", "0");

    const response = await fetch(searchUrl, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(4500),
    });

    if (!response.ok) return undefined;

    const payload = (await response.json()) as SearxResponse;
    const results = Array.isArray(payload.results) ? payload.results.slice(0, 8) : [];

    for (const result of results) {
      if (result.url && host(result.url) !== domain) continue;

      const combined = `${clean(result.title)} ${clean(result.content)}`;
      const parsed = parsePriceFromText(combined, currency);
      const price = sanitizePropertyPrice(
        parsed.value,
        parsed.currency ?? currency,
        surface,
        parsed.confidence,
      );

      if (!price) continue;

      return {
        price,
        currency: parsed.currency ?? currency,
        confidence: "snippet" as const,
        source: "search" as const,
      };
    }
  } catch {
    // Search fallback is best-effort only.
  }

  return undefined;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PriceCheckBody;
    const url = clean(body.url);
    const title = clean(body.title);
    const currency = clean(body.currency) || "EUR";
    const surface =
      typeof body.surface === "number" && Number.isFinite(body.surface)
        ? body.surface
        : undefined;

    if (!url.startsWith("http")) {
      return NextResponse.json({ success: false, error: "URL invalide" }, { status: 400 });
    }

    const direct = await checkDirectPage(url, currency, surface);
    if (direct) {
      return NextResponse.json({ success: true, ...direct });
    }

    const fallback = await checkSearchFallback(url, title, currency, surface);
    if (fallback) {
      return NextResponse.json({ success: true, ...fallback });
    }

    return NextResponse.json({ success: false, price: null });
  } catch {
    return NextResponse.json({ success: false, price: null });
  }
}
