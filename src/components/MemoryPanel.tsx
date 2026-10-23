import { useEffect, useState } from "react";
import { answerFind } from "../../shared/memory";
import type { Controller } from "../lib/controller";
import type { MemorySnapshot } from "../lib/memory-store";
import { Dialog } from "./Dialog";

interface Props {
  controller: Controller;
  version: number;
  onClose: () => void;
}

function download(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function MemoryPanel({ controller, version, onClose }: Props) {
  const [snap, setSnap] = useState<MemorySnapshot | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    let live = true;
    void controller.store.snapshot().then((s) => live && setSnap(s));
    return () => {
      live = false;
    };
  }, [controller, version]);

  return (
    <Dialog title="My things" onClose={onClose}>
      <p>Everything here is stored only on this phone.</p>
      {snap && snap.objects.length === 0 && <p>No objects yet. Hold one up and add it below, or say: remember this as my keys.</p>}
      <ul className="objects">
        {snap?.objects.map((o) => (
          <li key={o.id}>
            <div className="object-row">
              {o.thumbs[0] && <img src={o.thumbs[0]} alt="" width={64} height={64} />}
              <div>
                <strong>{o.label}</strong>
                <p>{o.description}</p>
                <p className="muted">{answerFind(o.label, [o], snap.events, Date.now()).speech}</p>
              </div>
            </div>
            <button type="button" className="ghost" onClick={() => void controller.deleteObject(o.id)} aria-label={`Forget ${o.label}`}>
              Forget
            </button>
          </li>
        ))}
      </ul>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newLabel.trim()) return;
          controller.startEnrol(newLabel);
          setNewLabel("");
          onClose();
        }}
      >
        <label className="field grow">
          Learn a new object, called
          <input type="text" value={newLabel} placeholder="house keys" maxLength={60} onChange={(e) => setNewLabel(e.target.value)} />
        </label>
        <button type="submit">Start</button>
      </form>

      <div className="row">
        <button type="button" onClick={async () => download(`aloud-memory-${new Date().toISOString().slice(0, 10)}.json`, await controller.store.exportAll())}>
          Export my memory
        </button>
        {armed ? (
          <button
            type="button"
            className="danger"
            onClick={async () => {
              await controller.deleteAllMemory();
              setArmed(false);
            }}
          >
            Press again to delete everything
          </button>
        ) : (
          <button type="button" className="danger" onClick={() => setArmed(true)}>
            Delete all memory
          </button>
        )}
      </div>
    </Dialog>
  );
}
