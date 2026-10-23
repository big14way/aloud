// A random id per browser tab, sent with API calls so the demo can cap requests per session.
let memoryId: string | null = null;

function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function sessionId(): string {
  try {
    const existing = sessionStorage.getItem("aloud.session");
    if (existing) return existing;
    const id = randomId();
    sessionStorage.setItem("aloud.session", id);
    return id;
  } catch {
    memoryId ??= randomId();
    return memoryId;
  }
}

export function newId(): string {
  return randomId();
}
