import { NextRequest, NextResponse } from "next/server";
import { proxy as freeSearchProxy } from "@/proxy";
import { detectLocationWithAI } from "@/lib/search/location";
import { parsePriceFromText, sanitizePropertyPrice } from "@/lib/search/price";

type SearchHit = {
  url: string;
  title: string;
  description: string;
  source: string;
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function norm(value: unknown) {
  return clean(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "web";
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

function stripTags(value: string) {
  return clean(decodeHtml(value.replace(/<[^>]+>/g, " ")));
}

function extractSurface(text: string) {
  const metric = text.match(/(\d{2,4}(?:[.,]\d+)?)\s*(?:m²|m2|sqm|sq\s*m)\b/i);
  if (metric) {
    const value = Number(metric[1]?.replace(",", "."));
    if (Number.isFinite(value) && value >= 10 && value <= 1200) return Math.round(value * 10) / 10;
  }

  const imperial = text.match(/([\d,]{3,7})\s*(?:sq\.?\s*ft|square\s*feet|sqft)\b/i);
  if (imperial) {
    const sqft = Number((imperial[1] ?? "").replace(/,/g, ""));
    const value = sqft * 0.092903;
    if (Number.isFinite(value) && value >= 10 && value <= 1200) return Math.round(value * 10) / 10;
  }

  return undefined;
}

function extractBedrooms(text: string) {
  const match = text.match(/(\d{1,2})\s*(?:bedrooms?|beds?|chambres?)\b/i);
  const value = match ? Number(match[1]) : undefined;
  return value && value <= 20 ? value : undefined;
}

function extractBathrooms(text: string) {
  const match = text.match(/(\d{1,2})\s*(?:bathrooms?|baths?|salles? de bain|sdb)\b/i);
  const value = match ? Number(match[1]) : undefined;
  return value && value <= 15 ? value : undefined;
}

function detectKind(text: string) {
  const q = norm(text);
  if (/\b(villa|villas)\b/.test(q)) return "villa" as const;
  if (/\b(appartement|apartment|flat|studio|condo|condominium)\b/.test(q)) return "apartment" as const;
  if (/\b(programme neuf|new build|new development)\b/.test(q)) return "new_build_project" as const;
  if (/\b(maison|house|home|pavillon|detached|townhouse|haus|casa|huis)\b/.test(q)) return "existing_house" as const;
  return "unknown" as const;
}

function dedupe(hits: SearchHit[]) {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    let key = hit.url;
    try {
      const u = new URL(hit.url);
      u.hash = "";
      u.searchParams.delete("utm_source");
      u.searchParams.delete("utm_medium");
      u.searchParams.delete("utm_campaign");
      key = `${u.origin}${u.pathname}`.replace(/\/$/, "");
    } catch {}
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function bingSearch(query: string): Promise<SearchHit[]> {
  try {
    const url = `https://www.bing.com/search?${new URLSearchParams({ q: query, count: "20" })}`;
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(6500),
    });
    if (!response.ok) return [];
    const html = await response.text();
    const blocks = [...html.matchAll(/<li[^>]+class=["'][^"']*b_algo[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi)];
    const output: SearchHit[] = [];
    for (const block of blocks) {
      const body = block[1] ?? "";
      const link = body.match(/<h2[^>]*>\s*<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
      if (!link?.[1]) continue;
      const href = decodeHtml(link[1]);
      if (!/^https?:\/\//i.test(href)) continue;
      const description = stripTags(body.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "");
      output.push({ url: href, title: stripTags(link[2] ?? ""), description, source: "Bing" });
    }
    return output;
  } catch {
    return [];
  }
}

async function braveSearch(query: string): Promise<SearchHit[]> {
  try {
    const url = `https://search.brave.com/search?${new URLSearchParams({ q: query, source: "web" })}`;
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(6500),
    });
    if (!response.ok) return [];
    const html = await response.text();
    const output: SearchHit[] = [];
    const links = [...html.matchAll(/<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    for (const match of links) {
      const href = decodeHtml(match[1] ?? "");
      const title = stripTags(match[2] ?? "");
      if (!href || title.length < 8 || /search\.brave\.com|javascript:/i.test(href)) continue;
      output.push({ url: href, title, description: "", source: "Brave" });
      if (output.length >= 20) break;
    }
    return output;
  } catch {
    return [];
  }
}

function buildFallbackQueries(query: string, city?: string, country?: string) {
  const location = [city, country].filter(Boolean).join(" ");
  const base = [location, "house for sale real estate"].filter(Boolean).join(" ");
  const portals = country === "United States"
    ? ["site:realtor.com", "site:zillow.com", "site:redfin.com", "site:homes.com"]
    : [];
  return [...new Set([query, base, ...portals.map((portal) => `${portal} ${base}`)])].filter(Boolean).slice(0, 6);
}

async function emergencyFreeSearch(query: string) {
  const location = await detectLocationWithAI(query, process.env.OPENAI_API_KEY);
  const currency = location.currency ?? "EUR";
  const queries = buildFallbackQueries(query, location.city, location.country);

  const jobs = await Promise.all(
    queries.map(async (searchQuery) => {
      const [bing, brave] = await Promise.all([bingSearch(searchQuery), braveSearch(searchQuery)]);
      return [...bing, ...brave];
    }),
  );

  let hits = dedupe(jobs.flat());
  const cityToken = norm(location.city);
  hits = hits.filter((hit) => {
    const text = norm(`${hit.title} ${hit.description} ${hit.url}`);
    if (/\b(hotel|vacation rental|airbnb|booking|job|emploi|rent per month|for rent)\b/i.test(text)) return false;
    const property = /\b(house|home|villa|property|real estate|maison|immobilier|condo|apartment|for sale|à vendre|a vendre)\b/i.test(text);
    if (!property) return false;
    if (cityToken && text.includes(cityToken)) return true;
    return true;
  });

  const listings = hits
    .map((hit) => {
      const combined = `${hit.title} ${hit.description}`;
      const surface = extractSurface(combined);
      const parsed = parsePriceFromText(combined, currency);
      const price = sanitizePropertyPrice(parsed.value, parsed.currency ?? currency, surface, parsed.confidence);
      const bedrooms = extractBedrooms(combined);
      const bathrooms = extractBathrooms(combined);
      const kind = detectKind(combined);
      let score = 50;
      const reasons: string[] = [];
      const compromises: string[] = [];
      if (cityToken && norm(combined).includes(cityToken)) { score += 24; reasons.push(`${location.city} détecté`); }
      else if (cityToken) { score -= 8; compromises.push(`${location.city} non confirmé dans l'extrait`); }
      if (kind === "existing_house" || kind === "villa") { score += 12; reasons.push("Type maison détecté"); }
      if (price !== undefined) { score += parsed.confidence === "confirmed" ? 12 : 6; reasons.push("Prix détecté"); }
      else compromises.push("Prix à vérifier sur l'annonce source");
      if (surface !== undefined) score += 7;
      score = Math.max(0, Math.min(100, score));
      return {
        id: "",
        url: hit.url,
        source: host(hit.url),
        parentSource: host(hit.url),
        title: hit.title || "Annonce immobilière",
        description: hit.description || "Résultat immobilier trouvé par le moteur de secours gratuit.",
        price,
        currency: parsed.currency ?? currency,
        surface,
        bedrooms,
        bathrooms,
        location: [location.city, location.country].filter(Boolean).join(", ") || undefined,
        garden: /\b(garden|jardin|yard)\b/i.test(combined),
        garage: /\bgarage\b/i.test(combined),
        pool: /\b(pool|piscine|swimming pool)\b/i.test(combined),
        terrace: /\b(terrace|terrasse|patio)\b/i.test(combined),
        parking: /\b(parking|carport|driveway)\b/i.test(combined),
        images: [],
        pricePerM2: price && surface ? Math.round(price / surface) : undefined,
        propertyKind: kind,
        matchScore: score,
        valueScore: price !== undefined ? 62 : 48,
        orbitScore: Math.round(score * 0.8 + (price !== undefined ? 62 : 48) * 0.2),
        reasons,
        compromises,
        extractedAt: new Date().toISOString(),
      };
    })
    .sort((a, b) => b.orbitScore - a.orbitScore)
    .slice(0, 10)
    .map((listing, index) => ({ ...listing, id: `listing-${index}` }));

  const sources = hits.slice(0, 40).map((hit, index) => ({
    id: `source-${index}`,
    title: hit.title,
    description: hit.description,
    url: hit.url,
    position: index + 1,
    source: host(hit.url),
    sourceScore: Math.max(1, 100 - index),
  }));

  return NextResponse.json({
    success: true,
    query,
    searchQuery: queries.join(" || "),
    criteria: {
      category: "real_estate",
      intent: "buy",
      propertyType: /\b(villa|maison|house|home)\b/i.test(query) ? "house" : undefined,
      city: location.city,
      country: location.country,
      location: [location.city, location.country].filter(Boolean).join(", ") || undefined,
      currency,
      requirements: [],
      preferences: [],
      sortPriority: "best_match",
    },
    sourceCount: sources.length,
    candidateCount: hits.length,
    listingCount: listings.length,
    creditsUsed: null,
    sources,
    listings,
    searchProvider: "Bing + Brave (free fallback)",
    warning: listings.length === 0 ? "Aucun moteur gratuit n'a renvoyé d'annonce exploitable pour cette recherche." : undefined,
  });
}

export async function POST(request: NextRequest) {
  const fallbackRequest = request.clone();
  const response = await freeSearchProxy(request);

  if (response.headers.get("x-middleware-next") !== "1") {
    return response;
  }

  try {
    const body = await fallbackRequest.json();
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    if (!query) {
      return NextResponse.json({ success: false, error: "La recherche est vide." }, { status: 400 });
    }
    return await emergencyFreeSearch(query);
  } catch {
    return NextResponse.json({
      success: true,
      query: "",
      sourceCount: 0,
      candidateCount: 0,
      listingCount: 0,
      creditsUsed: null,
      sources: [],
      listings: [],
      searchProvider: "Free search fallback",
      warning: "Recherche gratuite momentanément limitée, sans erreur bloquante.",
    });
  }
}
