// EmojiListGenerator 管理面板（native 模式）
// 走解耦路径：/admin_api/plugins/EmojiListGenerator/api/*
(function () {
  const P = window.__VCPPanel;
  if (!P) { console.error('[EmojiListGenerator] __VCPPanel 未就绪'); return; }

  const { ref, computed, onMounted, nextTick } = P.Vue;
  const { showToast } = P;

  const styleId = 'emoji-pack-manager-style';
  const oldStyle = document.getElementById(styleId);
  if (oldStyle) oldStyle.remove();
  const styleEl = document.createElement('style');
  styleEl.id = styleId;
  styleEl.textContent = `
    .ep-page { display: flex; gap: 18px; height: calc(100vh - 120px); min-height: 560px; }
    .ep-page .ep-sidebar { width: 320px; flex-shrink: 0; display: flex; flex-direction: column; gap: 12px; }
    .ep-page .ep-sidebar h3 { margin: 0; font-size: 0.95rem; color: var(--primary-text); display: flex; justify-content: space-between; align-items: baseline; font-weight: 600; }
    .ep-page .ep-sidebar h3 .ep-count { font-size: 0.72rem; color: var(--secondary-text); font-weight: normal; }

    .ep-page .ep-toolbar { display: flex; gap: 8px; flex-wrap: wrap; }
    .ep-page .ep-btn { display: inline-flex; align-items: center; gap: 4px; padding: 6px 12px; border-radius: 20px; border: 1px solid var(--border-color); background: var(--card-bg); color: var(--primary-text); cursor: pointer; font-size: 0.8rem; font-weight: 500; transition: all 0.12s; }
    .ep-page .ep-btn:hover:not(:disabled) { filter: brightness(1.05); transform: translateY(-1px); }
    .ep-page .ep-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .ep-page .ep-btn .material-symbols-outlined { font-size: 16px; }
    .ep-page .ep-btn.primary { background: linear-gradient(135deg, #facc15, #f59e0b); color: #fff; border: none; }
    .ep-page .ep-btn.regen { background: linear-gradient(135deg, #0ea5e9, #6366f1); color: #fff; border: none; }
    .ep-page .ep-btn.danger { background: rgba(239, 68, 68, 0.1); color: #dc2626; border-color: rgba(239, 68, 68, 0.3); }
    .ep-page .ep-btn.danger:hover:not(:disabled) { background: rgba(239, 68, 68, 0.2); }

    .ep-page .ep-pack-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding: 2px; list-style: none; margin: 0; }
    .ep-page .ep-pack-card { display: grid; grid-template-columns: 36px 1fr auto; gap: 10px; align-items: center; padding: 10px 12px; background: var(--tertiary-bg, var(--card-bg)); border: 1px solid var(--border-color); border-radius: 10px; cursor: pointer; transition: all 0.15s; }
    .ep-page .ep-pack-card:hover { transform: translateX(2px); border-color: #f59e0b; }
    .ep-page .ep-pack-card.active { background: linear-gradient(135deg, rgba(250, 204, 21, 0.12), rgba(245, 158, 11, 0.08)); border-color: #f59e0b; box-shadow: 0 0 0 1px #f59e0b inset; }
    .ep-page .ep-pack-icon { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #facc15, #f59e0b); color: #fff; }
    .ep-page .ep-pack-info { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .ep-page .ep-pack-name { font-weight: 600; color: var(--primary-text); font-size: 0.88rem; }
    .ep-page .ep-pack-meta { font-size: 0.72rem; color: var(--secondary-text); display: flex; gap: 8px; align-items: center; }
    .ep-page .ep-pack-meta .dot { width: 4px; height: 4px; border-radius: 50%; background: #22c55e; }
    .ep-page .ep-pack-meta .dot.stale { background: #f59e0b; }
    .ep-page .ep-pack-badge { padding: 2px 8px; border-radius: 10px; font-size: 0.7rem; font-weight: 600; background: rgba(245, 158, 11, 0.15); color: #b45309; }

    /* ===== 右侧详情 ===== */
    .ep-page .ep-main { flex: 1; display: flex; flex-direction: column; gap: 12px; min-width: 0; min-height: 0; overflow: hidden; }
    .ep-page .ep-main-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 10px; }
    .ep-page .ep-main-title { display: flex; align-items: center; gap: 10px; font-size: 1rem; font-weight: 600; color: var(--primary-text); }
    .ep-page .ep-main-title code { background: rgba(245, 158, 11, 0.12); color: #b45309; padding: 2px 8px; border-radius: 6px; font-size: 0.8rem; font-family: 'JetBrains Mono', Consolas, monospace; }
    .ep-page .ep-main-actions { display: flex; gap: 6px; }

    .ep-page .ep-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--secondary-text); gap: 12px; }
    .ep-page .ep-empty .material-symbols-outlined { font-size: 64px; opacity: 0.3; }

    .ep-page .ep-grid { flex: 1; min-height: 0; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; padding: 4px; align-content: start; scrollbar-width: thin; }
    .ep-page .ep-grid::-webkit-scrollbar { width: 8px; }
    .ep-page .ep-grid::-webkit-scrollbar-thumb { background: rgba(245, 158, 11, 0.4); border-radius: 4px; }
    .ep-page .ep-grid::-webkit-scrollbar-thumb:hover { background: rgba(245, 158, 11, 0.6); }
    .ep-page .ep-main-header, .ep-page .ep-drop, .ep-page .ep-page-controls { flex-shrink: 0; }

    /* ===== 分页 + 搜索控件 ===== */
    .ep-page .ep-page-controls { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 10px; flex-wrap: wrap; }
    .ep-page .ep-search { flex: 1; min-width: 180px; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--input-bg); color: var(--primary-text); font-size: 0.82rem; font-family: inherit; }
    .ep-page .ep-search:focus { outline: none; border-color: #f59e0b; }
    .ep-page .ep-meta { font-size: 0.78rem; color: var(--secondary-text); white-space: nowrap; }
    .ep-page .ep-meta strong { color: var(--primary-text); font-weight: 600; }

    .ep-page .ep-size-group { display: flex; align-items: center; gap: 4px; }
    .ep-page .ep-size-group label { font-size: 0.75rem; color: var(--secondary-text); margin-right: 2px; }
    .ep-page .ep-size-btn { padding: 3px 10px; border-radius: 12px; border: 1px solid var(--border-color); background: transparent; color: var(--secondary-text); cursor: pointer; font-size: 0.72rem; font-weight: 500; transition: all 0.12s; }
    .ep-page .ep-size-btn:hover:not(.active) { border-color: #f59e0b; color: #f59e0b; }
    .ep-page .ep-size-btn.active { background: linear-gradient(135deg, #facc15, #f59e0b); border-color: transparent; color: #fff; font-weight: 600; }

    .ep-page .ep-pager { display: flex; align-items: center; gap: 2px; margin-left: auto; }
    .ep-page .ep-page-btn { width: 26px; height: 26px; border-radius: 6px; border: 1px solid var(--border-color); background: transparent; color: var(--primary-text); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.12s; }
    .ep-page .ep-page-btn:hover:not(:disabled) { background: rgba(245, 158, 11, 0.1); border-color: #f59e0b; color: #b45309; }
    .ep-page .ep-page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .ep-page .ep-page-btn .material-symbols-outlined { font-size: 16px; }
    .ep-page .ep-page-info { font-size: 0.78rem; color: var(--secondary-text); padding: 0 6px; user-select: none; }
    .ep-page .ep-page-info strong { color: #b45309; font-weight: 700; }
    .ep-page .ep-tile { position: relative; aspect-ratio: 1 / 1; border-radius: 8px; overflow: hidden; background: var(--tertiary-bg, var(--card-bg)); border: 1px solid var(--border-color); cursor: default; transition: all 0.12s; }
    .ep-page .ep-tile:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(245, 158, 11, 0.2); border-color: #f59e0b; }
    .ep-page .ep-tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .ep-page .ep-tile-name { position: absolute; left: 0; right: 0; bottom: 0; padding: 3px 6px; background: linear-gradient(transparent, rgba(0,0,0,0.7)); color: #fff; font-size: 0.65rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ep-page .ep-tile-del { position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; border-radius: 50%; border: none; background: rgba(0,0,0,0.6); color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; opacity: 0; transition: opacity 0.12s; }
    .ep-page .ep-tile:hover .ep-tile-del { opacity: 1; }
    .ep-page .ep-tile-del:hover { background: #dc2626; }
    .ep-page .ep-tile-del .material-symbols-outlined { font-size: 14px; }

    .ep-page .ep-hint { padding: 10px 14px; background: linear-gradient(135deg, rgba(245, 158, 11, 0.06), rgba(250, 204, 21, 0.03)); border: 1px dashed rgba(245, 158, 11, 0.3); border-radius: 8px; font-size: 0.78rem; color: var(--secondary-text); }
    .ep-page .ep-hint code { background: rgba(0,0,0,0.06); padding: 1px 6px; border-radius: 4px; font-size: 0.72rem; font-family: 'JetBrains Mono', Consolas, monospace; }
    .ep-page .ep-hint.warn { border-color: rgba(239, 68, 68, 0.3); background: rgba(239, 68, 68, 0.05); color: #b91c1c; }

    .ep-page .ep-drop { position: relative; border: 2px dashed rgba(245, 158, 11, 0.4); border-radius: 10px; padding: 20px; text-align: center; transition: all 0.15s; color: var(--secondary-text); background: rgba(245, 158, 11, 0.03); cursor: pointer; }
    .ep-page .ep-drop:hover, .ep-page .ep-drop.dragover { border-color: #f59e0b; background: rgba(245, 158, 11, 0.1); }
    .ep-page .ep-drop input[type="file"] { display: none; }
    .ep-page .ep-drop .material-symbols-outlined { font-size: 28px; vertical-align: middle; color: #f59e0b; }

    .ep-page .ep-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
    .ep-page .ep-modal { background: var(--primary-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; min-width: 360px; box-shadow: 0 8px 24px rgba(0,0,0,0.2); }
    .ep-page .ep-modal h4 { margin: 0 0 12px; color: var(--primary-text); }
    .ep-page .ep-modal input { width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--input-bg); color: var(--primary-text); font-size: 0.9rem; box-sizing: border-box; }
    .ep-page .ep-modal-actions { margin-top: 14px; display: flex; gap: 8px; justify-content: flex-end; }
  `;
  document.head.appendChild(styleEl);

  const apiBase = '/admin_api/plugins/EmojiListGenerator/api';

  async function api(method, path, body) {
    const init = { method, credentials: 'include' };
    if (body instanceof FormData) {
      init.body = body;
    } else if (body) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const res = await fetch(apiBase + path, init);
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); msg = j.error || msg; } catch {}
      throw new Error(msg);
    }
    return res.json();
  }

  const EmojiPackManager = {
    name: 'EmojiPackManager',
    setup() {
      const packs = ref([]);
      const imageKeyConfigured = ref(false);
      const selectedName = ref(null);
      const images = ref([]);
      const imagesLoading = ref(false);
      const regenerating = ref(false);
      const uploading = ref(false);
      const dragover = ref(false);
      const newPackDialog = ref(false);
      const newPackName = ref('');
      const fileInputRef = ref(null);

      // 分页
      const pageSize = ref(Number(localStorage.getItem('ep-pageSize') || 48));
      const currentPage = ref(1);
      const searchKeyword = ref('');

      const selectedPack = computed(() => packs.value.find(p => p.name === selectedName.value) || null);

      const filteredImages = computed(() => {
        const kw = searchKeyword.value.trim().toLowerCase();
        if (!kw) return images.value;
        return images.value.filter(i => i.name.toLowerCase().includes(kw));
      });

      const totalPages = computed(() => {
        if (pageSize.value === 0) return 1;
        return Math.max(1, Math.ceil(filteredImages.value.length / pageSize.value));
      });

      const paginatedImages = computed(() => {
        if (pageSize.value === 0) return filteredImages.value;
        const start = (currentPage.value - 1) * pageSize.value;
        return filteredImages.value.slice(start, start + pageSize.value);
      });

      function gotoPage(n) {
        const p = Math.max(1, Math.min(totalPages.value, n));
        currentPage.value = p;
      }
      function changePageSize(size) {
        pageSize.value = size;
        localStorage.setItem('ep-pageSize', String(size));
        currentPage.value = 1;
      }

      async function loadPacks() {
        try {
          const r = await api('GET', '/packs');
          packs.value = r.packs || [];
          imageKeyConfigured.value = !!r.imageKeyConfigured;
          if (selectedName.value && !packs.value.find(p => p.name === selectedName.value)) {
            selectedName.value = null;
            images.value = [];
          }
        } catch (e) { showToast('加载表情包列表失败: ' + e.message, 'error'); }
      }

      async function loadImages(name) {
        imagesLoading.value = true;
        try {
          const r = await api('GET', `/packs/${encodeURIComponent(name)}/images`);
          images.value = r.images || [];
        } catch (e) {
          showToast('加载图片失败: ' + e.message, 'error');
          images.value = [];
        } finally { imagesLoading.value = false; }
      }

      async function selectPack(name) {
        selectedName.value = name;
        currentPage.value = 1;
        searchKeyword.value = '';
        await loadImages(name);
      }

      async function createPack() {
        const name = newPackName.value.trim();
        if (!name) return;
        const fullName = name.endsWith('表情包') ? name : name + '表情包';
        try {
          await api('POST', '/packs', { name: fullName });
          showToast(`已创建：${fullName}`, 'success');
          newPackDialog.value = false;
          newPackName.value = '';
          await loadPacks();
          selectedName.value = fullName;
          images.value = [];
        } catch (e) { showToast('创建失败: ' + e.message, 'error'); }
      }

      async function deletePack(name) {
        if (!confirm(`确定删除整个「${name}」目录？该目录下所有图片都会被删除，此操作不可撤销。`)) return;
        try {
          await api('DELETE', `/packs/${encodeURIComponent(name)}`);
          showToast('已删除：' + name, 'success');
          if (selectedName.value === name) { selectedName.value = null; images.value = []; }
          await loadPacks();
        } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
      }

      async function deleteImage(fileName) {
        if (!selectedName.value) return;
        if (!confirm(`确定删除图片「${fileName}」？`)) return;
        try {
          await api('DELETE', `/packs/${encodeURIComponent(selectedName.value)}/images/${encodeURIComponent(fileName)}`);
          showToast('已删除', 'success');
          await loadImages(selectedName.value);
        } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
      }

      async function regenerate() {
        regenerating.value = true;
        try {
          const r = await api('POST', '/regenerate');
          const n = r.result?.generated_files ?? 0;
          showToast(`已重新生成 ${n} 个清单`, 'success');
          await loadPacks();
        } catch (e) {
          showToast('生成失败: ' + e.message, 'error');
        } finally { regenerating.value = false; }
      }

      async function uploadFiles(fileList) {
        if (!selectedName.value || !fileList || fileList.length === 0) return;
        uploading.value = true;
        try {
          const fd = new FormData();
          for (const f of fileList) fd.append('file', f, f.name);
          const r = await api('POST', `/packs/${encodeURIComponent(selectedName.value)}/upload`, fd);
          const ok = r.uploaded?.length || 0;
          const fail = r.errors?.length || 0;
          showToast(`上传完成：成功 ${ok} 张${fail ? `，失败 ${fail} 张` : ''}`, fail > 0 ? 'warning' : 'success');
          if (fail > 0) console.warn('[EmojiListGenerator] 上传失败项:', r.errors);
          await loadImages(selectedName.value);
          await loadPacks();
        } catch (e) {
          showToast('上传失败: ' + e.message, 'error');
        } finally { uploading.value = false; }
      }

      function onFileInput(e) {
        uploadFiles(e.target.files);
        e.target.value = '';
      }

      function onDrop(e) {
        e.preventDefault();
        dragover.value = false;
        if (e.dataTransfer?.files) uploadFiles(e.dataTransfer.files);
      }

      function onDragOver(e) { e.preventDefault(); dragover.value = true; }
      function onDragLeave() { dragover.value = false; }

      function formatSize(bytes) {
        if (!bytes) return '0 B';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1024 / 1024).toFixed(1) + ' MB';
      }

      onMounted(loadPacks);

      return {
        packs, imageKeyConfigured, selectedName, selectedPack, images, imagesLoading,
        regenerating, uploading, dragover, newPackDialog, newPackName, fileInputRef,
        pageSize, currentPage, searchKeyword, filteredImages, totalPages, paginatedImages,
        loadPacks, selectPack, createPack, deletePack, deleteImage, regenerate,
        onFileInput, onDrop, onDragOver, onDragLeave, formatSize, uploadFiles,
        gotoPage, changePageSize,
      };
    },
    template: `
      <div class="ep-page">
        <aside class="ep-sidebar">
          <h3>
            <span>表情包目录</span>
            <span class="ep-count">{{ packs.length }}</span>
          </h3>

          <div class="ep-toolbar">
            <button class="ep-btn primary" @click="newPackDialog = true">
              <span class="material-symbols-outlined">add</span>新建
            </button>
            <button class="ep-btn regen" :disabled="regenerating" @click="regenerate">
              <span class="material-symbols-outlined">{{ regenerating ? 'progress_activity' : 'refresh' }}</span>
              {{ regenerating ? '生成中...' : '重新生成清单' }}
            </button>
          </div>

          <ul class="ep-pack-list">
            <li v-for="p in packs" :key="p.name" class="ep-pack-card" :class="{ active: p.name === selectedName }" @click="selectPack(p.name)">
              <div class="ep-pack-icon">
                <span class="material-symbols-outlined">emoji_emotions</span>
              </div>
              <div class="ep-pack-info">
                <span class="ep-pack-name">{{ p.name }}</span>
                <span class="ep-pack-meta">
                  <span class="dot" :class="{ stale: !p.generatedAt }"></span>
                  {{ p.imageCount }} 张 · {{ formatSize(p.totalSize) }}
                </span>
              </div>
              <span class="ep-pack-badge">{{ p.placeholder }}</span>
            </li>
            <li v-if="!packs.length" class="ep-empty">
              <span class="material-symbols-outlined">image_search</span>
              <span>image/ 下无表情包目录</span>
              <span style="font-size: 0.75rem;">点击「新建」创建第一个 ✨</span>
            </li>
          </ul>

          <div v-if="!imageKeyConfigured" class="ep-hint warn">
            ⚠️ <code>Image_Key</code> 仍是默认占位值，AI 生成的图片 URL 可被他人扫描。
            <br>建议 config.env 改为随机 key（改完需重启主服务）。
          </div>
        </aside>

        <div class="ep-main">
          <div v-if="!selectedPack" class="ep-empty">
            <span class="material-symbols-outlined">arrow_back</span>
            <span>请从左侧选择一个表情包目录</span>
          </div>
          <template v-else>
            <div class="ep-main-header">
              <div class="ep-main-title">
                <span class="material-symbols-outlined">folder_special</span>
                {{ selectedPack.name }}
                <code>{{ selectedPack.placeholder }}</code>
              </div>
              <div class="ep-main-actions">
                <button class="ep-btn" :disabled="uploading" @click="fileInputRef?.click()">
                  <span class="material-symbols-outlined">upload</span>
                  {{ uploading ? '上传中...' : '上传图片' }}
                </button>
                <button class="ep-btn danger" @click="deletePack(selectedPack.name)">
                  <span class="material-symbols-outlined">delete</span>删除目录
                </button>
              </div>
            </div>

            <div class="ep-drop" :class="{ dragover }" @click="fileInputRef?.click()" @drop="onDrop" @dragover="onDragOver" @dragleave="onDragLeave">
              <span class="material-symbols-outlined">cloud_upload</span>
              点击选择 或 拖拽图片到此（PNG/JPG/GIF/WebP，单张 ≤ 5MB）
              <input ref="fileInputRef" type="file" multiple accept="image/*" @change="onFileInput" />
            </div>

            <!-- 搜索 + 分页控件 -->
            <div v-if="images.length" class="ep-page-controls">
              <input
                type="text"
                class="ep-search"
                v-model="searchKeyword"
                placeholder="搜索文件名..."
                @input="gotoPage(1)"
              />
              <span class="ep-meta">
                共 <strong>{{ filteredImages.length }}</strong> 张
                <span v-if="searchKeyword"> (过滤自 {{ images.length }} 张)</span>
              </span>
              <div class="ep-size-group">
                <label>每页:</label>
                <button v-for="sz in [24, 48, 96, 0]" :key="sz"
                        class="ep-size-btn" :class="{ active: pageSize === sz }"
                        @click="changePageSize(sz)">
                  {{ sz === 0 ? '全部' : sz }}
                </button>
              </div>
              <div v-if="pageSize > 0 && totalPages > 1" class="ep-pager">
                <button class="ep-page-btn" :disabled="currentPage === 1" @click="gotoPage(1)" title="首页">
                  <span class="material-symbols-outlined">first_page</span>
                </button>
                <button class="ep-page-btn" :disabled="currentPage === 1" @click="gotoPage(currentPage - 1)">
                  <span class="material-symbols-outlined">chevron_left</span>
                </button>
                <span class="ep-page-info"><strong>{{ currentPage }}</strong> / {{ totalPages }}</span>
                <button class="ep-page-btn" :disabled="currentPage === totalPages" @click="gotoPage(currentPage + 1)">
                  <span class="material-symbols-outlined">chevron_right</span>
                </button>
                <button class="ep-page-btn" :disabled="currentPage === totalPages" @click="gotoPage(totalPages)" title="末页">
                  <span class="material-symbols-outlined">last_page</span>
                </button>
              </div>
            </div>

            <div v-if="imagesLoading" class="ep-empty">
              <span class="material-symbols-outlined">hourglass_empty</span>加载中...
            </div>
            <div v-else-if="!images.length" class="ep-empty">
              <span class="material-symbols-outlined">photo_library</span>
              <span>该目录还没有图片</span>
              <span style="font-size: 0.75rem;">上传后记得点「重新生成清单」让 AI 感知 ✨</span>
            </div>
            <div v-else-if="!filteredImages.length" class="ep-empty">
              <span class="material-symbols-outlined">search_off</span>
              <span>没有匹配「{{ searchKeyword }}」的图片</span>
            </div>
            <div v-else class="ep-grid">
              <div v-for="img in paginatedImages" :key="img.name" class="ep-tile">
                <img :src="img.url" :alt="img.name" loading="lazy" />
                <div class="ep-tile-name">{{ img.name }}</div>
                <button class="ep-tile-del" @click.stop="deleteImage(img.name)" :title="'删除 ' + img.name">
                  <span class="material-symbols-outlined">close</span>
                </button>
              </div>
            </div>
          </template>
        </div>

        <div v-if="newPackDialog" class="ep-modal-backdrop" @click.self="newPackDialog = false">
          <div class="ep-modal">
            <h4>新建表情包目录</h4>
            <input
              v-model="newPackName"
              placeholder="输入名称（自动补「表情包」后缀）"
              @keyup.enter="createPack"
              autofocus
            />
            <p style="margin: 8px 0 0; font-size: 0.78rem; color: var(--secondary-text);">
              将创建 <code style="background: rgba(245,158,11,0.15); padding: 1px 6px; border-radius: 4px; color: #b45309;">image/{{ newPackName.trim() ? (newPackName.trim().endsWith('表情包') ? newPackName.trim() : newPackName.trim() + '表情包') : 'XXX表情包' }}/</code>
            </p>
            <div class="ep-modal-actions">
              <button class="ep-btn" @click="newPackDialog = false">取消</button>
              <button class="ep-btn primary" @click="createPack" :disabled="!newPackName.trim()">
                <span class="material-symbols-outlined">add</span>创建
              </button>
            </div>
          </div>
        </div>
      </div>
    `,
  };

  P.register('EmojiListGenerator', EmojiPackManager);
  console.log('[EmojiListGenerator] ✨ 管理面板已挂载');
})();
