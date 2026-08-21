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
  { currency: "CHF", pattern: /(?:CHF)/i },
  { currency: "AED", pattern: /(?:AED|د\.إ)/i },
  { currency: "JPY", pattern: /(?:JPY|¥)/i },
  { currency: "CNY", pattern: /(?:CNY|RMB|CN¥)/i },
  { currency: "INR", pattern: /(?:INR|₹)/i },
];

function normalizeSpaces(value: string) {
  return value.replace(/[\u00a0\u202f]/g, " ").trim();
}

export function parseLocalizedInteger(raw: string): number | undefined {
  let s = normalizeSpaces(raw)
    .replace(/[’']/g, "")
    .replace(/\s+/g, "")
    .trim();

  if (!s) return undefined;

  const suffix = s.match(/([kmb])$/i)?.[1]?.toLowerCase();
  if (suffix) s = s.slice(0, -1);

  s = s.replace(/[^\d.,]/g, "");
  if (!s) return undefined;

  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");

  if (suffix) {
    const decimalSep = Math.max(comma, dot);
    if (decimalSep >= 0) {
      const integerPart = s.slice(0, decimalSep).replace(/[.,]/g, "");
      const fractional = s.slice(decimalSep + 1).replace(/[.,]/g, "");
      s = `${integerPart}.${fractional}`;
    } else {
      s = s.replace(/[.,]/g, "");
    }
  } else if (comma >= 0 && dot >= 0) {
    const decimalIndex = Math.max(comma, dot);
    const decimalDigits = s.length - decimalIndex - 1;
    if (decimalDigits === 2) {
      const whole = s.slice(0, decimalIndex).replace(/[.,]/g, "");
      s = `${whole}.${s.slice(decimalIndex + 1)}`;
    } else {
      s = s.replace(/[.,]/g, "");
    }
  } else if (comma >= 0 || dot >= 0) {
    const sep = comma >= 0 ? "," : ".";
    const parts = s.split(sep);
    if (parts.length > 2) {
      s = parts.join("");
    } else {
      const fractionLength = parts[1]?.length ?? 0;
      if (fractionLength === 3) s = parts.join("");
      else if (fractionLength === 2) s = `${parts[0]}.${parts[1]}`;
      else if (suffix && fractionLength <= 2) s = `${parts[0]}.${parts[1]}`;
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

export function parsePriceFromText(text: string, fallbackCurrency?: string): ParsedPrice {
  const normalized = normalizeSpaces(text);

  const explicitPatterns = [
    /(?:US\$|C\$|A\$|MX\$|R\$|\$|€|£|¥|₹|CHF|USD|EUR|GBP|CAD|AUD|AED|JPY|CNY|RMB|INR|BRL|MXN)\s*([0-9][0-9\s.,’']*(?:\s*[kmb])?)/i,
    /([0-9][0-9\s.,’']*(?:\s*[kmb])?)\s*(?:US\$|C\$|A\$|MX\$|R\$|\$|€|£|¥|₹|CHF|USD|EUR|GBP|CAD|AUD|AED|JPY|CNY|RMB|INR|BRL|MXN)/i,
  ];

  for (const pattern of explicitPatterns) {
    const match = normalized.match(pattern);
    if (!match?.[1]) continue;
    const value = parseLocalizedInteger(match[1]);
    if (!value || value < 20_000 || value > 250_000_000) continue;

    return {
      value,
      currency: currencyFromContext(match[0], fallbackCurrency),
      confidence: "confirmed",
    };
  }

  const phrase = normalized.match(
    /(?:price|prix|asking price|listed at|for sale at|à vendre à|a vendre a)\s*[:\-]?\s*([0-9][0-9\s.,’']*(?:\s*[kmb])?)/i,
  );
  if (phrase?.[1]) {
    const value = parseLocalizedInteger(phrase[1]);
    if (value && value >= 20_000 && value <= 250_000_000) {
      return { value, currency: fallbackCurrency, confidence: "snippet" };
    }
  }

  return { confidence: "none", currency: fallbackCurrency };
}

export function sanitizePropertyPrice(
  value: number | undefined,
  currency: string | undefined,
  surface?: number,
): number | undefined {
  if (!value || !Number.isFinite(value)) return undefined;
  if (value < 20_000 || value > 250_000_000) return undefined;

  if (surface && surface > 10) {
    const pricePerM2 = value / surface;
    const upper = currency === "JPY" ? 20_000_000 : 150_000;
    if (pricePerM2 > upper) return undefined;
  }

  return Math.round(value);
}
