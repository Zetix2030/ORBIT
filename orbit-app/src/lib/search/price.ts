export type ParsedPrice = {
  value?: number;
  currency?: string;
  confidence: "confirmed" | "snippet" | "none";
};

const SPECIFIC_CURRENCY_MARKERS: Array<{ currency: string; pattern: RegExp }> = [
  { currency: "CAD", pattern: /(?:C\$|CAD)/i },
  { currency: "AUD", pattern: /(?:A\$|AUD)/i },
  { currency: "MXN", pattern: /(?:MXN|MX\$)/i },
  { currency: "BRL", pattern: /(?:BRL|R\$)/i },
  { currency: "USD", pattern: /(?:US\$|USD)/i },
  { currency: "EUR", pattern: /(?:EUR|€)/i },
  { currency: "GBP", pattern: /(?:GBP|£)/i },
  { currency: "CHF", pattern: /CHF/i },
  { currency: "AED", pattern: /(?:AED|د\.إ)/i },
  { currency: "JPY", pattern: /(?:JPY|¥)/i },
  { currency: "CNY", pattern: /(?:CNY|RMB|CN¥)/i },
  { currency: "INR", pattern: /(?:INR|₹)/i },
];

function normalizeSpaces(value: string) {
  return value.replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ").trim();
}

/*
 * Some real-estate pages render values like:
 *   "$1,489,000 4 beds"
 * or structured data can be flattened to:
 *   "1489000 4"
 *
 * Older parsing removed every space and could turn that into 14,890,004.
 * We only accept spaces as thousands separators when every following group
 * contains exactly three digits. Otherwise the first numeric token wins.
 */
function isolateAmount(raw: string) {
  let value = normalizeSpaces(raw).replace(/[’']/g, "").trim();

  const digitSpace = value.match(/^([0-9][0-9.,]*)(?:\s+)(\d.*)$/);
  if (digitSpace) {
    const groups = value.split(/\s+/);
    const validThousands =
      groups.length > 1 &&
      /^\d{1,3}$/.test(groups[0] ?? "") &&
      groups.slice(1).every((group) => /^\d{3}$/.test(group));

    if (!validThousands) {
      value = digitSpace[1] ?? value;
    }
  }

  return value;
}

export function parseLocalizedInteger(raw: string): number | undefined {
  let s = isolateAmount(raw);
  if (!s) return undefined;

  const suffix = s.match(/([kmb])$/i)?.[1]?.toLowerCase();
  if (suffix) s = s.slice(0, -1).trim();
  s = s.replace(/[^\d.,\s]/g, "").trim();
  if (!s) return undefined;

  // Spaces are valid only as proper thousands grouping at this point.
  if (/\s/.test(s)) {
    const groups = s.split(/\s+/);
    if (/^\d{1,3}$/.test(groups[0] ?? "") && groups.slice(1).every((group) => /^\d{3}$/.test(group))) {
      s = groups.join("");
    } else {
      s = groups[0] ?? s;
    }
  }

  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");

  if (suffix) {
    const sep = Math.max(comma, dot);
    if (sep >= 0) {
      const whole = s.slice(0, sep).replace(/[.,]/g, "");
      const frac = s.slice(sep + 1).replace(/[.,]/g, "");
      s = frac ? `${whole}.${frac}` : whole;
    } else s = s.replace(/[.,]/g, "");
  } else if (comma >= 0 && dot >= 0) {
    const last = Math.max(comma, dot);
    const decimals = s.length - last - 1;
    s = decimals === 2
      ? `${s.slice(0, last).replace(/[.,]/g, "")}.${s.slice(last + 1)}`
      : s.replace(/[.,]/g, "");
  } else if (comma >= 0 || dot >= 0) {
    const sep = comma >= 0 ? "," : ".";
    const parts = s.split(sep);
    if (parts.length > 2) s = parts.join("");
    else {
      const decimals = parts[1]?.length ?? 0;
      if (decimals === 3) s = parts.join("");
      else if (decimals === 2 && Number(parts[0]) < 1000) s = `${parts[0]}.${parts[1]}`;
      else s = parts.join("");
    }
  }

  let value = Number(s);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  if (suffix === "k") value *= 1_000;
  if (suffix === "m") value *= 1_000_000;
  if (suffix === "b") value *= 1_000_000_000;
  value = Math.round(value);
  return value > 0 ? value : undefined;
}

function currencyFromContext(text: string, fallback?: string) {
  for (const marker of SPECIFIC_CURRENCY_MARKERS) {
    if (marker.pattern.test(text)) return marker.currency;
  }
  if (/\$/.test(text)) {
    if (["USD", "CAD", "AUD", "MXN"].includes(fallback ?? "")) return fallback;
    return "USD";
  }
  return fallback;
}

function recurringCharge(context: string) {
  return /(?:\/\s*(?:mo|month|mois)|per\s+month|monthly|par\s+mois|mensuel|rent\s+per|mortgage|hoa|tax(?:es)?|insurance|deposit|charges?)/i.test(context);
}

function unitPrice(context: string) {
  return /(?:per\s+(?:sq\.?\s*ft|sqm|m2|m²)|\/\s*(?:sq\.?\s*ft|sqm|m2|m²)|price\s+per|prix\s+au\s+m)/i.test(context);
}

type Candidate = { value: number; currency?: string; index: number; score: number };

function candidateScore(context: string, value: number) {
  let score = 0;
  if (/\b(asking price|listing price|sale price|listed at|for sale|price|prix|à vendre|a vendre|purchase|buy|acheter)\b/i.test(context)) score += 9;
  if (/\b(property|house|home|maison|villa|apartment|appartement|condo|real estate|immobilier)\b/i.test(context)) score += 4;
  if (recurringCharge(context)) score -= 22;
  if (unitPrice(context)) score -= 18;
  if (/\b(mls|listing id|property id|reference|ref\.?|zpid|parcel|apn)\b/i.test(context)) score -= 16;
  if (value < 40_000) score -= 8;
  if (value >= 80_000 && value <= 15_000_000) score += 3;
  if (value > 25_000_000) score -= 10;
  return score;
}

function collectCandidates(text: string, fallbackCurrency?: string) {
  const token = String.raw`(?:\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d{4,9}|\d{1,3}(?:[.,]\d{1,2})?\s*[kKmM])`;
  const currency = String.raw`(?:US\$|C\$|A\$|MX\$|R\$|\$|€|£|¥|₹|CHF|USD|EUR|GBP|CAD|AUD|AED|JPY|CNY|RMB|INR|BRL|MXN)`;
  const regexes = [
    new RegExp(`(${currency})\\s*(${token})`, "gi"),
    new RegExp(`(${token})\\s*(${currency})`, "gi"),
  ];

  const output: Candidate[] = [];
  for (const regex of regexes) {
    for (const match of text.matchAll(regex)) {
      const amountRaw = match[2] && /\d/.test(match[2]) ? match[2] : match[1];
      const markerRaw = amountRaw === match[2] ? match[1] : match[2];
      const value = parseLocalizedInteger(amountRaw);
      if (!value || value < 20_000 || value > 250_000_000) continue;
      const index = match.index ?? 0;
      const context = text.slice(Math.max(0, index - 100), Math.min(text.length, index + match[0].length + 120));
      output.push({
        value,
        currency: currencyFromContext(markerRaw, fallbackCurrency),
        index,
        score: candidateScore(context, value) + 5,
      });
    }
  }

  const phrase = /(?:asking price|listing price|sale price|listed at|for sale at|price|prix|à vendre à|a vendre a)\s*[:\-]?\s*(\d{1,3}(?:[.,]\d{3})+|\d{4,9}|\d{1,3}(?:[.,]\d{1,2})?\s*[kKmM])/gi;
  for (const match of text.matchAll(phrase)) {
    const value = parseLocalizedInteger(match[1] ?? "");
    if (!value || value < 20_000 || value > 250_000_000) continue;
    const index = match.index ?? 0;
    const context = text.slice(Math.max(0, index - 100), Math.min(text.length, index + match[0].length + 120));
    output.push({ value, currency: fallbackCurrency, index, score: candidateScore(context, value) + 8 });
  }

  return output.sort((a, b) => b.score - a.score || a.index - b.index);
}

export function parsePriceFromText(text: string, fallbackCurrency?: string): ParsedPrice {
  const normalized = normalizeSpaces(text);
  const best = collectCandidates(normalized, fallbackCurrency)[0];
  if (!best || best.score < 2) return { confidence: "none", currency: fallbackCurrency };
  return {
    value: best.value,
    currency: best.currency ?? fallbackCurrency,
    confidence: best.score >= 12 ? "confirmed" : "snippet",
  };
}

export function sanitizePropertyPrice(
  value: number | undefined,
  currency: string | undefined,
  surface?: number,
  confidence: ParsedPrice["confidence"] = "none",
): number | undefined {
  if (!value || !Number.isFinite(value)) return undefined;
  if (value < 20_000 || value > 250_000_000) return undefined;

  /*
   * Guard against the exact corruption previously seen in ORBIT:
   * a bedroom/bathroom digit appended to a valid integer price.
   * Examples: 1,489,000 + "4 beds" => 14,890,004.
   * These values almost always end in a tiny 1-2 digit suffix while the
   * preceding value divided by ten is a normal listing price.
   */
  const tail = value % 1000;
  if (value >= 1_000_000 && tail > 0 && tail <= 20) {
    const repaired = Math.floor(value / 10);
    if (repaired >= 80_000 && repaired <= 25_000_000) {
      value = repaired;
    }
  }

  const ceiling: Record<string, number> = {
    EUR: 30_000_000,
    GBP: 30_000_000,
    USD: 35_000_000,
    CAD: 45_000_000,
    AUD: 45_000_000,
    CHF: 35_000_000,
    AED: 220_000_000,
  };
  if (value > (ceiling[currency ?? ""] ?? 40_000_000) && confidence !== "confirmed") return undefined;

  if (surface && surface >= 20) {
    const ppm2 = value / surface;
    const maxPpm2: Record<string, number> = {
      EUR: 80_000,
      GBP: 100_000,
      USD: 100_000,
      CAD: 100_000,
      AUD: 100_000,
      CHF: 120_000,
      AED: 150_000,
      JPY: 20_000_000,
    };
    const minPpm2 = currency === "JPY" ? 3_000 : 100;
    if (ppm2 > (maxPpm2[currency ?? ""] ?? 100_000) || ppm2 < minPpm2) return undefined;
  }

  return Math.round(value);
}
