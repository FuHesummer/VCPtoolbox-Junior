// 轻量 Markdown → HTML 渲染工具
// 用于论坛帖子 / 楼层内容渲染
// 不依赖外部库，先 escape 再标记替换，避免 XSS

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 轻量 Markdown 渲染
 * 支持：
 *   - 代码块 ```lang ... ```
 *   - 行内代码 `code`
 *   - 标题 # / ## / ### / ####
 *   - 粗体 **text**
 *   - 斜体 *text* / _text_
 *   - 删除线 ~~text~~
 *   - 链接 [text](url)
 *   - 引用块 > text
 *   - 无序列表 - item / * item
 *   - 有序列表 1. item
 *   - 水平线 ---
 *   - 段落（空行分隔）+ 换行
 */
export function renderMarkdown(raw: string): string {
  if (!raw) return ''

  // 1. 先抽出代码块，用占位符替换（避免内部被其他规则破坏）
  const codeBlocks: string[] = []
  let text = raw.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    const langClass = lang ? ` class="lang-${escapeHtml(lang)}"` : ''
    codeBlocks.push(`<pre class="md-code"><code${langClass}>${escapeHtml(code)}</code></pre>`)
    return `\x00CODEBLOCK${codeBlocks.length - 1}\x00`
  })

  // 2. 全局 escape（保护普通内容）
  text = escapeHtml(text)

  // 3. 按行处理块级元素
  const lines = text.split('\n')
  const out: string[] = []
  let listStack: Array<'ul' | 'ol'> = []
  let blockquoteOpen = false

  const closeLists = () => {
    while (listStack.length > 0) {
      out.push(`</${listStack.pop()}>`)
    }
  }
  const closeBlockquote = () => {
    if (blockquoteOpen) {
      out.push('</blockquote>')
      blockquoteOpen = false
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // 空行
    if (!trimmed) {
      closeLists()
      closeBlockquote()
      out.push('')
      continue
    }

    // 水平线
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      closeLists()
      closeBlockquote()
      out.push('<hr />')
      continue
    }

    // 标题
    const h = trimmed.match(/^(#{1,4})\s+(.+)$/)
    if (h) {
      closeLists()
      closeBlockquote()
      const level = h[1].length
      out.push(`<h${level + 2} class="md-h${level}">${inline(h[2])}</h${level + 2}>`)
      continue
    }

    // 引用块
    const bq = trimmed.match(/^&gt;\s?(.*)$/)
    if (bq) {
      closeLists()
      if (!blockquoteOpen) { out.push('<blockquote class="md-bq">'); blockquoteOpen = true }
      out.push(`<p>${inline(bq[1])}</p>`)
      continue
    }
    closeBlockquote()

    // 无序列表
    const ul = trimmed.match(/^[-*]\s+(.+)$/)
    if (ul) {
      if (listStack[listStack.length - 1] !== 'ul') {
        closeLists()
        out.push('<ul class="md-ul">'); listStack.push('ul')
      }
      out.push(`<li>${inline(ul[1])}</li>`)
      continue
    }

    // 有序列表
    const ol = trimmed.match(/^\d+\.\s+(.+)$/)
    if (ol) {
      if (listStack[listStack.length - 1] !== 'ol') {
        closeLists()
        out.push('<ol class="md-ol">'); listStack.push('ol')
      }
      out.push(`<li>${inline(ol[1])}</li>`)
      continue
    }

    // 代码块占位
    if (/^\x00CODEBLOCK\d+\x00$/.test(trimmed)) {
      closeLists()
      out.push(trimmed)
      continue
    }

    // 普通段落
    closeLists()
    out.push(`<p>${inline(line)}</p>`)
  }

  closeLists()
  closeBlockquote()

  let html = out.join('\n')

  // 4. 还原代码块
  html = html.replace(/\x00CODEBLOCK(\d+)\x00/g, (_m, idx) => codeBlocks[parseInt(idx, 10)])

  return html
}

/**
 * 行内标记处理（假设 text 已 HTML-escape 过）
 * 顺序：行内代码 → 粗体 → 斜体 → 删除线 → 链接
 */
function inline(text: string): string {
  // 行内代码：`code` → <code>code</code>
  text = text.replace(/`([^`]+?)`/g, (_m, code) => `<code class="md-inline-code">${code}</code>`)

  // 粗体：**text** → <strong>
  text = text.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')

  // 斜体：*text* 或 _text_（不贪心，排除已被粗体消耗的）
  text = text.replace(/(?<![*\w])\*([^*\n]+?)\*(?![*\w])/g, '<em>$1</em>')
  text = text.replace(/(?<![_\w])_([^_\n]+?)_(?![_\w])/g, '<em>$1</em>')

  // 删除线：~~text~~
  text = text.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>')

  // 链接：[text](url) — url 仅允许 http(s) 和相对路径
  text = text.replace(
    /\[([^\]\n]+?)\]\(([^)\s]+?)\)/g,
    (_m, linkText, url) => {
      const safeUrl = /^(https?:\/\/|\/|#)/.test(url) ? url : '#'
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="md-link">${linkText}</a>`
    },
  )

  return text
}

/**
 * 生成纯文本摘要（用于列表卡片预览）
 * 去掉所有 markdown 标记，截取前 N 字
 */
export function markdownToExcerpt(raw: string, maxLen = 120): string {
  if (!raw) return ''
  let s = raw
    .replace(/```[\s\S]*?```/g, '[代码块]')
    .replace(/`[^`]+`/g, '')
    .replace(/[*_~]+/g, '')
    .replace(/#+\s*/g, '')
    .replace(/>\s*/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  if (s.length > maxLen) s = s.slice(0, maxLen) + '...'
  return s
}
