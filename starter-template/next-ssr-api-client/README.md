# Next SSR API Client Template

Minimal Next.js scaffold for:

- SSR fetch with `next/headers` cookie extraction (`auth_token`)
- Browser axios client with bearer token from `localStorage`
- Basic middleware route guard

## Notes

- Set cookie domain on API side (for example `.joyminis.com`) so admin and API subdomains can share auth cookie.
- Use `credentials: true` in API CORS when using cross-subdomain cookies.

