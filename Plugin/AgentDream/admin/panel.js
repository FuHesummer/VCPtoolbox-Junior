// 🔌 AgentDream native 模式组件（挂到主面板 Vue 实例）
// 功能参考上游 lioensky/VCPToolBox 的 DreamManager.vue 完整实现。
// 协议：通过 window.__VCPPanel 访问主面板的 Vue + API + 工具函数
(function () {
  'use strict';
  const P = window.__VCPPanel;
  if (!P) { console.error('[AgentDream] window.__VCPPanel 未就绪'); return; }

  const { ref, computed, onMounted } = P.Vue;
  const { pluginApi, showToast, formatTime, markdown } = P;
  const api = pluginApi('AgentDream');

  const DreamApprovalPage = {
    name: 'DreamApprovalPage',
    template: /* html */ `
<div class="page dream-page">
  <PageHeader
    title="梦境审批"
    subtitle="在梦境操作触及日记文件前进行审核"
    icon="bedtime"
  >
    <template #actions>
      <button class="btn btn-primary" :disabled="!status || status.hibernating || triggering" @click="openTriggerPanel">
        <span class="material-symbols-outlined">auto_awesome</span>
        手动做梦
      </button>
      <button class="btn btn-ghost" :disabled="loading" @click="loadLogs">
        <span class="material-symbols-outlined" :class="{ spin: loading }">refresh</span>
        刷新
      </button>
    </template>
  </PageHeader>

  <div class="dream-content">
    <!-- 状态提示卡片 -->
    <div v-if="status" class="dream-status-card" :class="{ warn: status.hibernating }">
      <div class="ds-left">
        <span class="material-symbols-outlined">{{ status.hibernating ? 'warning' : 'cloud_sync' }}</span>
        <div class="ds-text">
          <strong v-if="status.hibernating">梦系统休眠中</strong>
          <strong v-else>梦系统运行中 · {{ status.agents.length }} 个 Agent</strong>
          <span v-if="status.hibernating">
            未找到 <code>Plugin/AgentDream/config.env</code>。复制同目录的 <code>config.env.example</code> 为 <code>config.env</code>，填入 <code>DREAM_AGENT_LIST</code> 并重启服务即可启用自动做梦。
          </span>
          <span v-else>
            自动调度：{{ status.scheduler.timeWindow.start }}:00 ~ {{ status.scheduler.timeWindow.end }}:00 ·
            冷却 {{ status.scheduler.frequencyHours }}h · 概率 {{ Math.round(status.scheduler.probability * 100) }}%
            <span v-if="status.scheduler.isDreamingNow" class="chip tiny orange">正在做梦…</span>
          </span>
        </div>
      </div>
      <div v-if="!status.hibernating" class="ds-agents">
        <span class="chip tiny" v-for="a in status.agents" :key="a.name">{{ a.name }}</span>
      </div>
    </div>

    <!-- 手动触发弹窗 -->
    <div v-if="showTriggerPanel" class="dream-trigger-modal" @click.self="showTriggerPanel = false">
      <div class="modal-body">
        <h3>手动触发做梦</h3>
        <p class="hint">选中一个 Agent 立即做梦（绕过时间窗口和概率判定）。做梦需要 30 秒~2 分钟，结束后梦日志会出现在下方列表。</p>
        <div class="agent-picker">
          <button
            v-for="a in (status?.agents || [])"
            :key="a.name"
            class="agent-pill"
            :class="{ selected: triggerAgent === a.name }"
            @click="triggerAgent = a.name"
          >
            <span class="avatar">{{ a.name.slice(0, 1) }}</span>
            <strong>{{ a.name }}</strong>
            <small v-if="a.lastDreamAt">上次 {{ formatTime(a.lastDreamAt) }}</small>
            <small v-else class="muted">从未做梦</small>
          </button>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="showTriggerPanel = false">取消</button>
          <button class="btn btn-primary" :disabled="!triggerAgent || triggering" @click="doTrigger">
            <span class="material-symbols-outlined" :class="{ spin: triggering }">{{ triggering ? 'hourglass_empty' : 'bedtime' }}</span>
            {{ triggering ? '触发中...' : '开始做梦' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 工具栏：左侧搜索/过滤 + 右侧统计 -->
    <div class="toolbar-row">
      <div class="search-box">
        <span class="material-symbols-outlined">search</span>
        <input v-model="searchText" placeholder="搜索 Agent / DreamID..." />
      </div>
      <select class="sel" v-model="agentFilter">
        <option value="">全部 Agent</option>
        <option v-for="n in agentsList" :key="n" :value="n">{{ n }}</option>
      </select>
      <div class="tab-group">
        <button class="tab-btn" :class="{ active: statusFilter === '' }" @click="statusFilter = ''">全部</button>
        <button class="tab-btn" :class="{ active: statusFilter === 'pending' }" @click="statusFilter = 'pending'">待审</button>
        <button class="tab-btn" :class="{ active: statusFilter === 'done' }" @click="statusFilter = 'done'">已处理</button>
      </div>
      <div class="stat-inline">
        <span class="sv">{{ stats.total }}</span><span class="sl">梦境</span>
        <span class="sep">·</span>
        <span class="sv orange">{{ stats.pending }}</span><span class="sl">待审</span>
        <span class="sep">·</span>
        <span class="sv cyan">{{ stats.done }}</span><span class="sl">已处理</span>
      </div>
    </div>

    <!-- 列表 -->
    <EmptyState
      v-if="loading && logs.length === 0"
      icon="hourglass_empty"
      message="加载梦境日志..."
    />
    <EmptyState
      v-else-if="filteredLogs.length === 0"
      icon="nights_stay"
      :message="logs.length === 0 ? '暂无梦境记录 · Agent 入梦后会出现在这里' : '没有匹配的梦境'"
    />
    <div v-else class="dream-list">
      <article
        v-for="log in filteredLogs"
        :key="log.filename"
        class="dream-log-card"
        :class="{ 'has-pending': log.pendingCount > 0, open: openSet.has(log.filename) }"
      >
        <!-- 头部（主题栏） -->
        <div class="dl-head" @click="toggleCard(log.filename)">
          <div class="dl-title">
            <span class="avatar">{{ (log.agentName || '?').slice(0, 1) }}</span>
            <div class="dl-agent">
              <strong>{{ log.agentName || '未知 Agent' }}</strong>
              <span class="chip tiny" :class="log.pendingCount > 0 ? 'orange' : 'cyan'">
                {{ log.pendingCount > 0 ? log.pendingCount + ' 待审批' : '已处理' }}
              </span>
            </div>
          </div>
          <div class="dl-meta">
            <span>{{ formatTime(log.date) }}</span>
            <span>·</span>
            <span>{{ log.operationCount }} 个操作</span>
            <span class="material-symbols-outlined toggle-icon">expand_more</span>
          </div>
        </div>

        <!-- 操作摘要 chip（header 下） -->
        <div v-if="getOpsSummary(log).length > 0" class="dl-ops-summary">
          <span
            v-for="(sum, i) in getOpsSummary(log)"
            :key="i"
            class="op-summary-chip"
            :class="sum.status"
          >
            {{ sum.typeLabel }} · {{ sum.statusLabel }}
          </span>
        </div>

        <!-- 展开详情 -->
        <div v-if="openSet.has(log.filename)" class="dl-detail">
          <template v-if="!detailMap.get(log.filename)">
            <div class="muted small" style="padding:8px;">加载详情...</div>
          </template>
          <template v-else>
            <!-- 🌙 梦境叙事 -->
            <div v-if="detailMap.get(log.filename).dreamNarrative" class="dream-narrative">
              <h4>🌙 梦境叙事</h4>
              <div class="narrative-text" v-html="markdown(detailMap.get(log.filename).dreamNarrative)"></div>
            </div>

            <!-- 批量 / 删除 -->
            <div class="bulk-bar">
              <template v-if="log.pendingCount > 0">
                <button class="btn btn-small" @click="doAction(log.filename, 'all', 'approve')">
                  <span class="material-symbols-outlined">check_circle</span>
                  批准全部待审
                </button>
                <button class="btn btn-small btn-ghost" @click="doAction(log.filename, 'all', 'reject')">
                  <span class="material-symbols-outlined">cancel</span>
                  拒绝全部待审
                </button>
              </template>
              <button class="btn btn-small btn-danger" style="margin-left:auto;" @click="deleteLog(log.filename)">
                <span class="material-symbols-outlined">delete_forever</span>
                删除梦日志
              </button>
            </div>

            <!-- 操作列表 -->
            <div
              v-if="!detailMap.get(log.filename).operations || detailMap.get(log.filename).operations.length === 0"
              class="muted small" style="padding:12px;text-align:center;"
            >
              此梦境无操作记录
            </div>
            <div v-else class="op-list">
              <article
                v-for="(op, idx) in detailMap.get(log.filename).operations"
                :key="op.operationId || op.id || idx"
                class="op-card"
                :class="op.status || 'unknown'"
              >
                <div class="op-header">
                  <span class="op-type">
                    <span class="material-symbols-outlined">{{ typeIcon(op.type) }}</span>
                    {{ typeLabel(op.type) }}
                  </span>
                  <span class="op-id mono">{{ op.operationId || op.id || ('#' + idx) }}</span>
                  <span class="op-status" :class="op.status">{{ statusLabel(op.status) }}</span>
                </div>

                <div class="op-body">
                  <!-- merge 类型 -->
                  <template v-if="typeKind(op.type) === 'merge'">
                    <div class="op-field" v-if="normalizeList(op.sourceDiaries).length > 0">
                      <label>源日记（{{ normalizeList(op.sourceDiaries).length }} 篇）</label>
                      <div class="file-list">
                        <code v-for="f in normalizeList(op.sourceDiaries)" :key="f" class="file-path">{{ f }}</code>
                      </div>
                    </div>
                    <div class="op-field" v-if="op.newContent">
                      <label>合并后内容</label>
                      <div class="content-preview" v-html="markdown(op.newContent)"></div>
                    </div>
                    <details v-if="op.sourceContents && Object.keys(op.sourceContents).length > 0" class="source-details">
                      <summary>📄 查看源日记原文（{{ Object.keys(op.sourceContents).length }} 篇）</summary>
                      <div v-for="(content, name) in op.sourceContents" :key="name" class="source-item">
                        <strong class="mono small">{{ name }}</strong>
                        <div class="content-preview" v-html="markdown(content)"></div>
                      </div>
                    </details>
                  </template>

                  <!-- delete 类型 -->
                  <template v-else-if="typeKind(op.type) === 'delete'">
                    <div class="op-field" v-if="op.targetDiary">
                      <label>目标日记</label>
                      <code class="file-path">{{ op.targetDiary }}</code>
                    </div>
                    <div class="op-field" v-if="op.reason">
                      <label>删除理由</label>
                      <p class="reason-text">{{ op.reason }}</p>
                    </div>
                    <details v-if="op.originalContent || op.targetContent" class="source-details">
                      <summary>📄 查看待删除内容</summary>
                      <div class="content-preview" v-html="markdown(op.originalContent || op.targetContent)"></div>
                    </details>
                  </template>

                  <!-- insight 类型 -->
                  <template v-else-if="typeKind(op.type) === 'insight'">
                    <div class="op-field" v-if="normalizeList(op.referenceDiaries).length > 0">
                      <label>参考日记（{{ normalizeList(op.referenceDiaries).length }} 篇）</label>
                      <div class="file-list">
                        <code v-for="f in normalizeList(op.referenceDiaries)" :key="f" class="file-path">{{ f }}</code>
                      </div>
                    </div>
                    <div class="op-field" v-if="op.insightContent">
                      <label>梦感悟内容</label>
                      <div class="content-preview" v-html="markdown(op.insightContent)"></div>
                    </div>
                  </template>

                  <!-- 其它未知类型 -->
                  <pre v-else class="op-raw">{{ JSON.stringify(op, null, 2) }}</pre>
                </div>

                <!-- 审批按钮 / 审批时间 -->
                <div v-if="op.status === 'pending_review'" class="op-actions">
                  <button class="btn-tiny approve" @click="doAction(log.filename, op.operationId || op.id || ('idx-' + idx), 'approve')">
                    ✅ 批准执行
                  </button>
                  <button class="btn-tiny reject" @click="doAction(log.filename, op.operationId || op.id || ('idx-' + idx), 'reject')">
                    ❌ 拒绝
                  </button>
                </div>
                <div v-else-if="op.reviewedAt" class="op-reviewed">
                  审批于 {{ formatTime(op.reviewedAt) }}
                </div>
              </article>
            </div>
          </template>
        </div>
      </article>
    </div>
  </div>
</div>
    `,
    setup() {
      const logs = ref([]);
      const loading = ref(false);
      const searchText = ref('');
      const statusFilter = ref('');
      const agentFilter = ref('');
      const openSet = ref(new Set());
      const detailMap = ref(new Map());
      // 梦系统状态（/status 返回）+ 手动触发弹窗
      const status = ref(null);
      const showTriggerPanel = ref(false);
      const triggerAgent = ref('');
      const triggering = ref(false);

      async function loadStatus() {
        try {
          const body = await api.get('/status');
          status.value = body && body.success ? body : null;
        } catch (e) {
          console.warn('[AgentDream] loadStatus failed:', e.message);
          status.value = null;
        }
      }

      function openTriggerPanel() {
        if (!status.value || status.value.hibernating) {
          showToast('梦系统休眠中，请先配置 config.env', 'warning');
          return;
        }
        triggerAgent.value = status.value.agents[0]?.name || '';
        showTriggerPanel.value = true;
      }

      async function doTrigger() {
        if (!triggerAgent.value) return;
        triggering.value = true;
        try {
          const body = await api.post('/trigger-dream', { agentName: triggerAgent.value });
          if (body.success) {
            showToast(body.message || `已触发 ${triggerAgent.value} 做梦`, 'success');
            showTriggerPanel.value = false;
            // 20 秒后刷新一次（做梦通常不会这么快，但先给个反馈）
            setTimeout(() => { loadLogs(); loadStatus(); }, 20000);
          } else {
            showToast(body.error || '触发失败', 'error');
          }
        } catch (e) {
          showToast('触发失败：' + e.message, 'error');
        } finally {
          triggering.value = false;
        }
      }

      async function loadLogs() {
        loading.value = true;
        try {
          const list = await api.get('/dream-logs');
          logs.value = Array.isArray(list) ? list : [];
          detailMap.value = new Map();
        } catch (e) {
          showToast('加载失败：' + e.message, 'error');
          logs.value = [];
        } finally { loading.value = false; }
      }

      async function loadDetail(filename) {
        if (detailMap.value.has(filename)) return;
        try {
          const body = await api.get(`/dream-logs/${encodeURIComponent(filename)}`);
          const data = body.data || body;
          const m = new Map(detailMap.value);
          m.set(filename, data);
          detailMap.value = m;
        } catch (e) {
          showToast('详情加载失败：' + e.message, 'error');
        }
      }

      function toggleCard(filename) {
        const s = new Set(openSet.value);
        if (s.has(filename)) s.delete(filename);
        else { s.add(filename); loadDetail(filename); }
        openSet.value = s;
      }

      async function doAction(filename, opId, action) {
        try {
          const body = await api.post(
            `/dream-logs/${encodeURIComponent(filename)}/operations/${encodeURIComponent(opId)}`,
            { action }
          );
          showToast(`${action === 'approve' ? '已批准' : '已拒绝'} ${body.matched || 0} 项操作`, 'success');
          detailMap.value.delete(filename);
          await loadLogs();
        } catch (e) {
          showToast('操作失败：' + e.message, 'error');
        }
      }

      async function deleteLog(filename) {
        if (!confirm(`确认永久删除梦境日志 "${filename}" 吗？`)) return;
        try {
          await api.delete(`/dream-logs/${encodeURIComponent(filename)}`);
          showToast('已删除', 'success');
          await loadLogs();
        } catch (e) {
          showToast('删除失败：' + e.message, 'error');
        }
      }

      const agentsList = computed(() =>
        [...new Set(logs.value.map(l => l.agentName).filter(Boolean))].sort()
      );

      const stats = computed(() => {
        const total = logs.value.length;
        const pending = logs.value.filter(l => l.pendingCount > 0).length;
        return { total, pending, done: total - pending };
      });

      const filteredLogs = computed(() => {
        const q = searchText.value.trim().toLowerCase();
        return logs.value.filter(l => {
          if (agentFilter.value && l.agentName !== agentFilter.value) return false;
          if (statusFilter.value === 'pending' && l.pendingCount === 0) return false;
          if (statusFilter.value === 'done' && l.pendingCount > 0) return false;
          if (q) {
            const hay = `${l.agentName || ''} ${l.dreamId || ''} ${l.filename || ''}`.toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        });
      });

      // ===== 工具 =====
      function typeKind(t) {
        if (t === 'merge' || t === 'DiaryMerge') return 'merge';
        if (t === 'delete' || t === 'DiaryDelete') return 'delete';
        if (t === 'insight' || t === 'DreamInsight') return 'insight';
        return 'other';
      }
      function typeIcon(t) {
        return { merge: 'merge_type', delete: 'delete', insight: 'lightbulb', other: 'circle' }[typeKind(t)];
      }
      function typeLabel(t) {
        return ({ merge: '合并日记', delete: '删除日记', insight: '梦感悟' })[typeKind(t)] || t || '未知';
      }
      function statusLabel(s) {
        return ({ pending_review: '待审批', approved: '已批准', rejected: '已拒绝', error: '出错' })[s] || s || '未知';
      }
      function normalizeList(v) {
        if (!v) return [];
        if (Array.isArray(v)) return v.filter(Boolean);
        if (typeof v === 'string') return v.split(',').map(s => s.trim()).filter(Boolean);
        return [];
      }
      function getOpsSummary(log) {
        // 优先用后端 summary，无则用详情里的 operations
        if (Array.isArray(log.operationSummary)) {
          return log.operationSummary.map(s => ({
            typeLabel: typeLabel(s.type),
            statusLabel: statusLabel(s.status),
            status: s.status || 'pending_review',
          }));
        }
        const detail = detailMap.value.get(log.filename);
        if (detail && Array.isArray(detail.operations)) {
          return detail.operations.map(op => ({
            typeLabel: typeLabel(op.type),
            statusLabel: statusLabel(op.status),
            status: op.status || 'pending_review',
          }));
        }
        return [];
      }

      onMounted(async () => {
        await Promise.all([loadLogs(), loadStatus()]);
      });

      return {
        logs, loading, searchText, statusFilter, agentFilter, openSet, detailMap,
        agentsList, stats, filteredLogs,
        loadLogs, toggleCard, doAction, deleteLog,
        typeKind, typeIcon, typeLabel, statusLabel, normalizeList, getOpsSummary,
        formatTime, markdown,
        // 手动触发 + 状态
        status, showTriggerPanel, triggerAgent, triggering,
        openTriggerPanel, doTrigger,
      };
    },
  };

  // ===== 样式（复用主面板 CSS 变量；紧凑风格对齐主面板其他页面） =====
  // style 每次覆盖（黄金规则 3：不 idempotent skip，否则改版后看不到新 CSS）
  {
    const __oldStyle = document.getElementById('dream-page-styles');
    if (__oldStyle) __oldStyle.remove();
    const s = document.createElement('style');
    s.id = 'dream-page-styles';
    s.textContent = `
.dream-page { display: flex; flex-direction: column; height: 100%; }
.dream-content { padding: 0 24px 24px; display: flex; flex-direction: column; gap: 10px; min-height: 0; }

/* 状态卡片 */
.dream-status-card {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 14px;
  background: var(--card-bg); border: var(--card-border);
  border-radius: var(--radius-md); box-shadow: var(--card-shadow);
  backdrop-filter: blur(18px);
}
.dream-status-card.warn { border-color: rgba(230, 138, 76, 0.5); background: linear-gradient(135deg, rgba(230, 138, 76, 0.08), rgba(230, 138, 76, 0.02)); }
.dream-status-card .ds-left { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
.dream-status-card .ds-left > .material-symbols-outlined { font-size: 28px; color: var(--primary-color); flex-shrink: 0; }
.dream-status-card.warn .ds-left > .material-symbols-outlined { color: #e68a4c; }
.dream-status-card .ds-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dream-status-card .ds-text strong { font-size: 14px; color: var(--text-color); }
.dream-status-card .ds-text span { font-size: 12px; color: var(--text-muted); }
.dream-status-card .ds-text code { background: var(--input-bg); padding: 1px 5px; border-radius: 3px; font-size: 11px; }
.dream-status-card .ds-agents { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }

/* 手动触发弹窗 */
.dream-trigger-modal {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45); z-index: 1000;
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(4px);
}
.dream-trigger-modal .modal-body {
  width: 540px; max-width: 92vw;
  background: var(--card-bg); border: var(--card-border);
  border-radius: var(--radius-lg); box-shadow: var(--card-shadow);
  padding: 20px 24px;
}
.dream-trigger-modal h3 { margin: 0 0 6px; font-size: 16px; color: var(--text-color); }
.dream-trigger-modal .hint { margin: 0 0 14px; font-size: 12px; color: var(--text-muted); line-height: 1.5; }
.dream-trigger-modal .agent-picker { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; margin-bottom: 16px; }
.dream-trigger-modal .agent-pill {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 10px 8px;
  background: var(--input-bg); border: 1px solid var(--border-color);
  border-radius: var(--radius-md); cursor: pointer;
  transition: all 0.15s;
}
.dream-trigger-modal .agent-pill:hover { border-color: var(--primary-color); }
.dream-trigger-modal .agent-pill.selected {
  border-color: var(--primary-color);
  background: linear-gradient(135deg, rgba(217, 119, 87, 0.15), rgba(217, 119, 87, 0.05));
}
.dream-trigger-modal .agent-pill .avatar {
  width: 32px; height: 32px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 600; color: #fff;
  background: linear-gradient(135deg, #d97757, #c56646);
}
.dream-trigger-modal .agent-pill strong { font-size: 13px; color: var(--text-color); }
.dream-trigger-modal .agent-pill small { font-size: 10px; color: var(--text-muted); }
.dream-trigger-modal .agent-pill small.muted { font-style: italic; opacity: 0.6; }
.dream-trigger-modal .modal-actions { display: flex; gap: 8px; justify-content: flex-end; }


/* 工具栏 */
.toolbar-row {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 8px 12px;
  background: var(--card-bg);
  border: var(--card-border);
  border-radius: var(--radius-md);
  box-shadow: var(--card-shadow);
  backdrop-filter: blur(18px);
}
.toolbar-row .search-box {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 0 10px; height: 28px;
  background: var(--input-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  flex: 1; min-width: 180px;
}
.toolbar-row .search-box:focus-within { border-color: var(--button-bg); }
.toolbar-row .search-box .material-symbols-outlined { font-size: 15px; color: var(--secondary-text); }
.toolbar-row .search-box input {
  flex: 1; border: none; outline: none; background: transparent;
  font-size: 12px; color: var(--primary-text); font-family: inherit;
}
.toolbar-row .sel {
  padding: 3px 8px; font-size: 12px; color: var(--primary-text);
  background: var(--input-bg); border: 1px solid var(--border-color);
  border-radius: var(--radius-sm); outline: none; font-family: inherit; height: 28px;
}
.toolbar-row .tab-group {
  display: inline-flex; padding: 2px;
  background: var(--accent-bg); border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
}
.toolbar-row .tab-btn {
  padding: 3px 10px; font-size: 11px;
  color: var(--secondary-text); background: transparent;
  border: none; border-radius: 5px; cursor: pointer; font-family: inherit;
}
.toolbar-row .tab-btn:hover:not(.active) { color: var(--primary-text); }
.toolbar-row .tab-btn.active { color: #fff; background: var(--button-bg); }
.toolbar-row .stat-inline {
  display: inline-flex; align-items: baseline; gap: 3px;
  margin-left: auto; font-size: 12px; color: var(--secondary-text);
  font-family: 'JetBrains Mono', Consolas, monospace;
}
.toolbar-row .stat-inline .sv { font-size: 14px; font-weight: 700; color: var(--primary-text); }
.toolbar-row .stat-inline .sv.orange { color: #d48a08; }
.toolbar-row .stat-inline .sv.cyan { color: #2d8a5c; }
.toolbar-row .stat-inline .sl { opacity: 0.6; }
.toolbar-row .stat-inline .sep { opacity: 0.4; margin: 0 2px; }

/* 列表 */
.dream-list { display: flex; flex-direction: column; gap: 8px; }

.dream-log-card {
  background: var(--card-bg);
  border: var(--card-border);
  border-radius: var(--radius-md);
  box-shadow: var(--card-shadow);
  backdrop-filter: blur(18px);
  overflow: hidden;
  transition: box-shadow 0.2s, transform 0.2s;
}
.dream-log-card:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(180,120,140,0.14); }
.dream-log-card.has-pending { border-left: 3px solid #f1ae28; }

.dl-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px;
  cursor: pointer; user-select: none;
  gap: 10px;
}
.dl-head:hover { background: var(--accent-bg); }

.dl-title { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }

.avatar {
  width: 28px; height: 28px; flex-shrink: 0;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--button-bg), #9b6dd0);
  color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 12px;
}

.dl-agent { display: flex; align-items: center; gap: 6px; min-width: 0; }
.dl-agent strong {
  font-size: 13px; color: var(--primary-text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.chip, .chip.tiny {
  display: inline-flex; align-items: center; padding: 1px 8px;
  font-size: 10px; font-weight: 600; font-family: inherit;
  color: var(--secondary-text);
  background: var(--accent-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-pill);
  white-space: nowrap;
}
.chip.orange { color: #8a5a00; background: rgba(241,174,40,0.15); border-color: rgba(241,174,40,0.3); }
.chip.cyan { color: #1d6b44; background: rgba(88,201,143,0.15); border-color: rgba(88,201,143,0.3); }
.chip.red { color: #8a2828; background: rgba(217,85,85,0.12); border-color: rgba(217,85,85,0.3); }

.dl-meta {
  display: flex; align-items: center; gap: 8px;
  font-size: 11px; color: var(--secondary-text);
  opacity: 0.8; flex-shrink: 0;
}
.toggle-icon {
  font-size: 18px; transition: transform 0.22s;
  color: var(--secondary-text);
}
.dream-log-card.open .toggle-icon { transform: rotate(180deg); color: var(--button-bg); }

/* 操作摘要 chip 行 */
.dl-ops-summary {
  padding: 0 14px 8px;
  display: flex; flex-wrap: wrap; gap: 4px;
}
.op-summary-chip {
  font-size: 10px; padding: 1px 7px;
  background: var(--accent-bg);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--secondary-text);
  font-family: inherit;
}
.op-summary-chip.pending_review { color: #d48a08; border-color: rgba(241,174,40,0.3); background: rgba(241,174,40,0.08); }
.op-summary-chip.approved { color: #2d8a5c; border-color: rgba(88,201,143,0.3); background: rgba(88,201,143,0.08); }
.op-summary-chip.rejected { color: #a52828; border-color: rgba(217,85,85,0.3); background: rgba(217,85,85,0.08); opacity: 0.8; }

/* 展开详情 */
.dl-detail {
  padding: 10px 14px 14px;
  border-top: 1px solid var(--border-color);
}

/* 梦境叙事 */
.dream-narrative {
  background: var(--accent-bg);
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  margin-bottom: 10px;
  border: 1px solid var(--border-color);
}
.dream-narrative h4 {
  margin: 0 0 6px; font-size: 12px; font-weight: 600;
  color: var(--highlight-text); letter-spacing: 0.3px;
}
.narrative-text {
  font-size: 12.5px; line-height: 1.65; color: var(--primary-text);
  max-height: 260px; overflow-y: auto;
}
.narrative-text ::v-deep(p),
.narrative-text p { margin: 0 0 0.6em; }
.narrative-text p:last-child { margin-bottom: 0; }

/* 批量操作 */
.bulk-bar { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
.btn-small { padding: 3px 10px !important; font-size: 12px !important; height: 28px; }
.btn-small .material-symbols-outlined { font-size: 14px !important; }

/* 操作卡片 */
.op-list { display: flex; flex-direction: column; gap: 8px; }
.op-card {
  background: var(--tertiary-bg);
  border: 1px solid var(--border-color);
  border-top: 2px solid transparent;
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.op-card.pending_review { border-top-color: #f1ae28; }
.op-card.approved { border-top-color: #58c98f; }
.op-card.rejected { border-top-color: var(--danger-color); opacity: 0.75; }
.op-card.error { border-top-color: var(--danger-color); }

.op-header {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 7px 10px;
  background: var(--accent-bg);
  border-bottom: 1px solid var(--border-color);
}
.op-type {
  display: inline-flex; align-items: center; gap: 4px;
  font-weight: 600; font-size: 12px;
  color: var(--primary-text);
}
.op-type .material-symbols-outlined { font-size: 14px; color: var(--button-bg); }
.op-id {
  font-size: 10px; color: var(--secondary-text); opacity: 0.7;
}
.op-status {
  margin-left: auto; padding: 1px 8px;
  font-size: 10px; border-radius: 4px; font-weight: 600;
}
.op-status.pending_review { color: #8a5a00; background: rgba(241,174,40,0.15); }
.op-status.approved { color: #1d6b44; background: rgba(88,201,143,0.15); }
.op-status.rejected { color: #a52828; background: rgba(217,85,85,0.1); }

.op-body { padding: 8px 10px; }

.op-field { margin-bottom: 8px; }
.op-field:last-child { margin-bottom: 0; }
.op-field label {
  display: block; margin-bottom: 3px;
  font-size: 10px; color: var(--secondary-text);
  opacity: 0.75; text-transform: uppercase; letter-spacing: 0.3px;
}

.file-list { display: flex; flex-wrap: wrap; gap: 3px; }
.file-path {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 10.5px; padding: 1px 6px;
  background: var(--accent-bg); border: 1px solid var(--border-color);
  border-radius: 3px; color: var(--primary-text);
  word-break: break-all;
}

.content-preview {
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid var(--border-color);
  padding: 8px 10px; border-radius: 4px;
  font-size: 12px; line-height: 1.6;
  max-height: 220px; overflow-y: auto;
  color: var(--primary-text); word-break: break-word;
}
.content-preview p { margin: 0 0 0.6em; }
.content-preview p:last-child { margin-bottom: 0; }
.content-preview code { font-family: 'JetBrains Mono', Consolas, monospace; font-size: 11px; }
.content-preview pre { white-space: pre-wrap; }
.content-preview ul, .content-preview ol { padding-left: 18px; margin: 0 0 0.6em; }

.reason-text {
  margin: 0; font-size: 12px; color: var(--primary-text);
  padding: 5px 8px; background: var(--accent-bg);
  border-radius: 4px; line-height: 1.55;
}

.source-details {
  margin-top: 6px; padding: 6px 8px;
  background: rgba(228,104,156,0.03);
  border: 1px dashed var(--border-color);
  border-radius: 4px;
}
.source-details summary {
  cursor: pointer; font-size: 11px;
  color: var(--secondary-text); user-select: none;
}
.source-details[open] summary { color: var(--button-bg); margin-bottom: 6px; }
.source-item { margin: 6px 0; }
.source-item strong { display: block; margin-bottom: 3px; color: var(--highlight-text); }

.op-raw {
  margin: 0; font-size: 11px; line-height: 1.5;
  white-space: pre-wrap; word-break: break-word;
  font-family: 'JetBrains Mono', Consolas, monospace;
  color: var(--secondary-text);
  padding: 6px 8px; background: var(--accent-bg); border-radius: 4px;
}

/* 审批按钮 / 审批时间 */
.op-actions {
  display: flex; gap: 6px;
  padding: 6px 10px;
  border-top: 1px solid var(--border-color);
  background: rgba(255,255,255,0.3);
}
.btn-tiny {
  padding: 4px 12px; font-size: 11.5px; font-weight: 600;
  border: 1px solid; border-radius: var(--radius-sm);
  cursor: pointer; font-family: inherit; transition: all 0.15s;
}
.btn-tiny.approve { color: #1d6b44; background: rgba(88,201,143,0.14); border-color: rgba(88,201,143,0.4); }
.btn-tiny.approve:hover { background: #58c98f; color: #fff; border-color: #58c98f; }
.btn-tiny.reject { color: #a52828; background: rgba(217,85,85,0.1); border-color: rgba(217,85,85,0.3); }
.btn-tiny.reject:hover { background: var(--danger-color); color: #fff; border-color: var(--danger-color); }

.op-reviewed {
  font-size: 10.5px; color: var(--secondary-text); opacity: 0.65;
  padding: 5px 10px; border-top: 1px solid var(--border-color);
  background: rgba(255,255,255,0.2);
}

.muted { color: var(--secondary-text); }
.small { font-size: 11px; }
.mono { font-family: 'JetBrains Mono', Consolas, monospace; }

.spin { animation: dream-spin 1s linear infinite; }
@keyframes dream-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
`;
    document.head.appendChild(s);
  }

  P.register('AgentDream', DreamApprovalPage);
})();
