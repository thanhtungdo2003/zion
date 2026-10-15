'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * An in-game confirmation instead of the browser's `confirm()`: its own message, a red confirm
 * button and, when `password` is set, a password field that must be filled before confirming.
 * `onConfirm` may return a promise; a thrown error is shown in the dialog.
 */
export function ConfirmDialog({ title, message, confirmLabel = 'Xác nhận', cancelLabel = 'Hủy', danger = true, password = false, onConfirm, onCancel }: {
  title: string; message: React.ReactNode; confirmLabel?: string; cancelLabel?: string; danger?: boolean; password?: boolean;
  onConfirm: (password: string) => void | Promise<void>; onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    (password ? field.current : cancel.current)?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onCancel, password]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || (password && !value)) return;
    setBusy(true); setError(null);
    try { await onConfirm(value); } catch (err) { setError(err instanceof Error ? err.message : 'Không thực hiện được.'); setBusy(false); }
  };
  return (
    <div className="confirm-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <form className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onSubmit={(e) => void submit(e)}>
        <h2 id="confirm-title">{title}</h2>
        <div className="confirm-message">{message}</div>
        {password && <input ref={field} type="password" autoComplete="current-password" placeholder="Mật khẩu Studio" value={value} onChange={(e) => setValue(e.target.value)} />}
        {error && <p className="confirm-error">{error}</p>}
        <div className="confirm-actions">
          <button ref={cancel} type="button" className="btn" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          <button type="submit" className={`btn ${danger ? 'confirm-danger' : 'btn-primary'}`} disabled={busy || (password && !value)}>{busy ? 'Đang xử lý…' : confirmLabel}</button>
        </div>
      </form>
    </div>
  );
}
