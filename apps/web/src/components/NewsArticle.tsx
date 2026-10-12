import { NEWS_CATEGORIES, type NewsContent } from '@zion/shared';

/** Small, deliberately text-only format: headings and lists, with no executable HTML. */
export function ArticleBody({ text }: { text: string }) {
  const blocks = text.replaceAll('\r', '').split(/\n\s*\n/);
  return <div className="news-body">{blocks.map((block, i) => {
    const lines = block.split('\n');
    if (lines.every(line => /^[-*] /.test(line))) return <ul key={i}>{lines.map((line, j) => <li key={j}>{line.slice(2)}</li>)}</ul>;
    return <div key={i}>{lines.map((line, j) => line.startsWith('## ') ? <h3 key={j}>{line.slice(3)}</h3> : line.startsWith('# ') ? <h2 key={j}>{line.slice(2)}</h2> : <p key={j}>{line}</p>)}</div>;
  })}</div>;
}

export function NewsArticle({ post, publishedAt }: { post: NewsContent; publishedAt?: string }) {
  return <article className="news-article">
    <div className="library-eyebrow"><span>{NEWS_CATEGORIES[post.category]}</span>{post.version && <b>{post.version}</b>}{post.pinned && <span>Đã ghim</span>}</div>
    <h1>{post.title || 'Tiêu đề bản cập nhật'}</h1>
    {publishedAt && <time dateTime={publishedAt}>{new Date(publishedAt).toLocaleDateString('vi-VN', { day: '2-digit', month: 'long', year: 'numeric' })}</time>}
    <p className="news-summary">{post.summary || 'Giới thiệu ngắn về những thay đổi trong bản cập nhật.'}</p>
    <ArticleBody text={post.body} />
  </article>;
}
