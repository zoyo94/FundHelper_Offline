// ==================== 备份与结算状态管理 ====================
/**
 * 执行结算前，先备份当前数据（每天只备份首次结算前的数据）
 * @returns {Promise<void>}
 */
async function backupFundsData(snapshot) {
    const todayStr = getToday();
    const funds = snapshot?.myFunds || {};
    const backupFunds = snapshot?.backupFunds;
    if (Object.keys(funds).length === 0) return;

    if (backupFunds && backupFunds.backupDate === todayStr) {
        return;
    }

    const { settlementDate, blockedDate } = parseSettlementState(snapshot?.lastSettlementDate, snapshot?.autoSettlementBlockedDate);
    const { orders, states } = await HistoryDB.getAllExportData().catch(() => ({ orders: [], states: [] }));
    const backupData = {
        version: '1.1',
        exportDate: new Date().toISOString(),
        backupDate: todayStr,
        lastUpdateDate: snapshot?.lastUpdateDate || getToday(),
        lastDayProfits: snapshot?.lastDayProfits || {},
        lastSettlementDate: settlementDate,
        autoSettlementBlockedDate: blockedDate,
        myFunds: funds,
        dailyProfitHistory: normalizeDailyProfitHistory(snapshot?.dailyProfitHistory),
        tradeHistoryDB: Array.isArray(orders) ? orders : [],
        fundDailyStateDB: Array.isArray(states) ? states : []
    };
    await storageHelper.setAll({ backupFunds: backupData });
}

/**
 * 检测基金分红并计算总收益
 * @param {Object} fund - 基金数据对象
 * @param {Object} priceUpdate - 价格更新数据 {price, acNetValue, prevPriceDate, dividendList}
 * @param {number} shares - 持有份额
 * @returns {{ dividendPerShare: number, hasDividend: boolean, totalPeriodProfit: number }}
 */
function detectDividendAndProfit(fund, priceUpdate, shares) {
    const { price, acNetValue, prevPriceDate, dividendList } = priceUpdate;

    // 安全的基础价格计算：确保不会出现除零或undefined错误
    let basePrice = fund.savedPrevPrice;
    if (!basePrice && shares > 0 && fund.amount > 0) {
        basePrice = fund.amount / shares;
    }
    if (!basePrice || basePrice <= 0) {
        basePrice = price; // fallback到当前价格
    }

    const baseAcNet = fund.savedAcNetValue || null;
    const savedPrevDate = fund.savedPrevDate || '';

    let dividendPerShare = 0;
    const acNetValid = (acNetValue && baseAcNet);

    // 1. 优先使用累计净值差检测分红 (最精准)
    if (acNetValid) {
        const navDiff = price - basePrice;
        const acDiff = acNetValue - baseAcNet;
        dividendPerShare = round6(acDiff - navDiff);
        if (dividendPerShare < CONSTANTS.DIVIDEND_MIN_THRESHOLD) {
            dividendPerShare = 0;
        }
    }
    // 2. 兜底方案：累计净值不可用时，从分红列表补回分红金额
    else if (dividendList && Array.isArray(dividendList) && dividendList.length > 0) {
        for (const div of dividendList) {
            if (div && div.date && div.perShare && div.date > savedPrevDate && div.date <= (prevPriceDate || '')) {
                dividendPerShare = round6(dividendPerShare + div.perShare);
            }
        }
    }

    const hasDividend = dividendPerShare > CONSTANTS.DIVIDEND_MIN_THRESHOLD;

    // 3. 计算区间总收益
    let totalPeriodProfit;
    if (acNetValid) {
        // 累计净值已经包含分红，直接计算
        totalPeriodProfit = round2(shares * (acNetValue - baseAcNet));
    } else {
        // 没有累计净值时：单位净值差额 + 派发的现金补偿
        totalPeriodProfit = round2(shares * (price - basePrice + dividendPerShare));
        if (dividendPerShare > 0) {
            debugDividendTrace(fund.code || '', 'fallback-dividend-compensation', {
                dividendPerShare,
                savedPrevDate,
                prevPriceDate
            });
        }
    }

    return { dividendPerShare, hasDividend, totalPeriodProfit };
}

/**
 * 结算核心逻辑（手动/自动共用）
 * @param {Object}  funds         - myFunds 对象（直接修改）
 * @param {Array}   priceUpdates  - 各基金最新价格数据
 *                                  [{code, price, prevPriceDate, acNetValue,
 *                                    prevTradingDayPrice, prevTradingDayDate,
 *                                    dividendList}]
 * @param {string}  todayStr      - YYYY-MM-DD
 * @returns {number} 实际更新的基金数量
 */
async function _applySettlementLoop(funds, priceUpdates, todayStr) {
    let updatedCount = 0;
    for (const { code, price, prevPriceDate, acNetValue, prevTradingDayPrice, prevTradingDayDate, dividendList } of priceUpdates) {
        const item = funds[code];
        if (!item || price <= 0) continue;

        // ── 防护：shares 为 0 时从 amount 反推 ──────────────────────────────
        let shares = deriveFundShares(item, price);
        if (shares > 0 && !(item.shares > 0)) {
            funds[code].shares = shares;
        }

        // ── 无份额：仅更新净值锚点，不做任何收益计算 ────────────────────────
        if (shares <= 0) {
            funds[code].yesterdayProfit = 0;
            funds[code].savedPrevPrice = price;
            funds[code].savedPrevDate = prevPriceDate || todayStr;
            if (acNetValue) funds[code].savedAcNetValue = acNetValue;
            syncAddedDateByPosition(funds[code], todayStr);
            continue;
        }

        const baseAcNet = item.savedAcNetValue || null;

        // ── 分红检测与收益计算 ────────────────────────────────────────────────
        const { dividendPerShare, hasDividend, totalPeriodProfit } = detectDividendAndProfit(
            item,
            { price, acNetValue, prevPriceDate, dividendList },
            shares
        );
        debugDividendTrace(code, 'settlement-detect-dividend', {
            prevPriceDate: prevPriceDate || '',
            savedPrevDate: item.savedPrevDate || '',
            basePrice: item.savedPrevPrice || 0,
            price,
            hasDividend,
            dividendPerShare,
            totalPeriodProfit
        });

        const dividendMode = item.dividendMode || 'cash'; // 'cash' | 'reinvest'
        const totalDividend = hasDividend ? round2(shares * dividendPerShare) : 0;

        // 若结算层通过累计净值差识别到分红，但分红列表缺失导致未建单，
        // 在此兜底补一条自动分红订单，保证“收益修正”和“交易记录”一致。
        if (hasDividend && totalDividend > 0 && prevPriceDate) {
            const fallbackDividendDate = getSettlementFallbackDividendDate(item, prevPriceDate, dividendPerShare);
            debugDividendTrace(code, 'settlement-fallback-dividend-prepare', {
                prevPriceDate,
                fallbackDividendDate,
                dividendPerShare,
                totalDividend
            });
            const createdFallback = await ensureAutoDetectedDividendEntry(item, code, {
                date: fallbackDividendDate,
                perShare: dividendPerShare,
                navPrice: price
            }, todayStr, false, 'fallback');
            debugDividendTrace(code, createdFallback ? 'settlement-fallback-dividend-created' : 'settlement-fallback-dividend-skipped', {
                createdFallback,
                pendingCount: safeArray(runtimeTradeOrdersMap.get(code), []).filter(o => o.status !== 'confirmed').length
            });
        }

        // ── 单日昨日收益 ────────────────────────────────────────────────────────
        // 只要接口能提供上一笔有效净值，就按该净值差计算“昨日收益”。
        // 某些基金会因为停牌/节假日/接口缺口导致上一笔净值日期早于上一个自然日，
        // 此时仍应展示最近一个有效交易日对应的收益，而不是直接归 0。
        let yesterdayProfit = calculateYesterdayProfitValue(item, {
            price,
            prevPriceDate,
            prevTradingDayPrice,
            prevTradingDayDate,
            acNetValue: acNetValue,
            prevAcNetValue: item.savedAcNetValue
        });

        // 现金分红场景：昨日收益展示需要包含当日分红补偿，避免分红日出现误负值。
        // 分红入账由交易确认流程处理，将通过 getDisplayedYesterdayProfitValue 动态附加补偿，这里不再重复修改基础昨日收益。

        // ── 红利再投：增加份额 ────────────────────────────────────────────────
        if (hasDividend && dividendMode === 'reinvest' && price > 0) {
            const newShares = roundShares(totalDividend / price);
            shares = roundShares(shares + newShares);
            funds[code].shares = shares;
            const pendingReinvestOrder = getPendingAdjustments(item, code).find(order => {
                if (order.type !== 'dividend_reinvest' || order.reinvestApplied) return false;
                if (prevPriceDate && order.dividendDate && order.dividendDate !== prevPriceDate) return false;
                return Math.abs(safeFloat(order.dividendAmount, 0) - totalDividend) <= 0.01;
            });
            if (pendingReinvestOrder) {
                pendingReinvestOrder.status = 'confirmed';
                pendingReinvestOrder.confirmedDate = todayStr;
                pendingReinvestOrder.confirmedPrice = price;
                pendingReinvestOrder.shares = newShares;
                pendingReinvestOrder.confirmedShares = newShares;
                pendingReinvestOrder.reinvestApplied = true;
                await persistTradeOrder(pendingReinvestOrder, {
                    ...pendingReinvestOrder,
                    status: 'confirmed',
                    confirmedDate: todayStr,
                    confirmedPrice: price,
                    price,
                    shares: newShares,
                    confirmedShares: newShares,
                    reinvestApplied: true,
                    remark: pendingReinvestOrder.autoDetected ? '自动检测红利再投已由结算处理' : pendingReinvestOrder.remark
                });
            }
            debugDividendTrace(code, 'settlement-dividend-reinvest', {
                newShares,
                totalDividend,
                price,
                markedOrderId: pendingReinvestOrder?.id || pendingReinvestOrder?.orderId || null
            });
        }

        // ── 写回 ──────────────────────────────────────────────────────────────
        funds[code].holdProfit = round2((item.holdProfit || 0) + totalPeriodProfit);
        funds[code].yesterdayProfit = yesterdayProfit;
        funds[code].amount = round2(shares * price);
        funds[code].savedPrevPrice = price;
        funds[code].savedPrevDate = prevPriceDate || todayStr;
        if (acNetValue) {
            funds[code].savedAcNetValue = acNetValue;
        }
        syncAddedDateByPosition(funds[code], todayStr);

        if (hasDividend) {
            debugDividendTrace(code, 'settlement-writeback-dividend', {
                dividendMode,
                dividendPerShare,
                totalDividend,
                yesterdayProfit,
                holdProfit: funds[code].holdProfit,
                savedPrevDate: funds[code].savedPrevDate
            });
        }

        updatedCount++;
    }
    return updatedCount;
}

// ==================== 手动日结算 ====================
async function manualSettlement() {
    const ok = await showConfirm('确认进行日结算吗？\n系统将对比最新公布的净值与上次结算的净值，计算并记录收益。', '日结算确认');
    if (!ok) return;

    const todayStr = getToday();
    const { myFunds, lastUpdateDate, lastDayProfits, lastSettlementDate, autoSettlementBlockedDate, backupFunds, dailyProfitHistory } = await storageHelper.getAll([
        'myFunds',
        'lastUpdateDate',
        'lastDayProfits',
        'lastSettlementDate',
        'autoSettlementBlockedDate',
        'backupFunds',
        'dailyProfitHistory'
    ]);
    const funds = myFunds || {};
    const { blockedDate } = parseSettlementState(lastSettlementDate, autoSettlementBlockedDate);

    elements.statusText.innerText = '正在备份数据...';
    await backupFundsData(createBackupSnapshot({
        myFunds: funds,
        lastUpdateDate,
        lastDayProfits,
        lastSettlementDate,
        autoSettlementBlockedDate,
        backupFunds,
        dailyProfitHistory
    }));
    elements.statusText.innerText = '正在执行日结算...';

    const codes = Object.keys(funds);
    const fetchedData = [];
    for (let i = 0; i < codes.length; i += CONFIG.BATCH_SIZE) {
        const batch = codes.slice(i, i + CONFIG.BATCH_SIZE);
        const batchResults = await fetchBatchLiveInfo(
            batch,
            CONFIG.API_TIMEOUT,
            code => ({ name: `[超时]${code}`, rate: 0, price: 0, prevPrice: 0 })
        );
        fetchedData.push(...batchResults);
        if (i + CONFIG.BATCH_SIZE < codes.length) {
            await new Promise(resolve => setTimeout(resolve, CONFIG.BATCH_DELAY));
        }
    }

    // 手动结算也必须先跑分红检测，确保交易记录里有自动分红单。
    const tradeOrdersMap = await buildTradeOrdersMap(codes);
    await detectAutoDividends(funds, fetchedData, todayStr, tradeOrdersMap);

    const settlements = [];
    for (const { code, live } of fetchedData) {
        const settlement = buildSettlementEntry(code, live);
        if (settlement) settlements.push(settlement);
    }

    const dominantMarketPrevPriceDate = getDominantMarketPrevPriceDate(fetchedData);
    const updatedCount = await _applySettlementLoop(funds, settlements, todayStr);
    const { history: nextDailyProfitHistory } = recordDailyProfitHistory(dailyProfitHistory, funds, settlements, dominantMarketPrevPriceDate);

    await saveSettlementState(funds, todayStr, blockedDate === todayStr ? todayStr : null, nextDailyProfitHistory);
    showToast(`✅ 结算完成！已更新 ${updatedCount} 条`, 'success');
    checkBackup();
    loadData();
}

// ==================== 撤销结算 ====================
async function rollbackSettlement() {
    const { backupFunds } = await storageHelper.getAll(['backupFunds']);
    if (!hasTodayBackup(backupFunds)) {
        await showAlert('未找到今天的备份数据，无法撤销！');
        return;
    }

    const backupTime = backupFunds.exportDate ? new Date(backupFunds.exportDate).toLocaleString() : '未知时间';
    const ok = await showConfirm(
        `确定要撤销日结算吗？\n\n数据将恢复至备份时间：\n【${backupTime}】\n\n⚠️ 重要提示：\n• 撤销后，今日将不再自动结算\n• 如需重新结算，请手动点击「📅 触发日结算」\n• 撤销前可导出当前数据用于对比`,
        '撤销确认',
        true
    );
    if (!ok) return;

    const todayStr = getToday();
    const { settlementDate } = parseSettlementState(backupFunds.lastSettlementDate, backupFunds.autoSettlementBlockedDate);
    await storageHelper.setAll({
        myFunds: cloneData(backupFunds.myFunds),
        lastUpdateDate: backupFunds.lastUpdateDate || '',
        lastDayProfits: cloneData(backupFunds.lastDayProfits || {}),
        dailyProfitHistory: normalizeDailyProfitHistory(backupFunds.dailyProfitHistory),
        lastSettlementDate: settlementDate,
        autoSettlementBlockedDate: todayStr
    });

    if (Array.isArray(backupFunds.tradeHistoryDB)) {
        try {
            await HistoryDB.clearUserDataOnly();
            await HistoryDB.replaceOrders(backupFunds.tradeHistoryDB || []);
            await HistoryDB.replaceStateRecords(backupFunds.fundDailyStateDB || []);
        } catch (dbErr) {
            console.error('[rollbackSettlement] 恢复交易/状态库失败:', dbErr);
        }
    } else {
        try {
            await rollbackTodayConfirmedOrdersToPending(todayStr);
        } catch (fallbackErr) {
            console.error('[rollbackSettlement] 旧版备份兜底回滚交易失败:', fallbackErr);
        }
    }

    showToast('✅ 已撤销结算，数据已恢复！今日不再自动结算，如需结算请手动触发。', 'success', 5000);
    checkBackup();
    loadData();
}

// ==================== 自动结算 ====================
async function autoSettlement(funds, settlements, todayStr, backupSnapshot) {
    elements.statusText.innerText = '正在自动结算...';

    await backupFundsData(backupSnapshot);
    const dominantMarketPrevPriceDate = getDominantMarketPrevPriceDate(settlements.map(settlement => ({ live: settlement })));
    const updatedCount = await _applySettlementLoop(funds, settlements, todayStr);
    const { history: nextDailyProfitHistory } = recordDailyProfitHistory(backupSnapshot?.dailyProfitHistory, funds, settlements, dominantMarketPrevPriceDate);
    await saveSettlementState(funds, todayStr, null, nextDailyProfitHistory);

    if (updatedCount === 0) {
        return;
    }
    showToast('✅ 已自动完成日结算（' + updatedCount + ' 条）', 'success', 4000);
    checkBackup();
}


/**
 * 加载走势数据（从 storage 读取）
 * 只加载 activeCodes 中存在的基金，过滤掉已删除/导入前的残留数据和非今日数据。
 * @param {string[]} activeCodes - 当前 myFunds 中存在的基金代码列表
 */
async function loadFundHistoryData(activeCodes) {
    const todayStr = getToday();
    const activeSet = new Set(activeCodes);
    try {
        const { fundHistoryData: stored = {} } = await storageHelper.getAll(['fundHistoryData']);
        let loaded = 0;
        for (const code in stored) {
            // 双重过滤：必须是今日数据 && 必须是当前基金列表里的
            if (stored[code].date === todayStr && activeSet.has(code)) {
                fundHistoryData[code] = stored[code];
                loaded++;
            }
        }
    } catch (err) {
        console.warn('[走势数据] 加载失败:', err);
    }
}

/**
 * 持久化走势数据到 storage（优化：防抖，避免频繁写入）
 */
let saveFundHistoryTimer = null;
async function saveFundHistoryData() {
    if (saveFundHistoryTimer) clearTimeout(saveFundHistoryTimer);
    saveFundHistoryTimer = setTimeout(async () => {
        try {
            await storageHelper.setAll({ fundHistoryData });
        } catch (err) {
            console.warn('[走势数据] 保存失败:', err);
        }
    }, 1000); // 1秒防抖
}

const refreshIntervalPicker = (() => {
    let rootEl, triggerEl, popoverEl;
    let isOpen = false; // 手动跟踪状态

    function renderOptions() {
        if (!popoverEl) {
            console.warn('[refreshIntervalPicker] popoverEl 不存在，无法渲染');
            return;
        }
        const current = getAutoRefreshIntervalSeconds();
        popoverEl.replaceChildren();
        CONFIG.AUTO_REFRESH_OPTIONS.forEach(sec => {
            const opt = document.createElement('div');
            opt.className = 'refresh-interval-option' + (sec === current ? ' is-active' : '');
            opt.setAttribute('role', 'option');
            opt.setAttribute('aria-selected', sec === current ? 'true' : 'false');
            const check = document.createElement('span');
            check.className = 'opt-check';
            check.textContent = '✓';
            const label = document.createElement('span');
            label.className = 'opt-label';
            label.textContent = `${sec}s`;
            opt.append(check, label);
            opt.addEventListener('click', async (e) => {
                e.stopPropagation();
                await setAutoRefreshInterval(sec);
                close();
                renderOptions();
            });
            popoverEl.appendChild(opt);
        });
    }

    function open() {
        if (!popoverEl) return;
        popoverEl.removeAttribute('hidden');
        if (triggerEl) triggerEl.setAttribute('aria-expanded', 'true');
        isOpen = true;
    }

    function close() {
        if (!popoverEl) return;
        popoverEl.setAttribute('hidden', '');
        if (triggerEl) triggerEl.setAttribute('aria-expanded', 'false');
        isOpen = false;
    }

    return {
        bind() {
            rootEl = document.getElementById('refreshIntervalPicker');
            if (!rootEl) {
                console.error('[refreshIntervalPicker] 未找到根元素 #refreshIntervalPicker');
                return;
            }
            triggerEl = rootEl.querySelector('.refresh-interval-trigger');
            popoverEl = rootEl.querySelector('.refresh-interval-popover');
            if (!triggerEl || !popoverEl) {
                console.error('[refreshIntervalPicker] 未找到触发器或弹出层元素');
                return;
            }

            // 移除旧监听
            triggerEl.removeEventListener('click', this._boundToggle);
            this._boundToggle = (e) => {
                e.stopPropagation();
                if (isOpen) {
                    close();
                } else {
                    open();
                }
            };
            triggerEl.addEventListener('click', this._boundToggle);

            document.removeEventListener('click', this._boundOutside);
            this._boundOutside = (e) => {
                if (!rootEl.contains(e.target)) {
                    close();
                }
            };
            document.addEventListener('click', this._boundOutside);

            // 初始渲染选项并默认关闭
            renderOptions();
            close();
        },
        sync() {
            // 只刷新选项，不改变打开/关闭状态
            renderOptions();
            // 根据当前状态重新应用样式
            if (isOpen) {
                open();
            } else {
                close();
            }
        }
    };
})();


const groupFilterController = (() => {
    const ALL = '__all__';
    let availableGroups = [];
    let selected = new Set([ALL]);
    const changeListeners = [];
    let rootEl = null;
    let triggerEl = null;
    let labelEl = null;
    let popoverEl = null;

    function ensureValid() {
        if (selected.size === 0) selected = new Set([ALL]);
        if (selected.has(ALL) && selected.size > 1) selected = new Set([ALL]);
    }

    function updateLabel() {
        if (!labelEl || !rootEl) return;
        if (selected.has(ALL)) {
            labelEl.textContent = '全部显示';
            rootEl.setAttribute('data-state', 'all');
        } else if (selected.size === 1) {
            labelEl.textContent = [...selected][0];
            rootEl.setAttribute('data-state', 'one');
        } else {
            labelEl.textContent = `${selected.size} 个分组`;
            rootEl.setAttribute('data-state', 'multi');
        }
    }

    function rebuildPopover() {
        if (!popoverEl) return;
        popoverEl.replaceChildren();
        const makeRow = (value, text, isAll) => {
            const row = document.createElement('label');
            row.className = 'multi-select-option' + (isAll ? ' is-all' : '');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = value;
            cb.checked = selected.has(value);
            cb.addEventListener('change', () => {
                if (isAll) {
                    selected = cb.checked ? new Set([ALL]) : new Set();
                } else {
                    selected.delete(ALL);
                    if (cb.checked) selected.add(value);
                    else selected.delete(value);
                    if (availableGroups.length > 0 && selected.size >= availableGroups.length) {
                        selected = new Set([ALL]);
                    }
                }
                ensureValid();
                rebuildPopover();
                updateLabel();
                for (const fn of changeListeners) {
                    try { fn(); } catch (_) {}
                }
            });
            const span = document.createElement('span');
            span.className = 'multi-select-option-text';
            span.textContent = text;
            const mark = document.createElement('span');
            mark.className = 'multi-select-option-mark';
            mark.setAttribute('aria-hidden', 'true');
            mark.textContent = '✓';
            row.append(cb, span, mark);
            popoverEl.appendChild(row);
        };
        makeRow(ALL, '全部显示', true);
        availableGroups.forEach(g => makeRow(g, g, false));
    }

    return {
        bind() {
            rootEl = document.getElementById('groupFilter');
            if (!rootEl) return;
            triggerEl = rootEl.querySelector('.multi-select-trigger');
            labelEl = rootEl.querySelector('.multi-select-label');
            popoverEl = rootEl.querySelector('.multi-select-popover');
            if (!triggerEl || !popoverEl) return;
            triggerEl.addEventListener('click', (e) => {
                e.stopPropagation();
                const willOpen = popoverEl.hidden;
                popoverEl.hidden = !willOpen;
                triggerEl.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            });
            document.addEventListener('click', (e) => {
                if (popoverEl.hidden) return;
                if (!rootEl.contains(e.target)) {
                    popoverEl.hidden = true;
                    triggerEl.setAttribute('aria-expanded', 'false');
                }
            });
            popoverEl.addEventListener('click', (e) => e.stopPropagation());
            updateLabel();
        },
        populate(groups) {
            availableGroups = Array.from(new Set(groups || [])).sort();
            for (const v of [...selected]) {
                if (v !== ALL && !availableGroups.includes(v)) selected.delete(v);
            }
            ensureValid();
            rebuildPopover();
            updateLabel();
        },
        matches(item) {
            if (selected.has(ALL)) return true;
            return selected.has((item && item.group) || '默认');
        },
        isAll() { return selected.has(ALL); },
        selectedGroups() { return selected.has(ALL) ? [] : [...selected]; },
        onChange(fn) {
            if (typeof fn === 'function') changeListeners.push(fn);
        },
        titleLabel() {
            if (selected.has(ALL)) return '';
            if (selected.size === 1) return [...selected][0];
            return `${selected.size} 个分组`;
        },
        serialize() {
            return selected.has(ALL) ? 'all' : [...selected].sort().join('|');
        }
    };
})();

function updateGroupFilter() {
    const groupList = elements.groupList;
    const groups = Array.from(new Set(allFundsData.map(item => item.group || '默认'))).sort();
    groupFilterController.populate(groups);
    if (groupList) {
        groupList.replaceChildren();
        groups.forEach(group => {
            const option = document.createElement('option');
            option.value = group;
            groupList.appendChild(option);
        });
    }
}

