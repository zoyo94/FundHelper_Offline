function nextTradingDay(date) {
    const d = new Date(date);
    do {
        d.setDate(d.getDate() + 1);
    } while (d.getDay() === 0 || d.getDay() === 6);
    return d;
}

function isWeekendDate(date = new Date()) {
    const day = date.getDay();
    return day === 0 || day === 6;
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

function getOrderTimingHint({ isWeekend, isAfterCutoff }) {
    const cutoffText = `${String(CONFIG.TRADING_CUTOFF_HOUR).padStart(2, '0')}:${String(CONFIG.TRADING_CUTOFF_MINUTE || 0).padStart(2, '0')}`;
    if (isWeekend) return `📅 周末下单，按下一交易日建仓，T+1确认，可撤销至生效日 ${cutoffText}`;
    if (isAfterCutoff) return `⏰ ${cutoffText}后下单，按下一交易日建仓，T+2确认，可撤销至次日 ${cutoffText}`;
    return `✅ ${cutoffText}前下单，按今日建仓，T+1确认，可撤销至今日 ${cutoffText}`;
}

function buildTradeTimingSummary({ name, code, isWeekend, isAfterCutoff, effectiveDate, cancelableUntilLabel }) {
    const cutoffText = `${String(CONFIG.TRADING_CUTOFF_HOUR).padStart(2, '0')}:${String(CONFIG.TRADING_CUTOFF_MINUTE || 0).padStart(2, '0')}`;
    const timingLabel = isWeekend
        ? '周末下单'
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
        while (base.getDay() === 0 || base.getDay() === 6) {
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
