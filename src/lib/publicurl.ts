/**
 * Public address a service is reachable at from outside the machine.
 *
 * It is derived, never configured: the origin of `server.public_url` plus the service id, which is the same
 * layout `config/nginx.conf.example` routes (`location /<id>/ -> 127.0.0.1:<service port>`). Only the origin of
 * `public_url` is used - the dashboard lives at `/`, so a service prefix belongs at the root of the host too.
 *
 * Returns `null` when no public URL is configured or it does not parse, so a card without a public address
 * simply shows no link instead of a broken one. Service ids are validated by the config loader
 * (`[a-z0-9][a-z0-9-]{0,31}`), so they need no escaping here.
 */
export function serviceAccessLink(publicUrl: string | null, id: string): string | null {
  if (publicUrl === null) {
    return null;
  }

  const trimmed = publicUrl.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let origin: string;
  try {
    origin = new URL(trimmed).origin;
  } catch {
    return null;
  }

  /* Non-http origins (file:, blob:, ...) report "null" and are useless as an access link. */
  if (origin === "null" || origin.length === 0) {
    return null;
  }

  return `${origin.replace(/\/+$/, "")}/${id}`;
}
