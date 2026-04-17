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

const ROOT_DIR = process.env.VCP_ROOT || __dirname;
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
  // Plugin Store commands
  'plugin-list': {
    handler: 'pluginStore:listRemote',
    desc: '查看远程可用插件列表',
    note: '',
  },
  'plugin-installed': {
    handler: 'pluginStore:listInstalled',
    desc: '查看本地已安装的插件',
    note: '',
  },
  'plugin-install': {
    handler: 'pluginStore:install',
    desc: '安装插件 (node maintain.js plugin-install <name>)',
    note: '',
  },
  'plugin-update': {
    handler: 'pluginStore:update',
    desc: '更新插件 (node maintain.js plugin-update <name>)',
    note: '',
  },
  'plugin-uninstall': {
    handler: 'pluginStore:uninstall',
    desc: '卸载插件 (node maintain.js plugin-uninstall <name>)',
    note: '',
  },
  'plugin-check-updates': {
    handler: 'pluginStore:checkUpdates',
    desc: '检查插件是否有可用更新',
    note: '',
  },
};

function printHelp() {
  console.log('\n  VCPtoolbox-Junior 维护工具\n');
  console.log('  Usage: node maintain.js <command> [args...]\n');
  console.log('  维护命令:\n');

  const mainCmds = Object.entries(COMMANDS).filter(([_, c]) => !c.handler);
  const pluginCmds = Object.entries(COMMANDS).filter(([_, c]) => c.handler);

  const maxLen = Math.max(...Object.keys(COMMANDS).map(k => k.length));
  for (const [name, cmd] of mainCmds) {
    const pad = ' '.repeat(maxLen - name.length + 2);
    const note = cmd.note ? ` (${cmd.note})` : '';
    console.log(`    ${name}${pad}${cmd.desc}${note}`);
  }

  console.log('\n  插件管理:\n');
  for (const [name, cmd] of pluginCmds) {
    const pad = ' '.repeat(maxLen - name.length + 2);
    console.log(`    ${name}${pad}${cmd.desc}`);
  }

  console.log('\n  Examples:');
  console.log('    node maintain.js rebuild-tags');
  console.log('    node maintain.js plugin-list');
  console.log('    node maintain.js plugin-install GoogleSearch');
  console.log('    node maintain.js plugin-check-updates');
  console.log('');
}

async function runPluginCommand(handler, args) {
  const [module, method] = handler.split(':');
  const store = require(`./modules/${module}`);

  try {
    switch (method) {
      case 'listRemote': {
        console.log('\n  远程可用插件:\n');
        const plugins = await store.listRemote();
        const maxName = Math.max(...plugins.map(p => p.displayName.length), 10);
        console.log(`    ${'名称'.padEnd(maxName)}  类型               版本`);
        console.log(`    ${'─'.repeat(maxName)}  ${'─'.repeat(17)}  ${'─'.repeat(6)}`);
        for (const p of plugins) {
          console.log(`    ${p.displayName.padEnd(maxName)}  ${p.pluginType.padEnd(17)}  ${p.version}`);
        }
        console.log(`\n  共 ${plugins.length} 个可用插件\n`);
        break;
      }
      case 'listInstalled': {
        console.log('\n  本地已安装插件:\n');
        const plugins = await store.listInstalled();
        if (plugins.length === 0) {
          console.log('    (无已安装插件)');
        } else {
          for (const p of plugins) {
            const status = p.enabled ? '✅' : '⏸️ ';
            console.log(`    ${status} ${p.displayName} (${p.version}) [${p.pluginType}]`);
          }
        }
        console.log('');
        break;
      }
      case 'install': {
        const name = args[0];
        if (!name) {
          console.error('  Error: 请指定插件名称\n  Usage: node maintain.js plugin-install <name>');
          process.exit(1);
        }
        console.log(`\n  正在安装 ${name}...`);
        const result = await store.install(name);
        console.log(`  ${result.success ? '✅' : '❌'} ${result.message}\n`);
        break;
      }
      case 'update': {
        const name = args[0];
        if (!name) {
          console.error('  Error: 请指定插件名称\n  Usage: node maintain.js plugin-update <name>');
          process.exit(1);
        }
        console.log(`\n  正在更新 ${name}...`);
        const result = await store.update(name);
        console.log(`  ${result.success ? '✅' : '❌'} ${result.message}\n`);
        break;
      }
      case 'uninstall': {
        const name = args[0];
        if (!name) {
          console.error('  Error: 请指定插件名称\n  Usage: node maintain.js plugin-uninstall <name>');
          process.exit(1);
        }
        console.log(`\n  正在卸载 ${name}...`);
        const result = await store.uninstall(name);
        console.log(`  ${result.success ? '✅' : '❌'} ${result.message}\n`);
        break;
      }
      case 'checkUpdates': {
        console.log('\n  检查插件更新...\n');
        const updates = await store.checkUpdates();
        if (updates.length === 0) {
          console.log('  所有插件已是最新版本 ✅\n');
        } else {
          for (const u of updates) {
            console.log(`  📦 ${u.displayName}: ${u.currentVersion} → ${u.latestVersion}`);
          }
          console.log(`\n  共 ${updates.length} 个插件可更新`);
          console.log('  使用 node maintain.js plugin-update <name> 进行更新\n');
        }
        break;
      }
    }
  } catch (err) {
    console.error(`  Error: ${err.message}`);
    process.exit(1);
  }
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

  // Plugin store commands (async)
  if (cmd.handler) {
    runPluginCommand(cmd.handler, args.slice(1)).catch(err => {
      console.error(`  Error: ${err.message}`);
      process.exit(1);
    });
    return;
  }

  // Script-based commands
  const scriptPath = path.join(SCRIPTS_DIR, cmd.script);
  const extraArgs = args.slice(1);

  let proc;
  if (cmd.runtime === 'python') {
    // 不用 shell:true（避免 DEP0190）；node 分支早已无 shell，python 同样可由 PATH 直接解析
    proc = spawn('python', [scriptPath, ...extraArgs], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
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
