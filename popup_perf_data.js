// ==================== 加载数据 ====================
let _loadDataPromise = null; // 并发保护：使用 Promise 队列
let _activeRequestIsSkip = false;
let _pendingNonSkipRequest = null;

async function loadData(options = {}) {
    const skipLiveRequests = Boolean(options.skipLiveRequests);

    if (_loadDataPromise) {
        // 如果当前运行的是 skip，而新来的是 non-skip，我们需要确保在当前 skip 请求完成后，运行一个 non-skip 请求
        if (_activeRequestIsSkip && !skipLiveRequests) {
            if (!_pendingNonSkipRequest) {
                _pendingNonSkipRequest = _loadDataPromise.then(() => {
                    _pendingNonSkipRequest = null;
                    return loadData({ skipLiveRequests: false });
                });
            }
            return _pendingNonSkipRequest;
        }
        // 如果当前运行的是 non-skip，或者新来的也是 skip，直接复用当前 promise
        return _loadDataPromise;
    }

    _activeRequestIsSkip = skipLiveRequests;
    _loadDataPromise = _loadDataImpl({ skipLiveRequests })
        .finally(() => {
            _loadDataPromise = null;
            _activeRequestIsSkip = false;
        });

    return _loadDataPromise;
}

async function _loadDataImpl({ skipLiveRequests = false } = {}) {
    try {
        clearSelection();
        elements.statusText.innerText = '同步行情中...';

        const storageState = await storageHelper.getAll([
            'myFunds',
            'lastSettlementDate',
            'lastDayProfits',
            'lastUpdateDate',
            'autoSettlementBlockedDate',
            'dailyProfitHistory'
        ]);
        const {
            myFunds,
            lastSettlementDate,
            lastDayProfits,
            lastUpdateDate,
            autoSettlementBlockedDate,
            dailyProfitHistory
        } = storageState;
        let funds = myFunds || {};
        const todayStr = getToday();
        let dataChanged = false;

        // 名字恢复 + addedDate 同步：并发跨基金，避免串行 IndexedDB 读
        const nameChanges = await Promise.all(Object.entries(funds).map(async ([code, item]) => {
            let changed = false;
            if (!item.name || item.name === code) {
                try {
                    const latest = await HistoryDB.getLatest(code);
                    if (latest && latest.name) { item.name = latest.name; changed = true; }
                } catch (dbErr) {
                    console.warn(`[RestoreName] ${code} 恢复失败:`, dbErr);
                }
            }
            return changed || syncAddedDateByPosition(item, todayStr);
        }));
        if (nameChanges.some(Boolean)) dataChanged = true;

        const codes = Object.keys(funds);
        const results = [];

        // 走势数据懒加载：首次调用时从 storage 读取，只加载当前基金列表里的数据
        // 后续刷新时 fundHistoryData 已在内存中，跳过重复读取
        if (Object.keys(fundHistoryData).length === 0 && codes.length > 0) {
            await loadFundHistoryData(codes);
        }

        // 1. 获取行情数据 + 交易订单 Map（两者独立，并发启动）
        let fetchedData = [];
        // 提前启动 buildTradeOrdersMap，与行情请求并发
        const tradeOrdersMapPromise = buildTradeOrdersMap(codes);

        if (skipLiveRequests) {
            fetchedData = await buildLiveDataFromSnapshot(codes, funds, todayStr);
        }

        if (!skipLiveRequests && codes.length > 0) {
            for (let i = 0; i < codes.length; i += CONFIG.BATCH_SIZE) {
                const batch = codes.slice(i, i + CONFIG.BATCH_SIZE);
                const batchResults = await fetchBatchLiveInfo(
                    batch,
                    CONFIG.API_TIMEOUT,
                    code => ({ name: `[超时]${code}`, rate: 0, price: 0, prevPrice: 0 })
                );
                fetchedData.push(...batchResults);
                // 批次间短暂延迟，避免请求过于密集
                if (i + CONFIG.BATCH_SIZE < codes.length) {
                    await new Promise(resolve => setTimeout(resolve, CONFIG.BATCH_DELAY));
                }
            }
            await Promise.all([
                persistLiveSnapshot(
                    fetchedData
                        .map(({ code, live }) => toSnapshotEntry(code, live))
                        .filter(Boolean),
                    todayStr
                ),
                persistLiveApiRequestDate(todayStr),
                isAfterAutoRefreshPauseCutoff() ? persistFinalLiveApiRequestDate(todayStr) : Promise.resolve()
            ]);
        }

        const dominantMarketPrevPriceDate = getDominantMarketPrevPriceDate(fetchedData);
        const tradeOrdersMap = await tradeOrdersMapPromise;

        // 2. 保留实时接口分红检测；历史分红补录改为按需触发（如添加资产时）
        dataChanged = (await detectAutoDividends(funds, fetchedData, todayStr, tradeOrdersMap)) || dataChanged;

        // 3. 自动结算逻辑（在分红检测之后）
        // 修复：同一天内如果有基金晚到更新，仍允许继续补结算；
        // 只有“今日已执行撤销”时才整天禁止自动结算。
        const { blockedDate } = parseSettlementState(lastSettlementDate, autoSettlementBlockedDate);
        const isRollbackToday = blockedDate === todayStr;
        if (!isRollbackToday) {
            const autoSettlementEntries = collectAutoSettlementEntries(funds, fetchedData, dominantMarketPrevPriceDate);
            if (autoSettlementEntries.length > 0) {
                const { backupFunds } = await storageHelper.getAll(['backupFunds']);
                const settlementSnapshot = createBackupSnapshot({
                    myFunds: funds,
                    lastUpdateDate,
                    lastDayProfits,
                    lastSettlementDate,
                    autoSettlementBlockedDate,
                    backupFunds,
                    dailyProfitHistory
                });
                await autoSettlement(funds, autoSettlementEntries, todayStr, settlementSnapshot);
            }
        }

        // 4. 处理数据 & 自动确认份额
        // 收集所有确认的交易，最后合并通知
        const confirmedTransactions = buildConfirmedTransactionsState();

        // 历史收益数据需要在循环中用于昨日收益展示，所以先在循环前完成 reconcile
        const latestHistoryState = await storageHelper.getAll(['dailyProfitHistory']);
        const normalizedDailyProfitHistory = normalizeDailyProfitHistory(
            mergeDailyProfitHistories(dailyProfitHistory, latestHistoryState.dailyProfitHistory)
        );
        const { history: nextDailyProfitHistory, changed: dailyProfitHistoryChanged } = await reconcileDailyProfitHistory(
            normalizedDailyProfitHistory,
            funds,
            fetchedData,
            dominantMarketPrevPriceDate
        );

        for (const { code, live } of fetchedData) {
            const item = funds[code];
            if (live && item) {
                const normalizedItemShares = roundShares(item.shares || 0);
                if ((item.shares || 0) !== normalizedItemShares) {
                    item.shares = normalizedItemShares;
                    dataChanged = true;
                }

                // 兜底：若已检测到分红提示但交易记录里还没有对应自动分红单，则在渲染前补齐。
                // 不重复发通知，仅保证交易流水与分红提示一致。
                if (item && Array.isArray(live.dividendList) && live.dividendList.length > 0) {
                    debugDividendTrace(code, 'render-precheck-dividend-list', {
                        prevPriceDate: live.prevPriceDate || '',
                        listLength: live.dividendList.length,
                        pendingCount: getPendingAdjustments(item).length
                    });
                    for (const dividend of live.dividendList) {
                        if (!dividend || !dividend.date || typeof dividend.perShare !== 'number') {
                            continue;
                        }
                        if (item.addedDate && dividend.date < item.addedDate) {
                            continue;
                        }
                        const createdFromRenderPath = await ensureAutoDetectedDividendEntry(
                            item,
                            code,
                            dividend,
                            todayStr,
                            false,
                            'api',
                            tradeOrdersMap.get(code) || []
                        );
                        if (createdFromRenderPath) {
                            dataChanged = true;
                        }
                        debugDividendTrace(code, 'render-precheck-dividend-ensure-result', {
                            dividendDate: dividend.date,
                            perShare: dividend.perShare,
                            createdFromRenderPath
                        });
                    }
                }

                let pendingAdjustments = getPendingAdjustments(item, code);

                // --- A. 处理待确认份额（加仓/减仓/分红）---
                if (pendingAdjustments.length > 0) {
                    for (const adj of pendingAdjustments) {
                        if (adj.status === 'confirmed') continue;
                        if (isPendingAdjustmentDue(adj, todayStr)) {
                            if (adj.type === 'add') {
                                const actualRate = (adj.feeRate || 0) / 100;
                                const execution = await resolveTradeExecutionPrice(code, adj, live.prevPrice);
                                const price = execution.price;
                                if (price > 0) {
                                    const deltaShares = roundShares((adj.amount * (1 - actualRate)) / price);
                                    item.shares = roundShares(item.shares + deltaShares);
                                    item.amount = round2(item.shares * live.prevPrice);
                                    adj.status = 'confirmed';
                                    adj.confirmedPrice = price;
                                    adj.orderNav = safeFloat(adj.orderNav, 0) > 0 ? adj.orderNav : price;
                                    adj.confirmedShares = roundShares(deltaShares);
                                    adj.confirmedDate = todayStr;

                                    // 记录到独立的订单流水表 (tradeOrders)
                                    const confirmedAddOrder = {
                                        code,
                                        name: item.name,
                                        group: item.group,
                                        type: 'add',
                                        date: todayStr,
                                        orderDate: adj.orderDate || '',
                                        effectiveDate: adj.effectiveDate || adj.orderDate || '',
                                        targetDate: adj.targetDate || '',
                                        confirmedDate: todayStr,
                                        orderNav: adj.orderNav || price,
                                        confirmedPrice: price,
                                        confirmedShares: adj.confirmedShares,
                                        amount: adj.amount,
                                        feeRate: adj.feeRate || 0,
                                        price: price,
                                        fee: round2(adj.amount * (adj.feeRate || 0) / 100),
                                        status: 'confirmed'
                                    };
                                    await persistTradeOrder(adj, confirmedAddOrder);

                                    // 收集确认信息，不立即弹 toast
                                    confirmedTransactions.add.push({ code, shares: adj.confirmedShares, price });
                                    dataChanged = true;
                                }
                            } else if (adj.type === 'remove') {
                                const execution = await resolveTradeExecutionPrice(code, adj, live.prevPrice);
                                const price = execution.price;
                                if (price > 0) {
                                    item.shares = roundShares(item.shares - roundShares(adj.shares));
                                    if (item.shares < 0) item.shares = 0;
                                    item.amount = round2(item.shares * live.prevPrice);
                                    // 赎回手续费：按卖出金额扣减，计入累计收益（成本）
                                    const fee = round2(adj.shares * price * ((adj.feeRate || 0) / 100));
                                    if (fee > 0) {
                                        item.holdProfit = round2((item.holdProfit || 0) - fee);
                                    }
                                    adj.status = 'confirmed';
                                    adj.confirmedPrice = price;
                                    adj.orderNav = safeFloat(adj.orderNav, 0) > 0 ? adj.orderNav : price;
                                    adj.confirmedShares = roundShares(adj.shares);
                                    adj.confirmedDate = todayStr;

                                    // 记录到独立的订单流水表 (tradeOrders)
                                    const confirmedRemoveOrder = {
                                        code,
                                        name: item.name,
                                        group: item.group,
                                        type: 'remove',
                                        date: todayStr,
                                        orderDate: adj.orderDate || '',
                                        effectiveDate: adj.effectiveDate || adj.orderDate || '',
                                        targetDate: adj.targetDate || '',
                                        confirmedDate: todayStr,
                                        orderNav: adj.orderNav || price,
                                        confirmedPrice: price,
                                        confirmedShares: adj.confirmedShares,
                                        shares: roundShares(adj.shares),
                                        amount: round2(roundShares(adj.shares) * price),
                                        feeRate: adj.feeRate || 0,
                                        price: price,
                                        fee: fee,
                                        status: 'confirmed',
                                        isClear: adj.isClear || false,
                                        remark: adj.isClear ? '清仓赎回' : '减仓已确认'
                                    };
                                    await persistTradeOrder(adj, confirmedRemoveOrder);

                                    // 收集确认信息，不立即弹 toast
                                    confirmedTransactions.remove.push({ code, shares: roundShares(adj.shares), price, fee });
                                    dataChanged = true;
                                }
                            } else if (adj.type === 'dividend') {
                                // 现金分红确认：
                                // autoDetected 分红由结算层（累计净值差）统一处理，确认时一律跳过手动计入，
                                // 避免结算层与确认层双重计算。
                                // 只有用户手动创建的分红（autoDetected 不为 true）才需要在此计入 holdProfit。
                                if (!adj.autoDetected) {
                                    item.holdProfit = round2((item.holdProfit || 0) + adj.dividendAmount);
                                }
                                adj.status = 'confirmed';
                                adj.confirmedDate = todayStr;
                                debugDividendTrace(code, 'pending-adjustment-confirm-dividend', {
                                    autoDetected: adj.autoDetected === true,
                                    dividendDate: adj.dividendDate || '',
                                    targetDate: adj.targetDate || '',
                                    perShare: Number(adj.perShare) || 0,
                                    dividendAmount: Number(adj.dividendAmount) || 0,
                                    confirmedDate: adj.confirmedDate
                                });
                                // 收集确认信息，不立即弹 toast
                                confirmedTransactions.dividend.push({ code, amount: adj.dividendAmount, date: adj.targetDate });
                                
                                // 记录分红订单到账目表
                                const confirmedDividendOrder = {
                                    code,
                                    name: item.name,
                                    group: item.group,
                                    type: 'dividend',
                                    date: todayStr,
                                    orderDate: adj.orderDate || '',
                                    targetDate: adj.targetDate || '',
                                    confirmedDate: todayStr,
                                    amount: adj.dividendAmount,
                                    feeRate: adj.feeRate || 0,
                                    fee: adj.fee || 0,
                                    dividendAmount: adj.dividendAmount,
                                    dividendDate: adj.dividendDate || '',
                                    perShare: adj.perShare || 0,
                                    dividendNavPrice: adj.dividendNavPrice || live.prevPrice,
                                    shares: 0,
                                    price: live.prevPrice,
                                    remark: adj.autoDetected ? '自动检测分红' : '手动记录分红',
                                    status: 'confirmed'
                                };
                                await persistTradeOrder(adj, confirmedDividendOrder);
                                dataChanged = true;
                            } else if (adj.type === 'dividend_reinvest') {
                                if (adj.autoDetected && adj.reinvestApplied) {
                                    adj.status = 'confirmed';
                                    adj.confirmedDate = todayStr;
                                    await persistTradeOrder(adj, {
                                        code,
                                        name: item.name,
                                        group: item.group,
                                        type: 'dividend_reinvest',
                                        date: todayStr,
                                        orderDate: adj.orderDate || '',
                                        targetDate: adj.targetDate || '',
                                        confirmedDate: todayStr,
                                        amount: adj.dividendAmount,
                                        feeRate: adj.feeRate || 0,
                                        fee: adj.fee || 0,
                                        shares: roundShares(adj.confirmedShares || 0),
                                        price: adj.dividendNavPrice || live.prevPrice,
                                        dividendAmount: adj.dividendAmount,
                                        dividendDate: adj.dividendDate || '',
                                        dividendNavPrice: adj.dividendNavPrice || live.prevPrice,
                                        confirmedShares: roundShares(adj.confirmedShares || 0),
                                        confirmedPrice: adj.dividendNavPrice || live.prevPrice,
                                        reinvestApplied: true,
                                        autoDetected: true,
                                        remark: '自动检测红利再投已由结算处理',
                                        status: 'confirmed'
                                    });
                                    dataChanged = true;
                                    continue;
                                }
                                // 红利再投：份额增加，累计收益不变
                                const reinvestPrice = adj.dividendNavPrice || live.prevPrice;
                                const deltaShares = roundShares(adj.confirmedShares || adj.shares || (adj.dividendAmount / reinvestPrice));
                                item.shares = roundShares(item.shares + deltaShares);
                                item.amount = round2(item.shares * live.prevPrice);
                                adj.status = 'confirmed';
                                adj.confirmedPrice = reinvestPrice;
                                adj.confirmedShares = deltaShares;
                                adj.shares = deltaShares;
                                adj.reinvestApplied = true;
                                adj.confirmedDate = todayStr;
                                // 收集确认信息，不立即弹 toast
                                confirmedTransactions.dividend_reinvest.push({ code, shares: deltaShares, price: reinvestPrice });
                                const confirmedDividendReinvestOrder = {
                                    code,
                                    name: item.name,
                                    group: item.group,
                                    type: 'dividend_reinvest',
                                    date: todayStr,
                                    orderDate: adj.orderDate || '',
                                    targetDate: adj.targetDate || '',
                                    confirmedDate: todayStr,
                                    amount: adj.dividendAmount,
                                    feeRate: adj.feeRate || 0,
                                    fee: adj.fee || 0,
                                    shares: deltaShares,
                                    price: reinvestPrice,
                                    dividendAmount: adj.dividendAmount,
                                    dividendDate: adj.dividendDate || '',
                                    dividendNavPrice: adj.dividendNavPrice || reinvestPrice,
                                    confirmedShares: deltaShares,
                                    confirmedPrice: reinvestPrice,
                                    remark: adj.autoDetected ? '自动检测分红转红利再投' : '手动分红转红利再投',
                                    status: 'confirmed'
                                };
                                await persistTradeOrder(adj, confirmedDividendReinvestOrder);
                                dataChanged = true;
                            }
                        }
                    }
                }

                if (pendingAdjustments.some(adj => adj.status === 'confirmed')) {
                    pendingAdjustments = getPendingAdjustments(item, code);
                }
                // --- B. 原有份额修正逻辑 ---
                if (!item.shares && item.amount > 0) {
                    const derivedShares = deriveFundShares(item, live.prevPrice, live.price);
                    if (derivedShares > 0) {
                        item.shares = derivedShares;
                        dataChanged = true;
                    }
                }
                const addedDateChanged = syncAddedDateByPosition(item, todayStr);
                if (addedDateChanged) {
                    dataChanged = true;
                }
                let todayProfit, useFallbackNav = false;

                if (!live.isFallback && live.price > 0) {
                    // 交易时段：用估值与昨日净值的差计算当日浮动
                    todayProfit = item.shares ? round2(item.shares * (live.price - live.prevPrice)) : 0;
                } else if (live.prevPrice > 0 && item.savedPrevPrice > 0) {
                    // 非交易时段：用净值差（已含分红调整，由结算层保证正确性）
                    todayProfit = item.shares ? round2(item.shares * (live.prevPrice - item.savedPrevPrice)) : 0;
                    useFallbackNav = true;
                } else {
                    todayProfit = null;
                }
                const totalProfit = round2((item.holdProfit || 0) + (todayProfit || 0));

                // --- D. 计算待确认分红金额（pending 状态的分红） ---
                const pendingDividendAmount = sumPendingDividendAmount(pendingAdjustments);

                // --- E. 构造结果集 ---
                // 分红期间：持仓金额展示包含待确认分红；昨日收益展示值会补回
                // 1) 手动创建且待确认的分红；
                // 2) 与当前 prevPriceDate 对应的自动检测分红（避免接口分红日出现误负值）。
                const displayAmount = round2((item.amount || 0) + pendingDividendAmount);
                const displayYesterdayProfit = getDisplayedYesterdayProfitFromHistory(
                    { ...item, code },
                    live,
                    nextDailyProfitHistory,
                    dominantMarketPrevPriceDate
                );
                const displayYesterdayRate = calculateDisplayedYesterdayRate({
                    shares: item.shares || 0,
                    prevTradingDayPrice: live.prevTradingDayPrice || 0,
                    yesterdayProfit: displayYesterdayProfit,
                    prevPrice: live.prevPrice || 0,
                    acNetValue: live.acNetValue,
                    prevAcNetValue: live.prevAcNetValue
                });
                const hasPendingDividendForDisplay = pendingAdjustments.some(adj => {
                    if (!isDividendType(adj.type) || adj.status !== 'pending') return false;
                    return isDividendWithinDisplayedSettlementWindow(
                        adj.dividendDate,
                        live.prevTradingDayDate || '',
                        live.prevPriceDate || ''
                    );
                });
                const hasPendingBuy = pendingAdjustments.some(adj => adj.type === 'add' && adj.status === 'pending');
                const hasPendingSell = pendingAdjustments.some(adj => adj.type === 'remove' && adj.status === 'pending');
                debugDividendTrace(code, 'render-yesterday-metrics', {
                    prevPriceDate: live.prevPriceDate || '',
                    prevTradingDayDate: live.prevTradingDayDate || '',
                    prevTradingDayPrice: live.prevTradingDayPrice || 0,
                    prevPrice: live.prevPrice || 0,
                    rawYesterdayProfit: round2(item.yesterdayProfit || 0),
                    displayYesterdayProfit,
                    displayYesterdayRate,
                    pendingDividendAmount,
                    pendingCount: pendingAdjustments.length,
                    hasPendingDividendForDisplay
                });

                results.push({
                    code,
                    name: live.name,
                    amount: displayAmount,
                    yesterdayProfit: displayYesterdayProfit,
                    yesterdayRate: displayYesterdayRate,
                    group: item.group || '默认',
                    rate: live.rate,
                    prevPrice: live.prevPrice || 0,
                    price: live.price || 0,
                    prevPriceDate: live.prevPriceDate || '',
                    priceTime: live.priceTime || '',
                    todayProfit,
                    totalProfit,
                    holdProfit: item.holdProfit || 0,
                    shares: item.shares || 0,
                    useFallbackNav,
                    acNetValue: live.acNetValue || null,
                    prevTradingDayPrice: live.prevTradingDayPrice || 0,
                    prevTradingDayDate: live.prevTradingDayDate || '',
                    pendingAdjustments,
                    pendingDividendAmount,  // 用于调试和显示
                    hasPendingDividendForDisplay,
                    hasPendingBuy,
                    hasPendingSell
                });
            }
        }
        allFundsData = results.filter(Boolean);

        // 记录实时走势点（每次刷新追加一个时间点到 fundHistoryData）
        const now = new Date();
        const hhmm = formatTime(now);
        const shouldRecordIntradayPoint = isIntradayChartTime(hhmm);
        let fundHistoryChanged = false;
        allFundsData.forEach(item => {
            if (!item || !item.code) return;

            if (!fundHistoryData[item.code]) {
                fundHistoryData[item.code] = { date: '', points: [] };
            }
            if (fundHistoryData[item.code].date !== todayStr) {
                // 新的一天：重置并预埋 09:30 基准点（rate=0），避免展示时首点出现尖刺
                fundHistoryData[item.code] = { date: todayStr, points: ensureIntradayBasePoint() };
                fundHistoryChanged = true;
            }
            if (!shouldRecordIntradayPoint) return;
            const pts = fundHistoryData[item.code].points;
            const rate = item.rate || 0;
            // 去重：同一分钟不重复追加；若真实数据与预埋基准点时间相同，用真实 rate 覆盖
            if (pts.length > 0 && pts[pts.length - 1].time === hhmm) {
                if (pts[pts.length - 1].rate !== rate) {
                    pts[pts.length - 1].rate = rate;
                    fundHistoryChanged = true;
                }
            } else {
                pts.push({ time: hhmm, rate });
                fundHistoryChanged = true;
            }
        });
        if (fundHistoryChanged) saveFundHistoryData();

        const todayProfits = buildTodayProfits(results);
        const dataToPersist = buildLoadDataPersistPayload({
            todayProfits,
            lastDayProfits,
            nextDailyProfitHistory,
            dailyProfitHistoryChanged,
            dataChanged,
            funds
        });
        if (dailyProfitHistoryChanged && dataToPersist.dailyProfitHistory) {
            const latestStored = await storageHelper.getAll(['dailyProfitHistory']);
            dataToPersist.dailyProfitHistory = mergeDailyProfitHistories(
                latestStored.dailyProfitHistory,
                dataToPersist.dailyProfitHistory
            );
        }
        if (Object.keys(dataToPersist).length > 0) {
            await storageHelper.setAll(dataToPersist);
        }

        // 显示合并的交易确认通知
        let totalConfirmed = 0;
        const notifications = [];

        if (confirmedTransactions.add.length > 0) {
            totalConfirmed += confirmedTransactions.add.length;
            const codes = confirmedTransactions.add.map(t => t.code).join('、');
            notifications.push(`加仓 ${confirmedTransactions.add.length} 笔：${codes}`);
        }
        if (confirmedTransactions.remove.length > 0) {
            totalConfirmed += confirmedTransactions.remove.length;
            const codes = confirmedTransactions.remove.map(t => t.code).join('、');
            notifications.push(`减仓 ${confirmedTransactions.remove.length} 笔：${codes}`);
        }
        if (confirmedTransactions.dividend.length > 0) {
            totalConfirmed += confirmedTransactions.dividend.length;
            const codes = confirmedTransactions.dividend.map(t => t.code).join('、');
            notifications.push(`现金分红 ${confirmedTransactions.dividend.length} 笔：${codes}`);
        }
        if (confirmedTransactions.dividend_reinvest.length > 0) {
            totalConfirmed += confirmedTransactions.dividend_reinvest.length;
            const codes = confirmedTransactions.dividend_reinvest.map(t => t.code).join('、');
            notifications.push(`红利再投 ${confirmedTransactions.dividend_reinvest.length} 笔：${codes}`);
        }

        if (totalConfirmed > 0) {
            showToast(`✅ 已确认 ${totalConfirmed} 笔交易\n${notifications.join('\n')}`, 'success', 4000);
        }

        updateGroupFilter();
        await hydrateFundPerfCache(funds, allFundsData.map(item => item.code), tradeOrdersMap);
        renderTable();
        lastUpdateTime = new Date().toLocaleTimeString();
        elements.statusText.innerText = `最后更新: ${lastUpdateTime}`;

        // 后台静默拉取区间涨跌幅（不阻塞主流程）
        fetchAllFundPerfData(funds);
        // 启动后台历史数据同步与补全（延后执行，避免与主行情请求竞争）
        setTimeout(() => checkAndFillHistoryGaps(funds), 2000);
    } catch (error) {
        console.error('[_loadDataImpl] 数据加载失败:', error);
        showToast(`数据加载失败: ${error.message}`, 'error');
        elements.statusText.innerText = '数据加载失败，请重试';

        // 确保在错误情况下也显示一个基本的空表格
        if (allFundsData.length === 0) {
            renderTable();
        }
    }
}

