// ==================== 加载数据 ====================
let _loadDataPromise = null; // 并发保护：使用 Promise 队列
let _activeRequestIsSkip = false;
let _pendingNonSkipRequest = null;
let _liveAllFailedToastShown = false; // 行情全失败提示的会话级防抖

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

// _loadDataImpl 编排器：只做阶段调度与统一错误兜底。
// 各阶段通过 ctx 共享状态（funds/fetchedData/tradeOrdersMap 等），任一阶段抛错
// 都会中断后续阶段并走统一错误处理——与原来单函数的行为一致。
async function _loadDataImpl({ skipLiveRequests = false } = {}) {
    try {
        const ctx = await _phaseLoadDataInit({ skipLiveRequests });
        await _phaseFetchLiveData(ctx);
        await _phaseApplyPenetration(ctx);
        await _phaseDividendsAndSettlement(ctx);
        await _phaseProcessFunds(ctx);
        _phaseRecordIntradayPoints(ctx);
        await _phasePersistAndNotify(ctx);
        await _phaseRenderAndBackground(ctx);
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

// 阶段1：初始化——读存储、恢复名称/addedDate、懒加载走势、预取订单 Map
async function _phaseLoadDataInit({ skipLiveRequests } = {}) {
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

        // 交易日历（法定节假日）后台加载：不阻塞渲染，加载成功后
        // T+1/T+2 确认日、最近交易日等计算自动升级为节假日感知
        ensureTradingCalendar();

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

        // 订单 Map 提前启动，与行情请求并发
        const tradeOrdersMapPromise = buildTradeOrdersMap(codes);

        return {
            skipLiveRequests,
            funds, todayStr, dataChanged, codes, results,
            fetchedData: [],
            tradeOrdersMapPromise,
            lastSettlementDate, lastDayProfits, lastUpdateDate,
            autoSettlementBlockedDate, dailyProfitHistory
        };
}

// 阶段2：获取行情数据（实时或快照）+ 全源失败提醒 + 快照持久化
async function _phaseFetchLiveData(ctx) {
        const { codes, funds, todayStr } = ctx;
        let fetchedData = ctx.fetchedData;

        if (ctx.skipLiveRequests) {
            fetchedData = await buildLiveDataFromSnapshot(codes, funds, todayStr);
        }

        if (!ctx.skipLiveRequests && codes.length > 0) {
            fetchedData = await fetchPrioritizedLiveInfo(codes);
            // 记录全源失败的基金（[无估值] 占位、prevPrice=0），在 enrich 补净值之前判定
            const liveFailedCodes = fetchedData
                .filter(({ live }) => !(Number(live?.prevPrice) > 0))
                .map(({ code }) => code);
            fetchedData = await enrichLiveDataWithLocalNavHistory(fetchedData);
            // 全部基金行情获取失败时提醒一次（enrich 已用本地净值兜底，界面仍可读）；
            // 会话级防抖：持续断网不会每次自动刷新都弹，恢复成功后重置
            if (codes.length > 0 && liveFailedCodes.length === codes.length) {
                if (!_liveAllFailedToastShown) {
                    showToast('实时行情获取失败，已显示本地缓存净值', 'warning');
                    _liveAllFailedToastShown = true;
                }
            } else {
                _liveAllFailedToastShown = false;
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

        ctx.fetchedData = fetchedData;
}

// 阶段3：智能穿透估值（实时/快照两条路径均尝试）
// 对无官方盘中估值（如纯债/二级债基/FOF等GSZ为null）的基金，自动解析重仓持仓实时计算
// 注意：持仓数据有12小时内存缓存，15:00后股票停止撮合但我们仍可展示最终加权收益
async function _phaseApplyPenetration(ctx) {
        const { funds, todayStr, fetchedData } = ctx;
        if (fetchedData.length > 0) {
            // —— 步骤1：判定哪些基金需要穿透，并收集 prevPrice ——
            const needPen = [];
            for (const entry of fetchedData) {
                const { code, live } = entry;
                // 仅当官方确实提供了“有意义的盘中估值”时才跳过穿透；
                // 纯债/定开债/FOF 的 fundgz 会回填 gsz==dwjz（price===prevPrice，rate 无实际波动），
                // 属于“伪估值”，应触发持仓穿透，给用户 15:00 前可参考的实时估算。
                const hasExplicitRate = Math.abs(Number(live?.rate) || 0) > 1e-4;
                const hasPriceMove = Math.abs((Number(live?.price) || 0) - (Number(live?.prevPrice) || 0)) > 1e-4;
                // 干净门控：fundgz 给出"真实盘中估值"（相对昨日净值有真实波动 gsz≠dwjz）就直接用，跳过穿透；
                // 只有 gsz==dwjz（无真实波动、rate≈0）的伪估值才走持仓穿透兜底。
                const hasRealIntradayEstimate = !!live && hasUsableLiveEstimate(live) && (hasExplicitRate || hasPriceMove);
                // 已结算保护：prevPriceDate === 今天 意味着官方已公布今日净值（fundgz 的 dwjz 已切到今日），
                // 此时 prevPrice 已包含今日涨幅；若再穿透叠加今日重仓股涨幅 = 双重计入。
                // 典型场景：晚间净值公布后 fundgz 回 gsz==dwjz（无波动伪估值）触发穿透。
                // 盘中 prevPriceDate 一定是上一交易日，本保护不影响日间穿透。
                const navAlreadyPublishedToday = live.prevPriceDate === todayStr;
                if (!live || hasRealIntradayEstimate || navAlreadyPublishedToday) continue;
                const fundItem = funds[code];
                const prevPrice = live.prevPrice
                    || (fundItem?.shares > 0 ? (fundItem?.amount || 0) / fundItem.shares : 0)
                    || (Number(fundItem?.savedPrevPrice) > 0 ? Number(fundItem.savedPrevPrice) : 0);
                if (!(prevPrice > 0)) continue;
                needPen.push({ code, live, prevPrice });
            }

            // —— 阶段2：并行拉取各基金持仓（含重仓股票代码，命中 12h 内存缓存）——
            const holdingsList = await Promise.all(needPen.map(async (np) => {
                const holdings = await fetchFundHoldingsWithCache(np.code);
                return { ...np, holdings };
            }));

            // —— 阶段3：汇总所有基金需要的股票代码，一次性批量拉行情 ——
            // 关键：整次刷新只发 1 个 push2 请求，避免 N 只基金各发一个并行请求
            // 把东财打爆触发 ERR_EMPTY_RESPONSE 限流（表现为同一基金这轮有估值、下轮就"穿透不可用"）。
            const allStocks = [];
            const seenCodes = new Set();
            for (const item of holdingsList) {
                const stocks = item.holdings && item.holdings.stocks;
                if (!stocks) continue;
                for (const s of stocks) {
                    if (!seenCodes.has(s.code)) { seenCodes.add(s.code); allStocks.push(s); }
                }
            }
            const sharedQuotes = allStocks.length > 0 ? await fetchStockQuotesBatch(allStocks) : new Map();
            if (PEN_DEBUG) console.log(`[penetration-batch] 汇总 ${allStocks.length} 只重仓股, 一次性拉取命中 ${sharedQuotes.size} 只行情`);

            // —— 阶段4：各基金用共享行情计算穿透，写回 live ——
            await Promise.all(holdingsList.map(async (item) => {
                const { code, live, prevPrice, holdings } = item;
                if (!holdings || (holdings.stocks.length === 0 && holdings.fofs.length === 0)) {
                    if (PEN_DEBUG) console.log(`[penetration][${code}] 无可用持仓数据（债基/货基无股票 或 持仓源暂不可用），跳过穿透`);
                    return;
                }
                try {
                    const penVal = await fetchPenetrationValuation(code, prevPrice, sharedQuotes);
                    if (penVal && typeof penVal.rate === 'number') {
                        live.price = penVal.price;
                        live.rate = penVal.rate;
                        live.isPenetration = true;
                        live.penetrationType = penVal.penetrationType;
                        live.penetrationDetails = penVal.details;
                        live.penetrationWeight = penVal.totalWeight;
                        // 穿透成功后清掉 fallback 标志，让后续 todayProfit 计算走
                        // (live.price - live.prevPrice)*shares 分支（穿透后的 price 已偏离 prevPrice），
                        // 避免 fallback 分支算出 0 导致 hasNoEstimate 误判显示 "—"
                        live.isFallback = false;
                        if (PEN_DEBUG) console.log(
                            `[penetration] ${code} ${penVal.penetrationType}:`,
                            `rate=${penVal.rate}% price=${penVal.price}` +
                            ` weight=${penVal.totalWeight}% details=${penVal.details.length}`
                        );
                    } else if (PEN_DEBUG) {
                        console.log(`[penetration] ${code} 穿透不可用（无股票持仓/行情为空，属正常边界场景）`);
                    }
                } catch (e) {
                    console.warn(`[penetration] 基金 ${code} 穿透估值异常:`, e.message);
                }
            }));
        }
}

// 阶段4：分红检测 + 自动结算（必须在分红检测之后）
async function _phaseDividendsAndSettlement(ctx) {
        const { funds, todayStr, fetchedData } = ctx;
        const tradeOrdersMap = await ctx.tradeOrdersMapPromise;
        ctx.tradeOrdersMap = tradeOrdersMap;

        // 保留实时接口分红检测；历史分红补录改为按需触发（如添加资产时）
        const dividendsDetectedThisRound = await detectAutoDividends(funds, fetchedData, todayStr, tradeOrdersMap);
        if (dividendsDetectedThisRound) {
            // 本刷产生了新分红订单：让 reconcile 的 backfill 会话缓存失效，
            // 确保收益日历当天就能补写分红标记（否则同日迟检分红要等次日才进日历）
            invalidateDailyProfitBackfillCache();
        }
        ctx.dataChanged = dividendsDetectedThisRound || ctx.dataChanged;

        // 自动结算逻辑（在分红检测之后）
        // 修复：同一天内如果有基金晚到更新，仍允许继续补结算；
        // 只有“今日已执行撤销”时才整天禁止自动结算。
        const { blockedDate } = parseSettlementState(ctx.lastSettlementDate, ctx.autoSettlementBlockedDate);
        const isRollbackToday = blockedDate === todayStr;
        if (!isRollbackToday) {
            const autoSettlementEntries = collectAutoSettlementEntries(funds, fetchedData);
            if (autoSettlementEntries.length > 0) {
                const { backupFunds } = await storageHelper.getAll(['backupFunds']);
                const settlementSnapshot = createBackupSnapshot({
                    myFunds: funds,
                    lastUpdateDate: ctx.lastUpdateDate,
                    lastDayProfits: ctx.lastDayProfits,
                    lastSettlementDate: ctx.lastSettlementDate,
                    autoSettlementBlockedDate: ctx.autoSettlementBlockedDate,
                    backupFunds,
                    dailyProfitHistory: ctx.dailyProfitHistory
                });
                await autoSettlement(funds, autoSettlementEntries, todayStr, settlementSnapshot);
            }
        }
}

// 阶段5：逐基金处理——成本反推、分红补齐、份额确认、结果集构造。
// 不同基金（code）之间相互独立，整循环并行执行（含 persistTradeOrder 的 IndexedDB
// 写入与 resolveTradeExecutionPrice 的取价），同一基金内部的待确认单仍串行处理
//（共享 findMatching/去重逻辑）——消除原来 N 只基金全串行的累计等待；
// 结果按索引写回 results，保持与原 for 循环一致的顺序。
async function _phaseProcessFunds(ctx) {
        const { funds, todayStr, fetchedData, tradeOrdersMap, results } = ctx;
        let dataChanged = ctx.dataChanged;

        // 收集所有确认的交易，最后合并通知
        const confirmedTransactions = buildConfirmedTransactionsState();
        ctx.confirmedTransactions = confirmedTransactions;

        // 历史收益数据需要在循环中用于昨日收益展示，所以先在循环前完成 reconcile
        const latestHistoryState = await storageHelper.getAll(['dailyProfitHistory']);
        const normalizedDailyProfitHistory = normalizeDailyProfitHistory(
            mergeDailyProfitHistories(ctx.dailyProfitHistory, latestHistoryState.dailyProfitHistory)
        );
        const { history: nextDailyProfitHistory, changed: dailyProfitHistoryChanged } = await reconcileDailyProfitHistory(
            normalizedDailyProfitHistory,
            funds,
            fetchedData
        );
        ctx.nextDailyProfitHistory = nextDailyProfitHistory;
        ctx.dailyProfitHistoryChanged = dailyProfitHistoryChanged;

        await Promise.all(fetchedData.map(async ({ code, live }, resultIndex) => {
            const item = funds[code];
            if (live && item) {
                const normalizedItemShares = roundShares(item.shares || 0);
                if ((item.shares || 0) !== normalizedItemShares) {
                    item.shares = normalizedItemShares;
                    dataChanged = true;
                }

                // 持仓成本 positionCost：每次刷新都从已确认订单流水反推，确保减仓、清仓后数据准确
                // 该字段是派生值，不依赖用户手动维护；仅当无建仓类已确认订单（旧迁移数据或手动建仓）
                // 才回退到当前金额；有订单则信任反推结果（哪怕为 0——现金分红已回本的情形），
                // 不能把"成本合法归 0"与"无订单"混为一谈
                const positionCostOrders = tradeOrdersMap.get(code) || [];
                const costFromOrders = calculatePositionCostFromOrders(positionCostOrders);
                const hasConfirmedBuildingOrders = normalizeTradeRecordList(positionCostOrders, { source: 'order' })
                    .some(order => order.status === 'confirmed' && isPositionBuildingTradeRecord(order));
                const nextPositionCost = hasConfirmedBuildingOrders
                    ? costFromOrders
                    : round2(item.amount || 0);
                if ((item.positionCost || 0) !== nextPositionCost) {
                    item.positionCost = nextPositionCost;
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
                                    item.positionCost = round2((item.positionCost || 0) + adj.amount);
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
                                    const oldShares = item.shares;
                                    const soldShares = roundShares(adj.shares);
                                    item.shares = roundShares(oldShares - soldShares);
                                    if (item.shares < 0) item.shares = 0;
                                    item.amount = round2(item.shares * live.prevPrice);
                                    // 按比例扣减持仓成本
                                    if (oldShares > 0 && (item.positionCost || 0) > 0) {
                                        item.positionCost = round2(Math.max(0, (item.positionCost || 0) - round2((soldShares / oldShares) * (item.positionCost || 0))));
                                    }
                                    // 赎回手续费：按卖出金额扣减，计入累计收益（成本）
                                    const fee = round2(soldShares * price * ((adj.feeRate || 0) / 100));
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
                                // 现金分红是真实收益，持仓成本相应回收（保证持仓累计收益与累计收益在未减仓时一致）
                                if (adj.dividendAmount > 0) {
                                    item.positionCost = round2(Math.max(0, (item.positionCost || 0) - adj.dividendAmount));
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

                const hasExplicitEstimate = typeof live.rate === 'number' && Number.isFinite(live.rate);
                if (!live.isFallback && live.price > 0 && (hasExplicitEstimate || live.isPenetration)) {
                    // 交易时段 / 有估值涨跌率：用估值与昨日净值的差计算当日浮动
                    const priceDiff = live.price - live.prevPrice;
                    todayProfit = item.shares ? round2(item.shares * priceDiff) : 0;
                } else if (!live.isFallback && live.price > 0 && !hasExplicitEstimate && !live.isPenetration) {
                    // 官方无盘中估值、且未穿透估值
                    todayProfit = null;
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
                const displayYesterdayProfit = getDisplayedYesterdayProfit(
                    { ...item, code },
                    live,
                    nextDailyProfitHistory
                );
                const displayYesterdayRate = calculateDisplayedYesterdayRate({
                    shares: item.shares || 0,
                    prevTradingDayPrice: live.prevTradingDayPrice || 0,
                    yesterdayProfit: displayYesterdayProfit,
                    prevPrice: live.prevPrice || 0,
                    acNetValue: live.acNetValue,
                    prevAcNetValue: live.prevAcNetValue
                });
                const yesterdayNavRate = live.prevPrice > 0 && live.prevTradingDayPrice > 0
                    ? round2((live.prevPrice - live.prevTradingDayPrice) / live.prevTradingDayPrice * 100)
                    : 0;
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

                const codeTradeOrders = tradeOrdersMap.get(code) || [];
                const totalInvestedCost = calculateTotalInvestedCostFromOrders(codeTradeOrders);
                results[resultIndex] = {
                    code,
                    name: live.name,
                    amount: displayAmount,
                    yesterdayProfit: displayYesterdayProfit,
                    yesterdayRate: displayYesterdayRate,
                    yesterdayNavRate,
                    group: item.group || '默认',
                    rate: live.rate,
                    prevPrice: live.prevPrice || 0,
                    price: live.price || 0,
                    prevPriceDate: live.prevPriceDate || '',
                    priceTime: live.priceTime || '',
                    todayProfit,
                    totalProfit,
                    holdProfit: item.holdProfit || 0,
                    positionCost: item.positionCost || 0,
                    // 与持仓列同用 displayAmount（含待确认分红）口径：
                    // 除息后 item.amount 已随净值下降，而 positionCost 要等分红确认才扣减，
                    // 用裸 amount 会在分红待确认窗口低估持仓收益；
                    // 无建仓订单时成本为兜底值（=amount），该指标无意义，置 0 并由渲染层显示占位符
                    positionProfit: hasConfirmedBuildingOrders
                        ? round2(displayAmount - (item.positionCost || 0))
                        : 0,
                    positionCostReliable: hasConfirmedBuildingOrders,
                    shares: item.shares || 0,
                    totalInvestedCost,
                    useFallbackNav,
                    acNetValue: live.acNetValue || null,
                    prevTradingDayPrice: live.prevTradingDayPrice || 0,
                    prevTradingDayDate: live.prevTradingDayDate || '',
                    pendingAdjustments,
                    pendingDividendAmount,  // 用于调试和显示
                    hasPendingDividendForDisplay,
                    hasPendingBuy,
                    hasPendingSell,
                    isPenetration: live.isPenetration || false,
                    penetrationType: live.penetrationType || '',
                    penetrationDetails: live.penetrationDetails || [],
                    penetrationWeight: live.penetrationWeight || 0
                };
            }
        }));
        ctx.dataChanged = dataChanged;
        allFundsData = results.filter(Boolean);
}

// 阶段6：记录实时走势点（每次刷新追加一个时间点到 fundHistoryData）
function _phaseRecordIntradayPoints(ctx) {
        const { todayStr } = ctx;
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
}

// 阶段7：持久化变更 + 合并弹交易确认通知
async function _phasePersistAndNotify(ctx) {
        const { funds, results, lastDayProfits, confirmedTransactions, nextDailyProfitHistory, dailyProfitHistoryChanged, dataChanged } = ctx;
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
}

// 阶段8：渲染 + 后台任务（区间涨跌幅、历史缺口同步）
async function _phaseRenderAndBackground(ctx) {
        const { funds, todayStr } = ctx;
        updateGroupFilter();
        await hydrateFundPerfCache(funds, allFundsData.map(item => item.code), ctx.tradeOrdersMap);
        renderTable();
        lastUpdateTime = new Date().toLocaleTimeString();
        elements.statusText.innerText = `最后更新: ${lastUpdateTime}`;

        // 后台静默拉取区间涨跌幅（不阻塞主流程）
        fetchAllFundPerfData(funds);
        // 启动后台历史数据同步与补全：每天仅首次刷新执行，避免每次刷新都重新读取
        if (window.__lastHistorySyncDate !== todayStr) {
            setTimeout(async () => {
                const stored = await storageHelper.get('lastHistorySyncDate', '');
                if (stored === todayStr) { window.__lastHistorySyncDate = todayStr; return; }
                try {
                    await checkAndFillHistoryGaps(funds);
                    await storageHelper.set('lastHistorySyncDate', todayStr);
                    window.__lastHistorySyncDate = todayStr;
                } catch (err) {
                    console.warn('[history-sync] 同步失败，下次刷新重试:', err);
                }
            }, 2000);
        }
}

async function enrichLiveDataWithLocalNavHistory(fetchedData) {
    if (!Array.isArray(fetchedData) || fetchedData.length === 0 || typeof HistoryDB === 'undefined') {
        return fetchedData;
    }

    const enriched = await Promise.all(fetchedData.map(async entry => {
        const code = entry?.code;
        const live = entry?.live;
        if (!code || !live) return entry;

        let prevPriceDate = normalizePerfDate(live.prevPriceDate || '');
        if (!prevPriceDate) {
            const latestLocal = await HistoryDB.getLatest(code).catch(() => null);
            if (latestLocal?.date) {
                prevPriceDate = normalizePerfDate(latestLocal.date);
            }
        }
        if (!prevPriceDate) return entry;

        try {
            const records = await HistoryDB.getRange(code, '', prevPriceDate);
            const validRecords = safeArray(records)
                .filter(record => record?.date && Number(record.price) > 0 && record.date <= prevPriceDate)
                .sort((a, b) => a.date.localeCompare(b.date));
            if (validRecords.length === 0) return entry;

            const latest = validRecords[validRecords.length - 1];
            const previous = validRecords.length > 1 ? validRecords[validRecords.length - 2] : latest;
            const prevTradingDayPrice = Number(previous.price) || 0;

            const updatedLive = {
                ...live,
                prevPrice: Number(live.prevPrice) > 0 ? live.prevPrice : Number(latest.price),
                prevPriceDate: live.prevPriceDate || latest.date,
                prevTradingDayPrice: Number(live.prevTradingDayPrice) > 0 ? live.prevTradingDayPrice : prevTradingDayPrice,
                prevTradingDayDate: live.prevTradingDayDate || previous.date,
                prevAcNetValue: Number(live.prevAcNetValue) > 0 ? live.prevAcNetValue : (Number(previous.acPrice) > 0 ? Number(previous.acPrice) : null)
            };
            if (!(Number(updatedLive.price) > 0) && Number(updatedLive.prevPrice) > 0) {
                updatedLive.price = updatedLive.prevPrice;
            }
            return {
                ...entry,
                live: updatedLive
            };
        } catch (error) {
            console.debug('[history-db] 本地净值补全失败:', code, error.message);
            return entry;
        }
    }));

    return enriched;
}
