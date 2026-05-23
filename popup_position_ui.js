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

    const { myFunds } = await storageHelper.getAll(['myFunds']);
    const funds = myFunds || {};
    const codes = [...selectedCodes].filter(c => funds[c]);

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

    const { myFunds } = await storageHelper.getAll(['myFunds']);
    const funds = myFunds || {};
    const codes = [...selectedCodes].filter(c => funds[c]);
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

    const { myFunds } = await storageHelper.getAll(['myFunds']);
    const funds = myFunds || {};
    const codes = [...selectedCodes].filter(code => funds[code]);
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

        const emptyHistory = {};
        await Promise.all(codes.map(code => HistoryDB.deleteStateRecordsByCode(code).catch(() => {})));
        const { history: nextDailyProfitHistory } = await backfillMissingDailyProfitHistory(emptyHistory, funds);
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
                expectedShares = round6((safeFloat(order.amount, 0) * (1 - feeRate)) / executionNav);
                mismatch = Math.abs(expectedShares - safeFloat(order.confirmedShares, 0)) > 0.0001
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

        const shares = safeFloat(fund.shares, 0);
        const amount = safeFloat(fund.amount, 0);
        const hasPosition = shares > 0 || amount > 0;
        if (options.shouldWriteOrder && hasPosition) {
            const live = liveMap.get(code) || null;
            const navPrice = safeFloat(live?.prevPrice, 0) || safeFloat(fund.savedPrevPrice, 0);
            const clearDate = normalizePerfDate(live?.prevPriceDate || fund.savedPrevDate || getToday()) || getToday();
            const orderPayload = {
                code,
                name: fund.name || live?.name || code,
                group: fund.group || '默认',
                type: 'remove',
                date: clearDate,
                orderDate: clearDate,
                targetDate: clearDate,
                confirmedDate: clearDate,
                effectiveDate: clearDate,
                shares: shares,
                confirmedShares: shares,
                amount: navPrice > 0 ? round2(shares * navPrice) : round2(amount),
                confirmedPrice: navPrice,
                orderNav: navPrice,
                feeRate: 0,
                fee: 0,
                isClear: true,
                status: 'confirmed',
                source: 'manual_clear',
                remark: '批量清仓'
            };
            await persistTradeOrder(orderPayload, orderPayload);
        }

        resetFundPosition(fund, options.shouldResetGroup);
        if (options.shouldWriteOrder) {
            await syncFundAddedDateFromTradeOrders(code);
        }
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

    const { myFunds } = await storageHelper.getAll(['myFunds']);
    const funds = myFunds || {};
    const codes = [...selectedCodes].filter(c => funds[c]);
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

function initFabMenu() {
    const fabMain = document.getElementById('fabMain');
    const fabMenu = document.getElementById('fabMenu');
    if (!fabMain) return;

    const closeAllFabGroups = () => {
        fabMenu.querySelectorAll('.fab-group.open').forEach(g => g.classList.remove('open'));
        fabMenu.querySelectorAll('.fab-group-header.open').forEach(h => h.classList.remove('open'));
    };

    const closeFabMenu = () => {
        fabMain.classList.remove('active');
        fabMenu.classList.remove('show');
        closeAllFabGroups();
    };

    const toggleFabMenu = () => {
        const willOpen = !fabMenu.classList.contains('show');
        fabMain.classList.toggle('active', willOpen);
        fabMenu.classList.toggle('show', willOpen);
        if (!willOpen) closeAllFabGroups();
    };

    fabMain.onclick = (e) => {
        e.stopPropagation();
        toggleFabMenu();
    };

    fabMenu.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    fabMenu.querySelectorAll('.fab-group').forEach(group => {
        const header = group.querySelector('.fab-group-header');
        if (!header) return;
        header.onclick = (e) => {
            e.stopPropagation();
            const isOpen = group.classList.contains('open');
            closeAllFabGroups();
            if (!isOpen) {
                group.classList.add('open');
                header.classList.add('open');
            }
        };
    });

    document.addEventListener('click', () => {
        closeFabMenu();
    });

    const bind = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.onclick = (e) => {
            e.stopPropagation();
            fn();
            closeFabMenu();
        };
    };

    bind('fabSelectAll', () => {
        const visible = allFundsData.filter(i => groupFilterController.matches(i));
        const allSelected = visible.every(i => selectedCodes.has(i.code));
        visible.forEach(i => allSelected ? selectedCodes.delete(i.code) : selectedCodes.add(i.code));
        renderTable();
    });
    bind('fabAdd', () => openFundEditor());
    bind('fabOCRBatch', openOCRBatchAdd);
    bind('fabBatchCalc', batchRecalculateShares);
    bind('fabBatchDividend', batchBackfillHistoricalDividends);
    bind('fabRebuildProfitHistory', rebuildDailyProfitHistory);
    bind('fabInspectOrders', inspectTradeExecutionOrders);
    bind('fabBatchGroup', batchChangeGroup);
    bind('fabBatchClear', batchClearPositions);
    bind('fabBatchDel', batchDeleteFunds);
    bind('fabSettlement', () => manualSettlement());
    bind('fabRollback', () => rollbackSettlement());
    bind('fabExport', exportFundsData);
    bind('fabExportBackup', exportBackupFundsData);
    bind('fabExportTradeCSV', exportTradeOrdersCSV);
    bind('fabImportTradeCSV', () => document.getElementById('importTradeCsvFile').click());
    bind('fabImport', () => document.getElementById('importFile').click());
}

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
    return round6((grossAmount * (1 - rate)) / price);
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
    return round6(netAmount / (price * (1 - rate)));
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

async function deriveAndValidateTradeInput(type, amount, shares, dividendAmount, navPrice, feeRate) {
    if ((type === 'add' || type === 'initial') && amount <= 0 && shares > 0 && navPrice > 0)
        amount = calculateGrossBuyAmountFromShares(shares, navPrice, feeRate);
    if ((type === 'add' || type === 'initial') && shares <= 0 && amount > 0 && navPrice > 0)
        shares = calculateNetBuyShares(amount, navPrice, feeRate);
    if ((type === 'remove' || type === 'clear') && amount <= 0 && shares > 0 && navPrice > 0)
        amount = calculateNetSellAmountFromShares(shares, navPrice, feeRate);
    if ((type === 'remove' || type === 'clear') && shares <= 0 && amount > 0 && navPrice > 0)
        shares = calculateSellSharesFromNetAmount(amount, navPrice, feeRate);
    if ((type === 'add' || type === 'initial') && amount <= 0) {
        await showAlert('建仓/加仓至少需要有效金额'); return null;
    }
    if ((type === 'remove' || type === 'clear') && shares <= 0) {
        await showAlert('减仓/清仓必须填写有效份额，金额仅用于按净值联动计算'); return null;
    }
    if (isDividendType(type) && dividendAmount <= 0) {
        await showAlert('分红金额不能为空'); return null;
    }
    if ((type === 'add' || type === 'initial') && shares <= 0 && !(navPrice > 0)) {
        await showAlert('建仓/加仓缺少份额时，必须提供有效净值用于反推'); return null;
    }
    if ((type === 'remove' || type === 'clear') && shares <= 0 && !(navPrice > 0)) {
        await showAlert('减仓/清仓缺少份额时，必须提供有效净值和费率用于反推'); return null;
    }
    return { amount, shares };
}

async function adjustPosition(code, type) {
    try {
        const { myFunds } = await storageHelper.getAll(['myFunds']);
        const funds = myFunds || {};
        const fundItem = funds[code];
        if (!fundItem) {
            await showAlert('未找到该标的数据！');
            return;
        }
        const live = await fetchLiveInfo(code);
        const defaultNav = live?.prevPrice || 1.0000;
        const isAdd = type === 'add';
        const isDividend = isDividendType(type);
        const title = isDividend ? '分红调整' : (isAdd ? '加仓设置' : '减仓设置');
        const now = new Date();
        const confirmDate = getConfirmDate(now);
        const { isWeekend: _isWeekend, isAfterCutoff: _isAfterCutoff } = getOrderTimingFlags(now);
        let useAfterCutoff = _isAfterCutoff;
        let effectiveDate = getTradeEffectiveDate(now, useAfterCutoff);
        let cancelableUntilDate = getTradeCancelableUntilDate(now, useAfterCutoff);
        let cancelableUntilLabel = getTradeCancelableUntilLabel(now, useAfterCutoff);
        const subTitle = isDividend
            ? `${live?.name || code} (#${code})　现金分红不改变份额`
            : buildTradeTimingSummary({
                name: live?.name || code,
                code,
                isWeekend: _isWeekend,
                isAfterCutoff: useAfterCutoff,
                effectiveDate,
                cancelableUntilLabel
            });
        let fields = [];
        if (isDividend) {
            fields = [
                { id: 'dividendAmount', label: '分红金额 (元)', type: 'number', placeholder: '请输入分红金额', value: '', min: 0, step: '0.01' },
                { id: 'confirmDate', label: '分红到账日期', type: 'date', value: confirmDate }
            ];
        } else if (isAdd) {
            fields = [
                { id: 'amount', label: '买入金额 (元)', type: 'number', placeholder: '请输入金额', value: '', min: 0 },
                { id: 'feeRate', label: '交易费率 (%)', type: 'number', placeholder: '0.15', value: '0', step: '0.01' },
                { id: 'confirmDate', label: '到账日期（可手动调整）', type: 'date', value: confirmDate },
                { id: 'estNav', type: 'hidden', value: defaultNav }
            ];
        } else {
            const maxShares = fundItem.shares || 0;
            fields = [
                {
                    id: 'shares',
                    label: '卖出份额',
                    type: 'number',
                    placeholder: `最多可卖 ${maxShares.toFixed(2)} 份`,
                    value: '',
                    min: 0,
                    step: '0.01',
                    showAll: true,
                    max: maxShares
                },
                { id: 'feeRate', label: '交易费率 (%)', type: 'number', placeholder: '0', value: '0', step: '0.01' },
                { id: 'confirmDate', label: '到账日期（可手动调整）', type: 'date', value: confirmDate }
            ];
        }

        const formModalPromise = showFormModal({
            title,
            subTitle,
            fields,
            actionText: '确认' + (isAdd ? '加仓' : '减仓'),
            layout: 'single',
            formClass: 'compact-trade-form'
        });

        setTimeout(() => {
            const confirmDateInput = document.getElementById('modal_field_confirmDate');
            if (!confirmDateInput) return;

            const dateGroup = confirmDateInput.closest('.form-group');
            if (!dateGroup) return;

            const switcher = document.createElement('div');
            switcher.className = 'timing-switcher';
            switcher.innerHTML = `
            <span>下单时间：</span>
                <label id="timingBefore" class="timing-btn">15:00前</label>
                <label id="timingAfter"  class="timing-btn">15:00后</label>
        `;
            dateGroup.parentNode.insertBefore(switcher, dateGroup);

            const btnBefore = document.getElementById('timingBefore');
            const btnAfter = document.getElementById('timingAfter');

            function applyStyle() {
                btnBefore.className = 'timing-btn' + (!useAfterCutoff ? ' active-before' : '');
                btnAfter.className = 'timing-btn' + (useAfterCutoff ? ' active-after' : '');
            }

            function recalcDate() {
                confirmDateInput.value = getConfirmDate(now, useAfterCutoff);
            }

            function setTimingMode(nextAfterCutoff) {
                useAfterCutoff = nextAfterCutoff;
                applyStyle();
                recalcDate();
            }

            applyStyle();
            btnBefore.addEventListener('click', () => setTimingMode(false));
            btnAfter.addEventListener('click', () => setTimingMode(true));
        }, 80);

        const result = await formModalPromise;
        if (!result) return;

        effectiveDate = getTradeEffectiveDate(now, useAfterCutoff);
        cancelableUntilDate = getTradeCancelableUntilDate(now, useAfterCutoff);

        const maxShares = fundItem.shares || 0;
        const isClear = !isAdd && !isDividend && result.shares && Math.abs(parseFloat(result.shares) - maxShares) < 0.0001;

        await HistoryDB.addOrder({
            code: code,
            name: fundItem.name || live?.name || code,
            group: fundItem.group || '默认',
            type: type,
            date: getToday(),
            orderDate: getToday(),
            effectiveDate: effectiveDate,
            targetDate: result.confirmDate,
            cancelableUntilDate,
            amount: result.amount || result.dividendAmount || 0,
            shares: result.shares || 0,
            feeRate: result.feeRate || 0,
            status: 'pending',
            isClear: isClear,
            createTime: Date.now(),
            remark: isDividend ? '分红记录' : (isAdd ? '加仓下单' : (isClear ? '清仓赎回' : '减仓下单'))
        });

        await storageHelper.setAll({ myFunds: funds });
        const actionName = isDividend ? '分红记录' : (isAdd ? '加仓' : '减仓');
        const amountInfo = isDividend ? `${result.dividendAmount}元`
            : isAdd ? `${result.amount}元`
                : `${result.shares}份`;
        showToast(`✅ ${code} ${actionName}已添加：${amountInfo}，将在 ${result.confirmDate} 确认`, 'success');
        loadData();
    } catch (e) {
        console.error(`${type} 仓操作失败: `, e);
        showAlert(`操作失败: ${e.message} `);
    }
}

async function backfillHistoricalTrade(code) {
    try {
        const { myFunds } = await storageHelper.getAll(['myFunds']);
        const funds = myFunds || {};
        const fundItem = funds[code];
        if (!fundItem) {
            await showAlert('未找到该标的数据！');
            return;
        }

        const result = await openHistoricalTradeForm({
            code,
            fundItem,
            title: '补录历史交易',
            subTitle: `${(await fetchLiveInfo(code))?.name || code} (#${code})　仅补录已完成历史交易，不改当前持仓`,
            actionText: '确认补录'
        });

        if (!result) return;

        const type = normalizeTradeAction(result.type);
        const tradeDate = normalizePerfDate(result.tradeDate || '');
        if (!type || !tradeDate) {
            await showAlert('交易类型和交易日期不能为空');
            return;
        }

        const navPrice = safeFloat(result.navPrice, 0);
        const feeRate = safeFloat(result.feeRate, 0);
        let amount = safeFloat(result.amount, 0);
        let shares = safeFloat(result.shares, 0);
        const dividendAmount = safeFloat(result.amount, 0);

        const derived = await deriveAndValidateTradeInput(type, amount, shares, dividendAmount, navPrice, feeRate);
        if (!derived) return;
        ({ amount, shares } = derived);

        const isDividend = isDividendType(type);
        const orderPayload = {
            code,
            name: fundItem.name || live?.name || code,
            group: fundItem.group || '默认',
            type: type === 'clear' ? 'remove' : type,
            date: tradeDate,
            orderDate: tradeDate,
            targetDate: tradeDate,
            confirmedDate: tradeDate,
            effectiveDate: tradeDate,
            amount: isDividend ? dividendAmount : amount,
            shares,
            confirmedShares: (type === 'add' || type === 'dividend_reinvest') ? shares : 0,
            confirmedPrice: navPrice,
            orderNav: navPrice,
            dividendAmount: isDividend ? dividendAmount : 0,
            dividendNavPrice: isDividend ? navPrice : 0,
            feeRate,
            fee: navPrice > 0
                ? round2((type === 'remove' || type === 'clear' ? shares * navPrice : amount) * feeRate / 100)
                : 0,
            perShare: isDividend && shares > 0
                ? round4(dividendAmount / shares)
                : 0,
            isClear: type === 'clear',
            status: 'confirmed',
            source: 'manual_backfill',
            remark: result.remark || '历史补录'
        };

        await persistTradeOrder(orderPayload, orderPayload);
        if (type === 'initial') {
            await cleanupInitialOrdersForCode(code);
            const { myFunds: latestFunds } = await storageHelper.getAll(['myFunds']);
            const nextFunds = latestFunds || {};
            if (nextFunds[code]) {
                const currentAddedDate = normalizePerfDate(nextFunds[code].addedDate || '');
                if (!currentAddedDate || tradeDate < currentAddedDate) {
                    nextFunds[code].addedDate = tradeDate;
                    await storageHelper.setAll({ myFunds: nextFunds });
                }
            }
        }
        showToast(`✅ ${code} 历史${getTradeDisplayLabel(orderPayload)}已补录`, 'success');
        loadData();
    } catch (e) {
        console.error('补录历史交易失败:', e);
        showAlert(`补录失败: ${e.message}`);
    }
}

async function openHistoricalTradeForm({ code, fundItem, title, subTitle, actionText, initialValues = {} }) {
    const live = await fetchLiveInfo(code);
    const todayStr = getToday();
    const currentNav = live?.prevPrice || fundItem?.savedPrevPrice || 1;
    return showFormModal({
        title,
        subTitle: subTitle || `${live?.name || code} (#${code})　仅补录已完成历史交易，不改当前持仓`,
        fields: [
            {
                id: 'type', label: '交易类型', type: 'select', value: initialValues.type || 'add',
                options: [
                    { value: 'initial', label: '建仓' },
                    { value: 'add', label: '加仓' },
                    { value: 'remove', label: '减仓' },
                    { value: 'clear', label: '清仓' },
                    { value: 'dividend', label: '现金分红' },
                    { value: 'dividend_reinvest', label: '红利再投' }
                ]
            },
            { id: 'tradeDate', label: '交易生效日期', type: 'date', value: initialValues.tradeDate || fundItem?.addedDate || todayStr },
            { id: 'amount', label: '金额 (元)', type: 'number', value: initialValues.amount || '', min: 0, step: '0.01' },
            { id: 'shares', label: '份额', type: 'number', value: initialValues.shares || '', min: 0, step: '0.0001' },
            { id: 'navPrice', label: '成交/确认净值', type: 'number', value: initialValues.navPrice || (currentNav ? String(currentNav) : ''), min: 0, step: '0.0001' },
            { id: 'feeRate', label: '费率 (%)', type: 'number', value: initialValues.feeRate || '0', min: 0, step: '0.01' },
            { id: 'remark', label: '备注', type: 'text', value: initialValues.remark || '历史补录' }
        ],
        actionText,
        layout: 'double',
        onRender: ({ getField }) => {
            const typeInput = getField('type');
            const tradeDateInput = getField('tradeDate');
            const amountInput = getField('amount');
            const sharesInput = getField('shares');
            const navPriceInput = getField('navPrice');
            if (!tradeDateInput || !navPriceInput || !amountInput || !sharesInput || !typeInput) return;

            const navGroup = navPriceInput.closest('.form-group');
            let hintEl = null;
            if (navGroup) {
                hintEl = navGroup.querySelector('.form-field-hint');
                if (!hintEl) {
                    hintEl = document.createElement('div');
                    hintEl.className = 'form-field-hint';
                    navGroup.appendChild(hintEl);
                }
            }

            let requestToken = 0;
            const setHint = (text, tone = '') => {
                if (!hintEl) return;
                hintEl.textContent = text || '';
                hintEl.dataset.tone = tone || '';
            };

            const syncDerivedFields = () => {
                const tradeType = normalizeTradeAction(typeInput.value || '');
                const amount = safeFloat(amountInput.value, 0);
                const shares = safeFloat(sharesInput.value, 0);
                const navPrice = safeFloat(navPriceInput.value, 0);
                const feeRate = safeFloat(getField('feeRate')?.value, 0);
                const activeField = document.activeElement;
                if (!(navPrice > 0)) {
                    return;
                }

                if (tradeType === 'add' || tradeType === 'initial') {
                    if (!(amount > 0)) {
                        if (!sharesInput.value) {
                            sharesInput.value = '';
                        }
                        return;
                    }
                    sharesInput.value = String(calculateNetBuyShares(amount, navPrice, feeRate));
                    return;
                }

                if (tradeType === 'remove' || tradeType === 'clear') {
                    if (activeField === amountInput) {
                        if (!(amount > 0)) {
                            if (!sharesInput.value) {
                                sharesInput.value = '';
                            }
                            return;
                        }
                        const derivedShares = calculateSellSharesFromNetAmount(amount, navPrice, feeRate);
                        sharesInput.value = derivedShares > 0 ? String(derivedShares) : '';
                        return;
                    }
                    if (!(shares > 0)) {
                        if (!amountInput.value) {
                            amountInput.value = '';
                        }
                        return;
                    }
                    const derivedAmount = calculateNetSellAmountFromShares(shares, navPrice, feeRate);
                    amountInput.value = derivedAmount > 0 ? String(derivedAmount) : '';
                }
            };

            const syncNavByTradeDate = async () => {
                const tradeDate = normalizePerfDate(tradeDateInput.value || '');
                const token = ++requestToken;
                if (!tradeDate) {
                    navPriceInput.readOnly = false;
                    setHint('');
                    return;
                }

                setHint('正在读取该日净值…', 'loading');
                const resolved = await resolveHistoricalNavByDate(code, tradeDate);
                if (token !== requestToken) return;

                if (resolved.navPrice > 0) {
                    navPriceInput.value = String(resolved.navPrice);
                    navPriceInput.readOnly = true;
                    setHint(`已自动带入 ${resolved.date} 净值`, 'success');
                    syncDerivedFields();
                    return;
                }

                navPriceInput.readOnly = false;
                setHint('未查到该日净值，可手动录入', 'warning');
                syncDerivedFields();
            };

            tradeDateInput.addEventListener('change', syncNavByTradeDate);
            tradeDateInput.addEventListener('input', syncNavByTradeDate);
            typeInput.addEventListener('change', syncDerivedFields);
            amountInput.addEventListener('input', syncDerivedFields);
            sharesInput.addEventListener('input', syncDerivedFields);
            navPriceInput.addEventListener('input', syncDerivedFields);
            getField('feeRate')?.addEventListener('input', syncDerivedFields);
            syncNavByTradeDate();
        }
    });
}

async function reconcilePositionFromTradeHistory(code) {
    try {
        const { myFunds } = await storageHelper.getAll(['myFunds']);
        const funds = myFunds || {};
        const fundItem = funds[code];
        if (!fundItem) {
            await showAlert('未找到该标的数据！');
            return;
        }

        const orders = await HistoryDB.getOrders(code).catch(() => []);
        const snapshot = calculatePositionSnapshotFromTradeOrders(orders);
        if (!snapshot.orders.length) {
            await showAlert('该标暂无可用于校准的已确认交易流水');
            return;
        }

        const live = await fetchLiveInfo(code);
        const currentNav = live?.prevPrice || fundItem.savedPrevPrice || 0;
        const nextShares = round6(snapshot.shares);
        const currentShares = round6(safeFloat(fundItem.shares, 0));
        const nextAmount = currentNav > 0 ? round2(nextShares * currentNav) : round2(safeFloat(fundItem.amount, 0));
        const currentAmount = round2(safeFloat(fundItem.amount, 0));
        const nextAddedDate = snapshot.addedDate || null;
        const currentAddedDate = normalizePerfDate(fundItem.addedDate || '') || null;

        const sameShares = Math.abs(nextShares - currentShares) <= 0.000001;
        const sameAmount = Math.abs(nextAmount - currentAmount) <= 0.01 || !(currentNav > 0);
        const sameAddedDate = (nextAddedDate || '') === (currentAddedDate || '');

        if (sameShares && sameAmount && sameAddedDate) {
            showToast(`ℹ️ ${code} 当前持仓已与历史流水一致`, 'success');
            return;
        }

        const ok = await showConfirm(
            `按历史已确认交易流水校准 ${code}？\n\n当前份额：${currentShares}\n理论份额：${nextShares}\n\n当前金额：¥${currentAmount}\n理论金额：¥${nextAmount}${currentNav > 0 ? `（按净值 ${currentNav} 估算）` : ''}\n\n当前建仓日：${currentAddedDate || '无'}\n理论建仓日：${nextAddedDate || '无'}\n\n说明：本次只校准份额 / 金额 / 建仓日，不改累计收益。`,
            '历史流水校准',
            true
        );
        if (!ok) return;

        fundItem.shares = nextShares;
        fundItem.amount = nextAmount;
        fundItem.addedDate = nextAddedDate;
        if (currentNav > 0) {
            fundItem.savedPrevPrice = currentNav;
            fundItem.savedPrevDate = live?.prevPriceDate || fundItem.savedPrevDate || getToday();
        }
        syncAddedDateByPosition(fundItem, getToday(), {
            preserveExistingAddedDate: true,
            defaultAddedDate: nextAddedDate || ''
        });

        await storageHelper.setAll({ myFunds: funds });
        showToast(`✅ ${code} 已按历史流水校准当前持仓`, 'success');
        loadData();
    } catch (e) {
        console.error('历史流水校准失败:', e);
        showAlert(`校准失败: ${e.message}`);
    }
}

async function openFundEditor(existingCode = null) {
    let fund = null, live = null;
    let currentNav = 1.0000;

    if (existingCode) {
        const { myFunds } = await storageHelper.getAll(['myFunds']);
        fund = (myFunds || {})[existingCode];
        live = await fetchLiveInfo(existingCode);
        currentNav = live?.prevPrice || 1.0000;
    }

    const fields = [
        { id: 'code', label: '资产代码 (必填)', type: 'text', value: existingCode || '', placeholder: '如: 005827' },
        { id: 'amount', label: '持有金额 (元)', type: 'number', value: fund?.amount || '', min: 0, step: '0.01' },
        { id: 'shares', label: '持有份额', type: 'number', value: fund?.shares || '', step: '0.0001' },
        { id: 'holdProfit', label: '累计盈亏 (元)', type: 'number', value: fund?.holdProfit || 0 },
        { id: 'yesterdayProfit', label: '昨日收益 (元)', type: 'number', value: fund?.yesterdayProfit || 0 },
        { id: 'group', label: '分组名称', type: 'text', value: fund?.group || '', list: 'groupList', placeholder: '留空则归为默认' },
        {
            id: 'dividendMode', label: '分红方式', type: 'select', value: fund?.dividendMode || 'cash',
            options: [{ value: 'cash', label: '💵 现金分红（默认）' }, { value: 'reinvest', label: '🔄 红利再投' }]
        },
        { id: 'feeRate', label: '建仓费率 (%)', type: 'number', placeholder: '0.15', value: existingCode ? '' : '0', step: '0.01', min: 0 },
        { id: 'addedDate', label: '首笔确认净值日期', type: 'date', value: fund?.addedDate || '' }
    ];

    setTimeout(() => {
        const codeInput = document.getElementById('modal_field_code');
        const amtInput = document.getElementById('modal_field_amount');
        const shareInput = document.getElementById('modal_field_shares');

        if (existingCode) {
            codeInput.disabled = true;
        } else {
            codeInput.addEventListener('blur', async () => {
                const c = codeInput.value.trim();
                if (c.length >= 5) {
                    const l = await fetchLiveInfo(c);
                    if (l && l.prevPrice > 0) {
                        currentNav = l.prevPrice;
                        if (amtInput.value && !shareInput.value) {
                            shareInput.value = (parseFloat(amtInput.value) / currentNav).toFixed(4);
                        }
                    }
                }
            });
        }

        amtInput.addEventListener('input', () => {
            const amt = parseFloat(amtInput.value) || 0;
            if (currentNav > 0) shareInput.value = (amt / currentNav).toFixed(4);
        });

        shareInput.addEventListener('input', () => {
            const sh = parseFloat(shareInput.value) || 0;
            if (currentNav > 0) amtInput.value = (sh * currentNav).toFixed(2);
        });
    }, 100);

    const result = await showFormModal({
        title: existingCode ? '编辑持仓' : '添加资产',
        subTitle: existingCode ? `${live?.name || existingCode} ` : '输入代码后点击空白处，获取净值进行联动计算',
        fields: fields,
        actionText: '保存',
        layout: 'single',
        onRender: ({ getField }) => {
            const dateInput = getField('addedDate');
            const feeInput = getField('feeRate');
            const amountInput = getField('amount');
            const sharesInput = getField('shares');
            if (dateInput) {
                dateInput.setAttribute('placeholder', '请选择首笔确认净值日期');
                const openPicker = () => {
                    if (typeof dateInput.showPicker === 'function') {
                        try {
                            dateInput.showPicker();
                        } catch (_) {}
                    }
                };
                dateInput.addEventListener('focus', openPicker);
                dateInput.addEventListener('click', openPicker);
            }
            const syncBuildFieldsState = () => {
                const hasAmt = parseFloat(amountInput?.value) > 0;
                const hasShr = parseFloat(sharesInput?.value) > 0;
                const buildOn = hasAmt || hasShr;
                [dateInput, feeInput].forEach(el => {
                    if (!el) return;
                    el.disabled = !buildOn;
                    el.style.opacity = buildOn ? '' : '0.5';
                });
                if (dateInput) {
                    dateInput.title = buildOn ? '' : '金额/份额为 0 时无需建仓，可不填';
                }
                if (feeInput) {
                    feeInput.title = buildOn ? '' : '金额/份额为 0 时无需建仓，可不填';
                }
            };
            syncBuildFieldsState();
            amountInput?.addEventListener('input', syncBuildFieldsState);
            sharesInput?.addEventListener('input', syncBuildFieldsState);
        }
    });

    if (!result) return;

    const code = (existingCode || result.code).trim().toUpperCase();
    if (!code) { await showAlert('资产代码不能为空！'); return; }

    elements.statusText.innerText = '正在保存...';

    if (!existingCode && !live) {
        live = await fetchLiveInfo(code);
        if (!live || live.name.includes('[未知]')) {
            const ok = await showConfirm(`未检索到代码 ${code} 的数据，是否强制保存？`, '提示', true);
            if (!ok) { elements.statusText.innerText = '准备就绪'; return; }
        }
    }

    const todayStr = getToday();
    const { myFunds } = await storageHelper.getAll(['myFunds']);
    const funds = myFunds || {};
    const oldAddedDate = normalizePerfDate(funds[code]?.addedDate || '');
    const manualAddedDate = normalizePerfDate(result.addedDate || '');
    const existingOrders = await HistoryDB.getOrders(code).catch(() => []);
    const hasBuildOrder = existingOrders.some(order => {
        const displayType = typeof getTradeDisplayType === 'function'
            ? getTradeDisplayType(order)
            : normalizeTradeAction(order?.type || '');
        return displayType === 'initial' || displayType === 'add';
    });
    const nextAmount = parseFloat(result.amount) || 0;
    const nextShares = parseFloat(result.shares) || 0;
    const hasPosition = nextAmount > 0 || nextShares > 0;
    const positionEffectiveDate = hasPosition ? (manualAddedDate || derivePositionEffectiveDate()) : '';
    const nextAddedDate = hasPosition || hasBuildOrder
        ? (manualAddedDate || oldAddedDate || positionEffectiveDate)
        : '';

    const nextFund = {
        ...(funds[code] || {}),
        name: funds[code]?.name || live?.name || code,
        amount: nextAmount,
        shares: nextShares,
        holdProfit: parseFloat(result.holdProfit) || 0,
        yesterdayProfit: parseFloat(result.yesterdayProfit) || 0,
        group: result.group || '默认',
        dividendMode: result.dividendMode || 'cash',
        addedDate: nextAddedDate || null,
        savedPrevPrice: funds[code]?.savedPrevPrice || live?.prevPrice || 1,
        savedPrevDate: funds[code]?.savedPrevDate || live?.prevPriceDate || todayStr,
        savedAcNetValue: funds[code]?.savedAcNetValue || live?.acNetValue || null
    };

    if (hasPosition && !result.addedDate && !oldAddedDate) {
        syncAddedDateByPosition(nextFund, todayStr, {
            allowCreateAddedDateWithoutOrders: true
        });
    }

    funds[code] = nextFund;
    await storageHelper.setAll({ myFunds: funds });

    if (existingCode && nextAddedDate && nextAddedDate !== oldAddedDate) {
        HistoryDB.getOrders(code).then(orders => {
            const initialOrder = orders.find(o => o.type === 'initial');
            if (initialOrder) {
                initialOrder.date = nextAddedDate;
                initialOrder.orderDate = nextAddedDate;
                initialOrder.targetDate = nextAddedDate;
                initialOrder.confirmedDate = nextAddedDate;
                initialOrder.effectiveDate = nextAddedDate;
                HistoryDB.updateOrder(initialOrder.id || initialOrder.orderId, initialOrder).catch(() => {});
            }
        }).catch(() => {});
    }

    let ordersForDividendBackfill = existingOrders;

    if (!existingCode && hasPosition) {
        const principal = round2(nextFund.amount - nextFund.holdProfit);
        const feeRatePct = Math.max(0, parseFloat(result.feeRate) || 0);
        const fee = round2(principal * feeRatePct / 100);
        const orderNav = nextFund.shares > 0
            ? round4(principal * (1 - feeRatePct / 100) / nextFund.shares)
            : 0;
        const initialOrder = {
            code: code,
            name: nextFund.name || live?.name || code,
            group: nextFund.group || '默认',
            date: nextFund.addedDate || todayStr,
            type: 'initial',
            orderDate: nextFund.addedDate || todayStr,
            targetDate: nextFund.addedDate || todayStr,
            confirmedDate: nextFund.addedDate || todayStr,
            effectiveDate: nextFund.addedDate || todayStr,
            shares: nextFund.shares,
            amount: principal,
            price: orderNav,
            confirmedPrice: orderNav,
            orderNav: orderNav,
            feeRate: feeRatePct,
            fee: fee,
            remark: '添加资产时自动初始化',
            status: 'confirmed'
        };
        await HistoryDB.addOrder(initialOrder).catch(() => {});
        ordersForDividendBackfill = [...existingOrders, initialOrder];
    }

    try {
        await backfillHistoricalDividendOrdersForFund(code, nextFund, todayStr, ordersForDividendBackfill);
    } catch (error) {
        console.warn(`[DividendBackfill] ${code} 历史分红补录失败:`, error);
    }

    showToast(`✅ [${code}] 资产保存成功！当前持仓：${result.amount}元 / ${result.shares}份`, 'success');
    elements.statusText.innerText = '准备就绪';
    loadData();
}

var centerModalOverlay = null;
function initCenterModal() {
    centerModalOverlay = document.createElement('div');
    centerModalOverlay.className = 'center-modal-overlay';
    centerModalOverlay.onclick = (e) => {
        if (e.target === centerModalOverlay) {
            hideCenterModal();
        }
    };
    document.body.appendChild(centerModalOverlay);
}

function showCenterMenu(code) {
    if (!centerModalOverlay) initCenterModal();
    const fund = allFundsData.find(f => f.code === code);
    if (!fund) return;

    const html = `
        <div class="center-modal-box">
            <div class="center-modal-header">
                <span class="modal-title">持仓操作</span>
                <span class="modal-link" id="transactionLink">交易记录 ></span>
            </div>
            <div class="center-modal-info">
                <span class="info-name">${fund.name}</span>
                <span class="info-code">#${fund.code}</span>
            </div>
            <div class="center-modal-actions">
                <div class="action-row-double">
                    <button class="btn-op add" data-action="add" data-code="${code}">+ 加仓</button>
                    <button class="btn-op remove" data-action="remove" data-code="${code}">− 减仓</button>
                </div>
                <button class="btn-op history" data-action="backfill" data-code="${code}">🕘 补录历史交易</button>
                <button class="btn-op reconcile" data-action="reconcile" data-code="${code}">🧮 按流水校准持仓</button>
                <button class="btn-op dividend" data-action="dividend" data-code="${code}">💰 手动录入分红</button>
                <button class="btn-op edit" data-action="edit" data-code="${code}">✏️ 编辑持仓</button>
                <button class="btn-op calc" data-action="calc_shares" data-code="${code}">🔄 根据金额重算份额</button>
                <button class="btn-op clear" data-action="clear" data-code="${code}">🧹 清空金额</button>
                <button class="btn-op delete" data-action="delete" data-code="${code}">🗑 彻底删除资产</button>
            </div>
        </div>
    `;
    centerModalOverlay.innerHTML = html;

    const transactionLink = document.getElementById('transactionLink');
    if (transactionLink) {
        transactionLink.addEventListener('click', () => {
            hideCenterModal();
            showPendingTransactions(code);
        });
    }

    centerModalOverlay.querySelectorAll('.btn-op').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            const c = btn.dataset.code;
            hideCenterModal();

            if (action === 'add') adjustPosition(c, 'add');
            else if (action === 'remove') adjustPosition(c, 'remove');
            else if (action === 'backfill') backfillHistoricalTrade(c);
            else if (action === 'reconcile') reconcilePositionFromTradeHistory(c);
            else if (action === 'dividend') adjustPosition(c, 'dividend');
            else if (action === 'edit') openFundEditor(c);
            else if (action === 'clear') clearPositions(c);
            else if (action === 'calc_shares') forceRecalculateShares(c);
            else if (action === 'delete') removeFund(c);
        });
    });

    requestAnimationFrame(() => {
        centerModalOverlay.classList.add('visible');
    });
}

async function clearFundOrders(code) {
    try {
        const { myFunds, dailyProfitHistory } = await storageHelper.getAll(['myFunds', 'dailyProfitHistory']);
        const funds = myFunds || {};
        const fund = funds[code];
        if (!fund) {
            await showAlert('未找到该标的数据！');
            return;
        }

        const orders = await HistoryDB.getOrders(code).catch(() => []);
        if (!orders.length) {
            await showAlert('该基金当前没有订单记录。', '清空订单');
            return;
        }

        const ok = await showConfirm(
            `确认清空 [${code}] 的全部订单吗？\n\n当前订单数：${orders.length}\n基金：${fund.name || code}\n\n这会删除该基金在订单库中的所有交易记录，并将该基金恢复为未建仓状态。`,
            '清空订单确认',
            true
        );
        if (!ok) return;

        elements.statusText.innerText = '正在清空订单...';
        await HistoryDB.deleteOrdersByCode(code);
        await HistoryDB.deleteStateRecordsByCode(code).catch(() => {});

        const nextFunds = { ...funds };
        if (nextFunds[code]) {
            nextFunds[code].addedDate = null;
        }

        const nextHistory = { ...(dailyProfitHistory || {}) };
        Object.keys(nextHistory).forEach(date => {
            const entry = nextHistory[date];
            if (!entry?.byCode || !Object.prototype.hasOwnProperty.call(entry.byCode, code)) return;
            const nextByCode = { ...entry.byCode };
            delete nextByCode[code];
            const totalProfit = round2(Object.values(nextByCode).reduce((sum, value) => sum + (Number(value) || 0), 0));
            if (Object.keys(nextByCode).length === 0) {
                delete nextHistory[date];
            } else {
                nextHistory[date] = { totalProfit, byCode: nextByCode };
            }
        });

        await storageHelper.setAll({
            myFunds: nextFunds,
            dailyProfitHistory: normalizeDailyProfitHistory(nextHistory)
        });

        _closeModal();
        elements.statusText.innerText = '准备就绪';
        showToast(`✅ [${code}] 订单已清空`, 'success');
        loadData();
    } catch (error) {
        console.error('清空订单失败:', error);
        elements.statusText.innerText = '准备就绪';
        showAlert(`清空订单失败: ${error.message}`);
    }
}

async function showPendingTransactions(code) {
    await cleanupInitialOrdersForCode(code);
    const { myFunds } = await storageHelper.getAll(['myFunds']);
    const funds = myFunds || {};
    const fund = funds[code];
    const txList = normalizeTradeRecordList(
        await HistoryDB.getOrders(code).catch(() => [])
    , { source: 'order' }).sort((left, right) => compareTradeExecutionOrder(right, left));

    if (txList.length === 0) {
        await showAlert('暂无交易记录');
        return;
    }

    const renderList = () => {
        let html = `<div class="tx-list">`;
        txList.forEach((adj, idx) => {
            const isPending = adj.status !== 'confirmed';
            const isRevocable = isTradeRevocable(adj);
            const type = getTradeDisplayType(adj);
            const typeLabel = getTradeDisplayLabel(adj);
            const typeCls = type === 'initial' ? 'add'
                : type === 'add' ? 'add'
                    : isDividendType(type) ? 'dividend'
                        : (type === 'remove' || type === 'clear') ? 'remove' : 'remove';

            const statusBadge = `<span class="tx-badge ${isPending ? 'pending' : 'confirmed'}">${isPending ? '待确认' : '已确认'}</span>`;

            const amountText = type === 'initial'
                ? `${adj.shares} 份`
                : type === 'add'
                    ? `¥${adj.amount} (费率${adj.feeRate}%)`
                    : isDividendType(type)
                        ? `¥${adj.dividendAmount}`
                        : (type === 'remove' || type === 'clear')
                            ? `${adj.shares} 份 (费率${adj.feeRate}%)`
                            : `金额 ¥${adj.amount} / 份额 ${adj.shares}`;

            let navInfo = '';
            if (adj.orderNav) navInfo += `下单净值 ${adj.orderNav} `;
            if (adj.confirmedPrice) navInfo += `　确认净值 ${adj.confirmedPrice} `;
            if (adj.confirmedShares && (type === 'add' || type === 'dividend_reinvest')) navInfo += `　到账 ${adj.confirmedShares} 份`;
            if (adj.source === 'manual_backfill') navInfo += `　历史补录 `;
            if (adj.cancelableUntilDate && isPending) {
                navInfo += `　可撤销至 ${adj.cancelableUntilDate} ${String(CONFIG.TRADING_CUTOFF_HOUR).padStart(2, '0')}:${String(CONFIG.TRADING_CUTOFF_MINUTE || 0).padStart(2, '0')} `;
            }

            let dateInfo = type === 'initial' ? `建仓日 ${adj.orderDate || adj.date || adj.confirmedDate || ''} ` : `预计确认日 ${adj.targetDate} `;
            if (adj.confirmedDate) dateInfo = `确认日 ${adj.confirmedDate} `;
            if (adj.orderDate) dateInfo = `下单 ${adj.orderDate} · ` + dateInfo;
            if (type === 'initial') {
                dateInfo = `建仓日 ${adj.orderDate || adj.date || adj.confirmedDate || ''} `;
            } else if (isDividendType(type)) {
                dateInfo = `分红日 ${adj.dividendDate || adj.orderDate || ''} · 确认日 ${adj.confirmedDate || adj.targetDate || ''}`;
            }

            let actionBtn = '';
            if (isPending && isRevocable) {
                if (type === 'dividend') {
                    actionBtn = `
                        <button data-convert-reinvest="${idx}" class="tx-revoke-btn" style="background: #1890ff; border-color: #1890ff;">改为红利再投</button>
                        <button data-revoke="${idx}" class="tx-revoke-btn">撤销</button>
                    `;
                } else {
                    actionBtn = `<button data-revoke="${idx}" class="tx-revoke-btn">撤销</button>`;
                }
            } else if (adj.source === 'manual_backfill') {
                actionBtn = `
                    <button data-edit-order="${idx}" class="tx-revoke-btn" style="background:#2b4c7e;border-color:#4f7fc5;">编辑</button>
                    <button data-delete-order="${idx}" class="tx-revoke-btn" style="background:#5b2434;border-color:#8b3a52;">删除</button>
                `;
            } else {
                actionBtn = `<span class="tx-no-revoke">${isPending ? '已过撤销期' : '不可撤销'}</span>`;
            }

            html += `
        <div class="tx-item">
            <div class="tx-row-main">
                <div class="tx-row-left">
                    <span class="tx-type ${typeCls}">${typeLabel}</span>
                    ${statusBadge}
                    <span class="tx-amount">${amountText}</span>
                </div>
                <div style="display: flex; gap: 4px;">
                    ${actionBtn}
                </div>
            </div>
            ${navInfo ? `<div class="tx-nav">${navInfo}</div>` : ''}
            <div class="tx-date">${dateInfo}</div>
        </div>`;
        });
        html += `</div>`;
        return html;
    };

    showHtmlModal('交易记录', renderList(), [
        getCloseFooterButton(),
        {
            text: '清空订单',
            cls: 'modal-btn-danger',
            onClick: async () => {
                await clearFundOrders(code);
            }
        }
    ]);

    elements.modalMsg.onclick = async (e) => {
        const convertBtn = e.target.closest('[data-convert-reinvest]');
        if (convertBtn) {
            const idx = parseInt(convertBtn.dataset.convertReinvest);
            const adj = txList[idx];
            if (!adj || adj.status === 'confirmed' || normalizeTradeAction(adj.type) !== 'dividend') return;
            const ok = await showConfirm(
                `确认将现金分红改为红利再投吗？\n\n分红金额：¥${adj.dividendAmount}\n分红日净值：${adj.dividendNavPrice || '未知'}\n\n红利再投后，份额会增加，累计收益不变。`,
                '改为红利再投'
            );
            if (!ok) return;
            adj.type = 'dividend_reinvest';
            adj.status = 'confirmed';
            if (adj.orderId) {
                await persistTradeOrder(adj, {
                    ...adj,
                    type: 'dividend_reinvest'
                }).catch(() => {});
            }
            showToast(`✅ ${code} 分红${adj.dividendAmount}元已改为红利再投`, 'success');
            elements.modalMsg.innerHTML = renderList();
            loadData();
            return;
        }

        const revokeBtn = e.target.closest('[data-revoke]');
        const editBtn = e.target.closest('[data-edit-order]');
        const deleteBtn = e.target.closest('[data-delete-order]');
        if (!revokeBtn && !deleteBtn && !editBtn) return;
        const idx = parseInt((revokeBtn?.dataset.revoke || deleteBtn?.dataset.deleteOrder || editBtn?.dataset.editOrder), 10);
        const adj = txList[idx];
        if (!adj) return;

        if (editBtn) {
            const result = await openHistoricalTradeForm({
                code,
                fundItem: fund,
                title: '编辑历史交易',
                subTitle: `${fund?.name || code} (#${code})　修改后将直接覆盖这条历史记录`,
                actionText: '确认修改',
                initialValues: {
                    type: getTradeDisplayType(adj) === 'clear' ? 'clear' : normalizeTradeAction(adj.type),
                    tradeDate: adj.orderDate || adj.date || adj.confirmedDate || '',
                    amount: (() => { const v = isDividendType(adj.type) ? adj.dividendAmount || adj.amount : adj.amount; return v ? String(v) : ''; })(),
                    shares: adj.shares ? String(adj.shares) : '',
                    navPrice: String(adj.confirmedPrice || adj.orderNav || adj.dividendNavPrice || ''),
                    feeRate: String(adj.feeRate || 0),
                    remark: adj.remark || '历史补录'
                }
            });
            if (!result) return;

            const type = normalizeTradeAction(result.type);
            const tradeDate = normalizePerfDate(result.tradeDate || '');
            if (!type || !tradeDate) {
                await showAlert('交易类型和交易日期不能为空');
                return;
            }

            const navPrice = safeFloat(result.navPrice, 0);
            const feeRate = safeFloat(result.feeRate, 0);
            let amount = safeFloat(result.amount, 0);
            let shares = safeFloat(result.shares, 0);
            const dividendAmount = safeFloat(result.amount, 0);

            const derived = await deriveAndValidateTradeInput(type, amount, shares, dividendAmount, navPrice, feeRate);
            if (!derived) return;
            ({ amount, shares } = derived);

            const isDividend = isDividendType(type);
            const nextOrder = {
                ...adj,
                type: type === 'clear' ? 'remove' : type,
                date: tradeDate,
                orderDate: tradeDate,
                targetDate: tradeDate,
                confirmedDate: tradeDate,
                effectiveDate: tradeDate,
                amount: isDividend ? dividendAmount : amount,
                shares,
                confirmedShares: (type === 'add' || type === 'dividend_reinvest') ? shares : 0,
                confirmedPrice: navPrice,
                orderNav: navPrice,
                dividendAmount: isDividend ? dividendAmount : 0,
                dividendNavPrice: isDividend ? navPrice : 0,
                feeRate,
                fee: navPrice > 0
                    ? round2((type === 'remove' || type === 'clear' ? shares * navPrice : amount) * feeRate / 100)
                    : 0,
                perShare: isDividend && shares > 0
                    ? round4(dividendAmount / shares)
                    : 0,
                isClear: type === 'clear',
                status: 'confirmed',
                source: 'manual_backfill',
                remark: result.remark || '历史补录'
            };

            if (adj.orderId) {
                await HistoryDB.updateOrder(adj.orderId, { ...nextOrder, id: adj.orderId }).catch(() => {});
            }
            await cleanupInitialOrdersForCode(code);
            await syncFundAddedDateFromTradeOrders(code);
            showToast(`✅ ${code} ${getTradeDisplayLabel(nextOrder)}记录已更新`, 'success');
            elements.modalMsg.innerHTML = renderList();
            loadData();
            return;
        }

        if (deleteBtn) {
            const typeLabel = `${getTradeDisplayLabel(adj)} ${adj.shares || adj.dividendAmount || adj.amount || ''}`;
            const ok = await showConfirm(
                `确认删除这条已确认记录吗？\n\n${typeLabel}\n${adj.confirmedDate || adj.orderDate || adj.date || ''}\n\n删除后将以剩余订单作为数据源。`,
                '删除记录',
                true
            );
            if (!ok) return;

            txList.splice(idx, 1);
            if (adj.orderId) {
                await HistoryDB.deleteOrder(adj.orderId).catch(() => {});
            }
            await cleanupInitialOrdersForCode(code);
            await syncFundAddedDateFromTradeOrders(code);
            showToast(`✅ ${code} ${getTradeDisplayLabel(adj)}记录已删除`, 'success');

            if (txList.length === 0) {
                _closeModal();
            } else {
                elements.modalMsg.innerHTML = renderList();
            }
            loadData();
            return;
        }

        if (!isTradeRevocable(adj)) return;

        const type = getTradeDisplayType(adj);
        const typeLabel = type === 'add' ? `加仓 ¥${adj.amount} `
            : isDividendType(type) ? `分红 ¥${adj.dividendAmount} `
                : type === 'clear' ? `清仓 ${adj.shares} 份`
                    : type === 'remove' ? `减仓 ${adj.shares} 份`
                        : `${getTradeDisplayLabel(adj)} ${adj.shares || adj.amount || ''}`;
        const ok = await showConfirm(`确认撤销：${typeLabel}（${adj.targetDate || adj.confirmedDate || adj.orderDate || ''}）？`, '撤销确认', true);
        if (!ok) return;

        txList.splice(idx, 1);
        if (adj.orderId) {
            await HistoryDB.deleteOrder(adj.orderId).catch(() => {});
        }
        showToast(`✅ ${code} ${typeLabel}已撤销`, 'success');

        if (txList.length === 0) {
            _closeModal();
        } else {
            elements.modalMsg.innerHTML = renderList();
        }
        loadData();
    };
}

function hideCenterModal() {
    if (centerModalOverlay) {
        centerModalOverlay.classList.remove('visible');
    }
}

async function forceRecalculateShares(code) {
    elements.statusText.innerText = '正在重新计算份额...';
    const live = await fetchLiveInfo(code);
    if (!live || live.prevPrice <= 0) {
        await showAlert(`无法获取 ${code} 的有效净值，计算失败。`);
        elements.statusText.innerText = '准备就绪';
        return;
    }

    const { myFunds } = await storageHelper.getAll(['myFunds']);
    const funds = myFunds || {};
    if (funds[code]) {
        const newShares = deriveFundShares(funds[code], live.prevPrice);
        funds[code].shares = newShares;
        syncAddedDateByPosition(funds[code], getToday());

        await storageHelper.setAll({ myFunds: funds });
        showToast(`✅ ${code} 已按净值 ${live.prevPrice} 重算份额为 ${newShares} 份`, 'success');
        elements.statusText.innerText = '准备就绪';
        loadData();
    }
}
