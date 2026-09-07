const PERFORMANCE_CACHE_MAX_CODES = 6;
// 历史净值缓存（可跨详情会话复用）：{ code: { period: { startStr, endStr, fundData } } }
const _netValueCache = {};
// 历史走势当前会话状态：{ code: { period, fundData, latestNav, requestId } }
const _performanceState = {};
// 我的收益当前会话状态：{ code: { period, fundHistory, comparisonData } }
const _myReturnState = {};

const PERFORMANCE_PERIOD_ORDER = ['1M', '3M', '6M', '1Y', '3Y', 'LY'];
const PERFORMANCE_PERIODS = {
    '1M': { label: '近1月', months: 1 },
    '3M': { label: '近3月', months: 3 },
    '6M': { label: '近6月', months: 6 },
    '1Y': { label: '近1年', months: 12 },
    '3Y': { label: '近3年', months: 36 },
    'LY': { label: '成立来' }
};

const MY_RETURN_PERIOD_ORDER = ['1M', '3M', '6M', '1Y', 'ALL'];
const MY_RETURN_PERIODS = {
    '1M': { label: '近1月', months: 1 },
    '3M': { label: '近3月', months: 3 },
    '6M': { label: '近6月', months: 6 },
    '1Y': { label: '近1年', months: 12 },
    'ALL': { label: '全部' }
};

function getMyReturnPeriodLabel(period) {
    return MY_RETURN_PERIODS[period]?.label || period;
}

function getPerformancePeriodLabel(period) {
    return PERFORMANCE_PERIODS[period]?.label || period;
}

function getPerformancePeriodRank(period) {
    const index = PERFORMANCE_PERIOD_ORDER.indexOf(period);
    return index >= 0 ? index : PERFORMANCE_PERIOD_ORDER.length;
}

function getEffectivePerformanceStartDate(fundData, startStr) {
    if (!Array.isArray(fundData) || fundData.length === 0 || !startStr) return startStr;
    const normalized = fundData
        .filter(d => d?.date)
        .sort((a, b) => a.date.localeCompare(b.date));
    const startIndex = normalized.findIndex(d => d.date >= startStr);
    if (startIndex < 0) return startStr;
    return normalized[startIndex].date === startStr
        ? normalized[startIndex].date
        : normalized[Math.max(0, startIndex - 1)].date;
}

function filterPerformanceDataByDate(fundData, startStr, endStr) {
    if (!Array.isArray(fundData) || fundData.length === 0) {
        return [];
    }
    const effectiveStartStr = getEffectivePerformanceStartDate(fundData, startStr);
    return fundData.filter(item => item?.date >= effectiveStartStr && item?.date <= endStr);
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
    const startStr = '';
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
