import { NextRequest, NextResponse } from "next/server";

type FirecrawlResult = {
  url?: string;
  title?: string;
  description?: string;
  position?: number;
  image?: string;
};

type FirecrawlResponse = {
  success?: boolean;
  data?: { web?: FirecrawlResult[] };
  error?: string;
  creditsUsed?: number;
};

type Criteria = {
  category: "real_estate";
  intent: "buy";
  propertyType?: string;
  city?: string;
  country?: string;
  location?: string;
  currency: string;
  budgetMax?: number;
  minSurface?: number;
  minBedrooms?: number;
  requirements: string[];
  preferences: string[];
  sortPriority: "best_match";
};

type Listing = {
  id: string;
  url: string;
  source: string;
  parentSource: string;
  title: string;
  description: string;
  price?: number;
  currency?: string;
  surface?: number;
  landSurface?: number;
  bedrooms?: number;
  bathrooms?: number;
  rooms?: number;
  location?: string;
  garden?: boolean;
  garage?: boolean;
  pool?: boolean;
  terrace?: boolean;
  parking?: boolean;
  dpe?: string;
  images: string[];
  pricePerM2?: number;
  propertyKind: "existing_house" | "new_build_project" | "apartment" | "villa" | "unknown";
  matchScore: number;
  valueScore: number;
  orbitScore: number;
  reasons: string[];
  compromises: string[];
  extractedAt: string;
};

const TARGET = 10;

function clean(s: unknown) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function norm(s: unknown) {
  return clean(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function host(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "web"; }
}

function parseLooseNumber(raw: string | undefined) {
  if (!raw) return undefined;
  const s = raw.replace(/[\s\u00a0]/g, "").replace(/,/g, ".");
  const n = Number(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseCriteria(query: string): Criteria {
  const q = norm(query);
  const surface = q.match(/(\d{2,4})\s*(?:m2|m²|metres? carres?|sqm)/i);
  const bedrooms = q.match(/(\d{1,2})\s*(?:chambres?|bedrooms?|beds?)/i);
  const budget = q.match(/(?:moins de|sous|budget(?: max)?|max(?:imum)?|under|below|up to)\s*([\d\s.,]+)\s*(?:€|eur|euros?)?/i)
    ?? q.match(/([\d\s.,]{4,})\s*(?:€|eur|euros?)/i);

  let city: string | undefined;
  const known = ["brest", "paris", "lyon", "marseille", "rennes", "nantes", "bordeaux", "lille", "toulouse", "nice", "londres", "london", "miami", "new york", "washington"];
  city = known.find(c => q.includes(norm(c)));
  if (city === "londres") city = "London";
  else if (city) city = city.replace(/\b\w/g, m => m.toUpperCase());

  const house = /\b(maison|maisons|house|houses|villa|villas|home|homes)\b/i.test(q);
  return {
    category: "real_estate",
    intent: "buy",
    propertyType: house ? "house" : undefined,
    city,
    country: city === "London" ? "United Kingdom" : city ? "France" : undefined,
    location: city ? `${city}${city === "London" ? ", United Kingdom" : ", France"}` : undefined,
    currency: city === "London" ? "GBP" : "EUR",
    budgetMax: parseLooseNumber(budget?.[1]),
    minSurface: surface ? Number(surface[1]) : undefined,
    minBedrooms: bedrooms ? Number(bedrooms[1]) : undefined,
    requirements: [],
    preferences: [],
    sortPriority: "best_match",
  };
}

function parsePrice(text: string) {
  const patterns = [
    /(?:€|eur)\s*([\d\s.,]{4,})/i,
    /([\d\s.,]{4,})\s*(?:€|eur|euros?)/i,
    /(?:£|gbp)\s*([\d\s.,]{4,})/i,
    /([\d\s.,]{4,})\s*(?:£|gbp)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    const n = parseLooseNumber(m?.[1]);
    if (n && n >= 10000 && n <= 100000000) return Math.round(n);
  }
  return undefined;
}

function parseSurface(text: string) {
  const m = text.match(/(\d{2,4}(?:[.,]\d+)?)\s*(?:m²|m2|sqm|sq m)\b/i);
  const n = parseLooseNumber(m?.[1]);
  return n && n >= 10 && n <= 5000 ? n : undefined;
}

function parseBedrooms(text: string) {
  const m = text.match(/(\d{1,2})\s*(?:chambres?|bedrooms?|beds?)\b/i);
  const n = m ? Number(m[1]) : undefined;
  return n && n <= 30 ? n : undefined;
}

function detectKind(text: string): Listing["propertyKind"] {
  const q = norm(text);
  if (/\b(villa|villas)\b/.test(q)) return "villa";
  if (/\b(appartement|apartment|flat|studio)\b/.test(q)) return "apartment";
  if (/\b(programme neuf|new build|new development)\b/.test(q)) return "new_build_project";
  if (/\b(maison|house|home|pavillon)\b/.test(q)) return "existing_house";
  return "unknown";
}

function locationFromText(text: string, criteria: Criteria) {
  if (criteria.city && norm(text).includes(norm(criteria.city))) return criteria.city;
  return criteria.city;
}

function score(result: FirecrawlResult, criteria: Criteria): Listing | null {
  if (!result.url) return null;
  const title = clean(result.title) || "Annonce immobilière";
  const description = clean(result.description);
  const combined = `${title} ${description}`;
  const q = norm(combined);

  const obviousBad = /\b(location vacances|vacation rental|hotel|booking|airbnb|emploi|job|actualité|news)\b/.test(q);
  if (obviousBad) return null;

  const kind = detectKind(combined);
  const price = parsePrice(combined);
  const surface = parseSurface(combined);
  const bedrooms = parseBedrooms(combined);
  const reasons: string[] = [];
  const compromises: string[] = [];
  let matchScore = 45;
  let valueScore = 50;

  if (criteria.city) {
    if (q.includes(norm(criteria.city))) { matchScore += 22; reasons.push(`Localisation ${criteria.city} détectée`); }
    else { matchScore -= 8; compromises.push(`Localisation ${criteria.city} non confirmée dans le snippet`); }
  }

  if (criteria.propertyType === "house") {
    if (kind === "existing_house" || kind === "villa" || /\bmaison\b/.test(q)) { matchScore += 18; reasons.push("Type maison détecté"); }
    else if (kind === "apartment") { matchScore -= 28; compromises.push("Semble être un appartement"); }
    else { matchScore -= 3; compromises.push("Type exact non confirmé"); }
  }

  if (criteria.minSurface) {
    if (surface !== undefined) {
      if (surface >= criteria.minSurface) { matchScore += 14; reasons.push(`Surface ${surface} m²`); }
      else {
        const gap = (criteria.minSurface - surface) / criteria.minSurface;
        if (gap <= 0.1) { matchScore += 4; compromises.push(`${surface} m², légèrement sous ${criteria.minSurface} m²`); }
        else if (gap <= 0.25) { matchScore -= 5; compromises.push(`${surface} m² sous le minimum souhaité`); }
        else { matchScore -= 14; compromises.push(`Surface nettement sous ${criteria.minSurface} m²`); }
      }
    } else { compromises.push("Surface non confirmée"); }
  }

  if (criteria.budgetMax && price !== undefined) {
    if (price <= criteria.budgetMax) { matchScore += 10; valueScore += 8; reasons.push("Dans le budget"); }
    else {
      const over = (price - criteria.budgetMax) / criteria.budgetMax;
      if (over <= .1) compromises.push("Légèrement au-dessus du budget");
      else { matchScore -= 12; compromises.push("Au-dessus du budget"); }
    }
  }

  if (criteria.minBedrooms && bedrooms !== undefined) {
    if (bedrooms >= criteria.minBedrooms) { matchScore += 8; reasons.push(`${bedrooms} chambres`); }
    else { matchScore -= 8; compromises.push("Moins de chambres que demandé"); }
  }

  const domain = host(result.url);
  if (/seloger|ouestfrance-immo|bienici|logic-immo|fnaim|lefigaro|leboncoin|orpi|century21|laforet|iadfrance|safti|properstar/.test(domain)) {
    valueScore += 8;
  }

  if (price && surface) {
    const ppm2 = Math.round(price / surface);
    if (ppm2 > 0 && ppm2 < 10000) valueScore += 4;
  }

  matchScore = Math.max(0, Math.min(100, Math.round(matchScore)));
  valueScore = Math.max(0, Math.min(100, Math.round(valueScore)));
  const orbitScore = Math.max(0, Math.min(100, Math.round(matchScore * .78 + valueScore * .22)));

  return {
    id: "",
    url: result.url,
    source: domain,
    parentSource: domain,
    title,
    description: description || "Informations disponibles depuis le résultat de recherche.",
    price,
    currency: criteria.currency,
    surface,
    bedrooms,
    location: locationFromText(combined, criteria),
    images: result.image?.startsWith("http") ? [result.image] : [],
    pricePerM2: price && surface ? Math.round(price / surface) : undefined,
    propertyKind: kind,
    matchScore,
    valueScore,
    orbitScore,
    reasons: reasons.slice(0, 8),
    compromises: compromises.slice(0, 8),
    extractedAt: new Date().toISOString(),
  };
}

async function firecrawlSearch(apiKey: string, query: string, limit = 10) {
  try {
    const response = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit, sources: ["web"] }),
      cache: "no-store",
    });
    const payload = await response.json() as FirecrawlResponse;
    if (!response.ok || !payload.success) return { results: [] as FirecrawlResult[], credits: 0 };
    return { results: payload.data?.web ?? [], credits: payload.creditsUsed ?? 0 };
  } catch {
    return { results: [] as FirecrawlResult[], credits: 0 };
  }
}

function buildQueries(original: string, criteria: Criteria) {
  const city = criteria.city ?? "";
  const area = criteria.minSurface ? `${criteria.minSurface} m2` : "";
  const type = criteria.propertyType === "house" ? "maison" : "immobilier";
  const base = [type, "à vendre", city, area].filter(Boolean).join(" ");
  const queries = [
    original,
    base,
    `${type} ${city} ${area} immobilier`,
    `site:ouestfrance-immo.com ${type} ${city} ${area}`,
    `site:seloger.com ${type} ${city} ${area}`,
    `site:bienici.com ${type} ${city} ${area}`,
    `site:leboncoin.fr ${type} ${city} ${area}`,
    `site:properstar.com ${type} ${city} ${area}`,
  ].map(clean).filter(Boolean);
  return [...new Set(queries)].slice(0, 8);
}

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname !== "/api/search" || request.method !== "POST") {
    return NextResponse.next();
  }

  try {
    const body = await request.json();
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    if (!query) return NextResponse.json({ success: false, error: "La recherche est vide." }, { status: 400 });

    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) return NextResponse.next(); // allow the route's own error handling

    const criteria = parseCriteria(query);
    const queries = buildQueries(query, criteria);
    const jobs = await Promise.all(queries.map(q => firecrawlSearch(apiKey, q, 10)));
    const creditsUsed = jobs.reduce((sum, j) => sum + j.credits, 0);

    const all = jobs.flatMap(j => j.results);
    const seen = new Set<string>();
    const unique: FirecrawlResult[] = [];
    for (const item of all) {
      if (!item.url) continue;
      let key = item.url;
      try { const u = new URL(item.url); u.hash = ""; key = `${u.origin}${u.pathname}`.replace(/\/$/, ""); } catch {}
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }

    let listings = unique.map(r => score(r, criteria)).filter((x): x is Listing => Boolean(x));

    // Keep houses first when requested, but do not hard-filter unknown types.
    if (criteria.propertyType === "house") {
      listings = listings.filter(l => l.propertyKind !== "apartment" || l.orbitScore >= 70);
    }

    listings.sort((a,b) => b.orbitScore - a.orbitScore);
    listings = listings.slice(0, TARGET).map((l,i) => ({ ...l, id: `listing-${i}` }));

    // Sources shown by the UI. Use unique ids even when the same domain appears repeatedly.
    const sources = unique.slice(0, 30).map((s,i) => ({
      id: `source-${i}`,
      title: clean(s.title) || host(s.url ?? ""),
      description: clean(s.description),
      url: s.url ?? "",
      position: s.position ?? i + 1,
      source: host(s.url ?? ""),
      sourceScore: Math.max(1, 100 - i),
    }));

    return NextResponse.json({
      success: true,
      query,
      searchQuery: queries[0] ?? query,
      criteria,
      sourceCount: sources.length,
      candidateCount: unique.length,
      listingCount: listings.length,
      analyzedCandidateCount: unique.length,
      snippetListingCount: listings.length,
      enrichedListingCount: 0,
      recoveryPoolCount: listings.length,
      verifiedListingCount: listings.length,
      targetListingCount: TARGET,
      confirmedPriceCount: listings.filter(l => typeof l.price === "number").length,
      photoCount: listings.filter(l => l.images.length > 0).length,
      creditsUsed,
      sources,
      listings,
      searchEngineVersion: "7.0-proxy-rescue",
    });
  } catch (error) {
    console.error("ORBIT proxy search error:", error);
    return NextResponse.next();
  }
}

export const config = {
  matcher: ["/api/search"],
};
