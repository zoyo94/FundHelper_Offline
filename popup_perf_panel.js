function buildPerformanceSummaryHtml(periodLabel, totalRate, isUp, similarRate = null, benchmarkRate = null, benchmarkLabel = '业绩基准') {
    const fundColor = isUp ? '#ff7875' : '#73d13d';

    const totalRateColor = isUp ? '#ff7875' : '#00b464';
    const sign = parseFloat(totalRate) > 0 ? '+' : '';

    const buildLegendBox = (color, label, rate) => {
        if (rate === null) return '';
        const rSign = parseFloat(rate) > 0 ? '+' : '';
        const rateColor = parseFloat(rate) >= 0 ? '#ff7875' : '#73d13d';
        return `
            <div style="display: inline-flex; align-items: center; gap: 8px;">
                <span style="width: 12px; height: 2px; background: ${color};"></span>
                <span style="color: #8aacce; font-size: 12px;">${label}</span>
                <span style="color: ${rateColor}; font-size: 13px; font-weight: 600;">${rSign}${rate}%</span>
            </div>
        `;
    };

    return `
        <div style="position: relative; padding-top: 10px; margin-bottom: 12px;">
            <div style="position: absolute; right: 0; top: -18px; font-size: 12px; color: #4a6a90;">
                ${periodLabel}涨跌幅 <span style="color: ${totalRateColor}; font-weight: bold; margin-left: 4px;">${sign}${totalRate}%</span>
            </div>
            <div style="display: flex; justify-content: flex-start; align-items: center; gap: 8px;">
                ${buildLegendBox(fundColor, '本基金', totalRate)}
                ${buildLegendBox('#3498db', '同类平均', similarRate)}
                ${buildLegendBox('#8c8c8c', benchmarkLabel, benchmarkRate)}
            </div>
        </div>
    `;
}

function setPerformancePanelState(code, summary, preview, moreLink, summaryText, previewText) {
    if (_performanceState[code]) {
        _performanceState[code].fundData = [];
    }
    resetPerformanceViewState();
    summary.textContent = summaryText;
    if (preview) preview.innerHTML = `<div class="perf-nav-empty">${previewText}</div>`;
    if (moreLink) moreLink.style.display = 'none';
}

function setPerformanceLoadingState(code, summary, preview, moreLink) {
    setPerformancePanelState(code, summary, preview, moreLink, '加载中...', '加载中...');
}

function setPerformanceEmptyState(code, summary, preview, moreLink, text) {
    setPerformancePanelState(
        code,
        summary,
        preview,
        moreLink,
        text,
        text === '加载失败' ? '加载失败' : '暂无历史净值'
    );
}

function renderPerformanceResult(code, fundData, summary, preview, moreLink, canvas, comparisonData = null) {
    const state = getCurrentPerformanceState(code);
    const chartData = getPerformanceChartData(fundData);
    const periodLabel = getPerformancePeriodLabel(state?.period);
    if (!chartData) {
        setPerformanceEmptyState(code, summary, preview, moreLink, '暂无数据');
        return;
    }

    if (state) {
        state.fundData = fundData;
        state.comparisonData = comparisonData;

        HistoryDB.getOrders(code).then(orders => {
            state.tradeHistory = normalizeTradeRecordList(orders, { code, source: 'order' });
            if (getCurrentPerformanceState(code) === state) {
                drawPerfChartWithComparison(canvas, chartData, comparisonData);
            }
        });

        state.addedDate = state.sourceFund?.addedDate || '';
    }

    const firstPrice = chartData.prices[0];
    const lastPrice = chartData.prices[chartData.prices.length - 1];
    let totalRate;
    if (chartData.acPrices) {
        const firstAC = chartData.acPrices.find(v => v > 0);
        const lastAC = [...chartData.acPrices].reverse().find(v => v > 0);
        totalRate = (firstAC && lastAC) ? ((lastAC - firstAC) / firstAC * 100).toFixed(2) : ((lastPrice - firstPrice) / firstPrice * 100).toFixed(2);
    } else {
        totalRate = ((lastPrice - firstPrice) / firstPrice * 100).toFixed(2);
    }
    const recentList = getRecentPerformancePreviewList(fundData);

    const getComparisonRelativeRate = (data, firstDate, lastDate) => {
        if (!Array.isArray(data) || data.length === 0) return null;
        const startItem = [...data].reverse().find(d => d.date <= firstDate) || data[0];
        const endItem = [...data].reverse().find(d => d.date <= lastDate) || data[data.length - 1];
        if (!startItem || !endItem) return null;
        return (endItem.rate - startItem.rate).toFixed(2);
    };

    let similarRate = null;
    let benchmarkRate = null;
    let displayTotalRate = totalRate;

    if (comparisonData) {
        const lastDate = chartData.dates[chartData.dates.length - 1];
        const firstDate = chartData.dates[0];

        const fundSeriesRate = getComparisonRelativeRate(comparisonData.fundSeries, firstDate, lastDate);
        if (fundSeriesRate !== null) {
            displayTotalRate = fundSeriesRate;
        }
        similarRate = getComparisonRelativeRate(comparisonData.similarAvg, firstDate, lastDate);
        benchmarkRate = getComparisonRelativeRate(comparisonData.benchmark, firstDate, lastDate);
    }

    hidePerformanceTooltip();
    summary.innerHTML = buildPerformanceSummaryHtml(periodLabel, displayTotalRate, parseFloat(displayTotalRate) >= 0, similarRate, benchmarkRate, comparisonData?.benchmarkLabel);
    if (preview) preview.innerHTML = renderPerformanceNavPreview(recentList);
    if (moreLink) moreLink.style.display = fundData.length > recentList.length ? 'inline' : 'none';

    canvas.style.width = '100%';
    canvas.style.height = '220px';
    drawPerfChartWithComparison(canvas, chartData, comparisonData);
    syncFundDetailLayout();
}

function renderPerformanceContainer(container) {
    container.innerHTML = `
        <div style="padding: 14px 0 10px;">
            <div id="perfPeriodBtns" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
                ${PERFORMANCE_PERIOD_ORDER.map((p, i) => `
                    <button class="perf-btn" data-period="${p}"
                        style="padding:5px 12px;border-radius:16px;border:1px solid #1e3a5f;font-size:12px;
                        cursor:pointer;background:${i === 0 ? '#1890ff' : '#0d1b2e'};color:${i === 0 ? '#fff' : '#4a6a90'};transition:all 0.2s;">
                        ${getPerformancePeriodLabel(p)}
                    </button>
                `).join('')}
            </div>
            <div id="perfSummary" style="text-align:left;font-size:12px;color:#4a6a90;margin-bottom:4px;">加载中...</div>
            <div style="position:relative;">
                <canvas id="perfChart" style="width:100%;height:220px;display:block;"></canvas>
                <div id="perfChartTooltip" style="display:none;position:absolute;background:rgba(10,21,37,0.9);border:1px solid #1e3a5f;border-radius:6px;padding:6px 10px;pointer-events:none;min-width:120px;z-index:100;"></div>
            </div>
            <div class="perf-nav-section">
                <div class="perf-nav-header">
                    <span class="perf-nav-title">历史净值</span>
                    <span id="perfMoreLink" class="modal-link" style="display:none;">更多</span>
                </div>
                <div id="perfNavPreview" class="perf-nav-preview">
                    <div class="perf-nav-empty">加载中...</div>
                </div>
            </div>
        </div>
    `;
}

function bindPerformanceMoreLink(code) {
    const moreLink = document.getElementById('perfMoreLink');
    if (moreLink) {
        moreLink.onclick = () => {
            const state = getCurrentPerformanceState(code);
            if (!state || !Array.isArray(state.fundData) || state.fundData.length === 0) return;
            showPerformanceNavListModal(code, getPerformancePeriodLabel(state.period), state.fundData);
        };
    }
}

function bindPerformancePeriodButtons(container, code, isStale) {
    container.querySelectorAll('.perf-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (isStale()) return;
            container.querySelectorAll('.perf-btn').forEach(b => {
                b.style.background = b === btn ? '#1890ff' : '#0d1b2e';
                b.style.color = b === btn ? '#fff' : '#4a6a90';
            });
            loadPerformancePeriod(code, btn.dataset.period, isStale);
        });
    });
}

async function loadMyReturn(code, isStale = createFundDetailStaleGuard(code)) {
    const container = document.getElementById('tabMyReturn');
    if (!container || isStale()) return;

    const defaultPeriod = '3M';
    _myReturnState[code] = {
        period: defaultPeriod,
        fundHistory: [],
        comparisonData: null,
        requestId: 0
    };

    renderMyReturnContainer(container, code, isStale);
    await loadMyReturnPeriod(code, defaultPeriod, isStale);
}

function renderMyReturnContainer(container, code, isStale) {
    container.innerHTML = `
        <div style="padding: 10px 0;">
            <div id="myReturnSummary" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <span style="font-size:12px; color:#4a6a90;">加载中...</span>
            </div>
            <div style="position:relative; margin-bottom:16px;">
                <canvas id="myReturnChart" style="width:100%; height:180px; display:block;"></canvas>
                <div id="myReturnChartTooltip" style="display:none;position:absolute;background:rgba(10,21,37,0.9);border:1px solid #1e3a5f;border-radius:6px;padding:6px 10px;pointer-events:none;min-width:120px;z-index:100;"></div>
            </div>
            <div id="myReturnPeriodBtns" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px; justify-content:center;">
                ${MY_RETURN_PERIOD_ORDER.map((p) => `
                    <button class="my-return-btn" data-period="${p}"
                        style="padding:4px 15px;border-radius:6px;border:1px solid #1e3a5f;font-size:12px;
                        cursor:pointer;background:${p === '3M' ? '#1890ff' : '#0d1b2e'};color:${p === '3M' ? '#fff' : '#4a6a90'};transition:all 0.2s;">
                        ${getMyReturnPeriodLabel(p)}
                    </button>
                `).join('')}
            </div>
            <div class="perf-nav-section">
                <div class="perf-nav-header">
                    <span class="perf-nav-title">收益记录</span>
                </div>
                <div id="myReturnListPreview" class="perf-nav-preview">
                    <div class="perf-nav-empty">加载中...</div>
                </div>
            </div>
        </div>
    `;

    container.querySelectorAll('.my-return-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (isStale()) return;
            container.querySelectorAll('.my-return-btn').forEach(b => {
                b.style.background = b === btn ? '#1890ff' : '#0d1b2e';
                b.style.color = b === btn ? '#fff' : '#4a6a90';
            });
            loadMyReturnPeriod(code, btn.dataset.period, isStale);
        });
    });
}

function renderMyReturnResult(filteredHistory, summary, listPreview, canvas, period) {
    const totalProfit = filteredHistory.reduce((sum, item) => sum + item.profit, 0);
    const periodLabel = getMyReturnPeriodLabel(period);

    summary.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:baseline;">
            <span style="font-size:13px; color:#8aacce;">${periodLabel}累计收益</span>
            <span style="font-size:20px; font-weight:600; color:${totalProfit >= 0 ? '#ff7875' : '#73d13d'};">
                ${formatProfit(totalProfit)}
            </span>
        </div>
    `;

    const displayList = filteredHistory.slice().reverse();
    listPreview.innerHTML = `
        <div class="perf-nav-row header" style="border-bottom: 1px solid #1e3a5f; padding-bottom: 6px; margin-bottom: 6px; opacity: 0.7;">
            <span class="perf-nav-date">日期</span>
            <span class="perf-nav-price">收益</span>
            <span class="perf-nav-rate">收益率</span>
        </div>
        ${displayList.map(item => `
            <div class="perf-nav-row">
                <span class="perf-nav-date">${item.date}</span>
                <span class="perf-nav-price ${item.profit >= 0 ? 'up' : 'down'}">${formatProfit(item.profit)}</span>
                <span class="perf-nav-rate ${item.rate !== null ? (item.rate >= 0 ? 'up' : 'down') : ''}">${item.rate !== null ? formatProfit(item.rate, '%') : '--'}</span>
            </div>
        `).join('')}
    `;

    const dates = filteredHistory.map(h => h.date);
    let sum = 0;
    const cumulativeProfits = filteredHistory.map(h => {
        sum += h.profit;
        return sum;
    });

    const chartData = {
        profits: cumulativeProfits,
        dates: dates,
        isUp: totalProfit >= 0
    };

    drawMyReturnChartWithComparison(canvas, chartData, null);
    syncFundDetailLayout();
}

async function loadPerformance(code, live, sourceFund, isStale = createFundDetailStaleGuard(code)) {
    const container = document.getElementById('tabPerformance');
    if (!container || isStale()) return;

    const defaultPerformancePeriod = PERFORMANCE_PERIOD_ORDER[0];
    _performanceState[code] = {
        period: defaultPerformancePeriod,
        fundData: [],
        comparisonData: null,
        sourceFund: sourceFund || null,
        latestNav: {
            date: live?.prevPriceDate || '',
            price: live?.prevPrice || 0
        },
        requestId: 0
    };

    renderPerformanceContainer(container);
    bindPerformanceMoreLink(code);
    bindPerformancePeriodButtons(container, code, isStale);

    await loadPerformancePeriod(code, defaultPerformancePeriod, isStale);
}

function renderPerformanceNavPreview(list) {
    if (!Array.isArray(list) || list.length === 0) {
        return '<div class="perf-nav-empty">暂无历史净值</div>';
    }
    return `
        <div class="perf-nav-row header" style="border-bottom: 1px solid #1e3a5f; padding-bottom: 6px; margin-bottom: 6px; opacity: 0.7;">
            <span class="perf-nav-date">日期</span>
            <span class="perf-nav-price">净值</span>
            <span class="perf-nav-rate">日涨幅</span>
        </div>
        ${list.map(item => {
            const rate = item.dailyRate;
            const rateText = rate !== null ? formatProfit(rate, '%') : '--';
            const rateClass = rate >= 0 ? 'up' : 'down';
            return `
                <div class="perf-nav-row">
                    <span class="perf-nav-date">${item.date}</span>
                    <span class="perf-nav-price">${item.price.toFixed(4)}</span>
                    <span class="perf-nav-rate ${rate !== null ? rateClass : ''}">${rateText}</span>
                </div>
            `;
        }).join('')}
    `;
}

function showPerformanceNavListModal(code, periodLabel, fundData) {
    if (!Array.isArray(fundData) || fundData.length === 0) {
        showToast('暂无历史净值数据', 'error');
        return;
    }
    let rows = `
        <div class="perf-nav-row full header" style="border-bottom: 1px solid #1e3a5f; font-weight: bold; padding-bottom: 8px; margin-bottom: 8px;">
            <span class="perf-nav-date">日期</span>
            <span class="perf-nav-price">净值</span>
            <span class="perf-nav-rate">日涨幅</span>
        </div>
    `;
    for (let i = fundData.length - 1; i >= 0; i--) {
        const item = fundData[i];
        const rate = item.dailyRate;
        const rateText = rate !== null ? formatProfit(rate, '%') : '--';
        const rateClass = rate >= 0 ? 'up' : 'down';
        rows += `
        <div class="perf-nav-row full">
            <span class="perf-nav-date">${item.date}</span>
            <span class="perf-nav-price">${item.price.toFixed(4)}</span>
            <span class="perf-nav-rate ${rate !== null ? rateClass : ''}">${rateText}</span>
        </div>
    `;
    }
    showHtmlModal(`${code} ${periodLabel}历史净值`, `<div class="perf-nav-modal-list">${rows}</div>`);
}
