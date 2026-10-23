import { useEffect, useState } from "react";
import { type Sample, loadSamples } from "../lib/samples";
import { Dialog } from "./Dialog";

interface Props {
  current: Sample | null;
  onPick: (s: Sample | null) => void;
  onClose: () => void;
}

export function SamplesPanel({ current, onPick, onClose }: Props) {
  const [samples, setSamples] = useState<Sample[] | null>(null);
  useEffect(() => {
    void loadSamples().then(setSamples);
  }, []);
  return (
    <Dialog title="Try with sample photos" onClose={onClose}>
      <p>No camera, or on a laptop? Pick a photo. Every button then works on it as if the camera saw it.</p>
      {current && (
        <button
          type="button"
          onClick={() => {
            onPick(null);
            onClose();
          }}
        >
          Use the camera again
        </button>
      )}
      {samples === null ? (
        <p>Loading…</p>
      ) : samples.length === 0 ? (
        <p>No sample photos are bundled with this build.</p>
      ) : (
        <ul className="samples">
          {samples.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={current?.id === s.id ? "sample is-current" : "sample"}
                aria-pressed={current?.id === s.id}
                onClick={() => {
                  onPick(s);
                  onClose();
                }}
              >
                <img src={`/samples/${s.file}`} alt="" loading="lazy" />
                <span>{s.title}</span>
                <span className="muted">Try: {s.suggested.replace("_", " ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
