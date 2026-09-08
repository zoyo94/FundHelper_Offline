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
    return Math.max(0, Math.floor((todayDate.getTime() - added.getTime()) / CONSTANTS.DAY_MS));
}

function calcAccumulatedHoldDays(item, today = getToday()) {
    if (!item || typeof item !== 'object') return null;

    const baseDays = Math.max(0, Math.floor(Number(item.holdDaysBase) || 0));
    const cycleDays = calcHoldDays(item.addedDate || '', today);

    if (cycleDays === null) {
        return baseDays > 0 ? baseDays : null;
    }

    return baseDays + cycleDays;
}

// 从交易流水重算累计持有天数：累加每一轮 (建仓日→清仓日) + 当前在持轮 (建仓日→今天)
// 与 calculatePositionSnapshotFromTradeOrders 保持完全一致的份额/日期口径，确保自洽可重算
function calculateHoldDaysFromOrders(orders = [], today = getToday()) {
    if (typeof normalizeTradeRecordList !== 'function') return null;

    const confirmedOrders = normalizeTradeRecordList(orders, { source: 'order' })
        .filter(order => order.status === 'confirmed')
        .sort(compareTradeExecutionOrder);

    if (!confirmedOrders.length) return null;

    let shares = 0;
    let openDate = '';      // 本轮建仓日期
    let totalDays = 0;
    let everOpened = false;  // 流水中是否出现过有效建仓（否则数据不足，回退 holdDaysBase）

    const addCycle = (startStr, endStr) => {
        const start = parseYmdDate(startStr);
        const end = parseYmdDate(endStr);
        if (!start || !end) return;
        totalDays += Math.max(0, Math.floor((end.getTime() - start.getTime()) / CONSTANTS.DAY_MS));
    };

    confirmedOrders.forEach(order => {
        const displayType = getTradeDisplayType(order);
        const tradeDate = getTradeMarkerDate(order) || getTradeRecordDate(order) || '';
        const shareEffect = getTradeShareEffect(order);

        if (displayType === 'initial') {
            shares = Math.max(0, roundShares(Math.abs(shareEffect)));
            openDate = shares > 0 ? tradeDate : '';
            if (openDate) everOpened = true;
            return;
        }

        if (displayType === 'add' || displayType === 'dividend_reinvest') {
            if (shares <= 0 && shareEffect > 0) {
                openDate = tradeDate || openDate;
            }
            shares = Math.max(0, roundShares(shares + shareEffect));
            if (shares > 0 && !openDate) {
                openDate = tradeDate || '';
            }
            if (shares > 0 && openDate) everOpened = true;
            return;
        }

        if (displayType === 'remove' || displayType === 'clear') {
            shares = Math.max(0, roundShares(shares + shareEffect));
            if (displayType === 'clear' || shares <= 0.001) {
                if (openDate) addCycle(openDate, tradeDate);   // 用真实清仓日，而非今天
                shares = 0;
                openDate = '';
            }
        }
    });

    // 流水里从未出现过建仓（如「清仓」按钮删光历史后只剩一条 remove）→ 数据不足，回退 holdDaysBase
    if (!everOpened) return null;

    // 当前仍在持仓：累加 建仓日 → 今天
    if (shares > 0 && openDate) {
        addCycle(openDate, today);
    }

    return totalDays;
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
            source: entry.source === 'official' ? 'official' : 'history',
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
        const stored = await storageHelper.getAll([CONFIG.PERF_DAILY_CACHE_STORAGE_KEY]);
        fundPerfDailyCacheByCode = normalizeFundPerfDailyCache(stored[CONFIG.PERF_DAILY_CACHE_STORAGE_KEY] || {});
    } catch (err) {
        console.warn('[fundPerf] 读取日级缓存失败:', err);
        fundPerfDailyCacheByCode = {};
    }

    fundPerfDailyCacheLoaded = true;
}

async function persistFundPerfDailyCache() {
    try {
        await storageHelper.setAll({
            [CONFIG.PERF_DAILY_CACHE_STORAGE_KEY]: fundPerfDailyCacheByCode
        });
    } catch (err) {
        console.warn('[fundPerf] 保存日级缓存失败:', err);
    }
}

function createEmptyFundPerfDailyEntry(asOfDate) {
    return {
        asOfDate,
        source: 'history',
        w1: null,
        m1: null,
        m3: null,
        m6: null,
        y1: null,
        ly: null
    };
}

function buildFundPerfDisplayData(code, fundItem, orders = null) {
    // 优先从交易流水重算（自洽、可修正历史脏数据）；无流水时回退到 holdDaysBase + addedDate
    let holdDays = Array.isArray(orders) && orders.length
        ? calculateHoldDaysFromOrders(orders)
        : null;
    if (holdDays === null) {
        holdDays = calcAccumulatedHoldDays(fundItem);
    }
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

async function hydrateFundPerfCache(funds, codes, tradeOrdersMap = null) {
    await ensureFundPerfDailyCacheLoaded();
    const codeSet = new Set(codes);
    const nextDisplayCache = {};

    codes.forEach(code => {
        const orders = tradeOrdersMap && typeof tradeOrdersMap.get === 'function'
            ? tradeOrdersMap.get(code)
            : null;
        nextDisplayCache[code] = buildFundPerfDisplayData(code, funds[code] || null, orders);
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

function calcRateFromNavData(navData, startDate) {
    if (!Array.isArray(navData) || navData.length < 2) return null;
    const normalized = navData
        .filter(d => d?.date && d.price > 0)
        .sort((a, b) => a.date.localeCompare(b.date));
    if (normalized.length < 2) return null;

    const startIndex = normalized.findIndex(d => d.date >= startDate);
    if (startIndex < 0 && normalized[normalized.length - 1].date < startDate) return null;
    // 平台口径：目标日有净值就用目标日，否则取目标日之前最近一个交易日。
    const baseIndex = startIndex < 0
        ? normalized.length - 1
        : (normalized[startIndex].date === startDate ? startIndex : Math.max(0, startIndex - 1));
    const first = normalized[baseIndex];
    const last = normalized[normalized.length - 1];
    if (!(first.price > 0) || !(last.price > 0)) return null;
    return round2((last.price - first.price) / first.price * 100);
}

function shiftFundPerfDate(date, { days = 0, months = 0, years = 0 } = {}) {
    const shifted = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    if (days) shifted.setDate(shifted.getDate() - days);
    if (months || years) {
        const originalDay = shifted.getDate();
        shifted.setDate(1);
        shifted.setFullYear(shifted.getFullYear() - years);
        shifted.setMonth(shifted.getMonth() - months);
        const lastDay = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 0).getDate();
        shifted.setDate(Math.min(originalDay, lastDay));
    }
    return formatDate(shifted);
}

function buildFundTotalReturnSeries(navData) {
    const sorted = navData
        .filter(item => item?.date && parseFloat(item?.price) > 0)
        .sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length === 0) return [];

    const series = [{ date: sorted[0].date, price: 1 }];
    for (let i = 1; i < sorted.length; i++) {
        const previousPrice = parseFloat(sorted[i - 1].price);
        const currentPrice = parseFloat(sorted[i].price);
        let factor = currentPrice / previousPrice;
        const eventRate = Number.parseFloat(sorted[i].dailyRate ?? sorted[i].rate);

        // 分红、拆分和份额折算日不能直接比较单位净值，改用接口给出的复权日收益。
        if (sorted[i].dividend && Number.isFinite(eventRate)) {
            factor = 1 + eventRate / 100;
        }
        if (!(factor > 0) || !Number.isFinite(factor)) continue;
        series.push({
            date: sorted[i].date,
            price: series[series.length - 1].price * factor
        });
    }
    return series;
}

function calcRateFromFirstNav(navData) {
    if (!Array.isArray(navData) || navData.length < 2) return null;
    const normalized = navData
        .filter(d => d?.date && d.price > 0)
        .sort((a, b) => a.date.localeCompare(b.date));
    if (normalized.length < 2) return null;
    const first = normalized[0];
    const last = normalized[normalized.length - 1];
    if (!(first.price > 0) || !(last.price > 0)) return null;
    return round2((last.price - first.price) / first.price * 100);
}

async function fetchFundPerfData(code) {
    try {
        const officialReturns = typeof fetchFundPeriodReturns === 'function'
            ? await fetchFundPeriodReturns(code)
            : null;
        if (officialReturns) return officialReturns;

        const today = getToday();

        let navData = await HistoryDB.getRange(code, '', today);

        const syncedFlags = await storageHelper.get('fullHistorySyncedFlags', {});
        const needsFullSync = !syncedFlags[code] || !Array.isArray(navData) || navData.length < 2;

        if (needsFullSync) {
            const fullHistoryData = await fetchAndCacheFullPerformanceHistory(code, today);
            if (Array.isArray(fullHistoryData) && fullHistoryData.length > 0) {
                navData = fullHistoryData;
                syncedFlags[code] = true;
                await storageHelper.set('fullHistorySyncedFlags', syncedFlags);
            }
        }

        if (!Array.isArray(navData) || navData.length < 2) {
            return null;
        }

        const normalizedNavData = buildFundTotalReturnSeries(navData);

        if (normalizedNavData.length < 2) {
            return null;
        }

        // 区间终点以最新已确认净值日为准，不以本机今天为准（周末、节假日和 QDII 会滞后）。
        const latestDate = parseYmdDate(normalizedNavData[normalizedNavData.length - 1].date);
        if (!latestDate) return null;

        return {
            source: 'history',
            w1: calcRateFromNavData(normalizedNavData, shiftFundPerfDate(latestDate, { days: 7 })),
            m1: calcRateFromNavData(normalizedNavData, shiftFundPerfDate(latestDate, { months: 1 })),
            m3: calcRateFromNavData(normalizedNavData, shiftFundPerfDate(latestDate, { months: 3 })),
            m6: calcRateFromNavData(normalizedNavData, shiftFundPerfDate(latestDate, { months: 6 })),
            y1: calcRateFromNavData(normalizedNavData, shiftFundPerfDate(latestDate, { years: 1 })),
            ly: calcRateFromFirstNav(normalizedNavData),
        };
    } catch (e) {
        console.warn(`[fetchFundPerfData] ${code} 计算失败:`, e);
        return null;
    }
}

let fundPerfRefreshPromise = null;
let fundPerfRunVersion = 0;

async function fetchAllFundPerfData(fundsOverride = null) {
    if (!document.body.classList.contains('is-fullscreen')) return;
    // 版本号取代纯 promise 去重：每次调用发新版本，在途旧任务在批间检查点
    // 提前终止（不再发后续网络批次、不写缓存），避免快速连续刷新时旧任务
    // 带着过期的 funds 快照跑完全程并与新任务叠加请求。
    const myVersion = ++fundPerfRunVersion;
    const isStale = () => myVersion !== fundPerfRunVersion;

    const myPromise = (async () => {
        await ensureFundPerfDailyCacheLoaded();
        const funds = fundsOverride || (await storageHelper.getAll(['myFunds'])).myFunds || {};
        const codes = allFundsData.map(d => d.code);
        const today = getToday();

        // 持有天数从交易流水重算，与主加载链路保持一致
        const tradeOrdersMap = typeof buildTradeOrdersMap === 'function'
            ? await buildTradeOrdersMap(codes).catch(() => null)
            : null;
        const ordersOf = (code) => (tradeOrdersMap && typeof tradeOrdersMap.get === 'function'
            ? tradeOrdersMap.get(code)
            : null);

        let cacheChanged = false;

        const syncedFlags = await storageHelper.get('fullHistorySyncedFlags', {});
        if (isStale()) return;

        // 第一遍：同步填充缓存命中项并立即渲染，收集需要刷新的 code
        const needFetch = [];
        for (const code of codes) {
            fundPerfCache[code] = buildFundPerfDisplayData(code, funds[code] || null, ordersOf(code));

            const cached = fundPerfDailyCacheByCode[code];
            const cacheIsComplete = cached?.source === 'official'
                || (syncedFlags[code] && PERF_FIELDS.every(field => field === 'holdDays' || cached?.[field] !== null && cached?.[field] !== undefined));
            if (cached?.asOfDate === today && cacheIsComplete) {
                const tr = document.querySelector(`#fundTableBody tr[data-code="${code}"]`);
                if (tr) renderFundPerfCells(tr, code);
            } else {
                needFetch.push(code);
            }
        }

        // 第二遍：分批并发拉取（每批 5 个并发，批间 300ms 限流，避免被接口限流）
        // 原 for...of + sleep(500) 串行：N 个基金 = N×500ms 阻塞；
        // 改分批后：20 个基金 ≈ 4 批 × ~500ms ≈ 2-3s，且批内并发请求。
        const PERF_BATCH_SIZE = 5;
        for (let i = 0; i < needFetch.length; i += PERF_BATCH_SIZE) {
            if (isStale()) return; // 已被新一轮刷新取代：停止发后续网络批次
            const batch = needFetch.slice(i, i + PERF_BATCH_SIZE);
            await Promise.all(batch.map(async (code) => {
                const fetchedPerf = await fetchFundPerfData(code);
                if (isStale()) return; // 等待期间被取代：丢弃结果，不写缓存不刷行
                if (fetchedPerf) {
                    fundPerfDailyCacheByCode[code] = {
                        asOfDate: today,
                        ...fetchedPerf
                    };
                } else {
                    const cached = fundPerfDailyCacheByCode[code];
                    const fallbackEntry = cached
                        ? {
                            asOfDate: today,
                            source: cached.source === 'official' ? 'official' : 'history',
                            w1: normalizePerfRateValue(cached.w1),
                            m1: normalizePerfRateValue(cached.m1),
                            m3: normalizePerfRateValue(cached.m3),
                            m6: normalizePerfRateValue(cached.m6),
                            y1: normalizePerfRateValue(cached.y1),
                            ly: normalizePerfRateValue(cached.ly)
                        }
                        : createEmptyFundPerfDailyEntry(today);
                    fundPerfDailyCacheByCode[code] = fallbackEntry;
                }
                fundPerfCache[code] = buildFundPerfDisplayData(code, funds[code] || null, ordersOf(code));
                cacheChanged = true;
                const tr = document.querySelector(`#fundTableBody tr[data-code="${code}"]`);
                if (tr) renderFundPerfCells(tr, code);
            }));
            if (i + PERF_BATCH_SIZE < needFetch.length) {
                await new Promise(r => setTimeout(r, 300));
            }
        }

        if (cacheChanged && !isStale()) {
            await persistFundPerfDailyCache();
        }
    })();

    fundPerfRefreshPromise = myPromise;
    myPromise.finally(() => {
        // 只有最后一次任务才清槽位：被取代的旧任务不能把新任务的 promise 清掉
        if (fundPerfRefreshPromise === myPromise) fundPerfRefreshPromise = null;
    });
    return myPromise;
}

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
