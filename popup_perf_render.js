
// ==================== 修改：渲染表格 ====================

/**
 * 创建一个小字号半透明的补充信息 <span>
 * @param {string} text - 补充文字（已格式化）
 * @returns {HTMLSpanElement}
 */
function _makeExtraSpan(text) {
    const span = document.createElement('span');
    span.className = 'summary-extra';
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

/**
 * 渲染收益单元格：金额在上，百分比在下（上下排列节省列宽）
 * 不修改 td 自身 display，避免破坏表格列布局；用内部 div 堆叠
 * @param {HTMLTableCellElement} td - 目标 <td>
 * @param {string} profitText - 金额文本
 * @param {string} rateText - 百分比文本（可选）
 */
function _renderProfitCell(td, profitText, rateText = '') {
    td.textContent = '';
    const amountDiv = document.createElement('div');
    amountDiv.textContent = profitText;
    td.appendChild(amountDiv);
    if (rateText) {
        const rateDiv = document.createElement('div');
        rateDiv.className = 'profit-rate-sub';
        rateDiv.textContent = rateText;
        td.appendChild(rateDiv);
    }
}

// ==================== 单元格渲染子函数 ====================
// 每个 cell 一个函数，renderTable 主流程只负责拼装；样式由 CSS class 控制（见 popup_components.css）

function _renderNameCell(tr, item) {
    const td = document.createElement('td');
    td.dataset.col = 'name';
    setColumnVisibilityClass(td, 'name');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'fund-name';
    nameSpan.title = item.name;
    nameSpan.textContent = item.name;
    td.appendChild(nameSpan);

    if (item.hasPendingDividendForDisplay === true) {
        const badge = document.createElement('span');
        badge.className = 'dividend-badge';
        badge.textContent = '分红';
        badge.title = '该基金有待确认的分红，数据可能不准确';
        td.appendChild(badge);
    }
    if (item.hasPendingBuy) {
        const badge = document.createElement('span');
        badge.className = 'buy-badge';
        badge.textContent = '加仓中';
        badge.title = '该基金有待确认的加仓交易';
        td.appendChild(badge);
    }
    if (item.hasPendingSell) {
        const badge = document.createElement('span');
        badge.className = 'sell-badge';
        badge.textContent = '减仓中';
        badge.title = '该基金有待确认的减仓交易';
        td.appendChild(badge);
    }

    const groupSpan = document.createElement('span');
    groupSpan.className = 'group-tag';
    groupSpan.dataset.code = item.code;
    groupSpan.textContent = item.group;
    td.appendChild(groupSpan);

    const pinBtn = document.createElement('span');
    pinBtn.className = `pin-btn${pinnedFunds.has(item.code) ? ' is-pinned' : ''}`;
    pinBtn.title = pinnedFunds.has(item.code) ? '取消置顶' : '置顶';
    pinBtn.textContent = '📌';
    pinBtn.dataset.code = item.code;
    pinBtn.onclick = (e) => { e.stopPropagation(); togglePinFund(item.code); };
    td.appendChild(pinBtn);

    tr.appendChild(td);
}

function _renderAmountCell(tr, item) {
    const td = document.createElement('td');
    td.dataset.col = 'amount';
    setColumnVisibilityClass(td, 'amount');

    const wrapper = document.createElement('div');
    wrapper.className = 'cell-with-icon';
    const text = document.createElement('span');
    text.textContent = item.amount.toFixed(2);
    const gear = document.createElement('span');
    gear.className = 'settings-icon';
    gear.textContent = '⚙️';
    gear.dataset.code = item.code;
    gear.onclick = (e) => { e.stopPropagation(); showCenterMenu(item.code); };
    wrapper.appendChild(text);
    wrapper.appendChild(gear);
    td.appendChild(wrapper);
    tr.appendChild(td);
}

function _renderSharesCell(tr, item) {
    const td = document.createElement('td');
    td.className = 'col-hide';
    td.dataset.col = 'shares';
    setColumnVisibilityClass(td, 'shares');

    const wrapper = document.createElement('div');
    wrapper.className = 'cell-with-icon';
    const text = document.createElement('span');
    text.textContent = item.shares ? roundShares(item.shares).toFixed(2) : '—';
    wrapper.appendChild(text);
    td.appendChild(wrapper);
    tr.appendChild(td);
}

function _renderNavCell(tr, item, todayStr) {
    const td = document.createElement('td');
    td.className = 'col-hide';
    td.dataset.col = 'nav';
    setColumnVisibilityClass(td, 'nav');

    const grid = document.createElement('div');
    grid.className = 'nav-grid';
    const prevCol = document.createElement('div');
    const liveCol = document.createElement('div');

    // 左列：昨收
    const navVal = document.createElement('div');
    navVal.className = 'nav-value';
    navVal.textContent = item.prevPrice > 0 ? item.prevPrice.toFixed(4) : '—';
    prevCol.appendChild(navVal);
    if (item.prevPriceDate) {
        const dateSpan = document.createElement('div');
        // 今天=灰色(nav-date 默认)，非今天=橙色警示(nav-date-stale)
        dateSpan.className = 'nav-date' + (item.prevPriceDate === todayStr ? '' : ' nav-date-stale');
        dateSpan.textContent = item.prevPriceDate.slice(5);
        prevCol.appendChild(dateSpan);
    }
    if (item.prevPrice > 0 && item.prevTradingDayPrice > 0) {
        const prevDayRate = typeof item.yesterdayNavRate === 'number'
            ? item.yesterdayNavRate
            : (item.prevPrice - item.prevTradingDayPrice) / item.prevTradingDayPrice * 100;
        const rateSpan = document.createElement('div');
        rateSpan.className = `nav-rate ${prevDayRate >= 0 ? 'up' : 'down'}`;
        rateSpan.title = '昨日较前一交易日净值涨幅';
        rateSpan.textContent = formatProfit(prevDayRate, '%');
        prevCol.appendChild(rateSpan);
    }

    // 右列：今估
    if (item.price > 0) {
        const priceSpan = document.createElement('div');
        priceSpan.className = 'nav-live-value';
        priceSpan.textContent = item.price.toFixed(4);
        liveCol.appendChild(priceSpan);
        const liveDateSpan = document.createElement('div');
        liveDateSpan.className = 'nav-date';
        liveDateSpan.textContent = item.isPenetration ? '穿透预估' : (item.priceTime || todayStr).slice(5, 10);
        if (item.isPenetration) {
            liveDateSpan.style.color = '#13c2c2';
            liveDateSpan.title = '基于最新披露前十大重仓盘中实时行情加权穿透计算';
        }
        liveCol.appendChild(liveDateSpan);
        if (item.rate !== null && item.rate !== undefined) {
            const rateSpan = document.createElement('div');
            rateSpan.className = `nav-rate ${item.rate >= 0 ? 'up' : 'down'}`;
            rateSpan.textContent = formatProfit(item.rate, '%');
            liveCol.appendChild(rateSpan);
        }
    } else {
        const priceSpan = document.createElement('div');
        priceSpan.className = 'nav-empty';
        priceSpan.textContent = '—';
        liveCol.appendChild(priceSpan);
    }

    grid.appendChild(prevCol);
    grid.appendChild(liveCol);
    td.appendChild(grid);
    tr.appendChild(td);
}

function _renderYesterdayCell(tr, item, yesterdayStr) {
    const td = document.createElement('td');
    td.dataset.col = 'yesterdayProfit';
    setColumnVisibilityClass(td, 'yesterdayProfit');

    const yestRateVal = typeof item.yesterdayNavRate === 'number'
        ? item.yesterdayNavRate
        : (item.prevPrice > 0 && item.prevTradingDayPrice > 0 ? (item.prevPrice - item.prevTradingDayPrice) / item.prevTradingDayPrice * 100 : null);
    const yestRateText = (yestRateVal !== null && !isNaN(yestRateVal)) ? `(${formatProfit(yestRateVal, '%')})` : '';
    const yestDateStr = item.prevPriceDate ? item.prevPriceDate.slice(5) : '';
    const isRealYesterday = item.prevPriceDate === yesterdayStr;

    if (isRealYesterday) {
        td.className = item.yesterdayProfit >= 0 ? 'up' : 'down';
        td.title = `昨日收益：${formatProfit(item.yesterdayProfit)} ${yestRateText}`.trim();
        _renderProfitCell(td, formatProfit(item.yesterdayProfit), yestRateText);
    } else {
        td.className = '';
        td.title = `昨日无净值更新，最近结算于 ${yestDateStr || '—'}：${formatProfit(item.yesterdayProfit)} ${yestRateText}`.trim();
        _renderProfitCell(td, '—', '');
        if (yestDateStr) {
            const dateDiv = document.createElement('div');
            dateDiv.className = 'settle-date';
            dateDiv.textContent = `结算 ${yestDateStr}`;
            td.appendChild(dateDiv);
        }
    }

    if (item.hasPendingDividendForDisplay === true) {
        const warn = document.createElement('span');
        warn.className = 'warn-icon';
        warn.textContent = ' ⚠';
        warn.title = '该基金有待确认的分红，昨日收益可能不准确';
        td.appendChild(warn);
    }
    tr.appendChild(td);
}

function _renderTodayCell(tr, item, todayStr) {
    const td = document.createElement('td');
    td.dataset.col = 'todayProfit';

    const hasEstimate = (item.rate !== null && item.rate !== undefined) || item.isPenetration;

    if (item.todayProfit !== null && hasEstimate) {
        td.className = item.todayProfit >= 0 ? 'up' : 'down';
    }
    setColumnVisibilityClass(td, 'todayProfit');

    let profitText, rateText;
    if (item.todayProfit === null || !hasEstimate) {
        profitText = '—';
        rateText = '';
        td.title = `暂无盘中估值（纯债/定开/FOF等通常无实时估值，最新净值 ${item.prevPriceDate || '—'}：${(item.prevPrice || 0).toFixed(4)}，待公布净值）`;
    } else {
        profitText = formatProfit(item.todayProfit);
        rateText = (item.rate !== null && item.rate !== undefined) ? `(${formatProfit(item.rate, '%')})` : '';
        if (item.isPenetration) {
            const penTypeLabel = item.penetrationType === 'fof' ? '重仓基金' : '重仓股票';
            const weightText = item.penetrationWeight > 0 ? ` (前十大${penTypeLabel}占比 ${item.penetrationWeight}%)` : '';
            td.title = `持仓穿透估值${weightText}：盘中实时撮合计算，预估涨跌 ${formatProfit(item.rate, '%')}`;
        }
    }
    _renderProfitCell(td, profitText, rateText);

    if (item.isPenetration) {
        const badge = document.createElement('span');
        badge.className = 'penetration-badge';
        badge.textContent = '穿透';
        badge.title = '持仓穿透估值（基于最新披露前十大重仓盘中实时行情计算）';
        td.appendChild(badge);
    }

    tr.appendChild(td);
}

function _renderPositionProfitCell(tr, item) {
    const td = document.createElement('td');
    td.dataset.col = 'positionProfit';
    setColumnVisibilityClass(td, 'positionProfit');

    // 无订单反推依据（旧迁移/手动建仓，成本按金额兜底）或无持仓时显示占位，
    // 避免误导性的 "+0.00" 带涨跌色
    if (item.positionCostReliable !== true || (item.shares || 0) <= 0) {
        _renderProfitCell(td, '—', '');
        tr.appendChild(td);
        return;
    }

    td.className = (item.positionProfit || 0) >= 0 ? 'up' : 'down';
    // 成本为 0（现金分红已回本）时不展示百分比，仅展示金额（此时金额即全部利润）
    const posRateText = (item.positionCost > 0)
        ? `(${formatProfit(round2(((item.positionProfit || 0) / item.positionCost) * 100), '%')})`
        : '';
    _renderProfitCell(td, formatProfit(item.positionProfit || 0), posRateText);
    tr.appendChild(td);
}

function _renderHoldProfitCell(tr, item) {
    const td = document.createElement('td');
    td.className = `editable-cell ${item.holdProfit >= 0 ? 'up' : 'down'}`;
    td.dataset.col = 'holdProfit';
    setColumnVisibilityClass(td, 'holdProfit');
    td.contentEditable = 'true';
    td.dataset.field = 'holdProfit';
    td.dataset.code = item.code;
    td.style.textAlign = '';

    const amountDiv = document.createElement('div');
    amountDiv.textContent = formatProfit(item.holdProfit);
    td.appendChild(amountDiv);

    // 累计收益率：优先用历史订单总买入成本，无订单数据则回退 amount - holdProfit
    const investedCost = (item.totalInvestedCost > 0)
        ? item.totalInvestedCost
        : Math.max(0, (item.amount || 0) - (item.holdProfit || 0));
    if (investedCost > 0) {
        const holdProfitRate = ((item.holdProfit || 0) / investedCost) * 100;
        const rateDiv = document.createElement('div');
        rateDiv.className = 'profit-rate-sub';
        rateDiv.textContent = `(${formatProfit(holdProfitRate, '%')})`;
        td.appendChild(rateDiv);
    }

    if (item.hasPendingDividendForDisplay === true) {
        const warn = document.createElement('span');
        warn.className = 'warn-icon';
        warn.textContent = ' ⚠';
        warn.title = '该基金有待确认的分红，累计收益可能不准确';
        td.appendChild(warn);
    }
    tr.appendChild(td);
}

function _renderActionsCell(tr, item) {
    const td = document.createElement('td');
    td.className = 'col-hide';
    td.dataset.col = 'actions';
    setColumnVisibilityClass(td, 'actions');
    const btn = document.createElement('button');
    btn.className = 'del-btn';
    btn.dataset.code = item.code;
    btn.title = '删除';
    btn.textContent = '✕';
    td.appendChild(btn);
    tr.appendChild(td);
}

function _renderSummary({ sumAmount, sumYesterdayProfit, sumTodayProfit, sumHoldProfit, sumPositionProfit }) {
    // 共用基准值：本金 = 当前持仓总金额 - 累计收益
    const principal = round2(sumAmount - sumHoldProfit);
    const safeRate = (profit, base) => base > 0 ? (profit / base * 100) : 0;

    // 总资产：金额 + 本金
    _renderAmountWithExtra(elements.totalAmount, sumAmount, `(本金 ${principal.toLocaleString(undefined, { minimumFractionDigits: 2 })})`);

    // 昨日收益：金额 + 百分比（基准 = 持仓总金额 - 昨日收益）
    _renderProfitWithRate(elements.totalYesterdayProfit, sumYesterdayProfit, safeRate(sumYesterdayProfit, sumAmount - sumYesterdayProfit));

    // 当日估值：金额 + 百分比（基准 = 持仓总金额）
    _renderProfitWithRate(elements.totalTodayProfit, sumTodayProfit, safeRate(sumTodayProfit, sumAmount));

    // 持仓收益：金额 + 百分比（基准 = 持仓成本 = 总资产 - 持仓收益）
    _renderProfitWithRate(elements.totalPositionProfit, sumPositionProfit, safeRate(sumPositionProfit, sumAmount - sumPositionProfit));

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
}

function renderTable() {
    let displayData = allFundsData.filter(item =>
        groupFilterController.matches(item) && fundSearchController.matches(item)
    );
    displayData.sort((a, b) => {
        // 置顶基金优先排在最前面
        const aPinned = pinnedFunds.has(a.code) ? 1 : 0;
        const bPinned = pinnedFunds.has(b.code) ? 1 : 0;
        if (aPinned !== bPinned) return bPinned - aPinned;
        const valA = a[sortField] ?? 0;
        const valB = b[sortField] ?? 0;
        // 非数值字段（如期货代码 AU2512）直接相减得 NaN，排序会乱；退化为字典序
        const numA = Number(valA);
        const numB = Number(valB);
        if (Number.isNaN(numA) || Number.isNaN(numB)) {
            return String(valA).localeCompare(String(valB)) * sortDirection;
        }
        return (numA - numB) * sortDirection;
    });
    document.querySelectorAll('.sortable').forEach(th => {
        // 用 data-label 保存原始文字，避免 textContent 替换破坏子元素
        if (!th.dataset.label) th.dataset.label = th.textContent.trim();
        const arrow = th.dataset.sort === sortField ? (sortDirection === 1 ? ' ↑' : ' ↓') : '';
        th.textContent = th.dataset.label + arrow;
    });
    // 计算统计数据
    // “昨日收益”严格限定为 prevPriceDate === 最新交易日（周二至周五为昨日自然日，周一/周末为上周五）的收益；
    // 若昨天无净值更新（节假日/QDII/定开债滞后），该基金昨日收益计为 0，不虚增总额。
    const todayStr = getToday();
    const latestTradingDayStr = typeof getLatestTradingDay === 'function'
        ? getLatestTradingDay()
        : formatDate(new Date(Date.now() - CONSTANTS.DAY_MS));
    const { sumAmount, sumYesterdayProfit, sumTodayProfit, sumHoldProfit, sumPositionProfit } = displayData.reduce(
        (acc, item) => ({
            sumAmount: acc.sumAmount + (item.amount || 0),
            sumYesterdayProfit: acc.sumYesterdayProfit + (item.prevPriceDate === latestTradingDayStr ? (item.yesterdayProfit || 0) : 0),
            sumTodayProfit: acc.sumTodayProfit + (item.todayProfit || 0),
            sumHoldProfit: acc.sumHoldProfit + (item.holdProfit || 0),
            sumPositionProfit: acc.sumPositionProfit + (item.positionProfit || 0)
        }),
        { sumAmount: 0, sumYesterdayProfit: 0, sumTodayProfit: 0, sumHoldProfit: 0, sumPositionProfit: 0 }
    );

    const fragment = document.createDocumentFragment();
    displayData.forEach((item, index) => {
        const tr = document.createElement('tr');
        tr.dataset.code = item.code;
        tr.dataset.idx = index;   // 供 tableBody 事件委托计算 Shift 范围选
        if (pinnedFunds.has(item.code)) tr.classList.add('pinned-row');
        _td(tr, String(index + 1), 'index');
        _td(tr, item.code, 'code');
        _renderNameCell(tr, item);
        _renderAmountCell(tr, item);
        _renderSharesCell(tr, item);
        _renderNavCell(tr, item, todayStr);
        // 持有天数/区间涨跌幅
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
        _renderYesterdayCell(tr, item, latestTradingDayStr);
        _renderTodayCell(tr, item, todayStr);
        _renderPositionProfitCell(tr, item);
        _renderHoldProfitCell(tr, item);
        _renderActionsCell(tr, item);
        fragment.appendChild(tr);
    });
    // 用户正在编辑可编辑单元格（如累计收益）时跳过 tbody 重建：
    // 定时刷新若此时 replaceChildren 会把焦点和未保存输入冲掉；
    // 汇总行照常更新，失焦保存后 debouncedSave 会再次触发 renderTable 完成重建
    const activeEl = document.activeElement;
    const isEditingCell = Boolean(
        activeEl
        && activeEl.classList
        && activeEl.classList.contains('editable-cell')
        && elements.tableBody.contains(activeEl)
    );
    if (!isEditingCell) {
        elements.tableBody.replaceChildren(fragment);
    }

    _renderSummary({ sumAmount, sumYesterdayProfit, sumTodayProfit, sumHoldProfit, sumPositionProfit });
    // 行交互统一委托到 tableBody（click + dblclick），避免每次 renderTable 逐行 addEventListener
    elements.tableBody.onclick = (e) => {
        const target = e.target;
        // 1) 操作按钮优先处理
        const delBtn = target.closest('.del-btn');
        if (delBtn) { removeFund(delBtn.dataset.code); return; }
        const groupTag = target.closest('.group-tag');
        if (groupTag) { openFundEditor(groupTag.dataset.code); return; }
        // 2) 排除齿轮/图钉等已有自身 onclick + stopPropagation 的元素
        if (target.closest('.settings-icon, .pin-btn, button')) return;
        // 3) 行选择（文件管理器风格：普通点击切换，Shift 范围选）
        const tr = target.closest('tr');
        if (!tr || !tr.dataset.code) return;
        const code = tr.dataset.code;
        const idx = parseInt(tr.dataset.idx, 10);
        if (e.shiftKey && lastClickedIndex >= 0 && !Number.isNaN(idx)) {
            e.preventDefault(); // 阻止 Shift 点击的默认文字选中
            const rows = elements.tableBody.querySelectorAll('tr');
            const start = Math.min(lastClickedIndex, idx);
            const end = Math.max(lastClickedIndex, idx);
            for (let i = start; i <= end; i++) {
                const r = rows[i];
                if (r && r.dataset.code) {
                    selectedCodes.add(r.dataset.code);
                    r.classList.add('selected-row');
                }
            }
        } else {
            if (selectedCodes.has(code)) {
                selectedCodes.delete(code);
                tr.classList.remove('selected-row');
            } else {
                selectedCodes.add(code);
                tr.classList.add('selected-row');
            }
            if (!Number.isNaN(idx)) lastClickedIndex = idx;
        }
        updateSelectionStatus();
    };
    elements.tableBody.ondblclick = (e) => {
        if (e.target.closest('.settings-icon, .group-tag, .del-btn, .pin-btn, button')) return;
        const tr = e.target.closest('tr');
        if (tr && tr.dataset.code) openFundDetail(tr.dataset.code);
    };
    // 绑定可编辑单元格事件（使用防抖优化）
    const debouncedSave = debounce(async (code, field, val) => {
        try {
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
        } catch (err) {
            console.error('[editable-cell] 保存失败:', err);
            showToast('保存失败，请重试', 'error');
            renderTable(); // 恢复显示为存储中的值，避免用户以为已保存
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
    // 渲染时恢复选中高亮（行点击/双击/Shift 范围选已委托到 tableBody.onclick / ondblclick）
    elements.tableBody.querySelectorAll('tr').forEach((tr) => {
        if (tr.dataset.code && selectedCodes.has(tr.dataset.code)) {
            tr.classList.add('selected-row');
        }
    });

    updateSelectionStatus();
    // 渲染完成后同步表格总宽度 = 可见 <col> 宽度之和，确保 sticky 冻结列正确激活
    updateTableWidth();
    updateStickyLeft();
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
    showToast(`🗑 已删除基金 ${code}`, 'success');
    loadData();
}
