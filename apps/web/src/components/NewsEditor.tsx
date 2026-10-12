'use client';

import { useEffect, useRef, useState } from 'react';
import { NEWS_CATEGORIES, newsContentSchema, type NewsContent, type NewsDraft, type NewsAction } from '@zion/shared';
import { studioNews, studioNewsAction } from '@/lib/api';
import { Icon } from './Icon';
import { Spinner } from './Spinner';
import { NewsArticle } from './NewsArticle';

const blank = (): NewsDraft => ({ id: crypto.randomUUID(), revision: 0, content: { title: '', version: '', summary: '', body: '', category: 'update', pinned: false }, published: null, updatedAt: new Date().toISOString() });
export function NewsEditor() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<NewsDraft[]>([]);
  const [active, setActive] = useState<NewsDraft | null>(null);
  const [content, setContent] = useState<NewsContent | null>(null);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [preview, setPreview] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const dirty = !!active && JSON.stringify(content) !== JSON.stringify(active.content);
  const canLeave = () => !dirty || confirm('Bỏ những thay đổi chưa lưu của bài viết?');
  const select = (row: NewsDraft | null) => {
    setActive(row); setContent(row ? structuredClone(row.content) : null); setError(''); setMessage('');
  };
  useEffect(() => {
    if (!open) { dialog.current?.close(); return; }
    dialog.current?.showModal();
    let alive = true;
    setLoading(true); setError('');
    void studioNews().then(next => {
      if (!alive) return;
      setRows(next); select(next[0] ?? null);
    }).catch(err => { if (alive) setError(err instanceof Error ? err.message : 'Không tải được bài viết.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open]);
  const close = () => { if (!busy && canLeave()) { setOpen(false); select(null); } };
  const update = (patch: Partial<NewsContent>) => { if (content) setContent({ ...content, ...patch }); setMessage(''); };
  const reload = async () => {
    if (busy || !canLeave()) return;
    setLoading(true); setError('');
    try { const next = await studioNews(); setRows(next); select(next.find(row => row.id === active?.id) ?? next[0] ?? null); }
    catch (err) { setError(err instanceof Error ? err.message : 'Không tải được bài viết.'); }
    finally { setLoading(false); }
  };
  const run = async (op: NewsAction['op']) => {
    if (!active || !content || busy) return;
    if (op === 'delete' && !confirm('Xóa bài viết này? Nếu đã đăng, bài sẽ biến mất khỏi trang Có gì mới?.')) return;
    if (op === 'unpublish' && !confirm('Gỡ bài này khỏi trang Có gì mới? Bản nháp vẫn được giữ.')) return;
    setBusy(true); setError(''); setMessage('');
    let current = active;
    try {
      if (op === 'save' || op === 'publish') {
        const parsed = newsContentSchema.safeParse(content);
        if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Hãy kiểm tra nội dung bài viết.'); return; }
        if (dirty || !current.revision) {
          current = (await studioNewsAction({ op: 'save', id: current.id, revision: current.revision, content: parsed.data }))!;
          // Keep the successful save if the subsequent publication fails.
          setActive(current); setContent(current.content);
          setRows(prev => [current, ...prev.filter(row => row.id !== current.id)]);
        }
      }
      if (op !== 'save') {
        const result = await studioNewsAction({ op, id: current.id, revision: current.revision });
        if (result) {
          current = result; setActive(result); setContent(result.content);
          setRows(prev => [result, ...prev.filter(row => row.id !== result.id)]);
        } else { setRows(prev => prev.filter(row => row.id !== current.id)); select(null); }
      }
      setMessage(op === 'publish' ? 'Đã đăng. Người chơi sẽ thấy bài mới và chấm vàng ở menu.' : op === 'unpublish' ? 'Đã gỡ bài. Bản nháp được giữ lại.' : op === 'delete' ? 'Đã xóa bài viết.' : 'Đã lưu bản nháp. Bản đang đăng chưa thay đổi.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Không lưu được bài viết.'); }
    finally { setBusy(false); }
  };
  return <>
    <button className="btn" onClick={() => setOpen(true)}><Icon name="lucide:newspaper" /> Bản cập nhật</button>
    <dialog ref={dialog} className="news-editor-dialog" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === dialog.current) close(); }} aria-labelledby="news-editor-title">
      <div className="news-editor-shell">
        <header className="library-header"><div><span className="library-kicker">STUDIO / NỘI DUNG</span><h2 id="news-editor-title">Quản lý bản cập nhật</h2></div><button className="library-icon-button" aria-label="Đóng quản lý bản cập nhật" disabled={busy} onClick={close}><Icon name="lucide:x" /></button></header>
        <div className="news-editor-layout">
          <aside className="news-editor-list">
            <div className="news-editor-list-tools"><button className="btn btn-primary" disabled={busy || loading} onClick={() => { if (canLeave()) select(blank()); }}><Icon name="lucide:plus" /> Bài mới</button><button className="library-icon-button" title="Tải lại danh sách" aria-label="Tải lại danh sách" disabled={busy || loading} onClick={() => void reload()}><Icon name="lucide:refresh-cw" /></button></div>
            {loading && <p className="library-empty"><Spinner /> Đang tải bài viết…</p>}
            {!loading && !rows.length && <p className="library-empty">Chưa có bài viết. Tạo bản nháp đầu tiên để chia sẻ cập nhật với người chơi.</p>}
            {rows.map(row => <button key={row.id} className={`news-editor-row ${active?.id === row.id ? 'on' : ''}`} disabled={busy || loading} onClick={() => { if (canLeave()) select(row); }}><span>{row.published ? row.revision > row.published.revision ? 'Có thay đổi chưa đăng' : 'Đã đăng' : 'Bản nháp'}{row.content.pinned && ' · Ghim'}</span><b>{row.content.title}</b><small>{row.content.version || NEWS_CATEGORIES[row.content.category]}</small></button>)}
          </aside>
          <section className="news-editor-workspace">
            <div className="news-editor-toolbar"><div><b>{active?.revision ? 'Biên tập bài viết' : 'Bản nháp mới'}</b>{dirty && <span>Chưa lưu</span>}</div><button className="btn" disabled={!content} onClick={() => setPreview(!preview)}><Icon name={preview ? 'lucide:pencil' : 'lucide:eye'} />{preview ? 'Biên tập' : 'Xem trước'}</button></div>
            {!content ? <div className="library-empty"><Icon name="lucide:file-pen-line" /><h3>Chuyện mới ở ZION</h3><p>Chọn một bài viết hoặc tạo bản nháp mới.</p></div> : preview ? <NewsArticle post={content} /> : <fieldset disabled={busy || loading} className="news-editor-fields">
              <label className="field"><span>Tiêu đề</span><input value={content.title} maxLength={160} placeholder="Ví dụ: Hành trình ngoài vùng an toàn" onChange={e => update({ title: e.target.value })} /></label>
              <div className="news-editor-field-row"><label className="field"><span>Phiên bản (không bắt buộc)</span><input value={content.version} maxLength={40} placeholder="Ví dụ: 0.2.0" onChange={e => update({ version: e.target.value })} /></label><label className="field"><span>Chuyên mục</span><select value={content.category} onChange={e => update({ category: e.target.value as NewsContent['category'] })}>{Object.entries(NEWS_CATEGORIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
              <label className="field"><span>Giới thiệu ngắn</span><textarea value={content.summary} rows={3} maxLength={400} placeholder="Những điểm đáng chú ý của bản cập nhật…" onChange={e => update({ summary: e.target.value })} /></label>
              <label className="field news-editor-body"><span>Nội dung</span><small>Dùng # hoặc ## ở đầu dòng cho tiêu đề, - cho danh sách. Xuống dòng trống để tách đoạn.</small><textarea value={content.body} maxLength={30_000} rows={12} placeholder={'## Điểm mới\n\n- Nội dung mới…\n- Điều chỉnh…\n\n## Sửa lỗi\n\nMô tả các lỗi đã sửa.'} onChange={e => update({ body: e.target.value })} /></label>
              <label className="news-editor-pin"><input type="checkbox" checked={content.pinned} onChange={e => update({ pinned: e.target.checked })} /> Ghim lên đầu danh sách</label>
            </fieldset>}
            {error && <p role="alert" className="library-error">{error}</p>}{message && <p role="status" className="news-editor-message">{message}</p>}
            {active && <footer className="news-editor-actions"><button className="btn" disabled={busy || loading || (!dirty && !!active.revision)} onClick={() => void run('save')}>{busy ? <Spinner /> : <Icon name="lucide:save" />} Lưu nháp</button><button className="btn btn-primary" disabled={busy || loading} onClick={() => void run('publish')}>{active.published ? 'Đăng thay đổi' : 'Đăng bài'}</button><div />{active.published && <button className="btn" disabled={busy || dirty || loading} onClick={() => void run('unpublish')}>Gỡ bài</button>}{!!active.revision && <button className="btn btn-danger" disabled={busy || loading} onClick={() => void run('delete')}>Xóa</button>}</footer>}
          </section>
        </div>
      </div>
    </dialog>
  </>;
}
