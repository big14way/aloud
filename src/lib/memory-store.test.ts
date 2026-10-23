import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store";

const obj = (id: string) => ({ id, label: id, aliases: [], description: "", thumbs: [], created_ts: 1 });
const ev = (id: string, object_id: string) => ({
  id,
  object_id,
  kind: "placed" as const,
  location: "on the shelf",
  place_id: null,
  ts: 2,
  source: "user_said" as const,
  confidence: 1,
  identity_confidence: 0.9,
});

describe("MemoryStore", () => {
  it("stores objects and events, deletes an object with its events, and exports", async () => {
    const store = new MemoryStore("test-1");
    await store.putObject(obj("keys"));
    await store.putObject(obj("wallet"));
    await store.addEvent(ev("e1", "keys"));
    await store.addEvent(ev("e2", "wallet"));
    await store.deleteObject("keys");
    const snap = await store.snapshot();
    expect(snap.objects.map((o) => o.id)).toEqual(["wallet"]);
    expect(snap.events.map((e) => e.id)).toEqual(["e2"]);
    const out = await store.exportAll(new Date("2026-10-29T00:00:00Z"));
    expect(out).toMatchObject({ format: "aloud-memory", version: 1, exported_at: "2026-10-29T00:00:00.000Z" });
  });

  it("deletes everything in one go", async () => {
    const store = new MemoryStore("test-2");
    await store.putObject(obj("keys"));
    await store.addEvent(ev("e1", "keys"));
    await store.deleteAll();
    expect(await store.snapshot()).toEqual({ objects: [], places: [], events: [] });
  });
});
