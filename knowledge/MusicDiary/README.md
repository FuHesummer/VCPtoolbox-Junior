# MusicDiary 音乐日记本

> Nova / Hornet / Aemeath 等预设 Agent 提示词里引用的音乐日记本。

## 用途

此日记本用于记录 Agent（如 Nova、Hornet、Aemeath）和用户之间关于**音乐**的共同记忆：

- 用户分享过的歌单、专辑、单曲
- Agent 对某首歌的感受、联想、推荐
- 某个时间点两人一起听过的背景音乐
- 用户在某种情绪下偏爱的音乐类型

## 提示词引用方式

```
《《MusicDiary日记本:2::Group》》
```

解释：
- `《《...》》` = 混合阈值 RAG 检索（V8）
- `MusicDiary日记本` = 本目录名 + "日记本" 后缀惯例
- `:2` = Top-K 乘数 2（增加召回量）
- `::Group` = 启用语义分组（相关片段聚合）

## 如何填充内容

### 方式 1：AI 自动写入（推荐）
让 Agent 在日常对话中通过 `DailyNoteWrite` 工具写入：
```
「始」DailyNoteWrite:
  notebook:MusicDiary
  content:今天用户分享了周杰伦的《晴天》，他说下雨天听这首特别治愈...
「末」
```

### 方式 2：手动创建 Markdown/文本文件
直接在本目录下创建 `.md` / `.txt` 文件，每个文件一条日记：
```
MusicDiary/
├── 2026-04-16_周杰伦_晴天.md
├── 2026-04-10_雨天歌单.md
└── ...
```

### 方式 3：示例种子（删除或改写）
本目录的 `示例_音乐偏好.txt` 是示例种子，告诉 RAG 系统这里有内容可检索。
你可以：
- 直接删掉示例，让 Agent 从零建立自己的记忆
- 或改写成用户真实的音乐偏好种子，给 Agent 一个起点

## 目录约定

路径：`knowledge/MusicDiary/`
- 纳入 Junior RAG 检索索引（首次启动时自动扫描）
- 受 `KNOWLEDGEBASE_PERSIST_FOLDERS` 配置保护（列入则索引持久化到磁盘）

## 检索参数调优

如果 AI 回复里看不到音乐日记内容被激活：
1. 写几条实际日记（至少 3-5 条）
2. 检查 AdminPanel → 日记本管理 → MusicDiary 文件夹是否有文件
3. 在 RAG 调参页面调整 TagMemo 阈值或 Top-K
