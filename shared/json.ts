// Robust JSON extraction from model text: drops <think> blocks and code fences,
// then takes the first balanced {...} object.

export function stripThinking(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  // An unclosed <think> means the answer never started.
  const open = out.search(/<think>/i);
  if (open !== -1) out = out.slice(0, open);
  // Some servers emit only the closing tag when the opening one is in the template.
  const close = out.search(/<\/think>/i);
  if (close !== -1) out = out.slice(close + "</think>".length);
  return out;
}

export function extractFirstJsonObject(text: string): string | null {
  const s = stripThinking(text).replace(/```(?:json)?/gi, "");
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

export function parseJsonObject(text: string): unknown {
  const raw = extractFirstJsonObject(text);
  if (raw === null) throw new Error("No JSON object in model output");
  return JSON.parse(raw);
}
