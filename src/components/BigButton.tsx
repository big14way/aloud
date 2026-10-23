import { useRef } from "react";

interface Props {
  label: string;
  hint: string;
  busy: string | null;
  listening: boolean;
  onTap: () => void;
  onDoubleTap: () => void;
  onHoldStart: () => void;
  onHoldEnd: () => void;
}

const HOLD_MS = 450;
const DOUBLE_TAP_MS = 280;

/**
 * The whole screen is one button. Tap: the main action. Double-tap: repeat.
 * Hold: talk while held. Screen-reader and keyboard activation run the main
 * action straight away, because those users activate with their own gestures.
 */
export function BigButton({ label, hint, busy, listening, onTap, onDoubleTap, onHoldStart, onHoldEnd }: Props) {
  const holdTimer = useRef<number | null>(null);
  const tapTimer = useRef<number | null>(null);
  const holding = useRef(false);
  const lastPointer = useRef(0);

  const clearHold = () => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    lastPointer.current = Date.now();
    holding.current = false;
    clearHold();
    holdTimer.current = window.setTimeout(() => {
      holding.current = true;
      onHoldStart();
    }, HOLD_MS);
  };

  const onPointerUp = () => {
    lastPointer.current = Date.now();
    clearHold();
    if (holding.current) {
      holding.current = false;
      onHoldEnd();
      return;
    }
    if (tapTimer.current !== null) {
      window.clearTimeout(tapTimer.current);
      tapTimer.current = null;
      onDoubleTap();
      return;
    }
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = null;
      onTap();
    }, DOUBLE_TAP_MS);
  };

  const onPointerCancel = () => {
    clearHold();
    if (holding.current) {
      holding.current = false;
      onHoldEnd();
    }
  };

  // Clicks that follow a pointer interaction were already handled above.
  const onClick = () => {
    if (Date.now() - lastPointer.current < 800) return;
    onTap();
  };

  const status = listening ? "Listening… release to send" : busy ? `${busy}…` : hint;

  return (
    <button
      type="button"
      className={`big-button${busy ? " is-busy" : ""}${listening ? " is-listening" : ""}`}
      aria-label={label}
      aria-describedby="big-button-hint"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerCancel}
      onClick={onClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="big-label" aria-hidden="true">
        {label}
      </span>
      <span className="big-hint" id="big-button-hint">
        {status}
      </span>
    </button>
  );
}
