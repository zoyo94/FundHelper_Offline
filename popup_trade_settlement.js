async function buildTradeOrdersMap(codes = []) {
    const entries = await Promise.all(
        safeArray(codes, []).map(async code => [code, await HistoryDB.getOrders(code).catch(() => [])])
    );
    return new Map(entries);
}

async function persistTradeOrder(adj, order) {
    const normalized = normalizeTradeRecord(order, { source: 'order' });
    let id = adj?.orderId || normalized.id || normalized.orderId || null;

    if (!id) {
        id = await findMatchingTradeOrderId(normalized.code, normalized, 'pending');
    }
    if (!id) {
        id = await findMatchingTradeOrderId(normalized.code, normalized);
    }

    if (id) {
        const result = await HistoryDB.updateOrder(id, { ...normalized, id });
        if (result?.action === 'inserted' && result?.id) {
            id = result.id;
        } else {
            id = result?.id || id;
        }
    } else {
        id = await HistoryDB.addOrder(normalized);
    }
    if (adj && id) adj.orderId = id;

    if (normalized.code && id) {
        await cleanupDuplicateTradeLifecycleOrders(normalized.code, normalized, id);
        if (normalizeTradeAction(normalized.type) === 'initial') {
            await cleanupInitialOrdersForCode(normalized.code, id);
        }
    }

    const code = normalized.code;
    if (code) {
        const current = safeArray(runtimeTradeOrdersMap.get(code), []);
        const nextOrder = { ...normalized, id, orderId: id };
        const next = current.filter(item => {
            const itemId = item.id || item.orderId || null;
            if (id && itemId === id) return false;
            return !isSameTradeLifecycleOrder(item, nextOrder);
        });
        next.push(nextOrder);
        runtimeTradeOrdersMap.set(code, normalizeTradeRecordList(next, { source: 'order' }));
    }
    return id;
}

async function rollbackTodayConfirmedOrdersToPending(todayStr = getToday()) {
    const { orders } = await HistoryDB.getAllExportData();
    if (!Array.isArray(orders) || orders.length === 0) return false;

    let changed = false;
    const nextOrders = orders.map(order => {
        const normalized = normalizeTradeRecord(order, { source: 'order' });
        const type = normalizeTradeAction(normalized.type);
        const shouldRollback = (
            ['add', 'remove', 'dividend', 'dividend_reinvest'].includes(type)
            && normalized.status === 'confirmed'
            && normalized.confirmedDate === todayStr
        );

        if (!shouldRollback) {
            return normalized;
        }

        changed = true;
        return normalizeTradeRecord({
            ...normalized,
            status: 'pending',
            confirmedDate: '',
            confirmedPrice: 0,
            confirmedShares: 0
        }, { source: 'order' });
    });

    if (!changed) return false;
    await HistoryDB.replaceOrders(nextOrders);
    return true;
}

async function detectAutoDividends(funds, fetchedData, todayStr, tradeOrdersMap = new Map()) {
    runtimeTradeOrdersMap = tradeOrdersMap;
    let dataChanged = false;

    for (const { code, live } of fetchedData) {
        if (!live?.dividendList?.length) {
            debugDividendTrace(code, 'detect-auto-dividend-no-list', {
                hasLive: Boolean(live),
                prevPriceDate: live?.prevPriceDate || '',
                listLength: Array.isArray(live?.dividendList) ? live.dividendList.length : 0
            });
            continue;
        }
        const item = funds[code];
        if (!item) {
            debugDividendTrace(code, 'detect-auto-dividend-no-fund-item', {
                prevPriceDate: live.prevPriceDate || '',
                listLength: live.dividendList.length
            });
            continue;
        }

        debugDividendTrace(code, 'detect-auto-dividend-start', {
            prevPriceDate: live.prevPriceDate || '',
            addedDate: item.addedDate || '',
            listLength: live.dividendList.length,
            orderCount: safeArray(tradeOrdersMap.get(code), []).length
        });

        for (const dividend of live.dividendList) {
            if (!dividend || !dividend.date || typeof dividend.perShare !== 'number') {
                console.warn('跳过无效的分红记录:', dividend);
                debugDividendTrace(code, 'detect-auto-dividend-invalid-record', { dividend });
                continue;
            }

            const divDate = dividend.date;
            if (item.addedDate && divDate < item.addedDate) {
                debugDividendTrace(code, 'detect-auto-dividend-skip-before-added-date', {
                    dividendDate: divDate,
                    addedDate: item.addedDate,
                    perShare: dividend.perShare
                });
                continue;
            }

            const created = await ensureAutoDetectedDividendEntry(
                item,
                code,
                dividend,
                todayStr,
                true,
                'api',
                tradeOrdersMap.get(code) || []
            );
            if (created) {
                dataChanged = true;
            }
            debugDividendTrace(code, 'detect-auto-dividend-ensure-result', {
                dividendDate: divDate,
                perShare: dividend.perShare,
                created
            });
        }

        debugDividendTrace(code, 'detect-auto-dividend-done', {
            pendingCount: safeArray(runtimeTradeOrdersMap.get(code), []).filter(o => o.status !== 'confirmed').length
        });
    }

    return dataChanged;
}

function getPendingAdjustments(item, code) {
    if (!item) return [];
    const targetCode = code || item.code;

    if (!targetCode || typeof runtimeTradeOrdersMap === 'undefined') {
        return [];
    }
    return safeArray(runtimeTradeOrdersMap.get(targetCode), []).filter(ord => ord.status !== 'confirmed');
}

function isPendingAdjustmentDue(adj, todayStr = getToday()) {
    const targetDate = normalizePerfDate(adj?.targetDate || adj?.confirmedDate || '');
    if (!targetDate) return false;
    return todayStr >= targetDate;
}

function sumPendingDividendAmount(pendingAdjustments) {
    return round2(
        pendingAdjustments.reduce((total, adj) => {
            if (isDividendType(adj.type) && adj.status === 'pending') {
                return total + (adj.dividendAmount || 0);
            }
            return total;
        }, 0)
    );
}

function isDividendWithinDisplayedSettlementWindow(dividendDate, prevTradingDayDate = '', prevPriceDate = '') {
    if (!dividendDate) return true;
    if (prevTradingDayDate && prevPriceDate) {
        return dividendDate >= prevTradingDayDate && dividendDate <= prevPriceDate;
    }
    if (prevPriceDate) {
        return dividendDate <= prevPriceDate;
    }
    return true;
}

function sumPendingDisplayDividendAmount(pendingAdjustments, prevPriceDate = '', prevTradingDayDate = '') {
    return round2(
        pendingAdjustments.reduce((total, adj) => {
            if (!isDividendType(adj.type) || adj.status !== 'pending') return total;
            if (isDividendWithinDisplayedSettlementWindow(adj.dividendDate, prevTradingDayDate, prevPriceDate)) {
                return total + (adj.dividendAmount || 0);
            }
            return total;
        }, 0)
    );
}

function shouldAutoSettleFund(fund, live, dominantMarketPrevPriceDate = '') {
    if (!fund || !live || live.prevPrice <= 0 || !live.prevPriceDate) {
        return false;
    }
    // 放宽：只要 prevPriceDate 比 savedPrevDate 新就允许结算
    // 不再强制要求匹配 dominantMarketPrevPriceDate，避免 QDII/封闭期等净值日期滞后的基金永远不被结算
    const savedPrevDate = fund.savedPrevDate || '';
    return !savedPrevDate || live.prevPriceDate > savedPrevDate;
}

function buildSettlementEntry(code, live) {
    if (!live || live.prevPrice <= 0) return null;

    let rate = 0;
    if (live.prevTradingDayPrice > 0) {
        rate = round2((live.prevPrice - live.prevTradingDayPrice) / live.prevTradingDayPrice * 100);
    }

    return {
        code,
        price: live.prevPrice,
        prevPriceDate: live.prevPriceDate,
        acNetValue: live.acNetValue,
        rate,
        prevTradingDayPrice: live.prevTradingDayPrice || 0,
        prevTradingDayDate: live.prevTradingDayDate || '',
        dividendList: live.dividendList || []
    };
}

function collectAutoSettlementEntries(funds, fetchedData, dominantMarketPrevPriceDate = '') {
    const settlements = [];
    for (const { code, live } of fetchedData) {
        if (!shouldAutoSettleFund(funds[code], live, dominantMarketPrevPriceDate)) continue;
        const settlement = buildSettlementEntry(code, live);
        if (settlement) settlements.push(settlement);
    }
    return settlements;
}

async function saveSettlementState(funds, todayStr, autoSettlementBlockedDate = null, dailyProfitHistory = null) {
    const dataToSave = {
        myFunds: funds,
        lastSettlementDate: todayStr,
        autoSettlementBlockedDate,
        lastUpdateDate: todayStr
    };
    if (dailyProfitHistory) {
        dataToSave.dailyProfitHistory = normalizeDailyProfitHistory(dailyProfitHistory);
    }
    await storageHelper.setAll(dataToSave);
}
