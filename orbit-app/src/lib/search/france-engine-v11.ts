import { NextRequest, NextResponse } from "next/server";
import { franceSearchProxyV10 } from "@/lib/search/france-engine-v10";
import { parseLocalizedInteger, parsePriceFromText, sanitizePropertyPrice } from "@/lib/search/price";

type Criteria = {
  city?: string;
  propertyType?: string;
  budgetMax?: number;
  budgetMin?: number;
  minSurface?: number;
  maxSurface?: number;
  minBedrooms?: number;
  minBathrooms?: number;
  sortPriority?: "best_match" | "lowest_price" | "largest";
};

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

type Source = {
  url?: string;
  title?: string;
  description?: string;
  sourceScore?: number;
};

type Payload = {
  success?: boolean;
  error?: string;
  query?: string;
  criteria?: Criteria;
  listings?: Listing[];
  sources?: Source[];
  sourceCount?: number;
  candidateCount?: number;
  [key: string]: unknown;
};

type SearxResult = {
  url?: string;
  title?: string;
  content?: string;
  thumbnail?: string;
  img_src?: string;
};

type PageIdentity = {
  title: string;
  description: string;
  textHead: string;
  price?: number;
  surface?: number;
  bedrooms?: number;
  bathrooms?: number;
  image?: string;
  sold: boolean;
};

const TARGET = 45;
const PAGE_TIMEOUT = 5000;
const SEARX_TIMEOUT = 8000;
const PORTALS = [
  "safti.fr","iadfrance.fr","orpi.com","efficity.com","proprietes-privees.com",
  "ouestfrance-immo.com","century21.fr","laforet.com","nestenn.com","human-immobilier.fr",
  "optimhome.com","capifrance.fr","guy-hoquet.com","squarehabitat.fr","fnaim.fr",
  "logic-immo.com","bienici.com","seloger.com","leboncoin.fr","3gimmobilier.com",
  "megagence.com","paruvendu.fr","avendrealouer.fr"
];

function clean(v: unknown) { return String(v ?? "").replace(/\s+/g, " ").trim(); }
function decodeHtml(v: string) {
  return v.replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;|&#34;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&sup2;/gi,"²");
}
function norm(v: unknown) {
  return decodeHtml(clean(v)).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function host(url: string) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } }
function normalizeUrl(url: string) {
  try {
    const u = new URL(url); u.hash = "";
    ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","fbclid","gclid","xtor"].forEach(k => u.searchParams.delete(k));
    return `${u.origin}${u.pathname.replace(/\/$/, "")}`;
  } catch { return url.replace(/\/$/, ""); }
}
function isPortal(url: string) {
  const h = host(url);
  return PORTALS.some(p => h === p || h.endsWith(`.${p}`));
}
function stripHtml(v: string) {
  return decodeHtml(v.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim();
}
function meta(html: string, key: string) {
  const e = key.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  return html.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${e}["'][^>]+content=["']([^"']+)["'][^>]*>`,"i"))?.[1]
    ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${e}["'][^>]*>`,"i"))?.[1];
}

function parseSurface(text: string) {
  const decoded = decodeHtml(text);
  const values: number[] = [];
  for (const m of decoded.matchAll(/(\d{2,4}(?:[.,]\d+)?)\s*(?:m²|m2|m\^2|metres? carres?)\b/gi)) {
    const n = Number(String(m[1]).replace(",", "."));
    if (!Number.isFinite(n) || n < 18 || n > 500) continue;
    const i = m.index ?? 0;
    const around = norm(decoded.slice(Math.max(0,i-70), i+120));
    if (/terrain|parcelle|jardin de|surface terrain|terrain de/.test(around)) continue;
    values.push(Math.round(n * 10) / 10);
  }
  return values[0];
}
function parseBedrooms(text: string) {
  const m = decodeHtml(text).match(/(\d{1,2})\s*(?:chambres?|chambre)\b/i);
  const n = m ? Number(m[1]) : undefined;
  return n && n <= 12 ? n : undefined;
}
function parseBathrooms(text: string) {
  const m = decodeHtml(text).match(/(\d{1,2})\s*(?:sdb|salles? de bain|salles? d'eau)\b/i);
  const n = m ? Number(m[1]) : undefined;
  return n && n <= 8 ? n : undefined;
}
function parsePrice(text: string, surface?: number) {
  const p = parsePriceFromText(decodeHtml(text), "EUR");
  if (!p.value || p.currency !== "EUR" || p.confidence === "none") return undefined;
  return sanitizePropertyPrice(p.value, "EUR", surface, p.confidence === "confirmed" ? "confirmed" : "snippet");
}
function safeImage(value: unknown, pageUrl: string) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const u = new URL(value, pageUrl).toString();
    if (!/^https?:\/\//i.test(u)) return undefined;
    if (/logo|favicon|sprite|placeholder|no[-_]?image|default|avatar|agent|agence|profil|tracking|pixel|banner|advert|cookie|map|floorplan|plan[-_]|icone|icon|portrait|facebook|twitter|linkedin/i.test(u)) return undefined;
    return u;
  } catch { return undefined; }
}
function soldMarker(text: string) {
  const q = norm(text);
  return /\b(vendu|vendue|bien vendu|sous compromis|sous offre|offre acceptee|vente realisee|annonce expiree|bien indisponible)\b/.test(q);
}
function collectionLike(url: string, title: string) {
  const t = norm(title);
  let path = ""; try { path = new URL(url).pathname.toLowerCase(); } catch { return true; }
  if (/^\d+\s+(maisons?|appartements?|annonces?|biens?)\b/.test(t)) return true;
  if (/\b(resultats?|toutes les annonces|nos biens|liste des biens)\b/.test(t)) return true;
  return /\/(recherche|search|annonces|biens|maisons|appartements)\/?$/.test(path);
}
function hardSurfaceFloor(criteria?: Criteria) {
  if (!criteria?.minSurface) return undefined;
  return Math.max(criteria.minSurface * 0.85, criteria.minSurface - 22);
}
function hardFit(surface: number | undefined, bedrooms: number | undefined, criteria?: Criteria) {
  const floor = hardSurfaceFloor(criteria);
  if (floor !== undefined) {
    if (surface === undefined || surface < floor) return false;
  }
  if (criteria?.maxSurface !== undefined && surface !== undefined && surface > criteria.maxSurface * 1.08) return false;
  if (criteria?.minBedrooms !== undefined && bedrooms !== undefined && bedrooms < Math.max(1, criteria.minBedrooms - 1)) return false;
  return true;
}
function compatible(text: string, criteria?: Criteria) {
  const q = norm(text);
  if (criteria?.propertyType === "house" && /\b(appartement|studio|duplex|loft)\b/.test(q)) return false;
  if (criteria?.propertyType === "apartment" && /\b(maison|villa|pavillon|longere)\b/.test(q)) return false;
  if (criteria?.city && !q.includes(norm(criteria.city))) return false;
  return true;
}

async function searx(q: string, page = 1): Promise<SearxResult[]> {
  const base = (process.env.SEARXNG_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
  try {
    const u = new URL(`${base}/search`);
    u.searchParams.set("q", q); u.searchParams.set("format", "json"); u.searchParams.set("language", "fr-FR"); u.searchParams.set("categories", "general"); u.searchParams.set("pageno", String(page));
    const r = await fetch(u,{cache:"no-store",headers:{Accept:"application/json"},signal:AbortSignal.timeout(SEARX_TIMEOUT)});
    if (!r.ok) return [];
    const j = await r.json() as {results?:SearxResult[]};
    return Array.isArray(j.results) ? j.results : [];
  } catch { return []; }
}

async function pageIdentity(url: string, titleHint: string): Promise<PageIdentity | null> {
  try {
    const r = await fetch(url,{
      redirect:"follow",cache:"no-store",
      headers:{"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127 Safari/537.36","Accept-Language":"fr-FR,fr;q=0.9",Accept:"text/html,application/xhtml+xml"},
      signal:AbortSignal.timeout(PAGE_TIMEOUT)
    });
    if (!r.ok) return null;
    const html = await r.text(); if (html.length < 300) return null;
    const title = decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? titleHint).replace(/\s+/g," ").trim();
    const description = decodeHtml(meta(html,"description") ?? meta(html,"og:description") ?? "");
    const textHead = stripHtml(html).slice(0,9000);
    const identityText = `${title} ${description}`;
    const surface = parseSurface(identityText) ?? parseSurface(textHead.slice(0,3500));
    const bedrooms = parseBedrooms(identityText) ?? parseBedrooms(textHead.slice(0,3500));
    const bathrooms = parseBathrooms(identityText) ?? parseBathrooms(textHead.slice(0,3500));
    let price: number | undefined;
    for (const key of ["product:price:amount","og:price:amount","property:price","price"]) {
      const raw = meta(html,key); if (!raw) continue;
      const n = parseLocalizedInteger(raw);
      const safe = sanitizePropertyPrice(n,"EUR",surface,"confirmed");
      if (safe) { price = safe; break; }
    }
    if (!price) price = parsePrice(identityText,surface);
    const image = safeImage(meta(html,"og:image") ?? meta(html,"twitter:image") ?? "",url);
    const sold = soldMarker(`${title} ${description} ${textHead.slice(0,1800)}`);
    return {title,description,textHead,price,surface,bedrooms,bathrooms,image,sold};
  } catch { return null; }
}

function revalidateExisting(listing: Listing, criteria?: Criteria): Listing | null {
  if (!listing.url || !isPortal(listing.url) || collectionLike(listing.url,listing.title)) return null;
  const titleText = decodeHtml(listing.title);
  const descText = decodeHtml(listing.description);
  if (soldMarker(`${titleText} ${descText}`)) return null;
  if (!compatible(`${titleText} ${descText} ${listing.location ?? ""}`,criteria)) return null;

  // Critical identity rule: if the exact card title contains a surface, it wins over any surface scraped elsewhere on the page.
  const titleSurface = parseSurface(titleText);
  const descriptionSurface = parseSurface(descText);
  const surface = titleSurface ?? descriptionSurface ?? listing.surface;
  const titleBeds = parseBedrooms(titleText);
  const descriptionBeds = parseBedrooms(descText);
  const bedrooms = titleBeds ?? descriptionBeds ?? listing.bedrooms;
  if (!hardFit(surface,bedrooms,criteria)) return null;
  if (!Number.isFinite(listing.price) || listing.price <= 0) return null;
  if (criteria?.budgetMin !== undefined && listing.price < criteria.budgetMin) return null;
  if (criteria?.budgetMax !== undefined && listing.price > criteria.budgetMax) return null;

  const exactPrice = parsePrice(`${titleText} ${descText}`,surface);
  if (exactPrice && Math.abs(exactPrice-listing.price) > Math.max(1500,listing.price*0.035)) return null;

  return {
    ...listing,
    title:titleText,
    description:descText,
    surface,
    bedrooms,
    pricePerM2:surface ? Math.round(listing.price/surface) : undefined,
    compromises:[...(listing.compromises ?? []).filter(x => !/Surface/i.test(x)), ...(criteria?.minSurface && surface < criteria.minSurface ? [`Surface sous l'objectif (${surface} m²)`] : [])]
  };
}

function rescueQueries(criteria: Criteria | undefined, original: string) {
  const city = criteria?.city ?? "France";
  const type = criteria?.propertyType === "apartment" ? "appartement" : "maison";
  const target = criteria?.minSurface;
  const floor = hardSurfaceFloor(criteria);
  const beds = criteria?.minBedrooms;
  const budget = criteria?.budgetMax;
  const surfaces = target ? [Math.round(target),Math.round(target*0.95),Math.round(target*1.05),Math.round(floor ?? target)] : [];
  const base = [
    original,
    `${type} à vendre ${city} ${budget?`moins de ${Math.round(budget)} €`:""}`,
    `${type} ${city} ${beds?`${beds} chambres`:""} ${budget?`${Math.round(budget)} €`:""}`,
    `${type} ${city} ${beds?`${Math.max(1,beds-1)} chambres`:""}`,
    ...surfaces.map(s=>`${type} ${city} ${s} m²`),
    ...PORTALS.map(p=>`site:${p} "${city}" ${type} ${target?`${Math.round(target)} m²`:""}`),
    ...PORTALS.slice(0,14).map(p=>`site:${p} "${city}" ${type} vente ${budget?`${Math.round(budget)} €`:""}`)
  ];
  return [...new Set(base.map(q=>q.replace(/\s+/g," ").trim()).filter(Boolean))];
}

function makeListing(result:SearxResult, page:PageIdentity, criteria?:Criteria):Listing|null {
  if (!result.url || !isPortal(result.url) || collectionLike(result.url,clean(result.title))) return null;
  const resultTitle = decodeHtml(clean(result.title));
  const resultDesc = decodeHtml(clean(result.content));
  if (page.sold || soldMarker(`${resultTitle} ${resultDesc}`)) return null;
  const identity = `${page.title} ${page.description} ${resultTitle} ${resultDesc}`;
  if (!compatible(identity,criteria)) return null;

  // Search-result title is usually the exact listing identity. Never replace an explicit 97 m² in the title with 140 m² found in related cards on the source page.
  const surface = parseSurface(resultTitle) ?? parseSurface(resultDesc) ?? page.surface;
  const bedrooms = parseBedrooms(resultTitle) ?? parseBedrooms(resultDesc) ?? page.bedrooms;
  if (!hardFit(surface,bedrooms,criteria)) return null;

  const snippetPrice = parsePrice(`${resultTitle} ${resultDesc}`,surface);
  const price = page.price ?? snippetPrice;
  if (!price) return null;
  if (criteria?.budgetMin !== undefined && price < criteria.budgetMin) return null;
  if (criteria?.budgetMax !== undefined && price > criteria.budgetMax) return null;
  if (snippetPrice && page.price && Math.abs(snippetPrice-page.price)>Math.max(1500,page.price*0.035)) return null;

  const image = page.image ?? safeImage(result.thumbnail || result.img_src || "",result.url);
  const flags = norm(identity);
  const ratio = criteria?.minSurface && surface ? surface/criteria.minSurface : 1;
  let orbitScore = 72;
  if (ratio>=1) orbitScore+=14; else if (ratio>=0.92) orbitScore+=9; else orbitScore+=5;
  if (criteria?.minBedrooms && bedrooms) orbitScore += bedrooms>=criteria.minBedrooms ? 8 : 3;
  if (image) orbitScore+=4;
  if (criteria?.budgetMax && price<=criteria.budgetMax*0.9) orbitScore+=4;
  orbitScore=Math.min(100,orbitScore);

  return {
    id:"",url:normalizeUrl(result.url),source:host(result.url),parentSource:host(result.url),title:page.title||resultTitle||"Annonce immobilière",
    description:page.description||resultDesc,price,currency:"EUR",surface,bedrooms,bathrooms:page.bathrooms,location:criteria?.city?`${criteria.city}, France`:"France",
    garden:/\bjardin\b/.test(flags),garage:/\bgarage\b/.test(flags),pool:/\bpiscine\b/.test(flags),terrace:/\bterrasse\b/.test(flags),parking:/\bparking|stationnement\b/.test(flags),
    images:image?[image]:[],propertyKind:criteria?.propertyType==="apartment"?"apartment":"existing_house",matchScore:orbitScore,valueScore:50,orbitScore,
    reasons:[],compromises:criteria?.minSurface&&surface&&surface<criteria.minSurface?[`Surface sous l'objectif (${surface} m²)`]:[],extractedAt:new Date().toISOString(),priceConfidence:"confirmed",imageConfidence:image?"confirmed":"none",pricePerM2:surface?Math.round(price/surface):undefined
  };
}

async function rescue(criteria:Criteria|undefined,original:string,existing:Listing[],sourceHints:Source[]) {
  const queries=rescueQueries(criteria,original);
  const searches=await Promise.all(queries.flatMap(q=>[1,2,3].map(page=>searx(q,page))));
  const raw:SearxResult[]=[...sourceHints.map(s=>({url:s.url,title:s.title,content:s.description})),...searches.flat()];
  const seen=new Set(existing.map(x=>normalizeUrl(x.url)));
  const byUrl=new Map<string,SearxResult>();
  for (const r of raw) {
    if (!r.url||!isPortal(r.url)||collectionLike(r.url,clean(r.title))) continue;
    const k=normalizeUrl(r.url); if (seen.has(k)||byUrl.has(k)) continue;
    byUrl.set(k,r);
  }
  const pool=[...byUrl.values()].slice(0,260);
  const output:Listing[]=[];
  for (let i=0;i<pool.length&&existing.length+output.length<TARGET;i+=12) {
    const batch=pool.slice(i,i+12);
    const checked=await Promise.allSettled(batch.map(async r=>({r,p:await pageIdentity(r.url!,clean(r.title))})));
    for (const item of checked) {
      if (item.status!=="fulfilled"||!item.value.p) continue;
      const listing=makeListing(item.value.r,item.value.p,criteria);
      if (!listing) continue;
      const k=normalizeUrl(listing.url); if (seen.has(k)) continue;
      seen.add(k); output.push(listing);
      if (existing.length+output.length>=TARGET) break;
    }
  }
  return output;
}

function sortListings(listings:Listing[],priority?:Criteria["sortPriority"]) {
  return [...listings].sort((a,b)=>{
    if (priority==="lowest_price") return a.price-b.price||b.orbitScore-a.orbitScore;
    if (priority==="largest") return (b.surface??0)-(a.surface??0)||b.orbitScore-a.orbitScore;
    return b.orbitScore-a.orbitScore||(b.surface??0)-(a.surface??0)||a.price-b.price;
  });
}

export async function franceSearchProxyV11(request:NextRequest) {
  try {
    const base=await franceSearchProxyV10(request);
    const payload=await base.json() as Payload;
    if (!base.ok||!payload.success) return NextResponse.json(payload,{status:base.status});
    const initial=(Array.isArray(payload.listings)?payload.listings:[]).map(l=>revalidateExisting(l,payload.criteria)).filter((l):l is Listing=>Boolean(l));
    const extra=initial.length<TARGET?await rescue(payload.criteria,clean(payload.query),initial,Array.isArray(payload.sources)?payload.sources:[]):[];
    const dedup=new Map<string,Listing>();
    for (const l of [...initial,...extra]) {
      const k=normalizeUrl(l.url); const prev=dedup.get(k);
      if (!prev||l.orbitScore>prev.orbitScore) dedup.set(k,l);
    }
    const merged=sortListings([...dedup.values()],payload.criteria?.sortPriority).slice(0,TARGET).map((l,i)=>({...l,id:`listing-${i+1}`}));
    return NextResponse.json({...payload,listings:merged,listingCount:merged.length,candidateCount:Math.max(Number(payload.candidateCount??0),merged.length),searchEngine:"ORBIT France FR-11 identity-safe",resultPolicy:{surfaceFloorRatio:0.85,surfaceMaxShortfallMeters:22,bedroomsTolerance:1,budgetHardLimit:true,priceRequired:true,soldListingsRejected:true,titleIdentityWins:true,target:45,pageSize:15}});
  } catch (error) {
    return NextResponse.json({success:false,error:error instanceof Error?error.message:"Erreur ORBIT France FR-11"},{status:500});
  }
}
