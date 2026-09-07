// ==================== 撤销结算功能 ====================
const ROLLBACK_SETTLEMENT_PREFIX = 'ROLLBACK_';
let _lastBackfillCacheKey = ''; // 会话级 backfill 缓存：同日同基金集合跳过重复扫描

// 本刷检测到新分红订单时调用：强制下一次 reconcile 重跑 backfill，
// 否则同日迟到的分红不会被写进收益日历（dividendsByCode），要等次日才显示
function invalidateDailyProfitBackfillCache() {
    _lastBackfillCacheKey = '';
}

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

function hasFreshYesterdayProfit(item, live) {
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
            // 强制以 byCode 之和为准：修复历史上 stale totalProfit 字段与 byCode 不一致的脏数据，
            // 由 normalize 路径自然收敛，杜绝「顶层合计 ≠ 明细之和」。
            totalProfit,
            byCode,
            dividendsByCode,
            totalDividend
        };
    }
    return normalized;
}

function calculateYesterdayProfitValue(item, priceUpdate) {
    const { price, prevPriceDate, prevTradingDayPrice, prevTradingDayDate, acNetValue, prevAcNetValue, dividendPerShare = 0 } = priceUpdate;
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

    // 降级采用单位净值差额计算 + 分红补偿
    return round2(shares * (price - prevTradingDayPrice + (Number(dividendPerShare) || 0)));
}

function computeDisplayedYesterdayProfit(baseProfit, pendingAdjustments, liveData = {}) {
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

function getDisplayedYesterdayProfitFromLive(item, live) {
    if (hasFreshYesterdayProfit(item, live)) {
        return round2(item?.yesterdayProfit || 0);
    }
    const shares = deriveFundShares(item, live?.prevPrice || 0);
    let baseProfit = 0;
    if (shares > 0 && live?.prevPrice > 0 && live?.prevTradingDayPrice > 0) {
        if (typeof live.acNetValue === 'number' && typeof live.prevAcNetValue === 'number' && live.acNetValue > 0 && live.prevAcNetValue > 0) {
            baseProfit = round2(shares * (live.acNetValue - live.prevAcNetValue));
        } else {
            baseProfit = round2(shares * (live.prevPrice - live.prevTradingDayPrice));
        }
    }
    const pendingAdjustments = getPendingAdjustments(item, item?.code);
    return computeDisplayedYesterdayProfit(
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

function getDisplayedYesterdayProfit(item, live, dailyHistory) {
    const prevPriceDate = normalizePerfDate(live?.prevPriceDate || '');
    if (!item || !prevPriceDate) {
        return getDisplayedYesterdayProfitFromLive(item, live);
    }

    const historyProfit = getDailyHistoryProfitForCode(dailyHistory, prevPriceDate, item.code);
    if (historyProfit !== null) {
        return historyProfit;
    }

    return getDisplayedYesterdayProfitFromLive(item, live);
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

function calculateRecordedYesterdayProfitValue(item, priceUpdate) {
    if (!item || !hasFreshYesterdayProfit(item, priceUpdate)) {
        return 0;
    }
    return round2(item.yesterdayProfit || 0);
}

function recordDailyProfitHistory(history, funds, priceUpdates) {
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
function getSharesOnDate(code, date, orders, addedDate = '') {
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
            HistoryDB.getRange(code, '', todayStr)
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
            if (!order) continue;
            const displayType = getTradeDisplayType(order);
            if (!isDividendType(displayType)) continue;
            // 自动检测到的分红事件：无论现金是否已到账（订单 confirmed/pending），只要在交易流水里有这条自动分红单，
            // 就应在收益日历上显式标注「分红」——除息日与每份金额都是已确定的事实，不应因未到账而消失在日历里。
            // 仅「手动录入且仍 pending」的分红单不计入，避免用户尚未确认的数据被误标。
            if (order.status !== 'confirmed' && !order.autoDetected) continue;

            const divDate = getTradeMarkerDate(order) || normalizePerfDate(order.dividendDate || '');
            if (!divDate || !/^\d{4}-\d{2}-\d{2}$/.test(divDate)) continue;

            const fund = funds[code];
            const addedDate = normalizePerfDate(fund?.addedDate || '');
            if (addedDate && divDate < addedDate) continue;

            let amount = safeFloat(order.dividendAmount, 0);
            if (amount <= 0) {
                const perShare = safeFloat(order.perShare, 0);
                if (perShare > 0) {
                    const sharesAtDate = getSharesOnDate(code, divDate, orders, addedDate);
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
            const shares = getSharesOnDate(code, date, orders, addedDate);

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
            let usedAcPrice = false;
            if (shares > 0) {
                if (targetRecord.acPrice !== null && prevRecord && prevRecord.acPrice !== null && targetRecord.acPrice > 0 && prevRecord.acPrice > 0) {
                    // 优先使用累计净值计算（已自动包含分红，无需额外补偿）
                    profit = round2(shares * (targetRecord.acPrice - prevRecord.acPrice));
                    usedAcPrice = true;
                } else if (prevRecord && prevRecord.price > 0) {
                    // 降级使用单位净值计算
                    profit = round2(shares * (targetRecord.price - prevRecord.price));
                } else if (targetRecord.rate !== null) {
                    // 再次降级使用涨跌幅计算
                    const prevPrice = targetRecord.price / (1 + targetRecord.rate / 100);
                    profit = round2(shares * (targetRecord.price - prevPrice));
                }
            }

            // 若使用单位净值降级计算，且该日期有分红，需将分红金额补入单日真实经济收益中（避免除息日净值跳水被记为假亏损）
            const dayDividendAmount = round2(Number(dividendsByDate.get(date)?.[code]) || 0);
            if (!usedAcPrice && dayDividendAmount > 0) {
                profit = round2(profit + dayDividendAmount);
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

async function reconcileDailyProfitHistory(history, funds, fetchedData) {
    const normalizedHistory = normalizeDailyProfitHistory(history);

    const priceUpdates = [];
    for (const { code, live } of fetchedData) {
        if (!live || !live.prevPriceDate || live.prevPrice <= 0) continue;
        if (!funds[code]) continue;
        const entry = buildSettlementEntry(code, live);
        if (entry) priceUpdates.push(entry);
    }

    // 1. 先用传统的今日/昨日最新更新记录今日/昨日收益
    const recordRes = recordDailyProfitHistory(normalizedHistory, funds, priceUpdates);

    // 2. 然后，自动扫描历史库中真实存在的断档交易日，并利用已补全的数据库行情进行历史收益回溯计算
    // 会话级优化：同一天、同基金集合、且 record 未产生新条目时，跳过重复的全量 backfill
    let backfillRes;
    if (recordRes.changed) {
        backfillRes = await backfillMissingDailyProfitHistory(recordRes.history, funds);
        _lastBackfillCacheKey = '';
    } else {
        const todayKey = `${getToday()}|${JSON.stringify(Object.keys(funds).sort())}`;
        if (_lastBackfillCacheKey === todayKey) {
            backfillRes = { history: recordRes.history, changed: false };
        } else {
            backfillRes = await backfillMissingDailyProfitHistory(recordRes.history, funds);
            _lastBackfillCacheKey = todayKey;
        }
    }

    return {
        history: backfillRes.history,
        changed: recordRes.changed || backfillRes.changed
    };
}


