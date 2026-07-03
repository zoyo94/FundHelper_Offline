
// ==================== 修改：渲染表格 ====================

/**
 * 创建一个小字号半透明的补充信息 <span>
 * @param {string} text - 补充文字（已格式化）
 * @returns {HTMLSpanElement}
 */
function _makeExtraSpan(text) {
    const span = document.createElement('span');
    span.style.fontSize = '10px';
    span.style.opacity = '0.7';
    span.style.marginLeft = '3px';
    span.textContent = text;
    return span;
}

/**
 * 渲染收益金额 + 百分比到汇总元素
 * @param {HTMLElement} el - 目标 <b> 元素
 * @param {number} profit - 收益金额
 * @param {number} rate - 收益百分比
 */
function _renderProfitWithRate(el, profit, rate) {
    const main = document.createElement('span');
    main.textContent = formatProfit(profit);
    el.replaceChildren(main, _makeExtraSpan(formatProfit(rate, '%')));
    el.className = profit >= 0 ? 'up' : 'down';
}

/**
 * 渲染纯金额 + 补充文字到汇总元素（不带涨跌色）
 * @param {HTMLElement} el - 目标 <b> 元素
 * @param {number} amount - 主金额
 * @param {string} extraText - 补充文字
 */
function _renderAmountWithExtra(el, amount, extraText) {
    const main = document.createElement('span');
    main.textContent = amount.toLocaleString(undefined, { minimumFractionDigits: 2 });
    el.replaceChildren(main, _makeExtraSpan(extraText));
}

function renderTable() {
    let displayData = allFundsData.filter(item => groupFilterController.matches(item));
    displayData.sort((a, b) => {
        // 置顶基金优先排在最前面
        const aPinned = pinnedFunds.has(a.code) ? 1 : 0;
        const bPinned = pinnedFunds.has(b.code) ? 1 : 0;
        if (aPinned !== bPinned) return bPinned - aPinned;
        const valA = a[sortField] ?? 0;
        const valB = b[sortField] ?? 0;
        return (valA - valB) * sortDirection;
    });
    document.querySelectorAll('.sortable').forEach(th => {
        // 用 data-label 保存原始文字，避免 textContent 替换破坏子元素
        if (!th.dataset.label) th.dataset.label = th.textContent.trim();
        const arrow = th.dataset.sort === sortField ? (sortDirection === 1 ? ' ↑' : ' ↓') : '';
        th.textContent = th.dataset.label + arrow;
    });
    // 计算统计数据
    const { sumAmount, sumYesterdayProfit, sumTodayProfit, sumHoldProfit } = displayData.reduce(
        (acc, item) => ({
            sumAmount: acc.sumAmount + (item.amount || 0),
            sumYesterdayProfit: acc.sumYesterdayProfit + (item.yesterdayProfit || 0),
            sumTodayProfit: acc.sumTodayProfit + (item.todayProfit || 0),
            sumHoldProfit: acc.sumHoldProfit + (item.holdProfit || 0)
        }),
        { sumAmount: 0, sumYesterdayProfit: 0, sumTodayProfit: 0, sumHoldProfit: 0 }
    );

    const todayStr = getToday(); // 提到循环外，避免每次渲染行重复调用
    const fragment = document.createDocumentFragment();
    displayData.forEach((item, index) => {
        const todayProfitText = item.todayProfit === null
            ? '—'
            : formatProfit(item.todayProfit) + ' ';
        const tr = document.createElement('tr');
        tr.dataset.code = item.code;
        // 置顶行加特殊 class 用于样式高亮
        if (pinnedFunds.has(item.code)) {
            tr.classList.add('pinned-row');
        }
        _td(tr, String(index + 1), 'index');
        // -- 代码 --
        _td(tr, item.code, 'code');
        // -- 名称/分组 --
        const tdName = document.createElement('td');
        const nameSpan = document.createElement('span');
        nameSpan.className = 'fund-name';
        nameSpan.title = item.name;
        nameSpan.textContent = item.name;
        // 检查是否有待确认的分红
        const hasPendingDividend = item.hasPendingDividendForDisplay === true;
        if (hasPendingDividend) {
            const dividendBadge = document.createElement('span');
            dividendBadge.className = 'dividend-badge';
            dividendBadge.textContent = '分红';
            dividendBadge.title = '该基金有待确认的分红，数据可能不准确';
            tdName.appendChild(dividendBadge);
        }
        if (item.hasPendingBuy) {
            const buyBadge = document.createElement('span');
            buyBadge.className = 'buy-badge';
            buyBadge.textContent = '加仓中';
            buyBadge.title = '该基金有待确认的加仓交易';
            tdName.appendChild(buyBadge);
        }
        if (item.hasPendingSell) {
            const sellBadge = document.createElement('span');
            sellBadge.className = 'sell-badge';
            sellBadge.textContent = '减仓中';
            sellBadge.title = '该基金有待确认的减仓交易';
            tdName.appendChild(sellBadge);
        }
        const groupSpan = document.createElement('span');
        groupSpan.className = 'group-tag';
        groupSpan.dataset.code = item.code;
        groupSpan.textContent = item.group;
        // 图钉按钮
        const pinBtn = document.createElement('span');
        pinBtn.className = `pin-btn${pinnedFunds.has(item.code) ? ' is-pinned' : ''}`;
        pinBtn.title = pinnedFunds.has(item.code) ? '取消置顶' : '置顶';
        pinBtn.textContent = '📌';
        pinBtn.dataset.code = item.code;
        pinBtn.onclick = (e) => {
            e.stopPropagation();
            togglePinFund(item.code);
        };
        tdName.appendChild(nameSpan);
        tdName.appendChild(groupSpan);
        tdName.appendChild(pinBtn);
        tdName.dataset.col = 'name';
        setColumnVisibilityClass(tdName, 'name');
        tr.appendChild(tdName);
        // -- 持仓金额 (全屏和小屏都显示) --
        const tdAmount = document.createElement('td');
        tdAmount.dataset.col = 'amount';
        setColumnVisibilityClass(tdAmount, 'amount');
        // 【修改】在金额后也添加设置图标 (解决小窗口看不到份额列的问题)
        const amountWrapper = document.createElement('div');
        amountWrapper.className = 'cell-with-icon';
        const amountText = document.createElement('span');
        amountText.textContent = item.amount.toFixed(2);
        const gearIcon1 = document.createElement('span');
        gearIcon1.className = 'settings-icon';
        gearIcon1.textContent = '⚙️';
        gearIcon1.dataset.code = item.code;
        // 绑定点击事件
        gearIcon1.onclick = (e) => {
            e.stopPropagation();
            showCenterMenu(item.code);
        };
        amountWrapper.appendChild(amountText);
        amountWrapper.appendChild(gearIcon1);
        tdAmount.appendChild(amountWrapper);
        tr.appendChild(tdAmount);
        // -- 份额 (全屏显示) --
        const tdShares = document.createElement('td');
        tdShares.className = 'col-hide'; // 小屏隐藏
        tdShares.dataset.col = 'shares';
        setColumnVisibilityClass(tdShares, 'shares');
        const sharesWrapper = document.createElement('div');
        sharesWrapper.className = 'cell-with-icon';
        const sharesText = document.createElement('span');
        sharesText.textContent = item.shares ? roundShares(item.shares).toFixed(2) : '—';
        sharesWrapper.appendChild(sharesText);
        tdShares.appendChild(sharesWrapper);
        tr.appendChild(tdShares);
        // ... [净值列、昨日收益列、估值收益列代码保持不变] ...
        const tdNav = document.createElement('td');
        tdNav.className = 'col-hide';
        tdNav.dataset.col = 'nav';
        setColumnVisibilityClass(tdNav, 'nav');
        const prevNavLine = document.createElement('div');
        prevNavLine.style.cssText = 'display:flex; align-items:baseline; justify-content:center; gap:4px;';
        const navVal = document.createElement('span');
        navVal.textContent = item.prevPrice > 0 ? item.prevPrice.toFixed(4) : '—';
        navVal.style.fontWeight = '500';
        prevNavLine.appendChild(navVal);
        if (item.prevPriceDate) {
            const prevDateSpan = document.createElement('span');
            prevDateSpan.style.cssText = `font-size:10px; color:${item.prevPriceDate === todayStr ? '#8c8c8c' : '#fa8c16'};`;
            prevDateSpan.textContent = item.prevPriceDate.slice(5);
            prevNavLine.appendChild(prevDateSpan);
        }
        if (item.prevPrice > 0 && item.prevTradingDayPrice > 0) {
            const prevDayRate = typeof item.yesterdayRate === 'number'
                ? item.yesterdayRate
                : (item.prevPrice - item.prevTradingDayPrice) / item.prevTradingDayPrice * 100;
            const prevRateSpan = document.createElement('span');
            prevRateSpan.style.cssText = `font-size:10px; font-weight:bold; color:${prevDayRate >= 0 ? '#f5222d' : '#389e0d'};`;
            prevRateSpan.textContent = formatProfit(prevDayRate, '%');
            prevNavLine.appendChild(prevRateSpan);
        }
        tdNav.appendChild(prevNavLine);
        const liveNavLine = document.createElement('div');
        liveNavLine.style.cssText = 'display:flex; align-items:baseline; justify-content:center; gap:4px; margin-top:2px; flex-wrap:wrap;';
        const priceSpan = document.createElement('span');
        if (item.price > 0) {
            priceSpan.textContent = item.price.toFixed(4);
            priceSpan.style.cssText = 'font-weight:500; color:#ffc069;';
            const liveDateSpan = document.createElement('span');
            liveDateSpan.style.cssText = 'font-size:10px; color:#8c8c8c;';
            liveDateSpan.textContent = (item.priceTime || todayStr).slice(5);
            liveNavLine.appendChild(priceSpan);
            liveNavLine.appendChild(liveDateSpan);
        } else {
            priceSpan.textContent = '—';
            priceSpan.style.color = '#8c8c8c';
            liveNavLine.appendChild(priceSpan);
        }
        if (item.rate !== null && item.rate !== undefined) {
            const rateSpan = document.createElement('span');
            rateSpan.style.cssText = `font-size:11px; font-weight:bold; color:${item.rate >= 0 ? '#f5222d' : '#389e0d'};`;
            rateSpan.textContent = formatProfit(item.rate, '%') + ' ';
            liveNavLine.appendChild(rateSpan);
        }
        tdNav.appendChild(liveNavLine);
        tr.appendChild(tdNav);
        // -- 持有天数/区间涨跌幅 (全屏显示) --
        PERF_FIELDS.forEach(field => {
            const tdPerf = document.createElement('td');
            tdPerf.className = 'col-hide perf-cell';
            tdPerf.dataset.col = field;
            tdPerf.dataset.perf = field;
            setColumnVisibilityClass(tdPerf, field);
            tdPerf.textContent = '—';
            tr.appendChild(tdPerf);
        });
        renderFundPerfCells(tr, item.code);
        // -- 昨日收益 --
        const tdYesterday = document.createElement('td');
        tdYesterday.dataset.col = 'yesterdayProfit';
        tdYesterday.className = item.yesterdayProfit >= 0 ? 'up' : 'down';
        setColumnVisibilityClass(tdYesterday, 'yesterdayProfit');
        tdYesterday.textContent = formatProfit(item.yesterdayProfit);
        if (hasPendingDividend) {
            const warnYesterday = document.createElement('span');
            warnYesterday.textContent = ' ⚠';
            warnYesterday.title = '该基金有待确认的分红，昨日收益可能不准确';
            warnYesterday.style.cssText = 'color:#fa8c16;font-size:11px;cursor:default;';
            tdYesterday.appendChild(warnYesterday);
        }
        tr.appendChild(tdYesterday);
        const tdToday = document.createElement('td');
        tdToday.dataset.col = 'todayProfit';
        if (item.todayProfit !== null) {
            tdToday.className = item.todayProfit >= 0 ? 'up' : 'down';
        }
        setColumnVisibilityClass(tdToday, 'todayProfit');
        tdToday.textContent = todayProfitText;
        tr.appendChild(tdToday);
        // 累计收益
        const tdHoldProfit = document.createElement('td');
        tdHoldProfit.className = `editable-cell ${item.holdProfit >= 0 ? 'up' : 'down'}`;
        tdHoldProfit.dataset.col = 'holdProfit';
        setColumnVisibilityClass(tdHoldProfit, 'holdProfit');
        tdHoldProfit.contentEditable = 'true';
        tdHoldProfit.dataset.field = 'holdProfit';
        tdHoldProfit.dataset.code = item.code;
        tdHoldProfit.textContent = formatProfit(item.holdProfit) + ' ';
        if (hasPendingDividend) {
            const warnHold = document.createElement('span');
            warnHold.textContent = '⚠';
            warnHold.title = '该基金有待确认的分红，累计收益可能不准确';
            warnHold.style.cssText = 'color:#fa8c16;font-size:11px;cursor:default;';
            tdHoldProfit.appendChild(warnHold);
        }
        tr.appendChild(tdHoldProfit);
        // -- 操作列 (只保留删除) --
        const tdOp = document.createElement('td');
        tdOp.className = 'col-hide';
        tdOp.dataset.col = 'actions';
        setColumnVisibilityClass(tdOp, 'actions');
        const btnDel = document.createElement('button');
        btnDel.className = 'del-btn';
        btnDel.dataset.code = item.code;
        btnDel.title = '删除';
        btnDel.textContent = '✕';
        tdOp.appendChild(btnDel);
        tr.appendChild(tdOp);
        fragment.appendChild(tr);
    });
    elements.tableBody.replaceChildren(fragment);
    // ... [汇总统计代码保持不变] ...

    // 共用基准值：本金 = 当前持仓总金额 - 累计收益
    const principal = round2(sumAmount - sumHoldProfit);
    const safeRate = (profit, base) => base > 0 ? (profit / base * 100) : 0;

    // 总资产：金额 + 本金
    _renderAmountWithExtra(elements.totalAmount, sumAmount, `(本金 ${principal.toLocaleString(undefined, { minimumFractionDigits: 2 })})`);

    // 昨日收益：金额 + 百分比（基准 = 持仓总金额 - 昨日收益）
    _renderProfitWithRate(elements.totalYesterdayProfit, sumYesterdayProfit, safeRate(sumYesterdayProfit, sumAmount - sumYesterdayProfit));

    // 当日估值：金额 + 百分比（基准 = 持仓总金额）
    _renderProfitWithRate(elements.totalTodayProfit, sumTodayProfit, safeRate(sumTodayProfit, sumAmount));

    // 总累计收益：小窗口显示金额+百分比，全屏展示含浮动的补充信息
    const sumTotalProfit = sumHoldProfit + sumTodayProfit;
    const holdRate = safeRate(sumHoldProfit, principal);
    const isFullscreenMode = document.body.classList.contains('is-fullscreen');
    if (isFullscreenMode) {
        const totalProfitMain = document.createElement('span');
        totalProfitMain.textContent = formatProfit(sumHoldProfit);
        const extraText = `${formatProfit(holdRate, '%')} (含浮动 ${formatProfit(sumTotalProfit)})`;
        elements.totalTotalProfit.replaceChildren(totalProfitMain, _makeExtraSpan(extraText));
        elements.totalTotalProfit.className = sumTotalProfit >= 0 ? 'up' : 'down';
    } else {
        _renderProfitWithRate(elements.totalTotalProfit, sumHoldProfit, holdRate);
    }
    // 绑定删除按钮和分组标签事件
    elements.tableBody.onclick = (e) => {
        const target = e.target;
        const code = target.dataset.code;
        if (target.classList.contains('del-btn')) {
            removeFund(code);
        } else if (target.classList.contains('group-tag')) {
            openFundEditor(code);
        }
    };
    // 绑定可编辑单元格事件（使用防抖优化）
    const debouncedSave = debounce(async (code, field, val) => {
        const { myFunds } = await storageHelper.getAll(['myFunds']);
        const funds = myFunds || {};
        if (funds[code]) {
            if (funds[code][field] === val) return;
            funds[code][field] = val;
            const localItem = allFundsData.find(f => f.code === code);
            if (localItem) localItem[field] = val;
            await storageHelper.setAll({ myFunds: funds });
            showToast('✅ 基金备注信息已保存', 'success', CONFIG.TOAST_SHORT);
            renderTable();
        }
    }, CONFIG.DEBOUNCE_DELAY);

    elements.tableBody.querySelectorAll('.editable-cell[data-field]').forEach(cell => {
        cell.onblur = () => {
            const code = cell.dataset.code;
            const field = cell.dataset.field;
            const valStr = cell.textContent.trim();
            const val = parseFloat(valStr);
            if (valStr === '' || isNaN(val)) {
                showToast('请输入有效的数字', 'warning');
                renderTable(); // 恢复显示值，无需重新请求网络
                return;
            }
            debouncedSave(code, field, val);
        };
        cell.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); cell.blur(); } };
    });
    // ---- 行点击选择（文件管理器风格）----
    elements.tableBody.querySelectorAll('tr').forEach((tr, idx) => {
        // 渲染时恢复选中高亮
        if (tr.dataset.code && selectedCodes.has(tr.dataset.code)) {
            tr.classList.add('selected-row');
        }

        // 双击打开详情
        tr.addEventListener('dblclick', (e) => {
            // 点击操作按钮/齿轮/group-tag/del-btn/pin-btn 时不触发
            if (e.target.closest('.settings-icon, .group-tag, .del-btn, .pin-btn, button')) return;

            const code = tr.dataset.code;
            if (code) {
                openFundDetail(code);
            }
        });

        tr.addEventListener('click', (e) => {
            // 点击操作按钮/齿轮/group-tag/del-btn/pin-btn 时不触发选择
            if (e.target.closest('.settings-icon, .group-tag, .del-btn, .pin-btn, button')) return;

            const code = tr.dataset.code;
            if (!code) return;

            if (e.shiftKey && lastClickedIndex >= 0) {
                // 阻止 Shift 点击时浏览器默认的文字选中行为
                e.preventDefault();
                // Shift 点击：范围选（只加，不减）
                const start = Math.min(lastClickedIndex, idx);
                const end = Math.max(lastClickedIndex, idx);
                elements.tableBody.querySelectorAll('tr').forEach((r, i) => {
                    if (i >= start && i <= end && r.dataset.code) {
                        selectedCodes.add(r.dataset.code);
                        r.classList.add('selected-row');
                    }
                });
            } else {
                // 普通点击：切换选中状态
                if (selectedCodes.has(code)) {
                    selectedCodes.delete(code);
                    tr.classList.remove('selected-row');
                } else {
                    selectedCodes.add(code);
                    tr.classList.add('selected-row');
                }
                lastClickedIndex = idx;
            }

            updateSelectionStatus();
        });
    });

    updateSelectionStatus();
}

// ==================== 选中状态反馈 ====================
function updateSelectionStatus() {
    const count = selectedCodes.size;
    const fabMain = document.getElementById('fabMain');

    if (count > 0) {
        const countStrong = document.createElement('b');
        countStrong.style.color = '#69b1ff';
        countStrong.textContent = String(count);

        const clearBtn = document.createElement('span');
        clearBtn.id = 'clearSelectionBtn';
        clearBtn.style.color = '#ff7875';
        clearBtn.style.cursor = 'pointer';
        clearBtn.style.fontSize = '11px';
        clearBtn.style.border = '1px solid #ff7875';
        clearBtn.style.borderRadius = '10px';
        clearBtn.style.padding = '1px 7px';
        clearBtn.textContent = '✕ 取消选择';
        clearBtn.onclick = () => {
            clearSelection();
            renderTable();
        };

        elements.selectionStatus.style.display = '';
        elements.selectionStatus.replaceChildren(
            document.createTextNode('已选中 '),
            countStrong,
            document.createTextNode(' 项 '),
            clearBtn
        );
        if (fabMain) fabMain.style.background = '#fa8c16';
    } else {
        elements.selectionStatus.style.display = 'none';
        elements.selectionStatus.replaceChildren();
        if (fabMain) fabMain.style.background = '';
    }
}


function _td(tr, text, colId = null) {
    const td = document.createElement('td');
    td.textContent = text;
    if (colId) {
        td.dataset.col = colId;
        setColumnVisibilityClass(td, colId);
    }
    tr.appendChild(td);
    return td;
}

// 辅助函数：重置单个基金的持仓数据
function resetFundPosition(fund, shouldResetGroup = true) {
    fund.amount = 0;
    fund.shares = 0;
    fund.lastClosedAmount = 0;
    fund.yesterdayProfit = 0;
    if (shouldResetGroup) fund.group = "已撤回"; // 核心：根据参数决定是否改分组
    if (fund.cost !== undefined) fund.cost = 0;
    syncAddedDateByPosition(fund, getToday(), { preserveExistingAddedDate: false });
    // 注意：保留 holdProfit (累计收益)
}

function removeFundsFromHistory(codeList) {
    let changed = false;
    codeList.forEach(code => {
        if (fundHistoryData[code]) {
            delete fundHistoryData[code];
            changed = true;
        }
    });
    if (changed) saveFundHistoryData();
}

async function deleteFunds(codeList) {
    if (codeList.length === 0) return;
    const { myFunds } = await storageHelper.getAll(['myFunds']);
    const funds = myFunds || {};
    codeList.forEach(code => delete funds[code]);
    await Promise.all(codeList.flatMap(code => [
        HistoryDB.deleteOrdersByCode(code).catch(() => {}),
        HistoryDB.deleteStateRecordsByCode(code).catch(() => {})
    ]));
    clearSelection();
    removeFundsFromHistory(codeList);
    await storageHelper.setAll({ myFunds: funds });
}

async function removeFund(code) {
    const ok = await showConfirm(`确定删除 ${code}？`, '删除确认', true);
    if (!ok) return;
    await deleteFunds([code]);
    loadData();
}