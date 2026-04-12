# Development Workflow Rules

> 此文件定义 LLM 开发工作流的强制规则。

## Full Flow

### feat (新功能)
1. 理解需求，分析影响范围
2. 读取现有代码，理解模式
3. 编写实现代码
4. 验证模块加载无报错
5. 更新文档（若 API/协议变更）
6. 确认服务器可正常启动

### fix (缺陷修复)
1. 复现问题，确认症状
2. 定位根因（grep/ACE 搜索所有引用）
3. 修复代码
4. 验证修复后模块加载正常
5. 回归：服务器启动无新错误

### refactor (重构)
1. 确保当前服务器可正常启动
2. 小步重构，每步可验证
3. 重构后所有 require 路径正确
4. 不改变外部行为

## Context Logging

当你做出以下决策时，追加到 `.context/current/branches/<当前分支>/session.log`：

1. **方案选择**：选 A 不选 B 时，记录原因
2. **Bug 发现与修复**：根因 + 修复方法
3. **API/架构决策**：接口设计选择
4. **放弃的方案**：为什么放弃

## Plugin Development Checklist

- [ ] plugin-manifest.json 字段完整
- [ ] 入口文件可独立运行/加载
- [ ] config.env.example 包含所有配置项
- [ ] 若有版本升级配置变更 → 写 config-migrations.json
- [ ] 若需管理界面 → admin/index.html 遵循协议规范
- [ ] README.md 说明用途和配置方法
