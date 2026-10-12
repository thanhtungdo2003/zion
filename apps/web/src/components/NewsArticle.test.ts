import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArticleBody } from './NewsArticle';
afterEach(() => vi.unstubAllGlobals());

describe('news article rendering', () => {
  it('renders headings and lists while escaping HTML from the author', () => {
    vi.stubGlobal('React', React);
    const html = renderToStaticMarkup(React.createElement(ArticleBody, { text: '## Điểm mới\n\n- Một thay đổi\n- Thay đổi khác\n\n<script>alert(1)</script>' }));
    expect(html).toContain('<h3>Điểm mới</h3>');
    expect(html).toContain('<li>Một thay đổi</li>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});
