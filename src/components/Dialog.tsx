import { type ReactNode, useEffect, useId, useRef } from "react";

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Hide the close button for dialogs that need an explicit choice. */
  closable?: boolean;
}

/** An accessible modal: labelled, focus moves in on open and back on close, Escape closes. */
export function Dialog({ title, onClose, children, closable = true }: Props) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  // Held in refs so re-renders of the parent (a new onClose each time) never re-run the focus effect.
  const onCloseRef = useRef(onClose);
  const closableRef = useRef(closable);
  onCloseRef.current = onClose;
  closableRef.current = closable;

  // Runs once per opening: move focus in, trap Tab, close on Escape, restore focus on close.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    (first ?? node)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && closableRef.current) {
        e.stopPropagation();
        onCloseRef.current();
      }
      if (e.key === "Tab" && node) {
        const items = [...node.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter((el) => !el.hasAttribute("disabled"));
        if (items.length === 0) return;
        const firstItem = items[0]!;
        const lastItem = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === firstItem) {
          e.preventDefault();
          lastItem.focus();
        } else if (!e.shiftKey && document.activeElement === lastItem) {
          e.preventDefault();
          firstItem.focus();
        }
      }
    };
    node?.addEventListener("keydown", onKey);
    return () => {
      node?.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);

  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={id} ref={ref} tabIndex={-1}>
        <div className="dialog-head">
          <h2 id={id}>{title}</h2>
          {closable && (
            <button type="button" className="ghost" onClick={onClose}>
              Close
            </button>
          )}
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}
