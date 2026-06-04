import { useEffect, useRef } from 'react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Feature-specific class applied to the modal container. */
  className?: string;
  size?: 'default' | 'wide';
}

/**
 * Shared modal shell used by NewDocumentDialog, ImportDialog, and SettingsDialog.
 * Handles backdrop, container, heading, aria attributes, close button, and
 * focus restoration on unmount.
 */
export function Modal({
  title,
  onClose,
  children,
  className,
  size = 'default',
}: ModalProps): JSX.Element {
  const triggerRef = useRef<Element | null>(null);

  // Capture the currently focused element so focus is restored when modal closes.
  useEffect(() => {
    triggerRef.current = document.activeElement;
    return () => {
      (triggerRef.current as HTMLElement | null)?.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal modal--${size}${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="modal-title" className="modal-title">
            {title}
          </h2>
          <button
            type="button"
            className="btn btn--ghost modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
