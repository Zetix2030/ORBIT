import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const APP_URL =
  "https://ubiquitous-barnacle-6v4gqw45g7qg35qg7-3000.app.github.dev";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);

  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next") ?? "/";

  if (!code) {
    return NextResponse.redirect(
      `${APP_URL}/?auth_error=missing_code`
    );
  }

  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },

        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );

  const { error } =
    await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error(
      "SUPABASE OAUTH CALLBACK ERROR:",
      error.message
    );

    return NextResponse.redirect(
      `${APP_URL}/?auth_error=${encodeURIComponent(error.message)}`
    );
  }

  console.log("✅ Google session created");

  return NextResponse.redirect(
    `${APP_URL}${next}`
  );
}
