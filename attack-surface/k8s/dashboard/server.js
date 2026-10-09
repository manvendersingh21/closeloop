// Dashboard backend — small Express server that bridges the real local
// kind cluster to the Svelte UI. Nothing here is mocked: events are piped
// live from `kubectl get events --watch`, and customer data is fetched
// from the real canary-api service (via a kubectl port-forward you run
// alongside this).
import express from "express";
import cors from "cors";
import { spawn } from "child_process";

const app = express();
app.use(cors());

const CTX = "kind-attack-sandbox";
const CANARY_URL = process.env.CANARY_URL || "http://localhost:5678";

// --- Live environment feed (Server-Sent Events) ---
app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (line) => res.write(`data: ${JSON.stringify({ line, ts: new Date().toISOString() })}\n\n`);
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

const PORT = process.env.DASHBOARD_API_PORT || 4100;
app.listen(PORT, () => console.log(`dashboard API listening on :${PORT}`));
