import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath } from "@/lib/route-access";

/**
 * Runs before every page request:
 *  1. refreshes the Supabase session cookie, and
 *  2. sends unauthenticated visitors of internal routes to /login.
 * Pages and server actions still re-check identity and permissions; this is
 * not the only line of defence.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const { pathname, search } = request.nextUrl;

  if (!url || !key) {
    // Not configured yet: only the setup page can explain what to do.
    if (isPublicPath(pathname)) return response;
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  if (!signedIn && !isPublicPath(pathname)) {
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  matcher: [
    // Skip static assets, images, icons, the manifest and the service worker.
    "/((?!_next/static|_next/image|favicon.ico|icons/|brand/|fonts/|sw.js|manifest.webmanifest|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt)$).*)",
  ],
};
