# TimelineOrganizer — 时间线整理器

Junior 本体第 10 个核心插件。为每个 Agent 管理生平时间线条目（按日期 + summary），一键生成 Markdown 格式时间线 txt 到 `TVStxt/`。

## 功能

- **日期树编辑器**：按 `YYYY-MM-DD` 组织 entry，每个 entry 含 summary
- **一键生成**：按日期升序排列 → 生成 `TVStxt/Timeline_{Agent}.txt`（Markdown）
- **变量集成**：生成后配合 TvsEditor「加入全局」按钮一键注册为 `{{Var时间线_Agent}}`

## 数据存储

- 编辑态 JSON：`Plugin/TimelineOrganizer/data/{Agent}_timeline.json`
- 生成态 TXT：`TVStxt/Timeline_{Agent}.txt`

## JSON 结构

```json
{
  "character": "Nova",
  "lastUpdated": "2026-04-16",
  "entries": {
    "2026-04-01": [
      { "summary": "第一次见到主人..." }
    ],
    "2026-04-05": [
      { "summary": "..." }
    ]
  }
}
```

## 源起

上游 VCPToolBox 有个离线工具脚本 `timeline整理器.py`（读 `timeline/*.json` → 输出 `timeline已整理/*.txt`），但是 JSON 没有编辑器、TXT 没有消费方，纯人肉工具。

Junior 版做成了协议化核心插件：可视化编辑 + 自动落地到 Junior 变量体系 + 装本体即可用。

## 后端 API

所有端点通过 `/admin_api/plugins/TimelineOrganizer/api/*` 访问。

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/agents` | 列出所有 Agent + 是否已有 timeline |
| GET | `/timeline/:agent` | 读取 `data/{agent}_timeline.json` |
| POST | `/timeline/:agent` | 保存 JSON（writeFile 风格，直接落盘 body） |
| POST | `/generate/:agent` | 按日期排序 → 生成 TVStxt/Timeline_{agent}.txt |
| DELETE | `/timeline/:agent` | 删除 JSON + TXT |
