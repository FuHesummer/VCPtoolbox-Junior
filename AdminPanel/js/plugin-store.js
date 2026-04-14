// AdminPanel/js/plugin-store.js
import { apiFetch, showMessage } from './utils.js';

const API = '/admin_api';

// In-memory cache to avoid repeated API calls on page switch
let _storeCache = null;
let _storeCacheTime = 0;
const FRONTEND_CACHE_TTL = 10 * 60 * 1000; // 10 minutes in-memory

/**
 * Initialize the plugin store UI
 */
export async function initializePluginStore() {
    const container = document.getElementById('plugin-store-content');
    if (!container) return;

    // Use in-memory cache if fresh
    const now = Date.now();
    if (_storeCache && (now - _storeCacheTime) < FRONTEND_CACHE_TTL) {
        renderPluginStore(container, _storeCache.remote, _storeCache.installedNames, _storeCache.installed);
        return;
    }

    container.innerHTML = '<p class="loading-text">正在加载插件商店...</p>';

    try {
        const [remoteRes, installedRes] = await Promise.all([
            apiFetch(`${API}/plugin-store/remote`, {}, false),
            apiFetch(`${API}/plugin-store/installed`, {}, false)
        ]);

        const remotePlugins = remoteRes?.plugins || [];
        const installedPlugins = installedRes?.plugins || [];
        const installedNames = new Set(installedPlugins.map(p => p.name));

        // Cache results
        _storeCache = { remote: remotePlugins, installedNames, installed: installedPlugins };
        _storeCacheTime = now;

        renderPluginStore(container, remotePlugins, installedNames, installedPlugins);
    } catch (error) {
        container.innerHTML = `<p class="error-message">加载插件商店失败: ${error.message}</p>`;
    }
}

function renderPluginStore(container, remotePlugins, installedNames, installedPlugins) {
    // Group by category (derive from pluginType)
    const categories = {
        'hybridservice': { label: 'AI 协作 / 混合服务', plugins: [] },
        'synchronous': { label: '同步工具', plugins: [] },
        'asynchronous': { label: '异步工具', plugins: [] },
        'messagePreprocessor': { label: '消息预处理器', plugins: [] },
        'static': { label: '静态注入', plugins: [] },
        'service': { label: '后台服务', plugins: [] },
    };

    for (const plugin of remotePlugins) {
        const cat = categories[plugin.pluginType] || categories['synchronous'];
        cat.plugins.push({
            ...plugin,
            installed: installedNames.has(plugin.name)
        });
    }

    let html = `
        <div class="store-header">
            <h3>插件商店</h3>
            <div class="store-stats">
                <span class="stat-badge">${remotePlugins.length} 可用</span>
                <span class="stat-badge installed">${installedNames.size} 已安装</span>
            </div>
            <button class="btn-check-updates" onclick="window._pluginStoreCheckUpdates()">检查更新</button>
        </div>
        <div id="store-update-banner"></div>
        <div class="store-search">
            <input type="text" id="plugin-search-input" placeholder="搜索插件..." oninput="window._pluginStoreFilter(this.value)">
        </div>
        <div class="store-grid" id="store-grid">
    `;

    for (const [type, cat] of Object.entries(categories)) {
        if (cat.plugins.length === 0) continue;
        html += `<div class="store-category" data-type="${type}">
            <h4>${cat.label} <span class="cat-count">(${cat.plugins.length})</span></h4>
            <div class="store-cards">`;

        for (const plugin of cat.plugins) {
            html += renderPluginCard(plugin);
        }

        html += `</div></div>`;
    }

    html += '</div>';
    container.innerHTML = html;

    // Register global handlers
    window._pluginStoreInstall = installPlugin;
    window._pluginStoreUninstall = uninstallPlugin;
    window._pluginStoreCheckUpdates = checkUpdates;
    window._pluginStoreFilter = filterPlugins;
}

function renderPluginCard(plugin) {
    const statusClass = plugin.installed ? 'installed' : 'available';
    const statusText = plugin.installed ? '已安装' : '可安装';
    const actionBtn = plugin.installed
        ? `<button class="btn-uninstall" onclick="window._pluginStoreUninstall('${plugin.name}', this)">卸载</button>`
        : `<button class="btn-install" onclick="window._pluginStoreInstall('${plugin.name}', this)">安装</button>`;

    return `
        <div class="plugin-card ${statusClass}" data-name="${plugin.name}" data-display="${plugin.displayName}">
            <div class="card-header">
                <span class="card-name">${plugin.displayName}</span>
                <span class="card-version">v${plugin.version}</span>
            </div>
            <p class="card-desc">${plugin.description || '暂无描述'}</p>
            <div class="card-footer">
                <span class="card-status ${statusClass}">${statusText}</span>
                ${actionBtn}
            </div>
        </div>
    `;
}

/**
 * 调用商店的 install 接口（单次）
 */
async function _doInstall(name) {
    return apiFetch(`${API}/plugin-store/install/${name}`, {
        method: 'POST',
        body: JSON.stringify({ force: true })
    });
}

/**
 * 装完一个插件后，更新卡片 UI 为"已安装"态
 */
function _markCardInstalled(name) {
    const card = document.querySelector(`.plugin-card[data-name="${name}"]`);
    if (!card) return;
    card.classList.remove('available');
    card.classList.add('installed');
    const status = card.querySelector('.card-status');
    if (status) { status.textContent = '已安装'; status.className = 'card-status installed'; }
    const btn = card.querySelector('button');
    if (btn) {
        btn.textContent = '已安装';
        btn.className = 'btn-uninstall';
        btn.onclick = () => window._pluginStoreUninstall(name, btn);
        btn.disabled = false;
    }
}

async function installPlugin(name, btn) {
    btn.disabled = true;
    btn.textContent = '检查依赖...';

    // 先解析插件间依赖（requires 协议），若有缺失且用户确认 → 连锁安装
    let deps = null;
    try {
        deps = await apiFetch(`${API}/plugin-store/resolve-deps/${name}`, { suppressErrorToast: true });
    } catch (e) {
        // 404 = 插件不在商店，其他 = 网络/解析失败
        showMessage(`无法解析依赖: ${e.message}`, 'error');
        btn.textContent = '安装';
        btn.disabled = false;
        return;
    }

    // 仓库里找不到某个依赖 → 阻塞安装
    if (deps.notFound && deps.notFound.length > 0) {
        showMessage(`安装失败：依赖插件 [${deps.notFound.join(', ')}] 在商店仓库中不存在，请联系仓库维护者补齐。`, 'error');
        btn.textContent = '安装';
        btn.disabled = false;
        return;
    }

    // 有未安装的依赖 → 弹确认框
    if (deps.missing && deps.missing.length > 0) {
        const depLines = deps.missing.map(d => `  · ${d.displayName} (${d.name}) v${d.version}`).join('\n');
        const alreadyHint = deps.already.length > 0 ? `\n\n已安装的依赖（将跳过）：\n  · ${deps.already.join(', ')}` : '';
        const ok = confirm(
            `插件 "${name}" 依赖以下插件，是否一同安装？\n\n${depLines}${alreadyHint}\n\n点"确定"将按依赖→主插件顺序串行安装。`
        );
        if (!ok) {
            showMessage(`已取消安装 ${name}`, 'info');
            btn.textContent = '安装';
            btn.disabled = false;
            return;
        }
        // 先装依赖（按 requires 声明的顺序）
        for (const dep of deps.missing) {
            btn.textContent = `装依赖 ${dep.name}...`;
            try {
                const r = await _doInstall(dep.name);
                if (!r.success) {
                    showMessage(`依赖 ${dep.name} 安装失败: ${r.message}`, 'error');
                    btn.textContent = '安装';
                    btn.disabled = false;
                    return;
                }
                _markCardInstalled(dep.name);
            } catch (err) {
                showMessage(`依赖 ${dep.name} 安装异常: ${err.message}`, 'error');
                btn.textContent = '安装';
                btn.disabled = false;
                return;
            }
        }
    }

    // 装主插件
    btn.textContent = '安装中...';
    try {
        const result = await _doInstall(name);
        if (result.success) {
            _storeCache = null; // Invalidate cache
            const depSummary = deps.missing && deps.missing.length > 0
                ? `（同时装了依赖: ${deps.missing.map(d => d.name).join(', ')}）`
                : '';
            showMessage(`插件 ${name} 安装成功！${depSummary}重启服务后生效。`, 'success');
            _markCardInstalled(name);
        } else {
            showMessage(result.message, 'error');
            btn.textContent = '安装';
            btn.disabled = false;
        }
    } catch (error) {
        showMessage(`安装失败: ${error.message}`, 'error');
        btn.textContent = '安装';
        btn.disabled = false;
    }
}

async function uninstallPlugin(name, btn) {
    if (!confirm(`确定要卸载插件 "${name}" 吗？`)) return;

    btn.disabled = true;
    btn.textContent = '卸载中...';

    try {
        const result = await apiFetch(`${API}/plugin-store/uninstall/${name}`, {
            method: 'POST',
            body: JSON.stringify({})
        });

        if (result.success) {
            _storeCache = null; // Invalidate cache
            showMessage(`插件 ${name} 已卸载`, 'success');
            btn.textContent = '安装';
            btn.className = 'btn-install';
            btn.onclick = () => window._pluginStoreInstall(name, btn);
            const card = btn.closest('.plugin-card');
            if (card) {
                card.classList.remove('installed');
                card.classList.add('available');
                card.querySelector('.card-status').textContent = '可安装';
                card.querySelector('.card-status').className = 'card-status available';
            }
        } else {
            showMessage(result.message, 'error');
            btn.textContent = '卸载';
        }
    } catch (error) {
        showMessage(`卸载失败: ${error.message}`, 'error');
        btn.textContent = '卸载';
    }
    btn.disabled = false;
}

async function checkUpdates() {
    const banner = document.getElementById('store-update-banner');
    if (!banner) return;

    banner.innerHTML = '<p class="loading-text">检查更新...</p>';

    try {
        const result = await apiFetch(`${API}/plugin-store/updates`);
        const updates = result?.updates || [];

        if (updates.length === 0) {
            banner.innerHTML = '<p class="update-ok">所有插件已是最新版本 ✅</p>';
            setTimeout(() => { banner.innerHTML = ''; }, 3000);
        } else {
            let html = '<div class="update-list">';
            html += `<p class="update-title">📦 ${updates.length} 个插件有可用更新：</p>`;
            for (const u of updates) {
                html += `<div class="update-item">
                    <span>${u.displayName}: ${u.currentVersion} → ${u.latestVersion}</span>
                    <button class="btn-update" onclick="window._pluginStoreInstall('${u.name}', this)">更新</button>
                </div>`;
            }
            html += '</div>';
            banner.innerHTML = html;
        }
    } catch (error) {
        banner.innerHTML = `<p class="error-message">检查更新失败: ${error.message}</p>`;
    }
}

function filterPlugins(query) {
    const cards = document.querySelectorAll('.plugin-card');
    const q = query.toLowerCase();
    cards.forEach(card => {
        const name = (card.dataset.name || '').toLowerCase();
        const display = (card.dataset.display || '').toLowerCase();
        const desc = (card.querySelector('.card-desc')?.textContent || '').toLowerCase();
        card.style.display = (name.includes(q) || display.includes(q) || desc.includes(q)) ? '' : 'none';
    });
}
