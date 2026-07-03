async function getSelectedFunds() {
    const { myFunds } = await storageHelper.getAll(['myFunds']);
    const funds = myFunds || {};
    const codes = [...selectedCodes].filter(c => funds[c]);
    return { funds, codes };
}

async function askBatchConfirmation(action, count, details = '', danger = false) {
    return showConfirm(
        `确认${action}选中的 ${count} 项吗？${details}`,
        `${action}确认`,
        danger
    );
}

async function batchRecalculateShares() {
    if (!ensureBatchSelection()) return;
    if (!await askBatchConfirmation('重算份额', selectedCodes.size)) return;

    const { funds, codes } = await getSelectedFunds();

    const results = await fetchBatchLiveInfo(codes, 8000, null);
    let count = 0;
    for (const { code, live } of results) {
        if (live && live.prevPrice > 0) {
            funds[code].shares = deriveFundShares(funds[code], live.prevPrice);
            syncAddedDateByPosition(funds[code], getToday());
            count++;
        }
    }
    await storageHelper.setAll({ myFunds: funds });
    showToast(`✅ 已重算 ${count} 支基金份额`, 'success');
    loadData();
}

async function batchChangeGroup() {
    if (!ensureBatchSelection()) return;

    const { funds, codes } = await getSelectedFunds();
    if (codes.length === 0) {
        showToast('⚠️ 选中的基金未找到', 'warning');
        return;
    }

    const groupSet = new Set();
    const fundList = codes.map(code => {
        const f = funds[code];
        const g = f.group || '默认';
        groupSet.add(g);
        return { code, name: f.name || code, group: g };
    });
    const currentGroupsLabel = [...groupSet].map(g => `[${g}]`).join(' / ');

    const result = await new Promise(resolve => {
        const onCancel = createResolveAndCloseHandler(resolve, null);
        _openModal('批量修改分组', '', false, '', onCancel);
        elements.modalOverlay.dataset.mode = 'form';

        const previewLimit = 8;
        const fundRows = fundList.slice(0, previewLimit).map(f =>
            `<li>[${escapeHtml(f.code)}] ${escapeHtml(f.name)} <span class="modal-fund-meta">· ${escapeHtml(f.group)}</span></li>`
        ).join('');
        const moreRow = fundList.length > previewLimit
            ? `<li class="modal-fund-meta">… 等共 ${fundList.length} 支</li>`
            : '';

        elements.modalMsg.innerHTML = `
            <div class="form-header-sub">将 <b>${codes.length}</b> 支基金（当前分组：${escapeHtml(currentGroupsLabel)}）调整到新分组。</div>
            <div class="form-modal">
                <div class="form-group">
                    <label for="changeGroupInput">新分组名称（留空 = 默认）</label>
                    <input type="text" id="changeGroupInput" placeholder="例如：微众组">
                </div>
                <details class="modal-collapse">
                    <summary>影响列表（${fundList.length} 支）</summary>
                    <ul class="modal-fund-list">${fundRows}${moreRow}</ul>
                </details>
                <div class="modal-callout modal-callout--warning">
                    <div class="modal-callout-title">可选清理（适用于「演练 / 试错数据 → 真实组」迁移）</div>
                    <label class="modal-option">
                        <input type="checkbox" id="changeGroupClearPos">
                        <span>同时清空 <b>持仓金额、份额、待确认交易</b></span>
                    </label>
                    <label class="modal-option">
                        <input type="checkbox" id="changeGroupClearOrders">
                        <span>同时删除 <b>所有订单与状态记录</b>（不可恢复）</span>
                    </label>
                    <label class="modal-option">
                        <input type="checkbox" id="changeGroupClearProfit">
                        <span>同时清零 <b>累计收益与昨日收益</b></span>
                    </label>
                </div>
            </div>
        `;

        const input = document.getElementById('changeGroupInput');
        const onOk = () => {
            const newGroup = (input.value || '').trim() || '默认';
            const clearPos = document.getElementById('changeGroupClearPos').checked;
            const clearOrders = document.getElementById('changeGroupClearOrders').checked;
            const clearProfit = document.getElementById('changeGroupClearProfit').checked;
            resolveAndCloseModal(resolve, { newGroup, clearPos, clearOrders, clearProfit });
        };
        input.focus();
        input.onkeydown = (e) => { if (e.key === 'Enter') onOk(); };

        setCancelConfirmFooter(onCancel, onOk, false, '确认修改');
    });

    if (!result) return;

    const { newGroup, clearPos, clearOrders, clearProfit } = result;
    let posCleared = 0, ordersCleared = 0, profitCleared = 0;

    for (const code of codes) {
        const fund = funds[code];
        if (!fund) continue;
        fund.group = newGroup;
        if (clearPos) {
            fund.amount = 0;
            fund.shares = 0;
            fund.lastClosedAmount = 0;
            fund.pendingAdjustments = [];
            posCleared++;
        }
        if (clearProfit) {
            fund.holdProfit = 0;
            fund.yesterdayProfit = 0;
            profitCleared++;
        }
        if (clearOrders) {
            await HistoryDB.deleteOrdersByCode(code).catch(() => {});
            await HistoryDB.deleteStateRecordsByCode(code).catch(() => {});
            ordersCleared++;
        }
    }

    if (clearPos || clearOrders) {
        removeFundsFromHistory(codes);
    }

    await storageHelper.setAll({ myFunds: funds });

    const parts = [];
    if (posCleared) parts.push(`清空持仓 ${posCleared} 支`);
    if (profitCleared) parts.push(`清零收益 ${profitCleared} 支`);
    if (ordersCleared) parts.push(`删订单 ${ordersCleared} 支`);
    const detail = parts.length ? `（${parts.join('，')}）` : '';
    showToast(`📁 已将 ${codes.length} 支基金归类至 [${newGroup}]${detail}`, 'success');
    loadData();
}

async function batchBackfillHistoricalDividends() {
    if (!ensureBatchSelection()) return;
    if (!await askBatchConfirmation('补录历史分红', selectedCodes.size, '\n将按当前建仓日期，补录选中基金从建仓至今缺失的分红订单。')) return;

    const { funds, codes } = await getSelectedFunds();
    if (codes.length === 0) {
        showToast('⚠️ 未找到可补录的基金', 'warning');
        return;
    }

    elements.statusText.innerText = '正在补录历史分红...';

    let successCount = 0;
    let changedCount = 0;

    for (const code of codes) {
        const fund = funds[code];
        if (!fund?.addedDate) continue;
        try {
            const existingOrders = await HistoryDB.getOrders(code).catch(() => []);
            const changed = await backfillHistoricalDividendOrdersForFund(code, fund, getToday(), existingOrders);
            successCount++;
            if (changed) changedCount++;
        } catch (error) {
            console.warn(`[DividendBackfill] ${code} 批量补录失败:`, error);
        }
    }

    elements.statusText.innerText = '准备就绪';
    showToast(`✅ 历史分红补录完成：处理 ${successCount} 支，更新 ${changedCount} 支`, 'success');
    loadData();
}

async function rebuildDailyProfitHistory() {
    const ok = await showConfirm(
        '确定要清空现有收益历史并按当前订单库、净值库全量重算吗？\n\n这会重建收益日历和历史日状态，不会改动订单记录。',
        '重算收益历史确认',
        true
    );
    if (!ok) return;

    try {
        elements.statusText.innerText = '正在重算历史收益...';
        if (typeof _loadDataPromise !== 'undefined' && _loadDataPromise) {
            await _loadDataPromise.catch(() => null);
        }

        const { myFunds } = await storageHelper.getAll(['myFunds']);
        const funds = myFunds || {};
        const codes = Object.keys(funds);
        if (codes.length === 0) {
            showToast('⚠️ 当前没有基金可重算', 'warning');
            elements.statusText.innerText = '准备就绪';
            return;
        }

        await Promise.all(codes.map(code => HistoryDB.deleteStateRecordsByCode(code).catch(() => {})));
        const { history: nextDailyProfitHistory } = await backfillMissingDailyProfitHistory({}, funds);
        const normalizedNextHistory = normalizeDailyProfitHistory(nextDailyProfitHistory);

        await storageHelper.setAll({
            dailyProfitHistory: normalizedNextHistory
        });

        let persistedHistory = (await storageHelper.getAll(['dailyProfitHistory'])).dailyProfitHistory || {};
        if (typeof areDailyProfitHistoriesEqual === 'function' && !areDailyProfitHistoriesEqual(persistedHistory, normalizedNextHistory)) {
            await storageHelper.setAll({
                dailyProfitHistory: normalizedNextHistory
            });
            persistedHistory = (await storageHelper.getAll(['dailyProfitHistory'])).dailyProfitHistory || {};
        }

        if (typeof areDailyProfitHistoriesEqual === 'function' && !areDailyProfitHistoriesEqual(persistedHistory, normalizedNextHistory)) {
            throw new Error(`收益历史写回校验失败：预期 ${Object.keys(normalizedNextHistory).length} 天，实际 ${Object.keys(normalizeDailyProfitHistory(persistedHistory)).length} 天`);
        }

        const shouldRefreshProfitCalendar = elements.modalOverlay?.dataset.mode === 'profit-calendar';
        elements.statusText.innerText = '准备就绪';
        showToast(`✅ 已重算 ${codes.length} 支基金的历史收益`, 'success');
        loadData({ skipLiveRequests: true });
        if (shouldRefreshProfitCalendar && typeof openProfitCalendar === 'function') {
            await openProfitCalendar();
        }
    } catch (error) {
        console.error('重算历史收益失败:', error);
        elements.statusText.innerText = '准备就绪';
        showAlert(`重算历史收益失败: ${error.message}`);
    }
}

async function inspectTradeExecutionOrders() {
    try {
        elements.statusText.innerText = '正在体检订单...';
        const { orders } = await HistoryDB.getAllExportData();
        const normalizedOrders = safeArray(orders, []).map(order => normalizeTradeRecord(order, { source: 'order' }));
        const candidates = normalizedOrders.filter(order => {
            const displayType = getTradeDisplayType(order);
            const orderDate = normalizePerfDate(order.orderDate || order.date || '');
            const effectiveDate = normalizePerfDate(order.effectiveDate || order.orderEffectiveDate || '');
            const confirmedDate = normalizePerfDate(order.confirmedDate || '');
            const orderNav = safeFloat(order.orderNav, 0);
            const recordedNav = safeFloat(order.confirmedPrice || order.price, 0);
            const hasCrossDayExecution = effectiveDate && confirmedDate && effectiveDate !== confirmedDate;
            const hasSuspiciousNavGap = orderDate
                && confirmedDate
                && orderDate !== confirmedDate
                && orderNav > 0
                && recordedNav > 0
                && Math.abs(orderNav - recordedNav) > 0.0001;
            return ['add', 'remove', 'clear'].includes(displayType)
                && order.status === 'confirmed'
                && (hasCrossDayExecution || hasSuspiciousNavGap);
        });

        if (candidates.length === 0) {
            elements.statusText.innerText = '准备就绪';
            await showAlert('未发现“成交日与确认日不同”的已确认订单。', '订单体检');
            return;
        }

        const findings = [];
        for (const order of candidates) {
            const displayType = getTradeDisplayType(order);
            const orderDate = normalizePerfDate(order.orderDate || order.date || '');
            const effectiveDate = normalizePerfDate(order.effectiveDate || order.orderEffectiveDate || '');
            const confirmedDate = normalizePerfDate(order.confirmedDate || '');
            const orderNav = safeFloat(order.orderNav, 0);
            const recordedNav = safeFloat(order.confirmedPrice || order.price || order.orderNav, 0);
            const hasSuspiciousNavGap = orderDate
                && confirmedDate
                && orderDate !== confirmedDate
                && orderNav > 0
                && recordedNav > 0
                && Math.abs(orderNav - recordedNav) > 0.0001;
            const executionDate = (hasSuspiciousNavGap && (!effectiveDate || effectiveDate === confirmedDate))
                ? orderDate
                : normalizePerfDate(effectiveDate || orderDate || '');
            const executionRecord = executionDate
                ? await HistoryDB.get(order.code, executionDate).catch(() => null)
                : null;
            const executionNav = safeFloat(executionRecord?.price, 0) || (hasSuspiciousNavGap ? orderNav : 0);
            const feeRate = safeFloat(order.feeRate, 0) / 100;
            let expectedShares = 0;
            let expectedAmount = 0;
            let mismatch = false;
            let reason = '';

            if (displayType === 'add' && executionNav > 0 && safeFloat(order.amount, 0) > 0) {
                expectedShares = roundShares((safeFloat(order.amount, 0) * (1 - feeRate)) / executionNav);
                mismatch = Math.abs(expectedShares - roundShares(safeFloat(order.confirmedShares, 0))) > 0.001
                    || Math.abs(executionNav - recordedNav) > 0.0001;
            } else if ((displayType === 'remove' || displayType === 'clear') && executionNav > 0 && safeFloat(order.shares, 0) > 0) {
                expectedAmount = round2(safeFloat(order.shares, 0) * executionNav);
                mismatch = Math.abs(expectedAmount - safeFloat(order.amount, 0)) > 0.01
                    || Math.abs(executionNav - recordedNav) > 0.0001;
            }
            if (hasSuspiciousNavGap) {
                reason = '订单日净值与确认净值不一致，疑似生效日被覆盖';
            } else if (effectiveDate && confirmedDate && effectiveDate !== confirmedDate) {
                reason = '跨确认日订单';
            }

            findings.push({
                id: order.id || order.orderId,
                code: order.code,
                type: displayType,
                orderDate,
                executionDate,
                confirmedDate,
                executionNav,
                recordedNav,
                orderNav,
                expectedShares,
                expectedAmount,
                confirmedShares: safeFloat(order.confirmedShares, 0),
                amount: safeFloat(order.amount, 0),
                canJudge: executionNav > 0,
                mismatch,
                reason
            });
        }

        const mismatchList = findings.filter(item => item.canJudge && item.mismatch);
        const missingNavList = findings.filter(item => !item.canJudge);
        const normalList = findings.filter(item => item.canJudge && !item.mismatch);

        const renderItems = (list, mode) => {
            if (!list.length) return '<div class="notification-empty">无</div>';
            return list.map(item => {
                const typeLabel = item.type === 'add' ? '加仓' : (item.type === 'clear' ? '清仓' : '减仓');
                const typeClass = item.type === 'add' ? 'add' : 'remove';
                const detail = item.type === 'add'
                    ? `记录份额 ${item.confirmedShares} / 理论份额 ${item.expectedShares}`
                    : `记录金额 ¥${item.amount} / 理论金额 ¥${item.expectedAmount}`;
                const navText = item.canJudge
                    ? `记录净值 ${item.recordedNav} / 生效日净值 ${item.executionNav}`
                    : '本地净值库缺少生效日净值';
                const statusBadge = mode === 'bad'
                    ? `<span class="tx-badge pending">需修正</span>`
                    : mode === 'warn'
                        ? `<span class="tx-badge pending">待判断</span>`
                        : `<span class="tx-badge confirmed">已正常</span>`;
                const dateText = `下单日 ${item.orderDate || '无'} · 生效日 ${item.executionDate || '无'} · 确认日 ${item.confirmedDate}`;
                return `
                    <div class="tx-item">
                        <div class="tx-row-main">
                            <div class="tx-row-left">
                                <span class="tx-type ${typeClass}">${escapeHtml(typeLabel)}</span>
                                ${statusBadge}
                                <span class="tx-amount">${escapeHtml(item.code)}</span>
                            </div>
                        </div>
                        ${item.reason ? `<div class="tx-nav" style="color:#ffd591;">${escapeHtml(item.reason)}</div>` : ''}
                        <div class="tx-nav">${escapeHtml(navText)}</div>
                        ${item.canJudge ? `<div class="tx-nav" style="color:#d6e4ff;">${escapeHtml(detail)}</div>` : ''}
                        <div class="tx-date">${escapeHtml(dateText)}</div>
                    </div>
                `;
            }).join('');
        };

        const html = `
            <div class="tx-nav" style="margin-bottom:8px;">
                共扫描 ${findings.length} 条跨确认日订单，其中异常 ${mismatchList.length} 条，正常 ${normalList.length} 条，缺净值 ${missingNavList.length} 条。
            </div>
            <div class="tx-list" style="max-height:240px;margin:0;">
                <div class="tx-type add" style="margin:2px 0 6px;">需修正</div>
                ${renderItems(mismatchList, 'bad')}
                <div class="tx-type remove" style="color:#8aacce;margin:12px 0 6px;">已正常 ${normalList.length} 条</div>
                <div class="tx-type dividend" style="margin:12px 0 6px;">缺净值无法判断</div>
                ${missingNavList.length > 0 ? renderItems(missingNavList, 'warn') : '<div class="notification-empty" style="padding:12px 0 4px;">无</div>'}
            </div>
        `;

        elements.statusText.innerText = '准备就绪';
        showHtmlModal('订单体检', html, [
            { text: '关闭', cls: 'modal-btn-cancel', onClick: _closeModal },
            {
                text: `一键修复 ${mismatchList.length} 条`,
                cls: mismatchList.length > 0 ? 'modal-btn-ok' : 'modal-btn-cancel',
                onClick: async () => {
                    if (mismatchList.length === 0) {
                        _closeModal();
                        return;
                    }
                    elements.statusText.innerText = '正在修复订单...';
                    let fixedCount = 0;
                    for (const item of mismatchList) {
                        if (!item.id || !(item.executionNav > 0)) continue;
                        const patch = {
                            effectiveDate: item.executionDate || '',
                            orderNav: item.executionNav,
                            confirmedPrice: item.executionNav,
                            price: item.executionNav
                        };
                        if (item.type === 'add') {
                            patch.confirmedShares = item.expectedShares;
                        } else {
                            patch.amount = item.expectedAmount;
                            patch.confirmedShares = safeFloat(item.confirmedShares, 0) > 0 ? item.confirmedShares : 0;
                        }
                        await HistoryDB.updateOrder(item.id, patch).catch(() => null);
                        fixedCount++;
                    }
                    elements.statusText.innerText = '准备就绪';
                    _closeModal();
                    showToast(`✅ 已修复 ${fixedCount} 条订单`, 'success');
                    loadData();
                }
            }
        ]);
        const modalBox = elements.modalOverlay?.querySelector('.modal-box');
        if (modalBox) {
            modalBox.style.maxWidth = '500px';
            modalBox.style.maxHeight = 'calc(100vh - 32px)';
            modalBox.style.padding = '14px 14px 10px';
            modalBox.style.overflowY = 'auto';
        }
    } catch (error) {
        console.error('订单体检失败:', error);
        elements.statusText.innerText = '准备就绪';
        showAlert(`订单体检失败: ${error.message}`);
    }
}

async function clearPositions(codes) {
    const codeList = Array.isArray(codes) ? codes : [codes];
    if (codeList.length === 0) {
        notifySelectFundsFirst();
        return;
    }

    const isBatch = codeList.length > 1;
    const title = isBatch ? '批量清空确认' : '清空持仓确认';
    const desc = isBatch
        ? `确认要清空选中 <b>${codeList.length}</b> 支基金的持仓和份额吗？`
        : `确定要清空基金 <b>[${escapeHtml(codeList[0])}]</b> 的持仓吗？`;
    const options = await new Promise(resolve => {
        const onCancel = createResolveAndCloseHandler(resolve, false);
        _openModal(title, '', false, '', onCancel);
        elements.modalOverlay.dataset.mode = 'form';
        elements.modalMsg.innerHTML = `
            <div class="form-header-sub">${desc}</div>
            <div class="form-modal">
                <div class="modal-callout modal-callout--warning">
                    <div class="modal-callout-title">将执行的操作</div>
                    <ul class="modal-callout-list">
                        <li>清空持仓金额、份额、待确认交易</li>
                        <li>保留累计收益（holdProfit）与历史订单</li>
                        <li>下方选项可一并写入清仓订单 / 切换分组</li>
                    </ul>
                </div>
                <label class="modal-option">
                    <input type="checkbox" id="clearWriteOrderChk" checked>
                    <span>同时为每支基金写入一条已确认清仓订单</span>
                </label>
                <label class="modal-option">
                    <input type="checkbox" id="clearGroupChk" checked>
                    <span>同时将分组变更为“已撤回”</span>
                </label>
            </div>
        `;

        setCancelConfirmFooter(onCancel, () => {
            const shouldResetGroup = document.getElementById('clearGroupChk').checked;
            const shouldWriteOrder = document.getElementById('clearWriteOrderChk').checked;
            resolveAndCloseModal(resolve, {
                shouldResetGroup,
                shouldWriteOrder
            });
        }, true);
    });

    if (!options) return;

    const { myFunds } = await storageHelper.getAll(['myFunds']);
    const funds = myFunds || {};
    const liveResults = options.shouldWriteOrder
        ? await fetchBatchLiveInfo(codeList, 8000, null).catch(() => [])
        : [];
    const liveMap = new Map(safeArray(liveResults, []).map(item => [item.code, item.live]));

    for (const code of codeList) {
        const fund = funds[code];
        if (!fund) continue;

        const shares = roundShares(safeFloat(fund.shares, 0));
        const amount = safeFloat(fund.amount, 0);
        const hasPosition = shares > 0 || amount > 0;
        
        // 写入已确认清仓订单
        if (options.shouldWriteOrder && hasPosition) {
            const live = liveMap.get(code) || null;
            const navPrice = safeFloat(live?.prevPrice, 0) || safeFloat(fund.savedPrevPrice, 0);
            const clearDate = normalizePerfDate(live?.prevPriceDate || fund.savedPrevDate || getToday()) || getToday();
            await HistoryDB.addOrder({
                code,
                name: fund.name || live?.name || code,
                group: fund.group || '默认',
                type: 'remove',
                date: clearDate,
                orderDate: clearDate,
                targetDate: clearDate,
                confirmedDate: clearDate,
                effectiveDate: clearDate,
                shares,
                confirmedShares: shares,
                amount: navPrice > 0 ? round2(shares * navPrice) : round2(amount),
                confirmedPrice: navPrice,
                orderNav: navPrice,
                feeRate: 0,
                fee: 0,
                isClear: true,
                status: 'confirmed',
                source: 'manual_clear',
                remark: isBatch ? '批量清仓' : '手动清仓'
            }).catch(() => {});
        }

        // 清空待确认的交易记录
        fund.pendingAdjustments = [];
        resetFundPosition(fund, options.shouldResetGroup);
    }
    await storageHelper.setAll({ myFunds: funds });
    const msg = options.shouldWriteOrder
        ? (isBatch ? `🧹 已清仓 ${codeList.length} 支基金，并写入订单` : `✅ ${codeList[0]} 已清仓并写入订单`)
        : (isBatch ? `🧹 已清空 ${codeList.length} 支基金持仓` : `✅ ${codeList[0]} 持仓已清空`);
    showToast(msg, 'success');
    loadData();
}

async function batchClearPositions() {
    if (!ensureBatchSelection()) return;
    await clearPositions([...selectedCodes]);
}

async function batchDeleteFunds() {
    if (!ensureBatchSelection()) return;

    const { funds, codes } = await getSelectedFunds();
    if (codes.length === 0) {
        showToast('⚠️ 选中的基金未找到', 'warning');
        return;
    }

    const previewMax = 8;
    const previewItems = codes.slice(0, previewMax).map(code => {
        const f = funds[code];
        const name = escapeHtml(f.name || code);
        const group = escapeHtml(f.group || '默认');
        return `<li>[${escapeHtml(code)}] ${name} <span class="modal-fund-meta">· ${group}</span></li>`;
    }).join('');
    const overflow = codes.length > previewMax
        ? `<li class="modal-fund-meta">… 等共 ${codes.length} 支</li>`
        : '';

    const confirmed = await new Promise(resolve => {
        const onCancel = createResolveAndCloseHandler(resolve, false);
        _openModal('批量删除确认', '', false, '', onCancel);
        elements.modalOverlay.dataset.mode = 'form';
        elements.modalMsg.innerHTML = `
            <div class="form-header-sub">⚠️ 即将彻底删除选中的 <b>${codes.length}</b> 支基金，操作不可恢复！</div>
            <div class="form-modal">
                <div class="modal-callout modal-callout--danger">
                    <div class="modal-callout-title">将永久清除以下数据</div>
                    <ul class="modal-callout-list">
                        <li>基金配置（名称 / 分组 / 分红方式等）</li>
                        <li>持仓金额、份额、待确认交易</li>
                        <li>累计收益与昨日收益</li>
                        <li>全部交易订单记录</li>
                        <li>历史净值快照与状态记录</li>
                        <li>日内走势与收益日历缓存</li>
                    </ul>
                </div>
                <details class="modal-collapse">
                    <summary>查看待删除基金（${codes.length}）</summary>
                    <ul class="modal-fund-list">${previewItems}${overflow}</ul>
                </details>
            </div>
        `;
        const onOk = () => resolveAndCloseModal(resolve, true);
        setCancelConfirmFooter(onCancel, onOk, true, '确认删除');
    });

    if (!confirmed) return;
    await deleteFunds(codes);
    showToast(`🗑 已删除 ${codes.length} 支基金`, 'success');
    loadData();
}

