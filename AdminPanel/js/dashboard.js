// AdminPanel/js/dashboard.js
import { apiFetch } from './utils.js';
import { initializeCalendarWidget } from './schedule-manager.js';
import { getPluginUiPrefs } from './plugins.js';

const MONITOR_API_BASE_URL = '/admin_api/system-monitor';
const API_BASE_URL = '/admin_api';

let monitorIntervalId = null;
let activityDataPoints = new Array(60).fill(0);
let lastLogCheckTime = null;

let logoClickCount = 0;
let logoClickTimer = null;
let pluginCardsLoaded = false;

/**
 * 初始化仪表盘，设置定时器并加载初始数据。
 */
export function initializeDashboard() {
    console.log('Initializing Dashboard...');
    if (monitorIntervalId) {
        clearInterval(monitorIntervalId);
    }
    updateDashboardData();
    initializeCalendarWidget();
    loadPluginDashboardCards();

    updateActivityChart().then(() => {
        drawActivityChart();
    });

    monitorIntervalId = setInterval(() => {
        updateDashboardData();
        initializeCalendarWidget();
        updateActivityChart().then(() => {
             drawActivityChart();
        });
    }, 5000);

    // 彩蛋逻辑：点击5次logo进入沉浸模式
    const logo = document.getElementById('vcp-logo-main');
    if (logo && !logo.dataset.easterEggInitialized) {
        logo.addEventListener('click', () => {
            logoClickCount++;
            clearTimeout(logoClickTimer);
            if (logoClickCount >= 5) {
                enterImmersiveMode();
                logoClickCount = 0;
            } else {
                logoClickTimer = setTimeout(() => {
                    logoClickCount = 0;
                }, 2000);
            }
        });
        logo.dataset.easterEggInitialized = 'true';
    }

    const exitBtn = document.getElementById('exit-immersive-button');
    if (exitBtn && !exitBtn.dataset.easterEggInitialized) {
        exitBtn.addEventListener('click', exitImmersiveMode);
        exitBtn.dataset.easterEggInitialized = 'true';
    }
}

/**
 * 进入太阳系沉浸观景模式
 */
function enterImmersiveMode() {
    const bg = document.querySelector('.solar-system-bg');
    if (bg) {
        bg.classList.add('immersive-mode');
        document.documentElement.classList.add('ui-hidden-immersive');
        document.body.style.overflow = 'hidden';
        console.log('Entering immersive solar system mode...');
    }
}

/**
 * 退出沉浸模式
 */
function exitImmersiveMode() {
    const bg = document.querySelector('.solar-system-bg');
    if (bg) {
        bg.classList.remove('immersive-mode');
        document.documentElement.classList.remove('ui-hidden-immersive');
        document.body.style.overflow = '';
        console.log('Exiting immersive mode.');
    }
}

/**
 * 停止仪表盘的数据轮询。
 */
export function stopDashboardUpdates() {
    if (monitorIntervalId) {
        clearInterval(monitorIntervalId);
        monitorIntervalId = null;
        console.log('Dashboard monitoring stopped.');
    }
    // Reset plugin cards so they reload fresh on next dashboard visit
    pluginCardsLoaded = false;
    const grid = document.querySelector('#dashboard-section .dashboard-grid');
    if (grid) {
        grid.querySelectorAll('.plugin-dashboard-card').forEach(el => el.remove());
    }
}

/**
 * 更新仪表盘上的所有数据。
 */
async function updateDashboardData() {
    const cpuProgress = document.getElementById('cpu-progress');
    const cpuUsageText = document.getElementById('cpu-usage-text');
    const cpuInfoText = document.getElementById('cpu-info-text');
    const memProgress = document.getElementById('mem-progress');
    const memUsageText = document.getElementById('mem-usage-text');
    const memInfoText = document.getElementById('mem-info-text');
    const pm2ProcessList = document.getElementById('pm2-process-list');
    const nodeInfoList = document.getElementById('node-info-list');
    const userAuthCodeDisplay = document.getElementById('user-auth-code-display');

    try {
        const [resources, processes, authCodeData] = await Promise.all([
            apiFetch(`${MONITOR_API_BASE_URL}/system/resources`, {}, false).catch(err => {
                console.warn('Failed to fetch system resources:', err.message);
                return null;
            }),
            apiFetch(`${MONITOR_API_BASE_URL}/pm2/processes`, {}, false).catch(err => {
                console.warn('Failed to fetch PM2 processes:', err.message);
                return { success: true, processes: [] };
            }),
            apiFetch(`${API_BASE_URL}/user-auth-code`, {}, false).catch(err => {
                console.warn('Failed to fetch user auth code:', err.message);
                return { success: false, code: 'N/A (Error)' };
            })
        ]);
        
        if (userAuthCodeDisplay) {
            userAuthCodeDisplay.textContent = authCodeData.success ? authCodeData.code : (authCodeData.code || 'N/A (未运行)');
        }

        if (cpuProgress && cpuUsageText && cpuInfoText && resources && resources.system) {
            const cpuUsage = resources.system.cpu.usage.toFixed(1);
            updateProgressCircle(cpuProgress, cpuUsageText, cpuUsage);
            cpuInfoText.innerHTML = `平台: ${resources.system.nodeProcess.platform} <br> 架构: ${resources.system.nodeProcess.arch}`;
        }

        if (memProgress && memUsageText && memInfoText && resources && resources.system) {
            const memUsed = resources.system.memory.used;
            const memTotal = resources.system.memory.total;
            const vcpMemUsed = resources.system.nodeProcess.memory.rss;
            const memUsage = memTotal > 0 ? ((memUsed / memTotal) * 100).toFixed(1) : 0;
            const vcpMemUsage = memTotal > 0 ? ((vcpMemUsed / memTotal) * 100).toFixed(1) : 0;
            updateProgressCircle(memProgress, memUsageText, memUsage, vcpMemUsage);
            memInfoText.innerHTML = `已用: ${(memUsed / 1024 / 1024 / 1024).toFixed(2)} GB <br> 总共: ${(memTotal / 1024 / 1024 / 1024).toFixed(2)} GB`;
        }
        
        if (pm2ProcessList) {
            pm2ProcessList.innerHTML = '';
            if (processes.success && processes.processes.length > 0) {
                processes.processes.forEach(proc => {
                    const procEl = document.createElement('div');
                    procEl.className = 'process-item';
                    procEl.innerHTML = `
                        <strong>${proc.name}</strong> (PID: ${proc.pid})
                        <span class="status ${proc.status}">${proc.status}</span> <br>
                        CPU: ${proc.cpu}% | RAM: ${(proc.memory / 1024 / 1024).toFixed(1)} MB
                    `;
                    pm2ProcessList.appendChild(procEl);
                });
            } else {
                pm2ProcessList.innerHTML = '<p>没有正在运行的 PM2 进程。</p>';
            }
        }

        if (nodeInfoList) {
            const nodeInfo = resources.system.nodeProcess;
            const uptimeSeconds = nodeInfo.uptime;
            const uptimeHours = Math.floor(uptimeSeconds / 3600);
            const uptimeMinutes = Math.floor((uptimeSeconds % 3600) / 60);
            nodeInfoList.innerHTML = `
                <div class="node-info-item"><strong>PID:</strong> ${nodeInfo.pid}</div>
                <div class="node-info-item"><strong>Node.js 版本:</strong> ${nodeInfo.version}</div>
                <div class="node-info-item"><strong>内存占用:</strong> ${(nodeInfo.memory.rss / 1024 / 1024).toFixed(2)} MB</div>
                <div class="node-info-item"><strong>运行时间:</strong> ${uptimeHours}h ${uptimeMinutes}m</div>
            `;
        }

        // NewAPI summary card on dashboard
        updateNewApiDashCard();

    } catch (error) {
        console.error('Failed to update dashboard data:', error);
        if (pm2ProcessList) pm2ProcessList.innerHTML = `<p class="error-message">加载 PM2 数据失败: ${error.message}</p>`;
        if (nodeInfoList) nodeInfoList.innerHTML = `<p class="error-message">加载系统数据失败: ${error.message}</p>`;
    }
}

/**
 * 更新天气预报数据。
 */
async function updateWeatherData() {
    const weatherIcon = document.getElementById('weather-icon');
    const weatherTemp = document.getElementById('weather-temp');
    const weatherText = document.getElementById('weather-text');
    const weatherHumidity = document.getElementById('weather-humidity');
    const weatherWind = document.getElementById('weather-wind');
    const weatherPressure = document.getElementById('weather-pressure');
    const weatherForecast = document.getElementById('weather-forecast');

    if (!weatherIcon) return;

    try {
        const data = await apiFetch(`${API_BASE_URL}/weather`, {}, false);
        
        // 映射天气图标 (使用 Material Symbols)
        const iconMap = {
            '100': 'sunny',
            '101': 'cloudy',
            '102': 'cloudy',
            '103': 'partly_cloudy_day',
            '104': 'cloud',
            '150': 'clear_night',
            '151': 'nights_stay',
            '152': 'nights_stay',
            '153': 'nights_stay',
            '154': 'cloud',
            '300': 'rainy',
            '301': 'rainy',
            '302': 'rainy_heavy',
            '303': 'rainy_heavy',
            '304': 'rainy_heavy',
            '305': 'rainy',
            '306': 'rainy',
            '307': 'rainy_heavy',
            '308': 'rainy_heavy',
            '309': 'rainy',
            '310': 'rainy_heavy',
            '311': 'rainy_heavy',
            '312': 'rainy_heavy',
            '313': 'rainy_heavy',
            '314': 'rainy',
            '315': 'rainy_heavy',
            '316': 'rainy_heavy',
            '317': 'rainy_heavy',
            '318': 'rainy_heavy',
            '350': 'rainy',
            '351': 'rainy_heavy',
            '399': 'rainy',
            'default': 'wb_sunny'
        };

        if (data && data.hourly && data.hourly.length > 0) {
            // 寻找最接近当前时间的整点预报
            const now = new Date();
            let current = data.hourly[0];
            let minDiff = Infinity;

            for (const hourData of data.hourly) {
                const forecastTime = new Date(hourData.fxTime);
                const diff = Math.abs(now - forecastTime);
                if (diff < minDiff) {
                    minDiff = diff;
                    current = hourData;
                }
            }

            weatherIcon.textContent = iconMap[current.icon] || iconMap['default'];
            weatherTemp.textContent = current.temp;
            weatherText.textContent = current.text;
            weatherHumidity.textContent = `${current.humidity}%`;
            weatherWind.textContent = `${current.windDir} ${current.windScale}级`;
            weatherPressure.textContent = `${current.pressure} hPa`;
        }

        if (data && data.daily && data.daily.length > 0 && weatherForecast) {
            weatherForecast.innerHTML = '';
            // 显示未来 4 天的预报 (跳过今天)
            data.daily.slice(1, 5).forEach(day => {
                const date = new Date(day.fxDate);
                const dayName = date.toLocaleDateString('zh-CN', { weekday: 'short' });
                
                const forecastItem = document.createElement('div');
                forecastItem.className = 'forecast-item';
                forecastItem.innerHTML = `
                    <span class="forecast-date">${dayName}</span>
                    <span class="material-symbols-outlined forecast-icon">${iconMap[day.iconDay] || iconMap['default']}</span>
                    <span class="forecast-temp">${day.tempMin}°/${day.tempMax}°</span>
                `;
                weatherForecast.appendChild(forecastItem);
            });
        }
    } catch (error) {
        console.error('Failed to update weather data:', error);
        if (weatherText) weatherText.textContent = '加载失败';
    }
}

/**
 * 更新每日热榜数据。
 */
async function updateDailyHotNews() {
    const newsScroller = document.getElementById('news-scroller');
    if (!newsScroller) return;

    try {
        const response = await apiFetch(`${API_BASE_URL}/dailyhot`, {}, false);
        if (response.success && response.data.length > 0) {
            // Check if content actually changed to avoid restarting animation unnecessarily
            const currentItemCount = newsScroller.querySelectorAll('.news-item').length;
            if (currentItemCount === response.data.length * 2) return; 

            newsScroller.innerHTML = '';
            
            // 为了实现无缝滚动，我们需要复制一份数据
            const allItems = [...response.data, ...response.data];
            
            allItems.forEach(item => {
                const itemEl = document.createElement('a');
                itemEl.className = 'news-item';
                itemEl.href = item.url;
                itemEl.target = '_blank';
                itemEl.innerHTML = `
                    <span class="news-source">${item.source}</span>
                    <span class="news-title">${item.title}</span>
                `;
                newsScroller.appendChild(itemEl);
            });

            // 计算动画时长：每个条目约 4 秒
            const duration = response.data.length * 4;
            newsScroller.style.animation = `scroll-news ${duration}s linear infinite`;
        } else {
            newsScroller.innerHTML = '<p style="text-align: center; padding: 20px; opacity: 0.6;">暂无热榜数据。</p>';
        }
    } catch (error) {
        console.error('Failed to update daily hot news:', error);
        newsScroller.innerHTML = `<p class="error-message">加载热榜失败: ${error.message}</p>`;
    }
}

/**
 * 更新圆形进度条。
 * @param {HTMLElement} circleElement - SVG 元素
 * @param {HTMLElement} textElement - 显示百分比的文本元素
 * @param {number} percentage - 百分比
 */
function updateProgressCircle(circleElement, textElement, percentage, secondaryPercentage = null) {
    const radius = 54;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percentage / 100) * circumference;
    
    const progressBar = circleElement.querySelector('.progress-bar');
    if (progressBar) {
        progressBar.style.strokeDashoffset = offset;
    }

    if (secondaryPercentage !== null) {
        const secondaryProgressBar = circleElement.querySelector('.progress-bar-secondary');
        if (secondaryProgressBar) {
            const secondaryOffset = circumference - (secondaryPercentage / 100) * circumference;
            secondaryProgressBar.style.strokeDashoffset = secondaryOffset;
        }
    }

    if (textElement) {
        textElement.textContent = `${percentage}%`;
    }
}

/**
 * 从服务器日志更新活动图表的数据。
 */
async function updateActivityChart() {
    const activityChartCanvas = document.getElementById('activity-chart-canvas');
    if (!activityChartCanvas) return;

    try {
        const logData = await apiFetch(`${API_BASE_URL}/server-log`, {}, false);
        const logLines = logData.content.split('\n');
        
        let newLogsCount = 0;
        let latestTimeInThisBatch = null;

        const regex = /\[(\d{4}\/\d{1,2}\/\d{1,2}\s\d{1,2}:\d{2}:\d{2})\]/;
        for (const line of logLines) {
            const match = line.match(regex);
            if (match && match[1]) {
                const timestamp = new Date(match[1]);
                if (isNaN(timestamp.getTime())) continue;

                if (lastLogCheckTime && timestamp > lastLogCheckTime) {
                    newLogsCount++;
                }

                if (!latestTimeInThisBatch || timestamp > latestTimeInThisBatch) {
                    latestTimeInThisBatch = timestamp;
                }
            }
        }
        
        if (latestTimeInThisBatch) {
            lastLogCheckTime = latestTimeInThisBatch;
        }
        
        activityDataPoints.push(newLogsCount);
        if (activityDataPoints.length > 60) {
            activityDataPoints.shift();
        }

    } catch (error) {
        console.error('Failed to update activity chart data:', error);
        activityDataPoints.push(0);
        if (activityDataPoints.length > 60) {
            activityDataPoints.shift();
        }
    }
}

/**
 * 绘制服务器活动图表。
 */
function drawActivityChart() {
    const activityChartCanvas = document.getElementById('activity-chart-canvas');
    if (!activityChartCanvas) return;
    const canvas = activityChartCanvas;
    const ctx = canvas.getContext('2d');
    const width = canvas.offsetWidth;
    const height = canvas.offsetHeight;
    canvas.width = width;
    canvas.height = height;

    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    const lineColor = theme === 'dark' ? 'rgba(138, 180, 248, 0.8)' : 'rgba(26, 115, 232, 0.8)';
    const fillColor = theme === 'dark' ? 'rgba(138, 180, 248, 0.15)' : 'rgba(26, 115, 232, 0.15)';
    const gridColor = theme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
    
    const maxCount = Math.max(5, ...activityDataPoints);
    const padding = 10;

    ctx.clearRect(0, 0, width, height);

    // Draw grid lines
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 5; i++) {
        const y = height / 5 * i + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }

    // Draw the line and area fill
    ctx.beginPath();
    
    const points = activityDataPoints.map((d, i) => {
        const x = (i / (activityDataPoints.length - 1)) * (width - padding * 2) + padding;
        const y = height - (d / maxCount) * (height - padding * 2) - padding;
        return { x, y };
    });

    if (points.length > 0) {
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }
    }
    
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Area fill
    if (points.length > 1) {
        ctx.lineTo(points[points.length - 1].x, height - padding);
        ctx.lineTo(points[0].x, height - padding);
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();
    }
}

// ══════════════════════════════════════════════════
//  NewAPI Dashboard Summary Card
// ══════════════════════════════════════════════════

function _fmtCompact(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
}

async function updateNewApiDashCard() {
    const card = document.getElementById('newapi-dash-card');
    const content = document.getElementById('newapi-dash-content');
    if (!card || !content) return;

    try {
        // Use raw fetch to avoid apiFetch's global error toast on failure
        const resp = await fetch(`${API_BASE_URL}/newapi-monitor/summary`, { credentials: 'same-origin' });
        if (!resp.ok) throw new Error(resp.statusText);
        const res = await resp.json();
        if (!res.success) throw new Error(res.error || 'failed');

        const d = res.data;
        card.style.display = '';
        content.innerHTML = `
            <div class="newapi-dash-grid">
                <div class="newapi-dash-item">
                    <span class="newapi-dash-label">请求数</span>
                    <strong class="newapi-dash-value">${_fmtCompact(d.total_requests)}</strong>
                </div>
                <div class="newapi-dash-item">
                    <span class="newapi-dash-label">Tokens</span>
                    <strong class="newapi-dash-value">${_fmtCompact(d.total_tokens)}</strong>
                </div>
                <div class="newapi-dash-item">
                    <span class="newapi-dash-label">Quota</span>
                    <strong class="newapi-dash-value">${_fmtCompact(d.total_quota)}</strong>
                </div>
                <div class="newapi-dash-item">
                    <span class="newapi-dash-label">RPM / TPM</span>
                    <strong class="newapi-dash-value">${_fmtCompact(d.current_rpm)} / ${_fmtCompact(d.current_tpm)}</strong>
                </div>
            </div>`;
    } catch {
        // NewAPI not configured or unreachable — show hint instead of hiding
        card.style.display = '';
        content.innerHTML = `<p style="font-size:0.85em;color:var(--secondary-text);margin:0;">未配置，请在全局配置中填写<br>NEWAPI_MONITOR 相关参数</p>`;
    }
}

// ══════════════════════════════════════════════════
//  Plugin Dashboard Cards Injection
// ══════════════════════════════════════════════════

/**
 * Load and inject plugin dashboard cards.
 * Reads plugin manifests for `dashboardCards` field and fetches each card's HTML
 * from the plugin's admin-assets endpoint.
 *
 * Manifest schema:
 *   "dashboardCards": [
 *     {
 *       "id":     "unique-card-id",
 *       "title":  "Card Title",
 *       "icon":   "material_icon_name",   (optional)
 *       "source": "dashboard-card.html",  (relative to plugin admin/ dir)
 *       "width":  "2x"                    (optional, "1x" default, "2x" spans two columns)
 *     }
 *   ]
 */
async function loadPluginDashboardCards() {
    // Only inject once per dashboard session (avoid duplicates on 5s refresh)
    if (pluginCardsLoaded) return;

    const grid = document.querySelector('#dashboard-section .dashboard-grid');
    if (!grid) return;

    try {
        const plugins = await apiFetch(`${API_BASE_URL}/plugins`, {}, false);
        if (!Array.isArray(plugins)) return;

        const cardsToLoad = [];
        const uiPrefs = getPluginUiPrefs();
        for (const plugin of plugins) {
            const manifest = plugin.manifest;
            if (!manifest || !Array.isArray(manifest.dashboardCards)) continue;
            if (!plugin.enabled) continue; // skip disabled plugins
            // Check UI prefs — default to enabled if not set
            const prefs = uiPrefs[manifest.name];
            if (prefs && prefs.dashboardCards === false) continue;

            for (const cardDef of manifest.dashboardCards) {
                if (!cardDef.source || !cardDef.id) continue;
                cardsToLoad.push({
                    pluginName: manifest.name,
                    displayName: manifest.displayName || manifest.name,
                    ...cardDef,
                });
            }
        }

        if (cardsToLoad.length === 0) return;

        // Fetch all card HTML fragments in parallel
        const results = await Promise.allSettled(
            cardsToLoad.map(async (card) => {
                const resp = await fetch(`${API_BASE_URL}/plugins/${encodeURIComponent(card.pluginName)}/admin-assets/${encodeURIComponent(card.source)}`, { credentials: 'same-origin' });
                if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
                const html = await resp.text();
                return { card, html };
            })
        );

        for (const result of results) {
            if (result.status !== 'fulfilled') continue;
            const { card, html } = result.value;

            // Prevent duplicate injection
            if (grid.querySelector(`[data-plugin-card-id="${card.id}"]`)) continue;

            const wrapper = document.createElement('div');
            wrapper.className = 'status-card plugin-dashboard-card';
            wrapper.dataset.pluginCardId = card.id;
            wrapper.dataset.pluginName = card.pluginName;
            if (card.width === '2x') {
                wrapper.classList.add('plugin-card-wide');
            }

            // Card header
            const header = document.createElement('h3');
            if (card.icon) {
                header.innerHTML = `<span class="material-symbols-outlined" style="font-size:1.1em;vertical-align:-2px;margin-right:6px;">${card.icon}</span>${card.title || card.id}`;
            } else {
                header.textContent = card.title || card.id;
            }
            wrapper.appendChild(header);

            // Card body (injected HTML)
            const body = document.createElement('div');
            body.className = 'status-card-content plugin-card-body';
            body.innerHTML = html;
            wrapper.appendChild(body);

            // Execute any <script> tags in the injected HTML
            const scripts = body.querySelectorAll('script');
            for (const oldScript of scripts) {
                const newScript = document.createElement('script');
                if (oldScript.src) {
                    newScript.src = oldScript.src;
                } else {
                    newScript.textContent = oldScript.textContent;
                }
                oldScript.replaceWith(newScript);
            }

            // Plugin attribution badge
            const badge = document.createElement('div');
            badge.className = 'plugin-card-badge';
            badge.textContent = card.displayName;
            wrapper.appendChild(badge);

            grid.appendChild(wrapper);
        }

        pluginCardsLoaded = true;
    } catch (error) {
        console.warn('[Dashboard] Failed to load plugin dashboard cards:', error);
    }
}

