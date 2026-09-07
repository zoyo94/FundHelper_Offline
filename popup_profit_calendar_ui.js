// ==================== 收益日历 UI（从 popup_settlement_rollback.js 拆分，纯展示层，不含金融计算） ====================

// 每日 entry 求和共用 helper。
// 说明：
// - 累计净值 (acPrice) 模型下，每只基金的 profit 已含分红经济效应，再加 dividends 是重复计算。
//   因此日历顶层「合计」按 ΣbyCode 算（不重复计入 cash dividend）。
// - cashDividendsTotal 仅作为「该日现金流入」旁注列在 chip，不进合计数字。
// - 所有汇总口径（选中日 / 月 / 年 / 历史）都用同一套 helper，杜绝读脏字段。
function sumEntryByCodeOnly(entry) {
    if (!entry || !entry.byCode) return 0;
    let sum = 0;
    for (const value of Object.values(entry.byCode)) {
        sum = round2(sum + (Number(value) || 0));
    }
    return sum;
}

function sumEntryCashDividends(entry) {
    if (!entry || !entry.dividendsByCode) return 0;
    let sum = 0;
    for (const value of Object.values(entry.dividendsByCode)) {
        sum = round2(sum + (Number(value) || 0));
    }
    return sum;
}

function buildProfitHistoryMonthGrid(monthKey) {
    const [year, month] = (monthKey || getToday().slice(0, 7)).split('-').map(Number);
    const firstDay = new Date(year, month - 1, 1);
    const firstWeekday = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month, 0).getDate();
    const cells = [];

    for (let i = 0; i < firstWeekday; i++) {
        cells.push({ type: 'empty', key: `empty-${i}` });
    }
    for (let day = 1; day <= daysInMonth; day++) {
        const date = `${monthKey}-${String(day).padStart(2, '0')}`;
        cells.push({ type: 'day', date });
    }
    while (cells.length % 7 !== 0) {
        cells.push({ type: 'empty', key: `tail-${cells.length}` });
    }
    return cells;
}

function shiftMonth(monthKey, delta) {
    const [year, month] = (monthKey || getToday().slice(0, 7)).split('-').map(Number);
    const next = new Date(year, month - 1 + delta, 1);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
}

function shiftYear(yearKey, delta) {
    const y = Number(yearKey) || new Date().getFullYear();
    return String(y + delta);
}

function formatProfitCalendarYear(yearKey) {
    return `${yearKey}年`;
}

function buildYearMonthGrid(yearKey) {
    return Array.from({ length: 12 }, (_, i) => ({
        type: 'month',
        key: `${yearKey}-${String(i + 1).padStart(2, '0')}`,
        month: i + 1
    }));
}

function buildAllYearsGrid(history) {
    const years = new Set();
    for (const date of Object.keys(history || {})) {
        years.add(date.slice(0, 4));
    }
    const currentYear = getToday().slice(0, 4);
    years.add(currentYear);
    return Array.from(years).sort().map(y => ({ type: 'year', key: y }));
}

function aggregateProfitHistoryByPeriod(history, periodFn) {
    const result = {};
    for (const [date, entry] of Object.entries(history || {})) {
        const key = periodFn(date);
        if (!result[key]) {
            result[key] = { totalProfit: 0, byCode: {}, dividendsByCode: {}, totalDividend: 0, days: 0 };
        }
        const r = result[key];
        // 顶层合计：实时按 byCode 求和（acPrice 模型已含分红经济效应，避免重复）。
        r.totalProfit = round2(r.totalProfit + sumEntryByCodeOnly(entry));
        r.days += 1;
        for (const [code, p] of Object.entries(entry.byCode || {})) {
            r.byCode[code] = round2((r.byCode[code] || 0) + p);
        }
        for (const [code, d] of Object.entries(entry.dividendsByCode || {})) {
            r.dividendsByCode[code] = round2((r.dividendsByCode[code] || 0) + d);
        }
        // totalDividend 仅作旁注用，单独再算一次，避免依赖脏字段。
        r.totalDividend = sumEntryCashDividends(r);
    }
    return result;
}

function getCurrentProfitCalendarContext() {
    // 与主表 renderTable 的过滤口径一致：分组筛选 + 搜索框同时生效，
    // 否则用户搜了基金后打开日历看到的却是全量数据
    const visibleItems = allFundsData.filter(item =>
        groupFilterController.matches(item)
        && (typeof fundSearchController === 'undefined' || fundSearchController.matches(item)));
    const label = groupFilterController.titleLabel();
    return {
        title: label ? `${label} 收益日历` : '全部收益日历',
        visibleItems
    };
}

function getFilteredProfitHistory(history) {
    const normalized = normalizeDailyProfitHistory(history);
    const searchActive = typeof fundSearchController !== 'undefined' && !fundSearchController.isEmpty();
    if (groupFilterController.isAll() && !searchActive) return normalized;

    const selectedGroups = new Set(groupFilterController.selectedGroups());
    const fundByCode = new Map(allFundsData.map(item => [item.code, item]));
    const inFilter = (code) => {
        const item = fundByCode.get(code);
        const groupOk = groupFilterController.isAll()
            || selectedGroups.has(item?.group || '默认');
        const searchOk = !searchActive || (item ? fundSearchController.matches(item) : false);
        return groupOk && searchOk;
    };
    const filtered = {};
    for (const [date, entry] of Object.entries(normalized)) {
        const byCode = {};
        let totalProfit = 0;
        for (const [code, profit] of Object.entries(entry.byCode || {})) {
            if (!inFilter(code)) continue;
            byCode[code] = profit;
            totalProfit = round2(totalProfit + profit);
        }
        const dividendsByCode = {};
        let totalDividend = 0;
        for (const [code, amount] of Object.entries(entry.dividendsByCode || {})) {
            if (!inFilter(code)) continue;
            dividendsByCode[code] = amount;
            totalDividend = round2(totalDividend + amount);
        }
        if (Object.keys(byCode).length > 0 || Object.keys(dividendsByCode).length > 0) {
            filtered[date] = { totalProfit, byCode, dividendsByCode, totalDividend };
        }
    }
    return filtered;
}

function getProfitCalendarMonthDates(history, monthKey) {
    return Object.keys(history || {})
        .filter(date => date.startsWith(`${monthKey}-`))
        .sort();
}

function getProfitCalendarSelectedDate(history, monthKey, preferredDate = '') {
    const monthDates = getProfitCalendarMonthDates(history, monthKey);
    if (preferredDate && preferredDate.startsWith(`${monthKey}-`) && monthDates.includes(preferredDate)) {
        return preferredDate;
    }
    return monthDates[monthDates.length - 1] || '';
}

function formatProfitCalendarMonth(monthKey) {
    const [year, month] = (monthKey || getToday().slice(0, 7)).split('-');
    return `${year}年${Number(month)}月`;
}

function formatProfitCalendarDate(dateStr) {
    if (!dateStr) return '未选择日期';
    const date = new Date(`${dateStr}T00:00:00`);
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const weekday = Number.isNaN(date.getTime()) ? '' : ` ${weekdays[date.getDay()]}`;
    return `${dateStr}${weekday}`;
}

async function openProfitCalendar() {
    const stored = await storageHelper.getAll(['dailyProfitHistory']);
    const history = normalizeDailyProfitHistory(stored.dailyProfitHistory);

    const render = () => {
        const context = getCurrentProfitCalendarContext();
        const filteredHistory = getFilteredProfitHistory(history);
        const allDates = Object.keys(filteredHistory).sort();
        const latestDate = allDates[allDates.length - 1] || getToday();
        const latestMonth = latestDate.slice(0, 7);
        const latestYear = latestDate.slice(0, 4);

        if (!/^\d{4}-\d{2}$/.test(profitCalendarViewMonth)) profitCalendarViewMonth = latestMonth;
        if (!/^\d{4}$/.test(profitCalendarViewYear)) profitCalendarViewYear = latestYear;
        if (!['day', 'month', 'year'].includes(profitCalendarViewMode)) profitCalendarViewMode = 'day';

        const monthlyTotals = aggregateProfitHistoryByPeriod(filteredHistory, date => date.slice(0, 7));
        const yearlyTotals = aggregateProfitHistoryByPeriod(filteredHistory, date => date.slice(0, 4));
        const codeMap = new Map(allFundsData.map(item => [item.code, item]));

        const todayStr = getToday();
        const todayMonth = todayStr.slice(0, 7);
        const todayYear = todayStr.slice(0, 4);

        let gridCells = [];
        let gridClass = '';
        let gridMaxAbs = 1;
        let weekdayHtml = '';
        let navTitleText = '';
        let navPrevDelta = 0;
        let navNextDelta = 0;
        let summaryLabel = '';
        let summaryTotalPrefix = '';
        let summaryDays = '';
        let summaryTotal = 0;
        let summaryHasData = false;
        let selectedKey = '';
        let selectedEntry = { totalProfit: 0, byCode: {}, dividendsByCode: {}, totalDividend: 0, days: 0 };
        let selectedHeaderLabel = '';
        let detailCountLabel = '收益合计';
        let emptyMessage = '';

        if (profitCalendarViewMode === 'day') {
            if (!filteredHistory[profitCalendarSelectedDate] || !profitCalendarSelectedDate.startsWith(`${profitCalendarViewMonth}-`)) {
                const monthDates = getProfitCalendarMonthDates(filteredHistory, profitCalendarViewMonth);
                profitCalendarSelectedDate = monthDates[monthDates.length - 1] || '';
            }
            const monthDates = getProfitCalendarMonthDates(filteredHistory, profitCalendarViewMonth);
            const monthValues = monthDates.map(d => Math.abs(filteredHistory[d]?.totalProfit || 0));
            gridMaxAbs = Math.max(...monthValues, 1);
            gridClass = 'view-day';
            weekdayHtml = ['一', '二', '三', '四', '五', '六', '日']
                .map(day => `<div class="profit-calendar-weekday">${day}</div>`)
                .join('');
            navTitleText = formatProfitCalendarMonth(profitCalendarViewMonth);
            navPrevDelta = -1;
            navNextDelta = 1;

            gridCells = buildProfitHistoryMonthGrid(profitCalendarViewMonth).map(cell => {
                if (cell.type === 'empty') return { empty: true };
                const entry = filteredHistory[cell.date];
                const hasData = !!entry && Object.keys(entry.byCode || {}).length > 0;
                const hasDividend = !!entry && Object.keys(entry.dividendsByCode || {}).length > 0;
                const totalProfit = sumEntryByCodeOnly(entry);
                const dividendTotal = sumEntryCashDividends(entry);
                return {
                    kind: 'date',
                    key: cell.date,
                    label: String(Number(cell.date.slice(-2))),
                    valueText: hasData ? formatProfit(totalProfit) : '暂无',
                    hasData,
                    hasDividend,
                    totalProfit,
                    dividendTotal,
                    isToday: cell.date === todayStr,
                    isSelected: cell.date === profitCalendarSelectedDate
                };
            });

            summaryLabel = formatProfitCalendarMonth(profitCalendarViewMonth);
            summaryTotalPrefix = '本月合计';
            summaryDays = monthDates.length > 0 ? `本月 ${monthDates.length} 个交易日` : '暂无记录';
            summaryTotal = round2(monthDates.reduce((sum, d) => sum + sumEntryByCodeOnly(filteredHistory[d]), 0));
            summaryHasData = monthDates.length > 0;
            selectedKey = profitCalendarSelectedDate;
            selectedEntry = profitCalendarSelectedDate
                ? (filteredHistory[profitCalendarSelectedDate] || selectedEntry)
                : selectedEntry;
            selectedHeaderLabel = profitCalendarSelectedDate
                ? formatProfitCalendarDate(profitCalendarSelectedDate)
                : `${formatProfitCalendarMonth(profitCalendarViewMonth)} 暂无记录`;
            detailCountLabel = '选中日合计';
            emptyMessage = allDates.length === 0
                ? '还没有日收益记录。完成一次自动或手动结算后会显示在这里。'
                : (monthDates.length === 0 ? '该月份暂无已记录收益。' : '当天暂无已记录收益。');
        } else if (profitCalendarViewMode === 'month') {
            const yearMonths = Object.keys(monthlyTotals).filter(k => k.startsWith(`${profitCalendarViewYear}-`));
            if (!yearMonths.includes(profitCalendarSelectedMonth)) {
                profitCalendarSelectedMonth = yearMonths[yearMonths.length - 1] || '';
            }
            const monthAbs = yearMonths.map(k => Math.abs(monthlyTotals[k]?.totalProfit || 0));
            gridMaxAbs = Math.max(...monthAbs, 1);
            gridClass = 'view-month';
            navTitleText = formatProfitCalendarYear(profitCalendarViewYear);
            navPrevDelta = -1;
            navNextDelta = 1;

            gridCells = buildYearMonthGrid(profitCalendarViewYear).map(cell => {
                const entry = monthlyTotals[cell.key];
                const hasData = !!entry && Object.keys(entry.byCode || {}).length > 0;
                const hasDividend = !!entry && Object.keys(entry.dividendsByCode || {}).length > 0;
                const totalProfit = sumEntryByCodeOnly(entry);
                const dividendTotal = sumEntryCashDividends(entry);
                return {
                    kind: 'month',
                    key: cell.key,
                    label: `${cell.month}月`,
                    valueText: hasData ? formatProfit(totalProfit) : '暂无',
                    hasData,
                    hasDividend,
                    totalProfit,
                    dividendTotal,
                    isToday: cell.key === todayMonth,
                    isSelected: cell.key === profitCalendarSelectedMonth
                };
            });

            const yearTotal = yearlyTotals[profitCalendarViewYear];
            summaryLabel = formatProfitCalendarYear(profitCalendarViewYear);
            summaryTotalPrefix = '本年合计';
            summaryDays = yearTotal && yearTotal.days > 0 ? `本年 ${yearMonths.length} 个月 · ${yearTotal.days} 个交易日` : '暂无记录';
            summaryTotal = round2(sumEntryByCodeOnly(yearTotal));
            summaryHasData = !!yearTotal && yearTotal.days > 0;
            selectedKey = profitCalendarSelectedMonth;
            selectedEntry = profitCalendarSelectedMonth
                ? (monthlyTotals[profitCalendarSelectedMonth] || selectedEntry)
                : selectedEntry;
            selectedHeaderLabel = profitCalendarSelectedMonth
                ? `${formatProfitCalendarMonth(profitCalendarSelectedMonth)} · ${selectedEntry.days || 0} 个交易日`
                : `${formatProfitCalendarYear(profitCalendarViewYear)} 暂无记录`;
            detailCountLabel = '选中月合计';
            emptyMessage = allDates.length === 0
                ? '还没有日收益记录。完成一次自动或手动结算后会显示在这里。'
                : (yearMonths.length === 0 ? '该年份暂无已记录收益。' : '所选月份暂无明细。');
        } else {
            const allYears = Object.keys(yearlyTotals).sort();
            if (!allYears.includes(profitCalendarSelectedYear)) {
                profitCalendarSelectedYear = allYears[allYears.length - 1] || '';
            }
            const yearAbs = allYears.map(y => Math.abs(yearlyTotals[y]?.totalProfit || 0));
            gridMaxAbs = Math.max(...yearAbs, 1);
            gridClass = 'view-year';
            navTitleText = '全部年份';

            const yearGrid = buildAllYearsGrid(filteredHistory);
            gridCells = yearGrid.map(cell => {
                const entry = yearlyTotals[cell.key];
                const hasData = !!entry && Object.keys(entry.byCode || {}).length > 0;
                const hasDividend = !!entry && Object.keys(entry.dividendsByCode || {}).length > 0;
                const totalProfit = sumEntryByCodeOnly(entry);
                const dividendTotal = sumEntryCashDividends(entry);
                return {
                    kind: 'year',
                    key: cell.key,
                    label: `${cell.key}年`,
                    valueText: hasData ? formatProfit(totalProfit) : '暂无',
                    hasData,
                    hasDividend,
                    totalProfit,
                    dividendTotal,
                    isToday: cell.key === todayYear,
                    isSelected: cell.key === profitCalendarSelectedYear
                };
            });

            const allTotal = allDates.reduce((sum, d) => sum + sumEntryByCodeOnly(filteredHistory[d]), 0);
            const totalDays = allDates.length;
            summaryLabel = '全部年份';
            summaryTotalPrefix = '历史合计';
            summaryDays = totalDays > 0 ? `历史 ${allYears.length} 年 · ${totalDays} 个交易日` : '暂无记录';
            summaryTotal = round2(allTotal);
            summaryHasData = totalDays > 0;
            selectedKey = profitCalendarSelectedYear;
            selectedEntry = profitCalendarSelectedYear
                ? (yearlyTotals[profitCalendarSelectedYear] || selectedEntry)
                : selectedEntry;
            selectedHeaderLabel = profitCalendarSelectedYear
                ? `${formatProfitCalendarYear(profitCalendarSelectedYear)} · ${selectedEntry.days || 0} 个交易日`
                : '暂无记录';
            detailCountLabel = '选中年合计';
            emptyMessage = allDates.length === 0
                ? '还没有日收益记录。完成一次自动或手动结算后会显示在这里。'
                : '所选年份暂无明细。';
        }

        const gridHtml = gridCells.map(cell => {
            if (cell.empty) return '<div class="profit-calendar-cell empty"></div>';
            const alpha = cell.hasData
                ? (0.12 + Math.min(Math.abs(cell.totalProfit) / gridMaxAbs, 1) * 0.2).toFixed(2)
                : '0.16';
            const dividendBadge = cell.hasDividend
                ? `<span class="profit-calendar-day-badge" title="期间有分红 ${formatProfit(cell.dividendTotal)}">分</span>`
                : '';
            const isPositive = cell.totalProfit > 0;
            const isNegative = cell.totalProfit < 0;
            return `
                <button
                    type="button"
                    class="profit-calendar-day-btn ${cell.hasData ? 'has-data' : ''} ${isPositive ? 'positive' : ''} ${isNegative ? 'negative' : ''} ${cell.hasDividend ? 'has-dividend' : ''} ${cell.isToday ? 'is-today' : ''} ${cell.isSelected ? 'is-selected' : ''}"
                    data-calendar-cell="${cell.kind}:${cell.key}"
                    style="--calendar-alpha:${alpha};"
                >
                    ${dividendBadge}
                    <span class="profit-calendar-day-label">${cell.label}</span>
                    <span class="profit-calendar-day-value">${cell.valueText}</span>
                </button>
            `;
        }).join('');

        const selectedDividends = selectedEntry.dividendsByCode || {};
        const detailCodes = new Set([
            ...Object.keys(selectedEntry.byCode || {}),
            ...Object.keys(selectedDividends)
        ]);
        const detailRows = Array.from(detailCodes)
            .map(code => ({
                code,
                name: codeMap.get(code)?.name || code,
                profit: round2(Number(selectedEntry.byCode?.[code]) || 0),
                dividend: round2(Number(selectedDividends[code]) || 0)
            }))
            .sort((a, b) => (b.profit + b.dividend) - (a.profit + a.dividend) || a.code.localeCompare(b.code));

        const detailHtml = detailRows.length > 0
            ? `
                <div class="profit-calendar-detail-list">
                    ${detailRows.map(item => {
                        // 单只基金行：profit 列 = 该基金当日真实经济效果（acPrice 模型已含分红经济效应）。
                        // 不再单独渲染「合计 = profit + dividend」列，避免与 profit 重复计算误导用户。
                        // 分红金额只在 chip 上提示「该日有 X 元现金分红流入」，不参与数字求和。
                        const dividendNote = item.dividend > 0
                            ? `<span class="profit-calendar-detail-dividend" title="当日现金分红（已计入上方盈亏）">分红 ${formatProfit(item.dividend)}</span>`
                            : '';
                        return `
                        <div class="profit-calendar-detail-row">
                            <div class="profit-calendar-detail-name" title="${escapeHtml(item.name)} (${item.code})">
                                ${escapeHtml(item.name)} (${item.code})
                                ${dividendNote}
                            </div>
                            <div class="profit-calendar-detail-values">
                                <div class="profit-calendar-detail-profit ${item.profit > 0 ? 'positive' : ''} ${item.profit < 0 ? 'negative' : ''}">
                                    ${formatProfit(item.profit)}
                                </div>
                            </div>
                        </div>
                    `;
                    }).join('')}
                </div>
            `
            : `<div class="profit-calendar-detail-empty">${emptyMessage}</div>`;

        // 选中范围合计：实时按 byCode 求和，永不读脏字段；与 detail 行 profit 之和严格自洽。
        const selectedTotalProfit = sumEntryByCodeOnly(selectedEntry);
        const selectedTotalCashDividend = sumEntryCashDividends(selectedEntry);
        const detailHeaderTotal = selectedKey ? formatProfit(selectedTotalProfit) : '—';
        const selectedCount = detailRows.length;
        const dividendCount = Object.keys(selectedDividends).length;
        const detailBadgeText = !selectedKey
            ? '未选中范围'
            : (selectedCount > 0
                ? (dividendCount > 0 ? `${selectedCount} 项明细 · ${dividendCount} 项分红` : `${selectedCount} 项明细`)
                : '无明细');
        const detailBadgeClass = selectedTotalProfit > 0 ? 'positive' : (selectedTotalProfit < 0 ? 'negative' : '');

        const summaryTotalClass = summaryTotal > 0 ? 'positive' : (summaryTotal < 0 ? 'negative' : '');
        const summaryTotalText = summaryHasData ? formatProfit(summaryTotal) : '—';

        const weekdaySection = profitCalendarViewMode === 'day'
            ? `<div class="profit-calendar-weekdays">${weekdayHtml}</div>`
            : '';
        const navArrowsHtml = profitCalendarViewMode === 'year'
            ? ''
            : `
                <button type="button" class="profit-calendar-nav-btn" data-calendar-nav="${navPrevDelta}">‹</button>
                <div class="profit-calendar-month">${navTitleText}</div>
                <button type="button" class="profit-calendar-nav-btn" data-calendar-nav="${navNextDelta}">›</button>
            `;
        const navTitleOnlyHtml = profitCalendarViewMode === 'year'
            ? `<div class="profit-calendar-month">${navTitleText}</div>`
            : '';
        const viewToggleHtml = ['day', 'month', 'year'].map(mode => {
            const label = mode === 'day' ? '日' : mode === 'month' ? '月' : '年';
            const active = profitCalendarViewMode === mode ? 'is-active' : '';
            return `<button type="button" class="profit-calendar-view-btn ${active}" data-calendar-view="${mode}">${label}</button>`;
        }).join('');

        setModalDismissHandler(_closeModal);
        elements.modalOverlay.dataset.mode = 'profit-calendar';
        elements.modalInput.style.display = 'none';
        elements.modalInput.onkeydown = null;
        elements.modalMsg.innerHTML = `
            <div class="profit-calendar-modal">
                <div class="profit-calendar-toolbar">
                    <div class="profit-calendar-caption">
                        <div class="profit-calendar-title-row">
                            <div class="profit-calendar-title">${context.title}</div>
                            <div class="profit-calendar-meta">
                                <div class="profit-calendar-meta-item">当前 ${context.visibleItems.length} 项</div>
                                <div class="profit-calendar-meta-item">已记录 ${allDates.length} 个交易日</div>
                            </div>
                        </div>
                        <div class="profit-calendar-nav">
                            ${navArrowsHtml}
                            ${navTitleOnlyHtml}
                            <div class="profit-calendar-view-toggle">${viewToggleHtml}</div>
                            <button type="button" class="profit-calendar-nav-btn close-btn" data-calendar-close="true" title="关闭">✕</button>
                        </div>
                    </div>
                </div>
                <div class="profit-calendar-month-summary">
                    <div class="profit-calendar-month-summary-label">
                        <span>${summaryLabel}</span>
                        <span class="profit-calendar-month-summary-days">${summaryDays}</span>
                    </div>
                    <div class="profit-calendar-month-summary-total ${summaryTotalClass}">
                        <span class="profit-calendar-month-summary-total-prefix">${summaryTotalPrefix}</span>
                        <span>${summaryTotalText}</span>
                    </div>
                </div>
                <div class="profit-calendar-legend">
                    <div class="profit-calendar-legend-item"><span class="profit-calendar-legend-dot positive"></span><span>盈利</span></div>
                    <div class="profit-calendar-legend-item"><span class="profit-calendar-legend-dot negative"></span><span>亏损</span></div>
                    <div class="profit-calendar-legend-item"><span class="profit-calendar-legend-dot neutral"></span><span>今日/选中</span></div>
                </div>
                ${weekdaySection}
                <div class="profit-calendar-grid ${gridClass}">${gridHtml}</div>
                <div class="profit-calendar-detail">
                    <div class="profit-calendar-detail-header">
                        <div class="profit-calendar-detail-heading">
                            <div class="profit-calendar-detail-date">${selectedHeaderLabel}</div>
                            <div class="profit-calendar-detail-badge ${detailBadgeClass}">${detailBadgeText}</div>
                        </div>
                        <div class="profit-calendar-detail-summary">
                            <div class="profit-calendar-detail-count">${detailCountLabel}</div>
                            <div class="profit-calendar-detail-total ${selectedTotalProfit > 0 ? 'positive' : ''} ${selectedTotalProfit < 0 ? 'negative' : ''}">
                                ${detailHeaderTotal}
                            </div>
                            ${selectedTotalCashDividend > 0 && selectedKey ? `
                                <div class="profit-calendar-detail-dividend-total" title="当日现金分红合计（已计入上方盈亏数字，作为利润已实现部分）">
                                    现金分红 ${formatProfit(selectedTotalCashDividend)}
                                </div>
                            ` : ''}
                        </div>
                    </div>
                    ${detailHtml}
                </div>
            </div>
        `;
        _setFooter([]);
        setModalVisibility(true);

        elements.modalMsg.onclick = (event) => {
            if (event.target.closest('[data-calendar-close]')) {
                _closeModal();
                return;
            }

            const viewBtn = event.target.closest('[data-calendar-view]');
            if (viewBtn) {
                const nextMode = viewBtn.dataset.calendarView;
                if (nextMode === profitCalendarViewMode) return;
                if (nextMode === 'month' && profitCalendarSelectedDate) {
                    profitCalendarViewYear = profitCalendarSelectedDate.slice(0, 4);
                    profitCalendarSelectedMonth = profitCalendarSelectedDate.slice(0, 7);
                } else if (nextMode === 'month' && !/^\d{4}$/.test(profitCalendarViewYear)) {
                    profitCalendarViewYear = profitCalendarViewMonth.slice(0, 4) || latestYear;
                }
                if (nextMode === 'day' && profitCalendarSelectedMonth) {
                    profitCalendarViewMonth = profitCalendarSelectedMonth;
                }
                if (nextMode === 'year' && profitCalendarSelectedMonth) {
                    profitCalendarSelectedYear = profitCalendarSelectedMonth.slice(0, 4);
                } else if (nextMode === 'year' && profitCalendarSelectedDate) {
                    profitCalendarSelectedYear = profitCalendarSelectedDate.slice(0, 4);
                }
                profitCalendarViewMode = nextMode;
                render();
                return;
            }

            const navBtn = event.target.closest('[data-calendar-nav]');
            if (navBtn) {
                const delta = Number(navBtn.dataset.calendarNav);
                if (profitCalendarViewMode === 'day') {
                    profitCalendarViewMonth = shiftMonth(profitCalendarViewMonth, delta);
                    profitCalendarSelectedDate = '';
                } else if (profitCalendarViewMode === 'month') {
                    profitCalendarViewYear = shiftYear(profitCalendarViewYear, delta);
                    profitCalendarSelectedMonth = '';
                }
                render();
                return;
            }

            const cellBtn = event.target.closest('[data-calendar-cell]');
            if (cellBtn) {
                const [kind, key] = cellBtn.dataset.calendarCell.split(':');
                if (kind === 'date') {
                    profitCalendarSelectedDate = key;
                } else if (kind === 'month') {
                    profitCalendarSelectedMonth = key;
                } else if (kind === 'year') {
                    profitCalendarSelectedYear = key;
                }
                render();
            }
        };
    };

    const initialFilteredHistory = getFilteredProfitHistory(history);
    const initialDates = Object.keys(initialFilteredHistory).sort();
    const initialLatestDate = initialDates[initialDates.length - 1] || getToday();
    if (!/^\d{4}-\d{2}$/.test(profitCalendarViewMonth) || !initialDates.some(date => date.startsWith(`${profitCalendarViewMonth}-`))) {
        profitCalendarViewMonth = initialLatestDate.slice(0, 7);
    }
    if (!/^\d{4}$/.test(profitCalendarViewYear)) {
        profitCalendarViewYear = initialLatestDate.slice(0, 4);
    }
    profitCalendarSelectedDate = getProfitCalendarSelectedDate(
        initialFilteredHistory,
        profitCalendarViewMonth,
        profitCalendarSelectedDate
    );

    render();
}

// 交易域函数已拆分到 popup_trade.js：
// - 交易归一化 / 迁移
// - 交易运行时状态
// - 自动分红与待确认订单辅助
// - 结算辅助

