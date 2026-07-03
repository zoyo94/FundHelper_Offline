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
                    shares: adj.shares ? String(roundShares(adj.shares)) : '',
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
            let shares = roundShares(safeFloat(result.shares, 0));
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
                shares: roundShares(shares),
                confirmedShares: (type === 'add' || type === 'dividend_reinvest') ? roundShares(shares) : 0,
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
