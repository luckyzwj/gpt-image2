import createMiddleware from 'next-intl/middleware';
import { locales, defaultLocale, localePrefix } from './i18n.config';

export const proxy = createMiddleware({
  locales,
  defaultLocale,
  localePrefix
});

export const config = {
  matcher: [
    '/',
    // exclude: api/* (own routes), studio/* (reverse-proxied to aEboli), _next, _vercel, static files
    '/((?!api|studio|_next|_vercel|.*\\..*).*)'
  ]
};
