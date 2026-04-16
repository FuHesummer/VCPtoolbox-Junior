// TimelineOrganizer 管理面板（native 模式 · v2 · 日记管理风格 + material icons）
// 走解耦路径：/admin_api/plugins/TimelineOrganizer/api/*
(function () {
  const P = window.__VCPPanel;
  if (!P) { console.error('[TimelineOrganizer] __VCPPanel 未就绪'); return; }

  const { ref, computed, onMounted } = P.Vue;
  const { showToast } = P;

  const styleId = 'timeline-organizer-style';
  const oldStyle = document.getElementById(styleId);
  if (oldStyle) oldStyle.remove();
  const styleEl = document.createElement('style');
  styleEl.id = styleId;
  styleEl.textContent = `
    .to-page { display: flex; gap: 18px; height: calc(100vh - 120px); min-height: 560px; }

    /* ===== 左侧 Agent 列表（仿 NotesManagerView） ===== */
    .to-page .to-sidebar { width: 280px; flex-shrink: 0; display: flex; flex-direction: column; gap: 12px; }
    .to-page .to-sidebar h3 { margin: 0; font-size: 0.95rem; color: var(--primary-text); display: flex; justify-content: space-between; align-items: baseline; font-weight: 600; }
    .to-page .to-sidebar h3 .to-count { font-size: 0.72rem; color: var(--secondary-text); font-weight: normal; }
    .to-page .to-search { padding: 8px 12px; background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px; color: var(--primary-text); font-size: 0.85rem; font-family: inherit; }
    .to-page .to-search:focus { outline: none; border-color: var(--button-bg, #6366f1); }

    .to-page .to-agent-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding: 2px; list-style: none; margin: 0; }
    .to-page .to-agent-card { display: grid; grid-template-columns: 36px 1fr auto; gap: 10px; align-items: center; padding: 9px 12px; background: var(--tertiary-bg, var(--card-bg)); border: 1px solid var(--border-color); border-radius: 10px; cursor: pointer; transition: all 0.15s; }
    .to-page .to-agent-card:hover { transform: translateX(2px); box-shadow: 0 2px 8px rgba(180, 120, 140, 0.1); border-color: var(--button-bg, #6366f1); }
    .to-page .to-agent-card.active { background: linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(180, 120, 160, 0.08)); border-color: var(--button-bg, #6366f1); box-shadow: 0 0 0 1px var(--button-bg, #6366f1) inset; }
    .to-page .to-agent-avatar { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 600; font-size: 0.95rem; background: linear-gradient(135deg, #ff9bb3, #b478a0); text-shadow: 0 1px 2px rgba(0, 0, 0, 0.15); }
    .to-page .to-agent-info { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .to-page .to-agent-name { font-size: 0.88rem; color: var(--primary-text); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .to-page .to-agent-meta { font-size: 0.72rem; color: var(--secondary-text); }
    .to-page .to-agent-status { display: flex; align-items: center; gap: 4px; }
    .to-page .to-status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--border-color); }
    .to-page .to-status-dot.has-json { background: #6366f1; }
    .to-page .to-status-dot.has-txt { background: #22c55e; }

    /* ===== 右侧主编辑区 ===== */
    .to-page .to-main { flex: 1; display: flex; flex-direction: column; gap: 14px; min-width: 0; overflow: hidden; }

    .to-page .to-help { background: var(--card-bg); border: 1px solid var(--border-color); border-left: 4px solid var(--button-bg, #6366f1); border-radius: 10px; padding: 12px 16px; font-size: 0.84rem; line-height: 1.7; color: var(--primary-text); }
    .to-page .to-help summary { cursor: pointer; font-weight: 600; color: var(--button-bg, #6366f1); list-style: none; display: flex; align-items: center; gap: 6px; user-select: none; }
    .to-page .to-help summary::-webkit-details-marker { display: none; }
    .to-page .to-help summary::before { content: '▶'; font-size: 0.7em; transition: transform 0.2s; }
    .to-page .to-help[open] summary::before { transform: rotate(90deg); }
    .to-page .to-help code { background: var(--background-color); padding: 1px 6px; border-radius: 3px; color: var(--primary-text); font-family: 'JetBrains Mono', monospace; font-size: 0.85em; }
    .to-page .to-help ol { padding-left: 22px; margin: 6px 0; }
    .to-page .to-help li { margin: 3px 0; }

    .to-page .to-empty { background: var(--card-bg); border: 1px dashed var(--border-color); border-radius: 10px; padding: 40px 20px; text-align: center; color: var(--secondary-text); font-size: 0.88rem; }

    .to-page .to-toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 10px 14px; background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 10px; }
    .to-page .to-toolbar .to-title { font-size: 0.95rem; font-weight: 600; color: var(--primary-text); margin-right: auto; display: flex; gap: 10px; align-items: baseline; }
    .to-page .to-toolbar .to-title .to-meta { font-size: 0.74rem; color: var(--secondary-text); font-weight: normal; }
    .to-page .to-toolbar .to-title .to-dirty { font-size: 0.74rem; color: #f59e0b; font-weight: normal; }

    /* ===== 按钮（与主面板统一） ===== */
    .to-page .to-btn { padding: 7px 12px; background: var(--button-bg, #6366f1); color: #fff; border: 1px solid var(--button-bg, #6366f1); border-radius: 6px; cursor: pointer; font-size: 0.82rem; font-weight: 500; transition: all 0.15s; display: inline-flex; align-items: center; gap: 5px; font-family: inherit; }
    .to-page .to-btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
    .to-page .to-btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; filter: none; }
    .to-page .to-btn .material-symbols-outlined { font-size: 18px; }
    .to-page .to-btn.ghost { background: transparent; color: var(--primary-text); border-color: var(--border-color); }
    .to-page .to-btn.ghost:hover { background: var(--accent-bg, rgba(99, 102, 241, 0.08)); border-color: var(--button-bg, #6366f1); color: var(--button-bg, #6366f1); }
    .to-page .to-btn.success { background: #22c55e; border-color: #22c55e; }
    .to-page .to-btn.compact { padding: 4px 9px; font-size: 0.75rem; }
    .to-page .to-btn.compact .material-symbols-outlined { font-size: 15px; }

    /* Icon-only 删除按钮（ghost 风格，hover 才红） */
    .to-page .to-icon-btn { width: 30px; height: 30px; padding: 0; display: inline-flex; align-items: center; justify-content: center; background: transparent; border: 1px solid transparent; border-radius: 6px; color: var(--secondary-text); cursor: pointer; transition: all 0.15s; }
    .to-page .to-icon-btn .material-symbols-outlined { font-size: 18px; }
    .to-page .to-icon-btn:hover { background: rgba(239, 68, 68, 0.1); color: #ef4444; border-color: rgba(239, 68, 68, 0.3); }
    .to-page .to-icon-btn.small { width: 26px; height: 26px; }
    .to-page .to-icon-btn.small .material-symbols-outlined { font-size: 15px; }

    /* ===== 日期卡片 ===== */
    .to-page .to-entries { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 2px 2px 8px; }
    .to-page .to-day-card { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 10px; overflow: hidden; }
    .to-page .to-day-head { display: flex; justify-content: space-between; align-items: center; padding: 9px 14px; background: var(--background-color); border-bottom: 1px solid var(--border-color); }
    .to-page .to-day-date { font-size: 0.88rem; font-weight: 600; color: var(--primary-text); font-family: 'JetBrains Mono', monospace; display: flex; align-items: center; gap: 6px; }
    .to-page .to-day-date .material-symbols-outlined { font-size: 17px; color: var(--button-bg, #6366f1); }
    .to-page .to-day-actions { display: flex; gap: 4px; }
    .to-page .to-day-body { padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; }
    .to-page .to-entry { display: flex; gap: 8px; align-items: flex-start; }
    .to-page .to-entry textarea { flex: 1; padding: 7px 10px; background: var(--background-color); border: 1px solid var(--border-color); border-radius: 6px; color: var(--primary-text); font-size: 0.83rem; font-family: inherit; resize: vertical; min-height: 46px; line-height: 1.5; }
    .to-page .to-entry textarea:focus { outline: none; border-color: var(--button-bg, #6366f1); }
    .to-page .to-add-entry { border: 1px dashed var(--border-color); border-radius: 6px; padding: 7px 10px; color: var(--secondary-text); cursor: pointer; text-align: center; font-size: 0.78rem; background: transparent; transition: all 0.15s; display: inline-flex; align-items: center; justify-content: center; gap: 4px; font-family: inherit; }
    .to-page .to-add-entry .material-symbols-outlined { font-size: 15px; }
    .to-page .to-add-entry:hover { border-color: var(--button-bg, #6366f1); color: var(--button-bg, #6366f1); }

    .to-page .to-add-day { background: var(--card-bg); border: 1px dashed var(--border-color); border-radius: 10px; padding: 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .to-page .to-add-day input[type="date"] { padding: 6px 10px; background: var(--background-color); border: 1px solid var(--border-color); border-radius: 6px; color: var(--primary-text); font-size: 0.83rem; font-family: inherit; }
    .to-page .to-add-day .to-hint { font-size: 0.72rem; color: var(--secondary-text); margin-left: auto; opacity: 0.85; }

    .to-page .to-preview { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 10px; padding: 14px; max-height: 60vh; overflow-y: auto; font-family: 'JetBrains Mono', monospace; font-size: 0.82rem; white-space: pre-wrap; line-height: 1.6; color: var(--primary-text); }
  `;
  document.head.appendChild(styleEl);

  const API_BASE = '/admin_api/plugins/TimelineOrganizer/api';

  // Agent 头像首字母（支持中英文）
  function agentInitial(name) {
    if (!name) return '?';
    const ch = name.trim().charAt(0);
    return ch.toUpperCase();
  }

  const TimelinePage = {
    name: 'TimelineOrganizerPage',
    template: `
      <div class="to-page">
        <!-- 左侧：Agent 列表 -->
        <div class="to-sidebar">
          <h3>
            Agent 列表
            <span class="to-count">{{ filteredAgents.length }} / {{ agents.length }}</span>
          </h3>
          <input class="to-search" v-model="search" placeholder="搜索 Agent..." />
          <ul class="to-agent-list">
            <li
              v-for="a in filteredAgents"
              :key="a.name"
              class="to-agent-card"
              :class="{ active: selected === a.name }"
              @click="selectAgent(a.name)"
            >
              <div class="to-agent-avatar">{{ initial(a.name) }}</div>
              <div class="to-agent-info">
                <div class="to-agent-name">{{ a.name }}</div>
                <div class="to-agent-meta">{{ agentMeta(a) }}</div>
              </div>
              <div class="to-agent-status" :title="statusTitle(a)">
                <span class="to-status-dot" :class="{ 'has-json': a.hasTimeline }"></span>
                <span class="to-status-dot" :class="{ 'has-txt': a.hasGeneratedTxt }"></span>
              </div>
            </li>
            <li v-if="filteredAgents.length === 0" class="to-empty" style="padding: 20px 10px; list-style: none;">
              {{ search ? '无匹配 Agent' : 'Agent/ 目录下暂无 Agent' }}
            </li>
          </ul>
        </div>

        <!-- 右侧：编辑器 -->
        <div class="to-main">
          <details class="to-help">
            <summary>时间线整理器使用说明</summary>
            <div style="margin-top: 10px;">
              <p><strong>做什么</strong>：为每个 Agent 管理生平时间线（按日期记录 summary），一键生成 Markdown 格式到 <code>TVStxt/Timeline{Agent}.txt</code>。</p>
              <p><strong>一键流程</strong>：</p>
              <ol>
                <li>左侧选一个 Agent（如 <code>Nova</code>）</li>
                <li>添加日期 + 每天的 summary，点 <code>保存草稿</code></li>
                <li>点 <code>一键生成</code> → 插件自动把 <code>VarTimelineNova=TimelineNova.txt</code> 写入 config.env</li>
                <li>Agent 提示词里的 <code v-text="placeholderExample"></code> 立即生效</li>
              </ol>
              <p><strong>数据位置</strong>：草稿 JSON 在 <code>Plugin/TimelineOrganizer/data/</code>，生成 TXT 在 <code>TVStxt/</code>。</p>
            </div>
          </details>

          <div v-if="!selected" class="to-empty">
            <span class="material-symbols-outlined" style="font-size: 36px; opacity: 0.4; display: block; margin-bottom: 8px;">timeline</span>
            👈 请在左侧选择一个 Agent
          </div>

          <template v-else>
            <div class="to-toolbar">
              <div class="to-title">
                <span>{{ selected }} 的时间线</span>
                <span class="to-meta" v-if="timeline.lastUpdated">· 更新于 {{ timeline.lastUpdated }}</span>
                <span class="to-meta">· {{ dateCount }} 天 / {{ entryCount }} 条</span>
                <span v-if="dirty" class="to-dirty">● 未保存</span>
              </div>
              <button class="to-btn ghost" @click="togglePreview" :disabled="!hasEntries">
                <span class="material-symbols-outlined">{{ previewOpen ? 'edit_note' : 'visibility' }}</span>
                {{ previewOpen ? '返回编辑' : '预览' }}
              </button>
              <button class="to-btn ghost" @click="save" :disabled="!dirty || saving">
                <span class="material-symbols-outlined">save</span>
                {{ saving ? '保存中' : '保存草稿' }}
              </button>
              <button class="to-btn success" @click="generate" :disabled="!hasEntries || generating">
                <span class="material-symbols-outlined">auto_awesome</span>
                {{ generating ? '生成中' : '一键生成' }}
              </button>
              <button class="to-icon-btn" @click="remove" title="删除时间线（JSON + TXT + env 绑定）">
                <span class="material-symbols-outlined">delete</span>
              </button>
            </div>

            <div v-if="previewOpen" class="to-preview">{{ previewText }}</div>

            <div class="to-entries" v-else>
              <div
                v-for="date in sortedDates"
                :key="date"
                class="to-day-card"
              >
                <div class="to-day-head">
                  <span class="to-day-date">
                    <span class="material-symbols-outlined">calendar_today</span>
                    {{ date }}
                  </span>
                  <div class="to-day-actions">
                    <button class="to-btn ghost compact" @click="addEntry(date)">
                      <span class="material-symbols-outlined">add</span>
                      条目
                    </button>
                    <button class="to-icon-btn small" @click="removeDay(date)" title="删除此天">
                      <span class="material-symbols-outlined">delete</span>
                    </button>
                  </div>
                </div>
                <div class="to-day-body">
                  <div
                    v-for="(entry, idx) in timeline.entries[date]"
                    :key="idx"
                    class="to-entry"
                  >
                    <textarea
                      :value="entry.summary"
                      @input="updateEntry(date, idx, $event.target.value)"
                      placeholder="今天发生了什么..."
                    ></textarea>
                    <button class="to-icon-btn small" @click="removeEntry(date, idx)" title="删除此条">
                      <span class="material-symbols-outlined">close</span>
                    </button>
                  </div>
                  <button class="to-add-entry" @click="addEntry(date)">
                    <span class="material-symbols-outlined">add</span>
                    添加条目
                  </button>
                </div>
              </div>

              <div class="to-add-day">
                <input type="date" v-model="newDate" />
                <button class="to-btn" @click="addDay" :disabled="!newDate">
                  <span class="material-symbols-outlined">add</span>
                  添加日期
                </button>
                <span class="to-hint">新增日期会自动创建一个空条目</span>
              </div>
            </div>
          </template>
        </div>
      </div>
    `,
    setup() {
      const agents = ref([]);
      const search = ref('');
      const selected = ref(null);
      const timeline = ref({ character: '', lastUpdated: null, entries: {} });
      const dirty = ref(false);
      const saving = ref(false);
      const generating = ref(false);
      const previewOpen = ref(false);
      const newDate = ref('');

      const filteredAgents = computed(() => {
        const q = search.value.trim().toLowerCase();
        if (!q) return agents.value;
        return agents.value.filter(a => a.name.toLowerCase().includes(q));
      });

      const sortedDates = computed(() => Object.keys(timeline.value.entries || {}).sort());
      const dateCount = computed(() => sortedDates.value.length);
      const entryCount = computed(() => {
        let n = 0;
        for (const d of sortedDates.value) n += (timeline.value.entries[d] || []).length;
        return n;
      });
      const hasEntries = computed(() => entryCount.value > 0);

      const placeholderExample = computed(() => {
        const name = selected.value || 'Agent';
        return '{' + '{VarTimeline' + name + '}' + '}';
      });

      const previewText = computed(() => {
        if (!timeline.value.entries) return '';
        const lines = [];
        lines.push('# ' + (timeline.value.character || selected.value) + '的时间线');
        lines.push('> 最后更新: ' + (timeline.value.lastUpdated || new Date().toISOString().slice(0, 10)));
        lines.push('---');
        lines.push('');
        const dates = sortedDates.value;
        for (let i = 0; i < dates.length; i++) {
          lines.push('## ' + dates[i]);
          for (const entry of (timeline.value.entries[dates[i]] || [])) {
            const summary = (entry.summary || '').trim().replace(/[。<]+$/, '');
            if (summary) lines.push('- ' + summary);
          }
          if (i < dates.length - 1) lines.push('');
        }
        return lines.join('\n') + '\n';
      });

      function initial(name) { return agentInitial(name); }

      function agentMeta(a) {
        if (a.hasTimeline && a.hasGeneratedTxt) return '已生成 · 已注册变量';
        if (a.hasTimeline) return '有草稿 · 未生成';
        if (a.hasGeneratedTxt) return '已生成（无草稿）';
        return '未创建';
      }

      function statusTitle(a) {
        return '草稿 JSON: ' + (a.hasTimeline ? '✓' : '—') + '  |  生成 TXT: ' + (a.hasGeneratedTxt ? '✓' : '—');
      }

      async function loadAgents() {
        try {
          const res = await fetch(API_BASE + '/agents', { credentials: 'include' });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const data = await res.json();
          if (!data.success) throw new Error(data.error || '加载失败');
          agents.value = data.agents || [];
        } catch (e) {
          showToast('加载 Agent 列表失败：' + e.message, 'error');
        }
      }

      async function selectAgent(name) {
        if (dirty.value && !confirm('当前有未保存的修改，切换 Agent 会丢失。确定切换？')) return;
        selected.value = name;
        previewOpen.value = false;
        dirty.value = false;
        try {
          const res = await fetch(API_BASE + '/timeline/' + encodeURIComponent(name), { credentials: 'include' });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const data = await res.json();
          if (!data.success) throw new Error(data.error || '读取失败');
          timeline.value = data.data || { character: name, lastUpdated: null, entries: {} };
          if (!timeline.value.entries || typeof timeline.value.entries !== 'object') {
            timeline.value.entries = {};
          }
        } catch (e) {
          showToast('读取时间线失败：' + e.message, 'error');
          timeline.value = { character: name, lastUpdated: null, entries: {} };
        }
      }

      function markDirty() { dirty.value = true; }

      function addDay() {
        if (!newDate.value) return;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate.value)) {
          showToast('日期格式必须为 YYYY-MM-DD', 'error');
          return;
        }
        if (timeline.value.entries[newDate.value]) {
          showToast('该日期已存在', 'warn');
          return;
        }
        timeline.value.entries[newDate.value] = [{ summary: '' }];
        newDate.value = '';
        markDirty();
      }

      function removeDay(date) {
        if (!confirm('确定删除 ' + date + ' 这一天的所有条目？')) return;
        delete timeline.value.entries[date];
        markDirty();
      }

      function addEntry(date) {
        if (!timeline.value.entries[date]) timeline.value.entries[date] = [];
        timeline.value.entries[date].push({ summary: '' });
        markDirty();
      }

      function updateEntry(date, idx, value) {
        if (timeline.value.entries[date] && timeline.value.entries[date][idx]) {
          timeline.value.entries[date][idx].summary = value;
          markDirty();
        }
      }

      function removeEntry(date, idx) {
        const list = timeline.value.entries[date];
        if (!list) return;
        list.splice(idx, 1);
        if (list.length === 0) delete timeline.value.entries[date];
        markDirty();
      }

      function togglePreview() { previewOpen.value = !previewOpen.value; }

      async function save() {
        if (!selected.value) return;
        saving.value = true;
        try {
          const payload = {
            character: timeline.value.character || selected.value,
            entries: timeline.value.entries,
          };
          const res = await fetch(API_BASE + '/timeline/' + encodeURIComponent(selected.value), {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.error || '保存失败');
          timeline.value = data.data;
          dirty.value = false;
          showToast('草稿已保存', 'success');
          await loadAgents();
        } catch (e) {
          showToast('保存失败：' + e.message, 'error');
        } finally {
          saving.value = false;
        }
      }

      async function generate() {
        if (!selected.value) return;
        if (dirty.value) {
          if (!confirm('当前有未保存的修改。一键生成将使用【最后保存】的草稿，建议先点保存。继续？')) return;
        }
        generating.value = true;
        try {
          const res = await fetch(API_BASE + '/generate/' + encodeURIComponent(selected.value), {
            method: 'POST', credentials: 'include',
          });
          const data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.error || '生成失败');
          const r = data.result;
          const envMsg = r.envRegistered ? '，已注册 {{' + r.envKey + '}}' : '';
          showToast('已生成 TVStxt/' + r.file + '（' + r.dates + ' 天）' + envMsg, 'success');
          await loadAgents();
        } catch (e) {
          showToast('生成失败：' + e.message, 'error');
        } finally {
          generating.value = false;
        }
      }

      async function remove() {
        if (!selected.value) return;
        if (!confirm('确定删除 ' + selected.value + ' 的时间线？同时清理草稿 JSON、生成的 TXT 和 config.env 中的 VarTimeline 绑定。')) return;
        try {
          const res = await fetch(API_BASE + '/timeline/' + encodeURIComponent(selected.value), {
            method: 'DELETE', credentials: 'include',
          });
          const data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.error || '删除失败');
          showToast('已删除', 'success');
          timeline.value = { character: selected.value, lastUpdated: null, entries: {} };
          dirty.value = false;
          await loadAgents();
        } catch (e) {
          showToast('删除失败：' + e.message, 'error');
        }
      }

      onMounted(() => { loadAgents(); });

      return {
        agents, search, selected, timeline, dirty, saving, generating, previewOpen, newDate,
        filteredAgents, sortedDates, dateCount, entryCount, hasEntries, previewText, placeholderExample,
        initial, agentMeta, statusTitle,
        selectAgent, addDay, removeDay, addEntry, updateEntry, removeEntry, togglePreview,
        save, generate, remove,
      };
    },
  };

  P.register('TimelineOrganizer', TimelinePage);
})();
