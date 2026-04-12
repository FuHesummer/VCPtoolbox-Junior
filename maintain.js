#!/usr/bin/env node

/**
 * VCPtoolbox-Junior 维护脚本统一入口
 *
 * Usage: node maintain.js <command> [args...]
 *
 * 所有子脚本以项目根目录为 cwd 执行，无需修改脚本内的相对路径。
 */

const { spawn } = require('child_process');
const path = require('path');

const ROOT_DIR = __dirname;
const SCRIPTS_DIR = path.join(ROOT_DIR, 'scripts');

const COMMANDS = {
  'rebuild-tags': {
    script: 'rebuild_tag_index_custom.js',
    runtime: 'node',
    desc: '重建标签向量索引（清理黑名单/重复标签）',
    note: '需停止服务器',
  },
  'rebuild-vectors': {
    script: 'rebuild_vector_indexes.js',
    runtime: 'node',
    desc: '重建全部向量索引（修复 ghost ID 不同步）',
    note: '需停止服务器',
  },
  'repair-db': {
    script: 'repair_database.js',
    runtime: 'node',
    desc: '修复数据库重复标签（无需重新嵌入）',
    note: '需停止服务器',
  },
  'sync-tags': {
    script: 'sync_missing_tags.js',
    runtime: 'node',
    desc: '扫描日记文件，补齐 DB 中缺失的标签',
    note: '需服务器运行中',
  },
  'classify': {
    script: 'diary-semantic-classifier.js',
    runtime: 'node',
    desc: '日记语义分类（支持 --source --categories --dry-run 等参数）',
    note: '需外部嵌入 API',
  },
  'tag-batch': {
    script: 'diary-tag-batch-processor.js',
    runtime: 'node',
    desc: '批量修复/生成日记 Tag 行（调用 LLM）',
    note: '需外部 LLM API',
  },
  'backup': {
    script: 'backup_vcp.py',
    runtime: 'python',
    desc: '备份项目文件（txt/md/env/json → zip）',
    note: '',
  },
};

function printHelp() {
  console.log('\n  VCPtoolbox-Junior 维护工具\n');
  console.log('  Usage: node maintain.js <command> [args...]\n');
  console.log('  Commands:\n');

  const maxLen = Math.max(...Object.keys(COMMANDS).map(k => k.length));
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    const pad = ' '.repeat(maxLen - name.length + 2);
    const note = cmd.note ? ` (${cmd.note})` : '';
    console.log(`    ${name}${pad}${cmd.desc}${note}`);
  }

  console.log('\n  Examples:');
  console.log('    node maintain.js rebuild-tags');
  console.log('    node maintain.js classify --source "知识库" --categories "分类1,分类2" --dry-run');
  console.log('    node maintain.js tag-batch dailynote/某个文件夹');
  console.log('    node maintain.js backup backup_20260329.zip');
  console.log('');
}

function run() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    process.exit(0);
  }

  const cmd = COMMANDS[command];
  if (!cmd) {
    console.error(`  Error: unknown command "${command}"\n`);
    printHelp();
    process.exit(1);
  }

  const scriptPath = path.join(SCRIPTS_DIR, cmd.script);
  const extraArgs = args.slice(1);

  let proc;
  if (cmd.runtime === 'python') {
    proc = spawn('python', [scriptPath, ...extraArgs], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      shell: true,
    });
  } else {
    proc = spawn('node', [scriptPath, ...extraArgs], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    });
  }

  proc.on('error', (err) => {
    console.error(`  Failed to start: ${err.message}`);
    process.exit(1);
  });

  proc.on('close', (code) => {
    process.exit(code || 0);
  });
}

run();
