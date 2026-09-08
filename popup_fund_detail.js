async function openFundDetail(code) {
    const overlay = document.getElementById('fundDetailOverlay');
    const title = document.getElementById('fundDetailTitle');
    const content = document.getElementById('fundDetailContent');

    beginFundDetailSession(code);
    const isStale = createFundDetailStaleGuard(code);
    overlay.classList.add('visible');
    observeFundDetailLayout();
    applyFundDetailSize();
    content.innerHTML = '<div class="detail-loading">加载中...</div>';

    try {
        const [live, { myFunds }] = await Promise.all([
            fetchLiveInfo(code),
            storageHelper.getAll(['myFunds'])
        ]);

        if (isStale()) return;

        if (!live || !live.name) {
            content.innerHTML = '<div class="detail-error">无法获取基金信息</div>';
            return;
        }

        const fundData = (myFunds || {})[code] || {};
        const summaryData = Array.isArray(allFundsData)
            ? allFundsData.find(item => item?.code === code)
            : null;
        title.textContent = live.name;

        const hasEstimate = (typeof summaryData?.rate === 'number' && Number.isFinite(summaryData.rate)) || summaryData?.isPenetration;
        const estimateRate = hasEstimate ? summaryData.rate : null;
        const estimateValue = hasEstimate ? Number(summaryData?.price || live.price || 0) : null;

        const holdAmount = Number(summaryData?.amount ?? fundData.amount ?? 0);
        const shares = Number(summaryData?.shares ?? fundData.shares ?? 0);
        const unitValue = Number(summaryData?.prevPrice || live.prevPrice || 0);
        const todayProfit = hasEstimate && typeof summaryData?.todayProfit === 'number'
            ? summaryData.todayProfit
            : (hasEstimate && shares > 0 && unitValue > 0 && (estimateValue || 0) > 0
                ? round2(shares * (estimateValue - unitValue))
                : (hasEstimate && estimateRate !== null ? round2(holdAmount * (estimateRate / 100)) : null));
        const yesterdayProfit = typeof summaryData?.yesterdayProfit === 'number'
            ? summaryData.yesterdayProfit
            : round2(fundData.yesterdayProfit || 0);
        const holdProfit = Number(summaryData?.holdProfit ?? fundData.holdProfit ?? 0);

        // "昨日"标签容易误导：当基金净值日期滞后于今天（如定开债/节假日）时，
        // 显示的是最近一次结算的收益，与"昨日"字面含义不符。改为"最近结算"+日期更准确。
        const settlementDate = (summaryData?.prevPriceDate || live.prevPriceDate || '').slice(0, 10);
        const isStaleSettlement = settlementDate && settlementDate < getToday();
        const yesterdayProfitLabel = isStaleSettlement
            ? `最近结算 (${settlementDate.slice(5)})`
            : '昨日收益';

        const yesterdayRate = typeof summaryData?.yesterdayNavRate === 'number'
            ? summaryData.yesterdayNavRate
            : (live.prevPrice > 0 && live.prevTradingDayPrice > 0
                ? round2((live.prevPrice - live.prevTradingDayPrice) / live.prevTradingDayPrice * 100)
                : 0);

        const upClass = 'up';
        const downClass = 'down';

        const estimateValueText = estimateValue !== null && estimateValue > 0 ? estimateValue.toFixed(4) : '—';
        const estimateRateText = estimateRate !== null ? formatProfit(estimateRate, '%') : '—';
        const estimateRateClass = estimateRate !== null ? (estimateRate >= 0 ? upClass : downClass) : '';
        const todayProfitText = todayProfit !== null ? formatProfit(todayProfit) : '—';
        const todayProfitClass = todayProfit !== null ? (todayProfit >= 0 ? upClass : downClass) : '';

        const html = `
            <div class="detail-hero-section">
                <div class="detail-topline">
                   <div>
                      <div class="detail-code-pill">基金代码: ${code}</div>
                   </div>
                   <div class="estimation-box">
                      <div class="estimation-label">最后更新 / 估值时间</div>
                      <div class="estimation-time">${escapeHtml(live.priceTime || getToday() + ' 15:00')}</div>
                   </div>
                </div>

                <div class="detail-metric-grid compact">
                    <div class="detail-info-item">
                        <span class="detail-info-label">单位净值</span>
                        <span class="detail-info-value bold">${unitValue > 0 ? unitValue.toFixed(4) : '—'}</span>
                    </div>
                    <div class="detail-info-item">
                        <span class="detail-info-label">昨日涨幅</span>
                        <span id="detail-yesterday-rate" class="detail-info-value bold ${yesterdayRate >= 0 ? upClass : downClass}">
                             ${formatProfit(yesterdayRate, '%')}
                        </span>
                    </div>
                    <div class="detail-info-item">
                        <span class="detail-info-label">估值净值</span>
                        <span class="detail-info-value bold ${estimateRateClass}">${estimateValueText}</span>
                    </div>
                    <div class="detail-info-item">
                        <span class="detail-info-label">估值涨幅</span>
                        <span class="detail-info-value bold ${estimateRateClass}">
                            ${estimateRateText}
                        </span>
                    </div>
                </div>

                <div class="detail-metric-grid hero">
                    <div class="detail-info-item">
                        <span class="detail-info-label">持仓金额</span>
                        <span class="detail-info-value hero">${holdAmount.toFixed(2)}</span>
                    </div>
                    <div class="detail-info-item">
                        <span class="detail-info-label">${yesterdayProfitLabel}</span>
                        <span class="detail-info-value hero ${yesterdayProfit >= 0 ? upClass : downClass}">
                            ${formatProfit(yesterdayProfit)}
                        </span>
                    </div>
                    <div class="detail-info-item">
                        <span class="detail-info-label">当日预估收益${summaryData?.isPenetration ? ' (穿透估值)' : ''}</span>
                        <span class="detail-info-value hero ${todayProfitClass}">
                            ${todayProfitText}
                        </span>
                    </div>
                    <div class="detail-info-item">
                        <span class="detail-info-label">持有收益</span>
                        <span class="detail-info-value hero ${holdProfit >= 0 ? upClass : downClass}">
                            ${formatProfit(holdProfit)}
                        </span>
                    </div>
                </div>
            </div>

            <div class="detail-chart-section compact">
                <div class="detail-chart-heading">
                    <span>今日估值走势 (${getToday()})</span>
                    <span class="detail-chart-range">${getIntradayChartRangeLabel()}</span>
                </div>
                <div class="detail-chart-wrap">
                    <canvas id="detailChart" style="width:100%;height:220px;display:block;"></canvas>
                    <div id="chartTooltip" style="display:none;position:absolute;padding:6px 10px;pointer-events:none;min-width:120px;"></div>
                </div>
            </div>

            <div class="detail-section-separator"></div>

            <div class="detail-tabs">
                <div class="detail-tab active" data-tab="holdings">前10重仓资产</div>
                <div class="detail-tab" data-tab="performance">业绩走势</div>
                <div class="detail-tab" data-tab="myReturn">我的收益</div>
            </div>

            <div class="detail-tab-content active" id="tabHoldings">
                <div class="detail-loading">正在实时请求重仓持仓行情...</div>
            </div>

            <div class="detail-tab-content" id="tabPerformance">
                <div class="detail-loading">加载业绩数据...</div>
            </div>

            <div class="detail-tab-content" id="tabMyReturn">
                <div class="detail-loading">加载收益记录...</div>
            </div>
        `;

        if (isStale()) return;
        content.innerHTML = html;

        (() => {
            const cached = fundHistoryData[code];
            let pts = (cached && cached.points && cached.points.length > 0) ? cached.points : null;
            if (pts) {
                pts = ensureIntradayBasePoint(pts);
            } else {
                const rate = unitValue > 0 ? ((estimateValue - unitValue) / unitValue * 100) : 0;
                const nowT = formatTime();
                pts = getIntradayFallbackPoints(rate, nowT);
            }
            requestAnimationFrame(() => {
                if (isStale()) return;
                fundDetailChartRenderState.intraday = {
                    code,
                    currentPrice: estimateValue || 0,
                    basePrice: unitValue || 0,
                    points: Array.isArray(pts) ? [...pts] : []
                };
                drawChart(estimateValue, unitValue, pts);
                syncFundDetailLayout();
            });
        })();

        content.querySelectorAll('.detail-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                content.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
                content.querySelectorAll('.detail-tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                const tabName = tab.dataset.tab;
                document.getElementById(`tab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`).classList.add('active');

                if (tabName === 'myReturn') {
                    loadMyReturn(code, isStale);
                }

                syncFundDetailLayout();
            });
        });

        Promise.allSettled([
            loadHoldings(code, isStale),
            loadPerformance(code, live, fundData, isStale)
        ]).finally(() => {
            if (!isStale()) {
                syncFundDetailLayout();
            }
        });
    } catch (err) {
        if (isStale()) return;
        content.innerHTML = `<div class="detail-error">加载失败: ${escapeHtml(err.message)}</div>`;
    }
}

async function loadHoldings(code, isStale = createFundDetailStaleGuard(code)) {
    const container = document.getElementById('tabHoldings');
    if (!container || isStale()) return;

    try {
        const holdings = typeof fetchFundHoldingsWithCache === 'function'
            ? await fetchFundHoldingsWithCache(code)
            : null;

        if (isStale()) return;

        // 1. 如果是股票重仓
        if (holdings && Array.isArray(holdings.stocks) && holdings.stocks.length > 0) {
            const stockQuotes = typeof fetchStockQuotesBatch === 'function'
                ? await fetchStockQuotesBatch(holdings.stocks)
                : new Map();

            let html = '<div class="holdings-grid">';
            holdings.stocks.slice(0, 10).forEach(stock => {
                const priceInfo = stockQuotes.get(stock.code) || { rate: 0 };
                const changeClass = priceInfo.rate >= 0 ? 'up' : 'down';
                const changeSign = priceInfo.rate >= 0 ? '+' : '';
                if (!stock.name && priceInfo.name) stock.name = priceInfo.name;
                const name = stock.name || stock.code;
                const percent = stock.weight ? stock.weight.toFixed(2) : '--';
                const contrib = ((priceInfo.rate * stock.weight) / 100).toFixed(4);

                html += `
                    <div class="holding-card">
                        <div class="holding-card-left">
                            <div class="holding-card-name">${escapeHtml(name)}</div>
                            <div class="holding-card-badge">${stock.code} · ${percent}% (贡献 ${changeSign}${contrib}%)</div>
                        </div>
                        <div class="holding-card-right">
                            <div class="holding-card-rate ${changeClass}">${changeSign}${priceInfo.rate.toFixed(2)}%</div>
                        </div>
                    </div>
                `;
            });
            html += '</div>';
            if (isStale()) return;
            container.innerHTML = html;
            return;
        }

        // 2. 如果是 FOF 重仓基金
        if (holdings && Array.isArray(holdings.fofs) && holdings.fofs.length > 0) {
            const fofCodes = holdings.fofs.map(f => f.code);
            const fofLives = typeof fetchPrioritizedLiveInfo === 'function'
                ? await fetchPrioritizedLiveInfo(fofCodes).catch(() => [])
                : [];
            const fofLiveMap = new Map((fofLives || []).map(item => [item.code, item.live]));

            let html = '<div class="holdings-grid">';
            holdings.fofs.slice(0, 10).forEach(fof => {
                const live = fofLiveMap.get(fof.code);
                const rate = typeof live?.rate === 'number' ? live.rate : 0;
                const changeClass = rate >= 0 ? 'up' : 'down';
                const changeSign = rate >= 0 ? '+' : '';
                const name = fof.name || fof.code;
                const percent = fof.weight ? fof.weight.toFixed(2) : '--';
                const contrib = ((rate * fof.weight) / 100).toFixed(4);

                html += `
                    <div class="holding-card">
                        <div class="holding-card-left">
                            <div class="holding-card-name">${escapeHtml(name)}</div>
                            <div class="holding-card-badge">${fof.code} · ${percent}% (贡献 ${changeSign}${contrib}%)</div>
                        </div>
                        <div class="holding-card-right">
                            <div class="holding-card-rate ${changeClass}">${changeSign}${rate.toFixed(2)}%</div>
                        </div>
                    </div>
                `;
            });
            html += '</div>';
            if (isStale()) return;
            container.innerHTML = html;
            return;
        }

        container.innerHTML = '<div class="detail-error">暂无前十大重仓持仓披露数据</div>';
    } catch (err) {
        if (isStale()) return;
        container.innerHTML = `<div class="detail-error">重仓接口失败：${escapeHtml(err.message || '未知错误')}</div>`;
        console.error('[loadHoldings] 加载持仓失败:', err);
    }
}

async function loadMyReturnPeriod(code, period, isStale) {
    const summary = document.getElementById('myReturnSummary');
    const canvas = document.getElementById('myReturnChart');
    const listPreview = document.getElementById('myReturnListPreview');
    if (!canvas || !summary || isStale()) return;

    const state = _myReturnState[code];
    if (state) {
        state.period = period;
        state.requestId = (state.requestId || 0) + 1;
    }
    const requestId = state?.requestId || 0;
    const isStaleRequest = () => isStale() || _myReturnState[code]?.requestId !== requestId;

    try {
        summary.innerHTML = `<span class="detail-inline-status">正在加载 ${getMyReturnPeriodLabel(period)} 数据...</span>`;

        const { dailyProfitHistory } = await storageHelper.getAll(['dailyProfitHistory']);
        if (isStaleRequest()) return;

        const history = dailyProfitHistory || {};
        const fullHistory = [];

        const perfState = _performanceState[code];
        const netValueMap = new Map();
        if (perfState && Array.isArray(perfState.fundData)) {
            perfState.fundData.forEach(item => {
                netValueMap.set(item.date, item.dailyRate);
            });
        }

        // 兜底：如果业绩走势 tab 还没打开（fundData 为空），直接从 HistoryDB 取已存净值日涨幅
        if (netValueMap.size === 0) {
            try {
                const dbEntries = await HistoryDB.getRange(code, '', formatDate(new Date()));
                if (Array.isArray(dbEntries)) {
                    dbEntries.forEach(item => {
                        const rate = item.rate ?? item.dailyRate;
                        if (item.date && rate !== undefined && rate !== null) {
                            netValueMap.set(item.date, rate);
                        }
                    });
                }
            } catch (e) {
                console.warn('[loadMyReturnPeriod] 从 HistoryDB 加载净值日涨幅失败:', e);
            }
        }

        Object.keys(history).sort().forEach(date => {
            const entry = history[date];
            if (entry && entry.byCode && typeof entry.byCode[code] === 'number') {
                const profit = entry.byCode[code];
                const dailyRate = netValueMap.get(date);
                fullHistory.push({
                    date,
                    profit,
                    rate: dailyRate !== undefined ? dailyRate : null
                });
            }
        });

        const { startStr, endStr } = (period === 'ALL')
            ? { startStr: '', endStr: formatDate(new Date()) }
            : getPerformancePeriodDateRange(period);

        const filteredHistory = fullHistory.filter(h => h.date >= startStr && h.date <= endStr);

        if (filteredHistory.length === 0) {
            summary.innerHTML = `<span class="detail-inline-status">${getMyReturnPeriodLabel(period)} 暂无收益记录</span>`;
            listPreview.innerHTML = '<div class="perf-nav-empty">暂无收益记录</div>';
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }

        let comparisonData = null;
        try {
            comparisonData = await fetchComparisonData(code, startStr, endStr);
            if (isStaleRequest()) return;
        } catch (e) {
            console.warn('[loadMyReturnPeriod] 对比数据获取失败:', e);
        }

        if (state) {
            state.fundHistory = filteredHistory;
            state.comparisonData = comparisonData;
        }

        renderMyReturnResult(filteredHistory, summary, listPreview, canvas, period);
    } catch (err) {
        console.error('[loadMyReturnPeriod] 失败:', err);
        if (!isStaleRequest()) {
            summary.innerHTML = '<span class="detail-inline-status error">加载失败</span>';
        }
    }
}

async function loadPerformancePeriod(code, period, isStale = createFundDetailStaleGuard(code)) {
    const summary = document.getElementById('perfSummary');
    const canvas = document.getElementById('perfChart');
    const preview = document.getElementById('perfNavPreview');
    const moreLink = document.getElementById('perfMoreLink');
    if (!canvas || !summary || isStale()) return;

    const state = getCurrentPerformanceState(code);
    if (state) {
        state.period = period;
        state.requestId = (state.requestId || 0) + 1;
    }

    const requestId = state?.requestId || 0;
    const isStaleRequest = () => isStale() || _performanceState[code]?.requestId !== requestId;
    if (isStaleRequest()) return;

    const { startStr, endStr } = getPerformancePeriodDateRange(period);

    try {
        setPerformanceLoadingState(code, summary, preview, moreLink);

        let fundData = getCachedPerformanceData(code, period, startStr, endStr);
        if (fundData && fundData.length > 0 && typeof fundData[0].dailyRate === 'undefined') {
            clearPerformanceCacheEntry(code, null);
            fundData = null;
        }

        if (!fundData) {
            const dbData = await HistoryDB.getRange(code, startStr, endStr);
            const minRequired = period === 'LY' ? 150 : 8;
            let hasGap = false;
            if (Array.isArray(dbData) && dbData.length >= minRequired) {
                for (let i = 1; i < dbData.length; i++) {
                    const prevDate = new Date(dbData[i - 1].date);
                    const currDate = new Date(dbData[i].date);
                    const diffDays = Math.ceil(Math.abs(currDate - prevDate) / (1000 * 60 * 60 * 24));
                    if (diffDays > 12) {
                        hasGap = true;
                        break;
                    }
                }
            }
            if (Array.isArray(dbData) && dbData.length >= minRequired && !hasGap) {
                fundData = dbData.map(d => ({ ...d, dailyRate: d.rate }));
                cachePerformanceFundData(code, period, startStr, endStr, fundData);
            }
        }

        if (!fundData) {
            const { pageSize, preferFullHistory } = getPerformanceRequestOptions(code, period);
            if (preferFullHistory) {
                const fullHistoryData = await fetchAndCacheFullPerformanceHistory(code, endStr);
                if (isStaleRequest()) return;
                fundData = Array.isArray(fullHistoryData)
                    ? filterPerformanceDataByDate(fullHistoryData, startStr, endStr)
                    : null;
            } else {
                const requestStartStr = period === 'LY' ? startStr : formatDate(new Date(parseYmdDate(startStr).getTime() - 10 * CONSTANTS.DAY_MS));
                fundData = await fetchFundNetValues(code, requestStartStr, endStr, pageSize, { preferFullHistory: false });
                if (Array.isArray(fundData)) {
                    fundData = filterPerformanceDataByDate(fundData, startStr, endStr);
                }
                if (isStaleRequest()) return;
                cachePerformanceFundData(code, period, startStr, endStr, fundData);
            }
        }

        if (!Array.isArray(fundData)) {
            setPerformanceEmptyState(code, summary, preview, moreLink, '暂无数据');
            return;
        }

        if (isStaleRequest()) return;

        fundData = mergeLatestConfirmedNav(fundData, state?.latestNav);

        if (!Array.isArray(fundData) || fundData.length === 0) {
            setPerformanceEmptyState(code, summary, preview, moreLink, '暂无数据');
            return;
        }

        const shouldLoadComparisonData = !['1Y', '3Y', 'LY'].includes(period);
        let comparisonData = null;
        if (shouldLoadComparisonData) {
            try {
                comparisonData = await fetchComparisonData(code, startStr, endStr);
                if (isStaleRequest()) return;
            } catch (e) {
                console.warn('[loadPerformancePeriod] 获取对比数据失败:', e);
            }
        }

        renderPerformanceResult(code, fundData, summary, preview, moreLink, canvas, comparisonData);
    } catch (err) {
        if (isStaleRequest()) return;
        setPerformanceEmptyState(code, summary, preview, moreLink, '加载失败');
        console.error('[loadPerformancePeriod] 业绩数据加载失败:', err);
    }
}
