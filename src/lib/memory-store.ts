import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { MemEvent, MemObject, MemPlace } from "../../shared/memory";

// Device-only memory in IndexedDB. Nothing here is ever sent to a server, except
// thumbnails for one verification call when the user asks Aloud to check.

interface AloudDB extends DBSchema {
  objects: { key: string; value: MemObject };
  places: { key: string; value: MemPlace };
  events: { key: string; value: MemEvent; indexes: { by_object: string } };
}

export interface MemorySnapshot {
  objects: MemObject[];
  places: MemPlace[];
  events: MemEvent[];
}

export interface MemoryExport extends MemorySnapshot {
  format: "aloud-memory";
  version: 1;
  exported_at: string;
}

export class MemoryStore {
  private db: Promise<IDBPDatabase<AloudDB>> | null = null;

  constructor(private readonly name = "aloud") {}

  private open(): Promise<IDBPDatabase<AloudDB>> {
    this.db ??= openDB<AloudDB>(this.name, 1, {
      upgrade(db) {
        db.createObjectStore("objects", { keyPath: "id" });
        db.createObjectStore("places", { keyPath: "id" });
        db.createObjectStore("events", { keyPath: "id" }).createIndex("by_object", "object_id");
      },
    });
    return this.db;
  }

  async snapshot(): Promise<MemorySnapshot> {
    const db = await this.open();
    const [objects, places, events] = await Promise.all([db.getAll("objects"), db.getAll("places"), db.getAll("events")]);
    objects.sort((a, b) => a.created_ts - b.created_ts);
    events.sort((a, b) => a.ts - b.ts);
    return { objects, places, events };
  }

  async putObject(o: MemObject): Promise<void> {
    await (await this.open()).put("objects", o);
  }

  async addEvent(e: MemEvent): Promise<void> {
    await (await this.open()).put("events", e);
  }

  async putPlace(p: MemPlace): Promise<void> {
    await (await this.open()).put("places", p);
  }

  /** Remove an object and every event about it. */
  async deleteObject(id: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(["objects", "events"], "readwrite");
    await tx.objectStore("objects").delete(id);
    const keys = await tx.objectStore("events").index("by_object").getAllKeys(id);
    await Promise.all(keys.map((k) => tx.objectStore("events").delete(k)));
    await tx.done;
  }

  async deleteAll(): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(["objects", "places", "events"], "readwrite");
    await Promise.all([tx.objectStore("objects").clear(), tx.objectStore("places").clear(), tx.objectStore("events").clear()]);
    await tx.done;
  }

  async exportAll(now = new Date()): Promise<MemoryExport> {
    return { format: "aloud-memory", version: 1, exported_at: now.toISOString(), ...(await this.snapshot()) };
  }
}
