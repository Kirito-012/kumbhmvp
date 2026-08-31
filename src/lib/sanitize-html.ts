import DOMPurify from 'isomorphic-dompurify'

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'u',
  's',
  'a',
  'ul',
  'ol',
  'li',
  'blockquote',
  'code',
  'pre',
  'h1',
  'h2',
  'h3',
]

/** Sanitizes Tiptap-authored HTML before it's stored. Never trust client-supplied HTML. */
export function sanitizeHtml(html: string) {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR: ['href', 'target', 'rel'] })
}
