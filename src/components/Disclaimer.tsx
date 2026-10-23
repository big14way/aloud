import { Dialog } from "./Dialog";

export const DISCLAIMER =
  "Aloud is not a medical device and not a mobility aid. Use it alongside your cane, guide dog, or a trusted person.";

export function Disclaimer({ onAccept }: { onAccept: () => void }) {
  return (
    <Dialog title="Before you start" onClose={onAccept} closable={false}>
      <p>{DISCLAIMER}</p>
      <p>Aloud tells you when it isn't sure. It never judges traffic, never identifies people, and never gives medical advice.</p>
      <button type="button" className="primary" onClick={onAccept}>
        I understand
      </button>
    </Dialog>
  );
}
