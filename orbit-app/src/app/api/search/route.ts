import { NextRequest, NextResponse } from "next/server";

type FirecrawlSearchResult = {
  url?: string;
  title?: string;
  description?: string;
  position?: number;
};

type FirecrawlResponse = {
  success?: boolean;
  data?: {
    web?: FirecrawlSearchResult[];
  };
  error?: string;
  creditsUsed?: number;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const query =
      typeof body?.query === "string" ? body.query.trim() : "";

    if (!query) {
      return NextResponse.json(
        {
          success: false,
          error: "La recherche est vide.",
        },
        { status: 400 },
      );
    }

    const apiKey = process.env.FIRECRAWL_API_KEY;

    if (!apiKey) {
      console.error("FIRECRAWL_API_KEY is missing.");

      return NextResponse.json(
        {
          success: false,
          error: "La clé Firecrawl n'est pas configurée.",
        },
        { status: 500 },
      );
    }

    const response = await fetch(
      "https://api.firecrawl.dev/v2/search",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          limit: 10,
          sources: ["web"],
        }),
        cache: "no-store",
      },
    );

    const payload = (await response.json()) as FirecrawlResponse;

    if (!response.ok || !payload.success) {
      console.error("Firecrawl response error:", payload);

      return NextResponse.json(
        {
          success: false,
          error:
            payload.error ||
            "Le moteur de recherche web a retourné une erreur.",
        },
        { status: response.status || 502 },
      );
    }

    const webResults = payload.data?.web ?? [];

    const results = webResults
      .filter((item) => item.url)
      .map((item, index) => ({
        id: `${Date.now()}-${index}`,
        title: item.title?.trim() || "Résultat sans titre",
        description:
          item.description?.trim() ||
          "Aucune description disponible.",
        url: item.url!,
        position: item.position ?? index + 1,
        source: getDomain(item.url!),
      }));

    return NextResponse.json({
      success: true,
      query,
      count: results.length,
      creditsUsed: payload.creditsUsed ?? null,
      results,
    });
  } catch (error) {
    console.error("ORBIT search error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Impossible d'effectuer la recherche.",
      },
      { status: 500 },
    );
  }
}

function getDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
}