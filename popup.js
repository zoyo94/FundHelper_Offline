// ==================== 配置常量 ====================
const CONFIG = {
    BATCH_SIZE: 10,              // API 并发批大小
    API_TIMEOUT: 8000,           // API 请求超时（ms）
    BATCH_DELAY: 100,            // 批次间延迟（ms）
    TRADING_CUTOFF_HOUR: 15,     // 交易截止时间（小时）
    TOAST_SHORT: 1500,           // 短 toast 时长（ms）
    TOAST_NORMAL: 3000,          // 普通 toast 时长（ms）
    TOAST_LONG: 5000,            // 长 toast 时长（ms）
    DEBOUNCE_DELAY: 800,         // 防抖延迟（ms）
    AUTO_REFRESH_INTERVAL: 120000, // 默认自动刷新间隔（ms）
    AUTO_REFRESH_OPTIONS: [30, 60, 120, 300],
    AUTO_REFRESH_STORAGE_KEY: 'autoRefreshIntervalSeconds',
    AUTO_REFRESH_PAUSE_HOUR: 15,
    AUTO_REFRESH_PAUSE_MINUTE: 30,
    MARKET_BREADTH_TIMEOUT: 5000,  // 市场宽度请求超时（ms）
    COLUMN_VISIBILITY_STORAGE_KEY: 'columnVisibility',
    PERF_DAILY_CACHE_STORAGE_KEY: 'fundPerfDailyCache'
};

// ==================== 业务常量 ====================
const CONSTANTS = {
    HISTORY_DAYS_LIMIT: 30,          // 历史数据天数限制
    DAILY_PROFIT_HISTORY_LIMIT: 90, // 日收益历史保留天数
    PRICE_EPSILON: 0.0001,           // 价格比较精度阈值
    DIVIDEND_MIN_THRESHOLD: 0.0001,  // 分红最小阈值
    INTRADAY_CHART_START: '09:00',
    INTRADAY_CHART_MORNING_END: '11:30',
    INTRADAY_CHART_AFTERNOON_START: '13:00',
    INTRADAY_CHART_END: '15:30',
    INTRADAY_CHART_TOTAL_MINUTES: 300
};

// ==================== 全局状态 ====================
let allFundsData = []; // 所有基金的当前行情数据（每次 loadData 完整刷新）
let sortField = 'todayProfit'; // 默认排序字段
let sortDirection = -1;        // 1:升序, -1:降序
let selectedCodes = new Set();
let lastClickedIndex = -1; // 上次点击行索引，用于 Shift 范围选
let fundHistoryData = {}; // 存储基金历史估值数据 { code: { date: 'YYYY-MM-DD', points: [{ time, rate }] } }
let lastUpdateTime = ''; // 最后一次 loadData 完成的时间，用于选中状态切换后恢复显示
let currentFundDetailCode = '';
let currentFundDetailSessionId = 0;
let profitCalendarViewMonth = '';
let profitCalendarSelectedDate = '';
let modalDismissHandler = null;
let marketBreadthData = null;
let autoRefreshIntervalMs = CONFIG.AUTO_REFRESH_INTERVAL;
let nextAutoRefreshAt = 0;
let refreshCountdownTimer = null;
let unifiedRefreshPromise = null;
// 持有天数 & 区间涨跌幅展示缓存（用于表格渲染）
let fundPerfCache = {};
// 区间涨跌幅日级持久化缓存（跨会话硬保留）
let fundPerfDailyCacheByCode = {};
let fundPerfDailyCacheLoaded = false;

const TABLE_COLUMNS = [
    { id: 'index', label: '序号', defaultVisible: true, required: true },
    { id: 'code', label: '代码', defaultVisible: true, required: true },
    { id: 'name', label: '名称/分组', defaultVisible: true, required: true },
    { id: 'amount', label: '持仓', defaultVisible: true, required: true },
    { id: 'shares', label: '份额', defaultVisible: true, fullscreenOnly: true },
    { id: 'nav', label: '净值', defaultVisible: true, fullscreenOnly: true },
    { id: 'holdDays', label: '持有天数', defaultVisible: true, fullscreenOnly: true },
    { id: 'w1', label: '近1周', defaultVisible: true, fullscreenOnly: true },
    { id: 'm1', label: '近1月', defaultVisible: true, fullscreenOnly: true },
    { id: 'm3', label: '近3月', defaultVisible: true, fullscreenOnly: true },
    { id: 'm6', label: '近6月', defaultVisible: true, fullscreenOnly: true },
    { id: 'y1', label: '近1年', defaultVisible: true, fullscreenOnly: true },
    { id: 'ly', label: '成立以来', defaultVisible: true, fullscreenOnly: true },
    { id: 'yesterdayProfit', label: '昨日收益', defaultVisible: true },
    { id: 'todayProfit', label: '估值收益', defaultVisible: true },
    { id: 'holdProfit', label: '累计收益', defaultVisible: true },
    { id: 'actions', label: '操作', defaultVisible: true, fullscreenOnly: true }
];
const TABLE_COLUMN_MAP = TABLE_COLUMNS.reduce((acc, col) => {
    acc[col.id] = col;
    return acc;
}, {});
const PERF_FIELDS = ['holdDays', 'w1', 'm1', 'm3', 'm6', 'y1', 'ly'];
let columnVisibility = TABLE_COLUMNS.reduce((acc, col) => {
    acc[col.id] = col.defaultVisible !== false;
    return acc;
}, {});

function clearSelection() {
    selectedCodes.clear();
    lastClickedIndex = -1;
}

function normalizeColumnVisibility(rawVisibility = {}) {
    const normalized = {};
    TABLE_COLUMNS.forEach(col => {
        const raw = rawVisibility?.[col.id];
        normalized[col.id] = typeof raw === 'boolean' ? raw : (col.defaultVisible !== false);
        if (col.required) {
            normalized[col.id] = true;
        }
    });
    return normalized;
}

function isColumnEffectivelyVisible(colId) {
    const col = TABLE_COLUMN_MAP[colId];
    if (!col) return true;
    const preferVisible = columnVisibility[colId] !== false;
    if (!preferVisible) return false;
    if (col.fullscreenOnly && !document.body.classList.contains('is-fullscreen')) {
        return false;
    }
    return true;
}

function setColumnVisibilityClass(el, colId) {
    if (!el || !colId) return;
    el.classList.toggle('col-user-hidden', !isColumnEffectivelyVisible(colId));
}

function applyColumnVisibilityToHeader() {
    document.querySelectorAll('thead th[data-col]').forEach(th => {
        setColumnVisibilityClass(th, th.dataset.col);
    });
}

function closeColumnConfigPanel() {
    const btn = elements.columnConfigBtn;
    const panel = elements.columnConfigPanel;
    if (!btn || !panel) return;
    panel.classList.remove('open');
    btn.classList.remove('active');
    btn.setAttribute('aria-expanded', 'false');
}

function toggleColumnConfigPanel() {
    const btn = elements.columnConfigBtn;
    const panel = elements.columnConfigPanel;
    if (!btn || !panel) return;
    const open = panel.classList.toggle('open');
    btn.classList.toggle('active', open);
    btn.setAttribute('aria-expanded', String(open));
}

function renderColumnConfigPanel() {
    const panel = elements.columnConfigPanel;
    if (!panel) return;

    panel.replaceChildren();

    const title = document.createElement('div');
    title.className = 'column-config-title';
    title.textContent = '列显示设置';
    panel.appendChild(title);

    TABLE_COLUMNS.forEach(col => {
        const row = document.createElement('label');
        row.className = `column-config-item${col.required ? ' is-disabled' : ''}`;

        const left = document.createElement('span');
        left.className = 'column-config-item-left';
        const label = document.createElement('span');
        label.textContent = col.label;
        left.appendChild(label);

        if (col.required) {
            const hint = document.createElement('span');
            hint.className = 'column-config-hint';
            hint.textContent = '必显';
            left.appendChild(hint);
        } else if (col.fullscreenOnly) {
            const hint = document.createElement('span');
            hint.className = 'column-config-hint';
            hint.textContent = '全屏';
            left.appendChild(hint);
        }

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = columnVisibility[col.id] !== false;
        input.disabled = !!col.required;
        input.dataset.col = col.id;

        input.addEventListener('change', async () => {
            columnVisibility[col.id] = input.checked;
            columnVisibility = normalizeColumnVisibility(columnVisibility);
            renderTable();
            applyColumnVisibilityToHeader();
            try {
                await storage.set({ [CONFIG.COLUMN_VISIBILITY_STORAGE_KEY]: columnVisibility });
            } catch (err) {
                console.error('保存列配置失败:', err);
                showToast('列配置保存失败', 'error');
            }
        });

        row.appendChild(left);
        row.appendChild(input);
        panel.appendChild(row);
    });
}

async function initColumnVisibility() {
    try {
        const stored = await storage.get([CONFIG.COLUMN_VISIBILITY_STORAGE_KEY]);
        columnVisibility = normalizeColumnVisibility(stored[CONFIG.COLUMN_VISIBILITY_STORAGE_KEY] || {});
    } catch (err) {
        console.warn('读取列配置失败，使用默认配置:', err);
        columnVisibility = normalizeColumnVisibility({});
    }

    renderColumnConfigPanel();
    applyColumnVisibilityToHeader();

    if (elements.columnConfigBtn) {
        elements.columnConfigBtn.onclick = (e) => {
            e.stopPropagation();
            toggleColumnConfigPanel();
        };
    }

    if (elements.columnConfigPanel) {
        elements.columnConfigPanel.onclick = (e) => {
            e.stopPropagation();
        };
    }

    document.addEventListener('click', (e) => {
        const panel = elements.columnConfigPanel;
        const btn = elements.columnConfigBtn;
        if (!panel || !btn || !panel.classList.contains('open')) return;
        if (panel.contains(e.target) || btn.contains(e.target)) return;
        closeColumnConfigPanel();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeColumnConfigPanel();
    });
}

// --- 新增：API 日志控制器 ---
const apiLogger = {
    loggedApis: new Set(), // 用于记录已打印日志的接口

    // 重置状态（在 loadData 开始时调用）
    reset() {
        this.loggedApis.clear();
        console.log('%c[API Monitor] 日志状态已重置，开始监测接口...', 'color: #1890ff; font-weight: bold;');
    },

    /**
     * 打印日志（同一 URL 只打印一次，避免重复刷新时刷屏）
     * @param {string} apiName 接口名称（仅用于展示）
     * @param {string} url     请求地址（作为去重 key）
     * @param {string} status  状态描述
     */
    log(apiName, url, status) {
        if (this.loggedApis.has(url)) return;
        console.log(`[API Monitor] ${apiName} | 状态: ${status} | 地址: ${url}`);
        this.loggedApis.add(url);
    }
};

// ==================== DOM 元素引用 ====================
let elements = {};  // populated in DOMContentLoaded

// ==================== 工具函数 ====================

/**
 * 统一的 storage 访问层（Promise 化，带错误处理）
 */
const storage = {
    async get(keys) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(keys, (result) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(`Storage get error: ${chrome.runtime.lastError.message}`));
                } else {
                    resolve(result);
                }
            });
        });
    },
    async set(data) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.set(data, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(`Storage set error: ${chrome.runtime.lastError.message}`));
                } else {
                    resolve();
                }
            });
        });
    }
};

/**
 * 数值格式化工具（保留 2 位小数，带类型检查）
 */
function round2(num) {
    if (typeof num !== 'number' || isNaN(num)) {
        console.warn('round2: 输入不是有效数字:', num);
        return 0;
    }
    return parseFloat(num.toFixed(2));
}

/**
 * 数值格式化工具（保留 6 位小数，用于份额计算，带类型检查）
 */
function round6(num) {
    if (typeof num !== 'number' || isNaN(num)) {
        console.warn('round6: 输入不是有效数字:', num);
        return 0;
    }
    return parseFloat(num.toFixed(6));
}

/**
 * 格式化收益显示（带正负号，保留 2 位小数，带类型检查）
 * @param {number} num - 数值
 * @param {string} suffix - 后缀（如 '%'）
 * @returns {string} 格式化后的字符串
 */
function formatProfit(num, suffix = '') {
    if (typeof num !== 'number' || isNaN(num)) {
        console.warn('formatProfit: 输入不是有效数字:', num);
        return `+0.00${suffix}`;
    }
    return `${num >= 0 ? '+' : ''}${num.toFixed(2)}${suffix}`;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[ch]));
}

let fundDetailFitPage = false;
let fundDetailResizeObserver = null;
let fundDetailLayoutFrameId = null;
let fundDetailChartRenderState = {
    intraday: null
};

function resetFundDetailChartRenderState() {
    fundDetailChartRenderState = {
        intraday: null
    };
}

function hidePerformanceTooltip() {
    const tooltip = document.getElementById('perfChartTooltip');
    if (tooltip) tooltip.style.display = 'none';
}

function getPerformanceChartData(fundData) {
    if (!Array.isArray(fundData) || fundData.length === 0) {
        return null;
    }
    const prices = fundData.map(item => item.price);
    const dates = fundData.map(item => item.date);
    if (prices.length === 0 || dates.length === 0) {
        return null;
    }
    return {
        prices,
        dates,
        isUp: prices[prices.length - 1] >= prices[0]
    };
}

function clearPerformanceCanvas() {
    const canvas = document.getElementById('perfChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function resetPerformanceViewState() {
    hidePerformanceTooltip();
    clearPerformanceCanvas();
}

function getCurrentPerformanceState(code = currentFundDetailCode) {
    if (!code) return null;
    return _performanceState[code] || null;
}

function getCurrentPerformanceChartData() {
    const state = getCurrentPerformanceState();
    if (!state || !Array.isArray(state.fundData) || state.fundData.length === 0) {
        return null;
    }
    return getPerformanceChartData(state.fundData);
}

function getRecentPerformancePreviewList(fundData, limit = 6) {
    if (!Array.isArray(fundData) || fundData.length === 0) {
        return [];
    }
    return fundData.slice(-limit).reverse();
}

function cancelFundDetailLayoutSync() {
    if (fundDetailLayoutFrameId) {
        cancelAnimationFrame(fundDetailLayoutFrameId);
        fundDetailLayoutFrameId = null;
    }
}

function resizeFundDetailCharts() {
    const overlay = document.getElementById('fundDetailOverlay');
    if (!overlay || !overlay.classList.contains('visible')) return;

    const detailCanvas = document.getElementById('detailChart');
    const intradayState = fundDetailChartRenderState.intraday;
    if (detailCanvas && intradayState) {
        drawChart(
            intradayState.code,
            intradayState.currentPrice,
            intradayState.basePrice,
            intradayState.points
        );
    }

    const perfCanvas = document.getElementById('perfChart');
    const performanceChartData = getCurrentPerformanceChartData();
    if (perfCanvas && performanceChartData) {
        drawPerfChart(perfCanvas, performanceChartData.prices, performanceChartData.dates, performanceChartData.isUp);
    }
}

function scheduleFundDetailLayoutSync() {
    cancelFundDetailLayoutSync();
    fundDetailLayoutFrameId = requestAnimationFrame(() => {
        fundDetailLayoutFrameId = null;
        resizeFundDetailCharts();
    });
}

function applyFundDetailSize() {
    const box = document.querySelector('.fund-detail-box');
    const fitBtn = document.getElementById('fundDetailFitBtn');
    if (!box) return;

    box.classList.toggle('fit-page', fundDetailFitPage);
    if (fitBtn) fitBtn.textContent = fundDetailFitPage ? '恢复默认' : '贴合页面';

    scheduleFundDetailLayoutSync();
}

function toggleFundDetailFitPage() {
    fundDetailFitPage = !fundDetailFitPage;
    applyFundDetailSize();
}

function observeFundDetailLayout() {
    const box = document.querySelector('.fund-detail-box');
    if (!box || typeof ResizeObserver === 'undefined') return;

    if (fundDetailResizeObserver) {
        fundDetailResizeObserver.disconnect();
    }

    fundDetailResizeObserver = new ResizeObserver(() => {
        scheduleFundDetailLayoutSync();
    });
    fundDetailResizeObserver.observe(box);
}

window.addEventListener('resize', () => {
    scheduleFundDetailLayoutSync();
});

function syncFundDetailLayout() {
    scheduleFundDetailLayoutSync();
}

function resetFundDetailViewState() {
    resetFundDetailChartRenderState();
    resetPerformanceViewState();
}

function clearFundDetailPerformanceSession(code) {
    if (!code) return;
    delete _performanceState[code];
}

function cleanupFundDetailSessionState(code) {
    resetFundDetailViewState();
    clearFundDetailPerformanceSession(code);
}

function beginFundDetailSession(code) {
    if (currentFundDetailCode) {
        cleanupFundDetailSessionState(currentFundDetailCode);
    } else {
        resetFundDetailViewState();
    }
    currentFundDetailCode = code;
    currentFundDetailSessionId += 1;
    return currentFundDetailSessionId;
}

function isCurrentFundDetail(code, sessionId = currentFundDetailSessionId) {
    return currentFundDetailCode === code && currentFundDetailSessionId === sessionId;
}

function createFundDetailStaleGuard(code, sessionId = currentFundDetailSessionId) {
    return () => !isCurrentFundDetail(code, sessionId);
}


/**
 * 获取今天日期 YYYY-MM-DD
 */
function getToday() {
    const now = new Date();
    return formatDate(now);
}

/**
 * 格式化日期为 YYYY-MM-DD
 */
function formatDate(date) {
    const d = date instanceof Date ? date : new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 格式化时间为 HH:MM
 */
function formatTime(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function getIntradayBasePoint() {
    return { time: CONSTANTS.INTRADAY_CHART_START, rate: 0 };
}

function ensureIntradayBasePoint(points = []) {
    const normalized = Array.isArray(points) ? [...points] : [];
    if (normalized[0]?.time !== CONSTANTS.INTRADAY_CHART_START) {
        normalized.unshift(getIntradayBasePoint());
    }
    return normalized;
}

function isIntradayChartTime(time) {
    return typeof time === 'string'
        && time >= CONSTANTS.INTRADAY_CHART_START
        && time <= CONSTANTS.INTRADAY_CHART_END;
}

function getIntradayFallbackPoints(rate, time = formatTime()) {
    const points = ensureIntradayBasePoint();
    if (isIntradayChartTime(time) && time !== CONSTANTS.INTRADAY_CHART_START) {
        points.push({ time, rate });
    }
    return points;
}

function getIntradayChartRangeLabel() {
    return `${CONSTANTS.INTRADAY_CHART_START} - ${CONSTANTS.INTRADAY_CHART_END}`;
}

function getIntradayMinutes(time) {
    if (typeof time !== 'string') return 0;
    const [hour, minute] = time.split(':').map(Number);
    return hour * 60 + minute;
}

function getIntradayChartOffsetMinutes(time) {
    const total = getIntradayMinutes(time);
    const start = getIntradayMinutes(CONSTANTS.INTRADAY_CHART_START);
    const morningEnd = getIntradayMinutes(CONSTANTS.INTRADAY_CHART_MORNING_END);
    const afternoonStart = getIntradayMinutes(CONSTANTS.INTRADAY_CHART_AFTERNOON_START);

    if (total <= morningEnd) return total - start;
    if (total < afternoonStart) return morningEnd - start;
    return (morningEnd - start) + (total - afternoonStart);
}

function getIntradayAxisTicks() {
    return [
        CONSTANTS.INTRADAY_CHART_START,
        CONSTANTS.INTRADAY_CHART_MORNING_END,
        CONSTANTS.INTRADAY_CHART_END
    ].map(time => ({ time, min: getIntradayChartOffsetMinutes(time) }));
}

/**
 * 格式化日期时间为文件名格式 YYYYMMDD_HHMM
 */
function formatDateTimeForFile(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 计算分红到账日期（D+2，遇周末顺延到周一）
 * @param {string} dividendDate - 分红日期 YYYY-MM-DD
 * @returns {string} 到账日期 YYYY-MM-DD
 */
function calculateDividendArrivalDate(dividendDate) {
    if (!dividendDate || typeof dividendDate !== 'string') {
        console.error('calculateDividendArrivalDate: 无效的分红日期:', dividendDate);
        return getToday(); // 返回今天作为fallback
    }

    const d = new Date(dividendDate);
    if (isNaN(d.getTime())) {
        console.error('calculateDividendArrivalDate: 无法解析的日期格式:', dividendDate);
        return getToday(); // 返回今天作为fallback
    }

    d.setDate(d.getDate() + 2); // D+2

    // 如果到账日是周六(6)，顺延2天到周一
    // 如果到账日是周日(0)，顺延1天到周一
    const dayOfWeek = d.getDay();
    if (dayOfWeek === 6) {
        d.setDate(d.getDate() + 2);
    } else if (dayOfWeek === 0) {
        d.setDate(d.getDate() + 1);
    }

    return formatDate(d);
}

/**
 * 时间戳转日期字符串 YYYY-MM-DD
 */
function timestampToDate(timestamp) {
    return formatDate(new Date(timestamp));
}

/**
 * 防抖函数
 * @param {Function} func - 要防抖的函数
 * @param {number} wait - 等待时间（毫秒）
 * @returns {Function} 防抖后的函数
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * 通用错误处理包装器
 * @param {Function} fn - 要包装的异步函数
 * @param {string} context - 错误上下文描述
 * @returns {Function} 包装后的函数
 */
function withErrorHandling(fn, context) {
    return async function (...args) {
        try {
            return await fn.apply(this, args);
        } catch (error) {
            console.error(`[${context}] 操作失败:`, error);
            showToast(`${context}失败: ${error.message}`, 'error');

            // 将错误信息添加到通知中心
            notificationCenter.add(`${context}时发生错误: ${error.message}`, 'error');

            return null; // 返回默认值，避免后续代码崩溃
        }
    };
}

/**
 * 判断是否为分红类型
 */
function isDividendType(type) {
    return type === 'dividend' || type === 'dividend_reinvest';
}

// ==================== Toast / Modal 工具函数 ====================

// ==================== 通知中心 ====================
const notificationCenter = {
    notifications: [],

    // 初始化：加载今天的通知
    async init() {
        const { notifications, notificationDate } = await storage.get(['notifications', 'notificationDate']);
        const todayStr = getToday();

        // 如果是新的一天，清空通知
        if (notificationDate !== todayStr) {
            this.notifications = [];
            await storage.set({ notifications: [], notificationDate: todayStr });
        } else {
            this.notifications = notifications || [];
        }

        this.updateBadge();
    },

    // 添加通知
    async add(message, type = 'info') {
        const notification = {
            id: Date.now(),
            message,
            type,
            time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        };

        this.notifications.unshift(notification); // 新通知在前
        await storage.set({ notifications: this.notifications });
        this.updateBadge();
    },

    // 更新角标
    updateBadge() {
        const badge = document.getElementById('notificationBadge');
        if (badge) {
            const count = this.notifications.length;
            if (count > 0) {
                badge.textContent = count > 99 ? '99+' : count;
                badge.style.display = 'block';
            } else {
                badge.style.display = 'none';
            }
        }
    },

    // 清空所有通知
    async clear() {
        this.notifications = [];
        await storage.set({ notifications: [], notificationDate: getToday() });
        this.updateBadge();
    },

    // 显示通知列表
    show() {
        const renderContent = () => {
            if (this.notifications.length === 0) {
                elements.modalMsg.innerHTML = '<div class="notification-empty">今天还没有通知</div>';
            } else {
                let html = '<div class="notification-list">';
                this.notifications.forEach(notif => {
                    html += `
                        <div class="notification-item">
                            <div class="notification-header">
                                <span class="notification-type ${notif.type}">${this.getTypeLabel(notif.type)}</span>
                                <span class="notification-time">${notif.time}</span>
                            </div>
                            <div class="notification-message">${notif.message}</div>
                        </div>
                    `;
                });
                html += '</div>';
                elements.modalMsg.innerHTML = html;
            }
        };

        setModalDismissHandler(_closeModal);
        elements.modalOverlay.dataset.mode = '';
        elements.modalTitle.textContent = '通知中心';
        renderContent();
        elements.modalInput.style.display = 'none';
        elements.modalInput.onkeydown = null;
        elements.modalMsg.onclick = null;
        _setFooter([
            {
                text: '清空', cls: 'modal-btn-danger', onClick: async () => {
                    await this.clear();
                    renderContent();
                    // 清空后只保留关闭按钮
                    _setFooter([
                        { text: '关闭', cls: 'modal-btn-cancel', onClick: _closeModal }
                    ]);
                }
            },
            { text: '关闭', cls: 'modal-btn-cancel', onClick: _closeModal }
        ]);
        setModalVisibility(true);
    },

    getTypeLabel(type) {
        const labels = {
            info: '提示',
            success: '成功',
            warning: '警告',
            error: '错误'
        };
        return labels[type] || '提示';
    }
};

/**
 * 显示底部 Toast 提示（同时添加到通知中心）
 * 优化：确保 toast 元素正确移除，防止内存泄漏
 * @param {string} msg
 * @param {string} type
 * @param {number} duration
 * @param {boolean} silent - 为 true 时只弹 toast，不写入通知中心
 */
function showToast(msg, type = 'info', duration = CONFIG.TOAST_NORMAL, silent = false) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    elements.toastContainer.appendChild(toast);

    const removeToast = () => {
        if (toast.parentNode) {
            toast.remove();
        }
    };

    setTimeout(() => {
        toast.classList.add('fade-out');
        toast.addEventListener('animationend', removeToast, { once: true });
        // 备用清理：防止 animationend 未触发
        setTimeout(removeToast, 500);
    }, duration);

    // 添加到通知中心（静默模式下跳过）
    if (!silent) notificationCenter.add(msg, type);
}

function setModalDismissHandler(handler = null) {
    modalDismissHandler = typeof handler === 'function' ? handler : null;
}

function dismissModal() {
    const handler = modalDismissHandler;
    if (handler) {
        handler();
        return;
    }
    _closeModal();
}

function setModalVisibility(isVisible) {
    elements.modalOverlay.classList.toggle('visible', isVisible);
    elements.modalOverlay.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
}

function showAlert(msg, title = '提示') {
    return new Promise(resolve => {
        _openModal(title, msg, false, '', () => {
            _closeModal();
            resolve();
        });
        _setFooter([
            { text: '确定', cls: 'modal-btn-ok', onClick: () => { _closeModal(); resolve(); } }
        ]);
    });
}

function showConfirm(msg, title = '确认', danger = false) {
    return new Promise(resolve => {
        _openModal(title, msg, false, '', () => {
            _closeModal();
            resolve(false);
        });
        _setFooter([
            { text: '取消', cls: 'modal-btn-cancel', onClick: () => { _closeModal(); resolve(false); } },
            { text: '确定', cls: danger ? 'modal-btn-danger' : 'modal-btn-ok', onClick: () => { _closeModal(); resolve(true); } }
        ]);
    });
}

function showPrompt(msg, { defaultVal = '', title = '请输入' } = {}) {
    return new Promise(resolve => {
        _openModal(title, msg, true, defaultVal, () => {
            _closeModal();
            resolve(null);
        });
        const onOk = () => {
            const val = elements.modalInput.value;
            _closeModal();
            resolve(val);
        };
        elements.modalOverlay.dataset.mode = '';
        elements.modalMsg.onclick = null;
        elements.modalInput.onkeydown = (e) => { if (e.key === 'Enter') onOk(); };
        _setFooter([
            { text: '取消', cls: 'modal-btn-cancel', onClick: () => { _closeModal(); resolve(null); } },
            { text: '确定', cls: 'modal-btn-ok', onClick: onOk }
        ]);
        elements.modalInput.focus();
    });
}

function _openModal(title, msg, showInput, defaultVal = '', onDismiss = null) {
    setModalDismissHandler(onDismiss);
    elements.modalOverlay.dataset.mode = '';
    elements.modalInput.onkeydown = null;
    elements.modalMsg.onclick = null;
    elements.modalTitle.textContent = title;
    elements.modalMsg.textContent = msg;
    if (showInput) {
        elements.modalInput.value = defaultVal;
        elements.modalInput.style.display = 'block';
    } else {
        elements.modalInput.value = '';
        elements.modalInput.style.display = 'none';
    }
    elements.modalFooter.replaceChildren();
    setModalVisibility(true);
}

function _closeModal() {
    setModalDismissHandler(null);
    setModalVisibility(false);
    elements.modalOverlay.dataset.mode = '';
    elements.modalOverlay.style.removeProperty('top');
    elements.modalOverlay.style.removeProperty('bottom');
    elements.modalOverlay.style.removeProperty('overflow-y');
    elements.modalInput.value = '';
    elements.modalInput.onkeydown = null;
    elements.modalMsg.onclick = null; // 清空撤销等临时绑定，防止泄漏到下一个弹窗
    elements.modalFooter.replaceChildren();
}
function _setFooter(btns) {
    elements.modalFooter.replaceChildren();
    btns.forEach(({ text, cls, onClick }) => {
        const btn = document.createElement('button');
        btn.textContent = text;
        btn.className = `modal-btn ${cls}`;
        btn.onclick = onClick;
        elements.modalFooter.appendChild(btn);
    });
}

function showHtmlModal(title, html, footerBtns = null) {
    setModalDismissHandler(_closeModal);
    elements.modalOverlay.dataset.mode = '';
    elements.modalTitle.style.display = '';
    elements.modalFooter.style.display = '';
    const modalBox = elements.modalOverlay.querySelector('.modal-box');
    if (modalBox) modalBox.style.padding = '';

    elements.modalInput.onkeydown = null;
    elements.modalTitle.textContent = title;
    elements.modalMsg.onclick = null;
    elements.modalMsg.innerHTML = html;
    elements.modalInput.value = '';
    elements.modalInput.style.display = 'none';
    _setFooter(footerBtns || [
        { text: '关闭', cls: 'modal-btn-cancel', onClick: _closeModal }
    ]);
    setModalVisibility(true);
}

// ==================== 撤销结算功能 ====================
const ROLLBACK_SETTLEMENT_PREFIX = 'ROLLBACK_';

async function checkBackup() {
    const { backupFunds, lastSettlementDate, autoSettlementBlockedDate } = await storage.get([
        'backupFunds',
        'lastSettlementDate',
        'autoSettlementBlockedDate'
    ]);
    const fabRollback = document.getElementById('fabRollback');
    if (fabRollback) {
        const hasBackup = hasTodayBackup(backupFunds);
        const { settlementDate } = parseSettlementState(lastSettlementDate, autoSettlementBlockedDate);
        fabRollback.style.display = (hasBackup && settlementDate === getToday()) ? 'flex' : 'none';
    }
}

function cloneData(data) {
    return typeof structuredClone === 'function'
        ? structuredClone(data)
        : JSON.parse(JSON.stringify(data));
}

function deriveFundShares(item, primaryPrice = 0, fallbackPrice = 0) {
    if (!item) return 0;
    const currentShares = Number(item.shares) || 0;
    if (currentShares > 0) return currentShares;
    if (!(item.amount > 0)) return 0;

    const baseNav = item.savedPrevPrice || primaryPrice || fallbackPrice || 0;
    return baseNav > 0 ? round6(item.amount / baseNav) : 0;
}

function hasProfitMapChange(nextValue, prevValue) {
    const nextKeys = Object.keys(nextValue || {});
    const prevKeys = Object.keys(prevValue || {});
    if (nextKeys.length !== prevKeys.length) return true;
    return nextKeys.some(key => round2(Number(nextValue[key]) || 0) !== round2(Number(prevValue?.[key]) || 0));
}

function areDailyProfitEntriesEqual(left, right) {
    if (!left && !right) return true;
    if (!left || !right) return false;
    if (round2(Number(left.totalProfit) || 0) !== round2(Number(right.totalProfit) || 0)) return false;

    const leftByCode = left.byCode || {};
    const rightByCode = right.byCode || {};
    const leftKeys = Object.keys(leftByCode);
    const rightKeys = Object.keys(rightByCode);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every(code => round2(Number(leftByCode[code]) || 0) === round2(Number(rightByCode[code]) || 0));
}

function buildTodayProfits(results) {
    const todayProfits = {};
    results.forEach(result => {
        if (!result) return;
        todayProfits[result.code] = result.todayProfit;
    });
    return todayProfits;
}

function buildLoadDataPersistPayload({
    todayProfits,
    lastDayProfits,
    nextDailyProfitHistory,
    dailyProfitHistoryChanged,
    dataChanged,
    funds
}) {
    const dataToPersist = {};
    if (hasProfitMapChange(todayProfits, lastDayProfits || {})) {
        dataToPersist.lastDayProfits = todayProfits;
    }
    if (dailyProfitHistoryChanged) {
        dataToPersist.dailyProfitHistory = nextDailyProfitHistory;
    }
    if (dataChanged) {
        dataToPersist.myFunds = funds;
    }
    return dataToPersist;
}

function getDominantMarketPrevPriceDate(fetchedData) {
    const dateCounts = new Map();
    for (const { live } of fetchedData) {
        const date = live?.prevPriceDate || '';
        if (!date) continue;
        dateCounts.set(date, (dateCounts.get(date) || 0) + 1);
    }

    let dominantDate = '';
    let dominantCount = 0;
    for (const [date, count] of dateCounts.entries()) {
        if (count > dominantCount || (count === dominantCount && date > dominantDate)) {
            dominantDate = date;
            dominantCount = count;
        }
    }
    return dominantDate;
}

function hasFreshYesterdayProfit(item, live, dominantMarketPrevPriceDate) {
    const livePrevPriceDate = live?.prevPriceDate || '';
    return !!(
        item.savedPrevDate &&
        item.savedPrevDate === livePrevPriceDate &&
        (!dominantMarketPrevPriceDate || livePrevPriceDate === dominantMarketPrevPriceDate)
    );
}

function parseSettlementState(lastSettlementDate, autoSettlementBlockedDate) {
    const isLegacyRollback = typeof lastSettlementDate === 'string' && lastSettlementDate.startsWith(ROLLBACK_SETTLEMENT_PREFIX);
    return {
        settlementDate: isLegacyRollback ? null : (lastSettlementDate || null),
        blockedDate: autoSettlementBlockedDate || (isLegacyRollback ? lastSettlementDate.slice(ROLLBACK_SETTLEMENT_PREFIX.length) : null)
    };
}

function createBackupSnapshot({ myFunds, lastUpdateDate, lastDayProfits, lastSettlementDate, autoSettlementBlockedDate, backupFunds, dailyProfitHistory }) {
    return {
        // 这里先冻结一份快照，避免后续流程继续修改 funds / lastDayProfits 污染当天首份备份
        myFunds: cloneData(myFunds || {}),
        lastUpdateDate,
        lastDayProfits: cloneData(lastDayProfits || {}),
        lastSettlementDate,
        autoSettlementBlockedDate,
        backupFunds,
        dailyProfitHistory: cloneData(dailyProfitHistory || {})
    };
}

function hasTodayBackup(backupFunds, todayStr = getToday()) {
    return !!backupFunds?.myFunds
        && Object.keys(backupFunds.myFunds).length > 0
        && backupFunds.backupDate === todayStr;
}

function getBackupExportMetadata(backupFunds) {
    return {
        backupDate: backupFunds.backupDate || '',
        backupTime: backupFunds.exportDate || '',
        version: backupFunds.version || '',
        lastSettlementDate: backupFunds.lastSettlementDate || '',
        autoSettlementBlockedDate: backupFunds.autoSettlementBlockedDate || ''
    };
}

function normalizeDailyProfitHistory(history) {
    if (!history || typeof history !== 'object' || Array.isArray(history)) return {};
    const normalized = {};
    const dates = Object.keys(history)
        .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date))
        .sort();

    const keptDates = dates.slice(-CONSTANTS.DAILY_PROFIT_HISTORY_LIMIT);
    for (const date of keptDates) {
        const entry = history[date] || {};
        const byCodeRaw = entry.byCode && typeof entry.byCode === 'object' ? entry.byCode : {};
        const byCode = {};
        let totalProfit = 0;
        for (const [code, value] of Object.entries(byCodeRaw)) {
            const profit = round2(Number(value) || 0);
            byCode[code] = profit;
            totalProfit = round2(totalProfit + profit);
        }
        normalized[date] = {
            totalProfit: typeof entry.totalProfit === 'number' && !Number.isNaN(entry.totalProfit)
                ? round2(entry.totalProfit)
                : totalProfit,
            byCode
        };
    }
    return normalized;
}

function calculateYesterdayProfitValue(item, priceUpdate) {
    const { price, prevPriceDate, prevTradingDayPrice, prevTradingDayDate } = priceUpdate;
    if (!item || !(price > 0) || !(prevTradingDayPrice > 0) || !prevTradingDayDate || !prevPriceDate) {
        return 0;
    }

    const diffDays = Math.round(
        (new Date(prevPriceDate) - new Date(prevTradingDayDate)) / 86400000
    );
    if (diffDays <= 0) {
        return 0;
    }

    const shares = deriveFundShares(item, price);
    return shares > 0 ? round2(shares * (price - prevTradingDayPrice)) : 0;
}

function getDisplayedYesterdayProfitValue(baseProfit, pendingAdjustments) {
    const manualPendingDividend = sumPendingManualDividendAmount(pendingAdjustments);
    return round2((baseProfit || 0) + manualPendingDividend);
}

function getDisplayedFreshYesterdayProfitValue(item, live, dominantMarketPrevPriceDate = '') {
    const baseProfit = hasFreshYesterdayProfit(item, live, dominantMarketPrevPriceDate)
        ? round2(item?.yesterdayProfit || 0)
        : 0;
    const pendingAdjustments = getPendingAdjustments(item);
    return getDisplayedYesterdayProfitValue(baseProfit, pendingAdjustments);
}

function calculateRecordedYesterdayProfitValue(item, priceUpdate, dominantMarketPrevPriceDate = '') {
    if (!item || !hasFreshYesterdayProfit(item, priceUpdate, dominantMarketPrevPriceDate)) {
        return 0;
    }
    return round2(item.yesterdayProfit || 0);
}

function recordDailyProfitHistory(history, funds, priceUpdates, dominantMarketPrevPriceDate = '') {
    const nextHistory = normalizeDailyProfitHistory(history);
    const settlementDate = dominantMarketPrevPriceDate || '';
    if (!settlementDate) {
        return {
            history: nextHistory,
            changed: false
        };
    }

    const byCode = {};
    let totalProfit = 0;

    for (const priceUpdate of priceUpdates) {
        const { code, prevPriceDate } = priceUpdate;
        if (!code || prevPriceDate !== settlementDate) continue;

        const item = funds[code];
        if (!item) continue;

        const profit = calculateRecordedYesterdayProfitValue(item, priceUpdate, dominantMarketPrevPriceDate);
        byCode[code] = profit;
        totalProfit = round2(totalProfit + profit);
    }

    const nextEntry = { totalProfit, byCode };
    const changed = !areDailyProfitEntriesEqual(nextHistory[settlementDate], nextEntry);
    if (!changed) {
        return {
            history: nextHistory,
            changed: false
        };
    }

    nextHistory[settlementDate] = nextEntry;
    return {
        history: normalizeDailyProfitHistory(nextHistory),
        changed: true
    };
}

function reconcileDailyProfitHistory(history, funds, fetchedData, dominantMarketPrevPriceDate = '') {
    const normalizedHistory = normalizeDailyProfitHistory(history);
    if (!dominantMarketPrevPriceDate) {
        return {
            history: normalizedHistory,
            changed: false
        };
    }

    const priceUpdates = [];
    for (const { code, live } of fetchedData) {
        if (!live || live.prevPriceDate !== dominantMarketPrevPriceDate) continue;
        if (!funds[code]) continue;
        priceUpdates.push(buildSettlementEntry(code, live));
    }

    return recordDailyProfitHistory(normalizedHistory, funds, priceUpdates, dominantMarketPrevPriceDate);
}

function buildProfitHistoryMonthGrid(monthKey) {
    const [year, month] = (monthKey || getToday().slice(0, 7)).split('-').map(Number);
    const firstDay = new Date(year, month - 1, 1);
    const firstWeekday = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month, 0).getDate();
    const cells = [];

    for (let i = 0; i < firstWeekday; i++) {
        cells.push({ type: 'empty', key: `empty-${i}` });
    }
    for (let day = 1; day <= daysInMonth; day++) {
        const date = `${monthKey}-${String(day).padStart(2, '0')}`;
        cells.push({ type: 'day', date });
    }
    while (cells.length % 7 !== 0) {
        cells.push({ type: 'empty', key: `tail-${cells.length}` });
    }
    return cells;
}

function shiftMonth(monthKey, delta) {
    const [year, month] = (monthKey || getToday().slice(0, 7)).split('-').map(Number);
    const next = new Date(year, month - 1 + delta, 1);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
}

function getCurrentProfitCalendarContext() {
    const filter = elements.groupFilter?.value || 'all';
    const visibleItems = allFundsData.filter(item => filter === 'all' || item.group === filter);
    const visibleCodes = new Set(visibleItems.map(item => item.code));
    return {
        filter,
        title: filter === 'all' ? '全部收益日历' : `${filter} 收益日历`,
        visibleItems,
        visibleCodes
    };
}

function getFilteredProfitHistory(history, filter) {
    const normalized = normalizeDailyProfitHistory(history);
    if (filter === 'all') return normalized;

    const groupByCode = new Map(allFundsData.map(item => [item.code, item.group]));
    const filtered = {};
    for (const [date, entry] of Object.entries(normalized)) {
        const byCode = {};
        let totalProfit = 0;
        for (const [code, profit] of Object.entries(entry.byCode || {})) {
            if (groupByCode.get(code) !== filter) continue;
            byCode[code] = profit;
            totalProfit = round2(totalProfit + profit);
        }
        if (Object.keys(byCode).length > 0) {
            filtered[date] = { totalProfit, byCode };
        }
    }
    return filtered;
}

function getProfitCalendarMonthDates(history, monthKey) {
    return Object.keys(history || {})
        .filter(date => date.startsWith(`${monthKey}-`))
        .sort();
}

function getProfitCalendarSelectedDate(history, monthKey, preferredDate = '') {
    const monthDates = getProfitCalendarMonthDates(history, monthKey);
    if (preferredDate && preferredDate.startsWith(`${monthKey}-`) && monthDates.includes(preferredDate)) {
        return preferredDate;
    }
    return monthDates[monthDates.length - 1] || '';
}

function formatProfitCalendarMonth(monthKey) {
    const [year, month] = (monthKey || getToday().slice(0, 7)).split('-');
    return `${year}年${Number(month)}月`;
}

function formatProfitCalendarDate(dateStr) {
    if (!dateStr) return '未选择日期';
    const date = new Date(`${dateStr}T00:00:00`);
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const weekday = Number.isNaN(date.getTime()) ? '' : ` ${weekdays[date.getDay()]}`;
    return `${dateStr}${weekday}`;
}

async function openProfitCalendar() {
    const { dailyProfitHistory } = await storage.get(['dailyProfitHistory']);
    const history = normalizeDailyProfitHistory(dailyProfitHistory);

    const getMonthSummary = (filteredHistory, monthKey) => {
        const monthDates = getProfitCalendarMonthDates(filteredHistory, monthKey);
        const monthValues = monthDates.map(date => Math.abs(filteredHistory[date]?.totalProfit || 0));
        return {
            monthDates,
            monthMaxAbs: Math.max(...monthValues, 1)
        };
    };

    const render = () => {
        const context = getCurrentProfitCalendarContext();
        const filteredHistory = getFilteredProfitHistory(history, context.filter);
        const allDates = Object.keys(filteredHistory).sort();
        const latestDate = allDates[allDates.length - 1] || getToday();

        if (!/^\d{4}-\d{2}$/.test(profitCalendarViewMonth)) {
            profitCalendarViewMonth = latestDate.slice(0, 7);
        }

        const { monthDates, monthMaxAbs } = getMonthSummary(filteredHistory, profitCalendarViewMonth);

        profitCalendarSelectedDate = getProfitCalendarSelectedDate(
            filteredHistory,
            profitCalendarViewMonth,
            profitCalendarSelectedDate
        );

        const gridCells = buildProfitHistoryMonthGrid(profitCalendarViewMonth);
        const codeMap = new Map(allFundsData.map(item => [item.code, item]));
        const selectedEntry = profitCalendarSelectedDate
            ? (filteredHistory[profitCalendarSelectedDate] || { totalProfit: 0, byCode: {} })
            : { totalProfit: 0, byCode: {} };
        const detailRows = Object.entries(selectedEntry.byCode || {})
            .map(([code, profit]) => ({
                code,
                name: codeMap.get(code)?.name || code,
                profit: round2(Number(profit) || 0)
            }))
            .sort((a, b) => b.profit - a.profit || a.code.localeCompare(b.code));

        const weekdayHtml = ['一', '二', '三', '四', '五', '六', '日']
            .map(day => `<div class="profit-calendar-weekday">${day}</div>`)
            .join('');

        const gridHtml = gridCells.map(cell => {
            if (cell.type === 'empty') {
                return '<div class="profit-calendar-cell empty"></div>';
            }

            const entry = filteredHistory[cell.date];
            const hasData = !!entry && Object.keys(entry.byCode || {}).length > 0;
            const totalProfit = round2(entry?.totalProfit || 0);
            const isPositive = totalProfit > 0;
            const isNegative = totalProfit < 0;
            const alpha = hasData
                ? (0.12 + Math.min(Math.abs(totalProfit) / monthMaxAbs, 1) * 0.2).toFixed(2)
                : '0.16';

            return `
                <button
                    type="button"
                    class="profit-calendar-day-btn ${hasData ? 'has-data' : ''} ${isPositive ? 'positive' : ''} ${isNegative ? 'negative' : ''} ${cell.date === getToday() ? 'is-today' : ''} ${cell.date === profitCalendarSelectedDate ? 'is-selected' : ''}"
                    data-calendar-date="${cell.date}"
                    style="--calendar-alpha:${alpha};"
                >
                    <span class="profit-calendar-day-label">${Number(cell.date.slice(-2))}</span>
                    <span class="profit-calendar-day-value">${hasData ? formatProfit(totalProfit) : '暂无'}</span>
                </button>
            `;
        }).join('');

        const detailHtml = detailRows.length > 0
            ? `
                <div class="profit-calendar-detail-list">
                    ${detailRows.map(item => `
                        <div class="profit-calendar-detail-row">
                            <div class="profit-calendar-detail-name" title="${escapeHtml(item.name)} (${item.code})">
                                ${escapeHtml(item.name)} (${item.code})
                            </div>
                            <div class="profit-calendar-detail-profit ${item.profit > 0 ? 'positive' : ''} ${item.profit < 0 ? 'negative' : ''}">
                                ${formatProfit(item.profit)}
                            </div>
                        </div>
                    `).join('')}
                </div>
            `
            : `<div class="profit-calendar-detail-empty">${allDates.length === 0 ? '还没有日收益记录。完成一次自动或手动结算后会显示在这里。' : (monthDates.length === 0 ? '该月份暂无已记录收益。' : '当天暂无已记录收益。')}</div>`;

        const detailHeaderDate = profitCalendarSelectedDate ? formatProfitCalendarDate(profitCalendarSelectedDate) : `${formatProfitCalendarMonth(profitCalendarViewMonth)} 暂无记录`;
        const detailHeaderTotal = profitCalendarSelectedDate ? formatProfit(round2(selectedEntry.totalProfit || 0)) : '—';
        const selectedCount = detailRows.length;
        const detailBadgeText = !profitCalendarSelectedDate
            ? '未选中日期'
            : (selectedCount > 0 ? `${selectedCount} 项明细` : (monthDates.length === 0 ? '本月无记录' : '当日无明细'));
        const detailBadgeClass = selectedEntry.totalProfit > 0 ? 'positive' : (selectedEntry.totalProfit < 0 ? 'negative' : '');

        // 计算本月收益合计
        const monthTotalProfit = round2(monthDates.reduce((sum, date) => {
            return sum + (filteredHistory[date]?.totalProfit || 0);
        }, 0));
        const monthTotalClass = monthTotalProfit > 0 ? 'positive' : (monthTotalProfit < 0 ? 'negative' : '');
        const monthTotalText = monthDates.length > 0 ? formatProfit(monthTotalProfit) : '—';
        const monthRecordedDays = monthDates.length;

        setModalDismissHandler(_closeModal);
        elements.modalOverlay.dataset.mode = 'profit-calendar';
        elements.modalInput.style.display = 'none';
        elements.modalInput.onkeydown = null;
        elements.modalMsg.innerHTML = `
            <div class="profit-calendar-modal">
                <div class="profit-calendar-toolbar">
                    <div class="profit-calendar-caption">
                        <div class="profit-calendar-title-row">
                            <div class="profit-calendar-title">${context.title}</div>
                            <div class="profit-calendar-meta">
                                <div class="profit-calendar-meta-item">当前 ${context.visibleItems.length} 项</div>
                                <div class="profit-calendar-meta-item">已记录 ${allDates.length} 个交易日</div>
                            </div>
                        </div>
                        <div class="profit-calendar-nav">
                            <button type="button" class="profit-calendar-nav-btn" data-calendar-nav="-1">‹</button>
                            <div class="profit-calendar-month">${formatProfitCalendarMonth(profitCalendarViewMonth)}</div>
                            <button type="button" class="profit-calendar-nav-btn" data-calendar-nav="1">›</button>
                            <button type="button" class="profit-calendar-nav-btn close-btn" data-calendar-close="true" title="关闭">✕</button>
                        </div>
                    </div>
                </div>
                <div class="profit-calendar-month-summary">
                    <div class="profit-calendar-month-summary-label">
                        <span>${formatProfitCalendarMonth(profitCalendarViewMonth)} 月收益</span>
                        <span class="profit-calendar-month-summary-days">${monthRecordedDays > 0 ? `${monthRecordedDays} 个交易日` : '暂无记录'}</span>
                    </div>
                    <div class="profit-calendar-month-summary-total ${monthTotalClass}">${monthTotalText}</div>
                </div>
                <div class="profit-calendar-legend">
                    <div class="profit-calendar-legend-item"><span class="profit-calendar-legend-dot positive"></span><span>盈利</span></div>
                    <div class="profit-calendar-legend-item"><span class="profit-calendar-legend-dot negative"></span><span>亏损</span></div>
                    <div class="profit-calendar-legend-item"><span class="profit-calendar-legend-dot neutral"></span><span>今日/选中</span></div>
                </div>
                <div class="profit-calendar-weekdays">${weekdayHtml}</div>
                <div class="profit-calendar-grid">${gridHtml}</div>
                <div class="profit-calendar-detail">
                    <div class="profit-calendar-detail-header">
                        <div class="profit-calendar-detail-heading">
                            <div class="profit-calendar-detail-date">${detailHeaderDate}</div>
                            <div class="profit-calendar-detail-badge ${detailBadgeClass}">${detailBadgeText}</div>
                        </div>
                        <div class="profit-calendar-detail-summary">
                            <div class="profit-calendar-detail-count">日收益合计</div>
                            <div class="profit-calendar-detail-total ${selectedEntry.totalProfit > 0 ? 'positive' : ''} ${selectedEntry.totalProfit < 0 ? 'negative' : ''}">
                                ${detailHeaderTotal}
                            </div>
                        </div>
                    </div>
                    ${detailHtml}
                </div>
            </div>
        `;
        _setFooter([]);
        setModalVisibility(true);

        elements.modalMsg.onclick = (event) => {
            if (event.target.closest('[data-calendar-close]')) {
                _closeModal();
                return;
            }

            const navBtn = event.target.closest('[data-calendar-nav]');
            if (navBtn) {
                profitCalendarViewMonth = shiftMonth(profitCalendarViewMonth, Number(navBtn.dataset.calendarNav));
                profitCalendarSelectedDate = '';
                render();
                return;
            }

            const dayBtn = event.target.closest('[data-calendar-date]');
            if (dayBtn) {
                profitCalendarSelectedDate = dayBtn.dataset.calendarDate;
                render();
            }
        };
    };

    const initialContext = getCurrentProfitCalendarContext();
    const initialFilteredHistory = getFilteredProfitHistory(history, initialContext.filter);
    const initialDates = Object.keys(initialFilteredHistory).sort();
    const initialLatestDate = initialDates[initialDates.length - 1] || getToday();
    if (!/^\d{4}-\d{2}$/.test(profitCalendarViewMonth) || !initialDates.some(date => date.startsWith(`${profitCalendarViewMonth}-`))) {
        profitCalendarViewMonth = initialLatestDate.slice(0, 7);
    }
    profitCalendarSelectedDate = getProfitCalendarSelectedDate(
        initialFilteredHistory,
        profitCalendarViewMonth,
        profitCalendarSelectedDate
    );

    render();
}

function buildConfirmedTransactionsState() {
    return {
        add: [],
        remove: [],
        dividend: [],
        dividend_reinvest: []
    };
}

function ensurePendingAdjustments(item) {
    if (!Array.isArray(item.pendingAdjustments)) {
        item.pendingAdjustments = [];
    }
    return item.pendingAdjustments;
}

function buildAutoDividendNotification(code, dividend, totalDividend, arrivalDate, isArrived) {
    if (isArrived) {
        return {
            message: `检测到 ${code} 分红：${dividend.date}，每份${dividend.perShare}元，共${totalDividend}元（已到账）`,
            type: 'success'
        };
    }
    return {
        message: `检测到 ${code} 分红：${dividend.date}，每份${dividend.perShare}元，共${totalDividend}元，预计${arrivalDate}到账`,
        type: 'info'
    };
}

function addAutoDetectedDividend(item, code, dividend, todayStr) {
    const totalDividend = round2(item.shares * dividend.perShare);
    const arrivalDate = calculateDividendArrivalDate(dividend.date);
    const pendingAdjustments = ensurePendingAdjustments(item);
    const isArrived = arrivalDate < todayStr;

    pendingAdjustments.push({
        type: 'dividend',
        dividendAmount: totalDividend,
        perShare: dividend.perShare,
        dividendNavPrice: dividend.navPrice,
        dividendDate: dividend.date,
        targetDate: arrivalDate,
        orderDate: todayStr,
        status: isArrived ? 'confirmed' : 'pending',
        confirmedDate: isArrived ? todayStr : undefined,
        autoDetected: true
    });

    return buildAutoDividendNotification(code, dividend, totalDividend, arrivalDate, isArrived);
}

function ensureAutoDetectedDividendEntry(item, code, dividend, todayStr, notify = false) {
    if (!item || !dividend || !dividend.date || typeof dividend.perShare !== 'number' || !(dividend.perShare > 0)) {
        return false;
    }
    const shares = Number(item.shares) || 0;
    if (!(shares > 0)) {
        return false;
    }

    const pendingAdjustments = ensurePendingAdjustments(item);
    const existingDiv = pendingAdjustments.find(
        adj => isDividendType(adj.type) && adj.autoDetected === true && adj.dividendDate === dividend.date
    );
    if (existingDiv) {
        return false;
    }

    const notification = addAutoDetectedDividend(item, code, dividend, todayStr);
    if (notify) {
        notificationCenter.add(notification.message, notification.type);
    }
    return true;
}

function detectAutoDividends(funds, fetchedData, todayStr) {
    let dataChanged = false;

    for (const { code, live } of fetchedData) {
        if (!live?.dividendList?.length) continue;
        const item = funds[code];
        if (!item) continue;

        for (const dividend of live.dividendList) {
            if (!dividend || !dividend.date || typeof dividend.perShare !== 'number') {
                console.warn('跳过无效的分红记录:', dividend);
                continue;
            }

            const divDate = dividend.date;
            if (item.addedDate && divDate < item.addedDate) {
                continue;
            }

            if (ensureAutoDetectedDividendEntry(item, code, dividend, todayStr, true)) {
                dataChanged = true;
            }
        }
    }

    return dataChanged;
}

function getPendingAdjustments(item) {
    return Array.isArray(item?.pendingAdjustments) ? item.pendingAdjustments : [];
}

function sumPendingDividendAmount(pendingAdjustments) {
    return round2(
        pendingAdjustments.reduce((total, adj) => {
            if (isDividendType(adj.type) && adj.status === 'pending') {
                return total + (adj.dividendAmount || 0);
            }
            return total;
        }, 0)
    );
}

function sumPendingManualDividendAmount(pendingAdjustments) {
    return round2(
        pendingAdjustments.reduce((total, adj) => {
            if (isDividendType(adj.type) && adj.status === 'pending' && adj.autoDetected !== true) {
                return total + (adj.dividendAmount || 0);
            }
            return total;
        }, 0)
    );
}


function shouldAutoSettleFund(fund, live, dominantMarketPrevPriceDate = '') {
    if (!fund || !live || live.prevPrice <= 0 || !live.prevPriceDate) {
        return false;
    }
    if (dominantMarketPrevPriceDate && live.prevPriceDate !== dominantMarketPrevPriceDate) {
        return false;
    }
    const savedPrevDate = fund.savedPrevDate || '';
    return !savedPrevDate || live.prevPriceDate > savedPrevDate;
}

function buildSettlementEntry(code, live) {
    if (!live || live.prevPrice <= 0) return null;
    return {
        code,
        price: live.prevPrice,
        prevPriceDate: live.prevPriceDate,
        acNetValue: live.acNetValue,
        prevTradingDayPrice: live.prevTradingDayPrice || 0,
        prevTradingDayDate: live.prevTradingDayDate || '',
        dividendList: live.dividendList || []
    };
}

function collectAutoSettlementEntries(funds, fetchedData, dominantMarketPrevPriceDate = '') {
    const settlements = [];
    for (const { code, live } of fetchedData) {
        if (!shouldAutoSettleFund(funds[code], live, dominantMarketPrevPriceDate)) continue;
        const settlement = buildSettlementEntry(code, live);
        if (settlement) settlements.push(settlement);
    }
    return settlements;
}

async function saveSettlementState(funds, todayStr, autoSettlementBlockedDate = null, dailyProfitHistory = null) {
    const dataToSave = {
        myFunds: funds,
        lastSettlementDate: todayStr,
        autoSettlementBlockedDate,
        lastUpdateDate: todayStr
    };
    if (dailyProfitHistory) {
        dataToSave.dailyProfitHistory = normalizeDailyProfitHistory(dailyProfitHistory);
    }
    await storage.set(dataToSave);
}

// ==================== 1. 新增：统一的备份函数 ====================
/**
 * 执行结算前，先备份当前数据（每天只备份首次结算前的数据）
 * @returns {Promise<void>}
 */
async function backupFundsData(snapshot) {
    const todayStr = getToday();
    const funds = snapshot?.myFunds || {};
    const backupFunds = snapshot?.backupFunds;
    if (Object.keys(funds).length === 0) return;

    if (backupFunds && backupFunds.backupDate === todayStr) {
        console.log('[Backup] 今天已备份过，跳过');
        return;
    }

    const { settlementDate, blockedDate } = parseSettlementState(snapshot?.lastSettlementDate, snapshot?.autoSettlementBlockedDate);
    const backupData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        backupDate: todayStr,
        lastUpdateDate: snapshot?.lastUpdateDate || getToday(),
        lastDayProfits: snapshot?.lastDayProfits || {},
        lastSettlementDate: settlementDate,
        autoSettlementBlockedDate: blockedDate,
        myFunds: funds,
        dailyProfitHistory: normalizeDailyProfitHistory(snapshot?.dailyProfitHistory)
    };
    await storage.set({ backupFunds: backupData });
    console.log('[Backup] 数据已备份（首次）:', backupData);
}

/**
 * 检测基金分红并计算总收益
 * @param {Object} fund - 基金数据对象
 * @param {Object} priceUpdate - 价格更新数据 {price, acNetValue, prevPriceDate, dividendList}
 * @param {number} shares - 持有份额
 * @returns {{ dividendPerShare: number, hasDividend: boolean, totalPeriodProfit: number }}
 */
function detectDividendAndProfit(fund, priceUpdate, shares) {
    const { price, acNetValue, prevPriceDate, dividendList } = priceUpdate;

    // 安全的基础价格计算：确保不会出现除零或undefined错误
    let basePrice = fund.savedPrevPrice;
    if (!basePrice && shares > 0 && fund.amount > 0) {
        basePrice = fund.amount / shares;
    }
    if (!basePrice || basePrice <= 0) {
        basePrice = price; // fallback到当前价格
    }

    const baseAcNet = fund.savedAcNetValue || null;
    const savedPrevDate = fund.savedPrevDate || '';

    let dividendPerShare = 0;
    const acNetValid = (acNetValue && baseAcNet);

    // 1. 优先使用累计净值差检测分红 (最精准)
    if (acNetValid) {
        const navDiff = price - basePrice;
        const acDiff = acNetValue - baseAcNet;
        dividendPerShare = round6(acDiff - navDiff);
        if (dividendPerShare < CONSTANTS.DIVIDEND_MIN_THRESHOLD) {
            dividendPerShare = 0;
        }
    }
    // 2. 兜底方案：累计净值不可用时，从分红列表补回分红金额
    else if (dividendList && Array.isArray(dividendList) && dividendList.length > 0) {
        for (const div of dividendList) {
            if (div && div.date && div.perShare && div.date > savedPrevDate && div.date <= (prevPriceDate || '')) {
                dividendPerShare = round6(dividendPerShare + div.perShare);
            }
        }
    }

    const hasDividend = dividendPerShare > CONSTANTS.DIVIDEND_MIN_THRESHOLD;

    // 3. 计算区间总收益
    let totalPeriodProfit;
    if (acNetValid) {
        // 累计净值已经包含分红，直接计算
        totalPeriodProfit = round2(shares * (acNetValue - baseAcNet));
    } else {
        // 没有累计净值时：单位净值差额 + 派发的现金补偿
        totalPeriodProfit = round2(shares * (price - basePrice + dividendPerShare));
        if (dividendPerShare > 0) {
            console.log(`[结算] 补回区间分红每份 ${dividendPerShare}元 (${savedPrevDate}→${prevPriceDate})`);
        }
    }

    return { dividendPerShare, hasDividend, totalPeriodProfit };
}

/**
 * 结算核心逻辑（手动/自动共用）
 * @param {Object}  funds         - myFunds 对象（直接修改）
 * @param {Array}   priceUpdates  - 各基金最新价格数据
 *                                  [{code, price, prevPriceDate, acNetValue,
 *                                    prevTradingDayPrice, prevTradingDayDate,
 *                                    dividendList}]
 * @param {string}  todayStr      - YYYY-MM-DD
 * @returns {number} 实际更新的基金数量
 */
function _applySettlementLoop(funds, priceUpdates, todayStr) {
    let updatedCount = 0;
    for (const { code, price, prevPriceDate, acNetValue, prevTradingDayPrice, prevTradingDayDate, dividendList } of priceUpdates) {
        const item = funds[code];
        if (!item || price <= 0) continue;

        // ── 防护：shares 为 0 时从 amount 反推 ──────────────────────────────
        let shares = deriveFundShares(item, price);
        if (shares > 0 && !(item.shares > 0)) {
            funds[code].shares = shares;
        }

        // ── 无份额：仅更新净值锚点，不做任何收益计算 ────────────────────────
        if (shares <= 0) {
            funds[code].yesterdayProfit = 0;
            funds[code].savedPrevPrice = price;
            funds[code].savedPrevDate = prevPriceDate || todayStr;
            if (acNetValue) funds[code].savedAcNetValue = acNetValue;
            continue;
        }

        const baseAcNet = item.savedAcNetValue || null;

        // ── 分红检测与收益计算 ────────────────────────────────────────────────
        const { dividendPerShare, hasDividend, totalPeriodProfit } = detectDividendAndProfit(
            item,
            { price, acNetValue, prevPriceDate, dividendList },
            shares
        );

        const dividendMode = item.dividendMode || 'cash'; // 'cash' | 'reinvest'
        const totalDividend = hasDividend ? round2(shares * dividendPerShare) : 0;

        // 若结算层通过累计净值差识别到分红，但分红列表缺失导致未建单，
        // 在此兜底补一条自动分红订单，保证“收益修正”和“交易记录”一致。
        if (hasDividend && totalDividend > 0 && prevPriceDate) {
            ensureAutoDetectedDividendEntry(item, code, {
                date: prevPriceDate,
                perShare: dividendPerShare,
                navPrice: price
            }, todayStr, false);
        }

        // ── 单日昨日收益 ────────────────────────────────────────────────────────
        // 只要接口能提供上一笔有效净值，就按该净值差计算“昨日收益”。
        // 某些基金会因为停牌/节假日/接口缺口导致上一笔净值日期早于上一个自然日，
        // 此时仍应展示最近一个有效交易日对应的收益，而不是直接归 0。
        let yesterdayProfit = calculateYesterdayProfitValue(item, {
            price,
            prevPriceDate,
            prevTradingDayPrice,
            prevTradingDayDate
        });

        // 现金分红场景：昨日收益展示需要包含当日分红补偿，避免分红日出现误负值。
        // 分红入账由交易确认流程处理，这里只修正“昨日收益”的当日展示值。
        if (hasDividend && dividendMode === 'cash' && totalDividend > 0) {
            yesterdayProfit = round2(yesterdayProfit + totalDividend);
        }

        // ── 红利再投：增加份额 ────────────────────────────────────────────────
        if (hasDividend && dividendMode === 'reinvest' && price > 0) {
            const newShares = round6(totalDividend / price);
            shares = round6(shares + newShares);
            funds[code].shares = shares;
            console.log(`[分红-再投] ${code}: +${newShares}份 (派现${totalDividend}元 / 净值${price})`);
        }

        // ── 写回 ──────────────────────────────────────────────────────────────
        funds[code].holdProfit = round2((item.holdProfit || 0) + totalPeriodProfit);
        funds[code].yesterdayProfit = yesterdayProfit;
        funds[code].amount = round2(shares * price);
        funds[code].savedPrevPrice = price;
        funds[code].savedPrevDate = prevPriceDate || todayStr;
        if (acNetValue) {
            funds[code].savedAcNetValue = acNetValue;
        }

        if (hasDividend) {
            console.log(`[分红] ${code}: 每份${dividendPerShare.toFixed(4)}元, 共${totalDividend}元, 模式=${dividendMode}, 昨日收益=${yesterdayProfit}`);
        }

        updatedCount++;
    }
    return updatedCount;
}

// ==================== 2. 修改：手动日结算（增加备份步骤）====================
async function manualSettlement() {
    const ok = await showConfirm('确认进行日结算吗？\n系统将对比最新公布的净值与上次结算的净值，计算并记录收益。', '日结算确认');
    if (!ok) return;

    const todayStr = getToday();
    const { myFunds, lastUpdateDate, lastDayProfits, lastSettlementDate, autoSettlementBlockedDate, backupFunds, dailyProfitHistory } = await storage.get([
        'myFunds',
        'lastUpdateDate',
        'lastDayProfits',
        'lastSettlementDate',
        'autoSettlementBlockedDate',
        'backupFunds',
        'dailyProfitHistory'
    ]);
    const funds = myFunds || {};
    const { blockedDate } = parseSettlementState(lastSettlementDate, autoSettlementBlockedDate);

    elements.statusText.innerText = '正在备份数据...';
    await backupFundsData(createBackupSnapshot({
        myFunds: funds,
        lastUpdateDate,
        lastDayProfits,
        lastSettlementDate,
        autoSettlementBlockedDate,
        backupFunds,
        dailyProfitHistory
    }));
    elements.statusText.innerText = '正在执行日结算...';

    const codes = Object.keys(funds);
    const fetchedData = [];
    for (let i = 0; i < codes.length; i += CONFIG.BATCH_SIZE) {
        const batch = codes.slice(i, i + CONFIG.BATCH_SIZE);
        const batchResults = await fetchBatchLiveInfo(
            batch,
            CONFIG.API_TIMEOUT,
            code => ({ name: `[超时]${code}`, rate: 0, price: 0, prevPrice: 0 })
        );
        fetchedData.push(...batchResults);
        if (i + CONFIG.BATCH_SIZE < codes.length) {
            await new Promise(resolve => setTimeout(resolve, CONFIG.BATCH_DELAY));
        }
    }

    // 手动结算也必须先跑分红检测，确保交易记录里有自动分红单。
    detectAutoDividends(funds, fetchedData, todayStr);

    const settlements = [];
    for (const { code, live } of fetchedData) {
        const settlement = buildSettlementEntry(code, live);
        if (settlement) settlements.push(settlement);
    }

    const dominantMarketPrevPriceDate = getDominantMarketPrevPriceDate(fetchedData);
    const updatedCount = _applySettlementLoop(funds, settlements, todayStr);
    const { history: nextDailyProfitHistory } = recordDailyProfitHistory(dailyProfitHistory, funds, settlements, dominantMarketPrevPriceDate);

    await saveSettlementState(funds, todayStr, blockedDate === todayStr ? todayStr : null, nextDailyProfitHistory);
    showToast(`✅ 结算完成！已更新 ${updatedCount} 条`, 'success');
    checkBackup();
    loadData();
}

// ==================== 3. 修改：撤销结算（使用备份数据覆盖）====================
async function rollbackSettlement() {
    const { backupFunds } = await storage.get(['backupFunds']);
    if (!hasTodayBackup(backupFunds)) {
        await showAlert('未找到今天的备份数据，无法撤销！');
        return;
    }

    const backupTime = backupFunds.exportDate ? new Date(backupFunds.exportDate).toLocaleString() : '未知时间';
    const ok = await showConfirm(
        `确定要撤销日结算吗？\n\n数据将恢复至备份时间：\n【${backupTime}】\n\n⚠️ 重要提示：\n• 撤销后，今日将不再自动结算\n• 如需重新结算，请手动点击「📅 触发日结算」\n• 撤销前可导出当前数据用于对比`,
        '撤销确认',
        true
    );
    if (!ok) return;

    const todayStr = getToday();
    const { settlementDate } = parseSettlementState(backupFunds.lastSettlementDate, backupFunds.autoSettlementBlockedDate);
    await storage.set({
        myFunds: cloneData(backupFunds.myFunds),
        lastUpdateDate: backupFunds.lastUpdateDate || '',
        lastDayProfits: cloneData(backupFunds.lastDayProfits || {}),
        dailyProfitHistory: normalizeDailyProfitHistory(backupFunds.dailyProfitHistory),
        lastSettlementDate: settlementDate,
        autoSettlementBlockedDate: todayStr
    });
    showToast('✅ 已撤销结算，数据已恢复！今日不再自动结算，如需结算请手动触发。', 'success', 5000);
    checkBackup();
    loadData();
}

// ==================== 4. 自动结算部分（确保也有备份）====================
async function autoSettlement(funds, settlements, todayStr, backupSnapshot) {
    console.log('[autoSettlement] 检测到净值更新，开始自动结算...');
    elements.statusText.innerText = '正在自动结算...';

    await backupFundsData(backupSnapshot);
    const dominantMarketPrevPriceDate = getDominantMarketPrevPriceDate(settlements.map(settlement => ({ live: settlement })));
    const updatedCount = _applySettlementLoop(funds, settlements, todayStr);
    const { history: nextDailyProfitHistory } = recordDailyProfitHistory(backupSnapshot?.dailyProfitHistory, funds, settlements, dominantMarketPrevPriceDate);
    await saveSettlementState(funds, todayStr, null, nextDailyProfitHistory);

    if (updatedCount === 0) {
        console.log('[autoSettlement] 净值无变化，仅更新结算日期');
        return;
    }
    console.log('[autoSettlement] ✅ 完成，共更新 ' + updatedCount + ' 条');
    showToast('✅ 已自动完成日结算（' + updatedCount + ' 条）', 'success', 4000);
    checkBackup();
}


/**
 * 加载走势数据（从 storage 读取）
 * 只加载 activeCodes 中存在的基金，过滤掉已删除/导入前的残留数据和非今日数据。
 * @param {string[]} activeCodes - 当前 myFunds 中存在的基金代码列表
 */
async function loadFundHistoryData(activeCodes) {
    const todayStr = getToday();
    const activeSet = new Set(activeCodes);
    try {
        const { fundHistoryData: stored = {} } = await storage.get(['fundHistoryData']);
        let loaded = 0;
        for (const code in stored) {
            // 双重过滤：必须是今日数据 && 必须是当前基金列表里的
            if (stored[code].date === todayStr && activeSet.has(code)) {
                fundHistoryData[code] = stored[code];
                loaded++;
            }
        }
        console.log(`[走势数据] 已加载 ${loaded} 个基金的今日走势（当前共 ${activeCodes.length} 个基金）`);
    } catch (err) {
        console.warn('[走势数据] 加载失败:', err);
    }
}

/**
 * 持久化走势数据到 storage（优化：防抖，避免频繁写入）
 */
let saveFundHistoryTimer = null;
async function saveFundHistoryData() {
    if (saveFundHistoryTimer) clearTimeout(saveFundHistoryTimer);
    saveFundHistoryTimer = setTimeout(async () => {
        try {
            await storage.set({ fundHistoryData });
        } catch (err) {
            console.warn('[走势数据] 保存失败:', err);
        }
    }, 1000); // 1秒防抖
}

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', async () => {
    // DOM 元素引用（在 DOM 准备就绪后往 elements 对象嵌入）
    Object.assign(elements, {
        addBtn: document.getElementById('addBtn'),
        groupList: document.getElementById('groupList'),
        groupFilter: document.getElementById('groupFilter'),
        tableBody: document.getElementById('fundTableBody'),
        status: document.getElementById('status'),
        statusText: document.getElementById('statusText'),
        selectionStatus: document.getElementById('selectionStatus'),
        fullscreenBtn: document.getElementById('fullscreenBtn'),
        refreshControl: document.getElementById('refreshControl'),
        refreshBtn: document.getElementById('refreshBtn'),
        refreshBtnText: document.getElementById('refreshBtnText'),
        refreshBtnIcon: document.getElementById('refreshBtnIcon'),
        refreshIntervalSelect: document.getElementById('refreshIntervalSelect'),
        marketTicker: document.getElementById('marketTicker'),
        marketTickerTrack: document.getElementById('marketTickerTrack'),
        notificationBtn: document.getElementById('notificationBtn'),
        columnConfigBtn: document.getElementById('columnConfigBtn'),
        columnConfigPanel: document.getElementById('columnConfigPanel'),
        totalAmount: document.getElementById('totalAmount'),
        totalTodayProfit: document.getElementById('totalTodayProfit'),
        totalTotalProfit: document.getElementById('totalTotalProfit'),
        totalYesterdayProfit: document.getElementById('totalYesterdayProfit'),
        exportBtn: document.getElementById('exportBtn'),
        importBtn: document.getElementById('importBtn'),
        importFile: document.getElementById('importFile'),
        modalOverlay: document.getElementById('modalOverlay'),
        modalTitle: document.getElementById('modalTitle'),
        modalMsg: document.getElementById('modalMsg'),
        modalInput: document.getElementById('modalInput'),
        modalFooter: document.getElementById('modalFooter'),
        toastContainer: document.getElementById('toastContainer'),
        batchGroupBtn: document.getElementById('batchGroupBtn'),
        batchClearBtn: document.getElementById('batchClearBtn'),
        profitCalendarBtn: document.getElementById('profitCalendarBtn'),
    });

    // 初始化通知中心
    await notificationCenter.init();

    elements.addBtn.onclick = () => openFundEditor(null);
    if (elements.batchGroupBtn) elements.batchGroupBtn.onclick = () => batchChangeGroup();
    if (elements.batchClearBtn) elements.batchClearBtn.onclick = () => batchClearPositions();
    elements.exportBtn.onclick = exportFundsData;
    elements.importBtn.onclick = () => elements.importFile.click();
    if (elements.profitCalendarBtn) elements.profitCalendarBtn.onclick = () => openProfitCalendar();

    // 绑定通知中心按钮
    if (elements.notificationBtn) {
        elements.notificationBtn.onclick = () => notificationCenter.show();
    }
    if (elements.modalOverlay) {
        elements.modalOverlay.onclick = (e) => {
            if (e.target === elements.modalOverlay) {
                dismissModal();
            }
        };
    }

    const isPopup = chrome.extension.getViews({ type: 'popup' }).includes(window);
    if (!isPopup) document.body.classList.add('is-fullscreen');

    checkBackup();
    await restoreAutoRefreshInterval();
    await initColumnVisibility();
    renderMarketBreadthTicker();
    resetAutoRefreshCountdown();
    ensureRefreshCountdownTimer();
    triggerUnifiedRefresh('initial');

    elements.importFile.addEventListener('change', importFundsData);
    initFabMenu();

    elements.fullscreenBtn.onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });

    elements.refreshBtn.onclick = () => {
        triggerUnifiedRefresh('manual');
    };
    if (elements.refreshIntervalSelect) {
        elements.refreshIntervalSelect.onchange = () => {
            handleRefreshIntervalChange();
        };
    }

    elements.groupFilter.onchange = () => {
        clearSelection();

        renderTable();
    };

    document.querySelectorAll('.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const field = th.dataset.sort;
            if (sortField === field) {
                sortDirection *= -1;
            } else {
                sortField = field;
                sortDirection = -1;
            }
            renderTable();
        });
    });

    // 基金详情弹窗关闭按钮
    const fundDetailClose = document.getElementById('fundDetailClose');
    const fundDetailFitBtn = document.getElementById('fundDetailFitBtn');
    const fundDetailOverlay = document.getElementById('fundDetailOverlay');
    if (fundDetailClose) {
        fundDetailClose.onclick = closeFundDetail;
    }
    if (fundDetailFitBtn) {
        fundDetailFitBtn.onclick = toggleFundDetailFitPage;
    }
    if (fundDetailOverlay) {
        fundDetailOverlay.onclick = (e) => {
            if (e.target === fundDetailOverlay) {
                closeFundDetail();
            }
        };
    }
});


// ==================== 新浪行情代理请求（优化：添加超时和错误处理）====================
function proxyFetchSina(url, timeout = 5000) {
    apiLogger.log('新浪代理', url, '发起请求');
    return new Promise((resolve) => {
        let resolved = false;
        const timer = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                apiLogger.log('新浪代理', url, '请求超时');
                resolve(null);
            }
        }, timeout);

        chrome.runtime.sendMessage({ type: 'FETCH_SINA', url: url }, (response) => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timer);

            if (chrome.runtime.lastError) {
                apiLogger.log('新浪代理', url, `运行时错误: ${chrome.runtime.lastError.message}`);
                resolve(null);
                return;
            }

            if (response && response.success && response.data) {
                const content = response.data.match(/"([^"]*)"/s);
                const result = content ? content[1] : null;
                if (result) {
                    apiLogger.log('新浪代理', url, '成功获取数据');
                } else {
                    apiLogger.log('新浪代理', url, '返回数据格式无效');
                }
                resolve(result);
            } else {
                apiLogger.log('新浪代理', url, '请求失败或无响应');
                resolve(null);
            }
        });
    });
}
// ==================== 综合行情接口 ====================

/**
 * 批量获取基金实时信息
 * @param {string[]} codes   - 基金代码数组
 * @param {number}   timeout - 超时时间（毫秒）
 * @param {object|Function} fallback - 超时时的默认返回值，或接受 code 返回默认值的函数
 * @returns {Promise<Array<{code: string, live: object}>>}
 */
async function fetchBatchLiveInfo(codes, timeout = CONFIG.API_TIMEOUT, fallback = null) {
    return Promise.all(
        codes.map(code => {
            const fb = typeof fallback === 'function' ? fallback(code) : fallback;
            return withTimeout(fetchLiveInfo(code), timeout, fb)
                .then(live => ({ code, live }));
        })
    );
}

async function fetchLiveInfo(code) {
    const cleanCode = code.trim();
    if (/^\d{6}$/.test(cleanCode)) {
        // 1. 场外基金（主接口）
        // 【修复】将 url 定义提到 try 外面
        const url1 = `https://fundgz.1234567.com.cn/js/${cleanCode}.js?rt=${Date.now()}`;
        let mainResult = null;
        try {
            apiLogger.log('场外主接口', url1, '发起请求');
            const res = await fetch(url1);
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            }
            const text = await res.text();
            const jsonMatch = text.match(/jsonpgz\((.*)\)/);
            if (jsonMatch) {
                const d = JSON.parse(jsonMatch[1]);
                if (d && (d.gsz || d.dwjz)) {
                    const dwjz = parseFloat(d.dwjz) || 0;
                    const gsz = parseFloat(d.gsz || d.dwjz) || 0;
                    const gszzl = parseFloat(d.gszzl) || 0;
                    const gztime = d.gztime || '';
                    apiLogger.log('场外主接口', url1, '成功');
                    mainResult = {
                        name: d.name || `[未知]${cleanCode}`,
                        rate: gszzl,
                        price: gsz,
                        prevPrice: dwjz,
                        prevPriceDate: d.jzrq || '',
                        priceTime: gztime
                    };
                }
            }
            if (!mainResult) {
                apiLogger.log('场外主接口', url1, '数据无效(尝试备用)');
            }
        } catch (e) {
            apiLogger.log('场外主接口', url1, `请求异常(${e.message})`);
        }
        // 1.5 场外基金备用接口（用于检测分红）
        // 【修复】将 url 定义提到 try 外面
        const url2 = `https://fund.eastmoney.com/pingzhongdata/${cleanCode}.js?v=${Date.now()}`;
        try {
            apiLogger.log('场外备用接口', url2, '发起请求');
            const res2 = await fetch(url2);
            if (!res2.ok) {
                throw new Error(`HTTP ${res2.status}: ${res2.statusText}`);
            }
            const extData = await res2.text();
            if (extData && extData.includes('fS_name')) {
                const nameMatch = extData.match(/fS_name\s*=\s*"([^"]+)"/);
                const name = nameMatch ? nameMatch[1] : `[场外备用]${cleanCode}`;
                const netWorthMatch = extData.match(/Data_netWorthTrend\s*=\s*(\[[\s\S]*?\])\s*;/);
                if (netWorthMatch) {
                    const netWorthData = JSON.parse(netWorthMatch[1]);
                    if (netWorthData && netWorthData.length >= 2) {
                        const latest = netWorthData[netWorthData.length - 1];
                        const prev = netWorthData[netWorthData.length - 2]; // 前一交易日
                        const gsz = parseFloat(latest.y) || 0;
                        // 备用接口：price 和 prevPrice 都用最新净值（gsz），
                        // 实际昨日收益由 prevTradingDayPrice（prev.y）与 price 之差在结算层计算，
                        // 此处 prevPrice 仅作占位，不参与结算收益计算。
                        const dwjz = gsz;
                        const dateStr = latest.x ? timestampToDate(latest.x) : '';
                        const prevTradingDayPrice = parseFloat(prev.y) || 0;
                        const prevTradingDayDate = prev.x ? timestampToDate(prev.x) : '';

                        // 检测分红信息（检查最近N条数据）
                        const dividendList = [];
                        const recentData = netWorthData.slice(-CONSTANTS.HISTORY_DAYS_LIMIT);
                        for (const item of recentData) {
                            if (item.unitMoney && item.unitMoney.includes('分红')) {
                                const match = item.unitMoney.match(/([0-9.]+)元/);
                                if (match) {
                                    const divDate = item.x ? timestampToDate(item.x) : '';
                                    dividendList.push({
                                        perShare: parseFloat(match[1]),
                                        date: divDate,
                                        navPrice: parseFloat(item.y) || 0,  // 分红日净值
                                        desc: item.unitMoney
                                    });
                                }
                            }
                        }

                        // 提取累计净值（用于准确计算收益）
                        let acNetValue = null;
                        const acMatch = extData.match(/Data_ACWorthTrend\s*=\s*(\[[\s\S]*?\]);/);
                        if (acMatch) {
                            try {
                                const acData = JSON.parse(acMatch[1]);
                                if (acData && acData.length > 0) {
                                    const latestAC = acData[acData.length - 1];
                                    acNetValue = parseFloat(latestAC[1]) || null;
                                } else {
                                    acNetValue = null; // 明确标记：数据为空
                                }
                            } catch (e) {
                                console.warn('解析累计净值失败:', e);
                                acNetValue = null; // 明确标记：解析失败
                            }
                        }

                        apiLogger.log('场外备用接口', url2, '成功');
                        const fallbackResult = {
                            name,
                            rate: null,
                            price: gsz,
                            prevPrice: dwjz,
                            prevPriceDate: dateStr,
                            prevTradingDayPrice,
                            prevTradingDayDate,
                            acNetValue,
                            dividendList,
                            isFallback: true
                        };
                        if (mainResult) {
                            mainResult.acNetValue = acNetValue;
                            mainResult.dividendList = dividendList;
                            mainResult.prevTradingDayPrice = prevTradingDayPrice;
                            mainResult.prevTradingDayDate = prevTradingDayDate;

                            if (fallbackResult.prevPriceDate && (!mainResult.prevPriceDate || fallbackResult.prevPriceDate > mainResult.prevPriceDate)) {
                                mainResult.prevPrice = fallbackResult.prevPrice;
                                mainResult.prevPriceDate = fallbackResult.prevPriceDate;
                            }

                            return mainResult;
                        }
                        return fallbackResult;
                    }
                }
            }
            apiLogger.log('场外备用接口', url2, '数据无效');
        } catch (e) {
            apiLogger.log('场外备用接口', url2, `请求异常(${e.message})`);
        }

        // 如果主接口有数据，返回主接口数据（可能已合并分红信息）
        if (mainResult) {
            return mainResult;
        }

        // 2. 场内基金（ETF/LOF）
        try {
            const p = cleanCode.startsWith('5') ? 'sh' : 'sz';
            const url = `https://hq.sinajs.cn/list=${p}${cleanCode}`;
            // proxyFetchSina 内部已经有日志了，这里不需要重复加
            const data = await proxyFetchSina(url);
            if (data && typeof data === 'string') {
                const parts = data.split(',');
                if (parts.length > 10) {
                    const cur = parseFloat(parts[3]);
                    const pre = parseFloat(parts[2]);

                    // 验证解析出的数值是否有效
                    if (!isNaN(cur) && !isNaN(pre) && cur > 0 && pre > 0) {
                        const rate = round2((cur - pre) / pre * 100);
                        return {
                            name: '[场]' + (parts[0] || cleanCode),
                            rate: rate,
                            price: cur,
                            prevPrice: pre
                        };
                    }
                }
            }
        } catch (e) {
            console.warn(`场内基金解析失败 ${cleanCode}:`, e);
        }
    }
    // 3. 期货
    try {
        const url = `https://hq.sinajs.cn/list=nf_${cleanCode.toUpperCase()}`;
        // proxyFetchSina 内部已经有日志了
        const fut = await proxyFetchSina(url);
        if (fut && typeof fut === 'string') {
            const parts = fut.split(',');
            if (parts.length > 10) {
                const cur = parseFloat(parts[8]);
                const pre = parseFloat(parts[5]);

                // 验证解析出的数值是否有效
                if (!isNaN(cur) && !isNaN(pre) && cur > 0 && pre > 0) {
                    const rate = round2((cur - pre) / pre * 100);
                    return {
                        name: '[期]' + (parts[0] || cleanCode),
                        rate: rate,
                        price: cur,
                        prevPrice: pre
                    };
                }
            }
        }
    } catch (e) {
        console.warn(`期货解析失败 ${cleanCode}:`, e);
    }
    return {
        name: `[未知]${cleanCode}`,
        rate: 0,
        price: 0,
        prevPrice: 0
    };
}

// 请求超时包装：超过 ms 仍无响应则返回 fallback
function withTimeout(promise, ms, fallback) {
    const timer = new Promise(r => setTimeout(() => r(fallback), ms));
    return Promise.race([promise, timer]);
}

function getMarketTickerContent(data) {
    return `
        <span class="market-ticker-item is-limit-up"><span class="market-ticker-label">涨停</span><span class="market-ticker-value">${data.limitUp}</span></span>
        <span class="market-ticker-item is-up"><span class="market-ticker-label">涨</span><span class="market-ticker-value">${data.up}</span></span>
        <span class="market-ticker-item is-down"><span class="market-ticker-label">跌</span><span class="market-ticker-value">${data.down}</span></span>
        <span class="market-ticker-item is-limit-down"><span class="market-ticker-label">跌停</span><span class="market-ticker-value">${data.limitDown}</span></span>
    `;
}

function renderMarketBreadthTicker(data = marketBreadthData, unavailable = false) {
    if (!elements.marketTicker || !elements.marketTickerTrack) return;

    if (!data) {
        const text = unavailable ? '市场广度暂不可用' : '市场广度加载中...';
        elements.marketTicker.classList.add('is-unavailable');
        elements.marketTickerTrack.innerHTML = `
            <div class="market-ticker-copy"><span class="market-ticker-empty">${text}</span></div>
        `;
        return;
    }

    const content = getMarketTickerContent(data);
    elements.marketTicker.classList.remove('is-unavailable');
    elements.marketTickerTrack.innerHTML = `
        <div class="market-ticker-copy">${content}</div>
    `;
}

function getAutoRefreshIntervalSeconds() {
    return Math.max(1, Math.round(autoRefreshIntervalMs / 1000));
}

function getAutoRefreshPauseCutoff(now = new Date()) {
    return new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        CONFIG.AUTO_REFRESH_PAUSE_HOUR,
        CONFIG.AUTO_REFRESH_PAUSE_MINUTE,
        0,
        0
    );
}

function isAutoRefreshPaused(now = new Date()) {
    return now >= getAutoRefreshPauseCutoff(now);
}

function syncRefreshIntervalSelect() {
    if (!elements.refreshIntervalSelect) return;
    elements.refreshIntervalSelect.value = String(getAutoRefreshIntervalSeconds());
    elements.refreshIntervalSelect.disabled = Boolean(unifiedRefreshPromise);

    if (elements.refreshControl) {
        elements.refreshControl.classList.toggle('is-disabled', Boolean(unifiedRefreshPromise));
    }
}

function getNextAutoRefreshAt(now = Date.now()) {
    return isAutoRefreshPaused(new Date(now)) ? 0 : now + autoRefreshIntervalMs;
}

function updateRefreshButtonState(now = Date.now()) {
    if (!elements.refreshBtn) return;

    const currentTime = new Date(now);
    const pauseTimeLabel = formatTime(getAutoRefreshPauseCutoff(currentTime));
    syncRefreshIntervalSelect();
    const intervalSeconds = getAutoRefreshIntervalSeconds();
    const isRefreshing = Boolean(unifiedRefreshPromise);
    const isPaused = !isRefreshing && isAutoRefreshPaused(currentTime);
    const remainingMs = isRefreshing
        ? autoRefreshIntervalMs
        : (nextAutoRefreshAt ? Math.max(0, nextAutoRefreshAt - now) : autoRefreshIntervalMs);
    const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    const progress = isPaused
        ? 0
        : (autoRefreshIntervalMs > 0 ? Math.max(0, Math.min(1, remainingMs / autoRefreshIntervalMs)) : 0);

    if (elements.refreshControl) {
        elements.refreshControl.classList.toggle('is-refreshing', isRefreshing);
        elements.refreshControl.classList.toggle('is-low', !isRefreshing && !isPaused && progress <= 0.2);
        elements.refreshControl.classList.toggle('is-medium', !isRefreshing && !isPaused && progress > 0.2 && progress <= 0.5);
        elements.refreshControl.classList.toggle('is-empty', !isRefreshing && (isPaused || progress <= 0.02));
        elements.refreshControl.style.setProperty('--refresh-progress', String(isRefreshing ? 1 : progress));
    }

    if (isRefreshing) {
        elements.refreshBtn.classList.add('spinning');
        elements.refreshBtn.title = `正在刷新行情（当前自动刷新 ${intervalSeconds} 秒）`;
        elements.refreshBtn.setAttribute('aria-label', `正在刷新行情，当前自动刷新 ${intervalSeconds} 秒`);
        if (elements.refreshBtnText) elements.refreshBtnText.textContent = '刷新中';
        return;
    }

    elements.refreshBtn.classList.remove('spinning');

    if (isPaused) {
        elements.refreshBtn.title = `自动刷新已暂停至明日开盘前后恢复，暂停时间 ${pauseTimeLabel} 后`;
        elements.refreshBtn.setAttribute('aria-label', `自动刷新已在 ${pauseTimeLabel} 后暂停，仍可手动刷新`);
        if (elements.refreshBtnText) elements.refreshBtnText.textContent = '已暂停';
        return;
    }

    elements.refreshBtn.title = `刷新行情（${remainingSeconds} 秒后自动刷新，当前 ${intervalSeconds} 秒，${pauseTimeLabel} 后自动暂停）`;
    elements.refreshBtn.setAttribute('aria-label', `刷新行情，${remainingSeconds} 秒后自动刷新，当前自动刷新 ${intervalSeconds} 秒，${pauseTimeLabel} 后自动暂停`);
    if (elements.refreshBtnText) elements.refreshBtnText.textContent = `${remainingSeconds}s`;
}

function resetAutoRefreshCountdown(now = Date.now()) {
    nextAutoRefreshAt = getNextAutoRefreshAt(now);
    updateRefreshButtonState(now);
}

async function setAutoRefreshInterval(seconds, { silent = false, resetCountdown = true } = {}) {
    const normalizedSeconds = Number(seconds);
    if (!CONFIG.AUTO_REFRESH_OPTIONS.includes(normalizedSeconds)) {
        return false;
    }

    autoRefreshIntervalMs = normalizedSeconds * 1000;
    if (resetCountdown) {
        resetAutoRefreshCountdown();
    } else {
        nextAutoRefreshAt = getNextAutoRefreshAt();
        updateRefreshButtonState();
    }

    try {
        await storage.set({ [CONFIG.AUTO_REFRESH_STORAGE_KEY]: normalizedSeconds });
    } catch (error) {
        console.warn('[refresh] 保存自动刷新间隔失败:', error);
    }

    if (!silent) {
        showToast(`自动刷新已切换为 ${normalizedSeconds} 秒`, 'success', CONFIG.TOAST_SHORT);
    }

    return true;
}

async function restoreAutoRefreshInterval() {
    try {
        const result = await storage.get([CONFIG.AUTO_REFRESH_STORAGE_KEY]);
        const savedSeconds = Number(result?.[CONFIG.AUTO_REFRESH_STORAGE_KEY]);
        if (CONFIG.AUTO_REFRESH_OPTIONS.includes(savedSeconds)) {
            autoRefreshIntervalMs = savedSeconds * 1000;
        }
    } catch (error) {
        console.warn('[refresh] 读取自动刷新间隔失败:', error);
    }

    syncRefreshIntervalSelect();
}

async function handleRefreshIntervalChange() {
    if (!elements.refreshIntervalSelect) return;

    const changed = await setAutoRefreshInterval(elements.refreshIntervalSelect.value);
    if (!changed) {
        syncRefreshIntervalSelect();
    }
}

function ensureRefreshCountdownTimer() {
    if (refreshCountdownTimer) return;

    refreshCountdownTimer = setInterval(() => {
        const now = Date.now();
        updateRefreshButtonState(now);
        if (!unifiedRefreshPromise && nextAutoRefreshAt && now >= nextAutoRefreshAt) {
            triggerUnifiedRefresh('auto');
            return;
        }
        if (!unifiedRefreshPromise && !nextAutoRefreshAt && isAutoRefreshPaused(new Date(now))) {
            clearInterval(refreshCountdownTimer);
            refreshCountdownTimer = null;
        }
    }, 1000);
}

async function fetchMarketBreadth() {
    const quoteUrl = 'https://push2.eastmoney.com/api/qt/ulist.np/get?secids=1.000001,0.399001&ut=bd1d9ddb04089700cf9c27f6f7426281&invt=2&fields=f14,f12,f13,f104,f105,f106';
    const changesUrl = 'https://push2ex.eastmoney.com/getStockCountChanges?type=4,8&ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wzchanges';

    const [quoteData, changesData] = await Promise.all([
        withTimeout(
            fetch(quoteUrl)
                .then(async res => {
                    if (!res.ok) throw new Error(`quote HTTP ${res.status}`);
                    return res.json();
                })
                .catch(() => null),
            CONFIG.MARKET_BREADTH_TIMEOUT,
            null
        ),
        withTimeout(
            fetch(changesUrl)
                .then(async res => {
                    if (!res.ok) throw new Error(`changes HTTP ${res.status}`);
                    return res.json();
                })
                .catch(() => null),
            CONFIG.MARKET_BREADTH_TIMEOUT,
            null
        )
    ]);

    if (!quoteData || quoteData.rc !== 0 || !Array.isArray(quoteData.data?.diff)) {
        throw new Error('上涨下跌家数接口不可用');
    }
    if (!changesData || changesData.rc !== 0 || !Array.isArray(changesData.data?.ydlist)) {
        throw new Error('涨跌停家数接口不可用');
    }

    const up = quoteData.data.diff.reduce((sum, item) => sum + (Number(item.f104) || 0), 0);
    const down = quoteData.data.diff.reduce((sum, item) => sum + (Number(item.f105) || 0), 0);
    const limitUp = Number(changesData.data.ydlist.find(item => Number(item.t) === 4)?.ct) || 0;
    const limitDown = Number(changesData.data.ydlist.find(item => Number(item.t) === 8)?.ct) || 0;

    return { limitUp, up, down, limitDown };
}

async function refreshMarketBreadth() {
    try {
        const data = await fetchMarketBreadth();
        marketBreadthData = data;
        renderMarketBreadthTicker(data);
        return data;
    } catch (error) {
        console.warn('[marketBreadth] 刷新失败:', error);
        renderMarketBreadthTicker(marketBreadthData, !marketBreadthData);
        return marketBreadthData;
    }
}

async function triggerUnifiedRefresh(source = 'manual') {
    if (unifiedRefreshPromise) {
        return unifiedRefreshPromise;
    }

    console.log(`[refresh] 触发统一刷新: ${source}`);
    unifiedRefreshPromise = (async () => {
        updateRefreshButtonState();
        await Promise.allSettled([
            loadData(),
            refreshMarketBreadth()
        ]);
        resetAutoRefreshCountdown();
    })().finally(() => {
        unifiedRefreshPromise = null;
        updateRefreshButtonState();
    });

    updateRefreshButtonState();
    return unifiedRefreshPromise;
}

window.addEventListener('beforeunload', () => {
    if (refreshCountdownTimer) {
        clearInterval(refreshCountdownTimer);
        refreshCountdownTimer = null;
    }
});

// ==================== 加载数据 ====================
let _loadDataPromise = null; // 并发保护：使用 Promise 队列
async function loadData() {
    if (_loadDataPromise) {
        console.log('[loadData] 等待上次调用完成...');
        return _loadDataPromise;
    }

    _loadDataPromise = _loadDataImpl()
        .finally(() => {
            _loadDataPromise = null;
        });

    return _loadDataPromise;
}

async function _loadDataImpl() {
    try {
        clearSelection();
        elements.statusText.innerText = '同步行情中...';
        apiLogger.reset();

        const storageState = await storage.get([
            'myFunds',
            'lastSettlementDate',
            'lastDayProfits',
            'lastUpdateDate',
            'autoSettlementBlockedDate',
            'dailyProfitHistory'
        ]);
        const {
            myFunds,
            lastSettlementDate,
            lastDayProfits,
            lastUpdateDate,
            autoSettlementBlockedDate,
            dailyProfitHistory
        } = storageState;
        let funds = myFunds || {};
        const codes = Object.keys(funds);
        let dataChanged = false;
        const results = [];
        const todayStr = getToday();

        // 走势数据懒加载：首次调用时从 storage 读取，只加载当前基金列表里的数据
        // 后续刷新时 fundHistoryData 已在内存中，跳过重复读取
        if (Object.keys(fundHistoryData).length === 0 && codes.length > 0) {
            await loadFundHistoryData(codes);
        }

        // 1. 获取行情数据 - 优化：批量并发请求
        const fetchedData = [];
        for (let i = 0; i < codes.length; i += CONFIG.BATCH_SIZE) {
            const batch = codes.slice(i, i + CONFIG.BATCH_SIZE);
            const batchResults = await fetchBatchLiveInfo(
                batch,
                CONFIG.API_TIMEOUT,
                code => ({ name: `[超时]${code}`, rate: 0, price: 0, prevPrice: 0 })
            );
            fetchedData.push(...batchResults);
            // 批次间短暂延迟，避免请求过于密集
            if (i + CONFIG.BATCH_SIZE < codes.length) {
                await new Promise(resolve => setTimeout(resolve, CONFIG.BATCH_DELAY));
            }
        }

        const dominantMarketPrevPriceDate = getDominantMarketPrevPriceDate(fetchedData);

        // 2. 先检测分红（在自动结算之前）
        dataChanged = detectAutoDividends(funds, fetchedData, todayStr) || dataChanged;

        // 3. 自动结算逻辑（在分红检测之后）
        // 修复：同一天内如果有基金晚到更新，仍允许继续补结算；
        // 只有“今日已执行撤销”时才整天禁止自动结算。
        const { blockedDate } = parseSettlementState(lastSettlementDate, autoSettlementBlockedDate);
        const isRollbackToday = blockedDate === todayStr;
        if (!isRollbackToday) {
            const autoSettlementEntries = collectAutoSettlementEntries(funds, fetchedData, dominantMarketPrevPriceDate);
            if (autoSettlementEntries.length > 0) {
                const { backupFunds } = await storage.get(['backupFunds']);
                const settlementSnapshot = createBackupSnapshot({
                    myFunds: funds,
                    lastUpdateDate,
                    lastDayProfits,
                    lastSettlementDate,
                    autoSettlementBlockedDate,
                    backupFunds,
                    dailyProfitHistory
                });
                await autoSettlement(funds, autoSettlementEntries, todayStr, settlementSnapshot);
            }
        }

        // 4. 处理数据 & 自动确认份额
        // 收集所有确认的交易，最后合并通知
        const confirmedTransactions = buildConfirmedTransactionsState();

        for (const { code, live } of fetchedData) {
            if (live && live.prevPrice > 0) {
                const item = funds[code];

                // 兜底：若已检测到分红提示但交易记录里还没有对应自动分红单，则在渲染前补齐。
                // 不重复发通知，仅保证 pendingAdjustments 与分红提示一致。
                if (item && Array.isArray(live.dividendList) && live.dividendList.length > 0) {
                    for (const dividend of live.dividendList) {
                        if (!dividend || !dividend.date || typeof dividend.perShare !== 'number') {
                            continue;
                        }
                        if (item.addedDate && dividend.date < item.addedDate) {
                            continue;
                        }
                        if (ensureAutoDetectedDividendEntry(item, code, dividend, todayStr, false)) {
                            dataChanged = true;
                        }
                    }
                }

                const pendingAdjustments = getPendingAdjustments(item);

                // --- A. 处理待确认份额（加仓/减仓/分红）---
                if (pendingAdjustments.length > 0) {
                    for (const adj of pendingAdjustments) {
                        if (adj.status === 'confirmed') continue;
                        if (todayStr >= adj.targetDate) {
                            if (adj.type === 'add') {
                                const actualRate = (adj.feeRate || 0) / 100;
                                const price = live.prevPrice;
                                if (price > 0) {
                                    const deltaShares = (adj.amount * (1 - actualRate)) / price;
                                    item.shares = round6(item.shares + deltaShares);
                                    item.amount = round2(item.shares * price);
                                    adj.status = 'confirmed';
                                    adj.confirmedPrice = price;
                                    adj.confirmedShares = round6(deltaShares);
                                    adj.confirmedDate = todayStr;
                                    // 收集确认信息，不立即弹 toast
                                    confirmedTransactions.add.push({ code, shares: adj.confirmedShares, price });
                                    dataChanged = true;
                                }
                            } else if (adj.type === 'remove') {
                                const price = live.prevPrice;
                                if (price > 0) {
                                    item.shares = round6(item.shares - adj.shares);
                                    if (item.shares < 0) item.shares = 0;
                                    item.amount = round2(item.shares * price);
                                    // 赎回手续费：按卖出金额扣减，计入累计收益（成本）
                                    const fee = round2(adj.shares * price * ((adj.feeRate || 0) / 100));
                                    if (fee > 0) {
                                        item.holdProfit = round2((item.holdProfit || 0) - fee);
                                    }
                                    adj.status = 'confirmed';
                                    adj.confirmedPrice = price;
                                    adj.confirmedShares = adj.shares;
                                    adj.confirmedDate = todayStr;
                                    // 收集确认信息，不立即弹 toast
                                    confirmedTransactions.remove.push({ code, shares: adj.shares, price, fee });
                                    dataChanged = true;
                                }
                            } else if (adj.type === 'dividend') {
                                // 现金分红确认：
                                // autoDetected 分红由结算层（累计净值差）统一处理，确认时一律跳过手动计入，
                                // 避免结算层与确认层双重计算。
                                // 只有用户手动创建的分红（autoDetected 不为 true）才需要在此计入 holdProfit。
                                if (!adj.autoDetected) {
                                    item.holdProfit = round2((item.holdProfit || 0) + adj.dividendAmount);
                                    console.log(`[分红确认] ${code}: 手动分红计入 ${adj.dividendAmount} 元`);
                                } else {
                                    console.log(`[分红确认] ${code}: 自动检测分红，由结算层处理，跳过`);
                                }
                                adj.status = 'confirmed';
                                adj.confirmedDate = todayStr;
                                // 收集确认信息，不立即弹 toast
                                confirmedTransactions.dividend.push({ code, amount: adj.dividendAmount, date: adj.targetDate });
                                dataChanged = true;
                            } else if (adj.type === 'dividend_reinvest') {
                                // 红利再投：份额增加，累计收益不变
                                const reinvestPrice = adj.dividendNavPrice || live.prevPrice;
                                const deltaShares = round6(adj.dividendAmount / reinvestPrice);
                                item.shares = round6(item.shares + deltaShares);
                                item.amount = round2(item.shares * live.prevPrice);
                                adj.status = 'confirmed';
                                adj.confirmedPrice = reinvestPrice;
                                adj.confirmedShares = deltaShares;
                                adj.confirmedDate = todayStr;
                                // 收集确认信息，不立即弹 toast
                                confirmedTransactions.dividend_reinvest.push({ code, shares: deltaShares, price: reinvestPrice });
                                dataChanged = true;
                            }
                        }
                    }
                }
                // --- B. 原有份额修正逻辑 ---
                if (!item.shares && item.amount > 0) {
                    const derivedShares = deriveFundShares(item, live.prevPrice, live.price);
                    if (derivedShares > 0) {
                        item.shares = derivedShares;
                        dataChanged = true;
                    }
                }
                // --- C. 收益计算 ---
                let todayProfit, useFallbackNav = false;

                if (!live.isFallback && live.price > 0) {
                    // 交易时段：用估值与昨日净值的差计算当日浮动
                    todayProfit = item.shares ? round2(item.shares * (live.price - live.prevPrice)) : 0;
                } else if (live.prevPrice > 0 && item.savedPrevPrice > 0) {
                    // 非交易时段：用净值差（已含分红调整，由结算层保证正确性）
                    todayProfit = item.shares ? round2(item.shares * (live.prevPrice - item.savedPrevPrice)) : 0;
                    useFallbackNav = true;
                } else {
                    todayProfit = null;
                }
                const totalProfit = round2((item.holdProfit || 0) + (todayProfit || 0));

                // --- D. 计算待确认分红金额（pending 状态的分红） ---
                const pendingDividendAmount = sumPendingDividendAmount(pendingAdjustments);

                // --- E. 构造结果集 ---
                // 分红期间：持仓金额展示包含待确认分红；昨日收益展示值会补回
                // 1) 手动创建且待确认的分红；
                // 2) 与当前 prevPriceDate 对应的自动检测分红（避免接口分红日出现误负值）。
                const displayAmount = round2((item.amount || 0) + pendingDividendAmount);
                const displayYesterdayProfit = getDisplayedFreshYesterdayProfitValue(item, live, dominantMarketPrevPriceDate);

                results.push({
                    code,
                    name: live.name,
                    amount: displayAmount,
                    yesterdayProfit: displayYesterdayProfit,
                    group: item.group || '默认',
                    rate: live.rate,
                    prevPrice: live.prevPrice || 0,
                    price: live.price || 0,
                    prevPriceDate: live.prevPriceDate || '',
                    priceTime: live.priceTime || '',
                    todayProfit,
                    totalProfit,
                    holdProfit: item.holdProfit || 0,
                    shares: item.shares || 0,
                    useFallbackNav,
                    acNetValue: live.acNetValue || null,
                    prevTradingDayPrice: live.prevTradingDayPrice || 0,
                    prevTradingDayDate: live.prevTradingDayDate || '',
                    pendingAdjustments,
                    pendingDividendAmount  // 用于调试和显示
                });
            }
        }
        const normalizedDailyProfitHistory = normalizeDailyProfitHistory(dailyProfitHistory);
        const { history: nextDailyProfitHistory, changed: dailyProfitHistoryChanged } = reconcileDailyProfitHistory(
            normalizedDailyProfitHistory,
            funds,
            fetchedData,
            dominantMarketPrevPriceDate
        );
        allFundsData = results.filter(Boolean);

        // 记录实时走势点（每次刷新追加一个时间点到 fundHistoryData）
        const now = new Date();
        const hhmm = formatTime(now);
        const shouldRecordIntradayPoint = isIntradayChartTime(hhmm);
        let fundHistoryChanged = false;
        allFundsData.forEach(item => {
            if (!item || !item.code) return;
            if (!fundHistoryData[item.code]) {
                fundHistoryData[item.code] = { date: '', points: [] };
            }
            if (fundHistoryData[item.code].date !== todayStr) {
                // 新的一天：重置并预埋 09:30 基准点（rate=0），避免展示时首点出现尖刺
                fundHistoryData[item.code] = { date: todayStr, points: ensureIntradayBasePoint() };
                fundHistoryChanged = true;
            }
            if (!shouldRecordIntradayPoint) return;
            const pts = fundHistoryData[item.code].points;
            const rate = item.rate || 0;
            // 去重：同一分钟不重复追加；若真实数据与预埋基准点时间相同，用真实 rate 覆盖
            if (pts.length > 0 && pts[pts.length - 1].time === hhmm) {
                if (pts[pts.length - 1].rate !== rate) {
                    pts[pts.length - 1].rate = rate;
                    fundHistoryChanged = true;
                }
            } else {
                pts.push({ time: hhmm, rate });
                fundHistoryChanged = true;
            }
        });
        if (fundHistoryChanged) saveFundHistoryData();

        const todayProfits = buildTodayProfits(results);
        const dataToPersist = buildLoadDataPersistPayload({
            todayProfits,
            lastDayProfits,
            nextDailyProfitHistory,
            dailyProfitHistoryChanged,
            dataChanged,
            funds
        });
        if (Object.keys(dataToPersist).length > 0) {
            await storage.set(dataToPersist);
        }

        // 显示合并的交易确认通知
        let totalConfirmed = 0;
        const notifications = [];

        if (confirmedTransactions.add.length > 0) {
            totalConfirmed += confirmedTransactions.add.length;
            const codes = confirmedTransactions.add.map(t => t.code).join('、');
            notifications.push(`加仓 ${confirmedTransactions.add.length} 笔：${codes}`);
        }
        if (confirmedTransactions.remove.length > 0) {
            totalConfirmed += confirmedTransactions.remove.length;
            const codes = confirmedTransactions.remove.map(t => t.code).join('、');
            notifications.push(`减仓 ${confirmedTransactions.remove.length} 笔：${codes}`);
        }
        if (confirmedTransactions.dividend.length > 0) {
            totalConfirmed += confirmedTransactions.dividend.length;
            const codes = confirmedTransactions.dividend.map(t => t.code).join('、');
            notifications.push(`现金分红 ${confirmedTransactions.dividend.length} 笔：${codes}`);
        }
        if (confirmedTransactions.dividend_reinvest.length > 0) {
            totalConfirmed += confirmedTransactions.dividend_reinvest.length;
            const codes = confirmedTransactions.dividend_reinvest.map(t => t.code).join('、');
            notifications.push(`红利再投 ${confirmedTransactions.dividend_reinvest.length} 笔：${codes}`);
        }

        if (totalConfirmed > 0) {
            showToast(`✅ 已确认 ${totalConfirmed} 笔交易\n${notifications.join('\n')}`, 'success', 4000);
        }

        updateGroupFilter();
        await hydrateFundPerfCache(funds, allFundsData.map(item => item.code));
        renderTable();
        lastUpdateTime = new Date().toLocaleTimeString();
        elements.statusText.innerText = `最后更新: ${lastUpdateTime}`;

        // 后台静默拉取区间涨跌幅（不阻塞主流程）
        fetchAllFundPerfData(funds);
    } catch (error) {
        console.error('[_loadDataImpl] 数据加载失败:', error);
        showToast(`数据加载失败: ${error.message}`, 'error');
        elements.statusText.innerText = '数据加载失败，请重试';

        // 确保在错误情况下也显示一个基本的空表格
        if (allFundsData.length === 0) {
            renderTable();
        }
    }
}

// ==================== 批量操作核心逻辑 ====================

// 通用批量操作确认函数
/**
 * 批量操作二次确认弹窗
 * @param {string} action  - 操作名称（如"删除"、"重算份额"）
 * @param {number} count   - 选中数量
 * @param {string} details - 附加说明（如警告语）
 * @param {boolean} danger - 是否为危险操作（红色确认按钮）
 */
async function askBatchConfirmation(action, count, details = '', danger = false) {
    return showConfirm(
        `确认${action}选中的 ${count} 项吗？${details}`,
        `${action}确认`,
        danger
    );
}

// 1. 批量重算份额 (根据金额和净值)
async function batchRecalculateShares() {
    if (selectedCodes.size === 0) return showToast('❌ 请先勾选基金', 'error');
    if (!await askBatchConfirmation('重算份额', selectedCodes.size)) return;

    const { myFunds } = await storage.get(['myFunds']);
    const funds = myFunds || {};
    const codes = [...selectedCodes].filter(c => funds[c]);

    // 并发请求，与 loadData 批量逻辑保持一致
    const results = await fetchBatchLiveInfo(codes, 8000, null);
    let count = 0;
    for (const { code, live } of results) {
        if (live && live.prevPrice > 0) {
            funds[code].shares = deriveFundShares(funds[code], live.prevPrice);
            count++;
        }
    }
    await storage.set({ myFunds: funds });
    showToast(`✅ 已重算 ${count} 支基金份额`, 'success');
    loadData();
}

// 2. 批量修改分组
async function batchChangeGroup() {
    if (selectedCodes.size === 0) return showToast('❌ 请先勾选基金', 'error');
    const newGroup = await showPrompt('请输入新的分组名称：', {
        defaultVal: '默认',
        title: '批量修改分组'
    });
    if (newGroup === null) return;

    const { myFunds } = await storage.get(['myFunds']);
    const funds = myFunds || {};
    selectedCodes.forEach(code => {
        if (funds[code]) funds[code].group = newGroup || '默认';
    });
    await storage.set({ myFunds: funds });
    showToast(`📁 已将 ${selectedCodes.size} 支基金移至分组：${newGroup || '默认'}`, 'success');
    loadData();
}

// 3. 清空持仓（单个或批量统一入口，codes 传字符串或数组）
async function clearPositions(codes) {
    const codeList = Array.isArray(codes) ? codes : [codes];
    if (codeList.length === 0) return showToast('❌ 请先勾选基金', 'error');

    const isBatch = codeList.length > 1;
    const title = isBatch ? '批量清空确认' : '清空持仓确认';
    const desc = isBatch
        ? `确认要清空选中 ${codeList.length} 支基金的持仓和份额吗？`
        : `确定要清空基金 [${codeList[0]}] 的持仓吗？`;
    let resolveClearPositions = null;

    _openModal(title, '', false, '', () => {
        _closeModal();
        resolveClearPositions?.(false);
    });
    elements.modalMsg.innerHTML = `
        <p style="margin-bottom:10px;">${desc}</p>
        ${!isBatch ? '<p style="font-size:12px;color:#8aacce;margin-bottom:15px;">此操作将清空持仓金额和份额，但会保留“累计收益”。</p>' : ''}
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;">
            <input type="checkbox" id="clearGroupChk" checked>
            同时将分组变更为“已撤回”
        </label>
    `;

    const ok = await new Promise(resolve => {
        resolveClearPositions = resolve;
        _setFooter([
            { text: '取消', cls: 'modal-btn-cancel', onClick: () => { _closeModal(); resolve(false); } },
            {
                text: '确定', cls: 'modal-btn-danger', onClick: () => {
                    const isChecked = document.getElementById('clearGroupChk').checked;
                    _closeModal();
                    resolve(isChecked ? 'yes' : 'no');
                }
            }
        ]);
    });

    if (!ok) return;

    const { myFunds } = await storage.get(['myFunds']);
    const funds = myFunds || {};
    codeList.forEach(code => {
        if (funds[code]) resetFundPosition(funds[code], ok === 'yes');
    });
    await storage.set({ myFunds: funds });
    const msg = isBatch ? `🧹 已清空 ${codeList.length} 支基金持仓` : `✅ ${codeList[0]} 持仓已清空`;
    showToast(msg, 'success');
    loadData();
}

// 批量清空入口（fabMenu 绑定保持不变）
async function batchClearPositions() {
    if (selectedCodes.size === 0) return showToast('❌ 请先勾选基金', 'error');
    await clearPositions([...selectedCodes]);
}

// 4. 批量删除
async function batchDeleteFunds() {
    if (selectedCodes.size === 0) return;
    if (!await askBatchConfirmation('删除', selectedCodes.size, '\n该操作不可恢复！', true)) return;

    const count = selectedCodes.size;
    await deleteFunds([...selectedCodes]);
    showToast(`🗑 已删除 ${count} 支基金`, 'success');
    loadData();
}

// ==================== 悬浮球交互绑定 ====================
function initFabMenu() {
    const fabMain = document.getElementById('fabMain');
    const fabMenu = document.getElementById('fabMenu');
    if (!fabMain) return;

    // 切换菜单显示
    fabMain.onclick = (e) => {
        e.stopPropagation();
        fabMain.classList.toggle('active');
        fabMenu.classList.toggle('show');
    };

    // 点击外部自动收起
    document.addEventListener('click', () => {
        fabMain.classList.remove('active');
        fabMenu.classList.remove('show');
    });

    // 统一绑定按钮事件
    const bind = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.onclick = () => {
            fn();
            fabMain.classList.remove('active');
            fabMenu.classList.remove('show');
        };
    };

    bind('fabSelectAll', () => {
        const filter = elements.groupFilter.value;
        const visible = allFundsData.filter(i => filter === 'all' || i.group === filter);
        const allSelected = visible.every(i => selectedCodes.has(i.code));
        visible.forEach(i => allSelected ? selectedCodes.delete(i.code) : selectedCodes.add(i.code));
        renderTable();
    });
    bind('fabAdd', () => openFundEditor());
    bind('fabOCRBatch', openOCRBatchAdd);
    bind('fabBatchCalc', batchRecalculateShares);
    bind('fabBatchGroup', batchChangeGroup);
    bind('fabBatchClear', batchClearPositions);
    bind('fabBatchDel', batchDeleteFunds);
    bind('fabSettlement', () => manualSettlement());
    bind('fabRollback', () => rollbackSettlement());
    bind('fabExport', exportFundsData);
    bind('fabExportBackup', exportBackupFundsData);
    bind('fabImport', () => document.getElementById('importFile').click());
}

// 确保在页面加载时启动
// ==================== 交易确认日期计算 ====================
/**
 * 获取下一个交易日（跳过周六日）
 * 注意：未内置节假日，如遇法定假日用户可手动调整确认日期
 */
function nextTradingDay(date) {
    const d = new Date(date);
    do {
        d.setDate(d.getDate() + 1);
    } while (d.getDay() === 0 || d.getDay() === 6); // 跳过周日(0)和周六(6)
    return d;
}

// 移除重复的 formatDate 定义，使用上面已定义的版本

/**
 * 计算基金申购/赎回的确认日期
 * 规则：
 *   15:00前提交 → T日净值成交 → T+1个交易日确认
 *   15:00后提交 → T+1日净值成交 → T+2个交易日确认
 *   周末提交 → 视为下一个交易日15:00前提交（T+1确认）
 */
function getConfirmDate() {
    const now = new Date();
    const day = now.getDay(); // 0=周日, 6=周六
    const hour = now.getHours();
    const minute = now.getMinutes();
    const isWeekend = (day === 0 || day === 6);
    const isAfterCutoff = !isWeekend && hour >= CONFIG.TRADING_CUTOFF_HOUR;

    let base = new Date(now);

    if (isWeekend) {
        // 周末：找到下一个交易日作为提交日，再+1
        while (base.getDay() === 0 || base.getDay() === 6) {
            base.setDate(base.getDate() + 1);
        }
        // 此时 base 是下一个交易日（相当于T），确认日是再下一个交易日
        return formatDate(nextTradingDay(base));
    } else if (isAfterCutoff) {
        // 15:00后：T+2个交易日
        const t1 = nextTradingDay(base);
        return formatDate(nextTradingDay(t1));
    } else {
        // 15:00前：T+1个交易日
        return formatDate(nextTradingDay(base));
    }
}

// ==================== 更新分组筛选下拉 ====================
function updateGroupFilter() {
    const groups = ['all', ...new Set(allFundsData.map(item => item.group))];

    if (elements.groupFilter) {
        const currentVal = elements.groupFilter.value;
        const optionNodes = groups.map(group => {
            const option = document.createElement('option');
            option.value = group;
            option.textContent = group === 'all' ? '全部显示' : group;
            option.selected = group === currentVal;
            return option;
        });
        elements.groupFilter.replaceChildren(...optionNodes);
    }

    if (elements.groupList) {
        const datalistOptions = groups
            .filter(group => group !== 'all')
            .map(group => {
                const option = document.createElement('option');
                option.value = group;
                return option;
            });
        elements.groupList.replaceChildren(...datalistOptions);
    }
}

// ==================== 1. 新增：通用表单弹窗函数 ====================
/**
 * 显示一个包含表单的模态框（替代多个连续 prompt）
 * @param {Object} config 配置对象
 * @returns {Promise<Object|null>} 返回表单数据或 null
 */
function showFormModal(config) {
    return new Promise(resolve => {
        const { title, subTitle, fields, actionText = '保存' } = config;
        setModalDismissHandler(() => {
            _closeModal();
            resolve(null);
        });
        elements.modalOverlay.dataset.mode = '';
        // 1. 设置标题和副标题
        elements.modalInput.onkeydown = null;
        elements.modalMsg.onclick = null;
        elements.modalTitle.textContent = title;
        // 构建内容区域
        let html = `<div class="form-header-sub">${subTitle || ''}</div>`;
        html += '<div class="form-container">';
        fields.forEach(field => {
            // hidden 字段只渲染隐藏 input，不包裹 form-group
            if (field.type === 'hidden') {
                html += `<input type="hidden" id="modal_field_${field.id}" value="${field.value ?? ''}">`;
                return;
            }
            html += `<div class="form-group">`;
            html += `<label for="modal_field_${field.id}">${field.label}</label>`;
            const value = (field.value !== undefined && field.value !== null) ? field.value : '';
            if (field.type === 'number' && field.showAll) {
                html += `<div style="display: flex; align-items: center; gap: 6px;">`;
                html += `<input type="number" id="modal_field_${field.id}" 
        placeholder="${field.placeholder || ''}" 
        value="${field.value !== undefined && field.value !== null ? field.value : ''}"
        ${field.min !== undefined ? `min="${field.min}"` : ''} 
        ${field.step !== undefined ? `step="${field.step}"` : ''}
        style="flex: 1;">`;
                html += `<button type="button" class="all-btn" data-target="${field.id}" data-max="${field.max}">全部</button>`;
                html += `</div>`;
            } else if (field.type === 'select') {
                html += `<select id="modal_field_${field.id}" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid #2a4a6a;background:#0d1f35;color:#c8d8ee;font-size:13px;">`;
                (field.options || []).forEach(opt => {
                    const selected = String(field.value) === String(opt.value) ? 'selected' : '';
                    html += `<option value="${opt.value}" ${selected}>${opt.label}</option>`;
                });
                html += `</select>`;
            } else {
                // 原有的输入框生成代码（保持不变）
                html += `<input type="${field.type || 'text'}" id="modal_field_${field.id}" 
    placeholder="${field.placeholder || ''}" 
    value="${field.value !== undefined && field.value !== null ? field.value : ''}"
    ${field.list ? `list="${field.list}"` : ''} 
    ${field.min !== undefined ? `min="${field.min}"` : ''} 
    ${field.step !== undefined ? `step="${field.step}"` : ''}>`;
            }
            html += `</div>`;
        });
        html += '</div>';
        elements.modalMsg.innerHTML = html; // 使用 innerHTML 注入表单
        elements.modalInput.style.display = 'none'; // 隐藏默认的单输入框
        // 2. 设置底部按钮
        _setFooter([
            { text: '取消', cls: 'modal-btn-cancel', onClick: () => { _closeModal(); resolve(null); } },
            {
                text: actionText,
                cls: 'modal-btn-ok',
                onClick: () => {
                    // 收集数据
                    const formData = {};
                    fields.forEach(field => {
                        const el = document.getElementById(`modal_field_${field.id}`);
                        let val = el.value;
                        // 数字类型转换（select 和 text 保留字符串）
                        if (field.type === 'number' || field.type === 'hidden') {
                            val = parseFloat(val) || 0;
                        }
                        formData[field.id] = val;
                    });
                    _closeModal();
                    resolve(formData);
                }
            }
        ]);
        setModalVisibility(true);
        setTimeout(() => {
            document.querySelectorAll('.all-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const targetId = btn.dataset.target;
                    const max = btn.dataset.max;
                    const input = document.getElementById(`modal_field_${targetId}`);
                    if (input) {
                        input.value = max;
                        // 触发 change 事件（可选）
                        input.dispatchEvent(new Event('change'));
                    }
                });
            });
        }, 50);
    });
}

// ==================== 2. 重写：加仓/减仓/分红逻辑 ====================
async function adjustPosition(code, type) {
    try {
        // 获取基础数据
        const { myFunds } = await storage.get(['myFunds']);
        const funds = myFunds || {};
        const fundItem = funds[code];
        if (!fundItem) {
            await showAlert('未找到该标的数据！');
            return;
        }
        const live = await fetchLiveInfo(code);
        const defaultNav = live?.prevPrice || 1.0000;
        // 1. 构建表单配置
        const isAdd = type === 'add';
        const isDividend = type === 'dividend';
        const title = isDividend ? '分红调整' : (isAdd ? '加仓设置' : '减仓设置');
        // 计算确认日期并生成提示文字
        const confirmDate = getConfirmDate();
        const _now = new Date();
        const _isWeekend = _now.getDay() === 0 || _now.getDay() === 6;
        const _isAfterCutoff = !_isWeekend && _now.getHours() >= CONFIG.TRADING_CUTOFF_HOUR;
        const timingHint = _isWeekend ? '📅 周末下单，顺延至下一交易日T+1确认'
            : _isAfterCutoff ? '⏰ 15:00后下单，按T+2确认'
                : '✅ 15:00前下单，按T+1确认';
        const subTitle = isDividend
            ? `${live?.name || code} (#${code})　现金分红不改变份额`
            : `${live?.name || code} (#${code})　${timingHint} `;
        let fields = [];
        if (isDividend) {
            // --- 分红逻辑：输入分红金额 ---
            fields = [
                { id: 'dividendAmount', label: '分红金额 (元)', type: 'number', placeholder: '请输入分红金额', value: '', min: 0, step: '0.01' },
                { id: 'confirmDate', label: '分红到账日期', type: 'date', value: confirmDate }
            ];
        } else if (isAdd) {
            // --- 加仓逻辑：输入金额 ---
            fields = [
                { id: 'amount', label: '买入金额 (元)', type: 'number', placeholder: '请输入金额', value: '', min: 0 },
                { id: 'feeRate', label: '交易费率 (%)', type: 'number', placeholder: '0.15', value: '0', step: '0.01' },
                { id: 'confirmDate', label: '确认日期（可手动调整）', type: 'date', value: confirmDate },
                { id: 'estNav', type: 'hidden', value: defaultNav }
            ];
        } else {
            // --- 减仓逻辑：输入份额 ---
            const maxShares = fundItem.shares || 0;
            fields = [
                {
                    id: 'shares',
                    label: '卖出份额',
                    type: 'number',
                    placeholder: `最多可卖 ${maxShares.toFixed(2)} 份`,
                    value: '',
                    min: 0,
                    step: '0.01',
                    showAll: true,
                    max: maxShares
                },
                { id: 'feeRate', label: '交易费率 (%)', type: 'number', placeholder: '0', value: '0', step: '0.01' },
                { id: 'confirmDate', label: '确认日期（可手动调整）', type: 'date', value: confirmDate }
            ];
        }
        // 2. 唤起表单，并在渲染后注入「下单时间」切换器
        const formModalPromise = showFormModal({
            title,
            subTitle,
            fields,
            actionText: '确认' + (isAdd ? '加仓' : '减仓')
        });

        // 表单渲染后插入切换器
        setTimeout(() => {
            const confirmDateInput = document.getElementById('modal_field_confirmDate');
            if (!confirmDateInput) return;

            // 在确认日期字段的 form-group 前插入切换器
            const dateGroup = confirmDateInput.closest('.form-group');
            if (!dateGroup) return;

            const switcher = document.createElement('div');
            switcher.className = 'timing-switcher';
            switcher.innerHTML = `
            <span>下单时间：</span>
                <label id="timingBefore" class="timing-btn">15:00前</label>
                <label id="timingAfter"  class="timing-btn">15:00后</label>
        `;
            dateGroup.parentNode.insertBefore(switcher, dateGroup);

            const btnBefore = document.getElementById('timingBefore');
            const btnAfter = document.getElementById('timingAfter');
            let useAfterCutoff = _isAfterCutoff;

            function applyStyle() {
                btnBefore.className = 'timing-btn' + (!useAfterCutoff ? ' active-before' : '');
                btnAfter.className = 'timing-btn' + (useAfterCutoff ? ' active-after' : '');
            }

            function recalcDate() {
                const d = new Date();
                const isWknd = d.getDay() === 0 || d.getDay() === 6;
                let base = new Date(d);
                let result;
                if (isWknd) {
                    while (base.getDay() === 0 || base.getDay() === 6) base.setDate(base.getDate() + 1);
                    result = formatDate(nextTradingDay(base));
                } else if (useAfterCutoff) {
                    result = formatDate(nextTradingDay(nextTradingDay(base)));
                } else {
                    result = formatDate(nextTradingDay(base));
                }
                confirmDateInput.value = result;
            }

            applyStyle();

            btnBefore.addEventListener('click', () => {
                useAfterCutoff = false;
                applyStyle();
                recalcDate();
            });

            btnAfter.addEventListener('click', () => {
                useAfterCutoff = true;
                applyStyle();
                recalcDate();
            });
        }, 80);

        const result = await formModalPromise;
        if (!result) return; // 用户取消
        const pendingAdjustments = ensurePendingAdjustments(fundItem);
        if (isDividend) {
            const { dividendAmount, confirmDate } = result;
            pendingAdjustments.push({
                type: 'dividend',
                dividendAmount: dividendAmount,
                dividendNavPrice: defaultNav,  // 当前净值，供改为红利再投时使用
                targetDate: confirmDate,
                orderDate: getToday(),
                status: 'pending'
            });
        } else if (isAdd) {
            const { amount, feeRate, confirmDate } = result;
            pendingAdjustments.push({
                type: 'add',
                amount: amount,
                feeRate: feeRate,
                targetDate: confirmDate,
                orderNav: defaultNav,        // 下单时净值
                orderDate: getToday(),
                status: 'pending'
            });
        } else {
            const { shares: inputShares, feeRate, confirmDate } = result;
            pendingAdjustments.push({
                type: 'remove',
                shares: inputShares,
                feeRate: feeRate,
                targetDate: confirmDate,
                orderNav: defaultNav,        // 下单时净值
                orderDate: getToday(),
                status: 'pending'
            });
        }
        // 保存
        await storage.set({ myFunds: funds });
        const actionName = isDividend ? '分红记录' : (isAdd ? '加仓' : '减仓');
        const amountInfo = isDividend ? `${result.dividendAmount}元`
            : isAdd ? `${result.amount}元`
                : `${result.shares}份`;
        showToast(`✅ ${code} ${actionName}已添加：${amountInfo}，将在 ${result.confirmDate} 确认`, 'success');
        loadData();
    } catch (e) {
        console.error(`${type} 仓操作失败: `, e);
        showAlert(`操作失败: ${e.message} `);
    }
}

// ==================== 统一的：添加资产 / 编辑持仓 ====================
async function openFundEditor(existingCode = null) {
    let fund = null, live = null;
    let currentNav = 1.0000;

    if (existingCode) {
        const { myFunds } = await storage.get(['myFunds']);
        fund = (myFunds || {})[existingCode];
        live = await fetchLiveInfo(existingCode);
        currentNav = live?.prevPrice || 1.0000;
    }

    const fields = [
        { id: 'code', label: '资产代码 (必填)', type: 'text', value: existingCode || '', placeholder: '如: 005827' },
        { id: 'amount', label: '持有金额 (元)', type: 'number', value: fund?.amount || '', min: 0, step: '0.01' },
        { id: 'shares', label: '持有份额', type: 'number', value: fund?.shares || '', step: '0.0001' },
        { id: 'holdProfit', label: '累计盈亏 (元)', type: 'number', value: fund?.holdProfit || 0 },
        { id: 'yesterdayProfit', label: '昨日收益 (元)', type: 'number', value: fund?.yesterdayProfit || 0 },
        { id: 'group', label: '分组名称', type: 'text', value: fund?.group || '默认', list: 'groupList' },
        {
            id: 'dividendMode', label: '分红方式', type: 'select', value: fund?.dividendMode || 'cash',
            options: [{ value: 'cash', label: '💵 现金分红（默认）' }, { value: 'reinvest', label: '🔄 红利再投' }]
        }
    ];

    // 弹窗出现后，注入联动计算逻辑
    setTimeout(() => {
        const codeInput = document.getElementById('modal_field_code');
        const amtInput = document.getElementById('modal_field_amount');
        const shareInput = document.getElementById('modal_field_shares');

        if (existingCode) {
            codeInput.disabled = true; // 编辑时禁止修改代码
        } else {
            // 新增时，输入代码后失去焦点，自动拉取净值
            codeInput.addEventListener('blur', async () => {
                const c = codeInput.value.trim();
                if (c.length >= 5) {
                    const l = await fetchLiveInfo(c);
                    if (l && l.prevPrice > 0) {
                        currentNav = l.prevPrice;
                        // 删除 toast，改为静默更新
                        // 如果此时有金额没份额，顺手算一下
                        if (amtInput.value && !shareInput.value) {
                            shareInput.value = (parseFloat(amtInput.value) / currentNav).toFixed(4);
                        }
                    }
                }
            });
        }

        // 相辅相成 1：金额变动 -> 算份额
        amtInput.addEventListener('input', () => {
            const amt = parseFloat(amtInput.value) || 0;
            if (currentNav > 0) shareInput.value = (amt / currentNav).toFixed(4);
        });

        // 相辅相成 2：份额变动 -> 算金额
        shareInput.addEventListener('input', () => {
            const sh = parseFloat(shareInput.value) || 0;
            if (currentNav > 0) amtInput.value = (sh * currentNav).toFixed(2);
        });
    }, 100);

    const result = await showFormModal({
        title: existingCode ? '编辑持仓' : '添加资产',
        subTitle: existingCode ? `${live?.name || existingCode} ` : '输入代码后点击空白处，获取净值进行联动计算',
        fields: fields,
        actionText: '保存'
    });

    if (!result) return;

    const code = (existingCode || result.code).trim().toUpperCase();
    if (!code) { await showAlert('资产代码不能为空！'); return; }

    elements.statusText.innerText = '正在保存...';

    // 如果是新增，且没获取过行情，再确认一次
    if (!existingCode && !live) {
        live = await fetchLiveInfo(code);
        if (!live || live.name.includes('[未知]')) {
            const ok = await showConfirm(`未检索到代码 ${code} 的数据，是否强制保存？`, '提示', true);
            if (!ok) { elements.statusText.innerText = '准备就绪'; return; }
        }
    }

    const { myFunds } = await storage.get(['myFunds']);
    const funds = myFunds || {};
    funds[code] = {
        ...(funds[code] || {}),
        amount: parseFloat(result.amount) || 0,
        shares: parseFloat(result.shares) || 0,
        holdProfit: parseFloat(result.holdProfit) || 0,
        yesterdayProfit: parseFloat(result.yesterdayProfit) || 0,
        group: result.group || '默认',
        dividendMode: result.dividendMode || 'cash',
        savedPrevPrice: funds[code]?.savedPrevPrice || live?.prevPrice || 1,
        savedPrevDate: funds[code]?.savedPrevDate || live?.prevPriceDate || getToday(),
        savedAcNetValue: funds[code]?.savedAcNetValue || live?.acNetValue || null,
        addedDate: funds[code]?.addedDate || getToday()  // 记录添加日期（只在首次添加时记录）
    };

    await storage.set({ myFunds: funds });
    showToast(`✅ ${code} 保存成功！金额${result.amount}元，份额${result.shares}份`, 'success');
    elements.statusText.innerText = '准备就绪';
    loadData();
}

// 绑定添加按钮



// ==================== 居中弹窗逻辑 ====================
var centerModalOverlay = null;
/**
 * 初始化居中弹窗容器
 */
function initCenterModal() {
    centerModalOverlay = document.createElement('div');
    centerModalOverlay.className = 'center-modal-overlay';
    // 点击背景关闭
    centerModalOverlay.onclick = (e) => {
        if (e.target === centerModalOverlay) {
            hideCenterModal();
        }
    };
    document.body.appendChild(centerModalOverlay);
}
/**
 * 显示居中弹窗
 */
function showCenterMenu(code) {
    if (!centerModalOverlay) initCenterModal();
    const fund = allFundsData.find(f => f.code === code);
    if (!fund) return;

    // 构建HTML，去掉内联 onclick
    const html = `
        <div class="center-modal-box">
            <div class="center-modal-header">
                <span class="modal-title">持仓操作</span>
                <span class="modal-link" id="transactionLink">交易记录 ></span>
            </div>
            <div class="center-modal-info">
                <span class="info-name">${fund.name}</span>
                <span class="info-code">#${fund.code}</span>
            </div>
            <div class="center-modal-actions">
                <div class="action-row-double">
                    <button class="btn-op add" data-action="add" data-code="${code}">+ 加仓</button>
                    <button class="btn-op remove" data-action="remove" data-code="${code}">− 减仓</button>
                </div>
                <button class="btn-op dividend" data-action="dividend" data-code="${code}">💰 手动录入分红</button>
                <button class="btn-op edit" data-action="edit" data-code="${code}">✏️ 编辑持仓</button>
                <button class="btn-op calc" data-action="calc_shares" data-code="${code}">🔄 根据金额重算份额</button>
                <button class="btn-op clear" data-action="clear" data-code="${code}">🧹 清空金额</button>
                <button class="btn-op delete" data-action="delete" data-code="${code}">🗑 彻底删除资产</button>
            </div>
        </div>
            `;
    centerModalOverlay.innerHTML = html;

    // 绑定交易记录链接
    const transactionLink = document.getElementById('transactionLink');
    // 在 showCenterMenu 中，为“交易记录”链接绑定新函数
    if (transactionLink) {
        transactionLink.addEventListener('click', () => {
            hideCenterModal();  // 关键：先关闭操作弹窗
            showPendingTransactions(code);
        });
    }

    // 绑定其他按钮
    centerModalOverlay.querySelectorAll('.btn-op').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            const c = btn.dataset.code;
            hideCenterModal();

            if (action === 'add') adjustPosition(c, 'add');
            else if (action === 'remove') adjustPosition(c, 'remove');
            else if (action === 'dividend') adjustPosition(c, 'dividend');
            else if (action === 'edit') openFundEditor(c);
            else if (action === 'clear') clearPositions(c);
            else if (action === 'calc_shares') forceRecalculateShares(c);
            else if (action === 'delete') removeFund(c);
        });
    });

    // 显示弹窗
    requestAnimationFrame(() => {
        centerModalOverlay.classList.add('visible');
    });
}

/**
 * 显示某基金的交易记录弹窗（加仓/减仓/分红，支持撤销和分红类型切换）
 */
async function showPendingTransactions(code) {
    const { myFunds } = await storage.get(['myFunds']);
    const funds = myFunds || {};
    const fund = funds[code];
    const txList = getPendingAdjustments(fund);

    if (txList.length === 0) {
        await showAlert('暂无交易记录');
        return;
    }

    const renderList = () => {
        let html = `<div class="tx-list">`;
        txList.forEach((adj, idx) => {
            const isPending = adj.status !== 'confirmed';
            let typeLabel = adj.type === 'add' ? '加仓'
                : adj.type === 'dividend' ? '现金分红'
                    : adj.type === 'dividend_reinvest' ? '红利再投'
                        : '减仓';
            const typeCls = adj.type === 'add' ? 'add'
                : isDividendType(adj.type) ? 'dividend'
                    : 'remove';

            const statusBadge = `<span class="tx-badge ${isPending ? 'pending' : 'confirmed'}">${isPending ? '待确认' : '已确认'}</span>`;

            const amountText = adj.type === 'add'
                ? `¥${adj.amount} (费率${adj.feeRate}%)`
                : isDividendType(adj.type)
                    ? `¥${adj.dividendAmount}`
                    : `${adj.shares} 份 (费率${adj.feeRate}%)`;

            let navInfo = '';
            if (adj.orderNav) navInfo += `下单净值 ${adj.orderNav} `;
            if (adj.confirmedPrice) navInfo += `　确认净值 ${adj.confirmedPrice} `;
            if (adj.confirmedShares && (adj.type === 'add' || adj.type === 'dividend_reinvest')) navInfo += `　到账 ${adj.confirmedShares} 份`;

            let dateInfo = `预计确认日 ${adj.targetDate} `;
            if (adj.confirmedDate) dateInfo = `确认日 ${adj.confirmedDate} `;
            if (adj.orderDate) dateInfo = `下单 ${adj.orderDate} · ` + dateInfo;

            let actionBtn = '';
            if (isPending) {
                if (adj.type === 'dividend') {
                    actionBtn = `
                        <button data-convert-reinvest="${idx}" class="tx-revoke-btn" style="background: #1890ff; border-color: #1890ff;">改为红利再投</button>
                        <button data-revoke="${idx}" class="tx-revoke-btn">撤销</button>
                    `;
                } else {
                    actionBtn = `<button data-revoke="${idx}" class="tx-revoke-btn">撤销</button>`;
                }
            } else {
                actionBtn = `<span class="tx-no-revoke">不可撤销</span>`;
            }

            html += `
        <div class="tx-item">
            <div class="tx-row-main">
                <div class="tx-row-left">
                    <span class="tx-type ${typeCls}">${typeLabel}</span>
                    ${statusBadge}
                    <span class="tx-amount">${amountText}</span>
                </div>
                <div style="display: flex; gap: 4px;">
                    ${actionBtn}
                </div>
            </div>
            ${navInfo ? `<div class="tx-nav">${navInfo}</div>` : ''}
            <div class="tx-date">${dateInfo}</div>
        </div>`;
        });
        html += `</div>`;
        return html;
    };

    setModalDismissHandler(_closeModal);
    elements.modalOverlay.dataset.mode = '';
    elements.modalInput.onkeydown = null;
    elements.modalTitle.textContent = '交易记录';
    elements.modalMsg.innerHTML = renderList();
    elements.modalInput.value = '';
    elements.modalInput.style.display = 'none';
    _setFooter([
        { text: '关闭', cls: 'modal-btn-cancel', onClick: _closeModal }
    ]);
    setModalVisibility(true);

    elements.modalMsg.onclick = async (e) => {
        const convertBtn = e.target.closest('[data-convert-reinvest]');
        if (convertBtn) {
            const idx = parseInt(convertBtn.dataset.convertReinvest);
            const adj = txList[idx];
            if (!adj || adj.status === 'confirmed' || adj.type !== 'dividend') return;
            const ok = await showConfirm(
                `确认将现金分红改为红利再投吗？\n\n分红金额：¥${adj.dividendAmount}\n分红日净值：${adj.dividendNavPrice || '未知'}\n\n红利再投后，份额会增加，累计收益不变。`,
                '改为红利再投'
            );
            if (!ok) return;
            adj.type = 'dividend_reinvest';
            await storage.set({ myFunds: funds });
            showToast(`✅ ${code} 分红${adj.dividendAmount}元已改为红利再投`, 'success');
            elements.modalMsg.innerHTML = renderList();
            loadData();
            return;
        }

        const revokeBtn = e.target.closest('[data-revoke]');
        if (!revokeBtn) return;
        const idx = parseInt(revokeBtn.dataset.revoke);
        const adj = txList[idx];
        if (!adj || adj.status === 'confirmed') return;

        const typeLabel = adj.type === 'add' ? `加仓 ¥${adj.amount} `
            : isDividendType(adj.type) ? `分红 ¥${adj.dividendAmount} `
                : `减仓 ${adj.shares} 份`;
        const ok = await showConfirm(`确认撤销：${typeLabel}（${adj.targetDate}）？`, '撤销确认', true);
        if (!ok) return;

        txList.splice(idx, 1);
        await storage.set({ myFunds: funds });
        showToast(`✅ ${code} ${typeLabel}已撤销`, 'success');

        if (txList.length === 0) {
            _closeModal();
        } else {
            elements.modalMsg.innerHTML = renderList();
        }
        loadData();
    };
}

/**
 * 隐藏弹窗
 */
function hideCenterModal() {
    if (centerModalOverlay) {
        centerModalOverlay.classList.remove('visible');
    }
}

// ==================== 强制根据金额重新计算份额 ====================
async function forceRecalculateShares(code) {
    elements.statusText.innerText = '正在重新计算份额...';
    const live = await fetchLiveInfo(code);
    if (!live || live.prevPrice <= 0) {
        await showAlert(`无法获取 ${code} 的有效净值，计算失败。`);
        elements.statusText.innerText = '准备就绪';
        return;
    }

    const { myFunds } = await storage.get(['myFunds']);
    const funds = myFunds || {};
    if (funds[code]) {
        const newShares = deriveFundShares(funds[code], live.prevPrice);
        funds[code].shares = newShares;

        await storage.set({ myFunds: funds });
        showToast(`✅ ${code} 已按净值 ${live.prevPrice} 重算份额为 ${newShares} 份`, 'success');
        elements.statusText.innerText = '准备就绪';
        loadData();
    }
}

// ==================== 修改：渲染表格 ====================
function renderTable() {
    const filter = elements.groupFilter.value;
    let displayData = allFundsData.filter(item => filter === 'all' || item.group === filter);
    displayData.sort((a, b) => {
        const valA = a[sortField] ?? 0;
        const valB = b[sortField] ?? 0;
        return (valA - valB) * sortDirection;
    });
    document.querySelectorAll('.sortable').forEach(th => {
        // 用 data-label 保存原始文字，避免 textContent 替换破坏子元素
        if (!th.dataset.label) th.dataset.label = th.textContent.trim();
        const arrow = th.dataset.sort === sortField ? (sortDirection === 1 ? ' ↑' : ' ↓') : '';
        th.textContent = th.dataset.label + arrow;
    });
    // 计算统计数据
    const { sumAmount, sumYesterdayProfit, sumTodayProfit, sumHoldProfit } = displayData.reduce(
        (acc, item) => ({
            sumAmount: acc.sumAmount + (item.amount || 0),
            sumYesterdayProfit: acc.sumYesterdayProfit + (item.yesterdayProfit || 0),
            sumTodayProfit: acc.sumTodayProfit + (item.todayProfit || 0),
            sumHoldProfit: acc.sumHoldProfit + (item.holdProfit || 0)
        }),
        { sumAmount: 0, sumYesterdayProfit: 0, sumTodayProfit: 0, sumHoldProfit: 0 }
    );

    const todayStr = getToday(); // 提到循环外，避免每次渲染行重复调用
    const fragment = document.createDocumentFragment();
    displayData.forEach((item, index) => {
        const todayProfitText = item.todayProfit === null
            ? '—'
            : formatProfit(item.todayProfit) + ' ';
        const tr = document.createElement('tr');
        tr.dataset.code = item.code;
        _td(tr, String(index + 1), 'index');
        // -- 代码 --
        _td(tr, item.code, 'code');
        // -- 名称/分组 --
        const tdName = document.createElement('td');
        const nameSpan = document.createElement('span');
        nameSpan.className = 'fund-name';
        nameSpan.title = item.name;
        nameSpan.textContent = item.name;
        // 检查是否有待确认的分红
        const hasPendingDividend = getPendingAdjustments(item).some(
            adj => isDividendType(adj.type) && adj.status === 'pending'
        );
        if (hasPendingDividend) {
            const dividendBadge = document.createElement('span');
            dividendBadge.className = 'dividend-badge';
            dividendBadge.textContent = '分红';
            dividendBadge.title = '该基金有待确认的分红，数据可能不准确';
            tdName.appendChild(dividendBadge);
        }
        const groupSpan = document.createElement('span');
        groupSpan.className = 'group-tag';
        groupSpan.dataset.code = item.code;
        groupSpan.textContent = item.group;
        tdName.appendChild(nameSpan);
        tdName.appendChild(groupSpan);
        tdName.dataset.col = 'name';
        setColumnVisibilityClass(tdName, 'name');
        tr.appendChild(tdName);
        // -- 持仓金额 (全屏和小屏都显示) --
        const tdAmount = document.createElement('td');
        tdAmount.className = 'editable-cell';
        tdAmount.contentEditable = 'true';
        tdAmount.dataset.col = 'amount';
        setColumnVisibilityClass(tdAmount, 'amount');
        tdAmount.dataset.field = 'amount';
        tdAmount.dataset.code = item.code;
        // 【修改】在金额后也添加设置图标 (解决小窗口看不到份额列的问题)
        const amountWrapper = document.createElement('div');
        amountWrapper.className = 'cell-with-icon';
        const amountText = document.createElement('span');
        amountText.textContent = item.amount.toFixed(2);
        const gearIcon1 = document.createElement('span');
        gearIcon1.className = 'settings-icon';
        gearIcon1.textContent = '⚙️';
        gearIcon1.dataset.code = item.code;
        // 绑定点击事件
        gearIcon1.onclick = (e) => {
            e.stopPropagation();
            showCenterMenu(item.code);
        };
        amountWrapper.appendChild(amountText);
        amountWrapper.appendChild(gearIcon1);
        tdAmount.appendChild(amountWrapper);
        tr.appendChild(tdAmount);
        // -- 份额 (全屏显示) --
        const tdShares = document.createElement('td');
        tdShares.className = 'col-hide'; // 小屏隐藏
        tdShares.dataset.col = 'shares';
        setColumnVisibilityClass(tdShares, 'shares');
        const sharesWrapper = document.createElement('div');
        sharesWrapper.className = 'cell-with-icon';
        const sharesText = document.createElement('span');
        sharesText.className = 'editable-cell'; // 保留可编辑
        sharesText.contentEditable = 'true';
        sharesText.dataset.field = 'shares';
        sharesText.dataset.code = item.code;
        sharesText.textContent = item.shares ? item.shares.toFixed(4) : '—';
        sharesWrapper.appendChild(sharesText);
        tdShares.appendChild(sharesWrapper);
        tr.appendChild(tdShares);
        // ... [净值列、昨日收益列、估值收益列代码保持不变] ...
        const tdNav = document.createElement('td');
        tdNav.className = 'col-hide';
        tdNav.dataset.col = 'nav';
        setColumnVisibilityClass(tdNav, 'nav');
        const prevNavLine = document.createElement('div');
        prevNavLine.style.cssText = 'display:flex; align-items:baseline; gap:4px;';
        const navVal = document.createElement('span');
        navVal.textContent = item.prevPrice > 0 ? item.prevPrice.toFixed(4) : '—';
        navVal.style.fontWeight = '500';
        prevNavLine.appendChild(navVal);
        if (item.prevPriceDate) {
            const prevDateSpan = document.createElement('span');
            prevDateSpan.style.cssText = `font-size:10px; color:${item.prevPriceDate === todayStr ? '#8c8c8c' : '#fa8c16'};`;
            prevDateSpan.textContent = item.prevPriceDate.slice(5);
            prevNavLine.appendChild(prevDateSpan);
        }
        if (item.prevPrice > 0 && item.prevTradingDayPrice > 0) {
            const prevDayRate = (item.prevPrice - item.prevTradingDayPrice) / item.prevTradingDayPrice * 100;
            const prevRateSpan = document.createElement('span');
            prevRateSpan.style.cssText = `font-size:10px; font-weight:bold; color:${prevDayRate >= 0 ? '#f5222d' : '#389e0d'};`;
            prevRateSpan.textContent = formatProfit(prevDayRate, '%');
            prevNavLine.appendChild(prevRateSpan);
        }
        tdNav.appendChild(prevNavLine);
        const liveNavLine = document.createElement('div');
        liveNavLine.style.cssText = 'display:flex; align-items:baseline; gap:4px; margin-top:2px; flex-wrap:wrap;';
        const priceSpan = document.createElement('span');
        if (item.price > 0) {
            priceSpan.textContent = item.price.toFixed(4);
            priceSpan.style.cssText = 'font-weight:500; color:#ffc069;';
            const liveDateSpan = document.createElement('span');
            liveDateSpan.style.cssText = 'font-size:10px; color:#8c8c8c;';
            liveDateSpan.textContent = (item.priceTime || todayStr).slice(5);
            liveNavLine.appendChild(priceSpan);
            liveNavLine.appendChild(liveDateSpan);
        } else {
            priceSpan.textContent = '—';
            priceSpan.style.color = '#8c8c8c';
            liveNavLine.appendChild(priceSpan);
        }
        if (item.rate !== null && item.rate !== undefined) {
            const rateSpan = document.createElement('span');
            rateSpan.style.cssText = `font-size:11px; font-weight:bold; color:${item.rate >= 0 ? '#f5222d' : '#389e0d'};`;
            rateSpan.textContent = formatProfit(item.rate, '%') + ' ';
            liveNavLine.appendChild(rateSpan);
        }
        tdNav.appendChild(liveNavLine);
        tr.appendChild(tdNav);
        // -- 持有天数/区间涨跌幅 (全屏显示) --
        PERF_FIELDS.forEach(field => {
            const tdPerf = document.createElement('td');
            tdPerf.className = 'col-hide perf-cell';
            tdPerf.dataset.col = field;
            tdPerf.dataset.perf = field;
            setColumnVisibilityClass(tdPerf, field);
            tdPerf.textContent = '—';
            tr.appendChild(tdPerf);
        });
        renderFundPerfCells(tr, item.code);
        // -- 昨日收益 --
        const tdYesterday = document.createElement('td');
        tdYesterday.dataset.col = 'yesterdayProfit';
        tdYesterday.className = item.yesterdayProfit >= 0 ? 'up' : 'down';
        setColumnVisibilityClass(tdYesterday, 'yesterdayProfit');
        tdYesterday.textContent = formatProfit(item.yesterdayProfit);
        if (hasPendingDividend) {
            const warnYesterday = document.createElement('span');
            warnYesterday.textContent = ' ⚠';
            warnYesterday.title = '该基金有待确认的分红，昨日收益可能不准确';
            warnYesterday.style.cssText = 'color:#fa8c16;font-size:11px;cursor:default;';
            tdYesterday.appendChild(warnYesterday);
        }
        tr.appendChild(tdYesterday);
        const tdToday = document.createElement('td');
        tdToday.dataset.col = 'todayProfit';
        if (item.todayProfit !== null) {
            tdToday.className = item.todayProfit >= 0 ? 'up' : 'down';
        }
        setColumnVisibilityClass(tdToday, 'todayProfit');
        const todayAmtLine = document.createElement('div');
        todayAmtLine.textContent = todayProfitText;
        tdToday.appendChild(todayAmtLine);
        if (item.rate !== null && item.rate !== undefined) {
            const todayRateLine = document.createElement('div');
            todayRateLine.style.cssText = 'font-size:10px; margin-top:1px; opacity:0.85;';
            todayRateLine.textContent = formatProfit(item.rate, '%') + ' ';
            tdToday.appendChild(todayRateLine);
        }
        tr.appendChild(tdToday);
        // 累计收益
        const tdHoldProfit = document.createElement('td');
        tdHoldProfit.className = `editable-cell ${item.holdProfit >= 0 ? 'up' : 'down'}`;
        tdHoldProfit.dataset.col = 'holdProfit';
        setColumnVisibilityClass(tdHoldProfit, 'holdProfit');
        tdHoldProfit.contentEditable = 'true';
        tdHoldProfit.dataset.field = 'holdProfit';
        tdHoldProfit.dataset.code = item.code;
        tdHoldProfit.textContent = formatProfit(item.holdProfit) + ' ';
        if (hasPendingDividend) {
            const warnHold = document.createElement('span');
            warnHold.textContent = '⚠';
            warnHold.title = '该基金有待确认的分红，累计收益可能不准确';
            warnHold.style.cssText = 'color:#fa8c16;font-size:11px;cursor:default;';
            tdHoldProfit.appendChild(warnHold);
        }
        tr.appendChild(tdHoldProfit);
        // -- 操作列 (只保留删除) --
        const tdOp = document.createElement('td');
        tdOp.className = 'col-hide';
        tdOp.dataset.col = 'actions';
        setColumnVisibilityClass(tdOp, 'actions');
        const btnDel = document.createElement('button');
        btnDel.className = 'del-btn';
        btnDel.dataset.code = item.code;
        btnDel.title = '删除';
        btnDel.textContent = '✕';
        tdOp.appendChild(btnDel);
        tr.appendChild(tdOp);
        fragment.appendChild(tr);
    });
    elements.tableBody.replaceChildren(fragment);
    // ... [汇总统计代码保持不变] ...
    elements.totalAmount.textContent = sumAmount.toLocaleString(undefined, { minimumFractionDigits: 2 });
    elements.totalYesterdayProfit.textContent = formatProfit(sumYesterdayProfit);
    elements.totalYesterdayProfit.className = sumYesterdayProfit >= 0 ? 'up' : 'down';
    elements.totalTodayProfit.textContent = formatProfit(sumTodayProfit);
    elements.totalTodayProfit.className = sumTodayProfit >= 0 ? 'up' : 'down';
    // 总累计收益：显示历史累计，并附上含今日浮动的合计
    const sumTotalProfit = sumHoldProfit + sumTodayProfit;
    const totalProfitMain = document.createElement('span');
    totalProfitMain.textContent = formatProfit(sumHoldProfit);
    const totalProfitExtra = document.createElement('span');
    totalProfitExtra.style.fontSize = '10px';
    totalProfitExtra.style.opacity = '0.7';
    totalProfitExtra.style.marginLeft = '4px';
    totalProfitExtra.textContent = `(含浮动 ${formatProfit(sumTotalProfit)})`;
    elements.totalTotalProfit.replaceChildren(totalProfitMain, totalProfitExtra);
    elements.totalTotalProfit.className = sumTotalProfit >= 0 ? 'up' : 'down';
    // 绑定删除按钮和分组标签事件
    elements.tableBody.onclick = (e) => {
        const target = e.target;
        const code = target.dataset.code;
        if (target.classList.contains('del-btn')) {
            removeFund(code);
        } else if (target.classList.contains('group-tag')) {
            openFundEditor(code);
        }
    };
    // 绑定可编辑单元格事件（使用防抖优化）
    const debouncedSave = debounce(async (code, field, val) => {
        const { myFunds } = await storage.get(['myFunds']);
        const funds = myFunds || {};
        if (funds[code]) {
            if (funds[code][field] === val) return;
            funds[code][field] = val;
            const localItem = allFundsData.find(f => f.code === code);
            if (localItem) localItem[field] = val;
            await storage.set({ myFunds: funds });
            showToast('已保存', 'success', CONFIG.TOAST_SHORT);
            renderTable();
        }
    }, CONFIG.DEBOUNCE_DELAY);

    elements.tableBody.querySelectorAll('.editable-cell').forEach(cell => {
        cell.onblur = () => {
            const code = cell.dataset.code;
            const field = cell.dataset.field;
            const valStr = cell.textContent.trim();
            const val = parseFloat(valStr);
            if (valStr === '' || isNaN(val)) {
                showToast('请输入有效的数字', 'warning');
                renderTable(); // 恢复显示值，无需重新请求网络
                return;
            }
            debouncedSave(code, field, val);
        };
        cell.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); cell.blur(); } };
    });
    // ---- 行点击选择（文件管理器风格）----
    elements.tableBody.querySelectorAll('tr').forEach((tr, idx) => {
        // 渲染时恢复选中高亮
        if (tr.dataset.code && selectedCodes.has(tr.dataset.code)) {
            tr.classList.add('selected-row');
        }

        // 双击打开详情
        tr.addEventListener('dblclick', (e) => {
            // 点击操作按钮/齿轮/group-tag/del-btn 时不触发
            if (e.target.closest('.settings-icon, .group-tag, .del-btn, button')) return;

            const code = tr.dataset.code;
            if (code) {
                openFundDetail(code);
            }
        });

        tr.addEventListener('click', (e) => {
            // 点击操作按钮/齿轮/group-tag/del-btn 时不触发选择
            if (e.target.closest('.settings-icon, .group-tag, .del-btn, button')) return;

            const code = tr.dataset.code;
            if (!code) return;

            if (e.shiftKey && lastClickedIndex >= 0) {
                // 阻止 Shift 点击时浏览器默认的文字选中行为
                e.preventDefault();
                // Shift 点击：范围选（只加，不减）
                const start = Math.min(lastClickedIndex, idx);
                const end = Math.max(lastClickedIndex, idx);
                elements.tableBody.querySelectorAll('tr').forEach((r, i) => {
                    if (i >= start && i <= end && r.dataset.code) {
                        selectedCodes.add(r.dataset.code);
                        r.classList.add('selected-row');
                    }
                });
            } else {
                // 普通点击：切换选中状态
                if (selectedCodes.has(code)) {
                    selectedCodes.delete(code);
                    tr.classList.remove('selected-row');
                } else {
                    selectedCodes.add(code);
                    tr.classList.add('selected-row');
                }
                lastClickedIndex = idx;
            }

            updateSelectionStatus();
        });
    });

    updateSelectionStatus();
}

// ==================== 选中状态反馈 ====================
function updateSelectionStatus() {
    const count = selectedCodes.size;
    const fabMain = document.getElementById('fabMain');

    if (count > 0) {
        const countStrong = document.createElement('b');
        countStrong.style.color = '#69b1ff';
        countStrong.textContent = String(count);

        const clearBtn = document.createElement('span');
        clearBtn.id = 'clearSelectionBtn';
        clearBtn.style.color = '#ff7875';
        clearBtn.style.cursor = 'pointer';
        clearBtn.style.fontSize = '11px';
        clearBtn.style.border = '1px solid #ff7875';
        clearBtn.style.borderRadius = '10px';
        clearBtn.style.padding = '1px 7px';
        clearBtn.textContent = '✕ 取消选择';
        clearBtn.onclick = () => {
            clearSelection();
            renderTable();
        };

        elements.selectionStatus.style.display = '';
        elements.selectionStatus.replaceChildren(
            document.createTextNode('已选中 '),
            countStrong,
            document.createTextNode(' 项 '),
            clearBtn
        );
        if (fabMain) fabMain.style.background = '#fa8c16';
    } else {
        elements.selectionStatus.style.display = 'none';
        elements.selectionStatus.replaceChildren();
        if (fabMain) fabMain.style.background = '';
    }
}


function _td(tr, text, colId = null) {
    const td = document.createElement('td');
    td.textContent = text;
    if (colId) {
        td.dataset.col = colId;
        setColumnVisibilityClass(td, colId);
    }
    tr.appendChild(td);
    return td;
}

// 辅助函数：重置单个基金的持仓数据
function resetFundPosition(fund, shouldResetGroup = true) {
    fund.amount = 0;
    fund.shares = 0;
    fund.lastClosedAmount = 0;
    fund.yesterdayProfit = 0;
    if (shouldResetGroup) fund.group = "已撤回"; // 核心：根据参数决定是否改分组
    if (fund.cost !== undefined) fund.cost = 0;
    // 注意：保留 holdProfit (累计收益)
}

function removeFundsFromHistory(codeList) {
    let changed = false;
    codeList.forEach(code => {
        if (fundHistoryData[code]) {
            delete fundHistoryData[code];
            changed = true;
        }
    });
    if (changed) saveFundHistoryData();
}

async function deleteFunds(codeList) {
    if (codeList.length === 0) return;
    const { myFunds } = await storage.get(['myFunds']);
    const funds = myFunds || {};
    codeList.forEach(code => {
        delete funds[code];
    });
    clearSelection();
    removeFundsFromHistory(codeList);
    await storage.set({ myFunds: funds });
}

async function removeFund(code) {
    const ok = await showConfirm(`确定删除 ${code}？`, '删除确认', true);
    if (!ok) return;
    await deleteFunds([code]);
    loadData();
}

function downloadJsonFile(data, fileName) {
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}

function buildFundsExportData({ myFunds, lastUpdateDate, lastDayProfits, dailyProfitHistory, metadata = {} }) {
    return {
        exportTime: new Date().toLocaleString(),
        lastUpdateDate: lastUpdateDate || '',
        lastDayProfits: cloneData(lastDayProfits || {}),
        dailyProfitHistory: normalizeDailyProfitHistory(dailyProfitHistory),
        myFunds: cloneData(myFunds || {}),
        ...metadata
    };
}

async function exportFundsData() {
    const { myFunds, lastUpdateDate, lastDayProfits, dailyProfitHistory } = await storage.get(['myFunds', 'lastUpdateDate', 'lastDayProfits', 'dailyProfitHistory']);
    const fundsData = myFunds || {};
    if (Object.keys(fundsData).length === 0) {
        showToast('暂无可导出的基金数据！', 'warning');
        return;
    }

    const exportData = buildFundsExportData({
        myFunds: fundsData,
        lastUpdateDate,
        lastDayProfits,
        dailyProfitHistory
    });

    const fileName = `基金数据_${formatDateTimeForFile()}.json`;
    downloadJsonFile(exportData, fileName);
    showToast(`✅ 数据导出成功！文件名: ${fileName}`, 'success');
}

async function exportBackupFundsData() {
    const { backupFunds } = await storage.get(['backupFunds']);
    if (!hasTodayBackup(backupFunds)) {
        showToast('今天还没有可导出的备份数据！', 'warning');
        return;
    }

    const exportData = buildFundsExportData({
        myFunds: backupFunds.myFunds,
        lastUpdateDate: backupFunds.lastUpdateDate,
        lastDayProfits: backupFunds.lastDayProfits,
        dailyProfitHistory: backupFunds.dailyProfitHistory,
        metadata: getBackupExportMetadata(backupFunds)
    });

    const backupDateTag = (backupFunds.backupDate || getToday()).replace(/-/g, '');
    const fileName = `基金备份数据_${backupDateTag}_${formatDateTimeForFile()}.json`;
    downloadJsonFile(exportData, fileName);
    showToast(`✅ 备份数据导出成功！文件名: ${fileName}`, 'success');
}



function migrateFund(fund) {
    // 保留所有原始字段，只对数值类型做安全转换，防止旧格式数据类型错误
    return {
        ...fund,
        amount: parseFloat(fund.amount) || 0,
        holdProfit: parseFloat(fund.holdProfit) || 0,
        shares: parseFloat(fund.shares) || 0,
        yesterdayProfit: parseFloat(fund.yesterdayProfit) || 0,
        group: typeof fund.group === 'string' ? fund.group : '默认',
        dividendMode: fund.dividendMode || 'cash',
        savedPrevPrice: fund.savedPrevPrice ? parseFloat(fund.savedPrevPrice) : undefined,
        addedDate: fund.addedDate || null,
        // pendingAdjustments（交易记录）原样保留，不做转换
        pendingAdjustments: Array.isArray(fund.pendingAdjustments) ? fund.pendingAdjustments : [],
    };
}

function importFundsData(event) {
    const fileInput = event.target;
    const file = fileInput.files[0];
    if (!file) return;

    if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
        showToast('请选择 JSON 格式的导出文件！', 'error');
        fileInput.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const importData = JSON.parse(e.target.result);
            if (!importData.myFunds || typeof importData.myFunds !== 'object') {
                await showAlert('导入文件格式错误：未找到有效基金数据！');
                fileInput.value = '';
                return;
            }

            const ok = await showConfirm(
                `确认导入【${importData.exportTime || '未知时间'}】的基金数据？\n注意：当前数据将被覆盖！`,
                '导入确认',
                true
            );
            if (!ok) { fileInput.value = ''; return; }

            const migratedFunds = {};
            for (const [code, fund] of Object.entries(importData.myFunds)) {
                migratedFunds[code] = migrateFund(fund);
            }

            const dataToSave = { myFunds: migratedFunds };
            if (importData.lastUpdateDate) dataToSave.lastUpdateDate = importData.lastUpdateDate;
            if (importData.lastDayProfits) dataToSave.lastDayProfits = importData.lastDayProfits;
            if (importData.dailyProfitHistory) dataToSave.dailyProfitHistory = normalizeDailyProfitHistory(importData.dailyProfitHistory);
            // 清除结算状态，让下次 loadData 重新触发自动结算检测
            dataToSave.lastSettlementDate = null;
            dataToSave.autoSettlementBlockedDate = null;
            // 导入时清空通知中心，旧通知与新导入数据无关
            dataToSave.notifications = [];
            dataToSave.notificationDate = getToday();
            notificationCenter.notifications = [];
            notificationCenter.updateBadge();
            // 注意：走势数据（fundHistoryData）刻意不清空，备份恢复场景下历史走势应当保留。

            await storage.set(dataToSave);
            // silent=true：导入成功提示只弹 toast，不写入通知中心（避免刚清空又立刻写入）
            showToast('✅ 数据导入成功！', 'success', CONFIG.TOAST_NORMAL, true);
            fileInput.value = '';
            loadData();
        } catch (err) {
            await showAlert(`导入失败: ${err.message}`);
            fileInput.value = '';
        }
    };
    reader.readAsText(file);
}



// ==================== OCR 图片识别批量添加资产 ====================
let _ocrModalEl = null;
let _ocrItems = [];

/**
 * 懒加载并缓存 Tesseract Worker（v4 API）
 * @param {Function} onLog - 日志/进度回调
 */
// ── 主线程 OCR（完全绕过 Web Worker，避开 MV3 CSP 限制） ──
// worker.min.js 已改造：暴露 window.__TesseractDispatch，可在主线程直接调用
function _sendToTesseract(action, payload) {
    return new Promise((resolve, reject) => {
        const jobId = 'job_' + Math.random().toString(36).slice(2);
        const workerId = 'main_thread';
        __TesseractDispatch(
            { workerId, jobId, action, payload },
            (msg) => {
                if (msg.status === 'resolve') resolve(msg.data);
                else if (msg.status === 'reject') reject(new Error(msg.data));
                // progress 消息忽略或转发给 onLog
            }
        );
    });
}

async function _getOCRWorker(onLog) {
    if (window._tWorker) return window._tWorker;
    const extRoot = chrome.runtime.getURL('').replace(/\/$/, '');

    // 等待 worker.min.js 在主线程初始化（script 标签已在 popup.html 里加载）
    if (typeof __TesseractDispatch === 'undefined') {
        throw new Error('__TesseractDispatch 未定义，请确认 popup.html 已加载 worker.min.js');
    }

    // 初始化：load -> loadLanguage -> initialize
    await _sendToTesseract('load', {
        options: {
            corePath: chrome.runtime.getURL('tesseract-core.wasm.js'),
            langPath: extRoot,
            logging: false,
        }
    });
    await _sendToTesseract('loadLanguage', {
        langs: 'chi_sim',
        options: { langPath: extRoot, dataPath: null, cachePath: null, cacheMethod: 'none', gzip: false }
    });
    await _sendToTesseract('initialize', {
        langs: 'chi_sim',
        options: {}
    });

    // fake worker 对象，实现 recognize 接口
    const fakeWorker = {
        recognize: async (imageData) => {
            // 把 File/Blob 转成 Uint8Array，dispatchHandlers 需要 typed array
            let imgBuffer = imageData;
            if (imageData instanceof Blob || imageData instanceof File) {
                imgBuffer = new Uint8Array(await imageData.arrayBuffer());
            }
            const result = await new Promise((resolve, reject) => {
                const jobId = 'job_' + Math.random().toString(36).slice(2);
                __TesseractDispatch(
                    {
                        workerId: 'main_thread', jobId, action: 'recognize',
                        payload: {
                            image: imgBuffer, options: {},
                            output: { text: true, blocks: false, hocr: false, tsv: false }
                        }
                    },
                    (msg) => {
                        if (onLog) onLog(msg);
                        if (msg.status === 'resolve') resolve(msg.data);
                        else if (msg.status === 'reject') reject(new Error(String(msg.data)));
                    }
                );
            });
            return { data: result };  // 兼容 Tesseract 标准返回格式
        },
        terminate: () => { window._tWorker = null; }
    };

    window._tWorker = fakeWorker;
    return fakeWorker;
}

/**
 * 通过基金名称反推 6 位基金代码（调用东方财富搜索接口）
 * @param {string} name - 基金名称（部分匹配即可）
 * @returns {Promise<string|null>}
 */
async function getCodeByName(name) {
    if (!name || name.length < 2) return null;

    // 生成渐进缩短的查询变体：全名 → 去联接/ETF后缀 → 纯中文核心词
    function nameVariants(raw) {
        const clean = raw.replace(/\s+/g, '');
        const variants = [clean];
        // 去掉尾部份额标识和联接/LOF/ETF修饰
        let core = clean
            .replace(/发起联接[A-E]?$/, '')
            .replace(/联接[A-E]?$/, '')
            .replace(/指数[A-E]?$/, '')
            .replace(/[（(]LOF[)）]/, '')
            .replace(/ETF/, '')
            .replace(/[A-E]$/, '');
        if (core !== clean && core.length >= 4) variants.push(core);
        // 纯中文核心（去掉所有字母和括号）
        const cjk = raw.replace(/[A-Za-z\(\)\（\）\s]+/g, '')
            .replace(/发起联接$|联接$|指数$/, '');
        if (cjk !== clean && cjk !== core && cjk.length >= 4) variants.push(cjk);
        return [...new Set(variants)];
    }

    for (const query of nameVariants(name)) {
        try {
            const url = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=10&key=${encodeURIComponent(query)}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.Datas && data.Datas.length > 0) {
                // 只接受纯6位数字代码，跳过 F0T001/C4F002 等内部编码
                for (const item of data.Datas) {
                    const code = String(item.CODE || '');
                    if (/^\d{6}$/.test(code)) return code;
                }
            }
        } catch (e) {
            console.warn('[OCR] 代码反查失败:', query, e);
        }
    }
    return null;
}

/**
 * 去除 Tesseract OCR 在中文字符之间插入的多余空格
 * 逐行处理，避免跨行合并
 */
function _normalizeOCR(text) {
    return text.split('\n').map(line => {
        let prev = null, l = line;
        while (prev !== l) {
            prev = l;
            l = l.replace(/([一-龥])\s+([一-龥])/g, '$1$2');
            l = l.replace(/([一-龥])\s+([（）\(\)])/g, '$1$2');
            l = l.replace(/([（）\(\)])\s+([一-龥])/g, '$1$2');
        }
        return l;
    }).join('\n');
}

/**
 * 从 OCR 文本中提取资产信息（支持列表页和详情页）
 *
 * 流程：
 *   1. normalize：去除中文字符间空格（Tesseract chi_sim 常见问题）
 *   2. Mode B：解析列表页（无代码，按"昨日收益/持有收益/总金额"列头定位）
 *   3. Mode A：解析详情页（含6位基金代码），通过标签定位各字段
 *              若持有金额=0，与 Mode B 结果按名称相似度交叉引用
 *   4. 合并：Mode A 结果（带代码）+ 未被引用的 Mode B 结果（需反查代码）
 */
function _parseOCRText(text) {
    console.log('[OCR RAW TEXT]\n', text);

    const normalized = _normalizeOCR(text);
    const lines = normalized.split('\n').map(l => l.trim()).filter(Boolean);
    const fullText = lines.join('\n');
    const result = [];
    if (!lines.length) return result;

    const CODE_RE = /\b(\d{6})\b/;
    // 工厂函数：每次调用返回新实例，避免 /g 正则 lastIndex 状态污染
    const MONEY_RE = () => /[+-]?\d[\d,\.]*\.\d{1,2}(?!\d)(?!\s*%)/g;
    const VAL_RE = () => /[+-]?\d[\d,\.]*\.\d{2}(?!\d)(?!\s*%)/g;
    const NAME_EXCL = /收益|金额|赎回|购买|申购|到账|手续费|销售|暂停|T\+\d|万内/;
    const ALL_LABELS = ['持有金额', '昨日收益', '持有收益率', '持有收益', '持有份额'];

    function parseAmt(str) {
        const s = str.replace(/[^\d\.\+-]/g, '');
        if (!s) return 0;
        const parts = s.replace(/^[+-]/, '').split('.');
        if (parts.length > 2) {
            const sign = s[0] === '-' ? -1 : 1;
            return sign * parseFloat(parts.slice(0, -1).join('') + '.' + parts[parts.length - 1]);
        }
        return parseFloat(s) || 0;
    }

    function isNameLine(s) {
        if (!s || s.length < 2) return false;
        if (!/[\u4e00-\u9fa5]/.test(s)) return false;
        if (NAME_EXCL.test(s)) return false;
        if (CODE_RE.test(s)) return false;
        if (/^\d+(\.\d+)?$/.test(s)) return false;
        const cjk = (s.match(/[\u4e00-\u9fa5]/g) || []).length;
        return cjk / s.replace(/\s/g, '').length >= 0.3;
    }

    function nameSimilar(a, b) {
        const ca = a.replace(/[^\u4e00-\u9fa5]/g, '');
        const cb = b.replace(/[^\u4e00-\u9fa5]/g, '');
        if (!ca || !cb || ca.length < 4 || cb.length < 4) return false;
        const [shorter, longer] = ca.length <= cb.length ? [ca, cb] : [cb, ca];
        return longer.includes(shorter);
    }

    // 从 startFrom 位置开始找标签（持有收益 需跳过 持有收益率）
    function getLabelPosFrom(lbl, startFrom) {
        if (lbl !== '持有收益') {
            const idx = fullText.indexOf(lbl, startFrom);
            return idx !== -1 ? idx : undefined;
        }
        let s = startFrom;
        while (true) {
            const idx = fullText.indexOf(lbl, s);
            if (idx === -1) return undefined;
            if (fullText[idx + lbl.length] !== '率') return idx;
            s = idx + 1;
        }
    }

    // 提取标签后到下一个标签前的文本片段（从 startFrom 开始搜索标签）
    function segAfterLabel(lbl, startFrom) {
        const pos = getLabelPosFrom(lbl, startFrom);
        if (pos === undefined) return '';
        const segStart = pos + lbl.length;
        let segEnd = segStart + 200;
        ALL_LABELS.forEach(other => {
            if (other === lbl) return;
            const op = getLabelPosFrom(other, startFrom);
            if (op !== undefined && op > segStart && op < segEnd) segEnd = op;
        });
        return fullText.slice(segStart, segEnd);
    }

    function maxPosNum(seg) {
        let best = 0;
        for (const m of (seg.match(MONEY_RE()) || [])) {
            const v = parseAmt(m);
            if (v > best) best = v;
        }
        return best;
    }

    function firstNum(seg, mustPos = false) {
        for (const m of (seg.match(MONEY_RE()) || [])) {
            const v = parseAmt(m);
            if (mustPos && v < 0) continue;
            return v;
        }
        return 0;
    }

    // ══════════════════════════════════════════════
    // STEP 1: Mode B — 列表页解析
    // ══════════════════════════════════════════════
    const COL_HEAD_RE = /昨日收|总金额/;
    const modeB = [];
    const seenNames = new Set();

    for (let i = 0; i < lines.length; i++) {
        if (!COL_HEAD_RE.test(lines[i])) continue;
        const hasYesterday = /昨日收/.test(lines[i]);

        let dataLine = '';
        for (let j = i + 1; j <= Math.min(i + 3, lines.length - 1); j++) {
            const ms = lines[j].match(VAL_RE());
            if (ms && ms.length >= 2) { dataLine = lines[j]; break; }
        }
        if (!dataLine) continue;

        const nums = (dataLine.match(VAL_RE()) || []).map(parseAmt);
        let yp = 0, hp = 0, amt = 0;
        if (hasYesterday && nums.length >= 3) {
            [yp, hp, amt] = [nums[0], nums[1], nums[2]];
        } else if (nums.length >= 3) {
            [yp, hp, amt] = [nums[0], nums[1], nums[2]];
        } else if (nums.length === 2) {
            [hp, amt] = [nums[0], nums[1]];
        } else if (nums.length === 1) {
            amt = nums[0];
        }
        // 安全兜底：amt 取最大正数
        const posNums = nums.filter(v => v > 0);
        if (posNums.length && Math.max(...posNums) > amt) amt = Math.max(...posNums);

        let fundName = '';
        for (let k = i - 1; k >= Math.max(0, i - 6); k--) {
            if (isNameLine(lines[k])) { fundName = lines[k]; break; }
        }
        if (!fundName || seenNames.has(fundName)) continue;
        seenNames.add(fundName);

        modeB.push({
            code: '', name: fundName, amount: amt, holdProfit: hp, yesterdayProfit: yp,
            shares: 0, group: '默认', selected: true, _needLookup: true, _claimed: false
        });
    }

    // ══════════════════════════════════════════════
    // STEP 2: Mode A — 详情页（含6位基金代码）
    // ══════════════════════════════════════════════
    const seenCodes = new Set();

    for (let i = 0; i < lines.length; i++) {
        const codeMatch = lines[i].match(CODE_RE);
        if (!codeMatch) continue;
        const code = codeMatch[1];
        if (seenCodes.has(code)) continue;
        seenCodes.add(code);

        let fundName = '';
        for (let k = i - 1; k >= Math.max(0, i - 4); k--) {
            if (/[\u4e00-\u9fa5]/.test(lines[k])) { fundName = lines[k]; break; }
        }

        const codePos = fullText.indexOf(code);
        const startFrom = Math.max(0, codePos - 10);

        let amount = maxPosNum(segAfterLabel('持有金额', startFrom));
        let yesterday = firstNum(segAfterLabel('昨日收益', startFrom));
        let hold = firstNum(segAfterLabel('持有收益', startFrom));

        // ── 详情页金额重建：持有金额大字体常被OCR漏识别
        //    若 amount=0，在代码附近寻找"昨日收益/持有收益/持有收益率"三标签合并行，
        //    然后从下一个数值行提取 [yesterday, holdProfit] 和 持有收益率%，
        //    用公式 amount = holdProfit / rate% + holdProfit 反推持仓金额 ──
        if (!amount) {
            const RATE_RE = /(\d+\.?\d*)\s*%/g;
            // 在 startFrom 之后的行里找含"昨日收益"或"持有收益率"的行
            const linesAfterCode = lines.slice(i);
            for (let li = 0; li < linesAfterCode.length; li++) {
                const lbl = linesAfterCode[li];
                if (!/昨日收益|持有收益/.test(lbl)) continue;
                // 找下一个有数字的行
                for (let vi = li + 1; vi <= Math.min(li + 3, linesAfterCode.length - 1); vi++) {
                    const valLine = linesAfterCode[vi];
                    const nums = (valLine.match(MONEY_RE()) || []).map(m => parseAmt(m));
                    const rates = [];
                    let rm;
                    RATE_RE.lastIndex = 0;
                    while ((rm = RATE_RE.exec(valLine)) !== null) rates.push(parseFloat(rm[1]));
                    if (!nums.length) continue;
                    // 更新 yesterday / hold（若之前标签解析失败）
                    if (!yesterday && nums[0] !== undefined) yesterday = nums[0];
                    if (!hold && nums[1] !== undefined) hold = nums[1];
                    // 反推金额
                    if (rates.length && Math.abs(rates[0]) > 0.01 && hold !== 0) {
                        const rateDec = rates[0] / 100;
                        amount = Math.round((hold / rateDec + hold) * 100) / 100;
                    }
                    break;
                }
                if (amount) break;
            }
        }

        // 与 Mode B 交叉引用：找所有名称相似的条目，全部标记为已引用
        for (const b of modeB) {
            if (nameSimilar(fundName, b.name)) {
                b._claimed = true;
                // 若 amount 仍为 0，从 Mode B 补充
                if (!amount && b.amount) {
                    amount = b.amount;
                    if (!hold) hold = b.holdProfit;
                    if (!yesterday) yesterday = b.yesterdayProfit;
                }
            }
        }

        result.push({
            code, name: fundName, amount, holdProfit: hold, yesterdayProfit: yesterday,
            shares: 0, group: '默认', selected: true, _needLookup: false
        });
    }

    // ══════════════════════════════════════════════
    // STEP 3: 合并未被引用的 Mode B 条目
    // ══════════════════════════════════════════════
    for (const b of modeB) {
        if (!b._claimed) {
            delete b._claimed;
            result.push(b);
        }
    }

    return result;
}

/**
 * 渲染识别结果为可编辑表格（含昨日收益、持有收益列）
 */
function _renderOCRTable() {
    const container = _ocrModalEl.querySelector('#_ocrResults');
    if (!_ocrItems.length) {
        container.innerHTML = '<p style="text-align:center;color:#6a8aaa;font-size:12px;padding:20px;">未识别到有效资产信息，请确认图片是否清晰</p>';
        return;
    }
    const C = 'padding:4px 3px;';
    const I = 'background:#0d1b2e;border:1px solid #2a4a72;border-radius:4px;color:#c8d8f0;padding:2px 4px;font-size:11px;width:100%;box-sizing:border-box;';

    let html = `
        <table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed;">
            <colgroup>
                <col style="width:24px">
                <col style="width:68px">
                <col style="width:64px">
                <col style="width:80px">
                <col style="width:74px">
                <col style="width:74px">
                <col style="width:48px">
            </colgroup>
            <thead><tr style="color:#4a6a90;border-bottom:1px solid #1e3a5f;white-space:nowrap;">
                <th style="${C}"><input type="checkbox" id="_ocrChkAll" checked></th>
                <th style="${C}">代码</th>
                <th style="${C}">基金名称</th>
                <th style="${C}">持仓金额(元)</th>
                <th style="${C}">持有收益(元)</th>
                <th style="${C}">昨日收益(元)</th>
                <th style="${C}">分组</th>
            </tr></thead>
            <tbody>`;

    _ocrItems.forEach((a, idx) => {
        // 代码缺失时用红色边框提示
        const codeStyle = a.code ? '' : 'border-color:#f5222d;';
        const hpVal = (a.holdProfit !== undefined && a.holdProfit !== 0) ? a.holdProfit : '';
        const ypVal = (a.yesterdayProfit !== undefined && a.yesterdayProfit !== 0) ? a.yesterdayProfit : '';
        const nameStr = (a.name || '').replace(/"/g, '&quot;');
        html += `<tr style="border-bottom:1px solid #141f30;">
            <td style="${C}"><input type="checkbox" class="_oc" data-i="${idx}" ${a.selected ? 'checked' : ''}></td>
            <td style="${C}"><input type="text" style="${I}${codeStyle}" value="${a.code || ''}" class="_oe" data-i="${idx}" data-f="code" placeholder="待填"></td>
            <td style="${C}" title="${nameStr}"><span style="color:#8aacce;font-size:10px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${a.name || '—'}</span></td>
            <td style="${C}"><input type="number" style="${I}" value="${a.amount || ''}" class="_oe" data-i="${idx}" data-f="amount" step="0.01" placeholder="0"></td>
            <td style="${C}"><input type="number" style="${I}" value="${hpVal}" class="_oe" data-i="${idx}" data-f="holdProfit" step="0.01" placeholder="0"></td>
            <td style="${C}"><input type="number" style="${I}" value="${ypVal}" class="_oe" data-i="${idx}" data-f="yesterdayProfit" step="0.01" placeholder="0"></td>
            <td style="${C}"><input type="text" style="${I}" value="${a.group}" class="_oe" data-i="${idx}" data-f="group"></td>
        </tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;

    // 全选/取消全选
    container.querySelector('#_ocrChkAll').onchange = function () {
        _ocrItems.forEach(a => a.selected = this.checked);
        container.querySelectorAll('._oc').forEach(cb => cb.checked = this.checked);
    };
    // 单行勾选
    container.querySelectorAll('._oc').forEach(cb => {
        cb.onchange = () => { _ocrItems[+cb.dataset.i].selected = cb.checked; };
    });
    // 字段编辑（数字字段允许负值）
    container.querySelectorAll('._oe').forEach(inp => {
        inp.oninput = () => {
            const idx = +inp.dataset.i, f = inp.dataset.f;
            const numFields = ['amount', 'holdProfit', 'yesterdayProfit', 'shares'];
            _ocrItems[idx][f] = numFields.includes(f)
                ? (parseFloat(inp.value) || 0) : inp.value;
        };
    });
}

/**
 * 打开 OCR 批量添加弹窗
 */
function openOCRBatchAdd() {
    if (_ocrModalEl) return;

    // 打开时就给 3 个空行，这样界面一出来就有表格可以手动填
    _ocrItems = [
        { code: '', name: '', amount: '', holdProfit: '', yesterdayProfit: '', group: '默认', selected: true },
        { code: '', name: '', amount: '', holdProfit: '', yesterdayProfit: '', group: '默认', selected: true },
        { code: '', name: '', amount: '', holdProfit: '', yesterdayProfit: '', group: '默认', selected: true }
    ];

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);z-index:20000;display:flex;align-items:center;justify-content:center;';

    // HTML 结构彻底清理，去掉了不存在的 ID，顶部直接展示混合输入区
    overlay.innerHTML = `
        <div style="background:#111f35;border:1px solid #2a4a72;border-radius:12px;width:600px;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 16px 48px rgba(0,0,0,.6);overflow:hidden;">
            <div style="padding:13px 18px;border-bottom:1px solid #1e3a5f;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
                <span style="font-size:14px;font-weight:700;color:#e8f0ff;">⚡ 批量添加数据</span>
                <span id="_ocrClose" style="cursor:pointer;color:#6a8aaa;font-size:20px;line-height:1;padding:0 2px;">✕</span>
            </div>
            
            <div style="padding:14px; display:flex; gap:10px; border-bottom:1px solid #1e3a5f; flex-shrink:0; background:#0a1525;">
                <textarea id="_batchText" placeholder="在此粘贴纯文本 (如: 000001 1000)\n或者直接在下方表格手动录入..." style="flex:1; height:60px; background:#0d1b2e; border:1px solid #2a4a72; border-radius:6px; color:#c8d8f0; padding:8px; font-size:12px; resize:none;"></textarea>
                <div style="display:flex; flex-direction:column; gap:8px; width:100px;">
                    <button id="_btnParseText" style="flex:1; background:#1a2f50; color:#8aacce; border:1px solid #2a4a72; border-radius:6px; cursor:pointer; font-size:12px;">解析文本</button>
                    <button id="_ocrPickBtn" style="flex:1; background:#1890ff; border:none; color:#fff; border-radius:6px; cursor:pointer; font-size:12px; font-weight:bold;">📷 传图识别</button>
                </div>
            </div>
            <input type="file" id="_ocrFile" accept="image/*" multiple style="display:none;">
            
            <div id="_ocrProg" style="display:none;padding:8px 16px;font-size:12px;color:#fa8c16;background:rgba(250,140,22,0.1);flex-shrink:0;"></div>
            
            <div id="_ocrResults" style="flex:1;overflow-y:auto;padding:10px 14px;min-height:240px;"></div>
            
            <div id="_ocrFoot" style="padding:10px 16px;border-top:1px solid #1e3a5f;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
                <button id="_ocrAddRow" style="background:transparent; border:1px dashed #2a4a72; color:#69b1ff; border-radius:6px; padding:6px 14px; font-size:12px; cursor:pointer;">+ 增加一行</button>
                <button id="_ocrSave" style="background:#1890ff;color:#fff;border:none;border-radius:6px;padding:7px 22px;font-size:13px;font-weight:600;cursor:pointer;">批量保存</button>
            </div>
        </div>`;

    document.body.appendChild(overlay);
    _ocrModalEl = overlay;

    const closeOCRModal = () => {
        overlay.remove();
        _ocrModalEl = null;
        _ocrItems = [];
    };

    overlay.onclick = (e) => {
        if (e.target === overlay) {
            closeOCRModal();
        }
    };

    // 直接渲染表格
    _renderOCRTable();

    // 绑定事件
    overlay.querySelector('#_ocrClose').onclick = closeOCRModal;

    const fileInput = overlay.querySelector('#_ocrFile');
    overlay.querySelector('#_ocrPickBtn').onclick = () => fileInput.click();
    fileInput.onchange = () => _runOCR(Array.from(fileInput.files));

    overlay.querySelector('#_ocrAddRow').onclick = () => {
        _ocrItems.push({ code: '', name: '', amount: '', holdProfit: '', yesterdayProfit: '', group: '默认', selected: true });
        _renderOCRTable();
    };

    overlay.querySelector('#_btnParseText').onclick = () => {
        const text = overlay.querySelector('#_batchText').value;
        const lines = text.split('\n');
        // 过滤掉当前完全空白的行，腾出位置
        _ocrItems = _ocrItems.filter(item => item.code || item.amount);
        lines.forEach(line => {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 2 && /^\d{6}$/.test(parts[0])) {
                _ocrItems.push({
                    code: parts[0], name: '', amount: parseFloat(parts[1]) || 0,
                    holdProfit: 0, yesterdayProfit: 0, group: '默认', selected: true
                });
            }
        });
        overlay.querySelector('#_batchText').value = '';
        _renderOCRTable();
    };

    overlay.querySelector('#_ocrSave').onclick = _saveOCRItems;
}

/**
 * 执行 OCR 识别流程（支持详情页/列表页双模式）
 */
async function _runOCR(files) {
    const imgs = files.filter(f => f.type.startsWith('image/'));
    if (!imgs.length) { showToast('请选择图片文件', 'warning'); return; }

    const prog = _ocrModalEl.querySelector('#_ocrProg');
    prog.style.display = 'block';
    prog.textContent = '⏳ 正在初始化OCR引擎，首次加载需要几秒...';

    // 清空现有的空行，准备装入图片识别数据
    _ocrItems = _ocrItems.filter(item => item.code || item.amount);

    try {
        const worker = await _getOCRWorker(m => {
            if (m.status === 'recognizing text' && _ocrModalEl) {
                prog.textContent = `⏳ 识别中... ${Math.round((m.progress || 0) * 100)}%`;
            }
        });

        for (let i = 0; i < imgs.length; i++) {
            if (!_ocrModalEl) return;
            prog.textContent = `⏳ 正在识别第 ${i + 1} / ${imgs.length} 张图片...`;
            const { data: { text } } = await worker.recognize(imgs[i]);
            _ocrItems.push(..._parseOCRText(text));
        }

        if (!_ocrModalEl) return; // 去重前检查弹窗是否已关闭
        const seenCodes = new Set();
        const seenNames = new Set();
        _ocrItems = _ocrItems.filter(a => {
            if (a.code) {
                if (seenCodes.has(a.code)) return false;
                seenCodes.add(a.code); return true;
            }
            if (a.name) {
                if (seenNames.has(a.name)) return false;
                seenNames.add(a.name); return true;
            }
            return true; // 允许手动填写的无代码无名称行保留
        });

        const needLookup = _ocrItems.filter(a => a._needLookup && a.name);
        if (!_ocrModalEl) return; // 反查代码前检查弹窗是否已关闭
        if (needLookup.length > 0) {
            prog.textContent = `⏳ 正在反查基金代码（${needLookup.length} 条）...`;
            await Promise.all(needLookup.map(async (a) => {
                const code = await getCodeByName(a.name);
                a.code = code || '';
                a._needLookup = false;
            }));
        }

        if (_ocrItems.length) {
            const found = _ocrItems.filter(a => a.code).length;
            prog.textContent = `✅ 识别完成（${found} 个找到代码），请核对后批量保存`;
        } else {
            prog.textContent = '⚠️ 未识别到有效基金信息，请手动补充';
        }

        if (!_ocrModalEl) return; // 渲染前检查弹窗是否已关闭
        _renderOCRTable();
    } catch (e) {
        prog.textContent = '❌ 识别失败：' + e.message;
    }
}

/**
 * 批量保存已选中的 OCR 识别结果
 */
async function _saveOCRItems() {
    const toSave = _ocrItems.filter(a => a.selected && String(a.code || '').trim());
    if (!toSave.length) { showToast('请至少勾选一个有效代码的资产', 'warning'); return; }

    const btn = _ocrModalEl.querySelector('#_ocrSave');
    btn.disabled = true;
    btn.textContent = '保存中...';

    try {
        const { myFunds } = await storage.get(['myFunds']);
        const funds = myFunds || {};
        for (const a of toSave) {
            const code = String(a.code).trim().toUpperCase();
            if (!code) continue;
            const existing = funds[code] || {};
            // 拉取实际净值作为结算锚点，避免用 1 导致首次结算收益异常
            let actualPrevPrice = existing.savedPrevPrice;
            if (!actualPrevPrice) {
                try {
                    const liveInfo = await fetchLiveInfo(code);
                    actualPrevPrice = liveInfo?.prevPrice || 0;
                } catch (e) {
                    actualPrevPrice = 0;
                }
            }
            funds[code] = {
                ...existing,
                name: a.name || existing.name || '',
                amount: a.amount ?? 0,
                holdProfit: a.holdProfit ?? 0,
                yesterdayProfit: a.yesterdayProfit ?? 0,
                group: a.group || '默认',
                savedPrevPrice: actualPrevPrice || existing.savedPrevPrice || undefined,
                savedPrevDate: existing.savedPrevDate || getToday(),
                addedDate: existing.addedDate || getToday(),  // 防止历史分红被误检测
            };
            if (a.shares && a.shares > 0) {
                funds[code].shares = a.shares;
            }
        }

        await storage.set({ myFunds: funds });
        showToast(`✅ 成功保存 ${toSave.length} 个资产！`, 'success');
        _ocrModalEl.remove();
        _ocrModalEl = null;
        _ocrItems = [];
        loadData();
    } catch (e) {
        btn.disabled = false;
        btn.textContent = '批量保存选中';
        showToast('保存失败：' + e.message, 'error');
    }
}

// ==================== 基金详情弹窗 ====================

/**
 * 打开基金详情弹窗
 * @param {string} code - 基金代码
 */
async function openFundDetail(code) {
    const overlay = document.getElementById('fundDetailOverlay');
    const title = document.getElementById('fundDetailTitle');
    const content = document.getElementById('fundDetailContent');

    beginFundDetailSession(code);
    const isStale = createFundDetailStaleGuard(code);
    overlay.classList.add('visible');
    observeFundDetailLayout();
    applyFundDetailSize();
    content.innerHTML = '<div class="detail-loading">加载中...</div>';

    try {
        // 获取基金实时行情和持仓数据
        const [live, { myFunds }] = await Promise.all([
            fetchLiveInfo(code),
            storage.get(['myFunds'])
        ]);

        if (isStale()) return;

        if (!live || !live.name) {
            content.innerHTML = '<div class="detail-error">无法获取基金信息</div>';
            return;
        }

        const fundData = (myFunds || {})[code] || {};
        title.textContent = live.name;

        const unitValue = live.prevPrice;
        const estimateValue = live.price;
        const estimateRate = unitValue > 0 ? ((estimateValue - unitValue) / unitValue * 100) : (live.rate || 0);

        const holdAmount = fundData.amount || 0;
        const shares = fundData.shares || 0;
        const todayProfit = shares > 0 && unitValue > 0 && estimateValue > 0
            ? round2(shares * (estimateValue - unitValue))
            : (estimateRate !== 0 ? round2(holdAmount * (estimateRate / 100)) : 0);
        const holdProfit = fundData.holdProfit || 0;

        // 从 pingzhongdata 异步拉取：昨日涨幅 + 历史净值分时数据
        // 这是社区公认最权威、最全的基金数据接口
        let yesterdayRate = typeof live.rate === 'number' ? live.rate : 0; // 先占位

        const upClass = 'up';
        const downClass = 'down';

        // 构建详情页面
        let html = `
            <div style="padding: 18px 16px 0; background: #0a1525;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:12px;">
                   <div style="display:flex; flex-direction:column; gap:2px; min-width:0;">
                      <div style="font-size:12px; color:#4a6a90; font-weight:600;">基金代码: ${code}</div>
                   </div>
                   <div class="estimation-box">
                      <div class="estimation-label">最后更新 / 估值时间</div>
                      <div class="estimation-time">${live.priceTime || getToday() + ' 15:00'}</div>
                   </div>
                </div>

                <!-- 核心数据看板：Row 1 (净值与涨幅) -->
                <div style="display:grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap:16px; margin-bottom:18px; border-bottom: 1px solid #1e3a5f; padding-bottom: 18px;">
                    <div class="detail-info-item">
                        <span class="detail-info-label">单位净值</span>
                        <span class="detail-info-value bold">${unitValue.toFixed(4)}</span>
                    </div>
                    <div class="detail-info-item">
                        <span class="detail-info-label">昨日涨幅</span>
                        <span id="detail-yesterday-rate" class="detail-info-value bold ${yesterdayRate >= 0 ? upClass : downClass}">
                             ${formatProfit(yesterdayRate, '%')}
                        </span>
                    </div>
                    <div class="detail-info-item">
                        <span class="detail-info-label">估值净值</span>
                        <span class="detail-info-value bold ${estimateRate >= 0 ? upClass : downClass}">${estimateValue.toFixed(4)}</span>
                    </div>
                    <div class="detail-info-item">
                        <span class="detail-info-label">估值涨幅</span>
                        <span class="detail-info-value bold ${estimateRate >= 0 ? upClass : downClass}">
                            ${formatProfit(estimateRate, '%')}
                        </span>
                    </div>
                </div>

                <!-- 核心数据看板：Row 2 (收益情况) -->
                <div style="display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap:16px; padding-bottom:14px;">
                    <div class="detail-info-item">
                        <span class="detail-info-label">持仓金额</span>
                        <span class="detail-info-value hero">${holdAmount.toFixed(2)}</span>
                    </div>
                    <div class="detail-info-item">
                        <span class="detail-info-label">当日预估收益</span>
                        <span class="detail-info-value hero ${todayProfit >= 0 ? upClass : downClass}">
                            ${formatProfit(todayProfit)}
                        </span>
                    </div>
                    <div class="detail-info-item">
                        <span class="detail-info-label">持有收益</span>
                        <span class="detail-info-value hero ${holdProfit >= 0 ? upClass : downClass}">
                            ${formatProfit(holdProfit)}
                        </span>
                    </div>
                </div>
            </div>

            <!-- 实时走势图 -->
            <div class="detail-chart-section" style="padding: 0 16px 24px; margin-top:-5px;">
                <div style="font-size:11px;color:#4a6a90;margin-bottom:8px; display:flex; justify-content:space-between;">
                    <span>📈 今日估值走势 (${getToday()})</span>
                    <span style="font-size:10px; opacity:0.6;">${getIntradayChartRangeLabel()}</span>
                </div>
                <div style="position:relative;">
                    <canvas id="detailChart" style="width:100%;height:220px;display:block;"></canvas>
                    <div id="chartTooltip" style="display:none;position:absolute;background:rgba(10,21,37,0.9);border:1px solid #1e3a5f;border-radius:6px;padding:6px 10px;pointer-events:none;min-width:120px;"></div>
                </div>
            </div>

            <div style="height: 10px; background: #0a1525; border-top: 1px solid #1e3a5f;"></div>

            <!-- Tab 切换 -->
            <div class="detail-tabs">
                <div class="detail-tab active" data-tab="holdings">前10重仓股票</div>
                <div class="detail-tab" data-tab="performance">历史走势</div>
            </div>

            <!-- Tab 内容：重仓股 -->
            <div class="detail-tab-content active" id="tabHoldings">
                <div class="detail-loading">正在实时请求重仓股行情...</div>
            </div>

            <!-- Tab 内容：历史走势 -->
            <div class="detail-tab-content" id="tabPerformance">
                <div class="detail-loading">加载历史数据...</div>
            </div>
        `;

        if (isStale()) return;
        content.innerHTML = html;

        // ① 实时走势：优先用本地 fundHistoryData 缓存（每次 loadData 刷新时追加）
        (() => {
            const cached = fundHistoryData[code];
            let pts = (cached && cached.points && cached.points.length > 0) ? cached.points : null;
            if (pts) {
                pts = ensureIntradayBasePoint(pts);
            } else {
                // 无缓存：用当前估值率画两点兜底（09:30 ~ 当前时刻）
                const rate = unitValue > 0 ? ((estimateValue - unitValue) / unitValue * 100) : 0;
                const nowT = formatTime();
                pts = getIntradayFallbackPoints(rate, nowT);
            }
            // canvas 须等 DOM 渲染完成后再绘制
            requestAnimationFrame(() => {
                if (isStale()) return;
                fundDetailChartRenderState.intraday = {
                    code,
                    currentPrice: estimateValue || 0,
                    basePrice: unitValue || 0,
                    points: Array.isArray(pts) ? [...pts] : []
                };
                drawChart(code, estimateValue, unitValue, pts);
                syncFundDetailLayout();
            });
        })();

        // ② 用已有的 live 数据直接计算昨日涨幅，无需重复请求 pingzhongdata
        (() => {
            let yRate = 0;
            if (live.prevTradingDayPrice && live.prevTradingDayPrice > 0 && live.prevPrice > 0) {
                yRate = (live.prevPrice - live.prevTradingDayPrice) / live.prevTradingDayPrice * 100;
            } else if (typeof live.rate === 'number') {
                yRate = live.rate;
            }
            const yEl = document.getElementById('detail-yesterday-rate');
            if (yEl && !isStale()) {
                yEl.textContent = formatProfit(yRate, '%');
                yEl.className = 'detail-info-value bold ' + (yRate >= 0 ? 'up' : 'down');
            }
        })();

        // 绑定 Tab 切换事件
        content.querySelectorAll('.detail-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                content.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
                content.querySelectorAll('.detail-tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                const tabName = tab.dataset.tab;
                document.getElementById(`tab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`).classList.add('active');
                syncFundDetailLayout();
            });
        });

        // 异步加载重仓股和业绩数据
        Promise.allSettled([
            loadHoldings(code, isStale),
            loadPerformance(code, live, isStale)
        ]).finally(() => {
            if (!isStale()) {
                syncFundDetailLayout();
            }
        });

    } catch (err) {
        if (isStale()) return;
        content.innerHTML = `<div class="detail-error">加载失败: ${err.message}</div>`;
    }
}

/**
 * 绘制分时/历史走势图
 * @param {string} code
 * @param {number} currentPrice - 当前估值净值
 * @param {number} basePrice - 昨日净值（基准线）
 * @param {Array} chartPoints - [{time, rate}] 真实数据点，为空则显示单点占位
 */
function drawChart(code, currentPrice, basePrice, chartPoints) {
    const canvas = document.getElementById('detailChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || canvas.parentElement?.clientWidth || canvas.offsetWidth || 400;
    const height = rect.height || canvas.offsetHeight || 220;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const padding = { top: 20, right: 10, bottom: 30, left: 52 };
    const cw = width - padding.left - padding.right;
    const ch = height - padding.top - padding.bottom;

    let points = chartPoints && chartPoints.length > 0 ? chartPoints : [];
    if (points.length === 0) {
        const rate = basePrice > 0 ? ((currentPrice - basePrice) / basePrice * 100) : 0;
        points = [{ time: '--', rate: 0 }, { time: getToday(), rate }];
    }

    const rates = points.map(p => p.rate);
    const absMax = Math.max(Math.abs(Math.max(...rates)), Math.abs(Math.min(...rates)), 0.05);
    const yMax = absMax * 1.2, yMin = -absMax * 1.2, yRange = yMax - yMin;
    const toY = r => padding.top + ch * (1 - (r - yMin) / yRange);

    const isIntraday = points.length > 0 && isIntradayChartTime(points[0].time);
    const toX = isIntraday
        ? t => padding.left + (cw / CONSTANTS.INTRADAY_CHART_TOTAL_MINUTES) * getIntradayChartOffsetMinutes(t)
        : (_, i) => padding.left + (cw / Math.max(points.length - 1, 1)) * i;

    const lastRate = rates[rates.length - 1];
    const isUp = lastRate >= 0;
    const lineColor = isUp ? '#ff7875' : '#73d13d';

    // 背景
    ctx.fillStyle = '#0a1525';
    ctx.fillRect(0, 0, width, height);

    // 网格线
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = padding.top + (ch / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(padding.left + cw, y);
        ctx.stroke();
    }

    // 0轴
    const zeroY = toY(0);
    ctx.strokeStyle = 'rgba(100,140,180,0.5)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padding.left, zeroY);
    ctx.lineTo(padding.left + cw, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    // 面积渐变
    const grad = ctx.createLinearGradient(0, padding.top, 0, padding.top + ch);
    if (isUp) {
        grad.addColorStop(0, 'rgba(245,34,45,0.25)');
        grad.addColorStop(1, 'rgba(245,34,45,0)');
    } else {
        grad.addColorStop(0, 'rgba(57,181,110,0)');
        grad.addColorStop(1, 'rgba(57,181,110,0.25)');
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(isIntraday ? toX(points[0].time) : toX(null, 0), zeroY);
    points.forEach((p, i) => ctx.lineTo(isIntraday ? toX(p.time) : toX(null, i), toY(p.rate)));
    ctx.lineTo(isIntraday ? toX(points[points.length - 1].time) : toX(null, points.length - 1), zeroY);
    ctx.closePath();
    ctx.fill();

    // 折线
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    points.forEach((p, i) => {
        const x = isIntraday ? toX(p.time) : toX(null, i);
        if (i === 0) ctx.moveTo(x, toY(p.rate));
        else ctx.lineTo(x, toY(p.rate));
    });
    ctx.stroke();

    // Y轴标签
    ctx.fillStyle = '#4a6a90';
    ctx.font = '10px Inter';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
        const r = yMax - (yRange / 4) * i;
        ctx.fillText(formatProfit(r, '%'), padding.left - 4, padding.top + (ch / 4) * i + 4);
    }

    // X轴标签
    ctx.textAlign = 'center';
    ctx.fillStyle = '#4a6a90';
    if (isIntraday) {
        getIntradayAxisTicks().forEach(({ time, min }) => {
            ctx.fillText(time, padding.left + (cw / CONSTANTS.INTRADAY_CHART_TOTAL_MINUTES) * min, height - 8);
        });
    } else {
        const idxs = [0, Math.floor(points.length / 2), points.length - 1];
        idxs.forEach(idx => {
            if (points[idx]) ctx.fillText(points[idx].time, toX(null, idx), height - 8);
        });
    }

    // Tooltip 交互
    canvas.onmousemove = (e) => {
        const tooltip = document.getElementById('chartTooltip');
        if (!tooltip) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        if (x < padding.left || x > padding.left + cw) {
            tooltip.style.display = 'none';
            return;
        }
        let idx = 0, minDist = Infinity;
        points.forEach((p, i) => {
            const px = isIntraday ? toX(p.time) : toX(null, i);
            const d = Math.abs(px - x);
            if (d < minDist) { minDist = d; idx = i; }
        });
        const pt = points[idx];
        if (pt) {
            const clr = pt.rate >= 0 ? '#ff7875' : '#73d13d';
            const est = basePrice > 0 ? '¥' + (basePrice * (1 + pt.rate / 100)).toFixed(4) + ' ' : '';
            tooltip.innerHTML = `<div style="font-size:10px;color:#8aacce;">${pt.time}</div><div style="font-size:12px;font-weight:bold;color:#e8f0ff;">${est}<span style="color:${clr}">${formatProfit(pt.rate, '%')}</span></div>`;
            tooltip.style.display = 'block';
            const pr = canvas.parentElement.getBoundingClientRect();
            let left = (rect.left - pr.left) + x + 12;
            if (left + 145 > pr.width) left = (rect.left - pr.left) + x - 155;
            tooltip.style.left = left + 'px';
            tooltip.style.top = ((rect.top - pr.top) + (e.clientY - rect.top) - 52) + 'px';
        }
    };
    canvas.onmouseleave = () => {
        const t = document.getElementById('chartTooltip');
        if (t) t.style.display = 'none';
    };
}


/**
 * 加载基金重仓股信息
 * @param {string} code - 基金代码
 */
async function loadHoldings(code, isStale = createFundDetailStaleGuard(code)) {
    const container = document.getElementById('tabHoldings');
    if (!container || isStale()) return;

    try {
        const url = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition?FCODE=${code}&deviceid=Wap&plat=Wap&product=EFund&version=6.5.9`;
        const res = await fetch(url);
        const data = await res.json();

        if (isStale()) return;

        const stockCodes = [];
        const stockNames = [];
        const stockPercents = [];

        if (data && data.Datas && data.Datas.fundStocks && data.Datas.fundStocks.length > 0) {
            data.Datas.fundStocks.forEach(stock => {
                stockCodes.push(stock.GPDM);
                stockNames.push(stock.GPJC);
                stockPercents.push(stock.JZBL);
            });
        }

        if (stockCodes.length === 0) {
            container.innerHTML = '<div class="detail-error">接口获取不到数据</div>';
            return;
        }

        console.log('[loadHoldings] 获取到', stockCodes.length, '只重仓股');

        // 构建腾讯股票代码列表
        const stockList = stockCodes.slice(0, 10).map((c, idx) => {
            const stockData = data.Datas.fundStocks[idx];
            if (stockData.TEXCH === '1') return 'sh' + c;
            if (stockData.TEXCH === '2') return 'sz' + c;
            if (stockData.TEXCH === '5' || stockData.TEXCH === '8' || stockData.NEWTEXCH === '116') {
                let hkCode = c;
                while (hkCode.length < 5) hkCode = '0' + hkCode;
                return 'hk' + hkCode;
            }
            if (c.startsWith('6')) return 'sh' + c;
            return 'sz' + c;
        });

        const stockPrices = await fetchStockPrices(stockList);

        let html = '<div class="holdings-grid">';
        stockCodes.slice(0, 10).forEach((stockCode, idx) => {
            const marketCode = stockList[idx];
            const priceInfo = stockPrices[marketCode] || { rate: 0 };
            const changeClass = priceInfo.rate >= 0 ? 'up' : 'down';
            const changeSign = priceInfo.rate >= 0 ? '+' : '';
            const name = stockNames[idx] || stockCode;
            const percent = stockPercents[idx] || '--';

            html += `
                <div class="holding-card">
                    <div class="holding-card-left">
                        <div class="holding-card-name">${name}</div>
                        <div class="holding-card-badge">${stockCode} · ${percent}%</div>
                    </div>
                    <div class="holding-card-right">
                        <div class="holding-card-rate ${changeClass}">${changeSign}${priceInfo.rate.toFixed(2)}%</div>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        if (isStale()) return;
        container.innerHTML = html;

    } catch (err) {
        if (isStale()) return;
        container.innerHTML = '<div class="detail-error">接口获取不到数据</div>';
        console.error('[loadHoldings] 加载持仓失败:', err);
    }
}

// ==================== 区间涨跌幅后台拉取 ====================

function parseYmdDate(dateStr) {
    if (typeof dateStr !== 'string') return null;
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (
        date.getFullYear() !== year
        || date.getMonth() !== month - 1
        || date.getDate() !== day
    ) {
        return null;
    }
    return date;
}

function calcHoldDays(addedDate, today = getToday()) {
    const todayDate = parseYmdDate(today);
    const added = parseYmdDate(addedDate || '');
    if (!todayDate || !added) return null;
    return Math.max(0, Math.floor((todayDate.getTime() - added.getTime()) / 86400000));
}

function normalizePerfRateValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'number' || Number.isNaN(value)) return null;
    return round2(value);
}

function normalizeFundPerfDailyCache(rawCache = {}) {
    if (!rawCache || typeof rawCache !== 'object') return {};
    const normalized = {};
    Object.entries(rawCache).forEach(([code, entry]) => {
        if (!entry || typeof entry !== 'object') return;
        const asOfDate = typeof entry.asOfDate === 'string' && parseYmdDate(entry.asOfDate)
            ? entry.asOfDate
            : '';
        if (!asOfDate) return;
        normalized[code] = {
            asOfDate,
            w1: normalizePerfRateValue(entry.w1),
            m1: normalizePerfRateValue(entry.m1),
            m3: normalizePerfRateValue(entry.m3),
            m6: normalizePerfRateValue(entry.m6),
            y1: normalizePerfRateValue(entry.y1),
            ly: normalizePerfRateValue(entry.ly)
        };
    });
    return normalized;
}

async function ensureFundPerfDailyCacheLoaded() {
    if (fundPerfDailyCacheLoaded) return;
    try {
        const stored = await storage.get([CONFIG.PERF_DAILY_CACHE_STORAGE_KEY]);
        fundPerfDailyCacheByCode = normalizeFundPerfDailyCache(stored[CONFIG.PERF_DAILY_CACHE_STORAGE_KEY] || {});
    } catch (err) {
        console.warn('[fundPerf] 读取日级缓存失败:', err);
        fundPerfDailyCacheByCode = {};
    }

    fundPerfDailyCacheLoaded = true;
}

async function persistFundPerfDailyCache() {
    try {
        await storage.set({
            [CONFIG.PERF_DAILY_CACHE_STORAGE_KEY]: fundPerfDailyCacheByCode
        });
    } catch (err) {
        console.warn('[fundPerf] 保存日级缓存失败:', err);
    }
}

function createEmptyFundPerfDailyEntry(asOfDate) {
    return {
        asOfDate,
        w1: null,
        m1: null,
        m3: null,
        m6: null,
        y1: null,
        ly: null
    };
}

function buildFundPerfDisplayData(code, addedDate) {
    const holdDays = calcHoldDays(addedDate);
    const cached = fundPerfDailyCacheByCode[code];
    return {
        holdDays,
        w1: normalizePerfRateValue(cached?.w1),
        m1: normalizePerfRateValue(cached?.m1),
        m3: normalizePerfRateValue(cached?.m3),
        m6: normalizePerfRateValue(cached?.m6),
        y1: normalizePerfRateValue(cached?.y1),
        ly: normalizePerfRateValue(cached?.ly)
    };
}

async function hydrateFundPerfCache(funds, codes) {
    await ensureFundPerfDailyCacheLoaded();
    const codeSet = new Set(codes);
    const nextDisplayCache = {};

    codes.forEach(code => {
        nextDisplayCache[code] = buildFundPerfDisplayData(code, funds[code]?.addedDate || '');
    });
    fundPerfCache = nextDisplayCache;

    let changed = false;
    Object.keys(fundPerfDailyCacheByCode).forEach(code => {
        if (!codeSet.has(code)) {
            delete fundPerfDailyCacheByCode[code];
            changed = true;
        }
    });

    if (changed) {
        await persistFundPerfDailyCache();
    }
}

/**
 * 计算区间涨跌幅：(末净值 - 首净值) / 首净值 * 100
 */
function calcRateFromNavData(navData, startDate) {
    if (!Array.isArray(navData) || navData.length < 2) return null;
    const filtered = navData.filter(d => d.date >= startDate);
    if (filtered.length < 2) return null;
    const first = filtered[0].price;
    const last = filtered[filtered.length - 1].price;
    if (!first) return null;
    return round2((last - first) / first * 100);
}

function calcRateFromFirstNav(navData) {
    if (!Array.isArray(navData) || navData.length < 2) return null;
    const first = navData[0]?.price;
    const last = navData[navData.length - 1]?.price;
    if (!(first > 0) || !(last > 0)) return null;
    return round2((last - first) / first * 100);
}

/**
 * 拉取单只基金的区间涨跌幅（不直接改展示缓存，返回计算结果）
 */
async function fetchFundPerfData(code) {
    try {
        const today = getToday();
        const todayDate = parseYmdDate(today);
        if (!todayDate) return null;

        const getStart = (days) => formatDate(new Date(todayDate.getTime() - days * 86400000));
        const lyStart = '2000-01-01';

        // 统一复用历史净值数据源：优先读详情页缓存（_netValueCache 的 LY），无缓存再拉全历史
        let navData = getCachedPerformanceData(code, 'LY', lyStart, today);
        if (!Array.isArray(navData) || navData.length < 2) {
            navData = await fetchAndCacheFullPerformanceHistory(code, today);
        }

        if (!Array.isArray(navData) || navData.length < 2) {
            return null;
        }

        const normalizedNavData = navData
            .map(item => ({
                date: item?.date,
                price: parseFloat(item?.price)
            }))
            .filter(item => typeof item.date === 'string' && item.date && Number.isFinite(item.price) && item.price > 0)
            .sort((a, b) => a.date.localeCompare(b.date));

        if (normalizedNavData.length < 2) {
            return null;
        }

        return {
            w1: calcRateFromNavData(normalizedNavData, getStart(7)),
            m1: calcRateFromNavData(normalizedNavData, getStart(30)),
            m3: calcRateFromNavData(normalizedNavData, getStart(90)),
            m6: calcRateFromNavData(normalizedNavData, getStart(180)),
            y1: calcRateFromNavData(normalizedNavData, getStart(365)),
            ly: calcRateFromFirstNav(normalizedNavData),
        };
    } catch (e) {
        return null;
    }
}

let fundPerfRefreshPromise = null;

/**
 * 后台批量拉取所有基金区间涨跌幅
 */
async function fetchAllFundPerfData(fundsOverride = null) {
    if (!document.body.classList.contains('is-fullscreen')) return;
    if (fundPerfRefreshPromise) return fundPerfRefreshPromise;

    fundPerfRefreshPromise = (async () => {
        await ensureFundPerfDailyCacheLoaded();
        const funds = fundsOverride || (await storage.get(['myFunds'])).myFunds || {};
        const codes = allFundsData.map(d => d.code);
        const today = getToday();

        let cacheChanged = false;

        for (const code of codes) {
            const addedDate = funds[code]?.addedDate || '';
            fundPerfCache[code] = buildFundPerfDisplayData(code, addedDate);

            const cached = fundPerfDailyCacheByCode[code];
            if (cached?.asOfDate === today && PERF_FIELDS.every(field => field === 'holdDays' || cached[field] !== null && cached[field] !== undefined)) {
                const tr = document.querySelector(`#fundTableBody tr[data-code="${code}"]`);
                if (tr) renderFundPerfCells(tr, code);
                continue;
            }

            const fetchedPerf = await fetchFundPerfData(code);
            if (fetchedPerf) {
                fundPerfDailyCacheByCode[code] = {
                    asOfDate: today,
                    ...fetchedPerf
                };
                fundPerfCache[code] = buildFundPerfDisplayData(code, addedDate);
                cacheChanged = true;

                const tr = document.querySelector(`#fundTableBody tr[data-code="${code}"]`);
                if (tr) renderFundPerfCells(tr, code);
            } else {
                const fallbackEntry = cached
                    ? {
                        asOfDate: today,
                        w1: normalizePerfRateValue(cached.w1),
                        m1: normalizePerfRateValue(cached.m1),
                        m3: normalizePerfRateValue(cached.m3),
                        m6: normalizePerfRateValue(cached.m6),
                        y1: normalizePerfRateValue(cached.y1),
                        ly: normalizePerfRateValue(cached.ly)
                    }
                    : createEmptyFundPerfDailyEntry(today);

                fundPerfDailyCacheByCode[code] = fallbackEntry;
                fundPerfCache[code] = buildFundPerfDisplayData(code, addedDate);
                cacheChanged = true;
            }

            await new Promise(r => setTimeout(r, 80)); // 避免并发过多
        }


        if (cacheChanged) {
            await persistFundPerfDailyCache();
        }
    })().finally(() => {
        fundPerfRefreshPromise = null;
    });

    return fundPerfRefreshPromise;
}

/**
 * 渲染单行的区间涨跌幅 td
 */
function renderFundPerfCells(tr, code) {
    const perf = fundPerfCache[code];
    const fields = PERF_FIELDS;
    fields.forEach(field => {
        const td = tr.querySelector(`[data-perf="${field}"]`);
        if (!td) return;
        if (!perf) {
            td.textContent = '—';
            td.className = 'col-hide perf-cell';
            setColumnVisibilityClass(td, field);
            return;
        }
        if (field === 'holdDays') {
            td.textContent = perf.holdDays !== null ? `${perf.holdDays}天` : '—';
            td.className = 'col-hide perf-cell';
            setColumnVisibilityClass(td, field);
        } else {
            const val = perf[field];
            if (val === null || val === undefined) {
                td.textContent = '—';
                td.className = 'col-hide perf-cell';
                setColumnVisibilityClass(td, field);
            } else {
                td.textContent = formatProfit(val, '%');
                td.className = `col-hide perf-cell ${val >= 0 ? 'up' : 'down'}`;
                setColumnVisibilityClass(td, field);
            }
        }
    });
}

/**
 * 获取基金历史净值数据
 */
async function fetchFundNetValues(code, startDate, endDate, pageSize = 200, { preferFullHistory = false } = {}) {
    try {
        if (!preferFullHistory) {
            const url = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNHisNetList?FCODE=${code}&PAGEINDEX=1&PAGESIZE=${pageSize}&SDATE=${startDate}&EDATE=${endDate}&deviceid=wap&plat=Wap`;
            const res = await fetch(url);
            const data = await res.json();

            if (Array.isArray(data?.Datas) && data.Datas.length > 0) {
                console.log('[fetchFundNetValues] 区间接口成功，获取到', data.Datas.length, '条历史数据');
                return data.Datas.reverse().map(item => ({
                    date: item.FSRQ,
                    price: parseFloat(item.DWJZ)
                }));
            }
        }

        const url2 = `https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`;
        const res2 = await fetch(url2);
        const text = await res2.text();

        const match = text.match(/var\s+Data_netWorthTrend\s*=\s*(\[[\s\S]+?\]);/);
        if (match) {
            try {
                const trendData = JSON.parse(match[1]);
                if (Array.isArray(trendData) && trendData.length > 0) {
                    const startTime = new Date(startDate).getTime();
                    const endTime = new Date(endDate).getTime();

                    const filtered = trendData
                        .filter(item => item.x >= startTime && item.x <= endTime)
                        .map(item => ({
                            date: formatDate(item.x),
                            price: parseFloat(item.y)
                        }));

                    if (filtered.length > 0) {
                        console.log('[fetchFundNetValues] 全历史接口成功，获取到', filtered.length, '条历史数据');
                        return filtered;
                    }
                }
            } catch (parseErr) {
                console.warn('[fetchFundNetValues] 全历史接口解析失败:', parseErr);
            }
        }

        console.warn('[fetchFundNetValues] 所有方案均未获取到数据');
        return null;
    } catch (e) {
        console.error('[fetchFundNetValues] 获取基金净值失败:', e);
        return null;
    }
}

function getPerformancePeriodRank(period) {
    const index = PERFORMANCE_PERIOD_ORDER.indexOf(period);
    return index >= 0 ? index : PERFORMANCE_PERIOD_ORDER.length;
}

function filterPerformanceDataByDate(fundData, startStr, endStr) {
    if (!Array.isArray(fundData) || fundData.length === 0) {
        return [];
    }
    return fundData.filter(item => item?.date >= startStr && item?.date <= endStr);
}

function touchPerformanceCacheCode(code) {
    const cacheByCode = _netValueCache[code];
    if (!cacheByCode) return;
    delete _netValueCache[code];
    _netValueCache[code] = cacheByCode;
}

function getExactPerformanceCacheHit(entry, startStr, endStr) {
    if (!entry || !Array.isArray(entry.fundData) || entry.fundData.length === 0) {
        return null;
    }
    if (entry.startStr === startStr && entry.endStr === endStr) {
        return entry.fundData;
    }
    if (entry.startStr <= startStr && entry.endStr >= endStr) {
        return filterPerformanceDataByDate(entry.fundData, startStr, endStr);
    }
    return null;
}

function trimPerformanceCodeCache() {
    const cacheCodes = Object.keys(_netValueCache);
    while (cacheCodes.length > PERFORMANCE_CACHE_MAX_CODES) {
        delete _netValueCache[cacheCodes.shift()];
    }
}

function getCachedPerformanceData(code, period, startStr, endStr) {
    const cacheByCode = _netValueCache[code];
    if (!cacheByCode) return null;

    const exactHit = getExactPerformanceCacheHit(cacheByCode[period], startStr, endStr);
    if (exactHit) {
        return exactHit;
    }

    const targetRank = getPerformancePeriodRank(period);
    const broaderEntry = Object.entries(cacheByCode)
        .filter(([cachedPeriod, entry]) => {
            if (!entry || !Array.isArray(entry.fundData) || entry.fundData.length === 0) return false;
            if (getPerformancePeriodRank(cachedPeriod) < targetRank) return false;
            return entry.startStr <= startStr && entry.endStr >= endStr;
        })
        .sort((left, right) => getPerformancePeriodRank(left[0]) - getPerformancePeriodRank(right[0]))[0]?.[1];

    return broaderEntry
        ? filterPerformanceDataByDate(broaderEntry.fundData, startStr, endStr)
        : null;
}

function getWidestCachedPerformancePeriod(code) {
    const cacheByCode = _netValueCache[code];
    if (!cacheByCode) return '';

    return Object.keys(cacheByCode)
        .filter(period => Array.isArray(cacheByCode[period]?.fundData) && cacheByCode[period].fundData.length > 0)
        .sort((left, right) => getPerformancePeriodRank(right) - getPerformancePeriodRank(left))[0] || '';
}

function shouldFetchFullPerformanceHistory(code, period) {
    if (period === 'LY') return true;
    const widestCachedPeriod = getWidestCachedPerformancePeriod(code);
    if (!widestCachedPeriod) return false;
    return getPerformancePeriodRank(widestCachedPeriod) < getPerformancePeriodRank(period);
}

function clearPerformanceCacheEntry(code, period) {
    if (!_netValueCache[code]) return;
    if (period) {
        delete _netValueCache[code][period];
    }
    if (Object.keys(_netValueCache[code]).length === 0) {
        delete _netValueCache[code];
    }
}

function cachePerformanceFundData(code, period, startStr, endStr, fundData) {
    if (!Array.isArray(fundData)) {
        return;
    }
    if (!_netValueCache[code]) {
        _netValueCache[code] = {};
    }
    touchPerformanceCacheCode(code);
    _netValueCache[code][period] = {
        startStr,
        endStr,
        fundData
    };

    const activeRank = getPerformancePeriodRank(period);
    Object.keys(_netValueCache[code]).forEach(cachedPeriod => {
        if (cachedPeriod === period) return;
        if (getPerformancePeriodRank(cachedPeriod) < activeRank) {
            clearPerformanceCacheEntry(code, cachedPeriod);
        }
    });
    trimPerformanceCodeCache();
}

function getPerformanceRequestOptions(code, period) {
    return {
        pageSize: getPerformancePeriodPageSize(period),
        preferFullHistory: shouldFetchFullPerformanceHistory(code, period)
    };
}

async function fetchAndCacheFullPerformanceHistory(code, endStr) {
    const startStr = '2000-01-01';
    const fundData = await fetchFundNetValues(code, startStr, endStr, getPerformancePeriodPageSize('LY'), { preferFullHistory: true });
    cachePerformanceFundData(code, 'LY', startStr, endStr, fundData);
    return Array.isArray(fundData) ? fundData : null;
}

function mergeLatestConfirmedNav(fundData, latestNav) {
    if (!Array.isArray(fundData) || fundData.length === 0 || !latestNav?.date || !(latestNav.price > 0)) {
        return Array.isArray(fundData) ? fundData : [];
    }

    const lastIndex = fundData.length - 1;
    const lastItem = fundData[lastIndex];
    if (!lastItem) return fundData;

    if (lastItem.date === latestNav.date) {
        if (lastItem.price === latestNav.price) {
            return fundData;
        }
        const nextData = [...fundData];
        nextData[lastIndex] = { ...lastItem, price: latestNav.price };
        return nextData;
    }

    if (lastItem.date < latestNav.date) {
        return [...fundData, { date: latestNav.date, price: latestNav.price }];
    }
    return fundData;
}

function getPerformancePeriodDateRange(period) {
    const endDate = new Date();
    const startDate = new Date();
    const periodConfig = PERFORMANCE_PERIODS[period];
    if (period === 'LY') startDate.setFullYear(2000);
    else startDate.setMonth(startDate.getMonth() - (periodConfig?.months || 1));
    return {
        startStr: formatDate(startDate),
        endStr: formatDate(endDate)
    };
}

function getPerformancePeriodPageSize(period) {
    if (period === 'LY') return 200;
    const months = PERFORMANCE_PERIODS[period]?.months || 1;
    return Math.max(200, Math.ceil(months * 35));
}

function buildPerformanceSummaryHtml(periodLabel, totalRate, isUp) {
    return `<span style="color:#8aacce;">${periodLabel}涨跌幅</span>
            <span style="font-weight:bold;color:${isUp ? '#ff7875' : '#73d13d'};">${totalRate}%</span>`;
}

function setPerformancePanelState(code, summary, preview, moreLink, summaryText, previewText) {
    if (_performanceState[code]) {
        _performanceState[code].fundData = [];
    }
    resetPerformanceViewState();
    summary.textContent = summaryText;
    if (preview) preview.innerHTML = `<div class="perf-nav-empty">${previewText}</div>`;
    if (moreLink) moreLink.style.display = 'none';
}

function setPerformanceLoadingState(code, summary, preview, moreLink) {
    setPerformancePanelState(code, summary, preview, moreLink, '加载中...', '加载中...');
}

function setPerformanceEmptyState(code, summary, preview, moreLink, text) {
    setPerformancePanelState(
        code,
        summary,
        preview,
        moreLink,
        text,
        text === '加载失败' ? '加载失败' : '暂无历史净值'
    );
}

function renderPerformanceResult(code, fundData, summary, preview, moreLink, canvas) {
    const state = getCurrentPerformanceState(code);
    const chartData = getPerformanceChartData(fundData);
    const periodLabel = getPerformancePeriodLabel(state?.period);
    if (!chartData) {
        setPerformanceEmptyState(code, summary, preview, moreLink, '暂无数据');
        return;
    }

    if (state) {
        state.fundData = fundData;
    }

    const firstPrice = chartData.prices[0];
    const lastPrice = chartData.prices[chartData.prices.length - 1];
    const totalRate = ((lastPrice - firstPrice) / firstPrice * 100).toFixed(2);
    const recentList = getRecentPerformancePreviewList(fundData);

    hidePerformanceTooltip();
    summary.innerHTML = buildPerformanceSummaryHtml(periodLabel, totalRate, chartData.isUp);
    if (preview) preview.innerHTML = renderPerformanceNavPreview(recentList);
    if (moreLink) moreLink.style.display = fundData.length > recentList.length ? 'inline' : 'none';

    canvas.style.width = '100%';
    canvas.style.height = '220px';
    drawPerfChart(canvas, chartData.prices, chartData.dates, chartData.isUp);
    syncFundDetailLayout();
}

function renderPerformanceContainer(container) {
    container.innerHTML = `
        <div style="padding: 14px 0 10px;">
            <div id="perfPeriodBtns" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
                ${PERFORMANCE_PERIOD_ORDER.map((p, i) => `
                    <button class="perf-btn" data-period="${p}"
                        style="padding:5px 12px;border-radius:16px;border:1px solid #1e3a5f;font-size:12px;
                        cursor:pointer;background:${i === 0 ? '#1890ff' : '#0d1b2e'};color:${i === 0 ? '#fff' : '#4a6a90'};transition:all 0.2s;">
                        ${getPerformancePeriodLabel(p)}
                    </button>
                `).join('')}
            </div>
            <div id="perfSummary" style="text-align:right;font-size:12px;color:#4a6a90;margin-bottom:8px;">加载中...</div>
            <div style="position:relative;">
                <canvas id="perfChart" style="width:100%;height:220px;display:block;"></canvas>
                <div id="perfChartTooltip" style="display:none;position:absolute;background:rgba(10,21,37,0.9);border:1px solid #1e3a5f;border-radius:6px;padding:6px 10px;pointer-events:none;min-width:120px;z-index:100;"></div>
            </div>
            <div class="perf-nav-section">
                <div class="perf-nav-header">
                    <span class="perf-nav-title">历史净值</span>
                    <span id="perfMoreLink" class="modal-link" style="display:none;">更多</span>
                </div>
                <div id="perfNavPreview" class="perf-nav-preview">
                    <div class="perf-nav-empty">加载中...</div>
                </div>
            </div>
        </div>
    `;
}

function bindPerformanceMoreLink(code) {
    const moreLink = document.getElementById('perfMoreLink');
    if (moreLink) {
        moreLink.onclick = () => {
            const state = getCurrentPerformanceState(code);
            if (!state || !Array.isArray(state.fundData) || state.fundData.length === 0) return;
            showPerformanceNavListModal(code, getPerformancePeriodLabel(state.period), state.fundData);
        };
    }
}

function bindPerformancePeriodButtons(container, code, isStale) {
    container.querySelectorAll('.perf-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (isStale()) return;
            container.querySelectorAll('.perf-btn').forEach(b => {
                b.style.background = b === btn ? '#1890ff' : '#0d1b2e';
                b.style.color = b === btn ? '#fff' : '#4a6a90';
            });
            loadPerformancePeriod(code, btn.dataset.period, isStale);
        });
    });
}


/**
 * 加载历史走势数据（多周期历史净值图表）
 */
async function loadPerformance(code, live, isStale = createFundDetailStaleGuard(code)) {
    const container = document.getElementById('tabPerformance');
    if (!container || isStale()) return;

    const defaultPerformancePeriod = PERFORMANCE_PERIOD_ORDER[0];
    _performanceState[code] = {
        period: defaultPerformancePeriod,
        fundData: [],
        latestNav: {
            date: live?.prevPriceDate || '',
            price: live?.prevPrice || 0
        },
        requestId: 0
    };

    renderPerformanceContainer(container);
    bindPerformanceMoreLink(code);
    bindPerformancePeriodButtons(container, code, isStale);

    await loadPerformancePeriod(code, defaultPerformancePeriod, isStale);
}

const PERFORMANCE_CACHE_MAX_CODES = 6;
// 历史净值缓存（可跨详情会话复用）：{ code: { period: { startStr, endStr, fundData } } }
const _netValueCache = {};
// 历史走势当前会话状态：{ code: { period, fundData, latestNav, requestId } }
const _performanceState = {};

const PERFORMANCE_PERIOD_ORDER = ['1M', '3M', '6M', '1Y', '3Y', 'LY'];
const PERFORMANCE_PERIODS = {
    '1M': { label: '近1月', months: 1 },
    '3M': { label: '近3月', months: 3 },
    '6M': { label: '近6月', months: 6 },
    '1Y': { label: '近1年', months: 12 },
    '3Y': { label: '近3年', months: 36 },
    'LY': { label: '成立来' }
};

function getPerformancePeriodLabel(period) {
    return PERFORMANCE_PERIODS[period]?.label || period;
}

function renderPerformanceNavPreview(list) {
    if (!Array.isArray(list) || list.length === 0) {
        return '<div class="perf-nav-empty">暂无历史净值</div>';
    }
    return list.map(item => `
        <div class="perf-nav-row">
            <span class="perf-nav-date">${item.date}</span>
            <span class="perf-nav-price">${item.price.toFixed(4)}</span>
        </div>
    `).join('');
}

function showPerformanceNavListModal(code, periodLabel, fundData) {
    if (!Array.isArray(fundData) || fundData.length === 0) {
        showToast('暂无历史净值数据', 'error');
        return;
    }
    let rows = '';
    for (let i = fundData.length - 1; i >= 0; i--) {
        const item = fundData[i];
        rows += `
        <div class="perf-nav-row full">
            <span class="perf-nav-date">${item.date}</span>
            <span class="perf-nav-price">${item.price.toFixed(4)}</span>
        </div>
    `;
    }
    showHtmlModal(`${code} ${periodLabel}历史净值`, `<div class="perf-nav-modal-list">${rows}</div>`);
}

/**
 * 具体加载某个周期的业绩图表
 */
async function loadPerformancePeriod(code, period, isStale = createFundDetailStaleGuard(code)) {
    const summary = document.getElementById('perfSummary');
    const canvas = document.getElementById('perfChart');
    const preview = document.getElementById('perfNavPreview');
    const moreLink = document.getElementById('perfMoreLink');
    if (!canvas || !summary || isStale()) return;

    const state = getCurrentPerformanceState(code);
    if (state) {
        state.period = period;
        state.requestId = (state.requestId || 0) + 1;
    }

    const requestId = state?.requestId || 0;
    const isStaleRequest = () => isStale() || _performanceState[code]?.requestId !== requestId;
    if (isStaleRequest()) return;

    const { startStr, endStr } = getPerformancePeriodDateRange(period);

    try {
        setPerformanceLoadingState(code, summary, preview, moreLink);

        let fundData = getCachedPerformanceData(code, period, startStr, endStr);
        if (!fundData) {
            const { pageSize, preferFullHistory } = getPerformanceRequestOptions(code, period);
            if (preferFullHistory) {
                const fullHistoryData = await fetchAndCacheFullPerformanceHistory(code, endStr);
                if (isStaleRequest()) return;
                fundData = Array.isArray(fullHistoryData)
                    ? filterPerformanceDataByDate(fullHistoryData, startStr, endStr)
                    : null;
            } else {
                fundData = await fetchFundNetValues(code, startStr, endStr, pageSize, { preferFullHistory: false });
                if (isStaleRequest()) return;
                cachePerformanceFundData(code, period, startStr, endStr, fundData);
            }
        }

        if (!Array.isArray(fundData)) {
            setPerformanceEmptyState(code, summary, preview, moreLink, '暂无数据');
            return;
        }

        if (isStaleRequest()) return;

        fundData = mergeLatestConfirmedNav(fundData, state?.latestNav);

        if (!Array.isArray(fundData) || fundData.length === 0) {
            setPerformanceEmptyState(code, summary, preview, moreLink, '暂无数据');
            return;
        }

        renderPerformanceResult(code, fundData, summary, preview, moreLink, canvas);
    } catch (err) {
        if (isStaleRequest()) return;
        setPerformanceEmptyState(code, summary, preview, moreLink, '加载失败');
        console.error('[loadPerformancePeriod] 业绩数据加载失败:', err);
    }
}

/**
 * 绘制业绩折线图（Y轴为涨跌幅%，支持隐藏tab下的canvas尺寸）
 */
function drawPerfChart(canvas, prices, dates, isUp) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.parentElement?.clientWidth || canvas.getBoundingClientRect().width || canvas.parentElement?.offsetWidth || canvas.offsetWidth || 360;
    const height = canvas.getBoundingClientRect().height || parseInt(canvas.style.height) || canvas.offsetHeight || 220;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const pad = { top: 10, right: 10, bottom: 28, left: 52 };
    const cw = width - pad.left - pad.right;
    const ch = height - pad.top - pad.bottom;

    // 转换为相对期初的涨跌幅百分比
    const baseP = prices[0];
    const returns = prices.map(p => (p - baseP) / baseP * 100);
    const maxR = Math.max(...returns, 0.01);
    const minR = Math.min(...returns, -0.01);
    const range = maxR - minR || 0.01;

    const color = isUp ? '#ff7875' : '#73d13d';
    const maxIndex = Math.max(prices.length - 1, 1);
    const toX = i => pad.left + (cw / maxIndex) * i;
    const toY = r => pad.top + ch * (1 - (r - minR) / range);

    let currentHoverIndex = null;
    let pendingHoverIndex = null;
    let hoverFrameId = null;

    const renderChart = (hoverIndex = null) => {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // 背景
        ctx.fillStyle = '#111f35';
        ctx.fillRect(0, 0, width, height);

        // 网格线
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 3; i++) {
            const y = pad.top + (ch / 3) * i;
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(pad.left + cw, y);
            ctx.stroke();
        }

        // 0 轴基准线（虚线）
        const zeroY = toY(0);
        if (zeroY >= pad.top && zeroY <= pad.top + ch) {
            ctx.strokeStyle = 'rgba(100,140,180,0.5)';
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(pad.left, zeroY);
            ctx.lineTo(pad.left + cw, zeroY);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // 面积图填充
        const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch);
        gradient.addColorStop(0, isUp ? 'rgba(255,120,117,0.3)' : 'rgba(115,209,61,0.3)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(toX(0), zeroY);
        returns.forEach((r, i) => ctx.lineTo(toX(i), toY(r)));
        ctx.lineTo(toX(returns.length - 1), zeroY);
        ctx.closePath();
        ctx.fill();

        // 折线
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        returns.forEach((r, i) => {
            if (i === 0) ctx.moveTo(toX(i), toY(r));
            else ctx.lineTo(toX(i), toY(r));
        });
        ctx.stroke();

        // hover 辅助线和高亮点
        if (hoverIndex !== null && hoverIndex >= 0 && hoverIndex < returns.length) {
            const hoverX = toX(hoverIndex);
            const hoverY = toY(returns[hoverIndex]);
            ctx.strokeStyle = 'rgba(105,177,255,0.65)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(hoverX, pad.top);
            ctx.lineTo(hoverX, pad.top + ch);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(pad.left, hoverY);
            ctx.lineTo(pad.left + cw, hoverY);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = '#0a1525';
            ctx.beginPath();
            ctx.arc(hoverX, hoverY, 4.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(hoverX, hoverY, 4.5, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Y 轴标签（涨跌幅%）
        ctx.fillStyle = '#4a6a90';
        ctx.font = '10px Inter';
        ctx.textAlign = 'right';
        for (let i = 0; i <= 3; i++) {
            const r = maxR - (range / 3) * i;
            ctx.fillText(formatProfit(r, '%'), pad.left - 4, pad.top + (ch / 3) * i + 4);
        }

        // X 轴标签（首、中、尾，格式 MM-DD）
        ctx.textAlign = 'center';
        ctx.fillStyle = '#4a6a90';
        const fmtD = s => s ? s.slice(5) : '';
        if (dates.length > 0) {
            const mid = Math.floor(dates.length / 2);
            ctx.fillText(fmtD(dates[0]), toX(0), height - 8);
            ctx.fillText(fmtD(dates[mid]), toX(mid), height - 8);
            ctx.fillText(fmtD(dates[dates.length - 1]), toX(dates.length - 1), height - 8);
        }
    };

    renderChart();

    const scheduleHoverRender = (hoverIndex) => {
        pendingHoverIndex = hoverIndex;
        if (hoverFrameId) return;
        hoverFrameId = requestAnimationFrame(() => {
            hoverFrameId = null;
            if (currentHoverIndex === pendingHoverIndex) return;
            currentHoverIndex = pendingHoverIndex;
            renderChart(currentHoverIndex);
        });
    };

    // Tooltip 交互
    canvas.onmousemove = (e) => {
        const tooltip = document.getElementById('perfChartTooltip');
        if (!tooltip) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        if (x < pad.left || x > pad.left + cw) {
            hidePerformanceTooltip();
            scheduleHoverRender(null);
            return;
        }
        const relativeX = Math.max(0, Math.min(cw, x - pad.left));
        const idx = Math.max(0, Math.min(prices.length - 1, Math.round((relativeX / cw) * maxIndex)));
        scheduleHoverRender(idx);
        const r = returns[idx];
        const date = dates[idx];
        const p = prices[idx];
        if (date) {
            const clr = r >= 0 ? '#ff7875' : '#73d13d';
            const est = '净值: ' + parseFloat(p).toFixed(4);
            tooltip.innerHTML = `<div style="font-size:10px;color:#8aacce;">${date}</div><div style="font-size:12px;font-weight:bold;color:#e8f0ff;">${est} <span style="color:${clr};margin-left:6px;">${formatProfit(r, '%')}</span></div>`;
            tooltip.style.display = 'block';
            const pr = canvas.parentElement.getBoundingClientRect();
            let left = (rect.left - pr.left) + x + 12;
            if (left + 145 > pr.width) left = (rect.left - pr.left) + x - 155;
            tooltip.style.left = left + 'px';
            tooltip.style.top = ((rect.top - pr.top) + Math.min(Math.max((e.clientY - rect.top) - 52, 0), ch)) + 'px';
        }
    };
    canvas.onmouseleave = () => {
        hidePerformanceTooltip();
        scheduleHoverRender(null);
    };
}

async function fetchStockPrices(codes) {
    if (!codes || codes.length === 0) return {};

    try {
        // 切换至腾讯财经接口，避免新浪的 403 限制
        const list = codes.join(',');
        const url = `https://qt.gtimg.cn/q=${list}`;
        const response = await fetch(url);
        // 腾讯接口返回的是 GBK 编码（扩展里通常能自动处理，或这里手动 decode）
        const buffer = await response.arrayBuffer();
        const decoder = new TextDecoder('gbk');
        const text = decoder.decode(buffer);

        const result = {};
        const lines = text.split(';');

        lines.forEach(line => {
            if (!line.trim() || !line.includes('~')) return;

            const parts = line.split('~');
            if (parts.length < 33) return;

            // 腾讯格式：1:名称, 2:代码, 3:当前价, 4:昨收价, 5:开盘价... 32:涨跌幅
            const fullCode = parts[0].match(/v_([a-z0-9]+)=/)[1];
            const rate = parseFloat(parts[32]) || 0;

            result[fullCode] = { rate };
        });

        return result;
    } catch (err) {
        console.error('获取股票行情失败:', err);
        return {};
    }
}

/**
 * 关闭基金详情弹窗
 */
function closeFundDetail() {
    const overlay = document.getElementById('fundDetailOverlay');
    const box = document.querySelector('.fund-detail-box');
    const fitBtn = document.getElementById('fundDetailFitBtn');
    const closedCode = currentFundDetailCode;
    currentFundDetailSessionId += 1;
    currentFundDetailCode = '';
    if (overlay) overlay.classList.remove('visible');
    if (fundDetailResizeObserver) {
        fundDetailResizeObserver.disconnect();
        fundDetailResizeObserver = null;
    }
    cancelFundDetailLayoutSync();
    fundDetailFitPage = false;
    cleanupFundDetailSessionState(closedCode);
    if (box) box.classList.remove('fit-page');
    if (fitBtn) fitBtn.textContent = '贴合页面';
}
// getCodeByName 和 OCR 双模式解析已整合至上方 _parseOCRText / _runOCR 函数