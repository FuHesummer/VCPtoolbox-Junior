// DailyHot 管理面板（native 模式）
// 调用主项目 /admin_api/dailyhot 展示所有主流平台实时热榜
(function () {
  const P = window.__VCPPanel;
  if (!P) { console.error('[DailyHot] __VCPPanel 未就绪'); return; }

  const { ref, computed, onMounted } = P.Vue;
  const { showToast } = P;

  const styleId = 'dailyhot-style';
  if (!document.getElementById(styleId)) {
    const el = document.createElement('style');
    el.id = styleId;
    el.textContent = `
      .dailyhot-page .tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
      .dailyhot-page .tab { padding: 5px 12px; border-radius: 14px; font-size: 0.78rem; cursor: pointer; background: var(--background-color); border: 1px solid var(--border-color); color: var(--secondary-text); transition: all 0.15s; user-select: none; }
      .dailyhot-page .tab:hover { border-color: var(--accent-bg); color: var(--primary-text); }
      .dailyhot-page .tab.active { background: var(--accent-bg); color: var(--button-bg); border-color: var(--accent-bg); font-weight: 500; }
      .dailyhot-page .tab .count { opacity: 0.65; margin-left: 4px; font-size: 0.72rem; }
      .dailyhot-page .hot-card { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 10px; overflow: hidden; }
      .dailyhot-page .hot-item { display: grid; grid-template-columns: 28px 1fr auto; gap: 12px; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--border-color); font-size: 0.88rem; }
      .dailyhot-page .hot-item:last-child { border-bottom: none; }
      .dailyhot-page .hot-item:hover { background: var(--background-color); }
      .dailyhot-page .hot-rank { font-weight: 700; color: var(--secondary-text); text-align: center; font-variant-numeric: tabular-nums; }
      .dailyhot-page .hot-rank.top3 { color: #e74c3c; }
      .dailyhot-page .hot-title { color: var(--primary-text); line-height: 1.45; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; text-decoration: none; }
      .dailyhot-page .hot-title:hover { color: var(--accent-bg); }
      .dailyhot-page .hot-heat { font-size: 0.72rem; color: var(--secondary-text); opacity: 0.8; white-space: nowrap; }
      .dailyhot-page .meta-line { display: flex; justify-content: space-between; color: var(--secondary-text); font-size: 0.78rem; margin-bottom: 8px; opacity: 0.75; }
    `;
    document.head.appendChild(el);
  }

  const DailyHotPage = {
    name: 'DailyHotPage',
    template: /* html */ `
      <div class="page dailyhot-page">
        <PageHeader title="每日热榜" subtitle="主流平台实时热榜聚合（由 DailyHot 插件周期性刷新）" icon="trending_up">
          <template #actions>
            <button class="btn btn-ghost" @click="load" :disabled="loading">
              <span class="material-symbols-outlined">{{ loading ? 'hourglass_top' : 'refresh' }}</span>
              刷新
            </button>
          </template>
        </PageHeader>

        <div class="content" style="padding: 0 24px 24px;">
          <EmptyState v-if="loading && sources.length === 0" icon="hourglass_top" message="加载热榜数据中..." />

          <div v-else-if="error" class="card" style="padding: 20px; color: var(--danger-text, #c0392b);">
            {{ error }}
            <div style="margin-top: 8px; font-size: 0.82rem; color: var(--secondary-text);">
              热榜数据依赖 DailyHot 插件周期性刷新，请确认插件已启用。
            </div>
          </div>

          <template v-else-if="sources.length > 0">
            <div class="meta-line">
              <span>共 {{ sources.length }} 个来源 · {{ totalCount }} 条</span>
              <span>当前：{{ activeSource }}</span>
            </div>

            <div class="tabs">
              <span
                v-for="src in sources"
                :key="src"
                class="tab"
                :class="{ active: src === activeSource }"
                @click="activeSource = src"
              >
                {{ src }}<span class="count">({{ grouped[src].length }})</span>
              </span>
            </div>

            <div class="hot-card">
              <div v-for="(item, i) in currentItems" :key="i" class="hot-item">
                <span class="hot-rank" :class="{ top3: i < 3 }">{{ i + 1 }}</span>
                <a
                  v-if="item.url"
                  :href="item.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="hot-title"
                >{{ item.title || item }}</a>
                <span v-else class="hot-title">{{ item.title || item }}</span>
                <span v-if="item.hot" class="hot-heat">{{ item.hot }}</span>
              </div>
            </div>
          </template>

          <EmptyState v-else icon="inbox" message="热榜数据暂未就绪，请稍后刷新" />
        </div>
      </div>
    `,
    setup() {
      const loading = ref(false);
      const error = ref('');
      const grouped = ref({});
      const activeSource = ref('');

      const sources = computed(() => Object.keys(grouped.value));
      const totalCount = computed(() => sources.value.reduce((s, k) => s + grouped.value[k].length, 0));
      const currentItems = computed(() => grouped.value[activeSource.value] || []);

      async function load() {
        loading.value = true;
        error.value = '';
        try {
          const res = await fetch('/admin_api/dailyhot', { credentials: 'include' });
          if (!res.ok) throw new Error(`热榜 API 返回 ${res.status}`);
          const raw = await res.json();
          const items = raw.data || raw;

          const next = {};
          if (Array.isArray(items)) {
            for (const item of items) {
              const src = item.source || '未知';
              if (!next[src]) next[src] = [];
              next[src].push(item);
            }
          } else if (items && typeof items === 'object') {
            Object.assign(next, items);
          }
          grouped.value = next;

          if (!activeSource.value || !next[activeSource.value]) {
            activeSource.value = Object.keys(next)[0] || '';
          }
        } catch (e) {
          error.value = e.message || '加载失败';
          if (sources.value.length > 0) showToast('刷新失败：' + e.message, 'error');
        } finally {
          loading.value = false;
        }
      }

      onMounted(load);
      return { loading, error, grouped, activeSource, sources, totalCount, currentItems, load };
    },
  };

  P.register('DailyHot', DailyHotPage);
})();
