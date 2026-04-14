// AdminPanel/js/plugins.js
// Plugin Manager — card-based management page (no sidebar injection)
import { apiFetch, showMessage } from './utils.js';
import { parseEnvToList, buildEnvStringForPlugin, createFormGroup, createCommentOrEmptyElement } from './config.js';

const API_BASE_URL = '/admin_api';
let originalPluginConfigs = {};
let pluginUiPrefs = {}; // { pluginName: { dashboardCards: bool, adminNav: bool } }
let pluginUpdates = {}; // { pluginName: { currentVersion, latestVersion } }
let pluginUpdatesCacheTime = 0;
const UPDATE_CACHE_TTL = 10 * 60 * 1000; // 10 min

/** Get current plugin UI prefs (loaded on init). */
export function getPluginUiPrefs() { return pluginUiPrefs; }

/**
 * Load plugin list — creates config sections and injects sidebar nav for plugins with adminNav.
 */
export async function loadPluginList() {
    const configDetailsContainer = document.getElementById('config-details-container');
    if (!configDetailsContainer) return;

    try {
        const [plugins, prefs] = await Promise.all([
            apiFetch(`${API_BASE_URL}/plugins`),
            apiFetch(`${API_BASE_URL}/plugin-ui-prefs`, {}, false).catch(() => ({})),
        ]);
        pluginUiPrefs = prefs || {};

        // Clear existing dynamic sections and nav items
        configDetailsContainer.querySelectorAll('section.dynamic-plugin-section').forEach(sec => sec.remove());
        document.querySelectorAll('.plugin-nav-item').forEach(el => el.remove());

        plugins.forEach(plugin => {
            createPluginConfigSection(plugin, configDetailsContainer);
        });

        // Inject sidebar nav items for plugins declaring adminNav
        injectPluginNavItems(plugins, configDetailsContainer);

        // Store for plugin manager page
        window._pluginListCache = plugins;
    } catch (error) {
        console.error('Failed to load plugin list:', error);
    }
}

/**
 * For plugins with manifest.adminNav, inject sidebar nav items and page sections.
 * adminNav schema: { title: string, icon: string }
 */
function injectPluginNavItems(plugins, container) {
    // Find the "插件" category anchor in sidebar — insert nav items after "插件管理"
    const pluginManagerLink = document.querySelector('a[data-target="plugin-manager"]');
    const insertAfter = pluginManagerLink?.closest('li');
    if (!insertAfter) return;

    for (const plugin of plugins) {
        const nav = plugin.manifest?.adminNav;
        if (!nav || !plugin.enabled) continue;
        if (!plugin.hasAdminPage) continue;

        const pluginName = plugin.manifest.name;

        // Check UI prefs — default to enabled if not set
        const prefs = pluginUiPrefs[pluginName];
        if (prefs && prefs.adminNav === false) continue;
        const navId = `plugin-nav-${pluginName}`;
        const sectionId = `plugin-nav-${pluginName}-section`;

        // Skip if already injected (shouldn't happen after cleanup, but be safe)
        if (document.getElementById(navId)) continue;

        // Create sidebar nav item
        const li = document.createElement('li');
        li.id = navId;
        li.className = 'plugin-nav-item';
        const a = document.createElement('a');
        a.href = '#';
        a.dataset.target = `plugin-nav-${pluginName}`;
        a.innerHTML = `<span class="material-symbols-outlined">${nav.icon || 'extension'}</span>${nav.title || plugin.manifest.displayName || pluginName}`;
        li.appendChild(a);
        insertAfter.parentNode.insertBefore(li, insertAfter.nextSibling);

        // Create hidden section
        const section = document.createElement('section');
        section.id = sectionId;
        section.classList.add('config-section', 'dynamic-plugin-section', 'plugin-nav-section');
        section.dataset.pluginName = pluginName;
        section.innerHTML = `
            <div class="page-header">
                <span class="material-symbols-outlined page-icon">${nav.icon || 'extension'}</span>
                <div>
                    <h2>${nav.title || plugin.manifest.displayName || pluginName}</h2>
                    <p class="page-desc">${plugin.manifest.description || ''}</p>
                </div>
            </div>
            <div class="plugin-page-content" data-plugin="${pluginName}">
                <p class="loading-text">加载中...</p>
            </div>
        `;
        container.appendChild(section);
    }
}

/**
 * Load plugin admin page content into the nav section (called by navigateTo).
 * Fetches HTML from /admin_api/plugins/{name}/admin-page, extracts body, injects inline.
 */
export async function loadPluginNavPage(pluginName) {
    const section = document.getElementById(`plugin-nav-${pluginName}-section`);
    if (!section) return;

    const contentDiv = section.querySelector('.plugin-page-content');
    if (!contentDiv) return;

    // Skip if already loaded
    if (contentDiv.dataset.loaded === 'true') return;

    try {
        const resp = await fetch(`${API_BASE_URL}/plugins/${encodeURIComponent(pluginName)}/admin-page`, { credentials: 'same-origin' });
        if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
        let html = await resp.text();

        // Extract body content from full HTML document
        html = extractPageBody(html);

        contentDiv.innerHTML = html;
        contentDiv.dataset.loaded = 'true';

        // Execute <script> tags
        const scripts = contentDiv.querySelectorAll('script');
        for (const oldScript of scripts) {
            const newScript = document.createElement('script');
            if (oldScript.src) {
                // Rewrite relative src to admin-assets endpoint
                if (!oldScript.src.startsWith('http') && !oldScript.src.startsWith('/')) {
                    newScript.src = `${API_BASE_URL}/plugins/${encodeURIComponent(pluginName)}/admin-assets/${oldScript.src}`;
                } else {
                    newScript.src = oldScript.src;
                }
            } else {
                newScript.textContent = oldScript.textContent;
            }
            oldScript.replaceWith(newScript);
        }

        // Rewrite relative CSS <link> hrefs to admin-assets endpoint
        const links = contentDiv.querySelectorAll('link[rel="stylesheet"]');
        for (const link of links) {
            const href = link.getAttribute('href');
            if (href && !href.startsWith('http') && !href.startsWith('/')) {
                link.href = `${API_BASE_URL}/plugins/${encodeURIComponent(pluginName)}/admin-assets/${href}`;
            }
        }

        // Rewrite relative <img> src
        const imgs = contentDiv.querySelectorAll('img');
        for (const img of imgs) {
            const src = img.getAttribute('src');
            if (src && !src.startsWith('http') && !src.startsWith('/') && !src.startsWith('data:')) {
                img.src = `${API_BASE_URL}/plugins/${encodeURIComponent(pluginName)}/admin-assets/${src}`;
            }
        }
    } catch (error) {
        contentDiv.innerHTML = `<p class="error-message">加载插件页面失败: ${error.message}</p>`;
        console.error(`[Plugins] Failed to load nav page for ${pluginName}:`, error);
    }
}

/**
 * Extract <body> content from a full HTML document string.
 * Also extracts <style> tags from <head> and prepends them.
 */
function extractPageBody(html) {
    // If it doesn't look like a full document, return as-is (it's a fragment)
    if (!html.includes('<html') && !html.includes('<!DOCTYPE') && !html.includes('<!doctype')) {
        return html;
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Collect <style> and <link rel="stylesheet"> from <head>
    let headStyles = '';
    doc.head.querySelectorAll('style, link[rel="stylesheet"]').forEach(el => {
        headStyles += el.outerHTML;
    });

    return headStyles + doc.body.innerHTML;
}

/**
 * Initialize the Plugin Manager page (card-based UI).
 */
export function initializePluginManager() {
    const container = document.getElementById('plugin-manager-content');
    if (!container) return;

    const plugins = window._pluginListCache;
    if (!plugins) {
        container.innerHTML = '<p class="loading-text">正在加载插件列表...</p>';
        apiFetch(`${API_BASE_URL}/plugins`).then(data => {
            window._pluginListCache = data;
            renderPluginManager(container, data);
        }).catch(err => {
            container.innerHTML = `<p class="error-message">加载失败: ${err.message}</p>`;
        });
        return;
    }

    renderPluginManager(container, plugins);
}

function renderPluginManager(container, plugins) {
    plugins.sort((a, b) => (a.manifest.displayName || a.manifest.name).localeCompare(b.manifest.displayName || b.manifest.name));

    const enabled = plugins.filter(p => p.enabled);
    const disabled = plugins.filter(p => !p.enabled);

    let html = `
        <div class="store-header">
            <h3>已安装插件</h3>
            <div class="store-stats">
                <span class="stat-badge">${plugins.length} 总计</span>
                <span class="stat-badge installed">${enabled.length} 启用</span>
            </div>
        </div>
        <div class="store-search">
            <input type="text" id="pm-search" placeholder="搜索插件..." oninput="window._pmFilter(this.value)">
        </div>
        <div id="pm-grid">
    `;

    if (enabled.length > 0) {
        html += `<div class="store-category"><h4>已启用 <span class="cat-count">(${enabled.length})</span></h4><div class="store-cards">`;
        enabled.forEach(p => { html += renderManagerCard(p); });
        html += `</div></div>`;
    }

    if (disabled.length > 0) {
        html += `<div class="store-category"><h4>已禁用 <span class="cat-count">(${disabled.length})</span></h4><div class="store-cards">`;
        disabled.forEach(p => { html += renderManagerCard(p); });
        html += `</div></div>`;
    }

    html += '</div>';
    container.innerHTML = html;

    // Register global handlers
    window._pmFilter = filterManagerPlugins;
    window._pmToggle = togglePlugin;
    window._pmOpenAdmin = openPluginAdminModal;
    window._pmOpenConfig = openPluginConfig;
    window._pmFeatureToggle = togglePluginFeature;
    window._pmUpdate = updatePlugin;

    // Silently check for updates and inject badges
    checkPluginUpdates();
}

function renderManagerCard(plugin) {
    const name = plugin.manifest.name;
    const displayName = plugin.manifest.displayName || name;
    const desc = plugin.manifest.description || '暂无描述';
    const version = plugin.manifest.version || '-';
    const isEnabled = plugin.enabled;
    const statusClass = isEnabled ? 'installed' : '';
    const toggleLabel = isEnabled ? '禁用' : '启用';
    const toggleClass = isEnabled ? 'btn-uninstall' : 'btn-install';

    let actions = `<button class="${toggleClass}" onclick="window._pmToggle('${name}', ${!isEnabled}, this)">${toggleLabel}</button>`;

    // Single "设置" button — opens admin modal (custom page or auto-generated config form)
    if (plugin.hasAdminPage) {
        actions += ` <button class="btn-install" onclick="window._pmOpenAdmin('${name}', '${displayName.replace(/'/g, "\\'")}')">设置</button>`;
    }

    // Feature toggles for dashboardCards / adminNav
    const hasDashCards = Array.isArray(plugin.manifest.dashboardCards) && plugin.manifest.dashboardCards.length > 0;
    const hasNavPage = plugin.manifest.adminNav && plugin.hasAdminPage;
    let featureToggles = '';
    if (isEnabled && (hasDashCards || hasNavPage)) {
        const prefs = pluginUiPrefs[name] || {};
        featureToggles = '<div class="plugin-feature-toggles">';
        if (hasDashCards) {
            const checked = prefs.dashboardCards !== false ? 'checked' : '';
            featureToggles += `
                <label class="feature-toggle" title="在仪表盘显示此插件的卡片">
                    <input type="checkbox" ${checked} onchange="window._pmFeatureToggle('${name}', 'dashboardCards', this.checked)">
                    <span class="feature-toggle-label">仪表盘卡片</span>
                </label>`;
        }
        if (hasNavPage) {
            const checked = prefs.adminNav !== false ? 'checked' : '';
            featureToggles += `
                <label class="feature-toggle" title="在左侧导航显示此插件的页面">
                    <input type="checkbox" ${checked} onchange="window._pmFeatureToggle('${name}', 'adminNav', this.checked)">
                    <span class="feature-toggle-label">导航页面</span>
                </label>`;
        }
        featureToggles += '</div>';
    }

    return `
        <div class="plugin-card ${statusClass}" data-name="${name}" data-display="${displayName}">
            <div class="plugin-update-badge" data-update-for="${name}"></div>
            <div class="card-header">
                <span class="card-name">${displayName}</span>
                <span class="card-version">v${version}</span>
            </div>
            <p class="card-desc">${desc}</p>
            <div class="card-meta">
                <span class="card-type">${plugin.manifest.pluginType || ''}</span>
                ${plugin.isDistributed ? '<span class="card-type">☁️ 分布式</span>' : ''}
            </div>
            ${featureToggles}
            <div class="card-footer">${actions}</div>
        </div>
    `;
}

async function togglePlugin(name, enable, btn) {
    const displayName = btn.closest('.plugin-card')?.dataset.display || name;
    if (!confirm(`确定要${enable ? '启用' : '禁用'}插件 "${displayName}" 吗？`)) return;

    btn.disabled = true;
    btn.textContent = enable ? '启用中...' : '禁用中...';

    try {
        const result = await apiFetch(`${API_BASE_URL}/plugins/${name}/toggle`, {
            method: 'POST',
            body: JSON.stringify({ enable })
        });
        showMessage(result.message, 'success');

        // Reload data and re-render
        const plugins = await apiFetch(`${API_BASE_URL}/plugins`);
        window._pluginListCache = plugins;
        const container = document.getElementById('plugin-manager-content');
        if (container) renderPluginManager(container, plugins);
    } catch (error) {
        btn.disabled = false;
        btn.textContent = enable ? '启用' : '禁用';
    }
}

/**
 * Toggle a plugin UI feature (dashboardCards / adminNav) on or off.
 */
async function togglePluginFeature(pluginName, feature, enabled) {
    if (!pluginUiPrefs[pluginName]) pluginUiPrefs[pluginName] = {};
    pluginUiPrefs[pluginName][feature] = enabled;

    try {
        await apiFetch(`${API_BASE_URL}/plugin-ui-prefs`, {
            method: 'POST',
            body: JSON.stringify(pluginUiPrefs)
        });
        showMessage(`${feature === 'dashboardCards' ? '仪表盘卡片' : '导航页面'}已${enabled ? '启用' : '关闭'}，刷新页面后生效`, 'success');
    } catch (error) {
        // Revert on failure
        pluginUiPrefs[pluginName][feature] = !enabled;
        showMessage(`保存失败: ${error.message}`, 'error');
    }
}

/**
 * Silently check for plugin updates (cache-first, 10min TTL).
 * Injects update badges into cards that have newer versions available.
 */
async function checkPluginUpdates() {
    const now = Date.now();
    // Use cache if fresh
    if (now - pluginUpdatesCacheTime < UPDATE_CACHE_TTL && Object.keys(pluginUpdates).length > 0) {
        injectUpdateBadges();
        return;
    }

    try {
        const result = await apiFetch(`${API_BASE_URL}/plugin-store/updates`, {}, false);
        const updates = result?.updates || [];
        pluginUpdates = {};
        for (const u of updates) {
            pluginUpdates[u.name] = { currentVersion: u.currentVersion, latestVersion: u.latestVersion };
        }
        pluginUpdatesCacheTime = now;
        injectUpdateBadges();
    } catch {
        // Silent fail — update check is non-critical
    }
}

function injectUpdateBadges() {
    document.querySelectorAll('.plugin-update-badge').forEach(badge => {
        const name = badge.dataset.updateFor;
        const info = pluginUpdates[name];
        if (info) {
            badge.innerHTML = `<button class="btn-update-badge" onclick="window._pmUpdate('${name}', this)" title="${info.currentVersion} → ${info.latestVersion}">
                <span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px;">upgrade</span> 更新
            </button>`;
            badge.classList.add('has-update');
        } else {
            badge.innerHTML = '';
            badge.classList.remove('has-update');
        }
    });
}

async function updatePlugin(name, btn) {
    if (!confirm(`确定要更新插件 "${name}" 吗？更新后需要重启服务生效。`)) return;
    btn.disabled = true;
    btn.textContent = '更新中...';

    try {
        const result = await apiFetch(`${API_BASE_URL}/plugin-store/install/${name}`, {
            method: 'POST',
            body: JSON.stringify({ force: true })
        });
        if (result.success) {
            showMessage(`插件 ${name} 更新成功！重启服务后生效。`, 'success');
            btn.textContent = '已更新';
            delete pluginUpdates[name];
            const badge = btn.closest('.plugin-update-badge');
            if (badge) { badge.innerHTML = ''; badge.classList.remove('has-update'); }
        } else {
            showMessage(result.message || '更新失败', 'error');
            btn.textContent = '更新';
            btn.disabled = false;
        }
    } catch (error) {
        showMessage(`更新失败: ${error.message}`, 'error');
        btn.textContent = '更新';
        btn.disabled = false;
    }
}

function openPluginConfig(pluginName) {
    // Navigate to the plugin's config section
    const sectionId = `plugin-${pluginName}-config`;
    const link = document.querySelector(`a[data-target="${sectionId}"]`);
    if (link) {
        link.click();
    } else {
        // Manually activate the section
        document.querySelectorAll('.config-section').forEach(s => s.classList.remove('active-section'));
        document.querySelectorAll('.sidebar nav li a').forEach(l => l.classList.remove('active'));
        const section = document.getElementById(`${sectionId}-section`);
        if (section) {
            section.classList.add('active-section');
            loadPluginConfig(pluginName);
            document.getElementById('config-details-container')?.scrollTo(0, 0);
        } else {
            showMessage(`插件 ${pluginName} 的配置区域未找到`, 'error');
        }
    }
}

function filterManagerPlugins(query) {
    const cards = document.querySelectorAll('#pm-grid .plugin-card');
    const q = query.toLowerCase();
    cards.forEach(card => {
        const name = (card.dataset.name || '').toLowerCase();
        const display = (card.dataset.display || '').toLowerCase();
        const desc = (card.querySelector('.card-desc')?.textContent || '').toLowerCase();
        card.style.display = (name.includes(q) || display.includes(q) || desc.includes(q)) ? '' : 'none';
    });
}

/**
 * Create plugin config section (hidden, activated when user clicks "配置").
 */
function createPluginConfigSection(plugin, container) {
    const pluginSection = document.createElement('section');
    pluginSection.id = `plugin-${plugin.manifest.name}-config-section`;
    pluginSection.classList.add('config-section', 'dynamic-plugin-section');

    const originalName = plugin.manifest.name;
    const displayName = plugin.manifest.displayName || originalName;

    let descriptionHtml = plugin.manifest.description || '暂无描述';
    if (plugin.manifest.version) descriptionHtml += ` (版本: ${plugin.manifest.version})`;
    if (!plugin.enabled) descriptionHtml += ' <span class="plugin-disabled-badge">(已禁用)</span>';

    let titleHtml = `${displayName} <span class="plugin-original-name">(${originalName})</span> 配置`;

    // Back button to return to plugin manager
    pluginSection.innerHTML = `
        <div style="margin-bottom: 16px;">
            <button class="plugin-admin-button" onclick="
                document.querySelectorAll('.config-section').forEach(s => s.classList.remove('active-section'));
                document.getElementById('plugin-manager-section').classList.add('active-section');
                document.querySelectorAll('.sidebar nav li a').forEach(l => l.classList.remove('active'));
                document.querySelector('a[data-target=plugin-manager]')?.classList.add('active');
            ">← 返回插件管理</button>
        </div>
        <h2>${titleHtml}</h2>
        <p class="plugin-meta">${descriptionHtml}</p>
    `;

    const form = document.createElement('form');
    form.id = `plugin-${plugin.manifest.name}-config-form`;
    pluginSection.appendChild(form);
    container.appendChild(pluginSection);

    if (plugin.configEnvContent) {
        originalPluginConfigs[plugin.manifest.name] = parseEnvToList(plugin.configEnvContent);
    } else {
        originalPluginConfigs[plugin.manifest.name] = [];
    }
}

/**
 * Load and render plugin config form.
 */
export async function loadPluginConfig(pluginName) {
    const form = document.getElementById(`plugin-${pluginName}-config-form`);
    if (!form) return;
    form.innerHTML = '';

    try {
        const pluginData = (await apiFetch(`${API_BASE_URL}/plugins`)).find(p => p.manifest.name === pluginName);
        if (!pluginData) throw new Error(`Plugin data for ${pluginName} not found.`);

        const manifest = pluginData.manifest;
        const configEnvContent = pluginData.configEnvContent || "";
        originalPluginConfigs[pluginName] = parseEnvToList(configEnvContent);

        const schemaFieldsContainer = document.createElement('div');
        const customFieldsContainer = document.createElement('div');
        let hasSchemaFields = false;
        let hasCustomFields = false;

        const configSchema = manifest.configSchema || {};
        const presentInEnv = new Set(originalPluginConfigs[pluginName].filter(e => !e.isCommentOrEmpty).map(e => e.key));

        for (const key in configSchema) {
            hasSchemaFields = true;
            const expectedType = configSchema[key];
            const entry = originalPluginConfigs[pluginName].find(e => e.key === key && !e.isCommentOrEmpty);
            const value = entry ? entry.value : (manifest.defaults?.[key] ?? '');
            const isMultiline = entry ? entry.isMultilineQuoted : (String(value).includes('\n'));

            let descriptionHtml = manifest.configSchemaDescriptions?.[key] || `Schema 定义: ${key}`;
            if (entry) descriptionHtml += ` <span class="defined-in">(当前在插件 .env 中定义)</span>`;
            else if (manifest.defaults?.[key] !== undefined) descriptionHtml += ` <span class="defined-in">(使用默认值)</span>`;
            else descriptionHtml += ` <span class="defined-in">(未设置)</span>`;

            const formGroup = createFormGroup(key, value, expectedType, descriptionHtml, true, pluginName, false, isMultiline);
            schemaFieldsContainer.appendChild(formGroup);
            presentInEnv.delete(key);
        }

        originalPluginConfigs[pluginName].forEach((entry, index) => {
            if (entry.isCommentOrEmpty) {
                customFieldsContainer.appendChild(createCommentOrEmptyElement(entry.value, `${pluginName}-comment-${index}`));
            } else if (presentInEnv.has(entry.key)) {
                hasCustomFields = true;
                const descriptionHtml = `自定义配置项: ${entry.key} <span class="defined-in">(插件 .env)</span>`;
                const formGroup = createFormGroup(entry.key, entry.value, 'string', descriptionHtml, true, pluginName, true, entry.isMultilineQuoted);
                customFieldsContainer.appendChild(formGroup);
            }
        });

        if (hasSchemaFields) {
            const schemaTitle = document.createElement('h3');
            schemaTitle.textContent = 'Schema 定义的配置';
            form.appendChild(schemaTitle);
            form.appendChild(schemaFieldsContainer);
        }
        if (hasCustomFields || originalPluginConfigs[pluginName].some(e => e.isCommentOrEmpty)) {
            const customTitle = document.createElement('h3');
            customTitle.textContent = '自定义 .env 配置项';
            form.appendChild(customTitle);
            form.appendChild(customFieldsContainer);
        }

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'form-actions';

        const addConfigButton = document.createElement('button');
        addConfigButton.type = 'button';
        addConfigButton.textContent = '添加自定义配置项';
        addConfigButton.classList.add('add-config-btn');
        addConfigButton.addEventListener('click', () => addCustomConfigFieldToPluginForm(form, pluginName, customFieldsContainer));
        actionsDiv.appendChild(addConfigButton);

        const submitButton = document.createElement('button');
        submitButton.type = 'submit';
        submitButton.textContent = `保存 ${pluginName} 配置`;
        actionsDiv.appendChild(submitButton);
        form.appendChild(actionsDiv);

        form.removeEventListener('submit', handlePluginFormSubmit);
        form.addEventListener('submit', handlePluginFormSubmit);

        // Invocation Commands Editor
        if (manifest.capabilities?.invocationCommands?.length > 0) {
            const commandsSection = createInvocationCommandsEditor(pluginName, manifest.capabilities.invocationCommands);
            const pluginFormActions = form.querySelector('.form-actions');
            if (pluginFormActions) form.insertBefore(commandsSection, pluginFormActions);
            else form.appendChild(commandsSection);
        }
    } catch (error) {
        form.innerHTML = `<p class="error-message">加载插件 ${pluginName} 配置失败: ${error.message}</p>`;
    }
}

async function handlePluginFormSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const pluginName = form.id.match(/plugin-(.*?)-config-form/)[1];
    const currentPluginEntries = originalPluginConfigs[pluginName] || [];
    const newConfigString = buildEnvStringForPlugin(form, currentPluginEntries, pluginName);

    try {
        await apiFetch(`${API_BASE_URL}/plugins/${pluginName}/config`, {
            method: 'POST',
            body: JSON.stringify({ content: newConfigString })
        });
        showMessage(`${pluginName} 配置已保存！`, 'success');
        loadPluginConfig(pluginName);
    } catch (error) { /* handled by apiFetch */ }
}

function addCustomConfigFieldToPluginForm(form, pluginName, containerToAddTo) {
    const key = prompt("请输入新配置项键名:");
    if (!key || !key.trim()) return;
    const normalizedKey = key.trim().replace(/\s+/g, '_');

    if (originalPluginConfigs[pluginName]?.some(e => e.key === normalizedKey)) {
        showMessage(`配置项 "${normalizedKey}" 已存在！`, 'error');
        return;
    }

    const descriptionHtml = `自定义配置项: ${normalizedKey} <span class="defined-in">(新添加)</span>`;
    const formGroup = createFormGroup(normalizedKey, '', 'string', descriptionHtml, true, pluginName, true, false);

    if (!originalPluginConfigs[pluginName]) originalPluginConfigs[pluginName] = [];
    originalPluginConfigs[pluginName].push({ key: normalizedKey, value: '', isCommentOrEmpty: false, isMultilineQuoted: false });

    const actionsDiv = form.querySelector('.form-actions');
    if (actionsDiv) form.insertBefore(formGroup, actionsDiv);
    else form.appendChild(formGroup);
}

function createInvocationCommandsEditor(pluginName, commands) {
    const section = document.createElement('div');
    section.className = 'invocation-commands-section';
    const title = document.createElement('h3');
    title.textContent = '调用命令 AI 指令编辑';
    section.appendChild(title);

    commands.forEach(cmd => {
        const id = cmd.commandIdentifier || cmd.command;
        if (!id) return;

        const item = document.createElement('div');
        item.className = 'command-item';
        item.innerHTML = `<h4>命令: ${id}</h4>`;

        const group = document.createElement('div');
        group.className = 'form-group';
        const label = document.createElement('label');
        label.textContent = '指令描述:';
        group.appendChild(label);

        const textarea = document.createElement('textarea');
        textarea.className = 'command-description-edit';
        textarea.rows = Math.max(5, (cmd.description || '').split('\n').length + 2);
        textarea.value = cmd.description || '';
        group.appendChild(textarea);

        const actions = document.createElement('div');
        actions.className = 'form-actions';
        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.textContent = '保存描述';
        const status = document.createElement('p');
        status.className = 'status command-status';

        saveBtn.addEventListener('click', async () => {
            status.textContent = '保存中...';
            try {
                await apiFetch(`${API_BASE_URL}/plugins/${pluginName}/commands/${id}/description`, {
                    method: 'POST',
                    body: JSON.stringify({ description: textarea.value })
                });
                showMessage(`指令 "${id}" 描述已保存`, 'success');
                status.textContent = '已保存';
                status.className = 'status command-status success';
            } catch (e) {
                status.textContent = `失败: ${e.message}`;
                status.className = 'status command-status error';
            }
        });

        actions.appendChild(saveBtn);
        group.appendChild(actions);
        group.appendChild(status);
        item.appendChild(group);
        section.appendChild(item);
    });

    return section;
}

// Listen for config field deletion
document.addEventListener('config-field-deleted', (e) => {
    const { pluginName, key } = e.detail;
    if (pluginName && originalPluginConfigs[pluginName]) {
        originalPluginConfigs[pluginName] = originalPluginConfigs[pluginName].filter(entry => entry.key !== key);
    }
});

/**
 * Plugin admin modal (iframe).
 */
function openPluginAdminModal(pluginName, displayName) {
    const existing = document.getElementById('plugin-admin-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'plugin-admin-modal';
    modal.className = 'plugin-admin-modal-overlay';
    modal.innerHTML = `
        <div class="plugin-admin-modal-container">
            <div class="plugin-admin-modal-header">
                <h3>${displayName} - 设置</h3>
                <button class="plugin-admin-modal-close" title="关闭">&times;</button>
            </div>
            <div class="plugin-admin-modal-body">
                <iframe src="/admin_api/plugins/${pluginName}/admin-page" frameborder="0"></iframe>
            </div>
        </div>
    `;

    modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.classList.contains('plugin-admin-modal-close')) modal.remove();
    });

    const escHandler = (e) => {
        if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);

    document.body.appendChild(modal);
}
