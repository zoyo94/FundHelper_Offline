function buildAutoDividendNotification(code, dividend, totalDividend, arrivalDate, isArrived) {
    if (isArrived) {
        return {
            message: `检测到 ${code} 分红：${dividend.date}，每份${dividend.perShare}元，共${totalDividend}元（已到账）`,
            type: 'success'
        };
    }
    return {
        message: `检测到 ${code} 分红：${dividend.date}，每份${dividend.perShare}元，共${totalDividend}元，预计${arrivalDate}到账`,
        type: 'info'
    };
}

function syncAutoDetectedDividendEntry(existingAdj, dividend, todayStr, shares = 0) {
    if (!existingAdj || !dividend || !dividend.date) return false;

    const nextArrivalDate = calculateDividendArrivalDate(dividend.date);
    const isArrived = nextArrivalDate < todayStr;
    let changed = false;

    if (existingAdj.dividendDate !== dividend.date) {
        existingAdj.dividendDate = dividend.date;
        changed = true;
    }
    if (existingAdj.perShare !== dividend.perShare) {
        existingAdj.perShare = dividend.perShare;
        changed = true;
    }
    if (dividend.navPrice && existingAdj.dividendNavPrice !== dividend.navPrice) {
        existingAdj.dividendNavPrice = dividend.navPrice;
        changed = true;
    }
    if (existingAdj.targetDate !== nextArrivalDate) {
        existingAdj.targetDate = nextArrivalDate;
        changed = true;
    }
    if (shares > 0) {
        const nextDividendAmount = round2(shares * dividend.perShare);
        if (existingAdj.dividendAmount !== nextDividendAmount) {
            existingAdj.dividendAmount = nextDividendAmount;
            changed = true;
        }
    }
    if (existingAdj.type === 'dividend_reinvest' && existingAdj.dividendAmount > 0 && existingAdj.dividendNavPrice > 0) {
        const nextConfirmedShares = roundShares(existingAdj.dividendAmount / existingAdj.dividendNavPrice);
        if (existingAdj.shares !== nextConfirmedShares || existingAdj.confirmedShares !== nextConfirmedShares) {
            existingAdj.shares = nextConfirmedShares;
            existingAdj.confirmedShares = nextConfirmedShares;
            changed = true;
        }
    }
    if (existingAdj.inferredBySettlement) {
        existingAdj.inferredBySettlement = false;
        changed = true;
    }

    if (existingAdj.status !== 'confirmed' && isArrived) {
        existingAdj.status = 'confirmed';
        existingAdj.confirmedDate = todayStr;
        changed = true;
    }

    return changed;
}

async function addAutoDetectedDividend(item, code, dividend, todayStr, inferredBySettlement = false) {
    const totalDividend = round2(item.shares * dividend.perShare);
    const arrivalDate = calculateDividendArrivalDate(dividend.date);
    const isArrived = arrivalDate < todayStr;
    const dividendMode = item.dividendMode === 'reinvest' ? 'reinvest' : 'cash';
    const shouldConfirmNow = dividendMode !== 'reinvest' && isArrived;
    const reinvestShares = dividendMode === 'reinvest' && dividend.navPrice > 0
        ? roundShares(totalDividend / dividend.navPrice)
        : 0;

    const payload = normalizeTradeRecord({
        type: dividendMode === 'reinvest' ? 'dividend_reinvest' : 'dividend',
        date: dividend.date,
        dividendAmount: totalDividend,
        perShare: dividend.perShare,
        dividendNavPrice: dividend.navPrice,
        dividendDate: dividend.date,
        targetDate: arrivalDate,
        orderDate: dividend.date,
        status: shouldConfirmNow ? 'confirmed' : 'pending',
        confirmedDate: shouldConfirmNow ? arrivalDate : undefined,
        shares: reinvestShares,
        confirmedShares: 0,
        reinvestApplied: false,
        autoDetected: true,
        inferredBySettlement: inferredBySettlement === true
    }, { code, name: item.name, group: item.group, source: 'auto_dividend' });

    await persistTradeOrder(payload, payload);
    return buildAutoDividendNotification(code, dividend, totalDividend, arrivalDate, isArrived);
}

function isSameRecordedDividendEvent(record, dividend, expectedAmount = 0) {
    if (!record || !dividend || !dividend.date || !isDividendType(record.type)) return false;

    const normalized = normalizeTradeRecord(record);
    const expectedArrivalDate = calculateDividendArrivalDate(dividend.date);
    const normalizedDividendDate = normalizePerfDate(dividend.date);
    const recordDividendDate = normalizePerfDate(normalized.dividendDate || '');
    const recordTargetDate = normalizePerfDate(normalized.targetDate || '');
    const recordOrderDate = normalizePerfDate(normalized.orderDate || '');
    const recordDate = normalizePerfDate(normalized.date || '');

    if (recordDividendDate && recordDividendDate === normalizedDividendDate) {
        return true;
    }
    if (recordOrderDate && recordOrderDate === normalizedDividendDate) {
        return true;
    }
    if (recordDate && recordDate === normalizedDividendDate) {
        return true;
    }
    if (recordTargetDate && expectedArrivalDate && recordTargetDate === expectedArrivalDate) {
        const existingAmount = safeFloat(
            Number(normalized.dividendAmount) > 0 ? normalized.dividendAmount : normalized.amount,
            0
        );
        if (!(expectedAmount > 0) || !(existingAmount > 0) || Math.abs(existingAmount - expectedAmount) <= 0.01) {
            return true;
        }
    }

    return false;
}

function getSettlementFallbackDividendDate(item, fallbackDate, fallbackPerShare = 0) {
    if (!item || !fallbackDate) return fallbackDate || '';
    const fallbackDateValue = new Date(fallbackDate);
    if (isNaN(fallbackDateValue.getTime())) return fallbackDate;

    const normalizedPerShare = Number(fallbackPerShare) || 0;
    const pendingAdjustments = getPendingAdjustments(item, item?.code);
    const matched = pendingAdjustments.find(adj => {
        if (!(isDividendType(adj.type) && adj.autoDetected === true)) return false;
        const adjDate = adj.dividendDate || '';
        if (!adjDate) return false;
        const adjDateValue = new Date(adjDate);
        if (isNaN(adjDateValue.getTime())) return false;
        const dayDiff = Math.abs(fallbackDateValue.getTime() - adjDateValue.getTime()) / CONSTANTS.DAY_MS;
        if (dayDiff > 2) return false;

        if (normalizedPerShare > 0) {
            const adjPerShare = Number(adj.perShare) || 0;
            if (!(adjPerShare > 0) || Math.abs(adjPerShare - normalizedPerShare) > 0.00001) {
                return false;
            }
        }

        return true;
    });

    return matched?.dividendDate || fallbackDate;
}

async function ensureAutoDetectedDividendEntry(item, code, dividend, todayStr, notify = false, source = 'api', existingRecords = []) {
    if (!item || !dividend || !dividend.date || typeof dividend.perShare !== 'number' || !(dividend.perShare > 0)) {
        debugDividendTrace(code, 'auto-dividend-skip-invalid-input', { source, dividend });
        return false;
    }
    const shares = Number(item.shares) || 0;
    if (!(shares > 0)) {
        debugDividendTrace(code, 'auto-dividend-skip-no-shares', { source, shares, dividend });
        return false;
    }

    const expectedAmount = round2(shares * dividend.perShare);
    const candidateRecords = safeArray(
        Array.isArray(existingRecords) && existingRecords.length > 0
            ? existingRecords
            : runtimeTradeOrdersMap.get(code),
        []
    );

    const existingOrder = candidateRecords.find(record =>
        isSameRecordedDividendEvent(record, dividend, expectedAmount)
    );

    if (existingOrder) {
        if (source === 'api' && existingOrder.inferredBySettlement) {
            const synced = syncAutoDetectedDividendEntry(existingOrder, dividend, todayStr, shares);
            if (synced && existingOrder.id) {
                await HistoryDB.updateOrder(existingOrder.id, existingOrder).catch(() => {});
            }
            debugDividendTrace(code, 'auto-dividend-sync-fallback-entry', {
                source, synced, dividend, existingOrder
            });
            return synced;
        }

        debugDividendTrace(code, 'auto-dividend-skip-existing-order', {
            source, dividend, expectedAmount, existingOrder
        });
        return false;
    }

    const notification = await addAutoDetectedDividend(item, code, dividend, todayStr, source === 'fallback');
    debugDividendTrace(code, 'auto-dividend-created', {
        source, dividend, totalDividend: notification ? round2(shares * (Number(dividend.perShare) || 0)) : 0, notify
    });

    if (notify && notification) {
        notificationCenter.add(notification.message, notification.type);
    }
    return true;
}

function extractDividendEventsFromHistoryRecords(records = [], addedDate = '') {
    const events = safeArray(records, [])
        .filter(record => record?.date && (!addedDate || record.date >= addedDate) && safeString(record?.dividend, '').includes('分红'))
        .map(record => {
            const desc = safeString(record.dividend, '');
            const match = desc.match(/([0-9.]+)元/);
            const perShare = safeFloat(match?.[1], 0);
            if (!(perShare > 0)) return null;
            return {
                date: normalizePerfDate(record.date || ''),
                perShare,
                navPrice: safeFloat(record.price, 0),
                desc
            };
        })
        .filter(Boolean);

    const deduped = [];
    const seen = new Set();
    for (const event of events) {
        const key = `${event.date}|${event.perShare}|${event.navPrice}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(event);
    }
    return deduped;
}

async function backfillHistoricalDividendOrdersFromHistoryDB(funds, todayStr, tradeOrdersMap = new Map()) {
    const results = await Promise.all(
        Object.entries(funds || {}).map(([code, item]) =>
            backfillHistoricalDividendOrdersForFund(code, item, todayStr, tradeOrdersMap.get(code) || [])
        )
    );
    return results.some(Boolean);
}

async function backfillHistoricalDividendOrdersForFund(code, item, todayStr = getToday(), existingOrders = []) {
    if (!code || !item || !item.addedDate) return false;

    const historyRecords = await HistoryDB.getRange(code, item.addedDate, todayStr).catch(() => []);
    if (!Array.isArray(historyRecords) || historyRecords.length === 0) return false;

    const dividendEvents = extractDividendEventsFromHistoryRecords(historyRecords, item.addedDate);
    if (dividendEvents.length === 0) return false;

    let changed = false;
    const nextOrders = normalizeTradeRecordList(existingOrders, { source: 'order' }).slice();

    for (const dividend of dividendEvents) {
        const snapshot = calculatePositionSnapshotFromTradeOrdersAtDate(nextOrders, dividend.date);
        const sharesAtDividendDate = snapshot.shares > 0
            ? snapshot.shares
            : (safeFloat(item.shares, 0) > 0 ? safeFloat(item.shares, 0) : 0);
        if (!(sharesAtDividendDate > 0)) {
            continue;
        }

        const created = await ensureAutoDetectedDividendEntry(
            { ...item, shares: sharesAtDividendDate },
            code,
            dividend,
            todayStr,
            false,
            'history_db',
            nextOrders
        );
        if (created) {
            changed = true;
            nextOrders.push(normalizeTradeRecord({
                code,
                name: item.name || code,
                group: item.group || '默认',
                type: 'dividend',
                date: dividend.date,
                orderDate: dividend.date,
                dividendDate: dividend.date,
                targetDate: calculateDividendArrivalDate(dividend.date),
                confirmedDate: calculateDividendArrivalDate(dividend.date) < todayStr ? calculateDividendArrivalDate(dividend.date) : '',
                dividendAmount: round2(sharesAtDividendDate * dividend.perShare),
                perShare: dividend.perShare,
                dividendNavPrice: dividend.navPrice,
                status: calculateDividendArrivalDate(dividend.date) < todayStr ? 'confirmed' : 'pending',
                source: 'auto_dividend'
            }, { source: 'order' }));
        }
    }

    return changed;
}

async function debugFundDividendBackfillFromHistoryDB(code, addedDate = '') {
    const normalizedCode = safeString(code, '');
    const normalizedAddedDate = normalizePerfDate(addedDate || '');
    if (!normalizedCode || !normalizedAddedDate) {
        return {
            code: normalizedCode,
            addedDate: normalizedAddedDate,
            historyCount: 0,
            dividendHistoryCount: 0,
            dividendEvents: [],
            orders: []
        };
    }

    const historyRecords = await HistoryDB.getRange(normalizedCode, normalizedAddedDate, getToday()).catch(() => []);
    const dividendRecords = safeArray(historyRecords, []).filter(record => safeString(record?.dividend, '').includes('分红'));
    const dividendEvents = extractDividendEventsFromHistoryRecords(historyRecords, normalizedAddedDate);
    const orders = await HistoryDB.getOrders(normalizedCode).catch(() => []);

    return {
        code: normalizedCode,
        addedDate: normalizedAddedDate,
        historyCount: safeArray(historyRecords, []).length,
        dividendHistoryCount: dividendRecords.length,
        dividendRecords: dividendRecords.map(record => ({
            date: record.date,
            price: record.price,
            dividend: record.dividend || ''
        })),
        dividendEvents,
        orders: normalizeTradeRecordList(orders, { source: 'order' }).filter(order => isDividendType(order.type))
    };
}

