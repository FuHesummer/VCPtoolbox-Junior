// AdminPanel/js/schedule-manager.js
import { apiFetch, showMessage } from './utils.js';

let currentYear, currentMonth;
let schedules = [];
let selectedDate = null;
let filterMode = 'all'; // 'all' or 'upcoming'

/**
 * 初始化日程管理模块
 */
export async function initializeScheduleManager() {
    const now = new Date();
    currentYear = now.getFullYear();
    currentMonth = now.getMonth();
    
    setupEventListeners();
    await refreshSchedules();
    renderCalendar();
    renderScheduleList();
}

/**
 * 设置事件监听器
 */
function setupEventListeners() {
    const prevMonthBtn = document.getElementById('prev-month');
    const nextMonthBtn = document.getElementById('next-month');
    const addScheduleBtn = document.getElementById('add-schedule-btn');
    const filterAllBtn = document.getElementById('filter-all');
    const filterUpcomingBtn = document.getElementById('filter-upcoming');

    if (prevMonthBtn && !prevMonthBtn.dataset.listener) {
        prevMonthBtn.addEventListener('click', () => {
            currentMonth--;
            if (currentMonth < 0) {
                currentMonth = 11;
                currentYear--;
            }
            renderCalendar();
        });
        prevMonthBtn.dataset.listener = 'true';
    }

    if (nextMonthBtn && !nextMonthBtn.dataset.listener) {
        nextMonthBtn.addEventListener('click', () => {
            currentMonth++;
            if (currentMonth > 11) {
                currentMonth = 0;
                currentYear++;
            }
            renderCalendar();
        });
        nextMonthBtn.dataset.listener = 'true';
    }

    if (addScheduleBtn && !addScheduleBtn.dataset.listener) {
        addScheduleBtn.addEventListener('click', handleAddSchedule);
        addScheduleBtn.dataset.listener = 'true';
    }

    if (filterAllBtn && !filterAllBtn.dataset.listener) {
        filterAllBtn.addEventListener('click', () => {
            filterMode = 'all';
            filterAllBtn.classList.add('active');
            filterUpcomingBtn.classList.remove('active');
            renderScheduleList();
        });
        filterAllBtn.dataset.listener = 'true';
    }

    if (filterUpcomingBtn && !filterUpcomingBtn.dataset.listener) {
        filterUpcomingBtn.addEventListener('click', () => {
            filterMode = 'upcoming';
            filterUpcomingBtn.classList.add('active');
            filterAllBtn.classList.remove('active');
            renderScheduleList();
        });
        filterUpcomingBtn.dataset.listener = 'true';
    }
}

/**
 * 刷新日程数据
 */
async function refreshSchedules() {
    try {
        schedules = await apiFetch('/admin_api/schedules', {}, false);
        // 按时间排序
        schedules.sort((a, b) => new Date(a.time) - new Date(b.time));
    } catch (error) {
        console.error('Failed to fetch schedules:', error);
    }
}

/**
 * 渲染日历
 */
function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    const monthYearDisplay = document.getElementById('current-month-year');
    if (!grid || !monthYearDisplay) return;

    monthYearDisplay.textContent = `${currentYear}年 ${currentMonth + 1}月`;
    grid.innerHTML = '';

    // 星期头
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    days.forEach(day => {
        const el = document.createElement('div');
        el.className = 'calendar-day-head';
        el.textContent = day;
        grid.appendChild(el);
    });

    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const prevMonthDays = new Date(currentYear, currentMonth, 0).getDate();

    // 上个月的残余
    for (let i = firstDay - 1; i >= 0; i--) {
        const day = prevMonthDays - i;
        const el = createDayElement(day, true);
        grid.appendChild(el);
    }

    // 本月的日子
    const today = new Date();
    for (let i = 1; i <= daysInMonth; i++) {
        const isToday = today.getFullYear() === currentYear && today.getMonth() === currentMonth && today.getDate() === i;
        const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const hasEvent = schedules.some(s => s.time.startsWith(dateStr));
        
        const el = createDayElement(i, false, isToday, hasEvent, dateStr);
        grid.appendChild(el);
    }

    // 下个月的开始
    const totalCells = grid.children.length - 7; // 减去表头
    const remaining = 42 - totalCells;
    for (let i = 1; i <= remaining; i++) {
        const el = createDayElement(i, true);
        grid.appendChild(el);
    }
}

function createDayElement(day, isOtherMonth, isToday = false, hasEvent = false, dateStr = null) {
    const el = document.createElement('div');
    el.className = 'calendar-day';
    if (isOtherMonth) el.classList.add('other-month');
    if (isToday) el.classList.add('today');
    if (selectedDate === dateStr) el.classList.add('selected');
    
    el.textContent = day;

    if (hasEvent) {
        const dot = document.createElement('div');
        dot.className = 'dot';
        el.appendChild(dot);
    }

    if (!isOtherMonth && dateStr) {
        el.addEventListener('click', () => {
            selectedDate = (selectedDate === dateStr) ? null : dateStr;
            renderCalendar();
            renderScheduleList();
            
            // 自动填充时间表单
            if (selectedDate) {
                const timeInput = document.getElementById('new-schedule-time');
                if (timeInput) {
                    const now = new Date();
                    const timeStr = `${selectedDate}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
                    timeInput.value = timeStr;
                }
            }
        });
    }

    return el;
}

/**
 * 渲染日程列表
 */
function renderScheduleList() {
    const listContainer = document.getElementById('schedule-list');
    if (!listContainer) return;

    listContainer.innerHTML = '';

    let filtered = schedules;
    const now = new Date();

    if (filterMode === 'upcoming') {
        filtered = filtered.filter(s => new Date(s.time) >= now);
    }

    if (selectedDate) {
        filtered = filtered.filter(s => s.time.startsWith(selectedDate));
    }

    if (filtered.length === 0) {
        listContainer.innerHTML = `<p class="empty-msg">${selectedDate ? selectedDate + ' 没有日程' : '暂无日程'}</p>`;
        return;
    }

    filtered.forEach(item => {
        const itemEl = document.createElement('div');
        itemEl.className = 'schedule-item';
        itemEl.innerHTML = `
            <div class="schedule-info">
                <div class="schedule-time">
                    <span class="material-symbols-outlined" style="font-size: 16px;">schedule</span>
                    ${item.time.replace('T', ' ')}
                </div>
                <div class="schedule-content">${item.content}</div>
            </div>
            <button class="icon-btn delete-schedule-btn" data-id="${item.id}">
                <span class="material-symbols-outlined">delete</span>
            </button>
        `;
        
        itemEl.querySelector('.delete-schedule-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            handleDeleteSchedule(item.id);
        });

        listContainer.appendChild(itemEl);
    });
}

/**
 * 处理添加日程
 */
async function handleAddSchedule() {
    const timeInput = document.getElementById('new-schedule-time');
    const contentInput = document.getElementById('new-schedule-content');
    
    if (!timeInput.value || !contentInput.value.trim()) {
        showMessage('请填写完整的时间和内容', 'error');
        return;
    }

    try {
        const result = await apiFetch('/admin_api/schedules', {
            method: 'POST',
            body: JSON.stringify({
                time: timeInput.value.replace('T', ' '),
                content: contentInput.value.trim()
            })
        });

        if (result.status === 'success') {
            showMessage('日程添加成功', 'success');
            contentInput.value = '';
            await refreshSchedules();
            renderCalendar();
            renderScheduleList();
            // 如果有仪表盘挂件，也通知更新（如果需要）
        }
    } catch (error) {
        console.error('Failed to add schedule:', error);
    }
}

/**
 * 处理删除日程
 */
async function handleDeleteSchedule(id) {
    if (!confirm('确定要删除这条日程吗？')) return;

    try {
        const result = await apiFetch(`/admin_api/schedules/${id}`, {
            method: 'DELETE'
        });

        if (result.status === 'success') {
            showMessage('日程已删除', 'success');
            await refreshSchedules();
            renderCalendar();
            renderScheduleList();
        }
    } catch (error) {
        console.error('Failed to delete schedule:', error);
    }
}

/**
 * 仪表盘日历挂件初始化
 */
export async function initializeCalendarWidget() {
    const widgetContainer = document.getElementById('dashboard-calendar-widget');
    if (!widgetContainer) return;

    await refreshSchedules();
    
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const today = now.getDate();

    let html = `
        <div class="widget-calendar-grid">
    `;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // 空白填充
    for (let i = 0; i < firstDay; i++) {
        html += `<div class="widget-day"></div>`;
    }

    // 日子
    for (let i = 1; i <= daysInMonth; i++) {
        const isToday = i === today;
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const hasEvent = schedules.some(s => s.time.startsWith(dateStr));
        
        html += `<div class="widget-day ${isToday ? 'today' : ''} ${hasEvent ? 'has-event' : ''}">${i}</div>`;
    }

    html += `</div>`;

    // 即将到来的日程
    const upcoming = schedules
        .filter(s => new Date(s.time) >= now)
        .slice(0, 3);

    if (upcoming.length > 0) {
        html += `<div class="upcoming-events-mini">`;
        upcoming.forEach(item => {
            html += `<div class="mini-event-item" title="${item.time}: ${item.content}">${item.content}</div>`;
        });
        html += `</div>`;
    } else {
        html += `<p class="empty-msg" style="padding: 10px 0; font-size: 0.8em;">近期无日程</p>`;
    }

    widgetContainer.innerHTML = html;
}