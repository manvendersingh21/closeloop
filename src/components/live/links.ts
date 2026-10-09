const GUILD_URL = /https:\/\/app\.guild\.ai\/[^\s"'<>()[\]{}]+/g;

function trimUrl(u: string): string {
  return u.replace(/[.,;:!?]+$/, "");
}

/** Guild review-session links mentioned in event messages, de-duplicated, in order. */
export function guildUrls(messages: string[]): string[] {
  const seen = new Set<string>();
  for (const m of messages) {
    for (const hit of m.match(GUILD_URL) ?? []) seen.add(trimUrl(hit));
  }
  return [...seen];
}

/** Splits a message into text and Guild-link parts for inline rendering. */
export function splitGuildLinks(message: string): { text: string; url?: string }[] {
  const parts: { text: string; url?: string }[] = [];
  let last = 0;
  for (const m of message.matchAll(GUILD_URL)) {
    const url = trimUrl(m[0]);
    const start = m.index ?? 0;
    if (start > last) parts.push({ text: message.slice(last, start) });
    parts.push({ text: "Guild review session", url });
    last = start + url.length;
  }
  if (last < message.length) parts.push({ text: message.slice(last) });
  return parts;
}
