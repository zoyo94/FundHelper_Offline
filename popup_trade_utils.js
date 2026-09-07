// ==================== 交易日历（法定节假日感知）====================
// 数据源：NateScarlet/holiday-cn（国务院年度节假日安排 JSON，jsdelivr CDN 免 key）。
// 接口地址走「数据源管理」的 calendar 分类统一管理（可查看/停用/测试/改地址）；
// 配置缺失（旧数据/未初始化）时回退内置默认地址，用户手动停用日历源则不联网。
// 更新节奏：国务院每年 10-12 月发布下一年安排，该源随之更新；数据公布后即定稿。
// 策略：当年(+次年)数据持久化到 storage，一年最多拉一次；拉取失败/无数据时
// 退化为"仅周末"规则——任何情况下都不会比没有日历时更差。
const TRADING_CALENDAR_STORAGE_KEY = 'tradingCalendarCache';
const TRADING_CALENDAR_DEFAULT_URL = 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json';
let _tradingCalendar = { year: 0, offDays: new Set(), workDays: new Set() };

// 从数据源管理取 calendar 分类第一个启用的配置拼 URL；
// 返回 null 表示存在日历配置但被用户全部停用（尊重停用，不联网）
function getTradingCalendarFetchUrl(year) {
    if (typeof getEnabledApiProfiles === 'function') {
        const enabled = getEnabledApiProfiles('calendar');
        if (enabled.length > 0) {
            return enabled[0].urlTemplate
                .replaceAll('{year}', String(year))
                .replaceAll('{timestamp}', String(Date.now()))
                .replaceAll('{random}', String(Math.random()));
        }
        const hasConfigured = Array.isArray(liveApiProfiles)
            && liveApiProfiles.some(profile => profile?.category === 'calendar');
        if (hasConfigured) return null;
    }
    return TRADING_CALENDAR_DEFAULT_URL
        .replaceAll('{year}', String(year))
        .replaceAll('{timestamp}', String(Date.now()));
}

function _applyTradingCalendarData(year, days, years) {
    const offDays = new Set();
    const workDays = new Set();
    safeArray(days, []).forEach(day => {
        const date = normalizePerfDate(day?.date || '');
        if (!date) return;
        if (day.isOffDay) offDays.add(date);
        else workDays.add(date); // 调休上班的周末，是交易日
    });
    // years：本次实际成功拉取到的年份集合。判重必须按"是否涵盖目标年"而非"最大年份"，
    // 否则当年拉取失败、次年成功时会误以为当年已覆盖（详见 ensureTradingCalendar 注释）。
    _tradingCalendar = {
        year,
        years: Array.isArray(years) && years.length ? years.slice() : [year],
        offDays,
        workDays
    };
}

async function ensureTradingCalendar() {
    const currentYear = new Date().getFullYear();
    // 判重必须看"是否涵盖当年"，不能只看最大年份：
    // 旧逻辑 `year >= currentYear` 在「当年拉取失败、次年成功」时会把 fetchedYear 记成次年，
    // 此后每年都被判定为已缓存，当年法定节假日数据永久缺失（只能退化到周末规则，
    // 国庆/春节前的 T+1/T+2 确认日会算错）。改为按年份集合判断。
    const memoryHasCurrentYear = Array.isArray(_tradingCalendar.years)
        ? _tradingCalendar.years.includes(currentYear)
        : _tradingCalendar.year >= currentYear;
    if (memoryHasCurrentYear) return;
    try {
        const stored = await storageHelper.getAll([TRADING_CALENDAR_STORAGE_KEY]);
        const cached = stored?.[TRADING_CALENDAR_STORAGE_KEY];
        const cachedYears = Array.isArray(cached?.years) ? cached.years : [cached?.year];
        if (cachedYears.includes(currentYear) && Array.isArray(cached.days)) {
            _applyTradingCalendarData(cached.year, cached.days, cached.years);
            return;
        }
    } catch (_) { /* 缓存读取失败则走网络 */ }
    try {
        // 当年 + 次年（10-12 月国务院会发布次年安排；拿不到次年则忽略）
        const allDays = [];
        const fetchedYears = [];
        for (const year of [currentYear, currentYear + 1]) {
            const url = getTradingCalendarFetchUrl(year);
            if (!url) break; // 日历源被用户停用：保持缓存/周末规则
            const res = await fetch(url);
            if (!res.ok) continue;
            const data = await res.json();
            if (Array.isArray(data?.days)) {
                allDays.push(...data.days);
                fetchedYears.push(year);
            }
        }
        if (allDays.length === 0) return;
        const minYear = Math.min(...fetchedYears);
        _applyTradingCalendarData(minYear, allDays, fetchedYears);
        await storageHelper.set(TRADING_CALENDAR_STORAGE_KEY, {
            years: fetchedYears,
            year: minYear,
            fetchedAt: new Date().toISOString(),
            days: allDays
        }).catch(() => {});
    } catch (_) {
        // 离线/网络受限：保持周末规则，不影响核心功能
    }
}

// 判断是否交易日：有覆盖该年份的日历数据时优先用（含法定节假日与调休工作日），
// 否则退化为周末规则
function isTradingDayDate(d) {
    const dateStr = formatDate(d);
    // 必须确认日历数据确实涵盖「该日期所在年份」才能用它判断。
    // 旧逻辑 `year >= d.getFullYear()` 在只有次年数据时会拿次年的 offDays/workDays
    // 去判断当年日期 —— 当年法定假日不在集合里，会被误判为交易日。
    // 未覆盖时退化为周末规则（宁可少认节假日，也不能把假期当交易日）。
    const targetYear = d.getFullYear();
    const covered = Array.isArray(_tradingCalendar.years)
        ? _tradingCalendar.years.includes(targetYear)
        : _tradingCalendar.year >= targetYear;
    if (covered) {
        if (_tradingCalendar.offDays.has(dateStr)) return false;
        if (_tradingCalendar.workDays.has(dateStr)) return true;
    }
    const day = d.getDay();
    return day !== 0 && day !== 6;
}

function nextTradingDay(date) {
    const d = new Date(date);
    do {
        d.setDate(d.getDate() + 1);
    } while (!isTradingDayDate(d));
    return d;
}

function prevTradingDay(date = new Date()) {
    const d = new Date(date);
    do {
        d.setDate(d.getDate() - 1);
    } while (!isTradingDayDate(d));
    return d;
}

function getLatestTradingDay(baseDate = new Date()) {
    return formatDate(prevTradingDay(baseDate));
}

// 语义实为"非交易日"：周末 + 法定节假日（调休工作日返回 false）
function isWeekendDate(date = new Date()) {
    return !isTradingDayDate(date);
}

function isAfterTradingCutoff(date = new Date()) {
    if (isWeekendDate(date)) return false;
    const hour = date.getHours();
    const minute = date.getMinutes();
    if (hour > CONFIG.TRADING_CUTOFF_HOUR) return true;
    if (hour < CONFIG.TRADING_CUTOFF_HOUR) return false;
    return minute >= (CONFIG.TRADING_CUTOFF_MINUTE || 0);
}

function getTradeEffectiveDate(now = new Date(), forceAfterCutoff = null) {
    const weekend = isWeekendDate(now);
    const afterCutoff = typeof forceAfterCutoff === 'boolean' ? forceAfterCutoff : isAfterTradingCutoff(now);

    if (weekend) {
        const next = new Date(now);
        while (isWeekendDate(next)) {
            next.setDate(next.getDate() + 1);
        }
        return formatDate(next);
    }

    if (afterCutoff) {
        return formatDate(nextTradingDay(now));
    }

    return formatDate(now);
}

function getTradeCancelableUntilDate(now = new Date(), forceAfterCutoff = null) {
    const effectiveDate = getTradeEffectiveDate(now, forceAfterCutoff);
    const weekend = isWeekendDate(now);
    const afterCutoff = typeof forceAfterCutoff === 'boolean' ? forceAfterCutoff : isAfterTradingCutoff(now);
    if (weekend || afterCutoff) {
        return effectiveDate;
    }
    return formatDate(now);
}

function getTradeCancelableUntilLabel(now = new Date(), forceAfterCutoff = null) {
    const untilDate = getTradeCancelableUntilDate(now, forceAfterCutoff);
    const weekend = isWeekendDate(now);
    const afterCutoff = typeof forceAfterCutoff === 'boolean' ? forceAfterCutoff : isAfterTradingCutoff(now);
    const cutoffText = `${String(CONFIG.TRADING_CUTOFF_HOUR).padStart(2, '0')}:${String(CONFIG.TRADING_CUTOFF_MINUTE || 0).padStart(2, '0')}`;
    if (weekend || afterCutoff) {
        return `${untilDate} ${cutoffText}`;
    }
    return `今日 ${cutoffText}`;
}

function getTradeCancelableDeadline(order = {}) {
    const cancelableUntilDate = normalizePerfDate(order.cancelableUntilDate || order.effectiveDate || order.orderDate || '');
    if (!cancelableUntilDate) return null;
    const deadline = parseYmdDate(cancelableUntilDate);
    if (!deadline) return null;
    deadline.setHours(CONFIG.TRADING_CUTOFF_HOUR, CONFIG.TRADING_CUTOFF_MINUTE || 0, 0, 0);
    return deadline;
}

function isTradeRevocable(order = {}, now = new Date()) {
    const normalized = normalizeTradeRecord(order, { source: 'order' });
    if (normalized.status === 'confirmed') return false;
    if (getTradeDisplayType(normalized) === 'initial') return false;
    const deadline = getTradeCancelableDeadline(normalized);
    if (!deadline) return true;
    return now.getTime() <= deadline.getTime();
}

function getOrderTimingFlags(date = new Date()) {
    const isWeekend = isWeekendDate(date);
    const isAfterCutoff = isAfterTradingCutoff(date);
    return { isWeekend, isAfterCutoff };
}

function buildTradeTimingSummary({ name, code, isWeekend, isAfterCutoff, effectiveDate, cancelableUntilLabel }) {
    const cutoffText = `${String(CONFIG.TRADING_CUTOFF_HOUR).padStart(2, '0')}:${String(CONFIG.TRADING_CUTOFF_MINUTE || 0).padStart(2, '0')}`;
    const timingLabel = isWeekend
        ? '非交易日下单'
        : (isAfterCutoff ? `${cutoffText}后下单` : `${cutoffText}前下单`);
    const confirmRule = isWeekend || isAfterCutoff ? 'T+2确认' : 'T+1确认';
    return [
        `${name || code} (#${code})`,
        `${timingLabel}，按${effectiveDate}建仓/调仓`,
        `${confirmRule}，可撤销至 ${cancelableUntilLabel}`
    ].join('\n');
}

async function resolveHistoricalNavByDate(code, tradeDate) {
    const normalizedDate = normalizePerfDate(tradeDate || '');
    if (!code || !normalizedDate) {
        return { navPrice: 0, source: '', date: '' };
    }

    const cachedRecord = await HistoryDB.get(code, normalizedDate).catch(() => null);
    const cachedNav = safeFloat(cachedRecord?.price, 0);
    if (cachedNav > 0) {
        return { navPrice: cachedNav, source: 'db', date: normalizedDate };
    }

    const fetchedRecords = await fetchFundNetValues(code, normalizedDate, normalizedDate, 10, { preferFullHistory: false }).catch(() => null);
    const exactRecord = safeArray(fetchedRecords, []).find(item => normalizePerfDate(item?.date || '') === normalizedDate);
    const exactNav = safeFloat(exactRecord?.price, 0);
    if (exactNav > 0) {
        return { navPrice: exactNav, source: 'api', date: normalizedDate };
    }

    return { navPrice: 0, source: '', date: normalizedDate };
}

function calculateNetBuyShares(amount, navPrice, feeRate) {
    const grossAmount = safeFloat(amount, 0);
    const price = safeFloat(navPrice, 0);
    const rate = Math.max(0, safeFloat(feeRate, 0)) / 100;
    if (!(grossAmount > 0) || !(price > 0)) return 0;
    return roundShares((grossAmount * (1 - rate)) / price);
}

function calculateGrossBuyAmountFromShares(shares, navPrice, feeRate) {
    const confirmedShares = safeFloat(shares, 0);
    const price = safeFloat(navPrice, 0);
    const rate = Math.max(0, safeFloat(feeRate, 0)) / 100;
    if (!(confirmedShares > 0) || !(price > 0) || rate >= 1) return 0;
    return round2((confirmedShares * price) / (1 - rate));
}

function calculateNetSellAmountFromShares(shares, navPrice, feeRate) {
    const confirmedShares = safeFloat(shares, 0);
    const price = safeFloat(navPrice, 0);
    const rate = Math.max(0, safeFloat(feeRate, 0)) / 100;
    if (!(confirmedShares > 0) || !(price > 0)) return 0;
    return round2(confirmedShares * price * (1 - rate));
}

function calculateSellSharesFromNetAmount(amount, navPrice, feeRate) {
    const netAmount = safeFloat(amount, 0);
    const price = safeFloat(navPrice, 0);
    const rate = Math.max(0, safeFloat(feeRate, 0)) / 100;
    if (!(netAmount > 0) || !(price > 0) || rate >= 1) return 0;
    return roundShares(netAmount / (price * (1 - rate)));
}

function computeConfirmDateByTiming({ now = new Date(), forceAfterCutoff = null } = {}) {
    const { isWeekend, isAfterCutoff: currentAfterCutoff } = getOrderTimingFlags(now);
    const useAfterCutoff = typeof forceAfterCutoff === 'boolean' ? forceAfterCutoff : currentAfterCutoff;
    let base = new Date(now);

    if (isWeekend) {
        while (!isTradingDayDate(base)) {
            base.setDate(base.getDate() + 1);
        }
        return formatDate(nextTradingDay(base));
    }

    if (useAfterCutoff) {
        const t1 = nextTradingDay(base);
        return formatDate(nextTradingDay(t1));
    }

    return formatDate(nextTradingDay(base));
}

function getConfirmDate(now = new Date(), forceAfterCutoff = null) {
    return computeConfirmDateByTiming({ now, forceAfterCutoff });
}
