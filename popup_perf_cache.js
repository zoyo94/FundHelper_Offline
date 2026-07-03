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

