import { NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { locales, defaultLocale, localePrefix } from './i18n.config';

const intlMiddleware = createMiddleware({
  locales,
  defaultLocale,
  localePrefix
});

// /studio is mounted at app/studio/[[...path]]/route.ts (no locale segment) because it's
// a reverse-proxy to aEboli, not a translatable page. If a user lands on /zh/studio,
// redirect to /studio so they hit the catch-all instead of a missing [locale]/studio route.
const STUDIO_LOCALE_PREFIX = new RegExp(`^/(${locales.join('|')})(/studio(?:/.*)?)$`);

export function proxy(req: NextRequest) {
  const m = req.nextUrl.pathname.match(STUDIO_LOCALE_PREFIX);
  if (m) {
    const url = req.nextUrl.clone();
    url.pathname = m[2];
    return NextResponse.redirect(url, 308);
  }
  return intlMiddleware(req);
}

export const config = {
  matcher: [
    '/',
    // exclude: api/* (own routes), studio/* (reverse-proxied to aEboli), _next, _vercel, static files
    // /zh/studio and /en/studio still pass through so we can redirect them above.
    '/((?!api|studio|_next|_vercel|.*\\..*).*)'
  ]
};
