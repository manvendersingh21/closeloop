// storefront — the PUBLIC, intentionally-vulnerable entry point of the sandbox.
//
// Authorized security-research honeypot. Deployed by Divya on Akash for a
// sanctioned attack exercise. Two deliberate bugs:
//
//   1. Reflected XSS on /search  (CWE-79)  — warm-up bug, steals a cookie "flag".
//   2. SSRF on /preview          (CWE-918) — the real pivot: lets a caller make
//      this server issue requests to internal-only hosts (metadata, internal-api)
//      that are NOT reachable directly from outside this Akash deployment.
//
// Nothing here should be copied into a real product.

import express from "express";

const app = express();
const PORT = process.env.PORT || 8080;

// A fake "session" cookie containing a flag. Classic reflected-XSS payoff:
// steal this via document.cookie and exfiltrate it through /search.
const XSS_FLAG = "FLAG{xss-" + Math.random().toString(36).slice(2, 10) + "}";

app.get("/", (req, res) => {
  res.cookie ? null : null; // express without cookie-parser; set header manually
  res.setHeader("Set-Cookie", `session=${XSS_FLAG}; Path=/`);
  res.send(`<!doctype html><html><head><title>Akash Sandbox Storefront</title></head>
  <body style="font-family:sans-serif;max-width:640px;margin:40px auto">
    <h1>⚡ Akash Sandbox Storefront</h1>
    <p>A small shop for a security exercise. Search below, or preview a product feed.</p>
    <form action="/search"><input name="q" placeholder="search products..."><button>Search</button></form>
    <form action="/preview"><input name="url" placeholder="https://supplier.example/feed.json" style="width:320px"><button>Preview feed</button></form>
    <!-- TODO before launch: remove debug note. internal services on this
         deployment network: metadata:4001, internal-api:4000 -->
  </body></html>`);
});

// Bug 1: reflected XSS — `q` is echoed into the page with no escaping.
app.get("/search", (req, res) => {
  const q = req.query.q || "";
  res.send(`<!doctype html><html><body style="font-family:sans-serif;max-width:640px;margin:40px auto">
    <h1>Search results</h1>
    <p>You searched for: ${q}</p>
    <p>No products matched.</p>
    <p><a href="/">Back</a></p>
  </body></html>`);
});

// Bug 2: SSRF — fetches any attacker-supplied URL server-side with no
// allowlist and no block on internal/private hosts. This is the pivot
// that reaches metadata/internal-api, which are NOT exposed publicly.
app.get("/preview", async (req, res) => {
  const target = req.query.url;
  if (!target) {
    return res.send(`<p>Give me a ?url= to preview.</p>`);
  }
  try {
    const upstream = await fetch(target, { redirect: "follow" });
    const contentType = upstream.headers.get("content-type") || "text/plain";
    const body = await upstream.text();
    res.status(200).type(contentType.includes("json") ? "application/json" : "text/plain");
    res.send(body.slice(0, 4000));
  } catch (err) {
    res.status(502).send("Could not fetch that feed: " + (err?.message || String(err)));
  }
});

app.listen(PORT, () => {
  console.log(`storefront listening on :${PORT}`);
  console.log(`(xss flag cookie value, for the lab's own reference: ${XSS_FLAG})`);
});
