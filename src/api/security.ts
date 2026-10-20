import type { FastifyInstance } from "fastify";

/**
 * Response headers for everything this server produces, API and dashboard alike.
 * config/nginx.conf.example mirrors them so proxied services are covered too.
 *
 * The CSP matches what the built dashboard actually loads: its own module script and
 * stylesheet, inline style attributes set by React, the Google Fonts stylesheet and the
 * data: SVG used by the CSS, and same-origin fetch/EventSource calls only.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
};

export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook("onRequest", async (_request, reply) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      reply.header(name, value);
    }
  });
}
