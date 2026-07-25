// 最小安全 Markdown 渲染：只認得週報用得到的語法（標題/粗體/清單/段落）
// 不用 dangerouslySetInnerHTML——逐行解析成 React element，AI 內容不會被當 HTML 執行

/** 一行文字中的 **粗體** 片段拆成 React 節點 */
function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    return part
  })
}

interface Block {
  type: 'h1' | 'h2' | 'h3' | 'ul' | 'ol' | 'p'
  lines: string[]
}

function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = []
  let para: string[] = []

  function flushPara() {
    if (para.length > 0) {
      blocks.push({ type: 'p', lines: [para.join(' ')] })
      para = []
    }
  }

  const rawLines = markdown.replace(/\r\n/g, '\n').split('\n')
  let i = 0
  while (i < rawLines.length) {
    const line = rawLines[i]
    const trimmed = line.trim()

    if (trimmed === '') {
      flushPara()
      i++
      continue
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed)
    if (heading) {
      flushPara()
      const level = heading[1].length
      blocks.push({ type: level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3', lines: [heading[2]] })
      i++
      continue
    }

    if (/^[-*]\s+/.test(trimmed)) {
      flushPara()
      const items: string[] = []
      while (i < rawLines.length && /^[-*]\s+/.test(rawLines[i].trim())) {
        items.push(rawLines[i].trim().replace(/^[-*]\s+/, ''))
        i++
      }
      blocks.push({ type: 'ul', lines: items })
      continue
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      flushPara()
      const items: string[] = []
      while (i < rawLines.length && /^\d+\.\s+/.test(rawLines[i].trim())) {
        items.push(rawLines[i].trim().replace(/^\d+\.\s+/, ''))
        i++
      }
      blocks.push({ type: 'ol', lines: items })
      continue
    }

    para.push(trimmed)
    i++
  }
  flushPara()
  return blocks
}

export default function MarkdownView({ markdown, className = '' }: { markdown: string; className?: string }) {
  const blocks = parseBlocks(markdown)

  return (
    <div className={className}>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'h1':
            return (
              <h1 key={i} className="mt-5 text-xl font-bold text-slate-800 first:mt-0">
                {renderInline(b.lines[0])}
              </h1>
            )
          case 'h2':
            return (
              <h2 key={i} className="mt-5 text-lg font-bold text-teal-800 first:mt-0">
                {renderInline(b.lines[0])}
              </h2>
            )
          case 'h3':
            return (
              <h3 key={i} className="mt-3 font-bold text-slate-700">
                {renderInline(b.lines[0])}
              </h3>
            )
          case 'ul':
            return (
              <ul key={i} className="mt-2 list-disc space-y-1.5 pl-5">
                {b.lines.map((line, j) => (
                  <li key={j} className="leading-relaxed">
                    {renderInline(line)}
                  </li>
                ))}
              </ul>
            )
          case 'ol':
            return (
              <ol key={i} className="mt-2 list-decimal space-y-1.5 pl-5">
                {b.lines.map((line, j) => (
                  <li key={j} className="leading-relaxed">
                    {renderInline(line)}
                  </li>
                ))}
              </ol>
            )
          default:
            return (
              <p key={i} className="mt-2 leading-relaxed text-slate-600">
                {renderInline(b.lines[0])}
              </p>
            )
        }
      })}
    </div>
  )
}
