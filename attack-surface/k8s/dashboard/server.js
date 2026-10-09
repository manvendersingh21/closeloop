// Dashboard backend — small Express server that bridges the real local
// kind cluster to the Svelte UI. Nothing here is mocked: events are piped
// live from `kubectl get events --watch`, and customer data is fetched
// from the real canary-api service (via a kubectl port-forward you run
// alongside this).
import express from "express";
import cors from "cors";
import { spawn, execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());

const CTX = "kind-attack-sandbox";
const CANARY_URL = process.env.CANARY_URL || "http://localhost:5678";

// On Akash there's no Kubernetes cluster to query at all — kubectl won't
// even be on the image. Check once at boot rather than failing per-request.
let KUBECTL_AVAILABLE = false;
try {
  execSync("kubectl version --client", { stdio: "ignore" });
  KUBECTL_AVAILABLE = true;
} catch {
  KUBECTL_AVAILABLE = false;
}

// --- Live environment feed (Server-Sent Events) ---
app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (line) => res.write(`data: ${JSON.stringify({ line, ts: new Date().toISOString() })}\n\n`);

  if (!KUBECTL_AVAILABLE) {
    send("[dashboard] kubectl unavailable in this deployment — this view only works when the dashboard runs against a live kind cluster locally. Customer Data and Access Log still reflect the real canary-api.");
    return; // leave the connection open, idle; nothing more to stream
  }

  send(`[dashboard] watching all namespaces on context ${CTX}...`);

  const kubectl = spawn("kubectl", [
    "--context", CTX,
    "get", "events", "-A",
    "--watch",
    "--output-watch-events=false",
    "--sort-by=.lastTimestamp",
  ]);

  kubectl.stdout.on("data", (chunk) => {
    for (const line of chunk.toString().split("\n")) {
      if (line.trim()) send(line);
    }
  });
  kubectl.stderr.on("data", (chunk) => send(`[stderr] ${chunk.toString().trim()}`));
  kubectl.on("close", (code) => send(`[kubectl exited, code ${code}]`));

  req.on("close", () => kubectl.kill());
});

// --- Customer data (real, from the live canary-api service) ---
app.get("/api/customers", async (req, res) => {
  try {
    const upstream = await fetch(`${CANARY_URL}/customers`);
    if (!upstream.ok) throw new Error(`canary-api returned ${upstream.status}`);
    const data = await upstream.json();
    res.json({ source: "live", ...data });
  } catch (err) {
    res.status(502).json({
      source: "unavailable",
      error: String(err?.message || err),
      hint: "Run: kubectl --context kind-attack-sandbox port-forward -n protected svc/canary 5678:80",
    });
  }
});

// --- Escalation log (Server-Sent Events, bridging canary-api's /logs) ---
app.get("/api/logs/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let since = 0;
  let closed = false;
  req.on("close", () => (closed = true));

  // replay recent history once, then poll canary-api for new entries
  while (!closed) {
    try {
      const upstream = await fetch(`${CANARY_URL}/logs?since=${since}`);
      if (upstream.ok) {
        const { logs, lastId } = await upstream.json();
        for (const entry of logs) {
          res.write(`data: ${JSON.stringify(entry)}\n\n`);
        }
        since = lastId;
      }
    } catch {
      // canary-api unreachable (port-forward down) — just keep retrying
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
});

// --- Serve the built Svelte app (production: one container, one port) ---
const distDir = path.join(__dirname, "dist");
app.use(express.static(distDir));
app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(distDir, "index.html")));

const PORT = process.env.DASHBOARD_API_PORT || process.env.PORT || 4100;
app.listen(PORT, () => console.log(`dashboard listening on :${PORT} (kubectl available: ${KUBECTL_AVAILABLE})`));
