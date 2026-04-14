// AdminPanel/js/newapi-monitor.js
// NewAPI usage monitor — vanilla JS port of upstream Vue component

const API = '/admin_api/newapi-monitor';
let initialized = false;

function fmt(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
}

export async function initializeNewApiMonitor() {
    const root = document.getElementById('newapi-monitor-root');
    if (!root) return;

    // Avoid duplicate fetch on rapid nav clicks; allow refresh by re-entering
    if (initialized && root.dataset.loaded === 'true') return;

    root.innerHTML = '<p style="text-align:center;padding:40px;color:var(--secondary-text);">加载中...</p>';

    try {
        // Use raw fetch to avoid global error toasts when NewAPI is not configured
        async function safeFetch(url) {
            const r = await fetch(url, { credentials: 'same-origin' });
            if (!r.ok) throw new Error(await r.text().catch(() => r.statusText));
            return r.json();
        }
        const [summaryRes, trendRes, modelsRes] = await Promise.all([
            safeFetch(`${API}/summary`),
            safeFetch(`${API}/trend`),
            safeFetch(`${API}/models`),
        ]);

        if (!summaryRes.success) throw new Error(summaryRes.error || 'summary failed');

        const summary = summaryRes.data;
        const trendItems = (trendRes.success && trendRes.data?.items) || [];
        const models = (modelsRes.success && modelsRes.data?.items) || [];

        root.innerHTML = '';
        root.dataset.loaded = 'true';
        initialized = true;

        // Source badge
        const sourceLabel = summary.source === 'quota_data' ? 'Quota API' : 'Consume Logs';

        // ── Metrics grid ──
        const metricsGrid = el('div', 'newapi-metrics-grid');
        metricsGrid.appendChild(metricTile('请求数', fmt(summary.total_requests), 'counter_1'));
        metricsGrid.appendChild(metricTile('Tokens', fmt(summary.total_tokens), 'token'));
        metricsGrid.appendChild(metricTile('Quota', fmt(summary.total_quota), 'payments'));
        metricsGrid.appendChild(metricTile('实时 RPM / TPM', `${fmt(summary.current_rpm)} / ${fmt(summary.current_tpm)}`, 'speed'));
        root.appendChild(metricsGrid);

        // ── Content grid (trend + models) ──
        const contentGrid = el('div', 'newapi-content-grid');

        // Trend panel
        const trendPanel = el('div', 'newapi-panel');
        trendPanel.innerHTML = `<div class="newapi-panel-header"><span>请求趋势</span><span class="newapi-hint">${trendItems.length} 个时间桶 · ${sourceLabel}</span></div>`;
        if (trendItems.length > 0) {
            trendPanel.appendChild(buildSparkline(trendItems, summary.total_requests));
        } else {
            trendPanel.innerHTML += '<p class="newapi-empty">暂无趋势数据</p>';
        }
        contentGrid.appendChild(trendPanel);

        // Models panel
        const modelsPanel = el('div', 'newapi-panel');
        const topModels = models.slice(0, 8);
        modelsPanel.innerHTML = `<div class="newapi-panel-header"><span>Top 模型</span><span class="newapi-hint">${topModels.length} / ${models.length}</span></div>`;
        if (topModels.length > 0) {
            const maxReq = Math.max(...topModels.map(m => m.requests), 1);
            const list = el('div', 'newapi-model-list');
            for (const model of topModels) {
                const pct = Math.round((model.requests / maxReq) * 100);
                const item = el('div', 'newapi-model-item');
                item.innerHTML = `
                    <div class="model-meta">
                        <strong class="model-name">${esc(model.model_name || 'unknown')}</strong>
                        <span class="model-req">${fmt(model.requests)} req</span>
                    </div>
                    <div class="model-bar-track"><div class="model-bar-fill" style="width:${pct}%"></div></div>
                    <div class="model-detail">
                        <span>${fmt(model.token_used)} tokens</span>
                        <span>${fmt(model.quota)} quota</span>
                    </div>`;
                list.appendChild(item);
            }
            modelsPanel.appendChild(list);
        } else {
            modelsPanel.innerHTML += '<p class="newapi-empty">暂无模型维度数据</p>';
        }
        contentGrid.appendChild(modelsPanel);

        root.appendChild(contentGrid);
    } catch (error) {
        const msg = error?.message || String(error);
        const isConfig = msg.includes('未配置') || msg.includes('503');
        root.innerHTML = `
            <div class="newapi-state ${isConfig ? 'newapi-state-warning' : 'newapi-state-error'}">
                <strong>${isConfig ? '监控未配置' : '监控加载失败'}</strong>
                <p>${esc(msg)}</p>
            </div>`;
        initialized = false;
    }
}

// ── Helpers ──

function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
}

function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function metricTile(label, value, icon) {
    const tile = el('div', 'newapi-metric-tile');
    tile.innerHTML = `
        <span class="material-symbols-outlined newapi-metric-icon">${icon}</span>
        <div>
            <span class="newapi-metric-label">${label}</span>
            <strong class="newapi-metric-value">${value}</strong>
        </div>`;
    return tile;
}

function buildSparkline(items, totalRequests) {
    const wrap = el('div', 'newapi-sparkline-wrap');
    const W = 320, H = 100, pad = 4;
    const values = items.map(i => i.requests);
    const maxVal = Math.max(...values, 1);
    const points = values.map((v, i) => {
        const x = pad + (i / Math.max(values.length - 1, 1)) * (W - pad * 2);
        const y = H - pad - (v / maxVal) * (H - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const linePath = 'M' + points.join(' L');
    const areaPath = linePath + ` L${(pad + ((values.length - 1) / Math.max(values.length - 1, 1)) * (W - pad * 2)).toFixed(1)},${H - pad} L${pad},${H - pad} Z`;

    wrap.innerHTML = `
        <svg class="newapi-sparkline" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
            <defs>
                <linearGradient id="newapiSparkFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stop-color="var(--button-bg)" stop-opacity="0.3"/>
                    <stop offset="100%" stop-color="var(--button-bg)" stop-opacity="0"/>
                </linearGradient>
            </defs>
            <path d="${areaPath}" fill="url(#newapiSparkFill)"/>
            <path d="${linePath}" fill="none" stroke="var(--button-bg)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div class="newapi-trend-caption">
            <span>峰值 ${fmt(maxVal)}</span>
            <span>总计 ${fmt(totalRequests)}</span>
        </div>`;
    return wrap;
}
