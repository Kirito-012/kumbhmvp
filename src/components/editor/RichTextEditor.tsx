'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extensions'
import { Bold, Italic, List, ListOrdered, Quote } from 'lucide-react'
import { cn } from '@/lib/utils'

export function RichTextEditor({
  content,
  onChange,
  placeholder = 'Describe the issue…',
  editable = true,
}: {
  content?: string
  onChange?: (html: string) => void
  placeholder?: string
  editable?: boolean
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder,
        emptyEditorClass:
          'before:content-[attr(data-placeholder)] before:text-muted/60 before:float-left before:h-0 before:pointer-events-none',
      }),
    ],
    content: content ?? '',
    editable,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          'min-h-[140px] px-3 py-2.5 text-sm text-foreground outline-none ' +
          '[&_p]:my-1.5 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 ' +
          '[&_blockquote]:my-1.5 [&_blockquote]:border-l-2 [&_blockquote]:border-border-strong [&_blockquote]:pl-3 [&_blockquote]:text-muted-strong ' +
          '[&_strong]:font-semibold [&_em]:italic',
      },
    },
    onUpdate: ({ editor }) => onChange?.(editor.getHTML()),
  })

  if (!editor) return null

  return (
    <div className="overflow-hidden rounded-lg border border-border-strong bg-overlay focus-within:border-accent/50 focus-within:bg-overlay-strong focus-within:ring-2 focus-within:ring-accent/20">
      {editable && (
        <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
          <ToolbarButton
            active={editor.isActive('bold')}
            onClick={() => editor.chain().focus().toggleBold().run()}
            label="Bold"
          >
            <Bold className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive('italic')}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            label="Italic"
          >
            <Italic className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            label="Bullet list"
          >
            <List className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            label="Numbered list"
          >
            <ListOrdered className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive('blockquote')}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            label="Quote"
          >
            <Quote className="h-3.5 w-3.5" />
          </ToolbarButton>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  )
}

function ToolbarButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors',
        active
          ? 'bg-accent-soft text-accent-strong'
          : 'text-muted-strong hover:bg-overlay-strong hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
