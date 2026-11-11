"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";

/**
 * The one confirmation box the whole site uses, in place of the browser's confirm() and alert().
 *
 * Built on the native <dialog> element opened with showModal(), so the browser traps focus inside it, Escape
 * cancels it, and the rest of the page is inert while it is open. Unlike confirm(), it can lay out a summary
 * (stake, daily limit, stop loss) as a table and name the action on its button ("Put Live at £2.00"), and in-app
 * browsers that block native pop-ups still show it.
 *
 * Focus starts on Cancel, so a stray tap or Enter never confirms a money or delete action.
 *
 * Use it through the hook:
 *   const dialog = useDialog();
 *   if (!(await dialog.confirm({ title: "Delete it?", confirmLabel: "Delete", tone: "danger" }))) return;
 *   await dialog.notify({ title: "Done", body: "3 alerts deleted." });
 */

export interface ConfirmOptions {
  title: string;
  body?: React.ReactNode;
  /** A short summary shown as label / value rows, e.g. the stake, daily limit and stop loss of a money action. */
  details?: Array<{ label: string; value: React.ReactNode }>;
  /** Names the action, e.g. "Put Live at £2.00" or "Delete 3 strategies". Never just "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  /** danger = deletes or removes something; money = changes what gets bet. */
  tone?: "default" | "danger" | "money";
  /**
   * The owner must type this exactly before the confirm button works (a figure the engine wants typed again: a stake or
   * loss limit above its safe size). A leading £ or a trailing % is ignored.
   */
  typeToConfirm?: string;
}

interface Request extends ConfirmOptions {
  id: number;
  /** A notice with one button and no choice to make. */
  notice?: boolean;
  resolve: (ok: boolean) => void;
}

interface DialogApi {
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  notify: (o: { title: string; body?: React.ReactNode; closeLabel?: string }) => Promise<void>;
}

const DialogContext = createContext<DialogApi | null>(null);
let nextId = 1;

/** The same, or null outside <DialogProvider> (a component rendered on its own in a test). */
export function useDialogOptional(): DialogApi | null {
  return useContext(DialogContext);
}

/** What was typed, as the figure it stands for: "£45", "45%" and " 45 " are all 45. */
export const typedFigure = (s: string) => s.trim().replace(/^£\s*/, "").replace(/\s*%$/, "");

export function useDialog(): DialogApi {
  const api = useContext(DialogContext);
  if (!api) throw new Error("useDialog must be used inside <DialogProvider>.");
  return api;
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  // One box at a time; a second request waits its turn.
  const [queue, setQueue] = useState<Request[]>([]);

  const confirm = useCallback(
    (o: ConfirmOptions) => new Promise<boolean>((resolve) => setQueue((q) => [...q, { ...o, id: nextId++, resolve }])),
    [],
  );
  const notify = useCallback(
    (o: { title: string; body?: React.ReactNode; closeLabel?: string }) =>
      new Promise<void>((resolve) =>
        setQueue((q) => [...q, { id: nextId++, title: o.title, body: o.body, confirmLabel: o.closeLabel ?? "Close", notice: true, resolve: () => resolve() }]),
      ),
    [],
  );

  const current = queue[0] ?? null;
  const finish = useCallback(
    (ok: boolean) => {
      current?.resolve(ok);
      setQueue((q) => q.slice(1));
    },
    [current],
  );

  return (
    <DialogContext.Provider value={{ confirm, notify }}>
      {children}
      {current && <ConfirmDialog key={current.id} request={current} onClose={finish} />}
    </DialogContext.Provider>
  );
}

const TONE_BUTTON: Record<NonNullable<ConfirmOptions["tone"]>, string> = {
  default: "bg-accent text-accent-ink",
  money: "bg-hit text-app",
  danger: "bg-destructive text-danger-ink",
};

/** The box itself. Rendered by DialogProvider; pages use useDialog() rather than this directly. */
function ConfirmDialog({ request, onClose }: { request: Request; onClose: (ok: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const tone = request.tone ?? "default";
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const locked = request.typeToConfirm !== undefined && typedFigure(typed) !== request.typeToConfirm;

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={request.body || request.details ? bodyId : undefined}
      // Escape, the confirm button and the cancel button all end up here; returnValue says which.
      onClose={(e) => onClose(e.currentTarget.returnValue === "confirm")}
      // A tap on the dimmed backdrop (outside the panel) cancels.
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close("cancel");
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/60"
    >
      <form method="dialog" className="space-y-3 p-4">
        <h2 id={titleId} className="text-base font-semibold text-ink">
          {request.title}
        </h2>
        <div id={bodyId} className="space-y-3">
          {request.details && request.details.length > 0 && (
            <dl className="divide-y divide-line rounded-lg border border-line bg-surface-2 text-sm">
              {request.details.map((d) => (
                <div key={d.label} className="flex items-baseline justify-between gap-3 px-3 py-2">
                  <dt className="text-ink-muted">{d.label}</dt>
                  <dd className="text-right font-medium tabular-nums text-ink">{d.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {request.body && <div className="space-y-2 text-sm text-ink-muted [&_strong]:text-ink">{request.body}</div>}
          {request.typeToConfirm !== undefined && (
            <div className="space-y-1">
              <label htmlFor={inputId} className="block text-sm font-medium text-ink">
                Type <span className="tabular-nums">{request.typeToConfirm}</span> to confirm
              </label>
              <input
                id={inputId}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                // Enter in the box must not confirm a figure not yet typed.
                onKeyDown={(e) => {
                  if (e.key === "Enter" && locked) e.preventDefault();
                }}
                inputMode="decimal"
                autoComplete="off"
                className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-base tabular-nums text-ink"
              />
            </div>
          )}
        </div>
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          {!request.notice && (
            <button
              type="submit"
              value="cancel"
              autoFocus
              className="rounded-md border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2"
            >
              {request.cancelLabel ?? "Cancel"}
            </button>
          )}
          <button
            type="submit"
            value="confirm"
            autoFocus={request.notice}
            disabled={locked}
            className={`rounded-md px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${request.notice ? TONE_BUTTON.default : TONE_BUTTON[tone]}`}
          >
            {request.confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
