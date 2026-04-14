// AdminPanel/js/notes-manager.js
import { apiFetch, showMessage, escapeHTML } from './utils.js';

const API_BASE_URL = '/admin_api';

let currentNotesFolder = null;
let currentNotesMode = 'diary'; // 'diary' | 'knowledge' | 'public'
let selectedNotes = new Set();
let easyMDE = null;
let ragTagsData = {};
let currentRagFolder = null;

const NOTES_MODE_CONFIG = {
    diary: { title: '日记管理', desc: 'Agent 日记与 RAG 标签', icon: 'auto_stories' },
    knowledge: { title: '知识库管理', desc: 'Agent 知识库与 RAG 标签', icon: 'school' },
    public: { title: '公共知识库', desc: '公共知识与 RAG 标签', icon: 'menu_book' },
};

/**
 * 初始化日记管理器。
 */
export async function initializeDailyNotesManager(mode = 'diary') {
    console.log(`Initializing Daily Notes Manager (mode: ${mode})...`);
    currentNotesMode = mode;
    currentNotesFolder = null;

    // Update page header based on mode
    const cfg = NOTES_MODE_CONFIG[mode] || NOTES_MODE_CONFIG.diary;
    const section = document.getElementById('daily-notes-manager-section');
    if (section) {
        const h2 = section.querySelector('.page-header h2');
        const desc = section.querySelector('.page-header .page-desc');
        const icon = section.querySelector('.page-header .page-icon');
        if (h2) h2.textContent = cfg.title;
        if (desc) desc.textContent = cfg.desc;
        if (icon) icon.textContent = cfg.icon;
    }

    const notesListViewDiv = document.getElementById('notes-list-view');
    const noteEditorAreaDiv = document.getElementById('note-editor-area');
    const ragTagsConfigAreaDiv = document.getElementById('rag-tags-config-area');
    const notesActionStatusSpan = document.getElementById('notes-action-status');
    const moveSelectedNotesButton = document.getElementById('move-selected-notes');
    const deleteSelectedNotesButton = document.getElementById('delete-selected-notes-button');
    const searchDailyNotesInput = document.getElementById('search-daily-notes');

    if (notesListViewDiv) notesListViewDiv.innerHTML = '';
    if (noteEditorAreaDiv) noteEditorAreaDiv.style.display = 'none';
    if (ragTagsConfigAreaDiv) ragTagsConfigAreaDiv.style.display = 'none';
    if (notesActionStatusSpan) notesActionStatusSpan.textContent = '';
    if (moveSelectedNotesButton) moveSelectedNotesButton.disabled = true;
    if (deleteSelectedNotesButton) deleteSelectedNotesButton.disabled = true;
    if (searchDailyNotesInput) searchDailyNotesInput.value = '';

    setupEventListeners();
    await loadRagTagsConfig();
    await loadNotesFolders();
}

/**
 * 设置日记管理器部分的事件监听器。
 */
function setupEventListeners() {
    const saveNoteButton = document.getElementById('save-note-content');
    const cancelEditNoteButton = document.getElementById('cancel-edit-note');
    const moveSelectedNotesButton = document.getElementById('move-selected-notes');
    const deleteSelectedNotesButton = document.getElementById('delete-selected-notes-button');
    const searchDailyNotesInput = document.getElementById('search-daily-notes');
    const ragThresholdEnabledCheckbox = document.getElementById('rag-threshold-enabled');
    const ragThresholdValueSlider = document.getElementById('rag-threshold-value');
    const addRagTagButton = document.getElementById('add-rag-tag-button');
    const saveRagTagsConfigButton = document.getElementById('save-rag-tags-config');

    if (saveNoteButton && !saveNoteButton.dataset.listenerAttached) {
        saveNoteButton.addEventListener('click', saveNoteChanges);
        saveNoteButton.dataset.listenerAttached = 'true';
    }
    if (cancelEditNoteButton && !cancelEditNoteButton.dataset.listenerAttached) {
        cancelEditNoteButton.addEventListener('click', closeNoteEditor);
        cancelEditNoteButton.dataset.listenerAttached = 'true';
    }
    if (moveSelectedNotesButton && !moveSelectedNotesButton.dataset.listenerAttached) {
        moveSelectedNotesButton.addEventListener('click', moveSelectedNotesHandler);
        moveSelectedNotesButton.dataset.listenerAttached = 'true';
    }
    if (deleteSelectedNotesButton && !deleteSelectedNotesButton.dataset.listenerAttached) {
        deleteSelectedNotesButton.addEventListener('click', deleteSelectedNotesHandler);
        deleteSelectedNotesButton.dataset.listenerAttached = 'true';
    }
    if (searchDailyNotesInput && !searchDailyNotesInput.dataset.listenerAttached) {
        searchDailyNotesInput.addEventListener('input', filterNotesBySearch);
        searchDailyNotesInput.dataset.listenerAttached = 'true';
    }
    if (ragThresholdEnabledCheckbox && !ragThresholdEnabledCheckbox.dataset.listenerAttached) {
        ragThresholdEnabledCheckbox.addEventListener('change', () => {
            if(ragThresholdValueSlider) ragThresholdValueSlider.disabled = !ragThresholdEnabledCheckbox.checked;
        });
        ragThresholdEnabledCheckbox.dataset.listenerAttached = 'true';
    }
    if (ragThresholdValueSlider && !ragThresholdValueSlider.dataset.listenerAttached) {
        ragThresholdValueSlider.addEventListener('input', () => {
            const ragThresholdDisplaySpan = document.getElementById('rag-threshold-display');
            if(ragThresholdDisplaySpan) ragThresholdDisplaySpan.textContent = parseFloat(ragThresholdValueSlider.value).toFixed(2);
        });
        ragThresholdValueSlider.dataset.listenerAttached = 'true';
    }
    if (addRagTagButton && !addRagTagButton.dataset.listenerAttached) {
        addRagTagButton.addEventListener('click', () => addTagItem());
        addRagTagButton.dataset.listenerAttached = 'true';
    }
    if (saveRagTagsConfigButton && !saveRagTagsConfigButton.dataset.listenerAttached) {
        saveRagTagsConfigButton.addEventListener('click', saveRagTagsConfigHandler);
        saveRagTagsConfigButton.dataset.listenerAttached = 'true';
    }
}


async function loadNotesFolders() {
    const notesFolderListUl = document.getElementById('notes-folder-list');
    const moveTargetFolderSelect = document.getElementById('move-target-folder');
    const notesListViewDiv = document.getElementById('notes-list-view');
    if (!notesFolderListUl || !moveTargetFolderSelect || !notesListViewDiv) return;

    try {
        const data = await apiFetch(`${API_BASE_URL}/dailynotes/folders`);
        notesFolderListUl.innerHTML = '';
        moveTargetFolderSelect.innerHTML = '<option value="">选择目标文件夹...</option>';

        // Populate move-target select with flat list
        if (data.folders) {
            data.folders.forEach(folder => {
                const option = document.createElement('option');
                option.value = folder;
                option.textContent = folder;
                moveTargetFolderSelect.appendChild(option);
            });
        }

        // Helper: create a clickable folder item
        function createFolderItem(folderName, label) {
            const li = document.createElement('li');
            li.dataset.folderName = folderName;
            li.innerHTML = `<span class="folder-label">${escapeHTML(label)}</span>`;
            li.addEventListener('click', () => {
                loadNotesForFolder(folderName);
                notesFolderListUl.querySelectorAll('li:not(.folder-group)').forEach(item => item.classList.remove('active'));
                notesFolderListUl.querySelectorAll('.folder-group-list li').forEach(item => item.classList.remove('active'));
                li.classList.add('active');
            });
            return li;
        }

        // Helper: create a collapsible Agent group
        function createAgentGroup(agentName) {
            const group = document.createElement('li');
            group.className = 'folder-group';
            const header = document.createElement('div');
            header.className = 'folder-group-header';
            header.innerHTML = `<span class="material-symbols-outlined folder-group-icon">smart_toy</span>` +
                `<span class="folder-group-title">${escapeHTML(agentName)}</span>` +
                `<span class="material-symbols-outlined folder-group-arrow">expand_more</span>`;
            const list = document.createElement('ul');
            list.className = 'folder-group-list';
            header.addEventListener('click', () => group.classList.toggle('collapsed'));
            group.appendChild(header);
            group.appendChild(list);
            return { group, list };
        }

        let hasItems = false;

        // === Mode: diary — Agent diary grouped by agent ===
        if (currentNotesMode === 'diary' && data.agents) {
            for (const agent of data.agents) {
                const diaries = agent.notebooks.filter(n => n.type === 'diary');
                if (diaries.length === 0) continue;
                const { group, list } = createAgentGroup(agent.name);
                for (const nb of diaries) {
                    list.appendChild(createFolderItem(nb.folderName, nb.displayName.split('/').pop()));
                }
                notesFolderListUl.appendChild(group);
                hasItems = true;
            }
        }

        // === Mode: knowledge — Agent knowledge grouped by agent + thinking clusters ===
        if (currentNotesMode === 'knowledge') {
            // Agent knowledge folders
            if (data.agents) {
                for (const agent of data.agents) {
                    const knowledge = agent.notebooks.filter(n => n.type === 'knowledge');
                    if (knowledge.length === 0) continue;
                    const { group, list } = createAgentGroup(agent.name);
                    for (const nb of knowledge) {
                        list.appendChild(createFolderItem(nb.folderName, nb.displayName.split('/').pop()));
                    }
                    notesFolderListUl.appendChild(group);
                    hasItems = true;
                }
            }
            // Thinking clusters as a separate group
            if (data.thinking && data.thinking.length > 0) {
                const tGroup = document.createElement('li');
                tGroup.className = 'folder-group';
                const tHeader = document.createElement('div');
                tHeader.className = 'folder-group-header';
                tHeader.innerHTML = `<span class="material-symbols-outlined folder-group-icon">psychology</span>` +
                    `<span class="folder-group-title">思维簇</span>` +
                    `<span class="material-symbols-outlined folder-group-arrow">expand_more</span>`;
                const tList = document.createElement('ul');
                tList.className = 'folder-group-list';
                tHeader.addEventListener('click', () => tGroup.classList.toggle('collapsed'));
                tGroup.appendChild(tHeader);
                tGroup.appendChild(tList);
                for (const t of data.thinking) {
                    tList.appendChild(createFolderItem(t.folderName, t.displayName.split('/').pop()));
                }
                notesFolderListUl.appendChild(tGroup);
                hasItems = true;
            }
        }

        // === Mode: public — shared knowledge/ folders (flat list, no grouping) ===
        if (currentNotesMode === 'public' && data.public) {
            for (const folder of data.public) {
                notesFolderListUl.appendChild(createFolderItem(folder, folder));
                hasItems = true;
            }
        }

        if (!hasItems) {
            const emptyLabels = { diary: '暂无 Agent 日记目录', knowledge: '暂无 Agent 知识库目录', public: '暂无公共知识库' };
            notesFolderListUl.innerHTML = `<li class="folder-empty">${emptyLabels[currentNotesMode] || '暂无内容'}</li>`;
            notesListViewDiv.innerHTML = '';
            return;
        }

        // Auto-click first available item
        const firstItem = notesFolderListUl.querySelector('.folder-group-list li') ||
                          notesFolderListUl.querySelector('li[data-folder-name]');
        if (firstItem) firstItem.click();
    } catch (error) {
        notesFolderListUl.innerHTML = '<li>加载文件夹列表失败。</li>';
        showMessage('加载文件夹列表失败: ' + error.message, 'error');
    }
}

async function loadNotesForFolder(folderName) {
    const notesListViewDiv = document.getElementById('notes-list-view');
    const noteEditorAreaDiv = document.getElementById('note-editor-area');
    const searchDailyNotesInput = document.getElementById('search-daily-notes');
    if (!notesListViewDiv || !noteEditorAreaDiv) return;

    currentNotesFolder = folderName;
    selectedNotes.clear();
    updateActionButtonStatus();
    notesListViewDiv.innerHTML = '<p>正在加载日记...</p>';
    noteEditorAreaDiv.style.display = 'none';
    if(searchDailyNotesInput) searchDailyNotesInput.value = '';

    try {
        // folderName 可能含 "/"（如 "Aemeath/diary"），必须 encode 才能命中 :folderName 单段路由
        // suppressErrorToast: 404 在这里是"暂无日记"语义，由下方 catch 自行展示，避免弹失败 toast
        const data = await apiFetch(`${API_BASE_URL}/dailynotes/folder/${encodeURIComponent(folderName)}`, { suppressErrorToast: true });
        notesListViewDiv.innerHTML = '';
        if (data.notes && data.notes.length > 0) {
            data.notes.forEach(note => {
                const card = renderNoteCard(note, folderName);
                notesListViewDiv.appendChild(card);
            });
        } else {
            notesListViewDiv.innerHTML = `<p>文件夹 "${folderName}" 中暂无日记。</p>`;
        }
        displayRagTagsForFolder(folderName);
    } catch (error) {
        // 404 视为"暂无日记"语义（目录不存在 / 空），不弹错提示；其他错误仍展示失败
        if (error && error.status === 404) {
            notesListViewDiv.innerHTML = `<p>文件夹 "${folderName}" 中暂无日记。</p>`;
        } else {
            notesListViewDiv.innerHTML = `<p>加载文件夹 "${folderName}" 中的日记失败。</p>`;
            showMessage(`加载日记失败: ${error.message}`, 'error');
        }
    }
}

async function filterNotesBySearch() {
    const searchDailyNotesInput = document.getElementById('search-daily-notes');
    const notesListViewDiv = document.getElementById('notes-list-view');
    if (!searchDailyNotesInput || !notesListViewDiv) return;

    const searchTerm = searchDailyNotesInput.value.trim();

    if (searchTerm === '') {
        if (currentNotesFolder) {
            loadNotesForFolder(currentNotesFolder);
        } else {
            notesListViewDiv.innerHTML = '<p>请输入搜索词或选择一个文件夹。</p>';
        }
        return;
    }

    notesListViewDiv.innerHTML = '<p>正在搜索日记...</p>';
    try {
        const searchUrl = currentNotesFolder
            ? `${API_BASE_URL}/dailynotes/search?term=${encodeURIComponent(searchTerm)}&folder=${encodeURIComponent(currentNotesFolder)}`
            : `${API_BASE_URL}/dailynotes/search?term=${encodeURIComponent(searchTerm)}`;

        const data = await apiFetch(searchUrl);
        notesListViewDiv.innerHTML = '';

        if (data.notes && data.notes.length > 0) {
            data.notes.forEach(note => {
                const card = renderNoteCard(note, note.folderName);
                notesListViewDiv.appendChild(card);
            });
        } else {
            notesListViewDiv.innerHTML = `<p>没有找到与 "${searchTerm}" 相关的日记。</p>`;
        }
    } catch (error) {
        notesListViewDiv.innerHTML = `<p>搜索日记失败: ${error.message}</p>`;
        showMessage(`搜索失败: ${error.message}`, 'error');
    }
}

function renderNoteCard(note, folderName) {
    const card = document.createElement('div');
    card.className = 'note-card';
    card.dataset.fileName = note.name;
    card.dataset.folderName = folderName;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'note-select-checkbox';
    checkbox.addEventListener('change', (e) => {
        const noteId = `${folderName}/${note.name}`;
        if (e.target.checked) {
            selectedNotes.add(noteId);
            card.classList.add('selected');
        } else {
            selectedNotes.delete(noteId);
            card.classList.remove('selected');
        }
        updateActionButtonStatus();
    });

    card.innerHTML = `
        <p class="note-card-filename">${escapeHTML(note.name)}</p>
        <p class="note-card-preview">${escapeHTML(note.preview) || `修改于: ${new Date(note.lastModified).toLocaleString()}`}</p>
        <div class="note-card-actions">
            <button class="edit-note-btn">编辑</button>
            <button class="discovery-note-btn">联想</button>
        </div>
    `;
    card.insertBefore(checkbox, card.firstChild);

    const editBtn = card.querySelector('.edit-note-btn');
    if (editBtn) {
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openNoteForEditing(folderName, note.name);
        });
    }

    const discoveryBtn = card.querySelector('.discovery-note-btn');
    if (discoveryBtn) {
        discoveryBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openDiscoveryModal(folderName, note.name);
        });
    }

    card.addEventListener('click', (e) => {
        if (e.target !== checkbox && !e.target.closest('.note-card-actions')) {
             openNoteForEditing(folderName, note.name);
        }
    });
    return card;
}

function updateActionButtonStatus() {
    const moveSelectedNotesButton = document.getElementById('move-selected-notes');
    const moveTargetFolderSelect = document.getElementById('move-target-folder');
    const deleteSelectedNotesButton = document.getElementById('delete-selected-notes-button');
    const hasSelection = selectedNotes.size > 0;
    if (moveSelectedNotesButton) moveSelectedNotesButton.disabled = !hasSelection;
    if (moveTargetFolderSelect) moveTargetFolderSelect.disabled = !hasSelection;
    if (deleteSelectedNotesButton) deleteSelectedNotesButton.disabled = !hasSelection;
}

async function openNoteForEditing(folderName, fileName) {
    const notesActionStatusSpan = document.getElementById('notes-action-status');
    const editingNoteFolderInput = document.getElementById('editing-note-folder');
    const editingNoteFileInput = document.getElementById('editing-note-file');
    const noteContentEditorTextarea = document.getElementById('note-content-editor');
    const noteEditorAreaDiv = document.getElementById('note-editor-area');
    const noteEditorStatusSpan = document.getElementById('note-editor-status');

    if (notesActionStatusSpan) notesActionStatusSpan.textContent = '';
    try {
        const data = await apiFetch(`${API_BASE_URL}/dailynotes/note/${encodeURIComponent(folderName)}/${encodeURIComponent(fileName)}`);
        if (editingNoteFolderInput) editingNoteFolderInput.value = folderName;
        if (editingNoteFileInput) editingNoteFileInput.value = fileName;
        
        if (easyMDE) {
            easyMDE.toTextArea();
            easyMDE = null;
        }
        
        if (noteContentEditorTextarea) {
            noteContentEditorTextarea.value = data.content;
            easyMDE = new EasyMDE({
                element: noteContentEditorTextarea,
                spellChecker: false,
                status: ['lines', 'words', 'cursor'],
                minHeight: "500px",
                maxHeight: "800px"
            });
        }

        document.getElementById('notes-list-view').style.display = 'none';
        document.querySelector('.notes-sidebar').style.display = 'none';
        document.querySelector('.notes-toolbar').style.display = 'none';
        document.querySelector('.notes-content-area').style.display = 'none';
        if (noteEditorAreaDiv) noteEditorAreaDiv.style.display = 'block';
        if (noteEditorStatusSpan) noteEditorStatusSpan.textContent = `正在编辑: ${folderName}/${fileName}`;
    } catch (error) {
        showMessage(`打开日记 ${fileName} 失败: ${error.message}`, 'error');
    }
}

async function saveNoteChanges() {
    const editingNoteFolderInput = document.getElementById('editing-note-folder');
    const editingNoteFileInput = document.getElementById('editing-note-file');
    const noteEditorStatusSpan = document.getElementById('note-editor-status');

    const folderName = editingNoteFolderInput.value;
    const fileName = editingNoteFileInput.value;
    const content = easyMDE.value();

    if (!folderName || !fileName) {
        showMessage('无法保存日记，缺少文件信息。', 'error');
        return;
    }
    if (noteEditorStatusSpan) noteEditorStatusSpan.textContent = '正在保存...';
    try {
        await apiFetch(`${API_BASE_URL}/dailynotes/note/${encodeURIComponent(folderName)}/${encodeURIComponent(fileName)}`, {
            method: 'POST',
            body: JSON.stringify({ content })
        });
        showMessage(`日记 ${fileName} 已成功保存!`, 'success');
        closeNoteEditor();
        if (currentNotesFolder === folderName) {
            loadNotesForFolder(folderName);
        }
    } catch (error) {
        if (noteEditorStatusSpan) noteEditorStatusSpan.textContent = `保存失败: ${error.message}`;
    }
}

function closeNoteEditor() {
    const noteEditorAreaDiv = document.getElementById('note-editor-area');
    if (easyMDE) {
        easyMDE.toTextArea();
        easyMDE = null;
    }
    if (noteEditorAreaDiv) noteEditorAreaDiv.style.display = 'none';
    
    document.getElementById('editing-note-folder').value = '';
    document.getElementById('editing-note-file').value = '';
    document.getElementById('note-content-editor').value = '';
    document.getElementById('note-editor-status').textContent = '';
    
    document.getElementById('notes-list-view').style.display = 'grid';
    document.querySelector('.notes-sidebar').style.display = 'block';
    document.querySelector('.notes-toolbar').style.display = 'flex';
    document.querySelector('.notes-content-area').style.display = 'flex';
}

async function moveSelectedNotesHandler() {
    const moveTargetFolderSelect = document.getElementById('move-target-folder');
    const notesActionStatusSpan = document.getElementById('notes-action-status');
    const targetFolder = moveTargetFolderSelect.value;
    if (!targetFolder) {
        showMessage('请选择一个目标文件夹。', 'error');
        return;
    }
    if (selectedNotes.size === 0) {
        showMessage('没有选中的日记。', 'error');
        return;
    }

    const notesToMove = Array.from(selectedNotes).map(noteId => {
        const lastSlash = noteId.lastIndexOf('/');
        const folder = noteId.substring(0, lastSlash);
        const file = noteId.substring(lastSlash + 1);
        return { folder, file };
    });

    if (notesActionStatusSpan) notesActionStatusSpan.textContent = '正在移动...';
    try {
        const response = await apiFetch(`${API_BASE_URL}/dailynotes/move`, {
            method: 'POST',
            body: JSON.stringify({ sourceNotes: notesToMove, targetFolder })
        });
        showMessage(response.message || `${notesToMove.length} 个日记已移动。`, response.errors?.length > 0 ? 'error' : 'success');
        if (response.errors?.length > 0) {
            console.error('移动日记时发生错误:', response.errors);
            if (notesActionStatusSpan) notesActionStatusSpan.textContent = `部分移动失败: ${response.errors.map(e => e.error).join(', ')}`;
        } else {
             if (notesActionStatusSpan) notesActionStatusSpan.textContent = '';
        }
        
        const folderToReload = currentNotesFolder;
        selectedNotes.clear();
        updateActionButtonStatus();
        await loadNotesFolders();
        
        if (folderToReload) {
             const currentFolderLi = document.querySelector(`#notes-folder-list li[data-folder-name="${folderToReload}"]`);
             if (currentFolderLi) {
                currentFolderLi.click();
             } else if (document.querySelector('#notes-folder-list li')) {
                document.querySelector('#notes-folder-list li').click();
             } else {
                document.getElementById('notes-list-view').innerHTML = '<p>请选择一个文件夹。</p>';
             }
        }
    } catch (error) {
        if (notesActionStatusSpan) notesActionStatusSpan.textContent = `移动失败: ${error.message}`;
    }
}

async function deleteSelectedNotesHandler() {
    const notesActionStatusSpan = document.getElementById('notes-action-status');
    if (selectedNotes.size === 0) {
        showMessage('没有选中的日记。', 'error');
        return;
    }

    if (!confirm(`您确定要删除选中的 ${selectedNotes.size} 个日记吗？此操作无法撤销。`)) {
        return;
    }

    const notesToDelete = Array.from(selectedNotes).map(noteId => {
        const lastSlash = noteId.lastIndexOf('/');
        const folder = noteId.substring(0, lastSlash);
        const file = noteId.substring(lastSlash + 1);
        return { folder, file };
    });

    if (notesActionStatusSpan) notesActionStatusSpan.textContent = '正在删除...';
    try {
        const response = await apiFetch(`${API_BASE_URL}/dailynotes/delete-batch`, {
            method: 'POST',
            body: JSON.stringify({ notesToDelete })
        });
        showMessage(response.message || `${notesToDelete.length} 个日记已删除。`, response.errors?.length > 0 ? 'warning' : 'success');
        
        if (response.errors?.length > 0) {
            console.error('删除日记时发生错误:', response.errors);
            if (notesActionStatusSpan) notesActionStatusSpan.textContent = `部分删除失败: ${response.errors.map(e => e.error).join(', ')}`;
        } else {
            if (notesActionStatusSpan) notesActionStatusSpan.textContent = '';
        }

        const folderToReload = currentNotesFolder;
        selectedNotes.clear();
        updateActionButtonStatus();
        await loadNotesFolders();

        if (folderToReload) {
            const currentFolderLi = document.querySelector(`#notes-folder-list li[data-folder-name="${folderToReload}"]`);
            if (currentFolderLi) {
                currentFolderLi.click();
            } else if (document.querySelector('#notes-folder-list li')) {
                document.querySelector('#notes-folder-list li').click();
            } else {
                document.getElementById('notes-list-view').innerHTML = '<p>请选择一个文件夹。</p>';
            }
        } else if (document.querySelector('#notes-folder-list li')) {
             document.querySelector('#notes-folder-list li').click();
        } else {
            document.getElementById('notes-list-view').innerHTML = '<p>没有日记可以显示。</p>';
        }
    } catch (error) {
        if (notesActionStatusSpan) notesActionStatusSpan.textContent = `删除失败: ${error.message}`;
    }
}

// --- RAG Tags Config Functions ---
async function loadRagTagsConfig() {
    try {
        ragTagsData = await apiFetch(`${API_BASE_URL}/rag-tags`, {}, false);
    } catch (error) {
        console.error('[RAGTags] Failed to load RAG-Tags config:', error);
        ragTagsData = {};
    }
}

function displayRagTagsForFolder(folderName) {
    const ragTagsConfigAreaDiv = document.getElementById('rag-tags-config-area');
    const ragTagsFolderNameSpan = document.getElementById('rag-tags-folder-name');
    const ragThresholdEnabledCheckbox = document.getElementById('rag-threshold-enabled');
    const ragThresholdValueSlider = document.getElementById('rag-threshold-value');
    const ragThresholdDisplaySpan = document.getElementById('rag-threshold-display');
    const ragTagsContainer = document.getElementById('rag-tags-container');
    const ragTagsStatusSpan = document.getElementById('rag-tags-status');

    currentRagFolder = folderName;
    if (ragTagsFolderNameSpan) ragTagsFolderNameSpan.textContent = folderName;
    
    const folderConfig = ragTagsData[folderName] || {};
    const tags = folderConfig.tags || [];
    const threshold = folderConfig.threshold;
    
    if (ragThresholdEnabledCheckbox) {
        if (threshold !== undefined) {
            ragThresholdEnabledCheckbox.checked = true;
            if (ragThresholdValueSlider) ragThresholdValueSlider.value = threshold;
            if (ragThresholdValueSlider) ragThresholdValueSlider.disabled = false;
            if (ragThresholdDisplaySpan) ragThresholdDisplaySpan.textContent = threshold.toFixed(2);
        } else {
            ragThresholdEnabledCheckbox.checked = false;
            if (ragThresholdValueSlider) ragThresholdValueSlider.value = 0.7;
            if (ragThresholdValueSlider) ragThresholdValueSlider.disabled = true;
            if (ragThresholdDisplaySpan) ragThresholdDisplaySpan.textContent = '0.70';
        }
    }
    
    if (ragTagsContainer) {
        ragTagsContainer.innerHTML = '';
        tags.forEach((tagData) => {
            const tagValue = typeof tagData === 'string' ? tagData : (tagData.tag || '');
            addTagItem(tagValue);
        });
    }
    
    if (ragTagsConfigAreaDiv) ragTagsConfigAreaDiv.style.display = 'block';
    if (ragTagsStatusSpan) ragTagsStatusSpan.textContent = '';
}

function addTagItem(value = '') {
    const ragTagsContainer = document.getElementById('rag-tags-container');
    if (!ragTagsContainer) return;

    const tagDiv = document.createElement('div');
    tagDiv.className = 'tag-item';
    
    const tagInput = document.createElement('input');
    tagInput.type = 'text';
    tagInput.className = 'tag-input';
    tagInput.value = value;
    tagInput.placeholder = '标签:权重(可选)';
    tagDiv.appendChild(tagInput);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-tag-btn';
    deleteBtn.textContent = '×';
    deleteBtn.onclick = () => tagDiv.remove();
    tagDiv.appendChild(deleteBtn);

    ragTagsContainer.appendChild(tagDiv);
    if (!value) {
        tagInput.focus();
    }
}

async function saveRagTagsConfigHandler() {
    const ragTagsStatusSpan = document.getElementById('rag-tags-status');
    const ragTagsContainer = document.getElementById('rag-tags-container');
    const ragThresholdEnabledCheckbox = document.getElementById('rag-threshold-enabled');
    const ragThresholdValueSlider = document.getElementById('rag-threshold-value');

    if (!currentRagFolder) {
        showMessage('未选中知识库文件夹', 'error');
        return;
    }

    if (ragTagsStatusSpan) {
        ragTagsStatusSpan.textContent = '保存中...';
        ragTagsStatusSpan.className = 'status-message info';
    }

    try {
        const folderConfig = {};
        
        const tagInputs = ragTagsContainer.querySelectorAll('.tag-input');
        const tags = Array.from(tagInputs).map(input => input.value.trim()).filter(Boolean);
        folderConfig.tags = tags;
        
        if (ragThresholdEnabledCheckbox.checked) {
            folderConfig.threshold = parseFloat(ragThresholdValueSlider.value);
        }
        
        if (folderConfig.tags.length > 0 || folderConfig.threshold !== undefined) {
            ragTagsData[currentRagFolder] = folderConfig;
        } else {
            delete ragTagsData[currentRagFolder];
        }
        
        await apiFetch(`${API_BASE_URL}/rag-tags`, {
            method: 'POST',
            body: JSON.stringify(ragTagsData)
        });

        if (ragTagsStatusSpan) {
            ragTagsStatusSpan.textContent = '✓ 保存成功';
            ragTagsStatusSpan.className = 'status-message success';
        }
        showMessage('RAG-Tags配置已保存', 'success');
        
        setTimeout(() => {
            if (ragTagsStatusSpan) ragTagsStatusSpan.textContent = '';
        }, 3000);

    } catch (error) {
        console.error('[RAGTags] Save failed:', error);
        if (ragTagsStatusSpan) {
            ragTagsStatusSpan.textContent = '✗ 保存失败';
            ragTagsStatusSpan.className = 'status-message error';
        }
        showMessage(`保存RAG-Tags配置失败: ${error.message}`, 'error');
    }
}

// --- Associative Discovery Functions ---

let discoverySourceFile = null;

async function openDiscoveryModal(folderName, fileName) {
    const modal = document.getElementById('associative-discovery-modal');
    const title = document.getElementById('discovery-modal-title');
    const chipsContainer = document.getElementById('discovery-range-chips');
    const kSlider = document.getElementById('discovery-k-slider');
    const kDisplay = document.getElementById('discovery-k-display');
    const startBtn = document.getElementById('start-discovery-btn');
    const resultsList = document.getElementById('discovery-results-list');
    const loader = document.getElementById('discovery-loader');
    const warning = document.getElementById('discovery-warning');
    const closeBtn = document.getElementById('close-discovery-modal');
    const backdrop = document.getElementById('discovery-modal-backdrop');

    if (!modal) return;

    discoverySourceFile = `${folderName}/${fileName}`;
    title.textContent = `联想追溯: ${fileName}`;
    resultsList.innerHTML = '';
    loader.style.display = 'none';
    warning.style.display = 'none';
    
    // 初始化 K 值
    if (kSlider) {
        kSlider.value = 50;
        kDisplay.textContent = '50';
        kSlider.oninput = () => kDisplay.textContent = kSlider.value;
    }

    // 加载文件夹并生成芯片
    if (chipsContainer) {
        chipsContainer.innerHTML = '';
        try {
            const data = await apiFetch('/admin_api/dailynotes/folders');
            if (data.folders) {
                data.folders.forEach(f => {
                    const chip = document.createElement('div');
                    chip.className = 'folder-chip';
                    chip.textContent = f;
                    chip.onclick = () => chip.classList.toggle('active');
                    chipsContainer.appendChild(chip);
                });
            }
        } catch (e) {
            console.error('Failed to load folders for discovery:', e);
        }
    }

    // 绑定按钮事件
    if (startBtn) startBtn.onclick = performDiscovery;
    if (closeBtn) closeBtn.onclick = () => modal.classList.remove('show');
    if (backdrop) backdrop.onclick = () => modal.classList.remove('show');

    modal.classList.add('show');
}

async function performDiscovery() {
    const loader = document.getElementById('discovery-loader');
    const resultsList = document.getElementById('discovery-results-list');
    const warning = document.getElementById('discovery-warning');
    const kSetting = document.getElementById('discovery-k-slider');
    
    if (!loader || !resultsList) return;

    const k = kSetting ? kSetting.value : 50;
    const range = Array.from(document.querySelectorAll('.folder-chip.active')).map(c => c.textContent);

    resultsList.innerHTML = '';
    loader.style.display = 'flex';
    warning.style.display = 'none';

    try {
        const data = await apiFetch(`/admin_api/dailynotes/associative-discovery`, {
            method: 'POST',
            body: JSON.stringify({
                sourceFilePath: discoverySourceFile,
                k: parseInt(k),
                range: range
            })
        });

        loader.style.display = 'none';
        
        if (data.warning) {
            warning.textContent = data.warning;
            warning.style.display = 'block';
        }

        if (data.results && data.results.length > 0) {
            renderDiscoveryResults(data.results);
        } else {
            resultsList.innerHTML = '<p style="text-align:center;color:var(--secondary-text);margin-top:20px;">未发现相关的记忆节点。</p>';
        }
    } catch (e) {
        loader.style.display = 'none';
        console.error('Discovery failed:', e);
        showMessage(`联想失败: ${e.message}`, 'error');
    }
}

function renderDiscoveryResults(results) {
    const list = document.getElementById('discovery-results-list');
    if (!list) return;
    list.innerHTML = '';

    results.forEach(res => {
        const card = document.createElement('div');
        card.className = 'discovery-result-card';
        
        const scorePercent = Math.min(Math.round(res.score * 100), 100);
        
        card.innerHTML = `
            <div class="result-header">
                <span class="result-filename">${escapeHTML(res.name)}</span>
                <span class="result-score-tag">Match: ${scorePercent}%</span>
            </div>
            <div class="result-score-bar-container">
                <div class="result-score-bar" style="width: 0%"></div>
            </div>
            <div class="result-tags">
                ${res.matchedTags ? res.matchedTags.slice(0, 5).map(t => `<span class="result-tag">#${escapeHTML(t)}</span>`).join('') : ''}
            </div>
            <div class="result-preview">${Array.isArray(res.chunks) ? res.chunks.map(chunk => escapeHTML(chunk)).join(' ... ') : ''}</div>
        `;

        card.onclick = () => {
            const parts = res.path.split(/[/\\]/);
            const folder = parts[0];
            const file = parts[parts.length - 1];
            document.getElementById('associative-discovery-modal').classList.remove('show');
            openNoteForEditing(folder, file);
        };

        list.appendChild(card);
        
        setTimeout(() => {
            const bar = card.querySelector('.result-score-bar');
            if (bar) bar.style.width = `${scorePercent}%`;
        }, 50);
    });
}