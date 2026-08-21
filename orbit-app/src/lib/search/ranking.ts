export type OrbitSearchMode = "strict" | "balanced" | "broad";

type AnyObject = Record<string, unknown>;

export type OrbitRankedListing<T extends AnyObject> = T & {
  orbitRelaxedScore: number;
  orbitSearchTier: "exact" | "close" | "extended";
  orbitOutsideCriteria: boolean;
  orbitDeviations: string[];
};

function text(value: unknown): string {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function numberFrom(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
    if (typeof value === "string") {
      const cleaned = value.replace(/\s/g, "").replace(",", ".").replace(/[^\d.-]/g, "");
      const parsed = Number(cleaned);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return null;
}

function getCriteria(criteria: AnyObject) {
  return {
    location: text(criteria.location ?? criteria.city ?? criteria.place ?? criteria.destination),
    type: text(criteria.propertyType ?? criteria.type ?? criteria.assetType),
    maxPrice: numberFrom(criteria.maxPrice, criteria.budgetMax, criteria.maxBudget, criteria.maximumBudget, criteria.budget),
    minSurface: numberFrom(criteria.minSurface, criteria.minimumSurface, criteria.surfaceMin, criteria.minArea),
    minBedrooms: numberFrom(criteria.minBedrooms, criteria.minimumBedrooms, criteria.bedroomsMin),
  };
}

function getListing(listing: AnyObject) {
  const details = typeof listing.details === "object" && listing.details !== null ? listing.details as AnyObject : {};
  const metadata = typeof listing.metadata === "object" && listing.metadata !== null ? listing.metadata as AnyObject : {};
  return {
    haystack: text([listing.title, listing.description, listing.address, listing.location, listing.city, listing.country, listing.propertyType, listing.type, metadata.title, metadata.location, details.address, details.city].filter(Boolean).join(" ")),
    type: text(listing.propertyType ?? listing.type ?? listing.propertyKind ?? details.propertyType),
    price: numberFrom(listing.price, listing.priceValue, listing.amount, details.price, metadata.price),
    surface: numberFrom(listing.surface, listing.area, listing.livingArea, listing.squareMeters, details.surface, details.area),
    bedrooms: numberFrom(listing.bedrooms, listing.beds, details.bedrooms, details.beds),
  };
}

function deviationPercent(actual: number, target: number) { return target ? Math.abs(actual - target) / Math.abs(target) : 0; }

function propertyTypeMatches(wanted: string, actual: string) {
  if (!wanted || !actual) return true;
  const house = ["house", "maison", "villa", "townhouse", "terraced", "detached", "home", "existing_house"];
  const apartment = ["apartment", "appartement", "flat", "condo"];
  if (actual.includes(wanted) || wanted.includes(actual)) return true;
  return (house.some(x => wanted.includes(x)) && house.some(x => actual.includes(x))) || (apartment.some(x => wanted.includes(x)) && apartment.some(x => actual.includes(x)));
}

export function orbitRelaxedRank<T extends AnyObject>(listing: T, rawCriteria: AnyObject): OrbitRankedListing<T> {
  const criteria = getCriteria(rawCriteria);
  const item = getListing(listing);
  let score = 50;
  const deviations: string[] = [];

  if (criteria.location) {
    const tokens = criteria.location.split(/\s+/).filter(x => x.length >= 3);
    const matches = tokens.filter(x => item.haystack.includes(x)).length;
    if (item.haystack.includes(criteria.location) || matches >= Math.max(1, Math.ceil(tokens.length * 0.5))) score += 22;
    else { score -= 18; deviations.push("Localisation différente ou non confirmée"); }
  }
  if (criteria.type) {
    if (propertyTypeMatches(criteria.type, item.type || item.haystack)) score += 10;
    else { score -= 10; deviations.push("Type de bien différent"); }
  }
  if (criteria.maxPrice != null && item.price != null) {
    if (item.price <= criteria.maxPrice) score += 12;
    else {
      const d = deviationPercent(item.price, criteria.maxPrice);
      if (d <= .05) { score += 5; deviations.push(`Budget dépassé de ${Math.round(d*100)} %`); }
      else if (d <= .15) { score -= 2; deviations.push(`Budget dépassé de ${Math.round(d*100)} %`); }
      else if (d <= .30) { score -= 12; deviations.push(`Budget dépassé de ${Math.round(d*100)} %`); }
      else { score -= 28; deviations.push("Budget largement dépassé"); }
    }
  }
  if (criteria.minSurface != null && item.surface != null) {
    if (item.surface >= criteria.minSurface) score += 12;
    else {
      const d = deviationPercent(item.surface, criteria.minSurface);
      if (d <= .05) { score += 6; deviations.push(`Surface inférieure de ${Math.round(d*100)} %`); }
      else if (d <= .12) { score += 1; deviations.push(`Surface inférieure de ${Math.round(d*100)} %`); }
      else if (d <= .25) { score -= 9; deviations.push(`Surface inférieure de ${Math.round(d*100)} %`); }
      else { score -= 24; deviations.push("Surface largement inférieure"); }
    }
  }
  if (criteria.minBedrooms != null && item.bedrooms != null) {
    if (item.bedrooms >= criteria.minBedrooms) score += 8;
    else if (item.bedrooms === criteria.minBedrooms - 1) { score -= 3; deviations.push("Une chambre de moins"); }
    else { score -= 14; deviations.push("Nombre de chambres inférieur"); }
  }

  // Missing fields are uncertainty, not automatic rejection. This is critical for
  // search-snippet candidates where portals often hide price/area until scraping.
  const knownCoreFields = [item.price, item.surface, item.bedrooms].filter(v => v != null).length;
  if (knownCoreFields === 0) score -= 8;
  else if (knownCoreFields === 1) score -= 3;

  score = Math.max(0, Math.min(100, Math.round(score)));
  const exact = deviations.length === 0;
  const tier: "exact" | "close" | "extended" = exact ? "exact" : score >= 48 ? "close" : "extended";
  return {...listing, orbitRelaxedScore: score, orbitSearchTier: tier, orbitOutsideCriteria: !exact, orbitDeviations: deviations};
}

export function orbitRelaxedFallback<T extends AnyObject>(currentResults: T[], candidates: T[], criteria: AnyObject, target = 10, mode: OrbitSearchMode = "balanced"): T[] {
  const ranked = candidates.map(listing => orbitRelaxedRank(listing, criteria)).sort((a,b) => b.orbitRelaxedScore-a.orbitRelaxedScore);
  if (mode === "strict") return currentResults.slice(0,target);
  // Balanced must rescue useful candidates instead of returning zero merely because
  // extraction was incomplete. Broad remains the final safety net.
  const minimumScore = mode === "broad" ? 12 : 22;
  const output:T[] = [...currentResults];
  const seen = new Set<string>();
  const key = (value:AnyObject) => String(value.url ?? value.sourceURL ?? value.id ?? value.title ?? JSON.stringify(value).slice(0,200));
  for (const item of output) seen.add(key(item));
  for (const rankedItem of ranked) {
    if (output.length >= target) break;
    if (rankedItem.orbitRelaxedScore < minimumScore) continue;
    const itemKey=key(rankedItem);
    if (seen.has(itemKey)) continue;
    seen.add(itemKey); output.push(rankedItem as T);
  }
  // Last-resort availability guarantee: if candidates exist, ORBIT should expose the
  // best ones rather than claim there are no results. They stay marked as relaxed.
  if (output.length === 0 && ranked.length > 0 && mode !== "strict") {
    for (const item of ranked.slice(0,target)) output.push(item as T);
  }
  return output.slice(0,target);
}
