import type { Finding } from "../types";

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const DEFAULT_MODEL = "meta/llama-3.1-70b-instruct";

export async function maybeEnhanceRationale(
  finding: Finding,
  baseRationale: string,
): Promise<{ text: string; llmAssisted: boolean }> {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) {
    return { text: baseRationale, llmAssisted: false };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(NVIDIA_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.CLOSELOOP_MODEL || DEFAULT_MODEL,
        temperature: 0.2,
        max_tokens: 220,
        messages: [
          {
            role: "system",
            content:
              "You are a staff application security engineer. Rewrite the remediation rationale in 2 crisp sentences for a PR description. No markdown fences.",
          },
          {
            role: "user",
            content: `Finding: ${finding.title} (${finding.cwe})\nFile: ${finding.file}\nBase rationale: ${baseRationale}`,
          },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { text: baseRationale, llmAssisted: false };
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) return { text: baseRationale, llmAssisted: false };
    return { text, llmAssisted: true };
  } catch {
    return { text: baseRationale, llmAssisted: false };
  }
}
