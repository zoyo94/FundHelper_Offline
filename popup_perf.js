// ==================== 业绩走势域：缓存 / 加载 / 状态 ====================


function hasFinalLiveApiRequestToday(todayStr = getToday()) {
    return lastLiveApiFinalRequestDate === todayStr;
}

function isAfterAutoRefreshPauseCutoff(now = new Date()) {
    return now >= getAutoRefreshPauseCutoff(now);
}

function shouldSkipLiveRequestsAfterCutoff(now = new Date()) {
    return isAfterAutoRefreshPauseCutoff(now) && hasFinalLiveApiRequestToday(formatDate(now));
}

function markLiveApiRequestDone(todayStr = getToday()) {
    lastLiveApiRequestDate = todayStr;
}

async function persistLiveApiRequestDate(todayStr = getToday()) {
    if (lastLiveApiRequestDate === todayStr) return;
    markLiveApiRequestDone(todayStr);
    try {
        await storageHelper.set(CONFIG.LIVE_API_REQUEST_DATE_STORAGE_KEY, todayStr);
    } catch (error) {
        console.warn('[refresh] 记录当日行情请求标记失败:', error);
    }
}

function markFinalLiveApiRequestDone(todayStr = getToday()) {
    lastLiveApiFinalRequestDate = todayStr;
}

async function persistFinalLiveApiRequestDate(todayStr = getToday()) {
    if (lastLiveApiFinalRequestDate === todayStr) return;
    markFinalLiveApiRequestDone(todayStr);
    try {
        await storageHelper.set(CONFIG.LIVE_API_FINAL_REQUEST_DATE_STORAGE_KEY, todayStr);
    } catch (error) {
        console.warn('[refresh] 记录收盘后行情请求标记失败:', error);
    }
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
    const normalized = safeArray(points, []);
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

function sanitizeSnapshotEntry(entry = {}) {
    if (!entry || typeof entry !== 'object') return null;
    const code = safeString(entry.code, '');
    if (!code) return null;

    const prevPrice = safeNumber(entry.prevPrice, 0);
    const price = safeNumber(entry.price, prevPrice);
    const prevPriceDate = safeString(entry.prevPriceDate, '');
    if (!(prevPrice > 0) || !prevPriceDate) return null;

    return {
        code,
        name: safeString(entry.name, `[快照]${code}`),
        rate: safeNumber(entry.rate, 0),
        price: price > 0 ? price : prevPrice,
        prevPrice,
        prevPriceDate,
        priceTime: safeString(entry.priceTime, ''),
        acNetValue: safeNumber(entry.acNetValue),
        prevTradingDayPrice: safeNumber(entry.prevTradingDayPrice, 0),
        prevTradingDayDate: safeString(entry.prevTradingDayDate, ''),
        dividendList: safeArray(entry.dividendList, []),
        isFallback: entry.isFallback
    };
}

function sanitizeLiveSnapshot(snapshot = {}) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const date = safeString(snapshot.date, '');
    if (!date) return null;

    const entries = Array.isArray(snapshot.entries)
        ? snapshot.entries.map(sanitizeSnapshotEntry).filter(Boolean)
        : [];

    return {
        date,
        entries
    };
}

async function persistLiveSnapshot(entries = [], todayStr = getToday()) {
    const snapshot = sanitizeLiveSnapshot({ date: todayStr, entries });
    if (!snapshot || snapshot.entries.length === 0) return;
    try {
        await storageHelper.set(CONFIG.LIVE_SNAPSHOT_STORAGE_KEY, snapshot);
    } catch (error) {
        console.warn('[refresh] 保存行情快照失败:', error);
    }
}

function sanitizeMarketBreadthData(data = {}) {
    if (!data || typeof data !== 'object') return null;
    const normalized = {
        limitUp: nonNegativeFloat(data.limitUp),
        up: nonNegativeFloat(data.up),
        down: nonNegativeFloat(data.down),
        limitDown: nonNegativeFloat(data.limitDown)
    };

    return normalized;
}

function sanitizeMarketBreadthSnapshot(snapshot = {}) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const date = safeString(snapshot.date, '');
    if (!date) return null;

    const data = sanitizeMarketBreadthData(snapshot.data);
    if (!data) return null;

    return { date, data };
}

async function persistMarketBreadthSnapshot(data, todayStr = getToday()) {
    const normalizedData = sanitizeMarketBreadthData(data);
    if (!normalizedData) return;

    try {
        await storageHelper.setAll({
            [CONFIG.MARKET_BREADTH_STORAGE_KEY]: {
                date: todayStr,
                data: normalizedData
            }
        });
    } catch (error) {
        console.warn('[marketBreadth] 保存快照失败:', error);
    }
}

async function restoreMarketBreadthSnapshot(todayStr = getToday()) {
    try {
        const stored = await storageHelper.getAll([CONFIG.MARKET_BREADTH_STORAGE_KEY]);
        const snapshot = sanitizeMarketBreadthSnapshot(stored?.[CONFIG.MARKET_BREADTH_STORAGE_KEY]);
        if (!snapshot || snapshot.date !== todayStr) return null;
        return snapshot.data;
    } catch (error) {
        console.warn('[marketBreadth] 读取快照失败:', error);
        return null;
    }
}

/**
 * 持久化指数行情快照
 */
async function persistIndexQuotesSnapshot(data, todayStr = getToday()) {
    try {
        await storageHelper.setAll({
            [CONFIG.INDEX_QUOTES_STORAGE_KEY]: {
                date: todayStr,
                time: new Date().getTime(),
                data: data
            }
        });
    } catch (error) {
        console.warn('[indexQuotes] 保存快照失败:', error);
    }
}

/**
 * 恢复指数行情快照
 */
async function restoreIndexQuotesSnapshot(todayStr = getToday()) {
    try {
        const stored = await storageHelper.getAll([CONFIG.INDEX_QUOTES_STORAGE_KEY]);
        const snapshot = stored?.[CONFIG.INDEX_QUOTES_STORAGE_KEY];
        if (snapshot && Array.isArray(snapshot.data)) {
            return snapshot.data;
        }
        return [];
    } catch (error) {
        console.warn('[indexQuotes] 读取快照失败:', error);
        return [];
    }
}

function toSnapshotEntry(code, live) {
    if (!code || !live || typeof live !== 'object') return null;
    return sanitizeSnapshotEntry({
        code,
        name: live.name,
        rate: live.rate,
        price: live.price,
        prevPrice: live.prevPrice,
        prevPriceDate: live.prevPriceDate,
        priceTime: live.priceTime,
        acNetValue: live.acNetValue,
        prevTradingDayPrice: live.prevTradingDayPrice,
        prevTradingDayDate: live.prevTradingDayDate,
        dividendList: live.dividendList,
        isFallback: live.isFallback
    });
}

function getLiveFromSnapshotEntry(snapshotEntry, code) {
    const base = sanitizeSnapshotEntry(snapshotEntry);
    if (!base) return null;
    return {
        code: code || base.code,
        ...base
    };
}

function buildLiveFromMemory(code, todayStr = getToday()) {
    const item = allFundsData.find(fund => fund?.code === code);
    if (!item) return null;
    const prevPrice = safeNumber(item.prevPrice, 0);
    const prevPriceDate = item.prevPriceDate || todayStr;
    if (!(prevPrice > 0) || !prevPriceDate) return null;

    return {
        code,
        name: item.name || `[缓存]${code}`,
        rate: Number(item.rate) || 0,
        price: Number(item.price) || prevPrice,
        prevPrice,
        prevPriceDate,
        priceTime: item.priceTime || '',
        acNetValue: typeof item.acNetValue === 'number' ? item.acNetValue : null,
        prevTradingDayPrice: Number(item.prevTradingDayPrice) || prevPrice,
        prevTradingDayDate: item.prevTradingDayDate || prevPriceDate,
        dividendList: [],
        isFallback: true
    };
}

function buildLiveFromLocalFund(code, fund, todayStr = getToday()) {
    if (!fund || typeof fund !== 'object') return null;
    const savedPrevPrice = safeNumber(fund.savedPrevPrice, 0);
    const derivedPrevPrice = (Number(fund.shares) > 0 && Number(fund.amount) > 0)
        ? Number(fund.amount) / Number(fund.shares)
        : 0;
    const prevPrice = savedPrevPrice > 0 ? savedPrevPrice : derivedPrevPrice;
    const prevPriceDate = fund.savedPrevDate || todayStr;
    if (!(prevPrice > 0) || !prevPriceDate) return null;

    return {
        code,
        name: `[缓存]${code}`,
        rate: 0,
        price: prevPrice,
        prevPrice,
        prevPriceDate,
        priceTime: '',
        acNetValue: typeof fund.savedAcNetValue === 'number' ? fund.savedAcNetValue : null,
        prevTradingDayPrice: prevPrice,
        prevTradingDayDate: prevPriceDate,
        dividendList: [],
        isFallback: true
    };
}

async function buildLiveDataFromSnapshot(codes, funds = {}, todayStr = getToday()) {
    if (!Array.isArray(codes) || codes.length === 0) return [];
    try {
        const stored = await storageHelper.getAll([CONFIG.LIVE_SNAPSHOT_STORAGE_KEY]);
        const snapshot = sanitizeLiveSnapshot(stored?.[CONFIG.LIVE_SNAPSHOT_STORAGE_KEY]);
        const entryByCode = snapshot && snapshot.date === todayStr
            ? new Map(snapshot.entries.map(entry => [entry.code, entry]))
            : new Map();

        const fetchedData = [];
        for (const code of codes) {
            const entry = entryByCode.get(code);
            const live = entry
                ? getLiveFromSnapshotEntry(entry, code)
                : (buildLiveFromMemory(code, todayStr) || buildLiveFromLocalFund(code, funds?.[code], todayStr));
            if (!live) {
                fetchedData.push({
                    code,
                    live: {
                        name: `[缓存]${code}`,
                        rate: 0,
                        price: 0,
                        prevPrice: 0,
                        prevPriceDate: todayStr,
                        priceTime: '',
                        acNetValue: null,
                        prevTradingDayPrice: 0,
                        prevTradingDayDate: '',
                        dividendList: [],
                        isFallback: true
                    }
                });
                continue;
            }
            fetchedData.push({ code, live });
        }
        return fetchedData;
    } catch (error) {
        console.warn('[refresh] 读取行情快照失败:', error);
        return [];
    }
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
 * 判断是否为分红类型
 */
function isDividendType(type) {
    const normalized = normalizeTradeAction(type);
    return normalized === 'dividend' || normalized === 'dividend_reinvest';
}

// ==================== Toast / Modal 工具函数 ====================

// ==================== 通知中心 ====================
const notificationCenter = {
    notifications: [],

    // 初始化：加载今天的通知
    async init() {
        const { notifications, notificationDate } = await storageHelper.getAll(['notifications', 'notificationDate']);
        const todayStr = getToday();

        // 如果是新的一天，清空通知
        if (notificationDate !== todayStr) {
            this.notifications = [];
            await storageHelper.setAll({ notifications: [], notificationDate: todayStr });
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
        await storageHelper.setAll({ notifications: this.notifications });
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
        await storageHelper.setAll({ notifications: [], notificationDate: getToday() });
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

        showHtmlModal('通知中心', '', [
            {
                text: '清空', cls: 'modal-btn-danger', onClick: async () => {
                    await this.clear();
                    renderContent();
                    // 清空后只保留关闭按钮
                    setCloseOnlyFooter();
                }
            },
            getCloseFooterButton()
        ]);
        renderContent();
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

function resetModalTransientState() {
    elements.modalOverlay.dataset.mode = '';
    elements.modalInput.onkeydown = null;
    elements.modalMsg.onclick = null;
    elements.modalMsg.style.whiteSpace = '';
    elements.modalMsg.style.lineHeight = '';
}

function getCloseFooterButton() {
    return { text: '关闭', cls: 'modal-btn-cancel', onClick: _closeModal };
}

function getCancelFooterButton(onClick) {
    return { text: '取消', cls: 'modal-btn-cancel', onClick };
}

function getConfirmFooterButton(onClick, danger = false, text = '确定') {
    return { text, cls: danger ? 'modal-btn-danger' : 'modal-btn-ok', onClick };
}

function setCloseOnlyFooter() {
    _setFooter([getCloseFooterButton()]);
}

function setConfirmOnlyFooter(onConfirm, danger = false, text = '确定') {
    _setFooter([getConfirmFooterButton(onConfirm, danger, text)]);
}

function setCancelConfirmFooter(onCancel, onConfirm, danger = false, confirmText = '确定') {
    _setFooter([
        getCancelFooterButton(onCancel),
        getConfirmFooterButton(onConfirm, danger, confirmText)
    ]);
}

function resolveAndCloseModal(resolve, value) {
    _closeModal();
    resolve(value);
}

function createResolveAndCloseHandler(resolve, value) {
    return () => {
        resolveAndCloseModal(resolve, value);
    };
}

function showAlert(msg, title = '提示') {
    return new Promise(resolve => {
        const onClose = createResolveAndCloseHandler(resolve);
        _openModal(title, msg, false, '', onClose);
        setConfirmOnlyFooter(onClose);
    });
}

function showConfirm(msg, title = '确认', danger = false) {
    return new Promise(resolve => {
        const onCancel = createResolveAndCloseHandler(resolve, false);
        const onConfirm = createResolveAndCloseHandler(resolve, true);
        _openModal(title, msg, false, '', onCancel);
        setCancelConfirmFooter(onCancel, onConfirm, danger);
    });
}

function showPrompt(msg, { defaultVal = '', title = '请输入' } = {}) {
    return new Promise(resolve => {
        const onCancel = createResolveAndCloseHandler(resolve, null);
        _openModal(title, msg, true, defaultVal, onCancel);
        const onOk = () => {
            const val = elements.modalInput.value;
            resolveAndCloseModal(resolve, val);
        };
        resetModalTransientState();
        elements.modalInput.onkeydown = (e) => { if (e.key === 'Enter') onOk(); };
        setCancelConfirmFooter(onCancel, onOk);
        elements.modalInput.focus();
    });
}

function _openModal(title, msg, showInput, defaultVal = '', onDismiss = null) {
    setModalDismissHandler(onDismiss);
    resetModalTransientState();
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
    const wasIndexSettings = elements.modalOverlay.dataset.mode === 'index-settings';
    elements.modalOverlay.dataset.mode = '';
    elements.modalOverlay.dataset.formLayout = '';
    const modalBox = elements.modalOverlay.querySelector('.modal-box');
    if (modalBox) {
        modalBox.style.width = '';
        modalBox.style.maxWidth = '';
        modalBox.style.maxHeight = '';
        modalBox.style.overflowY = '';
    }
    elements.modalOverlay.style.removeProperty('top');
    elements.modalOverlay.style.removeProperty('bottom');
    elements.modalOverlay.style.removeProperty('overflow-y');
    elements.modalInput.value = '';
    elements.modalInput.onkeydown = null;
    elements.modalMsg.onclick = null; // 清空撤销等临时绑定，防止泄漏到下一个弹窗
    elements.modalMsg.style.whiteSpace = '';
    elements.modalMsg.style.lineHeight = '';
    elements.modalFooter.replaceChildren();
    if (wasIndexSettings) renderMarketBreadthTicker();
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
    resetModalTransientState();
    elements.modalTitle.style.display = '';
    elements.modalFooter.style.display = '';
    const modalBox = elements.modalOverlay.querySelector('.modal-box');
    if (modalBox) {
        modalBox.style.padding = '';
        modalBox.style.width = '';
        modalBox.style.maxWidth = '';
        modalBox.style.maxHeight = '';
        modalBox.style.overflowY = '';
    }

    elements.modalTitle.textContent = title;
    elements.modalMsg.innerHTML = html;
    elements.modalMsg.style.whiteSpace = 'normal';
    elements.modalMsg.style.lineHeight = '1.35';
    elements.modalInput.value = '';
    elements.modalInput.style.display = 'none';
    _setFooter(footerBtns || [getCloseFooterButton()]);
    setModalVisibility(true);
}

function showFormModal({ title, subTitle = '', fields = [], actionText = '确认', layout = 'auto', formClass = '', onRender = null } = {}) {
    return new Promise(resolve => {
        const onCancel = createResolveAndCloseHandler(resolve, null);
        _openModal(title, '', false, '', onCancel);
        elements.modalOverlay.dataset.mode = 'form';
        elements.modalOverlay.dataset.formLayout = layout;
        const modalBox = elements.modalOverlay.querySelector('.modal-box');
        if (modalBox) {
            modalBox.style.width = '';
            modalBox.style.maxWidth = '';
            modalBox.style.maxHeight = '';
            modalBox.style.overflowY = '';
            if (layout === 'double') {
                modalBox.style.maxWidth = '560px';
            } else {
                modalBox.style.maxWidth = '420px';
            }
        }

        const formHtml = `
            ${subTitle ? `<div class="form-header-sub">${escapeHtml(subTitle)}</div>` : ''}
            <div class="form-modal ${escapeHtml(formClass)}" style="${layout === 'double' ? 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 12px;align-items:start;' : ''}">
                ${safeArray(fields, []).map(field => {
                    if (field?.type === 'hidden') {
                        return `<input id="modal_field_${field.id}" type="hidden" value="${escapeHtml(field.value ?? '')}">`;
                    }
                    const label = field?.label ? `<label for="modal_field_${field.id}">${escapeHtml(field.label)}</label>` : '';
                    const commonAttrs = [
                        `id="modal_field_${field.id}"`,
                        field?.placeholder ? `placeholder="${escapeHtml(field.placeholder)}"` : '',
                        field?.min !== undefined ? `min="${field.min}"` : '',
                        field?.max !== undefined ? `max="${field.max}"` : '',
                        field?.step !== undefined ? `step="${field.step}"` : '',
                        field?.list ? `list="${escapeHtml(field.list)}"` : ''
                    ].filter(Boolean).join(' ');

                    let inputHtml = '';
                    if (field?.type === 'select') {
                        inputHtml = `
                            <select ${commonAttrs}>
                                ${(field.options || []).map(opt => `<option value="${escapeHtml(opt.value)}" ${opt.value === field.value ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`).join('')}
                            </select>
                        `;
                    } else {
                        const inputType = field?.type || 'text';
                        const valueAttr = field?.type !== 'password' ? `value="${escapeHtml(field.value ?? '')}"` : '';
                        inputHtml = `<input type="${inputType}" ${commonAttrs} ${valueAttr}>`;
                    }

                    return `
                        <div class="form-group">
                            ${label}
                            ${inputHtml}
                        </div>
                    `;
                }).join('')}
            </div>
        `;

        elements.modalMsg.innerHTML = formHtml;
        if (typeof onRender === 'function') {
            try {
                onRender({
                    root: elements.modalMsg,
                    overlay: elements.modalOverlay,
                    getField: (fieldId) => document.getElementById(`modal_field_${fieldId}`)
                });
            } catch (error) {
                console.error('[showFormModal] onRender 执行失败:', error);
            }
        }

        const onConfirm = () => {
            const result = {};
            let valid = true;
            for (const field of safeArray(fields, [])) {
                if (!field || field.type === 'hidden') {
                    if (field?.id) result[field.id] = field.value ?? '';
                    continue;
                }
                const input = document.getElementById(`modal_field_${field.id}`);
                if (!input) continue;
                result[field.id] = input.value;
                if (field.required && !input.value) valid = false;
            }
            if (!valid) return;
            resolveAndCloseModal(resolve, result);
        };

        setCancelConfirmFooter(onCancel, onConfirm, false, actionText);
    });
}

// ==================== 撤销结算功能 ====================
const ROLLBACK_SETTLEMENT_PREFIX = 'ROLLBACK_';

async function checkBackup() {
    const { backupFunds, lastSettlementDate, autoSettlementBlockedDate } = await storageHelper.getAll([
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
    const currentShares = safeNumber(item.shares, 0);
    if (currentShares > 0) return currentShares;
    if (!(item.amount > 0)) return 0;

    const baseNav = item.savedPrevPrice || primaryPrice || fallbackPrice || 0;
    return baseNav > 0 ? round6(item.amount / baseNav) : 0;
}

function hasFundPosition(item) {
    if (!item) return false;
    return (Number(item.amount) || 0) > 0 || (Number(item.shares) || 0) > 0;
}

async function resolveTradeExecutionPrice(code, order = {}, fallbackPrice = 0) {
    const executionDate = normalizePerfDate(
        order?.effectiveDate
        || order?.orderEffectiveDate
        || order?.orderDate
        || order?.date
        || ''
    );
    const fallback = safeFloat(order?.orderNav, 0)
        || safeFloat(order?.confirmedPrice, 0)
        || safeFloat(fallbackPrice, 0);

    if (!code || !executionDate) {
        return {
            price: fallback,
            date: executionDate,
            source: fallback > 0 ? 'fallback' : ''
        };
    }

    const cachedRecord = await HistoryDB.get(code, executionDate).catch(() => null);
    const cachedNav = safeFloat(cachedRecord?.price, 0);
    if (cachedNav > 0) {
        return { price: cachedNav, date: executionDate, source: 'db' };
    }

    return {
        price: fallback,
        date: executionDate,
        source: fallback > 0 ? 'fallback' : ''
    };
}

function derivePositionEffectiveDate(date = new Date()) {
    if (typeof getTradeEffectiveDate === 'function') {
        return getTradeEffectiveDate(date);
    }
    return formatDate(date);
}

function syncAddedDateByPosition(item, dateStr = getToday(), options = {}) {
    if (!item) return false;

    const preserveExistingAddedDate = options.preserveExistingAddedDate !== false;
    const fallbackAddedDate = normalizePerfDate(options.defaultAddedDate || '');
    const allowCreateAddedDateWithoutOrders = options.allowCreateAddedDateWithoutOrders === true;
    const hasPosition = hasFundPosition(item);
    const currentAddedDate = typeof item.addedDate === 'string' && item.addedDate ? item.addedDate : null;
    const currentHoldDaysBase = Math.max(0, Math.floor(Number(item.holdDaysBase) || 0));
    let changed = false;

    if ((Number(item.holdDaysBase) || 0) !== currentHoldDaysBase) {
        item.holdDaysBase = currentHoldDaysBase;
        changed = true;
    }

    if (hasPosition) {
        if (!currentAddedDate) {
            if (fallbackAddedDate) {
                item.addedDate = fallbackAddedDate;
                return true;
            }
            if (allowCreateAddedDateWithoutOrders) {
                item.addedDate = derivePositionEffectiveDate();
                return true;
            }
            return changed;
        }
        return changed;
    }

    if (preserveExistingAddedDate) {
        return changed;
    }

    if (currentAddedDate) {
        const startDate = parseYmdDate(currentAddedDate);
        const endDate = parseYmdDate(dateStr);
        const cycleDays = startDate && endDate
            ? Math.max(0, Math.floor((endDate.getTime() - startDate.getTime()) / CONSTANTS.DAY_MS))
            : 0;
        const nextHoldDaysBase = currentHoldDaysBase + cycleDays;

        if (nextHoldDaysBase !== currentHoldDaysBase) {
            item.holdDaysBase = nextHoldDaysBase;
            changed = true;
        }

        item.addedDate = null;
        changed = true;
    }

    return changed;
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
    if (round2(Number(left.totalDividend) || 0) !== round2(Number(right.totalDividend) || 0)) return false;

    const leftByCode = left.byCode || {};
    const rightByCode = right.byCode || {};
    const leftKeys = Object.keys(leftByCode);
    const rightKeys = Object.keys(rightByCode);
    if (leftKeys.length !== rightKeys.length) return false;
    if (!leftKeys.every(code => round2(Number(leftByCode[code]) || 0) === round2(Number(rightByCode[code]) || 0))) {
        return false;
    }

    const leftDiv = left.dividendsByCode || {};
    const rightDiv = right.dividendsByCode || {};
    const leftDivKeys = Object.keys(leftDiv);
    const rightDivKeys = Object.keys(rightDiv);
    if (leftDivKeys.length !== rightDivKeys.length) return false;
    return leftDivKeys.every(code => round2(Number(leftDiv[code]) || 0) === round2(Number(rightDiv[code]) || 0));
}

function areDailyProfitHistoriesEqual(left, right) {
    const normalizedLeft = normalizeDailyProfitHistory(left);
    const normalizedRight = normalizeDailyProfitHistory(right);
    const leftDates = Object.keys(normalizedLeft);
    const rightDates = Object.keys(normalizedRight);
    if (leftDates.length !== rightDates.length) return false;
    if (!leftDates.every((date, index) => date === rightDates[index])) return false;
    return leftDates.every(date => areDailyProfitEntriesEqual(normalizedLeft[date], normalizedRight[date]));
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

function normalizeDailyProfitHistory(history, limit = null) {
    if (!history || typeof history !== 'object' || Array.isArray(history)) return {};
    const normalized = {};
    const dates = Object.keys(history)
        .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date))
        .sort();

    const hasLimit = Number.isFinite(limit) && Number(limit) > 0;
    const keptDates = hasLimit ? dates.slice(-Number(limit)) : dates;
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

        const dividendsRaw = entry.dividendsByCode && typeof entry.dividendsByCode === 'object' ? entry.dividendsByCode : {};
        const dividendsByCode = {};
        let totalDividend = 0;
        for (const [code, value] of Object.entries(dividendsRaw)) {
            const amount = round2(Number(value) || 0);
            if (amount === 0) continue;
            dividendsByCode[code] = amount;
            totalDividend = round2(totalDividend + amount);
        }

        normalized[date] = {
            totalProfit: typeof entry.totalProfit === 'number' && !Number.isNaN(entry.totalProfit)
                ? round2(entry.totalProfit)
                : totalProfit,
            byCode,
            dividendsByCode,
            totalDividend: typeof entry.totalDividend === 'number' && !Number.isNaN(entry.totalDividend)
                ? round2(entry.totalDividend)
                : totalDividend
        };
    }
    return normalized;
}

function calculateYesterdayProfitValue(item, priceUpdate) {
    const { price, prevPriceDate, prevTradingDayPrice, prevTradingDayDate, acNetValue, prevAcNetValue } = priceUpdate;
    if (!item || !(price > 0) || !(prevTradingDayPrice > 0) || !prevTradingDayDate || !prevPriceDate) {
        return 0;
    }

    const diffDays = Math.round(
        (new Date(prevPriceDate) - new Date(prevTradingDayDate)) / CONSTANTS.DAY_MS
    );
    if (diffDays <= 0) {
        return 0;
    }

    const shares = deriveFundShares(item, price);
    if (shares <= 0) return 0;

    // 优先采用累计净值差额计算（累计净值已自动包含分红，无需额外补偿）
    if (typeof acNetValue === 'number' && typeof prevAcNetValue === 'number' && acNetValue > 0 && prevAcNetValue > 0) {
        return round2(shares * (acNetValue - prevAcNetValue));
    }

    // 降级采用单位净值差额计算
    return round2(shares * (price - prevTradingDayPrice));
}

function getDisplayedYesterdayProfitValue(baseProfit, pendingAdjustments, liveData = {}) {
    const { prevPriceDate = '', prevTradingDayDate = '', acNetValue, prevAcNetValue } = liveData;

    // 如果存在累计净值对，我们优先相信基于累计净值的计算结果（它已包含分红）
    // 此时不再叠加额外的待确认分红补偿，防止重复计算
    if (typeof acNetValue === 'number' && typeof prevAcNetValue === 'number' && acNetValue > 0 && prevAcNetValue > 0) {
        return round2(baseProfit || 0);
    }

    // 否则，仍采用原有的分红补偿逻辑（针对单位净值计算结果）
    const displayPendingDividend = sumPendingDisplayDividendAmount(pendingAdjustments, prevPriceDate, prevTradingDayDate);
    return round2((baseProfit || 0) + displayPendingDividend);
}

function getDisplayedFreshYesterdayProfitValue(item, live, dominantMarketPrevPriceDate = '') {
    const baseProfit = hasFreshYesterdayProfit(item, live, dominantMarketPrevPriceDate)
        ? round2(item?.yesterdayProfit || 0)
        : 0;
    const pendingAdjustments = getPendingAdjustments(item, item?.code);
    return getDisplayedYesterdayProfitValue(
        baseProfit,
        pendingAdjustments,
        live
    );
}

function getDailyHistoryProfitForCode(history, date, code) {
    const normalizedDate = normalizePerfDate(date || '');
    if (!normalizedDate || !code) return null;
    const entry = history?.[normalizedDate];
    if (!entry || !entry.byCode || !Object.prototype.hasOwnProperty.call(entry.byCode, code)) {
        return null;
    }
    return round2(Number(entry.byCode[code]) || 0);
}

function getDisplayedYesterdayProfitFromHistory(item, live, dailyHistory, dominantMarketPrevPriceDate = '') {
    const prevPriceDate = normalizePerfDate(live?.prevPriceDate || '');
    if (!item || !prevPriceDate) {
        return getDisplayedFreshYesterdayProfitValue(item, live, dominantMarketPrevPriceDate);
    }
    if (dominantMarketPrevPriceDate && prevPriceDate !== dominantMarketPrevPriceDate) {
        return 0;
    }

    const historyProfit = getDailyHistoryProfitForCode(dailyHistory, prevPriceDate, item.code);
    if (historyProfit !== null) {
        return getDisplayedYesterdayProfitValue(historyProfit, getPendingAdjustments(item, item?.code), live);
    }

    return getDisplayedFreshYesterdayProfitValue(item, live, dominantMarketPrevPriceDate);
}

function calculateDisplayedYesterdayRate({ shares, prevTradingDayPrice, yesterdayProfit, prevPrice, acNetValue, prevAcNetValue }) {
    const basePrevTradingDayPrice = Number(prevTradingDayPrice) || 0;
    if (!(basePrevTradingDayPrice > 0)) return 0;

    const baseShares = Number(shares) || 0;
    const baseYesterdayProfit = Number(yesterdayProfit);

    // 如果已有昨日收益（无论是由 AC NAV 还是 Unit NAV 计算而来），直接推导变化率
    if (baseShares > 0 && Number.isFinite(baseYesterdayProfit)) {
        const baseAmount = baseShares * basePrevTradingDayPrice;
        if (baseAmount > 0) {
            return round2((baseYesterdayProfit / baseAmount) * 100);
        }
    }

    // 兜底逻辑：如果没有持仓收益，则利用净值变动直接计算
    // 优先采用累计净值（AC NAV）变动率
    if (typeof acNetValue === 'number' && typeof prevAcNetValue === 'number' && acNetValue > 0 && prevAcNetValue > 0) {
        return round2(((acNetValue - prevAcNetValue) / prevAcNetValue) * 100);
    }

    // 降级使用单位净值（DWJZ）变动率
    const basePrevPrice = Number(prevPrice) || 0;
    if (basePrevPrice > 0) {
        return round2(((basePrevPrice - basePrevTradingDayPrice) / basePrevTradingDayPrice) * 100);
    }

    return 0;
}

function calculateRecordedYesterdayProfitValue(item, priceUpdate, dominantMarketPrevPriceDate = '') {
    if (!item || !hasFreshYesterdayProfit(item, priceUpdate, dominantMarketPrevPriceDate)) {
        return 0;
    }
    const baseProfit = round2(item.yesterdayProfit || 0);
    const pendingAdjustments = getPendingAdjustments(item, item?.code);
    return getDisplayedYesterdayProfitValue(
        baseProfit,
        pendingAdjustments,
        priceUpdate
    );
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

    const existingEntry = nextHistory[settlementDate] || { byCode: {}, dividendsByCode: {} };
    const byCode = { ...existingEntry.byCode };
    const dividendsByCode = { ...(existingEntry.dividendsByCode || {}) };

    for (const priceUpdate of priceUpdates) {
        const { code, prevPriceDate } = priceUpdate;
        if (!code || prevPriceDate !== settlementDate) continue;

        const item = funds[code];
        if (!item) continue;

        const profit = calculateRecordedYesterdayProfitValue(item, priceUpdate, dominantMarketPrevPriceDate);
        byCode[code] = profit;

        // --- 核心优化：将每日基础状态数据存入专属的 fundDailyState 快照表 ---
        HistoryDB.putDailyState({
            code: code,
            date: settlementDate,
            shares: item.shares || 0,         // 当日持有份额
            amount: item.amount || 0,         // 当日持仓市值
            dayProfit: profit,                // 当日产生收益
            totalProfit: round2((item.holdProfit || 0) + profit), // 累计收益
            holdDays: item.holdDaysBase || 0, // 持有天数基础
            name: item.name,
            group: item.group
        }).catch(() => {});

        // 同步存档昨日的客观行情到行情表 (fundHistory)
        HistoryDB.put({
            code: code,
            name: item.name,   // 补全中文名称
            date: settlementDate,
            price: priceUpdate.price,
            acPrice: priceUpdate.acNetValue || null,
            rate: priceUpdate.rate // 补全涨幅字段
        }).catch(() => {});
    }

    let totalProfit = 0;
    for (const profit of Object.values(byCode)) {
        totalProfit = round2(totalProfit + (Number(profit) || 0));
    }

    let totalDividend = 0;
    for (const amount of Object.values(dividendsByCode)) {
        totalDividend = round2(totalDividend + (Number(amount) || 0));
    }

    const nextEntry = { totalProfit, byCode, dividendsByCode, totalDividend };
    const changed = !areDailyProfitEntriesEqual(nextHistory[settlementDate], nextEntry);
    
    // 无论 Storage 是否变化，我们都要确保数据库写入了最新的快照
    if (changed) {
        nextHistory[settlementDate] = nextEntry;
    }

    return {
        history: normalizeDailyProfitHistory(nextHistory),
        changed: changed
    };
}

/**
 * 推算基金在指定历史日期应计入“当日收益”的有效持仓份额
 * 规则：
 * - 建仓 / 加仓 / 红利再投在确认当日不计入当日收益，从下一交易日开始生效
 * - 减仓 / 清仓在确认当日仍计入当日收益
 */
function getSharesOnDate(code, date, currentShares, orders, addedDate = '') {
    const normalizedDate = normalizePerfDate(date || '');
    const normalizedAddedDate = normalizePerfDate(addedDate || '');
    if (normalizedAddedDate && normalizedDate && normalizedDate <= normalizedAddedDate) {
        return 0;
    }

    const codeOrders = safeArray(orders, [])
        .filter(ord => ord?.code === code && ord?.status === 'confirmed');

    let shares = 0;
    codeOrders.forEach(ord => {
        const displayType = getTradeDisplayType(ord);
        const shareEffect = getTradeShareEffect(ord);

        if (displayType === 'initial' || displayType === 'add' || displayType === 'dividend_reinvest') {
            // 新增份额以"确认日"为准：仅当确认日严格早于当前日时计入当日收益；
            // 确认日当天（T+1）份额已到账但官方口径不计入当日收益，留到下一交易日生效。
            const entryDate = getTradeRecordDate(ord);
            if (entryDate && entryDate < normalizedDate) {
                shares += Math.max(0, shareEffect);
            }
            return;
        }

        if (displayType === 'remove' || displayType === 'clear') {
            // 出仓份额以"成交日"(markerDate) 为准：成交当日仍计入当日收益，次日起扣除。
            const exitDate = getTradeMarkerDate(ord) || getTradeRecordDate(ord) || '';
            if (exitDate && exitDate < normalizedDate) {
                shares -= Math.abs(shareEffect);
            }
        }
    });

    return round6(Math.max(0, shares));
}

function normalizeHistoricalOrdersForProfitBackfill(orders = []) {
    return normalizeTradeRecordList(orders, { source: 'order' }).map(order => {
        const displayType = getTradeDisplayType(order);
        const sourceName = safeString(order?.source, '');
        const orderDate = normalizePerfDate(order.orderDate || order.date || '');
        const effectiveDate = normalizePerfDate(order.effectiveDate || order.orderEffectiveDate || '');

        if (['manual', 'manual_backfill', 'migration_initial'].includes(sourceName)
            && ['initial', 'add', 'remove', 'clear'].includes(displayType)
            && orderDate
            && effectiveDate !== orderDate) {
            return normalizeTradeRecord({
                ...order,
                effectiveDate: orderDate
            }, { source: 'order' });
        }

        if (!['add', 'remove', 'clear'].includes(displayType) || order.status !== 'confirmed') {
            return order;
        }

        const confirmedDate = normalizePerfDate(order.confirmedDate || '');
        const orderNav = safeFloat(order.orderNav, 0);
        const confirmedPrice = safeFloat(order.confirmedPrice || order.price, 0);
        const hasSuspiciousNavGap = orderDate
            && confirmedDate
            && orderDate !== confirmedDate
            && orderNav > 0
            && confirmedPrice > 0
            && Math.abs(orderNav - confirmedPrice) > 0.0001;

        if (!hasSuspiciousNavGap || (effectiveDate && effectiveDate !== confirmedDate)) {
            return order;
        }

        const nextOrder = {
            ...order,
            effectiveDate: orderDate,
            confirmedPrice: orderNav,
            price: orderNav
        };

        if (displayType === 'add' && safeFloat(order.amount, 0) > 0) {
            const feeRate = safeFloat(order.feeRate, 0) / 100;
            nextOrder.confirmedShares = round6((safeFloat(order.amount, 0) * (1 - feeRate)) / orderNav);
        } else if ((displayType === 'remove' || displayType === 'clear') && safeFloat(order.shares, 0) > 0) {
            nextOrder.amount = round2(safeFloat(order.shares, 0) * orderNav);
            nextOrder.confirmedShares = safeFloat(order.confirmedShares, 0) > 0 ? safeFloat(order.confirmedShares, 0) : safeFloat(order.shares, 0);
        }

        return normalizeTradeRecord(nextOrder, { source: 'order' });
    });
}

/**
 * 智能历史收益回溯补全：针对用户未打开插件产生的空白日期，根据数据库中的完整行情和订单自动追算每日收益
 * 通过一次性预载 Map 缓存提升数据库操作性能，并按历史库里真实存在的交易日回推；
 * 收益计算优先使用累计净值(acPrice/acNetValue)差值，从而自然包含分红影响。
 */
async function backfillMissingDailyProfitHistory(history, funds) {
    const codes = Object.keys(funds || {});
    if (codes.length === 0) return { history, changed: false };

    // 1. 一次性获取所有基金的订单和行情数据，缓存到 Map 中，避免在历史回推中重复查询数据库
    const ordersMap = new Map();
    const historyMap = new Map();
    const todayStr = getToday();
    const dateSet = new Set();
    
    await Promise.all(codes.map(async code => {
        const [ords, hist] = await Promise.all([
            HistoryDB.getOrders(code),
            HistoryDB.getRange(code, '2000-01-01', todayStr)
        ]);
        ordersMap.set(code, normalizeHistoricalOrdersForProfitBackfill(ords || []));
        historyMap.set(code, hist || []);
        safeArray(hist, []).forEach(item => {
            if (item?.date) dateSet.add(item.date);
        });
    }));

    const dateList = Array.from(dateSet)
        .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date))
        .sort();
    if (dateList.length === 0) {
        return { history, changed: false };
    }

    let historyChanged = false;
    const nextHistory = { ...history };

    // 预先聚合所有已确认分红订单 → { date: { code: 金额 } }
    // 用累计净值/单位净值差计算的日收益已经天然包含分红影响，这里只是把"哪天有分红、各基金分了多少"显式记录下来供 UI 标注。
    const dividendsByDate = new Map();
    for (const code of codes) {
        const orders = ordersMap.get(code) || [];
        for (const order of orders) {
            if (!order || order.status !== 'confirmed') continue;
            const displayType = getTradeDisplayType(order);
            if (!isDividendType(displayType)) continue;

            const divDate = getTradeMarkerDate(order) || normalizePerfDate(order.dividendDate || '');
            if (!divDate || !/^\d{4}-\d{2}-\d{2}$/.test(divDate)) continue;

            const fund = funds[code];
            const addedDate = normalizePerfDate(fund?.addedDate || '');
            if (addedDate && divDate < addedDate) continue;

            let amount = safeFloat(order.dividendAmount, 0);
            if (amount <= 0) {
                const perShare = safeFloat(order.perShare, 0);
                if (perShare > 0) {
                    const sharesAtDate = getSharesOnDate(code, divDate, fund?.shares || 0, orders, addedDate);
                    if (sharesAtDate > 0) {
                        amount = round2(perShare * sharesAtDate);
                    }
                }
            } else {
                amount = round2(amount);
            }
            if (amount <= 0) continue;

            if (!dividendsByDate.has(divDate)) dividendsByDate.set(divDate, {});
            const dayMap = dividendsByDate.get(divDate);
            dayMap[code] = round2((dayMap[code] || 0) + amount);
        }
    }

    for (let dateIdx = 0; dateIdx < dateList.length; dateIdx++) {
        const date = dateList[dateIdx];
        const previousTradingDate = dateIdx > 0 ? dateList[dateIdx - 1] : null;
        // 我们需要判定这一天是否真的是交易日，并且计算这一天所有基金的单日收益
        const byCode = {};
        let dayTotalProfit = 0;
        let hasValidProfit = false;

        for (const code of codes) {
            const fund = funds[code];
            if (!fund) continue;
            const addedDate = normalizePerfDate(fund.addedDate || '');
            if (addedDate && date < addedDate) continue;

            // 获取缓存的行情列表
            const existingData = historyMap.get(code) || [];
            if (existingData.length === 0) continue;

            const targetIndex = existingData.findIndex(item => item.date === date);
            if (targetIndex < 0) continue; // 该日期没有行情，说明不是该基金的交易日

            const targetRecord = existingData[targetIndex];
            const prevRecord = targetIndex > 0 ? existingData[targetIndex - 1] : null;

            // 获取该基金的所有流水订单
            const orders = ordersMap.get(code) || [];

            // 计算该日期上的真实持仓份额（利用订单和冲销算法）
            const shares = getSharesOnDate(code, date, fund.shares, orders, addedDate);

            // 当日（T 日）按成本法补算建仓/加仓收益，与 APP 显示口径对齐。
            // - getSharesOnDate 走 T+1，建仓/加仓的份额要到下一个交易日才计入收益，
            //   所以当日如果只有新买入会被上面的 shares=0 拦截，导致 APP 当日有 -X 而我们显示 0。
            // - 仅对用户手动补录的订单（source: manual / manual_backfill）启用，
            //   migration_initial 的 amount 不一定等于真实投入金额，避免误算。
            let buyDayExtra = 0;
            let hasBuyDayAdjustment = false;
            const navToday = safeFloat(targetRecord.price, 0);
            if (navToday > 0) {
                for (const order of orders) {
                    if (order.status !== 'confirmed') continue;
                    const displayType = getTradeDisplayType(order);
                    if (displayType !== 'initial' && displayType !== 'add') continue;
                    const sourceName = safeString(order?.source, '');
                    if (sourceName !== 'manual' && sourceName !== 'manual_backfill') continue;
                    const confirmedDate = getTradeRecordDate(order);
                    if (confirmedDate !== date) continue;
                    const amt = safeFloat(order.amount, 0);
                    const sh = safeFloat(order.confirmedShares || order.shares, 0);
                    if (amt <= 0 || sh <= 0) continue;
                    buyDayExtra = round2(buyDayExtra + sh * navToday - amt);
                    hasBuyDayAdjustment = true;
                }
            }

            if (shares <= 0 && !hasBuyDayAdjustment) continue;

            // 计算该日期的单日收益（严格按照单日净值差值计算，杜绝累积）
            let profit = 0;
            if (shares > 0) {
                if (targetRecord.acPrice !== null && prevRecord && prevRecord.acPrice !== null && targetRecord.acPrice > 0 && prevRecord.acPrice > 0) {
                    // 优先使用累计净值计算（已自动包含分红，无需额外补偿）
                    profit = round2(shares * (targetRecord.acPrice - prevRecord.acPrice));
                } else if (prevRecord && prevRecord.price > 0) {
                    // 降级使用单位净值计算
                    profit = round2(shares * (targetRecord.price - prevRecord.price));
                } else if (targetRecord.rate !== null) {
                    // 再次降级使用涨跌幅计算
                    const prevPrice = targetRecord.price / (1 + targetRecord.rate / 100);
                    profit = round2(shares * (targetRecord.price - prevPrice));
                }
            }

            if (hasBuyDayAdjustment) {
                profit = round2(profit + buyDayExtra);
            }

            // 交易手续费归属：
            // - 申购费（initial/add）：归到"份额开始享受收益的第一个交易日"，
            //   即 dateList 中严格晚于 confirmedDate 的第一个交易日。
            //   这样与 getSharesOnDate "确认日次日才计入收益" 的语义保持一致，
            //   避免在确认日当天 shares=0 时被 guard 吃掉。
            // - 赎回费（remove/clear）：归到成交日（markerDate），当日仍计入收益。
            orders.forEach(order => {
                if (order.status !== 'confirmed') return;
                const displayType = getTradeDisplayType(order);
                if (!['initial', 'add', 'remove', 'clear'].includes(displayType)) return;
                const fee = safeFloat(order.fee, 0);
                if (fee <= 0) return;

                if (displayType === 'initial' || displayType === 'add') {
                    const confirmedDate = getTradeRecordDate(order);
                    if (confirmedDate && previousTradingDate === confirmedDate) {
                        profit = round2(profit - fee);
                    }
                    return;
                }

                const exitDate = getTradeMarkerDate(order) || getTradeRecordDate(order) || '';
                if (exitDate === date) {
                    profit = round2(profit - fee);
                }
            });

            byCode[code] = profit;
            dayTotalProfit = round2(dayTotalProfit + profit);
            hasValidProfit = true;

            // 顺便补齐该日期的 fundDailyState 状态表数据，实现完美的日历弹窗明细回溯！
            await HistoryDB.putDailyState({
                code: code,
                date: date,
                shares: shares,
                amount: round2(shares * targetRecord.price),
                dayProfit: profit,
                totalProfit: round2((fund.holdProfit || 0) + profit), // 累计收益估算
                holdDays: fund.holdDaysBase || 0,
                name: fund.name,
                group: fund.group
            }).catch(() => {});
        }

        const dividendsForDate = dividendsByDate.get(date) || {};
        const dividendsByCode = {};
        let totalDividend = 0;
        for (const [code, value] of Object.entries(dividendsForDate)) {
            const amount = round2(Number(value) || 0);
            if (amount === 0) continue;
            dividendsByCode[code] = amount;
            totalDividend = round2(totalDividend + amount);
        }

        if (hasValidProfit || totalDividend > 0) {
            const nextEntry = {
                totalProfit: dayTotalProfit,
                byCode,
                dividendsByCode,
                totalDividend
            };

            // 如果计算出的"单日纯净收益"与之前记录的有差异（比如之前记录了多天累积值，或者记录为空），强制覆盖更新并标记改变
            if (!areDailyProfitEntriesEqual(nextHistory[date], nextEntry)) {
                nextHistory[date] = nextEntry;
                historyChanged = true;
            }
        } else if (nextHistory[date]) {
            delete nextHistory[date];
            historyChanged = true;
        }
    }

    return { history: nextHistory, changed: historyChanged };
}

async function reconcileDailyProfitHistory(history, funds, fetchedData, dominantMarketPrevPriceDate = '') {
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

    // 1. 先用传统的今日/昨日最新更新记录今日/昨日收益
    const recordRes = recordDailyProfitHistory(normalizedHistory, funds, priceUpdates, dominantMarketPrevPriceDate);
    
    // 2. 然后，自动扫描历史库中真实存在的断档交易日，并利用已补全的数据库行情进行历史收益回溯计算
    const backfillRes = await backfillMissingDailyProfitHistory(recordRes.history, funds);

    return {
        history: backfillRes.history,
        changed: recordRes.changed || backfillRes.changed
    };
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

function shiftYear(yearKey, delta) {
    const y = Number(yearKey) || new Date().getFullYear();
    return String(y + delta);
}

function formatProfitCalendarYear(yearKey) {
    return `${yearKey}年`;
}

function buildYearMonthGrid(yearKey) {
    return Array.from({ length: 12 }, (_, i) => ({
        type: 'month',
        key: `${yearKey}-${String(i + 1).padStart(2, '0')}`,
        month: i + 1
    }));
}

function buildAllYearsGrid(history) {
    const years = new Set();
    for (const date of Object.keys(history || {})) {
        years.add(date.slice(0, 4));
    }
    const currentYear = getToday().slice(0, 4);
    years.add(currentYear);
    return Array.from(years).sort().map(y => ({ type: 'year', key: y }));
}

function aggregateProfitHistoryByPeriod(history, periodFn) {
    const result = {};
    for (const [date, entry] of Object.entries(history || {})) {
        const key = periodFn(date);
        if (!result[key]) {
            result[key] = { totalProfit: 0, byCode: {}, dividendsByCode: {}, totalDividend: 0, days: 0 };
        }
        const r = result[key];
        r.totalProfit = round2(r.totalProfit + (entry.totalProfit || 0));
        r.days += 1;
        for (const [code, p] of Object.entries(entry.byCode || {})) {
            r.byCode[code] = round2((r.byCode[code] || 0) + p);
        }
        for (const [code, d] of Object.entries(entry.dividendsByCode || {})) {
            r.dividendsByCode[code] = round2((r.dividendsByCode[code] || 0) + d);
            r.totalDividend = round2(r.totalDividend + d);
        }
    }
    return result;
}

function getCurrentProfitCalendarContext() {
    const visibleItems = allFundsData.filter(item => groupFilterController.matches(item));
    const visibleCodes = new Set(visibleItems.map(item => item.code));
    const label = groupFilterController.titleLabel();
    return {
        filter: groupFilterController.serialize(),
        title: label ? `${label} 收益日历` : '全部收益日历',
        visibleItems,
        visibleCodes
    };
}

function getFilteredProfitHistory(history, filter) {
    const normalized = normalizeDailyProfitHistory(history);
    if (groupFilterController.isAll()) return normalized;

    const selectedGroups = new Set(groupFilterController.selectedGroups());
    const groupByCode = new Map(allFundsData.map(item => [item.code, item.group || '默认']));
    const inFilter = (code) => selectedGroups.has(groupByCode.get(code) || '默认');
    const filtered = {};
    for (const [date, entry] of Object.entries(normalized)) {
        const byCode = {};
        let totalProfit = 0;
        for (const [code, profit] of Object.entries(entry.byCode || {})) {
            if (!inFilter(code)) continue;
            byCode[code] = profit;
            totalProfit = round2(totalProfit + profit);
        }
        const dividendsByCode = {};
        let totalDividend = 0;
        for (const [code, amount] of Object.entries(entry.dividendsByCode || {})) {
            if (!inFilter(code)) continue;
            dividendsByCode[code] = amount;
            totalDividend = round2(totalDividend + amount);
        }
        if (Object.keys(byCode).length > 0 || Object.keys(dividendsByCode).length > 0) {
            filtered[date] = { totalProfit, byCode, dividendsByCode, totalDividend };
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
    const stored = await storageHelper.getAll(['dailyProfitHistory']);
    const history = normalizeDailyProfitHistory(stored.dailyProfitHistory);

    const render = () => {
        const context = getCurrentProfitCalendarContext();
        const filteredHistory = getFilteredProfitHistory(history, context.filter);
        const allDates = Object.keys(filteredHistory).sort();
        const latestDate = allDates[allDates.length - 1] || getToday();
        const latestMonth = latestDate.slice(0, 7);
        const latestYear = latestDate.slice(0, 4);

        if (!/^\d{4}-\d{2}$/.test(profitCalendarViewMonth)) profitCalendarViewMonth = latestMonth;
        if (!/^\d{4}$/.test(profitCalendarViewYear)) profitCalendarViewYear = latestYear;
        if (!['day', 'month', 'year'].includes(profitCalendarViewMode)) profitCalendarViewMode = 'day';

        const monthlyTotals = aggregateProfitHistoryByPeriod(filteredHistory, date => date.slice(0, 7));
        const yearlyTotals = aggregateProfitHistoryByPeriod(filteredHistory, date => date.slice(0, 4));
        const codeMap = new Map(allFundsData.map(item => [item.code, item]));

        const todayStr = getToday();
        const todayMonth = todayStr.slice(0, 7);
        const todayYear = todayStr.slice(0, 4);

        let gridCells = [];
        let gridClass = '';
        let gridMaxAbs = 1;
        let weekdayHtml = '';
        let navTitleText = '';
        let navPrevDelta = 0;
        let navNextDelta = 0;
        let summaryLabel = '';
        let summaryDays = '';
        let summaryTotal = 0;
        let summaryHasData = false;
        let selectedKey = '';
        let selectedEntry = { totalProfit: 0, byCode: {}, dividendsByCode: {}, totalDividend: 0, days: 0 };
        let selectedHeaderLabel = '';
        let detailCountLabel = '收益合计';
        let emptyMessage = '';

        if (profitCalendarViewMode === 'day') {
            if (!filteredHistory[profitCalendarSelectedDate] || !profitCalendarSelectedDate.startsWith(`${profitCalendarViewMonth}-`)) {
                const monthDates = getProfitCalendarMonthDates(filteredHistory, profitCalendarViewMonth);
                profitCalendarSelectedDate = monthDates[monthDates.length - 1] || '';
            }
            const monthDates = getProfitCalendarMonthDates(filteredHistory, profitCalendarViewMonth);
            const monthValues = monthDates.map(d => Math.abs(filteredHistory[d]?.totalProfit || 0));
            gridMaxAbs = Math.max(...monthValues, 1);
            gridClass = 'view-day';
            weekdayHtml = ['一', '二', '三', '四', '五', '六', '日']
                .map(day => `<div class="profit-calendar-weekday">${day}</div>`)
                .join('');
            navTitleText = formatProfitCalendarMonth(profitCalendarViewMonth);
            navPrevDelta = -1;
            navNextDelta = 1;

            gridCells = buildProfitHistoryMonthGrid(profitCalendarViewMonth).map(cell => {
                if (cell.type === 'empty') return { empty: true };
                const entry = filteredHistory[cell.date];
                const hasData = !!entry && Object.keys(entry.byCode || {}).length > 0;
                const hasDividend = !!entry && Object.keys(entry.dividendsByCode || {}).length > 0;
                const totalProfit = round2(entry?.totalProfit || 0);
                return {
                    kind: 'date',
                    key: cell.date,
                    label: String(Number(cell.date.slice(-2))),
                    valueText: hasData ? formatProfit(totalProfit) : '暂无',
                    hasData,
                    hasDividend,
                    totalProfit,
                    dividendTotal: round2(entry?.totalDividend || 0),
                    isToday: cell.date === todayStr,
                    isSelected: cell.date === profitCalendarSelectedDate
                };
            });

            summaryLabel = `${formatProfitCalendarMonth(profitCalendarViewMonth)} 月收益`;
            summaryDays = monthDates.length > 0 ? `${monthDates.length} 个交易日` : '暂无记录';
            summaryTotal = round2(monthDates.reduce((sum, d) => sum + (filteredHistory[d]?.totalProfit || 0), 0));
            summaryHasData = monthDates.length > 0;
            selectedKey = profitCalendarSelectedDate;
            selectedEntry = profitCalendarSelectedDate
                ? (filteredHistory[profitCalendarSelectedDate] || selectedEntry)
                : selectedEntry;
            selectedHeaderLabel = profitCalendarSelectedDate
                ? formatProfitCalendarDate(profitCalendarSelectedDate)
                : `${formatProfitCalendarMonth(profitCalendarViewMonth)} 暂无记录`;
            detailCountLabel = '日收益合计';
            emptyMessage = allDates.length === 0
                ? '还没有日收益记录。完成一次自动或手动结算后会显示在这里。'
                : (monthDates.length === 0 ? '该月份暂无已记录收益。' : '当天暂无已记录收益。');
        } else if (profitCalendarViewMode === 'month') {
            const yearMonths = Object.keys(monthlyTotals).filter(k => k.startsWith(`${profitCalendarViewYear}-`));
            if (!yearMonths.includes(profitCalendarSelectedMonth)) {
                profitCalendarSelectedMonth = yearMonths[yearMonths.length - 1] || '';
            }
            const monthAbs = yearMonths.map(k => Math.abs(monthlyTotals[k]?.totalProfit || 0));
            gridMaxAbs = Math.max(...monthAbs, 1);
            gridClass = 'view-month';
            navTitleText = formatProfitCalendarYear(profitCalendarViewYear);
            navPrevDelta = -1;
            navNextDelta = 1;

            gridCells = buildYearMonthGrid(profitCalendarViewYear).map(cell => {
                const entry = monthlyTotals[cell.key];
                const hasData = !!entry && Object.keys(entry.byCode || {}).length > 0;
                const hasDividend = !!entry && Object.keys(entry.dividendsByCode || {}).length > 0;
                const totalProfit = round2(entry?.totalProfit || 0);
                return {
                    kind: 'month',
                    key: cell.key,
                    label: `${cell.month}月`,
                    valueText: hasData ? formatProfit(totalProfit) : '暂无',
                    hasData,
                    hasDividend,
                    totalProfit,
                    dividendTotal: round2(entry?.totalDividend || 0),
                    isToday: cell.key === todayMonth,
                    isSelected: cell.key === profitCalendarSelectedMonth
                };
            });

            const yearTotal = yearlyTotals[profitCalendarViewYear];
            summaryLabel = `${formatProfitCalendarYear(profitCalendarViewYear)} 年收益`;
            summaryDays = yearTotal && yearTotal.days > 0 ? `${yearMonths.length} 个月 · ${yearTotal.days} 个交易日` : '暂无记录';
            summaryTotal = round2(yearTotal?.totalProfit || 0);
            summaryHasData = !!yearTotal && yearTotal.days > 0;
            selectedKey = profitCalendarSelectedMonth;
            selectedEntry = profitCalendarSelectedMonth
                ? (monthlyTotals[profitCalendarSelectedMonth] || selectedEntry)
                : selectedEntry;
            selectedHeaderLabel = profitCalendarSelectedMonth
                ? `${formatProfitCalendarMonth(profitCalendarSelectedMonth)} · ${selectedEntry.days || 0} 个交易日`
                : `${formatProfitCalendarYear(profitCalendarViewYear)} 暂无记录`;
            detailCountLabel = '月收益合计';
            emptyMessage = allDates.length === 0
                ? '还没有日收益记录。完成一次自动或手动结算后会显示在这里。'
                : (yearMonths.length === 0 ? '该年份暂无已记录收益。' : '所选月份暂无明细。');
        } else {
            const allYears = Object.keys(yearlyTotals).sort();
            if (!allYears.includes(profitCalendarSelectedYear)) {
                profitCalendarSelectedYear = allYears[allYears.length - 1] || '';
            }
            const yearAbs = allYears.map(y => Math.abs(yearlyTotals[y]?.totalProfit || 0));
            gridMaxAbs = Math.max(...yearAbs, 1);
            gridClass = 'view-year';
            navTitleText = '全部年份';

            const yearGrid = buildAllYearsGrid(filteredHistory);
            gridCells = yearGrid.map(cell => {
                const entry = yearlyTotals[cell.key];
                const hasData = !!entry && Object.keys(entry.byCode || {}).length > 0;
                const hasDividend = !!entry && Object.keys(entry.dividendsByCode || {}).length > 0;
                const totalProfit = round2(entry?.totalProfit || 0);
                return {
                    kind: 'year',
                    key: cell.key,
                    label: `${cell.key}年`,
                    valueText: hasData ? formatProfit(totalProfit) : '暂无',
                    hasData,
                    hasDividend,
                    totalProfit,
                    dividendTotal: round2(entry?.totalDividend || 0),
                    isToday: cell.key === todayYear,
                    isSelected: cell.key === profitCalendarSelectedYear
                };
            });

            const allTotal = allDates.reduce((sum, d) => sum + (filteredHistory[d]?.totalProfit || 0), 0);
            const totalDays = allDates.length;
            summaryLabel = '全部年份收益';
            summaryDays = totalDays > 0 ? `${allYears.length} 年 · ${totalDays} 个交易日` : '暂无记录';
            summaryTotal = round2(allTotal);
            summaryHasData = totalDays > 0;
            selectedKey = profitCalendarSelectedYear;
            selectedEntry = profitCalendarSelectedYear
                ? (yearlyTotals[profitCalendarSelectedYear] || selectedEntry)
                : selectedEntry;
            selectedHeaderLabel = profitCalendarSelectedYear
                ? `${formatProfitCalendarYear(profitCalendarSelectedYear)} · ${selectedEntry.days || 0} 个交易日`
                : '暂无记录';
            detailCountLabel = '年收益合计';
            emptyMessage = allDates.length === 0
                ? '还没有日收益记录。完成一次自动或手动结算后会显示在这里。'
                : '所选年份暂无明细。';
        }

        const gridHtml = gridCells.map(cell => {
            if (cell.empty) return '<div class="profit-calendar-cell empty"></div>';
            const alpha = cell.hasData
                ? (0.12 + Math.min(Math.abs(cell.totalProfit) / gridMaxAbs, 1) * 0.2).toFixed(2)
                : '0.16';
            const dividendBadge = cell.hasDividend
                ? `<span class="profit-calendar-day-badge" title="期间有分红 ${formatProfit(cell.dividendTotal)}">分</span>`
                : '';
            const isPositive = cell.totalProfit > 0;
            const isNegative = cell.totalProfit < 0;
            return `
                <button
                    type="button"
                    class="profit-calendar-day-btn ${cell.hasData ? 'has-data' : ''} ${isPositive ? 'positive' : ''} ${isNegative ? 'negative' : ''} ${cell.hasDividend ? 'has-dividend' : ''} ${cell.isToday ? 'is-today' : ''} ${cell.isSelected ? 'is-selected' : ''}"
                    data-calendar-cell="${cell.kind}:${cell.key}"
                    style="--calendar-alpha:${alpha};"
                >
                    ${dividendBadge}
                    <span class="profit-calendar-day-label">${cell.label}</span>
                    <span class="profit-calendar-day-value">${cell.valueText}</span>
                </button>
            `;
        }).join('');

        const selectedDividends = selectedEntry.dividendsByCode || {};
        const detailCodes = new Set([
            ...Object.keys(selectedEntry.byCode || {}),
            ...Object.keys(selectedDividends)
        ]);
        const detailRows = Array.from(detailCodes)
            .map(code => ({
                code,
                name: codeMap.get(code)?.name || code,
                profit: round2(Number(selectedEntry.byCode?.[code]) || 0),
                dividend: round2(Number(selectedDividends[code]) || 0)
            }))
            .sort((a, b) => (b.profit + b.dividend) - (a.profit + a.dividend) || a.code.localeCompare(b.code));

        const detailHtml = detailRows.length > 0
            ? `
                <div class="profit-calendar-detail-list">
                    ${detailRows.map(item => {
                        const combined = round2(item.profit + item.dividend);
                        const dividendNote = item.dividend > 0
                            ? `<span class="profit-calendar-detail-dividend" title="期间分红">分红 ${formatProfit(item.dividend)}</span>`
                            : '';
                        const combinedNote = item.dividend > 0
                            ? `<span class="profit-calendar-detail-combined ${combined > 0 ? 'positive' : ''} ${combined < 0 ? 'negative' : ''}">合计 ${formatProfit(combined)}</span>`
                            : '';
                        return `
                        <div class="profit-calendar-detail-row">
                            <div class="profit-calendar-detail-name" title="${escapeHtml(item.name)} (${item.code})">
                                ${escapeHtml(item.name)} (${item.code})
                                ${dividendNote}
                            </div>
                            <div class="profit-calendar-detail-values">
                                <div class="profit-calendar-detail-profit ${item.profit > 0 ? 'positive' : ''} ${item.profit < 0 ? 'negative' : ''}">
                                    ${formatProfit(item.profit)}
                                </div>
                                ${combinedNote}
                            </div>
                        </div>
                    `;
                    }).join('')}
                </div>
            `
            : `<div class="profit-calendar-detail-empty">${emptyMessage}</div>`;

        const selectedTotalDividend = round2(selectedEntry.totalDividend || 0);
        const detailHeaderTotal = selectedKey ? formatProfit(round2(selectedEntry.totalProfit || 0)) : '—';
        const selectedCount = detailRows.length;
        const dividendCount = Object.keys(selectedDividends).length;
        const detailBadgeText = !selectedKey
            ? '未选中范围'
            : (selectedCount > 0
                ? (dividendCount > 0 ? `${selectedCount} 项明细 · ${dividendCount} 项分红` : `${selectedCount} 项明细`)
                : '无明细');
        const detailBadgeClass = selectedEntry.totalProfit > 0 ? 'positive' : (selectedEntry.totalProfit < 0 ? 'negative' : '');

        const summaryTotalClass = summaryTotal > 0 ? 'positive' : (summaryTotal < 0 ? 'negative' : '');
        const summaryTotalText = summaryHasData ? formatProfit(summaryTotal) : '—';

        const weekdaySection = profitCalendarViewMode === 'day'
            ? `<div class="profit-calendar-weekdays">${weekdayHtml}</div>`
            : '';
        const navArrowsHtml = profitCalendarViewMode === 'year'
            ? ''
            : `
                <button type="button" class="profit-calendar-nav-btn" data-calendar-nav="${navPrevDelta}">‹</button>
                <div class="profit-calendar-month">${navTitleText}</div>
                <button type="button" class="profit-calendar-nav-btn" data-calendar-nav="${navNextDelta}">›</button>
            `;
        const navTitleOnlyHtml = profitCalendarViewMode === 'year'
            ? `<div class="profit-calendar-month">${navTitleText}</div>`
            : '';
        const viewToggleHtml = ['day', 'month', 'year'].map(mode => {
            const label = mode === 'day' ? '日' : mode === 'month' ? '月' : '年';
            const active = profitCalendarViewMode === mode ? 'is-active' : '';
            return `<button type="button" class="profit-calendar-view-btn ${active}" data-calendar-view="${mode}">${label}</button>`;
        }).join('');

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
                            ${navArrowsHtml}
                            ${navTitleOnlyHtml}
                            <div class="profit-calendar-view-toggle">${viewToggleHtml}</div>
                            <button type="button" class="profit-calendar-nav-btn close-btn" data-calendar-close="true" title="关闭">✕</button>
                        </div>
                    </div>
                </div>
                <div class="profit-calendar-month-summary">
                    <div class="profit-calendar-month-summary-label">
                        <span>${summaryLabel}</span>
                        <span class="profit-calendar-month-summary-days">${summaryDays}</span>
                    </div>
                    <div class="profit-calendar-month-summary-total ${summaryTotalClass}">${summaryTotalText}</div>
                </div>
                <div class="profit-calendar-legend">
                    <div class="profit-calendar-legend-item"><span class="profit-calendar-legend-dot positive"></span><span>盈利</span></div>
                    <div class="profit-calendar-legend-item"><span class="profit-calendar-legend-dot negative"></span><span>亏损</span></div>
                    <div class="profit-calendar-legend-item"><span class="profit-calendar-legend-dot neutral"></span><span>今日/选中</span></div>
                </div>
                ${weekdaySection}
                <div class="profit-calendar-grid ${gridClass}">${gridHtml}</div>
                <div class="profit-calendar-detail">
                    <div class="profit-calendar-detail-header">
                        <div class="profit-calendar-detail-heading">
                            <div class="profit-calendar-detail-date">${selectedHeaderLabel}</div>
                            <div class="profit-calendar-detail-badge ${detailBadgeClass}">${detailBadgeText}</div>
                        </div>
                        <div class="profit-calendar-detail-summary">
                            <div class="profit-calendar-detail-count">${detailCountLabel}</div>
                            <div class="profit-calendar-detail-total ${selectedEntry.totalProfit > 0 ? 'positive' : ''} ${selectedEntry.totalProfit < 0 ? 'negative' : ''}">
                                ${detailHeaderTotal}
                            </div>
                            ${selectedTotalDividend > 0 && selectedKey ? `
                                <div class="profit-calendar-detail-dividend-total" title="期间分红合计（已计入累计净值收益）">
                                    含分红 ${formatProfit(selectedTotalDividend)}
                                </div>
                            ` : ''}
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

            const viewBtn = event.target.closest('[data-calendar-view]');
            if (viewBtn) {
                const nextMode = viewBtn.dataset.calendarView;
                if (nextMode === profitCalendarViewMode) return;
                if (nextMode === 'month' && profitCalendarSelectedDate) {
                    profitCalendarViewYear = profitCalendarSelectedDate.slice(0, 4);
                    profitCalendarSelectedMonth = profitCalendarSelectedDate.slice(0, 7);
                } else if (nextMode === 'month' && !/^\d{4}$/.test(profitCalendarViewYear)) {
                    profitCalendarViewYear = profitCalendarViewMonth.slice(0, 4) || latestYear;
                }
                if (nextMode === 'day' && profitCalendarSelectedMonth) {
                    profitCalendarViewMonth = profitCalendarSelectedMonth;
                }
                if (nextMode === 'year' && profitCalendarSelectedMonth) {
                    profitCalendarSelectedYear = profitCalendarSelectedMonth.slice(0, 4);
                } else if (nextMode === 'year' && profitCalendarSelectedDate) {
                    profitCalendarSelectedYear = profitCalendarSelectedDate.slice(0, 4);
                }
                profitCalendarViewMode = nextMode;
                render();
                return;
            }

            const navBtn = event.target.closest('[data-calendar-nav]');
            if (navBtn) {
                const delta = Number(navBtn.dataset.calendarNav);
                if (profitCalendarViewMode === 'day') {
                    profitCalendarViewMonth = shiftMonth(profitCalendarViewMonth, delta);
                    profitCalendarSelectedDate = '';
                } else if (profitCalendarViewMode === 'month') {
                    profitCalendarViewYear = shiftYear(profitCalendarViewYear, delta);
                    profitCalendarSelectedMonth = '';
                }
                render();
                return;
            }

            const cellBtn = event.target.closest('[data-calendar-cell]');
            if (cellBtn) {
                const [kind, key] = cellBtn.dataset.calendarCell.split(':');
                if (kind === 'date') {
                    profitCalendarSelectedDate = key;
                } else if (kind === 'month') {
                    profitCalendarSelectedMonth = key;
                } else if (kind === 'year') {
                    profitCalendarSelectedYear = key;
                }
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
    if (!/^\d{4}$/.test(profitCalendarViewYear)) {
        profitCalendarViewYear = initialLatestDate.slice(0, 4);
    }
    profitCalendarSelectedDate = getProfitCalendarSelectedDate(
        initialFilteredHistory,
        profitCalendarViewMonth,
        profitCalendarSelectedDate
    );

    render();
}

// 交易域函数已拆分到 popup_trade.js：
// - 交易归一化 / 迁移
// - 交易运行时状态
// - 自动分红与待确认订单辅助
// - 结算辅助

// ==================== 备份与结算状态管理 ====================
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
        return;
    }

    const { settlementDate, blockedDate } = parseSettlementState(snapshot?.lastSettlementDate, snapshot?.autoSettlementBlockedDate);
    const { orders, states } = await HistoryDB.getAllExportData().catch(() => ({ orders: [], states: [] }));
    const backupData = {
        version: '1.1',
        exportDate: new Date().toISOString(),
        backupDate: todayStr,
        lastUpdateDate: snapshot?.lastUpdateDate || getToday(),
        lastDayProfits: snapshot?.lastDayProfits || {},
        lastSettlementDate: settlementDate,
        autoSettlementBlockedDate: blockedDate,
        myFunds: funds,
        dailyProfitHistory: normalizeDailyProfitHistory(snapshot?.dailyProfitHistory),
        tradeHistoryDB: Array.isArray(orders) ? orders : [],
        fundDailyStateDB: Array.isArray(states) ? states : []
    };
    await storageHelper.setAll({ backupFunds: backupData });
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
            debugDividendTrace(fund.code || '', 'fallback-dividend-compensation', {
                dividendPerShare,
                savedPrevDate,
                prevPriceDate
            });
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
async function _applySettlementLoop(funds, priceUpdates, todayStr) {
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
            syncAddedDateByPosition(funds[code], todayStr);
            continue;
        }

        const baseAcNet = item.savedAcNetValue || null;

        // ── 分红检测与收益计算 ────────────────────────────────────────────────
        const { dividendPerShare, hasDividend, totalPeriodProfit } = detectDividendAndProfit(
            item,
            { price, acNetValue, prevPriceDate, dividendList },
            shares
        );
        debugDividendTrace(code, 'settlement-detect-dividend', {
            prevPriceDate: prevPriceDate || '',
            savedPrevDate: item.savedPrevDate || '',
            basePrice: item.savedPrevPrice || 0,
            price,
            hasDividend,
            dividendPerShare,
            totalPeriodProfit
        });

        const dividendMode = item.dividendMode || 'cash'; // 'cash' | 'reinvest'
        const totalDividend = hasDividend ? round2(shares * dividendPerShare) : 0;

        // 若结算层通过累计净值差识别到分红，但分红列表缺失导致未建单，
        // 在此兜底补一条自动分红订单，保证“收益修正”和“交易记录”一致。
        if (hasDividend && totalDividend > 0 && prevPriceDate) {
            const fallbackDividendDate = getSettlementFallbackDividendDate(item, prevPriceDate, dividendPerShare);
            debugDividendTrace(code, 'settlement-fallback-dividend-prepare', {
                prevPriceDate,
                fallbackDividendDate,
                dividendPerShare,
                totalDividend
            });
            const createdFallback = await ensureAutoDetectedDividendEntry(item, code, {
                date: fallbackDividendDate,
                perShare: dividendPerShare,
                navPrice: price
            }, todayStr, false, 'fallback');
            debugDividendTrace(code, createdFallback ? 'settlement-fallback-dividend-created' : 'settlement-fallback-dividend-skipped', {
                createdFallback,
                pendingCount: safeArray(runtimeTradeOrdersMap.get(code), []).filter(o => o.status !== 'confirmed').length
            });
        }

        // ── 单日昨日收益 ────────────────────────────────────────────────────────
        // 只要接口能提供上一笔有效净值，就按该净值差计算“昨日收益”。
        // 某些基金会因为停牌/节假日/接口缺口导致上一笔净值日期早于上一个自然日，
        // 此时仍应展示最近一个有效交易日对应的收益，而不是直接归 0。
        let yesterdayProfit = calculateYesterdayProfitValue(item, {
            price,
            prevPriceDate,
            prevTradingDayPrice,
            prevTradingDayDate,
            acNetValue: acNetValue,
            prevAcNetValue: item.savedAcNetValue
        });

        // 现金分红场景：昨日收益展示需要包含当日分红补偿，避免分红日出现误负值。
        // 分红入账由交易确认流程处理，将通过 getDisplayedYesterdayProfitValue 动态附加补偿，这里不再重复修改基础昨日收益。

        // ── 红利再投：增加份额 ────────────────────────────────────────────────
        if (hasDividend && dividendMode === 'reinvest' && price > 0) {
            const newShares = round6(totalDividend / price);
            shares = round6(shares + newShares);
            funds[code].shares = shares;
            debugDividendTrace(code, 'settlement-dividend-reinvest', {
                newShares,
                totalDividend,
                price
            });
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
        syncAddedDateByPosition(funds[code], todayStr);

        if (hasDividend) {
            debugDividendTrace(code, 'settlement-writeback-dividend', {
                dividendMode,
                dividendPerShare,
                totalDividend,
                yesterdayProfit,
                holdProfit: funds[code].holdProfit,
                savedPrevDate: funds[code].savedPrevDate
            });
        }

        updatedCount++;
    }
    return updatedCount;
}

// ==================== 手动日结算 ====================
async function manualSettlement() {
    const ok = await showConfirm('确认进行日结算吗？\n系统将对比最新公布的净值与上次结算的净值，计算并记录收益。', '日结算确认');
    if (!ok) return;

    const todayStr = getToday();
    const { myFunds, lastUpdateDate, lastDayProfits, lastSettlementDate, autoSettlementBlockedDate, backupFunds, dailyProfitHistory } = await storageHelper.getAll([
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
    const tradeOrdersMap = await buildTradeOrdersMap(codes);
    await detectAutoDividends(funds, fetchedData, todayStr, tradeOrdersMap);

    const settlements = [];
    for (const { code, live } of fetchedData) {
        const settlement = buildSettlementEntry(code, live);
        if (settlement) settlements.push(settlement);
    }

    const dominantMarketPrevPriceDate = getDominantMarketPrevPriceDate(fetchedData);
    const updatedCount = await _applySettlementLoop(funds, settlements, todayStr);
    const { history: nextDailyProfitHistory } = recordDailyProfitHistory(dailyProfitHistory, funds, settlements, dominantMarketPrevPriceDate);

    await saveSettlementState(funds, todayStr, blockedDate === todayStr ? todayStr : null, nextDailyProfitHistory);
    showToast(`✅ 结算完成！已更新 ${updatedCount} 条`, 'success');
    checkBackup();
    loadData();
}

// ==================== 撤销结算 ====================
async function rollbackSettlement() {
    const { backupFunds } = await storageHelper.getAll(['backupFunds']);
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
    await storageHelper.setAll({
        myFunds: cloneData(backupFunds.myFunds),
        lastUpdateDate: backupFunds.lastUpdateDate || '',
        lastDayProfits: cloneData(backupFunds.lastDayProfits || {}),
        dailyProfitHistory: normalizeDailyProfitHistory(backupFunds.dailyProfitHistory),
        lastSettlementDate: settlementDate,
        autoSettlementBlockedDate: todayStr
    });

    if (Array.isArray(backupFunds.tradeHistoryDB)) {
        try {
            await HistoryDB.clearUserDataOnly();
            await HistoryDB.replaceOrders(backupFunds.tradeHistoryDB || []);
            await HistoryDB.replaceStateRecords(backupFunds.fundDailyStateDB || []);
        } catch (dbErr) {
            console.error('[rollbackSettlement] 恢复交易/状态库失败:', dbErr);
        }
    } else {
        try {
            await rollbackTodayConfirmedOrdersToPending(todayStr);
        } catch (fallbackErr) {
            console.error('[rollbackSettlement] 旧版备份兜底回滚交易失败:', fallbackErr);
        }
    }

    showToast('✅ 已撤销结算，数据已恢复！今日不再自动结算，如需结算请手动触发。', 'success', 5000);
    checkBackup();
    loadData();
}

// ==================== 自动结算 ====================
async function autoSettlement(funds, settlements, todayStr, backupSnapshot) {
    elements.statusText.innerText = '正在自动结算...';

    await backupFundsData(backupSnapshot);
    const dominantMarketPrevPriceDate = getDominantMarketPrevPriceDate(settlements.map(settlement => ({ live: settlement })));
    const updatedCount = await _applySettlementLoop(funds, settlements, todayStr);
    const { history: nextDailyProfitHistory } = recordDailyProfitHistory(backupSnapshot?.dailyProfitHistory, funds, settlements, dominantMarketPrevPriceDate);
    await saveSettlementState(funds, todayStr, null, nextDailyProfitHistory);

    if (updatedCount === 0) {
        return;
    }
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
        const { fundHistoryData: stored = {} } = await storageHelper.getAll(['fundHistoryData']);
        let loaded = 0;
        for (const code in stored) {
            // 双重过滤：必须是今日数据 && 必须是当前基金列表里的
            if (stored[code].date === todayStr && activeSet.has(code)) {
                fundHistoryData[code] = stored[code];
                loaded++;
            }
        }
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
            await storageHelper.setAll({ fundHistoryData });
        } catch (err) {
            console.warn('[走势数据] 保存失败:', err);
        }
    }, 1000); // 1秒防抖
}

const groupFilterController = (() => {
    const ALL = '__all__';
    let availableGroups = [];
    let selected = new Set([ALL]);
    const changeListeners = [];
    let rootEl = null;
    let triggerEl = null;
    let labelEl = null;
    let popoverEl = null;

    function ensureValid() {
        if (selected.size === 0) selected = new Set([ALL]);
        if (selected.has(ALL) && selected.size > 1) selected = new Set([ALL]);
    }

    function updateLabel() {
        if (!labelEl || !rootEl) return;
        if (selected.has(ALL)) {
            labelEl.textContent = '全部显示';
            rootEl.setAttribute('data-state', 'all');
        } else if (selected.size === 1) {
            labelEl.textContent = [...selected][0];
            rootEl.setAttribute('data-state', 'one');
        } else {
            labelEl.textContent = `${selected.size} 个分组`;
            rootEl.setAttribute('data-state', 'multi');
        }
    }

    function rebuildPopover() {
        if (!popoverEl) return;
        popoverEl.replaceChildren();
        const makeRow = (value, text, isAll) => {
            const row = document.createElement('label');
            row.className = 'multi-select-option' + (isAll ? ' is-all' : '');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = value;
            cb.checked = selected.has(value);
            cb.addEventListener('change', () => {
                if (isAll) {
                    selected = cb.checked ? new Set([ALL]) : new Set();
                } else {
                    selected.delete(ALL);
                    if (cb.checked) selected.add(value);
                    else selected.delete(value);
                    if (availableGroups.length > 0 && selected.size >= availableGroups.length) {
                        selected = new Set([ALL]);
                    }
                }
                ensureValid();
                rebuildPopover();
                updateLabel();
                for (const fn of changeListeners) {
                    try { fn(); } catch (_) {}
                }
            });
            const span = document.createElement('span');
            span.textContent = text;
            row.append(cb, span);
            popoverEl.appendChild(row);
        };
        makeRow(ALL, '全部显示', true);
        availableGroups.forEach(g => makeRow(g, g, false));
    }

    return {
        bind() {
            rootEl = document.getElementById('groupFilter');
            if (!rootEl) return;
            triggerEl = rootEl.querySelector('.multi-select-trigger');
            labelEl = rootEl.querySelector('.multi-select-label');
            popoverEl = rootEl.querySelector('.multi-select-popover');
            if (!triggerEl || !popoverEl) return;
            triggerEl.addEventListener('click', (e) => {
                e.stopPropagation();
                const willOpen = popoverEl.hidden;
                popoverEl.hidden = !willOpen;
                triggerEl.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            });
            document.addEventListener('click', (e) => {
                if (popoverEl.hidden) return;
                if (!rootEl.contains(e.target)) {
                    popoverEl.hidden = true;
                    triggerEl.setAttribute('aria-expanded', 'false');
                }
            });
            popoverEl.addEventListener('click', (e) => e.stopPropagation());
            updateLabel();
        },
        populate(groups) {
            availableGroups = Array.from(new Set(groups || [])).sort();
            for (const v of [...selected]) {
                if (v !== ALL && !availableGroups.includes(v)) selected.delete(v);
            }
            ensureValid();
            rebuildPopover();
            updateLabel();
        },
        matches(item) {
            if (selected.has(ALL)) return true;
            return selected.has((item && item.group) || '默认');
        },
        isAll() { return selected.has(ALL); },
        selectedGroups() { return selected.has(ALL) ? [] : [...selected]; },
        onChange(fn) {
            if (typeof fn === 'function') changeListeners.push(fn);
        },
        titleLabel() {
            if (selected.has(ALL)) return '';
            if (selected.size === 1) return [...selected][0];
            return `${selected.size} 个分组`;
        },
        serialize() {
            return selected.has(ALL) ? 'all' : [...selected].sort().join('|');
        }
    };
})();

function updateGroupFilter() {
    const groupList = elements.groupList;
    const groups = Array.from(new Set(allFundsData.map(item => item.group || '默认'))).sort();
    groupFilterController.populate(groups);
    if (groupList) {
        groupList.replaceChildren();
        groups.forEach(group => {
            const option = document.createElement('option');
            option.value = group;
            groupList.appendChild(option);
        });
    }
}

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', async () => {
    // 初始化历史数据库
    await HistoryDB.init();
    await migrateTradeDataOnce();

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
        indexSettingsBtn: document.getElementById('indexSettingsBtn'),
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
        filterBreadth: document.getElementById('filterBreadth'),
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

    // MV3 已移除 chrome.extension.getViews，改用 URL 参数判断是否全屏模式
    const isPopup = !new URLSearchParams(window.location.search).has('fullscreen');
    if (!isPopup) document.body.classList.add('is-fullscreen');

    checkBackup();
    await restoreAutoRefreshInterval();
    await initColumnVisibility();
    await initPinnedFunds();
    marketBreadthData = await restoreMarketBreadthSnapshot();
    indexQuotesData = await restoreIndexQuotesSnapshot();
    await initIndexSettings();
    renderMarketBreadthTicker();
    resetAutoRefreshCountdown();
    ensureRefreshCountdownTimer();
    triggerUnifiedRefresh('initial');

    elements.importFile.addEventListener('change', importFundsData);
    const importTradeCsvFile = document.getElementById('importTradeCsvFile');
    if (importTradeCsvFile) importTradeCsvFile.addEventListener('change', importTradeOrdersCSV);
    initFabMenu();

    elements.fullscreenBtn.onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') + '?fullscreen' });

    if (elements.indexSettingsBtn) {
        elements.indexSettingsBtn.onclick = () => openIndexSettings();
    }

    elements.refreshBtn.onclick = () => {
        triggerUnifiedRefresh('manual');
    };
    elements.refreshBtn.oncontextmenu = (e) => {
        e.preventDefault();
        toggleManualPause();
    };
    if (elements.refreshIntervalSelect) {
        elements.refreshIntervalSelect.onchange = () => {
            handleRefreshIntervalChange();
        };
    }

    groupFilterController.bind();
    groupFilterController.onChange(() => {
        clearSelection();
        renderTable();
    });

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


function renderFilterBreadth(data = marketBreadthData) {
    if (!elements.filterBreadth) return;
    if (!data) {
        elements.filterBreadth.innerHTML = '<span class="filter-breadth-empty">--</span>';
        return;
    }
    elements.filterBreadth.innerHTML = `
        <span class="filter-breadth-item is-limit-up" title="涨停"><span class="filter-breadth-label">涨停</span><span class="filter-breadth-value">${data.limitUp}</span></span>
        <span class="filter-breadth-item is-up" title="上涨"><span class="filter-breadth-label">涨</span><span class="filter-breadth-value">${data.up}</span></span>
        <span class="filter-breadth-item is-down" title="下跌"><span class="filter-breadth-label">跌</span><span class="filter-breadth-value">${data.down}</span></span>
        <span class="filter-breadth-item is-limit-down" title="跌停"><span class="filter-breadth-label">跌停</span><span class="filter-breadth-value">${data.limitDown}</span></span>
    `;
}

function renderMarketBreadthTicker() {
    if (!elements.marketTicker || !elements.marketTickerTrack) return;

    // 补回涨跌停数量刷新
    renderFilterBreadth(marketBreadthData);

    // 指数设置弹窗打开时跳过 ticker 重渲染，避免动画闪烁
    if (elements.modalOverlay && elements.modalOverlay.dataset.mode === 'index-settings') return;

    if (indexQuotesData.length === 0) {
        elements.marketTicker.classList.add('is-unavailable');
        elements.marketTickerTrack.innerHTML = `<div class="market-ticker-copy"><span class="market-ticker-empty">指数加载中...</span></div>`;
        return;
    }

    // 格式化市值
    const formatMV = (val) => {
        if (!val || val <= 0) return '';
        if (val >= 1e12) return (val / 1e12).toFixed(2) + '万亿';
        if (val >= 1e8) return (val / 1e8).toFixed(2) + '亿';
        return val;
    };

    // 渲染单项 HTML
    const content = indexQuotesData.map(idx => {
        const sign = idx.changeRate >= 0 ? '+' : '';
        const cls = idx.changeRate >= 0 ? 'is-up' : 'is-down';
        const mvStr = idx.marketValue ? `<span class="market-ticker-mv">市值 ${formatMV(idx.marketValue)}</span>` : '';
        const changeStr = idx.changeAmount !== undefined ? `<span class="market-ticker-change">${sign}${idx.changeAmount.toFixed(2)}</span>` : '';

        return `<span class="market-ticker-item is-index ${cls}">
            <span class="market-ticker-label">${idx.name}</span>
            <span class="market-ticker-price">${idx.price.toFixed(2)}</span>
            ${changeStr}
            <span class="market-ticker-value">${sign}${idx.changeRate.toFixed(2)}%</span>
            ${mvStr}
        </span>`;
    }).join('');

    elements.marketTicker.classList.remove('is-unavailable');

    // 清理旧监听
    if (window._tickerResizeObserver) {
        window._tickerResizeObserver.disconnect();
        window._tickerResizeObserver = null;
    }

    // 三倍填充保证无缝循环，始终滚动（不判断容器宽度）
    elements.marketTickerTrack.innerHTML =
        `<div class="market-ticker-copy" id="market-ticker-content">${content}${content}${content}</div>`;

    const tickerContainer = elements.marketTickerTrack;
    const tickerContent = document.getElementById('market-ticker-content');
    if (!tickerContent) return;

    // 确保 keyframe 只注入一次
    const KF_ID = '_ticker-kf-style';
    if (!document.getElementById(KF_ID)) {
        const s = document.createElement('style');
        s.id = KF_ID;
        s.textContent = `@keyframes _ticker-run{from{transform:translateX(0)}to{transform:translateX(var(--_tw))}}`;
        document.head.appendChild(s);
    }

    const applyAnimation = () => {
        // 单份宽度 = 总宽度 / 3（三倍填充）
        const singleWidth = tickerContent.scrollWidth / 3;
        if (singleWidth <= 0) return;
        const duration = Math.max(6, singleWidth / 80); // 80px/s，最少6s
        tickerContent.style.setProperty('--_tw', `-${singleWidth}px`);
        tickerContent.style.animation = `_ticker-run ${duration}s linear infinite`;
    };

    // 等一帧确保 DOM 渲染完毕再取宽度
    requestAnimationFrame(applyAnimation);

    window._tickerResizeObserver = new ResizeObserver(applyAnimation);
    window._tickerResizeObserver.observe(tickerContainer);
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
    if (isManuallyPaused) return true;

    // 增加周末判断
    const day = now.getDay();
    if (day === 0 || day === 6) return true;

    const hours = now.getHours();
    const minutes = now.getMinutes();
    const currentTimeValue = hours * 60 + minutes;

    // 9:00 之前不刷新
    if (currentTimeValue < 9 * 60) return true;

    // 15:30 之后不刷新 (对应 CONFIG.AUTO_REFRESH_PAUSE_HOUR 和 CONFIG.AUTO_REFRESH_PAUSE_MINUTE)
    const pauseTimeValue = CONFIG.AUTO_REFRESH_PAUSE_HOUR * 60 + CONFIG.AUTO_REFRESH_PAUSE_MINUTE;
    if (currentTimeValue >= pauseTimeValue) return true;

    return false;
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
        let pauseReason = '';
        if (isManuallyPaused) {
            pauseReason = '手动暂停';
        } else {
            const day = currentTime.getDay();
            if (day === 0 || day === 6) {
                pauseReason = '周末休市暂停';
            } else if (currentTime.getHours() < 9) {
                pauseReason = '开盘前暂停，09:00 后恢复';
            } else {
                pauseReason = `盘后暂停，至明日 09:00 恢复（今日 ${pauseTimeLabel} 已过）`;
            }
        }
        const actionHint = isManuallyPaused ? '右键恢复' : '';
        elements.refreshBtn.title = `自动刷新已${pauseReason}${actionHint ? '，' + actionHint : ''}`;
        elements.refreshBtn.setAttribute('aria-label', `自动刷新已${pauseReason}，仍可手动刷新`);
        if (elements.refreshBtnText) elements.refreshBtnText.textContent = '已暂停';
        return;
    }

    elements.refreshBtn.title = `刷新行情（${remainingSeconds} 秒后自动刷新，当前 ${intervalSeconds} 秒，${pauseTimeLabel} 后自动暂停）右键可暂停`;
    elements.refreshBtn.setAttribute('aria-label', `刷新行情，${remainingSeconds} 秒后自动刷新，当前自动刷新 ${intervalSeconds} 秒，${pauseTimeLabel} 后自动暂停，右键可暂停`);
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
        await storageHelper.setAll({ [CONFIG.AUTO_REFRESH_STORAGE_KEY]: normalizedSeconds });
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
        const result = await storageHelper.getAll([CONFIG.AUTO_REFRESH_STORAGE_KEY]);
        const savedSeconds = Number(result?.[CONFIG.AUTO_REFRESH_STORAGE_KEY]);
        if (CONFIG.AUTO_REFRESH_OPTIONS.includes(savedSeconds)) {
            autoRefreshIntervalMs = savedSeconds * 1000;
        }
    } catch (error) {
        console.warn('[refresh] 读取自动刷新间隔失败:', error);
    }

    try {
        const result = await storageHelper.getAll([
            CONFIG.LIVE_API_REQUEST_DATE_STORAGE_KEY,
            CONFIG.LIVE_API_FINAL_REQUEST_DATE_STORAGE_KEY
        ]);
        const savedDate = result?.[CONFIG.LIVE_API_REQUEST_DATE_STORAGE_KEY];
        lastLiveApiRequestDate = typeof savedDate === 'string' ? savedDate : '';
        const savedFinalDate = result?.[CONFIG.LIVE_API_FINAL_REQUEST_DATE_STORAGE_KEY];
        lastLiveApiFinalRequestDate = typeof savedFinalDate === 'string' ? savedFinalDate : '';
    } catch (error) {
        console.warn('[refresh] 读取当日行情请求标记失败:', error);
        lastLiveApiRequestDate = '';
        lastLiveApiFinalRequestDate = '';
    }

    try {
        const result = await storageHelper.getAll([CONFIG.MANUAL_PAUSE_STORAGE_KEY]);
        isManuallyPaused = Boolean(result?.[CONFIG.MANUAL_PAUSE_STORAGE_KEY]);
    } catch (error) {
        console.warn('[refresh] 读取手动暂停状态失败:', error);
        isManuallyPaused = false;
    }

    syncRefreshIntervalSelect();
}

async function toggleManualPause() {
    isManuallyPaused = !isManuallyPaused;

    try {
        await storageHelper.setAll({ [CONFIG.MANUAL_PAUSE_STORAGE_KEY]: isManuallyPaused });
    } catch (error) {
        console.warn('[refresh] 保存手动暂停状态失败:', error);
    }

    if (isManuallyPaused) {
        nextAutoRefreshAt = 0;
        showToast('自动刷新已暂停', 'info', CONFIG.TOAST_SHORT);
    } else {
        resetAutoRefreshCountdown();
        ensureRefreshCountdownTimer();
        showToast('自动刷新已恢复', 'success', CONFIG.TOAST_SHORT);
    }

    updateRefreshButtonState();
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
        const nowDate = new Date(now);
        const paused = isAutoRefreshPaused(nowDate);

        // 持续更新按钮状态（显示倒计时或“已暂停”）
        updateRefreshButtonState(now);

        // 如果正在刷新中，不执行逻辑
        if (unifiedRefreshPromise) return;

        if (paused) {
            // 处于暂停期间，重置下一次刷新时间为 0
            if (nextAutoRefreshAt !== 0) {
                nextAutoRefreshAt = 0;
            }
            return;
        }

        // 处于活跃期间
        if (!nextAutoRefreshAt) {
            // 刚进入活跃期间（如 9:00 到了），立即触发一次刷新
            triggerUnifiedRefresh('auto');
        } else if (now >= nextAutoRefreshAt) {
            // 到达下一次刷新时间
            triggerUnifiedRefresh('auto');
        }
    }, 1000);
}

function openIndexSettings() {
    // 指数分组配置
    const INDEX_GROUPS = [
        { label: 'A 股', codes: ['000001', '000016', '399001', '399330', '899050', '000300', '399006', '399102', '399673', '000688', '399005', '000905', '000906', '000852', '000903', '000982', '399303'] },
        { label: '港股', codes: ['HSI', 'HSTECH'] },
        { label: '美股', codes: ['IXIC', 'NDX', 'SPX', 'DJI'] },
        { label: '日韩', codes: ['N225', 'TPX', 'KS11', 'KQ11'] },
    ];

    const renderSettingsContent = () => {
        const currentCodes = new Set(indexSettings);

        // 左栏：已添加列表
        const selectedHtml = indexSettings.length === 0
            ? `<div class="index-settings-empty">暂未添加，点击右侧指数即可添加</div>`
            : indexSettings.map(code => {
                const info = SUPPORTED_INDICES.find(s => s.code === code);
                if (!info) return '';
                const quote = indexQuotesData.find(q => q.code === code);
                const hasQuote = !!quote && typeof quote.price === 'number';
                const dirCls = hasQuote ? (quote.changeRate >= 0 ? 'index-card-up' : 'index-card-down') : 'index-card-none';
                const sign = hasQuote && quote.changeRate >= 0 ? '+' : '';
                const priceStr = hasQuote ? quote.price.toFixed(2) : '--.--';
                const rateStr = hasQuote ? `${sign}${quote.changeRate.toFixed(2)}%` : '';
                return `
                    <div class="index-card ${dirCls}" draggable="true" data-code="${code}">
                        <span class="index-card-drag-handle">⠿</span>
                        <span class="index-card-title">${info.name}</span>
                        <span class="index-card-price">${priceStr}</span>
                        <span class="index-card-rate">${rateStr}</span>
                        <span class="index-card-remove" data-action="remove" data-code="${code}">✕</span>
                    </div>`;
            }).join('');

        // 右栏：按分组显示可选指数
        const groupsHtml = INDEX_GROUPS.map(group => {
            const tagsHtml = group.codes.map(code => {
                const info = SUPPORTED_INDICES.find(s => s.code === code);
                if (!info) return '';
                const isActive = currentCodes.has(code);
                return `<span class="index-tag-item${isActive ? ' active' : ''}" data-action="toggle" data-code="${code}">${info.name}</span>`;
            }).join('');
            return `<div class="index-group">
                <div class="index-group-label">${group.label}</div>
                <div class="index-group-tags">${tagsHtml}</div>
            </div>`;
        }).join('');

        return `
            <div class="index-settings-container">
                <div class="index-settings-left">
                    <div class="index-settings-col-title">已添加 · 可拖动排序</div>
                    <div class="index-settings-selected-grid" id="indexSelectedGrid">
                        ${selectedHtml}
                    </div>
                </div>
                <div class="index-settings-right">
                    <div class="index-settings-col-title">点击添加 / 再次点击移除</div>
                    <div class="index-settings-all-list" id="indexAllTags">
                        ${groupsHtml}
                    </div>
                </div>
            </div>`;
    };

    showHtmlModal('指数设置', renderSettingsContent(), [
        {
            text: '保存', cls: 'modal-btn-primary', onClick: async () => {
                await storageHelper.setAll({ [CONFIG.INDEX_SETTINGS_STORAGE_KEY]: indexSettings });
                _closeModal();
                await fetchIndexQuotes();
                renderMarketBreadthTicker();
                showToast('✅ 指数行情配置已保存', 'success');
            }
        },
        { text: '取消', cls: '', onClick: () => _closeModal() }
    ]);

    // 设置宽屏 mode
    if (elements.modalOverlay) elements.modalOverlay.dataset.mode = 'index-settings';

    const bindEvents = () => {
        const grid = document.getElementById('indexSelectedGrid');
        const tags = document.getElementById('indexAllTags');
        if (!grid || !tags) return;

        const refresh = () => {
            const container = document.querySelector('.index-settings-container');
            if (container) {
                container.parentElement.innerHTML = renderSettingsContent();
                bindEvents();
            }
        };

        // 点击 toggle
        const handleAction = (e) => {
            const el = e.target.closest('[data-action]');
            if (!el) return;
            const { action, code } = el.dataset;
            if (!code) return;
            if (action === 'remove' || (action === 'toggle' && indexSettings.includes(code))) {
                indexSettings = indexSettings.filter(c => c !== code);
            } else if (action === 'toggle') {
                indexSettings.push(code);
            }
            refresh();
        };

        grid.addEventListener('click', handleAction);
        tags.addEventListener('click', handleAction);

        // 拖拽排序
        let dragSrc = null;
        grid.addEventListener('dragstart', e => {
            const card = e.target.closest('.index-card');
            if (!card) return;
            dragSrc = card;
            e.dataTransfer.effectAllowed = 'move';
            setTimeout(() => card.classList.add('dragging'), 0);
        });
        grid.addEventListener('dragend', () => {
            if (dragSrc) dragSrc.classList.remove('dragging');
            document.querySelectorAll('.index-card.drag-over').forEach(el => el.classList.remove('drag-over'));
            dragSrc = null;
        });
        grid.addEventListener('dragover', e => {
            e.preventDefault();
            const over = e.target.closest('.index-card');
            if (!over || over === dragSrc) return;
            document.querySelectorAll('.index-card.drag-over').forEach(el => el.classList.remove('drag-over'));
            over.classList.add('drag-over');
            const rect = over.getBoundingClientRect();
            const insertBefore = (e.clientY - rect.top) < (rect.height / 2);
            grid.insertBefore(dragSrc, insertBefore ? over : over.nextSibling);
        });
        grid.addEventListener('drop', e => {
            e.preventDefault();
            indexSettings = Array.from(grid.querySelectorAll('.index-card[data-code]')).map(el => el.dataset.code);
        });
    };

    setTimeout(bindEvents, 50);
}

async function triggerUnifiedRefresh(source = 'manual') {
    if (unifiedRefreshPromise) {
        return unifiedRefreshPromise;
    }

    const skipLiveRequests = source !== 'manual' && shouldSkipLiveRequestsAfterCutoff();

    unifiedRefreshPromise = (async () => {
        updateRefreshButtonState();
        await Promise.allSettled([
            loadData({ skipLiveRequests }),
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
let _loadDataSkipLiveRequests = false;
async function loadData(options = {}) {
    const skipLiveRequests = Boolean(options.skipLiveRequests);
    if (_loadDataPromise) {
        _loadDataSkipLiveRequests = _loadDataSkipLiveRequests && skipLiveRequests;
        return _loadDataPromise;
    }

    _loadDataSkipLiveRequests = skipLiveRequests;
    _loadDataPromise = _loadDataImpl({ skipLiveRequests: _loadDataSkipLiveRequests })
        .finally(() => {
            _loadDataPromise = null;
            _loadDataSkipLiveRequests = false;
        });

    return _loadDataPromise;
}

async function _loadDataImpl({ skipLiveRequests = false } = {}) {
    try {
        clearSelection();
        elements.statusText.innerText = '同步行情中...';

        const storageState = await storageHelper.getAll([
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
        const todayStr = getToday();
        let dataChanged = false;
        for (const [code, item] of Object.entries(funds)) {
            // --- 核心优化：如果 Storage 里的标的没名字，尝试从数据库恢复 ---
            if (!item.name || item.name === code) {
                try {
                    const latest = await HistoryDB.getLatest(code);
                    if (latest && latest.name) {
                        item.name = latest.name;
                        dataChanged = true;
                    }
                } catch (dbErr) {
                    console.warn(`[RestoreName] ${code} 恢复失败:`, dbErr);
                }
            }

            if (syncAddedDateByPosition(item, todayStr)) {
                dataChanged = true;
            }
        }
        const codes = Object.keys(funds);
        const results = [];

        // 走势数据懒加载：首次调用时从 storage 读取，只加载当前基金列表里的数据
        // 后续刷新时 fundHistoryData 已在内存中，跳过重复读取
        if (Object.keys(fundHistoryData).length === 0 && codes.length > 0) {
            await loadFundHistoryData(codes);
        }

        // 1. 获取行情数据 - 优化：批量并发请求
        let fetchedData = [];
        if (skipLiveRequests) {
            fetchedData = await buildLiveDataFromSnapshot(codes, funds, todayStr);
        }

        if (!skipLiveRequests && codes.length > 0) {
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
            await Promise.all([
                persistLiveSnapshot(
                    fetchedData
                        .map(({ code, live }) => toSnapshotEntry(code, live))
                        .filter(Boolean),
                    todayStr
                ),
                persistLiveApiRequestDate(todayStr),
                isAfterAutoRefreshPauseCutoff() ? persistFinalLiveApiRequestDate(todayStr) : Promise.resolve()
            ]);
        }

        const dominantMarketPrevPriceDate = getDominantMarketPrevPriceDate(fetchedData);
        const tradeOrdersMap = await buildTradeOrdersMap(codes);

        // 2. 保留实时接口分红检测；历史分红补录改为按需触发（如添加资产时）
        dataChanged = (await detectAutoDividends(funds, fetchedData, todayStr, tradeOrdersMap)) || dataChanged;

        // 3. 自动结算逻辑（在分红检测之后）
        // 修复：同一天内如果有基金晚到更新，仍允许继续补结算；
        // 只有“今日已执行撤销”时才整天禁止自动结算。
        const { blockedDate } = parseSettlementState(lastSettlementDate, autoSettlementBlockedDate);
        const isRollbackToday = blockedDate === todayStr;
        if (!isRollbackToday) {
            const autoSettlementEntries = collectAutoSettlementEntries(funds, fetchedData, dominantMarketPrevPriceDate);
            if (autoSettlementEntries.length > 0) {
                const { backupFunds } = await storageHelper.getAll(['backupFunds']);
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

        // 历史收益数据需要在循环中用于昨日收益展示，所以先在循环前完成 reconcile
        const normalizedDailyProfitHistory = normalizeDailyProfitHistory(dailyProfitHistory);
        const { history: nextDailyProfitHistory, changed: dailyProfitHistoryChanged } = await reconcileDailyProfitHistory(
            normalizedDailyProfitHistory,
            funds,
            fetchedData,
            dominantMarketPrevPriceDate
        );

        for (const { code, live } of fetchedData) {
            const item = funds[code];
            if (live && item) {

                // 兜底：若已检测到分红提示但交易记录里还没有对应自动分红单，则在渲染前补齐。
                // 不重复发通知，仅保证交易流水与分红提示一致。
                if (item && Array.isArray(live.dividendList) && live.dividendList.length > 0) {
                    debugDividendTrace(code, 'render-precheck-dividend-list', {
                        prevPriceDate: live.prevPriceDate || '',
                        listLength: live.dividendList.length,
                        pendingCount: getPendingAdjustments(item).length
                    });
                    for (const dividend of live.dividendList) {
                        if (!dividend || !dividend.date || typeof dividend.perShare !== 'number') {
                            continue;
                        }
                        if (item.addedDate && dividend.date < item.addedDate) {
                            continue;
                        }
                        const createdFromRenderPath = await ensureAutoDetectedDividendEntry(
                            item,
                            code,
                            dividend,
                            todayStr,
                            false,
                            'api',
                            tradeOrdersMap.get(code) || []
                        );
                        if (createdFromRenderPath) {
                            dataChanged = true;
                        }
                        debugDividendTrace(code, 'render-precheck-dividend-ensure-result', {
                            dividendDate: dividend.date,
                            perShare: dividend.perShare,
                            createdFromRenderPath
                        });
                    }
                }

                let pendingAdjustments = getPendingAdjustments(item, code);

                // --- A. 处理待确认份额（加仓/减仓/分红）---
                if (pendingAdjustments.length > 0) {
                    for (const adj of pendingAdjustments) {
                        if (adj.status === 'confirmed') continue;
                        if (todayStr >= adj.targetDate) {
                            if (adj.type === 'add') {
                                const actualRate = (adj.feeRate || 0) / 100;
                                const execution = await resolveTradeExecutionPrice(code, adj, live.prevPrice);
                                const price = execution.price;
                                if (price > 0) {
                                    const deltaShares = (adj.amount * (1 - actualRate)) / price;
                                    item.shares = round6(item.shares + deltaShares);
                                    item.amount = round2(item.shares * live.prevPrice);
                                    adj.status = 'confirmed';
                                    adj.confirmedPrice = price;
                                    adj.orderNav = safeFloat(adj.orderNav, 0) > 0 ? adj.orderNav : price;
                                    adj.confirmedShares = round6(deltaShares);
                                    adj.confirmedDate = todayStr;

                                    // 记录到独立的订单流水表 (tradeOrders)
                                    const confirmedAddOrder = {
                                        code,
                                        name: item.name,
                                        group: item.group,
                                        type: 'add',
                                        date: todayStr,
                                        orderDate: adj.orderDate || '',
                                        effectiveDate: adj.effectiveDate || adj.orderDate || '',
                                        targetDate: adj.targetDate || '',
                                        confirmedDate: todayStr,
                                        orderNav: adj.orderNav || price,
                                        confirmedPrice: price,
                                        confirmedShares: adj.confirmedShares,
                                        amount: adj.amount,
                                        feeRate: adj.feeRate || 0,
                                        price: price,
                                        fee: round2(adj.amount * (adj.feeRate || 0) / 100),
                                        status: 'confirmed'
                                    };
                                    await persistTradeOrder(adj, confirmedAddOrder);

                                    // 收集确认信息，不立即弹 toast
                                    confirmedTransactions.add.push({ code, shares: adj.confirmedShares, price });
                                    dataChanged = true;
                                }
                            } else if (adj.type === 'remove') {
                                const execution = await resolveTradeExecutionPrice(code, adj, live.prevPrice);
                                const price = execution.price;
                                if (price > 0) {
                                    item.shares = round6(item.shares - adj.shares);
                                    if (item.shares < 0) item.shares = 0;
                                    item.amount = round2(item.shares * live.prevPrice);
                                    // 赎回手续费：按卖出金额扣减，计入累计收益（成本）
                                    const fee = round2(adj.shares * price * ((adj.feeRate || 0) / 100));
                                    if (fee > 0) {
                                        item.holdProfit = round2((item.holdProfit || 0) - fee);
                                    }
                                    adj.status = 'confirmed';
                                    adj.confirmedPrice = price;
                                    adj.orderNav = safeFloat(adj.orderNav, 0) > 0 ? adj.orderNav : price;
                                    adj.confirmedShares = adj.shares;
                                    adj.confirmedDate = todayStr;

                                    // 记录到独立的订单流水表 (tradeOrders)
                                    const confirmedRemoveOrder = {
                                        code,
                                        name: item.name,
                                        group: item.group,
                                        type: 'remove',
                                        date: todayStr,
                                        orderDate: adj.orderDate || '',
                                        effectiveDate: adj.effectiveDate || adj.orderDate || '',
                                        targetDate: adj.targetDate || '',
                                        confirmedDate: todayStr,
                                        orderNav: adj.orderNav || price,
                                        confirmedPrice: price,
                                        confirmedShares: adj.shares,
                                        shares: adj.shares,
                                        amount: round2(adj.shares * price),
                                        feeRate: adj.feeRate || 0,
                                        price: price,
                                        fee: fee,
                                        status: 'confirmed',
                                        isClear: adj.isClear || false,
                                        remark: adj.isClear ? '清仓赎回' : '减仓已确认'
                                    };
                                    await persistTradeOrder(adj, confirmedRemoveOrder);

                                    // 收集确认信息，不立即弹 toast
                                    confirmedTransactions.remove.push({ code, shares: adj.shares, price, fee });
                                    dataChanged = true;
                                }
                            } else if (isDividendType(adj.type)) {
                                // 现金分红确认：
                                // autoDetected 分红由结算层（累计净值差）统一处理，确认时一律跳过手动计入，
                                // 避免结算层与确认层双重计算。
                                // 只有用户手动创建的分红（autoDetected 不为 true）才需要在此计入 holdProfit。
                                if (!adj.autoDetected) {
                                    item.holdProfit = round2((item.holdProfit || 0) + adj.dividendAmount);
                                }
                                adj.status = 'confirmed';
                                adj.confirmedDate = todayStr;
                                debugDividendTrace(code, 'pending-adjustment-confirm-dividend', {
                                    autoDetected: adj.autoDetected === true,
                                    dividendDate: adj.dividendDate || '',
                                    targetDate: adj.targetDate || '',
                                    perShare: Number(adj.perShare) || 0,
                                    dividendAmount: Number(adj.dividendAmount) || 0,
                                    confirmedDate: adj.confirmedDate
                                });
                                // 收集确认信息，不立即弹 toast
                                confirmedTransactions.dividend.push({ code, amount: adj.dividendAmount, date: adj.targetDate });
                                
                                // 记录分红订单到账目表
                                const confirmedDividendOrder = {
                                    code,
                                    name: item.name,
                                    group: item.group,
                                    type: 'dividend',
                                    date: todayStr,
                                    orderDate: adj.orderDate || '',
                                    targetDate: adj.targetDate || '',
                                    confirmedDate: todayStr,
                                    amount: adj.dividendAmount,
                                    feeRate: adj.feeRate || 0,
                                    fee: adj.fee || 0,
                                    dividendAmount: adj.dividendAmount,
                                    dividendDate: adj.dividendDate || '',
                                    perShare: adj.perShare || 0,
                                    dividendNavPrice: adj.dividendNavPrice || live.prevPrice,
                                    shares: 0,
                                    price: live.prevPrice,
                                    remark: adj.autoDetected ? '自动检测分红' : '手动记录分红',
                                    status: 'confirmed'
                                };
                                await persistTradeOrder(adj, confirmedDividendOrder);
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
                                const confirmedDividendReinvestOrder = {
                                    code,
                                    name: item.name,
                                    group: item.group,
                                    type: 'dividend_reinvest',
                                    date: todayStr,
                                    orderDate: adj.orderDate || '',
                                    targetDate: adj.targetDate || '',
                                    confirmedDate: todayStr,
                                    amount: adj.dividendAmount,
                                    feeRate: adj.feeRate || 0,
                                    fee: adj.fee || 0,
                                    shares: deltaShares,
                                    price: reinvestPrice,
                                    dividendAmount: adj.dividendAmount,
                                    dividendDate: adj.dividendDate || '',
                                    dividendNavPrice: adj.dividendNavPrice || reinvestPrice,
                                    confirmedShares: deltaShares,
                                    confirmedPrice: reinvestPrice,
                                    remark: adj.autoDetected ? '自动检测分红转红利再投' : '手动分红转红利再投',
                                    status: 'confirmed'
                                };
                                await persistTradeOrder(adj, confirmedDividendReinvestOrder);
                                dataChanged = true;
                            }
                        }
                    }
                }

                if (pendingAdjustments.some(adj => adj.status === 'confirmed')) {
                    pendingAdjustments = getPendingAdjustments(item, code);
                }
                // --- B. 原有份额修正逻辑 ---
                if (!item.shares && item.amount > 0) {
                    const derivedShares = deriveFundShares(item, live.prevPrice, live.price);
                    if (derivedShares > 0) {
                        item.shares = derivedShares;
                        dataChanged = true;
                    }
                }
                const addedDateChanged = syncAddedDateByPosition(item, todayStr);
                if (addedDateChanged) {
                    dataChanged = true;
                }
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
                const displayYesterdayProfit = getDisplayedYesterdayProfitFromHistory(
                    { ...item, code },
                    live,
                    nextDailyProfitHistory,
                    dominantMarketPrevPriceDate
                );
                const displayYesterdayRate = calculateDisplayedYesterdayRate({
                    shares: item.shares || 0,
                    prevTradingDayPrice: live.prevTradingDayPrice || 0,
                    yesterdayProfit: displayYesterdayProfit,
                    prevPrice: live.prevPrice || 0,
                    acNetValue: live.acNetValue,
                    prevAcNetValue: live.prevAcNetValue
                });
                const hasPendingDividendForDisplay = pendingAdjustments.some(adj => {
                    if (!isDividendType(adj.type) || adj.status !== 'pending') return false;
                    return isDividendWithinDisplayedSettlementWindow(
                        adj.dividendDate,
                        live.prevTradingDayDate || '',
                        live.prevPriceDate || ''
                    );
                });
                const hasPendingBuy = pendingAdjustments.some(adj => adj.type === 'add' && adj.status === 'pending');
                const hasPendingSell = pendingAdjustments.some(adj => adj.type === 'remove' && adj.status === 'pending');
                debugDividendTrace(code, 'render-yesterday-metrics', {
                    prevPriceDate: live.prevPriceDate || '',
                    prevTradingDayDate: live.prevTradingDayDate || '',
                    prevTradingDayPrice: live.prevTradingDayPrice || 0,
                    prevPrice: live.prevPrice || 0,
                    rawYesterdayProfit: round2(item.yesterdayProfit || 0),
                    displayYesterdayProfit,
                    displayYesterdayRate,
                    pendingDividendAmount,
                    pendingCount: pendingAdjustments.length,
                    hasPendingDividendForDisplay
                });

                results.push({
                    code,
                    name: live.name,
                    amount: displayAmount,
                    yesterdayProfit: displayYesterdayProfit,
                    yesterdayRate: displayYesterdayRate,
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
                    pendingDividendAmount,  // 用于调试和显示
                    hasPendingDividendForDisplay,
                    hasPendingBuy,
                    hasPendingSell
                });
            }
        }
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
        if (dailyProfitHistoryChanged && dataToPersist.dailyProfitHistory) {
            const latestStored = await storageHelper.getAll(['dailyProfitHistory']);
            if (!areDailyProfitHistoriesEqual(latestStored.dailyProfitHistory, normalizedDailyProfitHistory)) {
                delete dataToPersist.dailyProfitHistory;
            }
        }
        if (Object.keys(dataToPersist).length > 0) {
            await storageHelper.setAll(dataToPersist);
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
        // 启动后台历史数据同步与补全（延后执行，避免与主行情请求竞争）
        setTimeout(() => checkAndFillHistoryGaps(funds), 2000);
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


// ==================== 修改：渲染表格 ====================
function renderTable() {
    let displayData = allFundsData.filter(item => groupFilterController.matches(item));
    displayData.sort((a, b) => {
        // 置顶基金优先排在最前面
        const aPinned = pinnedFunds.has(a.code) ? 1 : 0;
        const bPinned = pinnedFunds.has(b.code) ? 1 : 0;
        if (aPinned !== bPinned) return bPinned - aPinned;
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
        // 置顶行加特殊 class 用于样式高亮
        if (pinnedFunds.has(item.code)) {
            tr.classList.add('pinned-row');
        }
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
        const hasPendingDividend = item.hasPendingDividendForDisplay === true;
        if (hasPendingDividend) {
            const dividendBadge = document.createElement('span');
            dividendBadge.className = 'dividend-badge';
            dividendBadge.textContent = '分红';
            dividendBadge.title = '该基金有待确认的分红，数据可能不准确';
            tdName.appendChild(dividendBadge);
        }
        if (item.hasPendingBuy) {
            const buyBadge = document.createElement('span');
            buyBadge.className = 'buy-badge';
            buyBadge.textContent = '加仓中';
            buyBadge.title = '该基金有待确认的加仓交易';
            tdName.appendChild(buyBadge);
        }
        if (item.hasPendingSell) {
            const sellBadge = document.createElement('span');
            sellBadge.className = 'sell-badge';
            sellBadge.textContent = '减仓中';
            sellBadge.title = '该基金有待确认的减仓交易';
            tdName.appendChild(sellBadge);
        }
        const groupSpan = document.createElement('span');
        groupSpan.className = 'group-tag';
        groupSpan.dataset.code = item.code;
        groupSpan.textContent = item.group;
        // 图钉按钮
        const pinBtn = document.createElement('span');
        pinBtn.className = `pin-btn${pinnedFunds.has(item.code) ? ' is-pinned' : ''}`;
        pinBtn.title = pinnedFunds.has(item.code) ? '取消置顶' : '置顶';
        pinBtn.textContent = '📌';
        pinBtn.dataset.code = item.code;
        pinBtn.onclick = (e) => {
            e.stopPropagation();
            togglePinFund(item.code);
        };
        tdName.appendChild(nameSpan);
        tdName.appendChild(groupSpan);
        tdName.appendChild(pinBtn);
        tdName.dataset.col = 'name';
        setColumnVisibilityClass(tdName, 'name');
        tr.appendChild(tdName);
        // -- 持仓金额 (全屏和小屏都显示) --
        const tdAmount = document.createElement('td');
        tdAmount.dataset.col = 'amount';
        setColumnVisibilityClass(tdAmount, 'amount');
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
        prevNavLine.style.cssText = 'display:flex; align-items:baseline; justify-content:center; gap:4px;';
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
            const prevDayRate = typeof item.yesterdayRate === 'number'
                ? item.yesterdayRate
                : (item.prevPrice - item.prevTradingDayPrice) / item.prevTradingDayPrice * 100;
            const prevRateSpan = document.createElement('span');
            prevRateSpan.style.cssText = `font-size:10px; font-weight:bold; color:${prevDayRate >= 0 ? '#f5222d' : '#389e0d'};`;
            prevRateSpan.textContent = formatProfit(prevDayRate, '%');
            prevNavLine.appendChild(prevRateSpan);
        }
        tdNav.appendChild(prevNavLine);
        const liveNavLine = document.createElement('div');
        liveNavLine.style.cssText = 'display:flex; align-items:baseline; justify-content:center; gap:4px; margin-top:2px; flex-wrap:wrap;';
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
        tdToday.textContent = todayProfitText;
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
    // 总累计收益：小窗口保持紧凑显示，全屏展示含浮动的补充信息
    const sumTotalProfit = sumHoldProfit + sumTodayProfit;
    const isFullscreenMode = document.body.classList.contains('is-fullscreen');
    if (isFullscreenMode) {
        const totalProfitMain = document.createElement('span');
        totalProfitMain.textContent = formatProfit(sumHoldProfit);
        const totalProfitExtra = document.createElement('span');
        totalProfitExtra.style.fontSize = '10px';
        totalProfitExtra.style.opacity = '0.7';
        totalProfitExtra.style.marginLeft = '4px';
        totalProfitExtra.textContent = `(含浮动 ${formatProfit(sumTotalProfit)})`;
        elements.totalTotalProfit.replaceChildren(totalProfitMain, totalProfitExtra);
        elements.totalTotalProfit.className = sumTotalProfit >= 0 ? 'up' : 'down';
    } else {
        elements.totalTotalProfit.textContent = formatProfit(sumHoldProfit);
        elements.totalTotalProfit.className = sumHoldProfit >= 0 ? 'up' : 'down';
    }
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
        const { myFunds } = await storageHelper.getAll(['myFunds']);
        const funds = myFunds || {};
        if (funds[code]) {
            if (funds[code][field] === val) return;
            funds[code][field] = val;
            const localItem = allFundsData.find(f => f.code === code);
            if (localItem) localItem[field] = val;
            await storageHelper.setAll({ myFunds: funds });
            showToast('✅ 基金备注信息已保存', 'success', CONFIG.TOAST_SHORT);
            renderTable();
        }
    }, CONFIG.DEBOUNCE_DELAY);

    elements.tableBody.querySelectorAll('.editable-cell[data-field]').forEach(cell => {
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
            // 点击操作按钮/齿轮/group-tag/del-btn/pin-btn 时不触发
            if (e.target.closest('.settings-icon, .group-tag, .del-btn, .pin-btn, button')) return;

            const code = tr.dataset.code;
            if (code) {
                openFundDetail(code);
            }
        });

        tr.addEventListener('click', (e) => {
            // 点击操作按钮/齿轮/group-tag/del-btn/pin-btn 时不触发选择
            if (e.target.closest('.settings-icon, .group-tag, .del-btn, .pin-btn, button')) return;

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
    syncAddedDateByPosition(fund, getToday(), { preserveExistingAddedDate: false });
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
    const { myFunds } = await storageHelper.getAll(['myFunds']);
    const funds = myFunds || {};
    for (const code of codeList) {
        delete funds[code];
        await HistoryDB.deleteOrdersByCode(code).catch(() => {});
        await HistoryDB.deleteStateRecordsByCode(code).catch(() => {});
    }
    clearSelection();
    removeFundsFromHistory(codeList);
    await storageHelper.setAll({ myFunds: funds });
}

async function removeFund(code) {
    const ok = await showConfirm(`确定删除 ${code}？`, '删除确认', true);
    if (!ok) return;
    await deleteFunds([code]);
    loadData();
}
