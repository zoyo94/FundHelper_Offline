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

// 分红主动抓取兜底的内存节流：避免缓存路径每次刷新都对每只持仓基金重复拉取 pingzhongdata
const _dividendRemoteCheckTs = new Map();

async function detectAutoDividends(funds, fetchedData, todayStr, tradeOrdersMap = new Map()) {
    runtimeTradeOrdersMap = tradeOrdersMap;
    let dataChanged = false;

    for (const { code, live } of fetchedData) {
        const item = funds[code];
        if (!item) continue;

        // 1) 实时分红源：来自 pingzhongdata 解析，仅在走实际 fetch 路径或非空快照时有效
        let dividendList = safeArray(live?.dividendList, []);

        // 2) 降级源：实时源为空时，从 HistoryDB 已持久化的 unitMoney 分红字段补录。
        //    解决「缓存路径(收盘后跳过 fetch)/今日尚无含分红快照」时 live.dividendList 被清零而漏检。
        //    HistoryDB 在每次成功 fetch 时已写入 unitMoney，跨刷新保留，是最可靠的兜底。
        if (dividendList.length === 0 && Number(item.shares) > 0) {
            try {
                const historyRecords = await HistoryDB.getRange(code, item.addedDate || '1970-01-01', todayStr);
                const fromHistory = extractDividendEventsFromHistoryRecords(historyRecords, item.addedDate || '');
                if (fromHistory.length) {
                    dividendList = fromHistory;
                    debugDividendTrace(code, 'detect-auto-dividend-history-fallback', {
                        count: fromHistory.length,
                        dates: fromHistory.map(d => d.date)
                    });
                }
            } catch (e) {
                debugDividendTrace(code, 'detect-auto-dividend-history-fallback-error', { message: e.message });
            }
        }

        // 3) 主动抓取兜底：实时源与 HistoryDB 兜底都为空时，直接重新拉取该基金 pingzhongdata 解析分红。
        //    覆盖「缓存路径未重新 fetch / _persistEastmoneyHistoryGap 升级未命中 / 标注滞后」等所有边界，
        //    确保东财标注落地后下一次刷新必检。30 分钟内存节流，避免自动刷新刷爆网络。
        if (dividendList.length === 0 && Number(item.shares) > 0) {
            try {
                const nowTs = Date.now();
                const lastCheck = _dividendRemoteCheckTs.get(code) || 0;
                if (nowTs - lastCheck > 30 * 60 * 1000) {
                    _dividendRemoteCheckTs.set(code, nowTs);
                    const text = await fetchPrioritizedHistoryText(code);
                    const fromRemote = extractDividendListFromEastmoneyText(text);
                    if (fromRemote.length) {
                        dividendList = fromRemote;
                        debugDividendTrace(code, 'detect-auto-dividend-remote-fallback', {
                            count: fromRemote.length,
                            dates: fromRemote.map(d => d.date)
                        });
                        // 顺带安全升级 HistoryDB（put 仅更新 dividend 字段，不覆盖已有 price/acPrice）
                        try {
                            const remoteItems = buildEastmoneyHistoryItemsFromText(code, text);
                            if (remoteItems.length) {
                                await _persistEastmoneyHistoryGap(code, remoteItems, true);
                            }
                        } catch (e) {
                            debugDividendTrace(code, 'detect-auto-dividend-remote-upgrade-error', { message: e.message });
                        }
                    }
                }
            } catch (e) {
                debugDividendTrace(code, 'detect-auto-dividend-remote-fallback-error', { message: e.message });
            }
        }

        if (!dividendList.length) {
            debugDividendTrace(code, 'detect-auto-dividend-no-list', {
                hasLive: Boolean(live),
                prevPriceDate: live?.prevPriceDate || '',
                listLength: Array.isArray(live?.dividendList) ? live.dividendList.length : 0
            });
            continue;
        }

        debugDividendTrace(code, 'detect-auto-dividend-start', {
            prevPriceDate: live?.prevPriceDate || '',
            addedDate: item.addedDate || '',
            listLength: dividendList.length,
            orderCount: safeArray(tradeOrdersMap.get(code), []).length
        });

        for (const dividend of dividendList) {
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

function shouldAutoSettleFund(fund, live) {
    if (!fund || !live || live.prevPrice <= 0 || !live.prevPriceDate) {
        return false;
    }
    // 放宽：只要 prevPriceDate 比 savedPrevDate 新就允许结算
    // 不再强制要求匹配“主流市场上一交易日”，避免 QDII/封闭期等净值日期滞后的基金永远不被结算
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

function collectAutoSettlementEntries(funds, fetchedData) {
    const settlements = [];
    for (const { code, live } of fetchedData) {
        if (!shouldAutoSettleFund(funds[code], live)) continue;
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
