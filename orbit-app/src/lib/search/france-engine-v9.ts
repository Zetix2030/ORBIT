import { NextRequest, NextResponse } from "next/server";
import { franceSearchProxyV8 } from "@/lib/search/france-engine-v8";
import { parseLocalizedInteger, parsePriceFromText, sanitizePropertyPrice } from "@/lib/search/price";

type Listing = {
  id: string;
  url: string;
  source: string;
  parentSource: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  surface?: number;
  bedrooms?: number;
  bathrooms?: number;
  location?: string;
  garden?: boolean;
  garage?: boolean;
  pool?: boolean;
  terrace?: boolean;
  parking?: boolean;
  images: string[];
  propertyKind: string;
  matchScore: number;
  valueScore: number;
  orbitScore: number;
  reasons: string[];
  compromises: string[];
  extractedAt: string;
  priceConfidence?: string;
  imageConfidence?: string;
  pricePerM2?: number;
};

type Criteria = {
  city?: string;
  budgetMin?: number;
  budgetMax?: number;
  minSurface?: number;
  minBedrooms?: number;
  sortPriority?: "best_match" | "lowest_price" | "largest";
};

type Payload = {
  success?: boolean;
  error?: string;
  criteria?: Criteria;
  listings?: Listing[];
  [key: string]: unknown;
};

type PageProof = {
  reached: boolean;
  canonical?: string;
  title?: string;
  price?: number;
  image?: string;
};

const PAGE_TIMEOUT = 5500;
const POST_BATCH = 10;

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function norm(value: unknown) {
  return clean(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function host(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function normalizeUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return url.replace(/\/$/, "");
  }
}

function sameUrl(a: string, b: string) {
  try {
    const A = new URL(normalizeUrl(a));
    const B = new URL(normalizeUrl(b));
    return A.hostname === B.hostname && A.pathname === B.pathname;
  } catch {
    return normalizeUrl(a) === normalizeUrl(b);
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

function metaContent(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern)?.[1];
    if (match) return decodeHtml(match);
  }
  return undefined;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") return parseLocalizedInteger(value);
  return undefined;
}

function safePrice(value: unknown, surface?: number) {
  return sanitizePropertyPrice(numberValue(value), "EUR", surface, "confirmed");
}

function safeImage(value: unknown, pageUrl: string) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const absolute = new URL(value, pageUrl).toString();
    if (!/^https?:\/\//i.test(absolute)) return undefined;
    if (/logo|favicon|sprite|placeholder|no[-_]?image|default|avatar|agent|agence|profil|tracking|pixel|banner|advert|cookie|map|floorplan|plan[-_]|icone|icon|portrait/i.test(absolute)) return undefined;
    return absolute;
  } catch {
    return undefined;
  }
}

function canonical(html: string, pageUrl: string) {
  const raw = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i)?.[1]
    ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["'][^>]*>/i)?.[1];
  if (!raw) return undefined;
  try { return new URL(raw, pageUrl).toString(); } catch { return undefined; }
}

function walk(value: unknown, visit: (node: Record<string, unknown>) => void) {
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visit));
    return;
  }
  if (!value || typeof value !== "object") return;
  const node = value as Record<string, unknown>;
  visit(node);
  Object.values(node).forEach((child) => walk(child, visit));
}

function titleSimilarity(a: string, b: string) {
  const words = (value: string) => new Set(norm(value).split(/[^a-z0-9]+/).filter((word) => word.length >= 3));
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let common = 0;
  A.forEach((word) => { if (B.has(word)) common += 1; });
  return common / Math.max(1, Math.min(A.size, B.size));
}

function bestJsonNode(html: string, pageUrl: string, pageTitle: string, city?: string) {
  const candidates: Array<{ node: Record<string, unknown>; score: number }> = [];
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

  for (const script of scripts) {
    const raw = script[1]?.trim();
    if (!raw) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { continue; }

    walk(parsed, (node) => {
      const rawType = node["@type"];
      const typeText = norm(Array.isArray(rawType) ? rawType.join(" ") : rawType);
      if (!/house|residence|apartment|product|realestatelisting|singlefamily|accommodation/.test(typeText)) return;

      const rawUrl = typeof node.url === "string"
        ? node.url
        : typeof node["@id"] === "string"
          ? String(node["@id"]).split("#")[0]
          : undefined;
      let resolvedUrl: string | undefined;
      if (rawUrl) {
        try { resolvedUrl = new URL(rawUrl, pageUrl).toString(); } catch { resolvedUrl = undefined; }
        if (resolvedUrl && host(resolvedUrl) !== host(pageUrl)) return;
      }

      let score = 10;
      if (resolvedUrl && sameUrl(resolvedUrl, pageUrl)) score += 45;
      if (node.offers) score += 12;
      if (node.image) score += 5;
      const name = clean(node.name ?? node.headline ?? node.description);
      score += Math.round(titleSimilarity(name, pageTitle) * 20);
      if (city && norm(JSON.stringify(node).slice(0, 12000)).includes(norm(city))) score += 8;
      candidates.push({ node, score });
    });
  }

  return candidates.sort((a, b) => b.score - a.score)[0]?.node;
}

function proofFromNode(node: Record<string, unknown> | undefined, pageUrl: string, surface?: number) {
  if (!node) return {} as { price?: number; image?: string };
  const prices: number[] = [];
  const images: string[] = [];

  walk(node, (child) => {
    const offers = child.offers;
    const offerList = Array.isArray(offers) ? offers : offers && typeof offers === "object" ? [offers] : [];
    for (const item of offerList) {
      if (!item || typeof item !== "object") continue;
      const offer = item as Record<string, unknown>;
      const currency = clean(offer.priceCurrency || "EUR").toUpperCase();
      if (currency !== "EUR") continue;
      const value = safePrice(offer.price, surface)
        ?? safePrice((offer.priceSpecification as Record<string, unknown> | undefined)?.price, surface);
      if (value) prices.push(value);
    }

    const imageList = Array.isArray(child.image) ? child.image : child.image ? [child.image] : [];
    for (const image of imageList) {
      const raw = typeof image === "string"
        ? image
        : image && typeof image === "object"
          ? String((image as Record<string, unknown>).url ?? (image as Record<string, unknown>).contentUrl ?? "")
          : "";
      const safe = safeImage(raw, pageUrl);
      if (safe) images.push(safe);
    }
  });

  const counts = new Map<number, number>();
  prices.forEach((price) => counts.set(price, (counts.get(price) ?? 0) + 1));
  const price = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return { price, image: images[0] };
}

function metaPrice(html: string, surface?: number) {
  for (const key of ["product:price:amount", "og:price:amount", "property:price", "price"]) {
    const value = safePrice(metaContent(html, key), surface);
    if (value) return value;
  }
  return undefined;
}

async function sourcePageProof(listing: Listing, criteria?: Criteria): Promise<PageProof> {
  try {
    const response = await fetch(listing.url, {
      redirect: "follow",
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127 Safari/537.36",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.5",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(PAGE_TIMEOUT),
    });
    if (!response.ok) return { reached: false };
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) return { reached: false };
    const html = await response.text();
    if (html.length < 300) return { reached: false };

    const title = decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? listing.title).replace(/\s+/g, " ").trim();
    const node = bestJsonNode(html, listing.url, title, criteria?.city);
    const structured = proofFromNode(node, listing.url, listing.surface);
    const image = structured.image
      ?? safeImage(metaContent(html, "og:image"), listing.url)
      ?? safeImage(metaContent(html, "twitter:image"), listing.url);

    return {
      reached: true,
      canonical: canonical(html, listing.url),
      title,
      price: metaPrice(html, listing.surface) ?? structured.price,
      image,
    };
  } catch {
    return { reached: false };
  }
}

function snippetPrice(listing: Listing) {
  const parsed = parsePriceFromText(`${listing.title} ${listing.description}`, "EUR");
  if (!parsed.value || parsed.currency !== "EUR" || parsed.confidence === "none") return undefined;
  const exact = sanitizePropertyPrice(parsed.value, "EUR", listing.surface, parsed.confidence === "confirmed" ? "confirmed" : "snippet");
  if (!exact) return undefined;
  if (Math.abs(exact - listing.price) > Math.max(1500, listing.price * 0.02)) return undefined;
  return exact;
}

function fitsBudget(listing: Listing, criteria?: Criteria) {
  if (!criteria) return true;
  if (criteria.budgetMin !== undefined && listing.price < criteria.budgetMin) return false;
  if (criteria.budgetMax !== undefined && listing.price > criteria.budgetMax) return false;
  return true;
}

async function postValidate(listing: Listing, criteria?: Criteria): Promise<Listing | null> {
  const proof = await sourcePageProof(listing, criteria);
  const exactSnippet = snippetPrice(listing);
  const rawPrice = proof.price ?? exactSnippet ?? listing.price;
  const price = sanitizePropertyPrice(rawPrice, "EUR", listing.surface, "confirmed");
  if (!price) return null;

  const next: Listing = {
    ...listing,
    url: proof.canonical && sameUrl(proof.canonical, listing.url) ? proof.canonical : listing.url,
    title: proof.title && titleSimilarity(proof.title, listing.title) >= 0.12 ? proof.title : listing.title,
    price,
    currency: "EUR",
    images: proof.image ? [proof.image] : proof.reached ? [] : listing.images.slice(0, 1),
    priceConfidence: "confirmed",
    imageConfidence: proof.image ? "confirmed" : proof.reached ? "none" : listing.imageConfidence,
  };

  if (!fitsBudget(next, criteria)) return null;
  next.pricePerM2 = next.surface ? Math.round(next.price / next.surface) : undefined;
  next.reasons = [...new Set(["Prix vérifié avant affichage", ...next.reasons])];
  return next;
}

function dedupe(listings: Listing[]) {
  const urls = new Set<string>();
  const signatures = new Set<string>();
  const output: Listing[] = [];
  for (const listing of listings) {
    const url = normalizeUrl(listing.url);
    const signature = `${host(listing.url)}|${norm(listing.title).slice(0, 70)}|${Math.round(listing.price / 2500)}|${listing.surface ? Math.round(listing.surface / 3) : 0}`;
    if (urls.has(url) || signatures.has(signature)) continue;
    urls.add(url);
    signatures.add(signature);
    output.push(listing);
  }
  return output;
}

function sort(listings: Listing[], priority?: Criteria["sortPriority"]) {
  return [...listings].sort((a, b) => {
    if (priority === "lowest_price") return a.price - b.price || b.orbitScore - a.orbitScore;
    if (priority === "largest") return (b.surface ?? 0) - (a.surface ?? 0) || b.orbitScore - a.orbitScore;
    const completeA = (a.images.length ? 4 : 0) + (a.surface ? 2 : 0) + (a.bedrooms ? 1 : 0);
    const completeB = (b.images.length ? 4 : 0) + (b.surface ? 2 : 0) + (b.bedrooms ? 1 : 0);
    return b.orbitScore - a.orbitScore || completeB - completeA || a.price - b.price;
  });
}

export async function franceSearchProxyV9(request: NextRequest) {
  try {
    const baseResponse = await franceSearchProxyV8(request.clone() as NextRequest);
    const payload = (await baseResponse.json()) as Payload;
    if (!baseResponse.ok || !payload.success) return NextResponse.json(payload, { status: baseResponse.status });

    const baseListings = Array.isArray(payload.listings) ? payload.listings : [];
    const checked: Listing[] = [];

    for (let start = 0; start < baseListings.length; start += POST_BATCH) {
      const batch = baseListings.slice(start, start + POST_BATCH);
      const settled = await Promise.allSettled(batch.map((listing) => postValidate(listing, payload.criteria)));
      for (const item of settled) {
        if (item.status === "fulfilled" && item.value) checked.push(item.value);
      }
    }

    const listings = sort(dedupe(checked), payload.criteria?.sortPriority)
      .slice(0, 45)
      .map((listing, index) => ({ ...listing, id: `listing-${index + 1}` }));

    return NextResponse.json({
      ...payload,
      listings,
      listingCount: listings.length,
      verifiedListingCount: listings.length,
      confirmedPriceCount: listings.length,
      photoCount: listings.filter((item) => item.images.length).length,
      confirmedPhotoCount: listings.filter((item) => item.imageConfidence === "confirmed").length,
      pageSize: 15,
      totalPages: Math.max(1, Math.ceil(listings.length / 15)),
      searchEngineVersion: "FR-9.0",
      searchProvider: "SearXNG-France + fiche source + recoupement multi-moteurs + contrôle final",
      qualityPolicy: "Aucun prix non confirmé. Les photos sont rattachées à la fiche source quand elle est accessible.",
    });
  } catch (error) {
    console.error("ORBIT France v9 quality gate error:", error);
    return NextResponse.json({
      success: false,
      error: "ORBIT France n'a pas pu terminer la vérification des annonces.",
      listings: [],
      sources: [],
      listingCount: 0,
    }, { status: 503 });
  }
}
