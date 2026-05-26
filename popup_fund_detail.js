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
        title.textContent = live.name;

        const unitValue = live.prevPrice;
        const estimateValue = live.price;
        const estimateRate = unitValue > 0 ? ((estimateValue - unitValue) / unitValue * 100) : (live.rate || 0);

        const holdAmount = fundData.amount || 0;
        const shares = fundData.shares || 0;
        const todayProfit = shares > 0 && unitValue > 0 && estimateValue > 0
            ? round2(shares * (estimateValue - unitValue))
            : (estimateRate !== 0 ? round2(holdAmount * (estimateRate / 100)) : 0);
        const holdProfit = fundData.holdProfit || 0;

        const yesterdayRate = calculateDisplayedYesterdayRate({
            shares,
            prevTradingDayPrice: live.prevTradingDayPrice || 0,
            yesterdayProfit: fundData.yesterdayProfit || 0,
            prevPrice: live.prevPrice || 0,
            acNetValue: live.acNetValue,
            prevAcNetValue: live.prevAcNetValue
        });

        const upClass = 'up';
        const downClass = 'down';

        const html = `
            <div style="padding: 18px 16px 0; background: transparent;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:12px;">
                   <div style="display:flex; flex-direction:column; gap:2px; min-width:0;">
                      <div style="font-size:12px; color:#4a6a90; font-weight:600;">基金代码: ${code}</div>
                   </div>
                   <div class="estimation-box">
                      <div class="estimation-label">最后更新 / 估值时间</div>
                      <div class="estimation-time">${live.priceTime || getToday() + ' 15:00'}</div>
                   </div>
                </div>

                <div style="display:grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap:16px; margin-bottom:18px; border-bottom: 1px solid rgba(64, 103, 148, 0.36); padding: 14px; border-radius: 14px; background: linear-gradient(180deg, rgba(15, 31, 52, 0.56), rgba(11, 24, 41, 0.42)); box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);">
                    <div class="detail-info-item">
                        <span class="detail-info-label">单位净值</span>
                        <span class="detail-info-value bold">${unitValue.toFixed(4)}</span>
                    </div>
                    <div class="detail-info-item">
                        <span class="detail-info-label">昨日涨幅</span>
                        <span id="detail-yesterday-rate" class="detail-info-value bold ${yesterdayRate >= 0 ? upClass : downClass}">
                             ${formatProfit(yesterdayRate, '%')}
                        </span>
                    </div>
                    <div class="detail-info-item">
                        <span class="detail-info-label">估值净值</span>
                        <span class="detail-info-value bold ${estimateRate >= 0 ? upClass : downClass}">${estimateValue.toFixed(4)}</span>
                    </div>
                    <div class="detail-info-item">
                        <span class="detail-info-label">估值涨幅</span>
                        <span class="detail-info-value bold ${estimateRate >= 0 ? upClass : downClass}">
                            ${formatProfit(estimateRate, '%')}
                        </span>
                    </div>
                </div>

                <div style="display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap:16px; padding: 14px; margin-bottom: 14px; border-radius: 14px; border: 1px solid rgba(64, 103, 148, 0.36); background: linear-gradient(180deg, rgba(15, 31, 52, 0.56), rgba(11, 24, 41, 0.42)); box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);">
                    <div class="detail-info-item">
                        <span class="detail-info-label">持仓金额</span>
                        <span class="detail-info-value hero">${holdAmount.toFixed(2)}</span>
                    </div>
                    <div class="detail-info-item">
                        <span class="detail-info-label">当日预估收益</span>
                        <span class="detail-info-value hero ${todayProfit >= 0 ? upClass : downClass}">
                            ${formatProfit(todayProfit)}
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

            <div class="detail-chart-section" style="padding: 0 16px 24px; margin-top:-5px;">
                <div style="font-size:11px;color:#4a6a90;margin-bottom:8px; display:flex; justify-content:space-between;">
                    <span>📈 今日估值走势 (${getToday()})</span>
                    <span style="font-size:10px; opacity:0.6;">${getIntradayChartRangeLabel()}</span>
                </div>
                <div style="position:relative;">
                    <canvas id="detailChart" style="width:100%;height:220px;display:block;"></canvas>
                    <div id="chartTooltip" style="display:none;position:absolute;background:rgba(10,21,37,0.9);border:1px solid #1e3a5f;border-radius:6px;padding:6px 10px;pointer-events:none;min-width:120px;"></div>
                </div>
            </div>

            <div style="height: 10px; background: transparent; border-top: 1px solid rgba(64, 103, 148, 0.24);"></div>

            <div class="detail-tabs">
                <div class="detail-tab active" data-tab="holdings">前10重仓股票</div>
                <div class="detail-tab" data-tab="performance">业绩走势</div>
                <div class="detail-tab" data-tab="myReturn">我的收益</div>
            </div>

            <div class="detail-tab-content active" id="tabHoldings">
                <div class="detail-loading">正在实时请求重仓股行情...</div>
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
                drawChart(code, estimateValue, unitValue, pts);
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
        content.innerHTML = `<div class="detail-error">加载失败: ${err.message}</div>`;
    }
}

async function loadHoldings(code, isStale = createFundDetailStaleGuard(code)) {
    const container = document.getElementById('tabHoldings');
    if (!container || isStale()) return;

    try {
        const url = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition?FCODE=${code}&deviceid=Wap&plat=Wap&product=EFund&version=6.5.9`;
        const res = await fetch(url);
        const data = await res.json();

        if (isStale()) return;

        const stockCodes = [];
        const stockNames = [];
        const stockPercents = [];

        if (data && data.Datas && data.Datas.fundStocks && data.Datas.fundStocks.length > 0) {
            data.Datas.fundStocks.forEach(stock => {
                stockCodes.push(stock.GPDM);
                stockNames.push(stock.GPJC);
                stockPercents.push(stock.JZBL);
            });
        }

        if (stockCodes.length === 0) {
            container.innerHTML = '<div class="detail-error">接口获取不到数据</div>';
            return;
        }

        const stockList = stockCodes.slice(0, 10).map((c, idx) => {
            const stockData = data.Datas.fundStocks[idx];
            if (stockData.TEXCH === '1') return 'sh' + c;
            if (stockData.TEXCH === '2') return 'sz' + c;
            if (stockData.TEXCH === '5' || stockData.TEXCH === '8' || stockData.NEWTEXCH === '116') {
                let hkCode = c;
                while (hkCode.length < 5) hkCode = '0' + hkCode;
                return 'hk' + hkCode;
            }
            if (c.startsWith('6')) return 'sh' + c;
            return 'sz' + c;
        });

        const stockPrices = await fetchStockPrices(stockList);

        let html = '<div class="holdings-grid">';
        stockCodes.slice(0, 10).forEach((stockCode, idx) => {
            const marketCode = stockList[idx];
            const priceInfo = stockPrices[marketCode] || { rate: 0 };
            const changeClass = priceInfo.rate >= 0 ? 'up' : 'down';
            const changeSign = priceInfo.rate >= 0 ? '+' : '';
            const name = stockNames[idx] || stockCode;
            const percent = stockPercents[idx] || '--';

            html += `
                <div class="holding-card">
                    <div class="holding-card-left">
                        <div class="holding-card-name">${name}</div>
                        <div class="holding-card-badge">${stockCode} · ${percent}%</div>
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
    } catch (err) {
        if (isStale()) return;
        container.innerHTML = '<div class="detail-error">接口获取不到数据</div>';
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
        summary.innerHTML = `<span style="font-size:12px; color:#4a6a90;">正在加载 ${getMyReturnPeriodLabel(period)} 数据...</span>`;

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
            ? { startStr: '1900-01-01', endStr: formatDate(new Date()) }
            : getPerformancePeriodDateRange(period);

        const filteredHistory = fullHistory.filter(h => h.date >= startStr && h.date <= endStr);

        if (filteredHistory.length === 0) {
            summary.innerHTML = `<span style="font-size:12px; color:#4a6a90;">${getMyReturnPeriodLabel(period)} 暂无收益记录</span>`;
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

        renderMyReturnResult(code, filteredHistory, summary, listPreview, canvas, comparisonData, period);
    } catch (err) {
        console.error('[loadMyReturnPeriod] 失败:', err);
        if (!isStaleRequest()) {
            summary.innerHTML = '<span style="font-size:12px; color:#ff4d4f;">加载失败</span>';
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
