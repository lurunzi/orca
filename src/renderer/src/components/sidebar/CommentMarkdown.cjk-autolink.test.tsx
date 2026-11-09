import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import CommentMarkdown from './CommentMarkdown'
import { MarkdownPreviewBody } from '@/components/editor/markdown-preview/render-tree/MarkdownPreviewBody'

describe('CommentMarkdown CJK autolinks', () => {
  it('closes emphasis around a bare url that ends at CJK punctuation', () => {
    const content =
      '下载：**https://example.com/ujes/**（2026-10-23 已上线）。\n\n_https://example.com/a_。'
    for (const markup of [
      renderToStaticMarkup(<CommentMarkdown content={content} />),
      renderToStaticMarkup(<MarkdownPreviewBody content={content} components={{}} />)
    ]) {
      expect(markup).toMatch(
        /<strong[^>]*><a href="https:\/\/example\.com\/ujes\/"[^>]*>https:\/\/example\.com\/ujes\/<\/a><\/strong>（2026-10-23 已上线）。/
      )
      expect(markup).toMatch(
        /<em[^>]*><a href="https:\/\/example\.com\/a"[^>]*>https:\/\/example\.com\/a<\/a><\/em>。/
      )
      expect(markup).not.toContain('**')
    }
  })

  it('keeps an unpaired delimiter after a cut url as text, with the url intact', () => {
    expect(
      renderToStaticMarkup(<CommentMarkdown content="见 https://example.com/a?b=1&c=_*。" />)
    ).toContain(
      '<a href="https://example.com/a?b=1&amp;c=" target="_blank" rel="noreferrer" class="underline underline-offset-2 text-foreground/80 hover:text-foreground">https://example.com/a?b=1&amp;c=</a>_*。'
    )
  })
})
