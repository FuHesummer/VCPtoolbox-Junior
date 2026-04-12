# Coding Style Guide

> 此文件定义团队编码规范，所有 LLM 工具在修改代码时必须遵守。

## General
- Prefer small, reviewable changes; avoid unrelated refactors.
- Keep functions short (<50 lines); avoid deep nesting (<=3 levels).
- Name things explicitly; no single-letter variables except loop counters.
- Handle errors explicitly; never swallow errors silently.

## JavaScript / Node.js
- CommonJS (`module.exports`), no ESM-only dependencies.
- Use `try/catch` + fallback defaults for env var parsing.
- DebugMode as log gate — don't bypass.
- Async/await over raw promises; no callback hell.
- Use `path.join()` for all file paths; never hardcode separators.

## Git Commits
- Conventional Commits, imperative mood.
- Atomic commits: one logical change per commit.
- Co-Authored-By trailer for AI-assisted commits.

## Testing
- Smoke test: module loads without error.
- Integration: server starts and stays alive.
- CI verifies native module loading on all platforms.

## Security
- Never log secrets (tokens/keys/cookies/JWT).
- Validate inputs at trust boundaries.
- File path operations: normalize + root prefix check.
- No `spawn(..., shell: true)` without strict input validation.
