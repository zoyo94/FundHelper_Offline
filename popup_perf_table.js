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
        w1: null,
        m1: null,
        m3: null,
        m6: null,
        y1: null,
        ly: null
    };
}

function buildFundPerfDisplayData(code, fundItem) {
    const holdDays = calcAccumulatedHoldDays(fundItem);
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
        nextDisplayCache[code] = buildFundPerfDisplayData(code, funds[code] || null);
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
    if (startIndex < 0) return null;
    const baseIndex = normalized[startIndex].date === startDate ? startIndex : Math.max(0, startIndex - 1);
    const first = normalized[baseIndex];
    const last = normalized[normalized.length - 1];
    const firstValue = first.acPrice > 0 ? first.acPrice : first.price;
    const lastValue = last.acPrice > 0 ? last.acPrice : last.price;
    if (!(firstValue > 0) || !(lastValue > 0)) return null;
    return round2((lastValue - firstValue) / firstValue * 100);
}

function calcRateFromFirstNav(navData) {
    if (!Array.isArray(navData) || navData.length < 2) return null;
    const normalized = navData
        .filter(d => d?.date && d.price > 0)
        .sort((a, b) => a.date.localeCompare(b.date));
    if (normalized.length < 2) return null;
    const first = normalized[0];
    const last = normalized[normalized.length - 1];
    const firstValue = first.acPrice > 0 ? first.acPrice : first.price;
    const lastValue = last.acPrice > 0 ? last.acPrice : last.price;
    if (!(firstValue > 0) || !(lastValue > 0)) return null;
    return round2((lastValue - firstValue) / firstValue * 100);
}

async function fetchFundPerfData(code) {
    try {
        const today = getToday();
        const todayDate = parseYmdDate(today);
        if (!todayDate) return null;

        const getStart = (days) => formatDate(new Date(todayDate.getTime() - days * CONSTANTS.DAY_MS));
        const lyStart = '2000-01-01';

        let navData = await HistoryDB.getRange(code, lyStart, today);

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

        const normalizedNavData = navData
            .map(item => ({
                date: item?.date,
                price: parseFloat(item?.acPrice || item?.price)
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
        console.warn(`[fetchFundPerfData] ${code} 计算失败:`, e);
        return null;
    }
}

let fundPerfRefreshPromise = null;

async function fetchAllFundPerfData(fundsOverride = null) {
    if (!document.body.classList.contains('is-fullscreen')) return;
    if (fundPerfRefreshPromise) return fundPerfRefreshPromise;

    fundPerfRefreshPromise = (async () => {
        await ensureFundPerfDailyCacheLoaded();
        const funds = fundsOverride || (await storageHelper.getAll(['myFunds'])).myFunds || {};
        const codes = allFundsData.map(d => d.code);
        const today = getToday();

        let cacheChanged = false;

        const syncedFlags = await storageHelper.get('fullHistorySyncedFlags', {});

        for (const code of codes) {
            fundPerfCache[code] = buildFundPerfDisplayData(code, funds[code] || null);

            const cached = fundPerfDailyCacheByCode[code];
            if (cached?.asOfDate === today && syncedFlags[code] && PERF_FIELDS.every(field => field === 'holdDays' || cached[field] !== null && cached[field] !== undefined)) {
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
                fundPerfCache[code] = buildFundPerfDisplayData(code, funds[code] || null);
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
                fundPerfCache[code] = buildFundPerfDisplayData(code, funds[code] || null);
                cacheChanged = true;
            }

            await new Promise(r => setTimeout(r, 500));
        }

        if (cacheChanged) {
            await persistFundPerfDailyCache();
        }
    })().finally(() => {
        fundPerfRefreshPromise = null;
    });

    return fundPerfRefreshPromise;
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
