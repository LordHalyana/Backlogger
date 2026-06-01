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
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface PromptOptions {
  title: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Return an error string to block submit, or null to allow. */
  validate?: (value: string) => string | null;
}

export interface DialogApi {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
  toast: (message: string, opts?: { kind?: 'info' | 'error'; durationMs?: number }) => void;
}

type ConfirmState = ConfirmOptions & {
  kind: 'confirm';
  resolve: (ok: boolean) => void;
};

type PromptState = PromptOptions & {
  kind: 'prompt';
  resolve: (value: string | null) => void;
};

type DialogState = ConfirmState | PromptState;

interface ToastEntry {
  id: number;
  message: string;
  kind: 'info' | 'error';
}

const DialogContext = createContext<DialogApi | null>(null);

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used inside <DialogProvider>');
  return ctx;
}

export function DialogProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const toastSeq = useRef(0);

  const closeWith = useCallback(
    (value: boolean | string | null) => {
      setDialog((cur) => {
        if (!cur) return cur;
        if (cur.kind === 'confirm') cur.resolve(value === true);
        else cur.resolve(typeof value === 'string' ? value : null);
        return null;
      });
    },
    [setDialog],
  );

  const api = useMemo<DialogApi>(
    () => ({
      confirm: (opts) =>
        new Promise<boolean>((resolve) => {
          setDialog({ kind: 'confirm', ...opts, resolve });
        }),
      prompt: (opts) =>
        new Promise<string | null>((resolve) => {
          setDialog({ kind: 'prompt', ...opts, resolve });
        }),
      toast: (message, { kind = 'info', durationMs = 3500 } = {}) => {
        const id = ++toastSeq.current;
        setToasts((cur) => [...cur, { id, message, kind }]);
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
      {createPortal(<ToastStack toasts={toasts} />, document.body)}
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
          <p className="dialog-message">{state.message}</p>
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
            <button type="button" onClick={cancel}>
              {state.cancelLabel ?? 'Cancel'}
            </button>
            <button
              type="submit"
              className={state.kind === 'confirm' && state.danger ? 'danger' : undefined}
              autoFocus={state.kind === 'confirm'}
            >
              {state.confirmLabel ?? (state.kind === 'confirm' ? 'OK' : 'Submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ToastStack({ toasts }: { toasts: ToastEntry[] }): JSX.Element {
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={'toast toast-' + t.kind}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
