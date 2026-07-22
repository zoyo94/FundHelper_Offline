// ==================== 配置常量 ====================
const CONFIG = {
    BATCH_SIZE: 10,              // API 并发批大小
    API_TIMEOUT: 8000,           // API 请求超时（ms）
    BATCH_DELAY: 100,            // 批次间延迟（ms）
    TRADING_CUTOFF_HOUR: 15,     // 交易截止时间（小时）
    TRADING_CUTOFF_MINUTE: 0,    // 交易截止时间（分钟）
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
    PERF_DAILY_CACHE_STORAGE_KEY: 'fundPerfDailyCacheV2',
    LIVE_API_REQUEST_DATE_STORAGE_KEY: 'liveApiRequestDate',
    LIVE_API_FINAL_REQUEST_DATE_STORAGE_KEY: 'liveApiFinalRequestDate',
    LIVE_SNAPSHOT_STORAGE_KEY: 'liveApiSnapshot',
    MARKET_BREADTH_STORAGE_KEY: 'marketBreadthSnapshot',
    PINNED_FUNDS_STORAGE_KEY: 'pinnedFunds',   // 置顶基金存储 key
    INDEX_SETTINGS_STORAGE_KEY: 'indexSettings',
    LIVE_API_SETTINGS_STORAGE_KEY: 'liveApiSettings',
    LIVE_API_PROFILES_STORAGE_KEY: 'liveApiProfiles',
    LIVE_API_ACTIVE_PROFILE_STORAGE_KEY: 'liveApiActiveProfileId',
    INDEX_QUOTES_STORAGE_KEY: 'indexQuotesSnapshot', // 指数行情快照存储 key
    MANUAL_PAUSE_STORAGE_KEY: 'isManuallyPaused',   // 手动暂停自动刷新存储 key
    TRADE_DATA_MIGRATION_STORAGE_KEY: 'tradeDataMigrationVersion',
    DEBUG_DIVIDEND_TRACE: false,
    DEBUG_DIVIDEND_TRACE_CODES: ['002010']
};

// ==================== 业务常量 ====================
const CONSTANTS = {
    DAY_MS: 86400000,                // 1天毫秒数
    DIVIDEND_MIN_THRESHOLD: 0.0001,  // 分红最小阈值
    INTRADAY_CHART_START: '09:00',
    INTRADAY_CHART_MORNING_END: '11:30',
    INTRADAY_CHART_AFTERNOON_START: '13:00',
    INTRADAY_CHART_END: '15:30',
    INTRADAY_CHART_TOTAL_MINUTES: 300
};

// ==================== 优化工具函数（统一处理重复模式）====================
/**
 * 安全的数字转换函数
 */
const safeNumber = (value, defaultValue = 0) => {
    if (value === null || value === undefined) return defaultValue;
    const num = Number(value);
    return isNaN(num) ? defaultValue : num;
};

/**
 * 安全的浮点数转换函数
 */
const safeFloat = (value, defaultValue = 0) => {
    if (value === null || value === undefined) return defaultValue;
    const num = parseFloat(value);
    return isNaN(num) ? defaultValue : num;
};

/**
 * 安全的整数转换函数
 */
const safeInteger = (value, defaultValue = 0) => {
    if (value === null || value === undefined) return defaultValue;
    const num = parseInt(value, 10);
    return isNaN(num) ? defaultValue : num;
};

/**
 * 安全的字符串转换函数
 */
const safeString = (value, defaultValue = '') => {
    if (value === null || value === undefined) return defaultValue;
    const str = String(value).trim();
    return str === '' ? defaultValue : str;
};

/**
 * 安全的数组转换函数
 */
const safeArray = (value, defaultValue = []) => {
    if (value === null || value === undefined) return defaultValue;
    return Array.isArray(value) ? value : defaultValue;
};

/**
 * 确保数值为非负浮点数
 */
const nonNegativeFloat = (value) => Math.max(0, safeFloat(value, 0));

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
let profitCalendarViewMode = 'day';
let profitCalendarViewYear = '';
let profitCalendarSelectedMonth = '';
let profitCalendarSelectedYear = '';
let modalDismissHandler = null;
let marketBreadthData = null;
let indexSettings = null;   // 用户选择的指数列表
let indexQuotesData = [];   // 最新指数行情 [{ code, market, name, price, changeRate }]
let autoRefreshIntervalMs = CONFIG.AUTO_REFRESH_INTERVAL;
let nextAutoRefreshAt = 0;
let refreshCountdownTimer = null;
let unifiedRefreshPromise = null;
let lastLiveApiRequestDate = '';
let lastLiveApiFinalRequestDate = '';
let isManuallyPaused = false;  // 手动暂停自动刷新标记
// 持有天数 & 区间涨跌幅展示缓存（用于表格渲染）
let fundPerfCache = {};
// 区间涨跌幅日级持久化缓存（跨会话硬保留）
let fundPerfDailyCacheByCode = {};
let fundPerfDailyCacheLoaded = false;
// 置顶基金代码集合（持久化到 storage）
let pinnedFunds = new Set();

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

function notifySelectFundsFirst() {
    showToast('⚠️ 操作失败：请至少勾选一支基金进行操作', 'warning');
}

function ensureBatchSelection() {
    if (selectedCodes.size > 0) return true;
    notifySelectFundsFirst();
    return false;
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
                await storageHelper.set(CONFIG.COLUMN_VISIBILITY_STORAGE_KEY, columnVisibility);
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
        const stored = await storageHelper.getAll([CONFIG.COLUMN_VISIBILITY_STORAGE_KEY]);
        columnVisibility = normalizeColumnVisibility(stored?.[CONFIG.COLUMN_VISIBILITY_STORAGE_KEY] || {});
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

// ==================== 置顶功能 ====================

/**
 * 初始化置顶基金列表（从 storage 读取）
 */
async function initPinnedFunds() {
    try {
        const stored = await storageHelper.getAll([CONFIG.PINNED_FUNDS_STORAGE_KEY]);
        const arr = stored?.[CONFIG.PINNED_FUNDS_STORAGE_KEY];
        pinnedFunds = new Set(safeArray(arr, []));
    } catch (err) {
        console.warn('读取置顶基金失败，使用空列表:', err);
        pinnedFunds = new Set();
    }
}

/**
 * 切换基金的置顶状态，并持久化保存
 * @param {string} code - 基金代码
 */
async function togglePinFund(code) {
    if (!code) return;
    // 从当前数据中找基金名称，方便 toast 提示
    const fundItem = allFundsData.find(f => f.code === code);
    const label = fundItem ? `${fundItem.name}（${code}）` : code;
    if (pinnedFunds.has(code)) {
        pinnedFunds.delete(code);
        showToast(`已取消置顶：${label}`, 'info', CONFIG.TOAST_SHORT);
    } else {
        pinnedFunds.add(code);
        showToast(`📌 已置顶：${label}`, 'success', CONFIG.TOAST_SHORT);
    }
    try {
        await storageHelper.set(CONFIG.PINNED_FUNDS_STORAGE_KEY, [...pinnedFunds]);
    } catch (err) {
        console.error('保存置顶基金失败:', err);
    }
    renderTable();
}

// --- 调试/日志控制 ---
function shouldDebugDividendTrace(code = '') {
    if (!CONFIG.DEBUG_DIVIDEND_TRACE) return false;
    const targetCodes = Array.isArray(CONFIG.DEBUG_DIVIDEND_TRACE_CODES)
        ? CONFIG.DEBUG_DIVIDEND_TRACE_CODES
        : [];
    if (targetCodes.length === 0) return true;
    return targetCodes.includes(String(code || '').trim());
}

function debugDividendTrace(code, stage, payload = {}) {
    if (!shouldDebugDividendTrace(code)) return;
    const stamp = new Date().toISOString();
    console.log(`[DIV-TRACE][${stamp}][${code}] ${stage}`, payload);
}

// ==================== DOM 元素引用 ====================
let elements = {};

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

// 历史数据域函数已拆分到 popup_history.js

/**
 * Storage 辅助对象（统一封装 storage 操作）
 */
const storageHelper = {
    /**
     * 获取单个键的值（带默认值）
     * @param {string} key - Storage key
     * @param {*} defaultValue - 默认值
     * @returns {Promise<*>} 键的值
     */
    async get(key, defaultValue = undefined) {
        try {
            const result = await storageHelper.getAll([key]);
            return result?.[key] ?? defaultValue;
        } catch (error) {
            console.warn('[StorageHelper] 获取失败:', error);
            return defaultValue;
        }
    },

    /**
     * 获取多个键的值
     * @param {string[]} keys - Storage keys
     * @returns {Promise<Object>} 包含键值对的对象
     */
    async getAll(keys) {
        try {
            const result = await storage.get(keys);
            return result || {};
        } catch (error) {
            console.warn('[StorageHelper] 批量获取失败:', error);
            return {};
        }
    },

    /**
     * 设置单个键的值
     * @param {string} key - Storage key
     * @param {*} value - 要存储的值
     * @returns {Promise<void>}
     */
    async set(key, value) {
        try {
            await storageHelper.setAll({ [key]: value });
        } catch (error) {
            console.error('[StorageHelper] 设置失败:', error);
        }
    },

    /**
     * 设置多个键的值
     * @param {Object} data - 键值对对象
     * @returns {Promise<void>}
     */
    async setAll(data) {
        try {
            await storage.set(data);
        } catch (error) {
            console.error('[StorageHelper] 批量设置失败:', error);
        }
    },

};

/**
 * 数值格式化工具（保留 2 位小数，带类型检查）
 */
function round2(num) {
    if (typeof num !== 'number' || isNaN(num)) {
        console.warn('round2: 输入不是有效数字:', num);
        return 0;
    }
    return safeFloat(num.toFixed(2));
}

/**
 * 数值格式化工具（保留 6 位小数，用于高精度非份额计算，带类型检查）
 */
function round6(num) {
    if (typeof num !== 'number' || isNaN(num)) {
        console.warn('round6: 输入不是有效数字:', num);
        return 0;
    }
    return safeFloat(num.toFixed(6));
}

function roundShares(num) {
    return round2(safeFloat(num, 0));
}

function round4(num) {
    if (typeof num !== 'number' || isNaN(num)) {
        console.warn('round4: 输入不是有效数字:', num);
        return 0;
    }
    return safeFloat(num.toFixed(4));
}

function getToday() {
    return formatDate(new Date());
}

function formatDate(date) {
    const d = date instanceof Date ? date : new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function normalizePerfDate(value) {
    if (typeof value !== 'string' || !value) return '';
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : '';
}

function timestampToDate(timestamp) {
    return formatDate(new Date(timestamp));
}

/**
 * 格式化收益显示（带正负号，保留 2 位小数，带类型检查）
 * @param {number} num - 数值
 * @param {string} suffix - 后缀（如 '%'）
 * @returns {string} 格式化后的字符串
 */
function formatProfit(num, suffix = '') {
    const value = safeFloat(num, 0);
    const isPositive = value >= 0;
    const formatted = value.toFixed(2);
    return `${isPositive ? '+' : ''}${formatted}${suffix}`;
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

function normalizeSearchText(value) {
    return safeString(value, '').toLowerCase();
}

function splitSearchKeywords(query) {
    return normalizeSearchText(query).split(/\s+/).filter(Boolean);
}

function createSearchMatcher(query, fieldGetters = []) {
    const keywords = splitSearchKeywords(query);
    if (keywords.length === 0) return () => true;
    const getters = safeArray(fieldGetters, []).filter(fn => typeof fn === 'function');
    return (item) => {
        const haystack = getters.map(fn => normalizeSearchText(fn(item))).join(' ');
        return keywords.every(keyword => haystack.includes(keyword));
    };
}

const fundSearchController = (() => {
    let inputEl = null;
    let query = '';
    const changeListeners = [];
    const fieldGetters = [
        item => item?.code,
        item => item?.name,
        item => item?.group
    ];

    function emitChange() {
        for (const fn of changeListeners) {
            try { fn(); } catch (_) {}
        }
    }

    return {
        bind() {
            inputEl = document.getElementById('fundSearchInput');
            if (!inputEl) return;
            query = inputEl.value || '';
            inputEl.addEventListener('input', () => {
                query = inputEl.value || '';
                emitChange();
            });
            inputEl.addEventListener('keydown', (e) => {
                if (e.key !== 'Escape') return;
                if (!inputEl.value) return;
                inputEl.value = '';
                query = '';
                emitChange();
            });
        },
        matches(item) {
            return createSearchMatcher(query, fieldGetters)(item);
        },
        isEmpty() {
            return splitSearchKeywords(query).length === 0;
        },
        onChange(fn) {
            if (typeof fn === 'function') changeListeners.push(fn);
        }
    };
})();

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

// 业绩走势域函数已拆分到 popup_perf.js

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
