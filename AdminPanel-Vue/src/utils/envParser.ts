// .env 文件解析与构建
// 规则：
// - # 开头行 或 空行 → 注释/分隔
// - KEY=VALUE → 配置项
// - VALUE 以 ' 开头（单引号）→ 支持多行值，直到遇到以 ' 结尾的行
// - 类型推断：
//   · 'true'/'false' → boolean
//   · 纯整数（无小数点、无其它字符）→ integer
//   · /key|api|token|secret|password/i 关键字 → password（masked input）
//   · 含 \n 或 长度 > 60 → textarea
//   · 其他 → text input

export type FieldType = 'boolean' | 'integer' | 'password' | 'textarea' | 'text'

export interface EnvComment {
  kind: 'comment'
  raw: string            // 原始行内容（含 #）
  text: string           // 去掉 # 后的文本
  blank: boolean         // 是否是空行
}

export interface EnvEntry {
  kind: 'entry'
  key: string
  value: string
  type: FieldType
  multiline: boolean     // 原文是否用了单引号多行形式
  description: string    // 该字段上方的连续注释拼接而来
}

export type EnvItem = EnvComment | EnvEntry

export function parseEnv(content: string): EnvItem[] {
  const lines = content.split(/\r?\n/)
  const items: EnvItem[] = []
  // stickyComments: 遇到空行/新注释段才重置，连续 entries 共享上一段注释
  // newComments: 本 entry 上方"紧邻"的新增注释（没有空行隔开的）
  let stickyComments: string[] = []
  let newComments: string[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed === '') {
      items.push({ kind: 'comment', raw: line, text: '', blank: true })
      // 空行 → 注释段落结束，sticky 清空
      stickyComments = []
      newComments = []
      i++
      continue
    }

    if (trimmed.startsWith('#')) {
      const text = trimmed.replace(/^#+\s?/, '')
      items.push({ kind: 'comment', raw: line, text, blank: false })
      newComments.push(text)
      i++
      continue
    }

    const eq = line.indexOf('=')
    if (eq === -1) {
      items.push({ kind: 'comment', raw: line, text: line, blank: false })
      i++
      continue
    }

    const key = line.slice(0, eq).trim()
    const rawValue = line.slice(eq + 1)
    let value = rawValue
    let multiline = false

    if (rawValue.trim().startsWith("'")) {
      multiline = true
      const firstIdx = rawValue.indexOf("'")
      const body = rawValue.slice(firstIdx + 1)
      if (body.endsWith("'") && body.length > 0) {
        value = body.slice(0, -1)
      } else {
        const parts: string[] = [body]
        i++
        while (i < lines.length) {
          const nextLine = lines[i]
          if (nextLine.trim().endsWith("'")) {
            const trimmedLast = nextLine.slice(0, nextLine.lastIndexOf("'"))
            parts.push(trimmedLast)
            break
          }
          parts.push(nextLine)
          i++
        }
        value = parts.join('\n')
      }
    } else {
      value = rawValue.trim()
    }

    // 优先用紧邻的新注释；否则继承上一个 sticky 注释段
    const description = (newComments.length ? newComments : stickyComments).join(' ')
    // 本 entry 使用的注释段提升为 sticky（供紧跟的兄弟字段继承）
    if (newComments.length) stickyComments = newComments
    newComments = []

    items.push({
      kind: 'entry',
      key,
      value,
      type: inferType(key, value, multiline),
      multiline,
      description,
    })
    i++
  }

  return items
}

export function buildEnv(items: EnvItem[]): string {
  const out: string[] = []
  for (const item of items) {
    if (item.kind === 'comment') {
      out.push(item.raw)
      continue
    }
    const useQuotes = item.multiline || item.value.includes('\n') || item.value.includes('#')
    if (useQuotes) {
      out.push(`${item.key}='${item.value}'`)
    } else {
      out.push(`${item.key}=${item.value}`)
    }
  }
  return out.join('\n')
}

function inferType(key: string, value: string, multiline: boolean): FieldType {
  const lower = value.toLowerCase().trim()
  if (lower === 'true' || lower === 'false') return 'boolean'
  if (/^-?\d+$/.test(value.trim())) return 'integer'
  if (isSensitiveKey(key)) return 'password'
  if (multiline || value.includes('\n') || value.length > 60) return 'textarea'
  return 'text'
}

/**
 * 判断字段名是否为敏感凭据。
 * - 命中关键词：KEY / TOKEN / SECRET / PASSWORD / PASSWD / CREDENTIAL
 * - 排除明显非密钥后缀：URL / ENDPOINT / HOST / PORT / PATH / DIR / NAME / MODEL /
 *   ID / TYPE / PROVIDER / BASE / LIST / COUNT / SIZE / TIMEOUT / ENABLED
 *
 * 举例：
 *   OPENAI_API_KEY → password ✓
 *   API_URL / API_BASE_URL → text  ✗（不打码）
 *   ADMIN_PASSWORD → password ✓
 *   KEY_NAME → text ✗
 */
function isSensitiveKey(key: string): boolean {
  const upper = key.toUpperCase()
  const nonSensitiveSuffix = /(URL|ENDPOINT|HOST|PORT|PATH|DIR|NAME|MODEL|ID|TYPE|PROVIDER|BASE|LIST|COUNT|SIZE|TIMEOUT|ENABLED|MODE|VERSION|LEVEL)$/
  if (nonSensitiveSuffix.test(upper)) return false
  return /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|APIKEY)/.test(upper)
}
