import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, currentAccount, sendWorldChat, worldChat, type WorldChatLine } from '@/lib/api';
import { Icon } from './Icon';

/**
 * The main menu's world channel, like mobile MOBA lobbies: a slim bar at the bottom-left with
 * the newest line, opening into a panel with the recent history and a box to write in.
 * Polled every few seconds while the page is visible.
 */
export function WorldChat({ session }: { session: boolean }) {
  const [lines, setLines] = useState<WorldChatLine[]>([]);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const latest = useRef(0), list = useRef<HTMLDivElement>(null), openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    let alive = true, timer = 0;
    const poll = async () => {
      if (!document.hidden) {
        try {
          const r = await worldChat(latest.current);
          if (!alive) return;
          if (r.lines.length) {
            latest.current = r.latest;
            setLines((prev) => [...prev, ...r.lines].slice(-120));
            if (!openRef.current) setUnread((n) => n + r.lines.length);
          }
        } catch { /* offline: try again later */ }
      }
      if (alive) timer = window.setTimeout(() => { void poll(); }, open ? 2500 : 5000);
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [open]);

  useEffect(() => { if (open) { setUnread(0); list.current?.scrollTo({ top: list.current.scrollHeight }); } }, [open, lines]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setError(null);
    try {
      const line = await sendWorldChat(t);
      setText('');
      if (line.id > latest.current) { latest.current = line.id; setLines((prev) => [...prev, line].slice(-120)); }
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Không gửi được tin nhắn.'); }
  };

  const me = currentAccount()?.username;
  const last = lines[lines.length - 1];
  const time = (at: number) => new Date(at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return (
    <div className={`world-chat${open ? ' open' : ''}`}>
      {!open && (
        <button type="button" className="world-chat-bar" onClick={() => setOpen(true)} aria-label="Mở kênh thế giới">
          <span className="world-chat-tag">Thế giới</span>
          {last ? <span className="world-chat-last"><b>{last.name}:</b> {last.text}</span> : <span className="world-chat-last muted">Chưa có tin nhắn nào</span>}
          {unread > 0 && <i>{unread > 99 ? '99+' : unread}</i>}
          <Icon name="lucide:message-circle" />
        </button>
      )}
      {open && (
        <section className="world-chat-panel" aria-label="Kênh thế giới">
          <header><b>THẾ GIỚI</b><button type="button" onClick={() => setOpen(false)} aria-label="Thu gọn"><Icon name="lucide:chevron-down" /></button></header>
          <div className="world-chat-list" ref={list}>
            {lines.map((l) => (
              <p key={l.id} className={l.name === me ? 'mine' : ''}><time>{time(l.at)}</time><b>{l.name}</b><span>{l.text}</span></p>
            ))}
            {!lines.length && <p className="muted">—</p>}
          </div>
          {session
            ? <form onSubmit={(e) => { void send(e); }}><input value={text} onChange={(e) => setText(e.target.value)} maxLength={160} placeholder="Nhắn với cả máy chủ…" aria-label="Tin nhắn" /><button type="submit" className="btn btn-primary" disabled={!text.trim()}><Icon name="lucide:send" /></button></form>
            : <p className="world-chat-login">Đăng nhập để trò chuyện.</p>}
          {error && <p className="world-chat-error" role="alert">{error}</p>}
        </section>
      )}
    </div>
  );
}
