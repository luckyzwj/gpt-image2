// Studio gateway: reverse-proxy /studio/* to the aEboli Cloudflare Pages Worker.
//
// Responsibility split:
//   - sistine (this app) is the source of truth for auth + billing.
//   - aEboli is the actual Studio engine; it expects:
//       x-client-session-id  → opaque tenant id (we use sistine user.id)
//       x-studio-userid      → same value, repeated for signing
//       x-studio-sig-ts      → unix seconds at sign time
//       x-studio-sig         → HMAC-SHA256(ts.userId.pathname, STUDIO_GATEWAY_SECRET)
//
// Anything hitting /studio/* without a valid sistine session is rejected here, before
// we even touch aEboli. aEboli then re-verifies the HMAC to make sure the call really
// came from sistine and not directly from the internet.

import { NextRequest } from "next/server";
import { getActiveSessionUser } from "@/lib/auth/session";
import { signRequest } from "@/lib/studio-gateway/hmac";
import { studioBillableFor } from "@/lib/studio-gateway/billing";
import { canUserAfford, deductCredits, refundCredits } from "@/lib/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

function originUrl(): URL {
  const raw = process.env.STUDIO_GATEWAY_ORIGIN;
  if (!raw) {
    throw new Error("STUDIO_GATEWAY_ORIGIN is not configured");
  }
  return new URL(raw);
}

function gatewaySecret(): string {
  const s = process.env.STUDIO_GATEWAY_SECRET;
  if (!s || s.length < 32) {
    throw new Error("STUDIO_GATEWAY_SECRET is missing or shorter than 32 chars");
  }
  return s;
}

async function proxy(req: NextRequest): Promise<Response> {
  const access = await getActiveSessionUser(req.headers);
  if (!access.ok) {
    return new Response(JSON.stringify({ error: access.error }), {
      status: access.status,
      headers: { "content-type": "application/json" },
    });
  }

  const inUrl = new URL(req.url);
  let upstream: URL;
  try {
    upstream = originUrl();
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  // /studio/api/foo  →  origin/api/foo
  // /studio          →  origin/
  const stripped = inUrl.pathname.replace(/^\/studio/, "") || "/";
  upstream.pathname = stripped;
  upstream.search = inUrl.search;

  // Billing: if this is a paid route, pre-debit and remember to refund on upstream error.
  const billable = studioBillableFor(req.method, stripped);
  if (billable) {
    const canAfford = await canUserAfford(access.user.id, billable.cost);
    if (!canAfford) {
      return new Response(
        JSON.stringify({ error: "Insufficient credits", required: billable.cost }),
        { status: 402, headers: { "content-type": "application/json" } },
      );
    }
    const debit = await deductCredits(access.user.id, billable.cost, billable.reason);
    if (!debit.success) {
      return new Response(
        JSON.stringify({ error: debit.error ?? "Failed to charge credits" }),
        { status: 402, headers: { "content-type": "application/json" } },
      );
    }
  }

  let sigHex: string;
  let timestampSec: number;
  try {
    const signed = await signRequest({
      userId: access.user.id,
      path: stripped,
      secret: gatewaySecret(),
    });
    sigHex = signed.sigHex;
    timestampSec = signed.timestampSec;
  } catch (err) {
    if (billable) {
      await refundCredits(access.user.id, billable.cost, `${billable.reason}_refund_sign_fail`);
    }
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  const fwdHeaders = new Headers();
  for (const [k, v] of req.headers.entries()) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    if (k.toLowerCase() === "cookie") continue; // strip sistine cookies; aEboli is stateless
    fwdHeaders.set(k, v);
  }
  fwdHeaders.set("x-client-session-id", access.user.id);
  fwdHeaders.set("x-studio-userid", access.user.id);
  fwdHeaders.set("x-studio-sig-ts", String(timestampSec));
  fwdHeaders.set("x-studio-sig", sigHex);
  fwdHeaders.set("host", upstream.host);

  const init: RequestInit = {
    method: req.method,
    headers: fwdHeaders,
    redirect: "manual",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.body;
    // @ts-expect-error duplex is required by fetch for streaming bodies in node
    init.duplex = "half";
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstream.toString(), init);
  } catch (err) {
    if (billable) {
      await refundCredits(access.user.id, billable.cost, `${billable.reason}_refund_network`);
    }
    return new Response(
      JSON.stringify({ error: (err as Error).message ?? "Upstream fetch failed" }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }

  // Pre-debit refund policy: any non-2xx upstream response → refund.
  // SSE / streaming success that later errors mid-stream is NOT refunded — that's a known limitation
  // of pre-debit billing without a "task finished" callback. Move to settle-on-task-complete when
  // aEboli emits a task lifecycle webhook back to sistine.
  if (billable && (upstreamRes.status < 200 || upstreamRes.status >= 300)) {
    await refundCredits(
      access.user.id,
      billable.cost,
      `${billable.reason}_refund_${upstreamRes.status}`,
    );
  }

  const outHeaders = new Headers();
  for (const [k, v] of upstreamRes.headers.entries()) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    outHeaders.set(k, v);
  }

  // aEboli was built assuming it lives at the root of its origin. When we mount it under
  // /studio/* via this reverse proxy, three classes of references break:
  //
  //   1. HTML relative URLs   — `<link href="./styles.css">`, `<img src="./assets/...">`
  //      Fixed by injecting `<base href="/studio/">` so the browser rebases onto /studio/.
  //
  //   2. ES module static imports — `import x from "/lib/foo.mjs"` (absolute path)
  //      base href does NOT influence module specifier resolution, so we inject an
  //      <script type="importmap"> that prefix-maps "/lib/" → "/studio/lib/".
  //
  //   3. fetch("/api/...") calls — runtime API calls written with absolute paths
  //      base href and import maps don't affect fetch(). We inject an inline script
  //      that monkey-patches window.fetch to prepend /studio to /api/* URLs.
  //
  // The importmap MUST appear before any module script, and the fetch patch MUST
  // run before app.js executes — both are guaranteed by injecting them inside <head>
  // (classic inline scripts execute synchronously during parsing, before any
  // deferred / module script).
  const contentType = upstreamRes.headers.get("content-type") ?? "";
  if (contentType.includes("text/html") && upstreamRes.body) {
    const html = await upstreamRes.text();
    const headInjection = [
      `<base href="/studio/">`,
      `<script type="importmap">${JSON.stringify({ imports: { "/lib/": "/studio/lib/" } })}</script>`,
      `<script>(function(){var o=window.fetch.bind(window);window.fetch=function(i,n){try{if(typeof i==="string"&&i.charAt(0)==="/"&&i.indexOf("/api/")===0)i="/studio"+i;else if(i&&typeof i==="object"&&i.url){var u=new URL(i.url,location.origin);if(u.pathname.indexOf("/api/")===0){u.pathname="/studio"+u.pathname;i=new Request(u.toString(),i);}}}catch(e){}return o(i,n);};})();</script>`,
    ].join("");
    const patched = html.replace(
      /<head(\s[^>]*)?>/i,
      (match) => `${match}${headInjection}`,
    );
    // upstreamRes.text() already decompressed the body. We must drop the
    // Content-Encoding / Content-Length / ETag headers, otherwise the browser
    // (or Cloudflare in front of Vercel) tries to re-decode plaintext as zstd
    // and fails with ERR_CONTENT_DECODING_FAILED. Also force no-store so the
    // edge cache doesn't pin a broken response.
    outHeaders.delete("content-encoding");
    outHeaders.delete("content-length");
    outHeaders.delete("etag");
    outHeaders.set("cache-control", "no-store");
    return new Response(patched, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: outHeaders,
    });
  }

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    statusText: upstreamRes.statusText,
    headers: outHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
export const HEAD = proxy;
