import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

export interface ConfirmOptions {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface PromptOptions {
  title: string;
  message: React.ReactNode;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Return an error string to block submit, or null to allow. */
  validate?: (value: string) => string | null;
}

export interface AlertOptions {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
}

export interface DialogApi {
  alert: (opts: AlertOptions) => Promise<void>;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
  toast: (message: string, opts?: ToastOptions) => void;
}

export interface ToastOptions {
  kind?: 'info' | 'error';
  durationMs?: number;
  /** A button in the toast; it takes focus when the toast appears. */
  action?: { label: string; onClick: () => void };
}

type AlertState = AlertOptions & {
  kind: 'alert';
  resolve: () => void;
};

type ConfirmState = ConfirmOptions & {
  kind: 'confirm';
  resolve: (ok: boolean) => void;
};

type PromptState = PromptOptions & {
  kind: 'prompt';
  resolve: (value: string | null) => void;
};

type DialogState = AlertState | ConfirmState | PromptState;

interface ToastEntry {
  id: number;
  message: string;
  kind: 'info' | 'error';
  action?: ToastOptions['action'];
}

const DialogContext = createContext<DialogApi | null>(null);

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used inside <DialogProvider>');
  return ctx;
}

export function errorToastMessage(action: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${action}: ${message}`;
}

export function toastError(dialog: DialogApi, action: string, error: unknown): void {
  dialog.toast(errorToastMessage(action, error), { kind: 'error' });
}

export function DialogProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const toastSeq = useRef(0);

  const closeWith = useCallback(
    (value: boolean | string | null) => {
      setDialog((cur) => {
        if (!cur) return cur;
        if (cur.kind === 'alert') cur.resolve();
        else if (cur.kind === 'confirm') cur.resolve(value === true);
        else cur.resolve(typeof value === 'string' ? value : null);
        return null;
      });
    },
    [setDialog],
  );

  const api = useMemo<DialogApi>(
    () => ({
      alert: (opts) =>
        new Promise<void>((resolve) => {
          setDialog({ kind: 'alert', ...opts, resolve });
        }),
      confirm: (opts) =>
        new Promise<boolean>((resolve) => {
          setDialog({ kind: 'confirm', ...opts, resolve });
        }),
      prompt: (opts) =>
        new Promise<string | null>((resolve) => {
          setDialog({ kind: 'prompt', ...opts, resolve });
        }),
      toast: (message, { kind = 'info', durationMs = 3500, action } = {}) => {
        const id = ++toastSeq.current;
        setToasts((cur) => [...cur, { id, message, kind, action }]);
        window.setTimeout(() => {
          setToasts((cur) => cur.filter((t) => t.id !== id));
        }, durationMs);
      },
    }),
    [],
  );

  return (
    <DialogContext.Provider value={api}>
      {children}
      {dialog &&
        createPortal(<DialogHost state={dialog} closeWith={closeWith} />, document.body)}
      {createPortal(
        <ToastStack
          toasts={toasts}
          onAction={(id) => setToasts((cur) => cur.filter((t) => t.id !== id))}
        />,
        document.body,
      )}
    </DialogContext.Provider>
  );
}

interface DialogHostProps {
  state: DialogState;
  closeWith: (value: boolean | string | null) => void;
}

function DialogHost({ state, closeWith }: DialogHostProps): JSX.Element {
  const previousActive = useRef<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [value, setValue] = useState(
    state.kind === 'prompt' ? (state.defaultValue ?? '') : '',
  );
  const [error, setError] = useState<string | null>(null);

  // Capture previously focused element to restore on close.
  useEffect(() => {
    previousActive.current = document.activeElement as HTMLElement | null;
    return () => {
      previousActive.current?.focus?.();
    };
  }, []);

  // Esc closes; basic Tab focus trap.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeWith(state.kind === 'confirm' ? false : null);
        return;
      }
      if (e.key === 'Tab' && containerRef.current) {
        const focusables = containerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [closeWith, state.kind]);

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (state.kind === 'confirm') {
      closeWith(true);
      return;
    }
    if (state.kind === 'alert') {
      closeWith(true);
      return;
    }
    const v = value;
    const validationError = state.validate?.(v) ?? null;
    if (validationError) {
      setError(validationError);
      return;
    }
    closeWith(v);
  };

  const cancel = (): void =>
    closeWith(state.kind === 'confirm' ? false : null);

  return (
    <div className="modal-backdrop" onMouseDown={cancel}>
      <div
        ref={containerRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="dialog-title">{state.title}</h2>
        <form onSubmit={submit}>
          <div className="dialog-message">{state.message}</div>
          {state.kind === 'prompt' && (
            <label>
              <input
                type="text"
                value={value}
                placeholder={state.placeholder}
                onChange={(e) => {
                  setValue(e.target.value);
                  setError(null);
                }}
                autoFocus
              />
            </label>
          )}
          {error && <p className="error">{error}</p>}
          <div className="modal-actions">
            {state.kind !== 'alert' && (
              <button type="button" onClick={cancel}>
                {state.cancelLabel ?? 'Cancel'}
              </button>
            )}
            <button
              type="submit"
              className={state.kind === 'confirm' && state.danger ? 'danger' : undefined}
              autoFocus={state.kind === 'confirm' || state.kind === 'alert'}
            >
              {state.confirmLabel ?? (state.kind === 'prompt' ? 'Submit' : 'OK')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ToastStack({
  toasts,
  onAction,
}: {
  toasts: ToastEntry[];
  onAction: (id: number) => void;
}): JSX.Element {
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={'toast toast-' + t.kind}>
          <span>{t.message}</span>
          {t.action && (
            <ToastAction
              label={t.action.label}
              onClick={() => {
                onAction(t.id);
                t.action?.onClick();
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function ToastAction({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <button ref={ref} type="button" className="btn btn--sm toast-action" onClick={onClick}>
      {label}
    </button>
  );
}
