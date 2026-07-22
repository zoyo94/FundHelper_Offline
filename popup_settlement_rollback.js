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
    if (currentShares > 0) return roundShares(currentShares);
    if (!(item.amount > 0)) return 0;

    const baseNav = item.savedPrevPrice || primaryPrice || fallbackPrice || 0;
    return baseNav > 0 ? roundShares(item.amount / baseNav) : 0;
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

function mergeDailyProfitHistories(base, incoming) {
    const merged = normalizeDailyProfitHistory(base);
    const next = normalizeDailyProfitHistory(incoming);
    for (const [date, entry] of Object.entries(next)) {
        const existing = merged[date] || { byCode: {}, dividendsByCode: {} };
        const byCode = { ...(existing.byCode || {}), ...(entry.byCode || {}) };
        const dividendsByCode = { ...(existing.dividendsByCode || {}), ...(entry.dividendsByCode || {}) };
        let totalProfit = 0;
        for (const value of Object.values(byCode)) {
            totalProfit = round2(totalProfit + (Number(value) || 0));
        }
        let totalDividend = 0;
        for (const value of Object.values(dividendsByCode)) {
            totalDividend = round2(totalDividend + (Number(value) || 0));
        }
        merged[date] = { totalProfit, byCode, dividendsByCode, totalDividend };
    }
    return normalizeDailyProfitHistory(merged);
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
        item.savedPrevDate === livePrevPriceDate
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

    // 按每个基金自己的 prevPriceDate 分组，避免净值日期滞后的基金（QDII/封闭期）被丢弃
    const updatesByDate = new Map();
    for (const priceUpdate of priceUpdates) {
        const { code, prevPriceDate } = priceUpdate;
        if (!code || !prevPriceDate) continue;
        if (!updatesByDate.has(prevPriceDate)) {
            updatesByDate.set(prevPriceDate, []);
        }
        updatesByDate.get(prevPriceDate).push(priceUpdate);
    }

    if (updatesByDate.size === 0) {
        return { history: nextHistory, changed: false };
    }

    let anyChanged = false;

    for (const [settlementDate, updates] of updatesByDate) {
        const existingEntry = nextHistory[settlementDate] || { byCode: {}, dividendsByCode: {} };
        const byCode = { ...existingEntry.byCode };
        const dividendsByCode = { ...(existingEntry.dividendsByCode || {}) };

        for (const priceUpdate of updates) {
            const { code } = priceUpdate;
            const item = funds[code];
            if (!item) continue;

            // shares=0 的已清仓基金：仍需存档客观行情（供历史回溯用），但不写入收益日历
            const hasShares = item.shares > 0;

            // 同步存档昨日的客观行情到行情表 (fundHistory)，无论是否有持仓都存，保持净值库完整
            HistoryDB.put({
                code: code,
                name: item.name,
                date: settlementDate,
                price: priceUpdate.price,
                acPrice: priceUpdate.acNetValue || null,
                rate: priceUpdate.rate
            }).catch(() => {});

            if (!hasShares) continue; // 无持仓，跳过收益计算和 byCode 写入

            const profit = calculateRecordedYesterdayProfitValue(item, priceUpdate, settlementDate);
            byCode[code] = profit;

            // --- 核心优化：将每日基础状态数据存入专属的 fundDailyState 快照表 ---
            HistoryDB.putDailyState({
                code: code,
                date: settlementDate,
                shares: item.shares || 0,
                amount: item.amount || 0,
                dayProfit: profit,
                totalProfit: round2((item.holdProfit || 0) + profit),
                holdDays: item.holdDaysBase || 0,
                name: item.name,
                group: item.group
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
        if (!areDailyProfitEntriesEqual(nextHistory[settlementDate], nextEntry)) {
            nextHistory[settlementDate] = nextEntry;
            anyChanged = true;
        }
    }

    return {
        history: normalizeDailyProfitHistory(nextHistory),
        changed: anyChanged
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

    return roundShares(Math.max(0, shares));
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
            nextOrder.confirmedShares = roundShares((safeFloat(order.amount, 0) * (1 - feeRate)) / orderNav);
        } else if ((displayType === 'remove' || displayType === 'clear') && safeFloat(order.shares, 0) > 0) {
            nextOrder.amount = round2(safeFloat(order.shares, 0) * orderNav);
            nextOrder.confirmedShares = roundShares(safeFloat(order.confirmedShares, 0) > 0 ? safeFloat(order.confirmedShares, 0) : safeFloat(order.shares, 0));
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
                    const sh = roundShares(safeFloat(order.confirmedShares || order.shares, 0));
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
                shares: roundShares(shares),
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
        let summaryTotalPrefix = '';
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

            summaryLabel = formatProfitCalendarMonth(profitCalendarViewMonth);
            summaryTotalPrefix = '本月合计';
            summaryDays = monthDates.length > 0 ? `本月 ${monthDates.length} 个交易日` : '暂无记录';
            summaryTotal = round2(monthDates.reduce((sum, d) => sum + (filteredHistory[d]?.totalProfit || 0), 0));
            summaryHasData = monthDates.length > 0;
            selectedKey = profitCalendarSelectedDate;
            selectedEntry = profitCalendarSelectedDate
                ? (filteredHistory[profitCalendarSelectedDate] || selectedEntry)
                : selectedEntry;
            selectedHeaderLabel = profitCalendarSelectedDate
                ? formatProfitCalendarDate(profitCalendarSelectedDate)
                : `${formatProfitCalendarMonth(profitCalendarViewMonth)} 暂无记录`;
            detailCountLabel = '选中日合计';
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
            summaryLabel = formatProfitCalendarYear(profitCalendarViewYear);
            summaryTotalPrefix = '本年合计';
            summaryDays = yearTotal && yearTotal.days > 0 ? `本年 ${yearMonths.length} 个月 · ${yearTotal.days} 个交易日` : '暂无记录';
            summaryTotal = round2(yearTotal?.totalProfit || 0);
            summaryHasData = !!yearTotal && yearTotal.days > 0;
            selectedKey = profitCalendarSelectedMonth;
            selectedEntry = profitCalendarSelectedMonth
                ? (monthlyTotals[profitCalendarSelectedMonth] || selectedEntry)
                : selectedEntry;
            selectedHeaderLabel = profitCalendarSelectedMonth
                ? `${formatProfitCalendarMonth(profitCalendarSelectedMonth)} · ${selectedEntry.days || 0} 个交易日`
                : `${formatProfitCalendarYear(profitCalendarViewYear)} 暂无记录`;
            detailCountLabel = '选中月合计';
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
            summaryLabel = '全部年份';
            summaryTotalPrefix = '历史合计';
            summaryDays = totalDays > 0 ? `历史 ${allYears.length} 年 · ${totalDays} 个交易日` : '暂无记录';
            summaryTotal = round2(allTotal);
            summaryHasData = totalDays > 0;
            selectedKey = profitCalendarSelectedYear;
            selectedEntry = profitCalendarSelectedYear
                ? (yearlyTotals[profitCalendarSelectedYear] || selectedEntry)
                : selectedEntry;
            selectedHeaderLabel = profitCalendarSelectedYear
                ? `${formatProfitCalendarYear(profitCalendarSelectedYear)} · ${selectedEntry.days || 0} 个交易日`
                : '暂无记录';
            detailCountLabel = '选中年合计';
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
                    <div class="profit-calendar-month-summary-total ${summaryTotalClass}">
                        <span class="profit-calendar-month-summary-total-prefix">${summaryTotalPrefix}</span>
                        <span>${summaryTotalText}</span>
                    </div>
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

