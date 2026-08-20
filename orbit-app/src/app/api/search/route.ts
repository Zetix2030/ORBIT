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
          error: "A search query is required.",
        },
        { status: 400 },
      );
    }

    const apiKey = process.env.FIRECRAWL_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          error: "FIRECRAWL_API_KEY is missing.",
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
      console.error("Firecrawl error:", payload);

      return NextResponse.json(
        {
          success: false,
          error:
            payload.error ||
            "Firecrawl returned an error.",
        },
        { status: response.status || 502 },
      );
    }

    const results = (payload.data?.web ?? []).map(
      (result, index) => ({
        id: `${Date.now()}-${index}`,
        title: result.title ?? "Untitled result",
        description: result.description ?? "",
        url: result.url ?? "",
        position: result.position ?? index + 1,
      }),
    );

    return NextResponse.json({
      success: true,
      query,
      count: results.length,
      results,
    });
  } catch (error) {
    console.error("ORBIT search error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Unable to perform web search.",
      },
      { status: 500 },
    );
  }
}