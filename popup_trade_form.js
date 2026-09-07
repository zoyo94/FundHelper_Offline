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
            // 减仓：在「卖出份额」输入框右侧并排一个「全部」快捷填充按钮，免去手输全部份额
            if (!isAdd && !isDividend) {
                const sharesInput = document.getElementById('modal_field_shares');
                const sharesGroup = sharesInput?.closest('.form-group');
                const maxSharesValue = roundShares(fundItem.shares || 0);
                if (sharesInput && sharesGroup && maxSharesValue > 0) {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex;gap:8px;align-items:stretch;';
                    sharesInput.parentNode.insertBefore(row, sharesInput);
                    sharesInput.style.flex = '1';
                    row.appendChild(sharesInput);

                    const allBtn = document.createElement('label');
                    allBtn.className = 'timing-btn';
                    allBtn.style.cssText = 'display:flex;align-items:center;white-space:nowrap;cursor:pointer;';
                    allBtn.textContent = '全部';
                    allBtn.title = `填入全部份额 ${maxSharesValue.toFixed(2)}`;
                    allBtn.addEventListener('click', () => {
                        sharesInput.value = maxSharesValue.toFixed(2);
                        sharesInput.dispatchEvent(new Event('input', { bubbles: true }));
                    });
                    row.appendChild(allBtn);
                }
            }

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

        const todayStr = getToday();
        const inputConfirmDate = normalizePerfDate(result.confirmDate || '');
        if (inputConfirmDate && inputConfirmDate < todayStr) {
            await showAlert('到账日期不能是过去日期。如需补录历史交易，请使用「补录历史交易」功能。');
            return;
        }

        effectiveDate = getTradeEffectiveDate(now, useAfterCutoff);
        cancelableUntilDate = getTradeCancelableUntilDate(now, useAfterCutoff);

        const maxShares = fundItem.shares || 0;
        // 输入校验（HTML 的 min/max 属性不阻止提交，必须在入库前拦截）：
        // 加仓/分红金额必须大于 0；减仓份额必须在 (0, 当前持有] 区间内
        if (isAdd) {
            const buyAmount = parseFloat(result.amount);
            if (!Number.isFinite(buyAmount) || buyAmount <= 0) {
                await showAlert('请输入有效的买入金额（大于 0）');
                return;
            }
            result.amount = round2(buyAmount);
        } else if (isDividend) {
            const divAmount = parseFloat(result.dividendAmount);
            if (!Number.isFinite(divAmount) || divAmount <= 0) {
                await showAlert('请输入有效的分红金额（大于 0）');
                return;
            }
            result.dividendAmount = round2(divAmount);
        } else {
            const sellShares = parseFloat(result.shares);
            if (!Number.isFinite(sellShares) || sellShares <= 0) {
                await showAlert('请输入有效的卖出份额（大于 0）');
                return;
            }
            if (sellShares > maxShares + 0.0001) {
                await showAlert(`卖出份额不能超过当前持有份额（最多 ${roundShares(maxShares).toFixed(2)} 份）`);
                return;
            }
            result.shares = roundShares(Math.min(sellShares, maxShares));
        }

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
            // 减仓单按当前净值补记估算金额，保证订单流水金额字段完整
            amount: result.amount || result.dividendAmount
                || (!isAdd && !isDividend ? round2((parseFloat(result.shares) || 0) * (live?.prevPrice || live?.price || 0)) : 0),
            // 手动分红单必须显式写 dividendAmount/dividendDate/perShare：
            // normalizeTradeRecord 不从 amount 推导 dividendAmount，
            // 缺了会在确认时静默丢分红（holdProfit/positionCost 都按 0 处理）
            ...(isDividend ? {
                dividendAmount: round2(parseFloat(result.dividendAmount) || 0),
                dividendDate: todayStr,
                perShare: (fundItem.shares || 0) > 0
                    ? round6((parseFloat(result.dividendAmount) || 0) / fundItem.shares)
                    : 0
            } : {}),
            shares: roundShares(result.shares || 0),
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
        let shares = roundShares(safeFloat(result.shares, 0));
        const dividendAmount = safeFloat(result.amount, 0);

        const derived = await deriveAndValidateTradeInput(type, amount, shares, dividendAmount, navPrice, feeRate);
        if (!derived) return;
        ({ amount, shares } = derived);

        const live = await fetchLiveInfo(code);
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
            { id: 'shares', label: '份额', type: 'number', value: initialValues.shares || '', min: 0, step: '0.01' },
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
        const nextShares = roundShares(snapshot.shares);
        const currentShares = roundShares(safeFloat(fundItem.shares, 0));
        const nextAmount = currentNav > 0 ? round2(nextShares * currentNav) : round2(safeFloat(fundItem.amount, 0));
        const currentAmount = round2(safeFloat(fundItem.amount, 0));
        const nextAddedDate = snapshot.addedDate || null;
        const currentAddedDate = normalizePerfDate(fundItem.addedDate || '') || null;

        const sameShares = Math.abs(nextShares - currentShares) <= 0.001;
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
        { id: 'shares', label: '持有份额', type: 'number', value: fund?.shares ? roundShares(fund.shares) : '', step: '0.01' },
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
                            shareInput.value = roundShares(parseFloat(amtInput.value) / currentNav).toFixed(2);
                        }
                    }
                }
            });
        }

        amtInput.addEventListener('input', () => {
            const amt = parseFloat(amtInput.value) || 0;
            if (currentNav > 0) shareInput.value = roundShares(amt / currentNav).toFixed(2);
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
    const nextShares = roundShares(parseFloat(result.shares) || 0);
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

    // 新基金当天立即强制补齐历史净值，避免要等次日首次刷新才有走势图/收益率
    if (!existingCode) {
        syncFundHistory(code, true).catch(err => {
            console.warn(`[HistorySync] 新基金 ${code} 历史补齐失败:`, err);
        });
    }
}

