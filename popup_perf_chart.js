// ==================== 业绩走势图表 / 详情弹窗布局域 ====================

// 从交易流水构建持仓区间列表：[{ open: 'YYYY-MM-DD', close: 'YYYY-MM-DD'|null }]
// close 为 null 表示至今仍在持仓。用于 tooltip 正确显示"持有第 N 天"，避免清仓后继续累加。
function buildHoldingPeriodsFromTrades(tradeHistory, fallbackAddedDate = '') {
    const periods = [];
    const orders = (typeof normalizeTradeRecordList === 'function' && Array.isArray(tradeHistory))
        ? normalizeTradeRecordList(tradeHistory, { source: 'order' })
            .filter(order => order.status === 'confirmed')
            .sort(compareTradeExecutionOrder)
        : [];

    let shares = 0;
    let openDate = '';

    orders.forEach(order => {
        const displayType = getTradeDisplayType(order);
        const tradeDate = getTradeMarkerDate(order) || getTradeRecordDate(order) || '';
        const shareEffect = getTradeShareEffect(order);

        if (displayType === 'initial') {
            shares = Math.max(0, roundShares(Math.abs(shareEffect)));
            openDate = shares > 0 ? tradeDate : '';
            return;
        }
        if (displayType === 'add' || displayType === 'dividend_reinvest') {
            if (shares <= 0 && shareEffect > 0) openDate = tradeDate || openDate;
            shares = Math.max(0, roundShares(shares + shareEffect));
            if (shares > 0 && !openDate) openDate = tradeDate || '';
            return;
        }
        if (displayType === 'remove' || displayType === 'clear') {
            shares = Math.max(0, roundShares(shares + shareEffect));
            if (displayType === 'clear' || shares <= 0.001) {
                if (openDate) periods.push({ open: openDate, close: tradeDate || openDate });
                shares = 0;
                openDate = '';
            }
        }
    });

    if (shares > 0 && openDate) {
        periods.push({ open: openDate, close: null });
    }

    // 无可用流水时回退到 addedDate（至今在持），保持旧行为
    if (!periods.length && fallbackAddedDate) {
        periods.push({ open: normalizePerfDate(fallbackAddedDate), close: null });
    }

    return periods;
}

// 计算某日在哪个持仓区间内，返回"持有第 N 天"（1 起）；清仓后 / 建仓前返回 null
function holdDayForDate(periods, dateStr) {
    const d = parseYmdDate(dateStr);
    if (!d) return null;
    const t = d.getTime();
    for (const period of periods) {
        const open = parseYmdDate(period.open);
        if (!open) continue;
        const openT = open.getTime();
        if (t < openT) continue;
        const close = period.close ? parseYmdDate(period.close) : null;
        if (close && t > close.getTime()) continue;   // 已在此区间之后清仓
        return Math.floor((t - openT) / CONSTANTS.DAY_MS) + 1;
    }
    return null;
}

function hidePerformanceTooltip() {
    const tooltip = document.getElementById('perfChartTooltip');
    if (tooltip) tooltip.style.display = 'none';
}

function resetPerformanceViewState() {
    hidePerformanceTooltip();
    const canvas = document.getElementById('perfChart');
    if (!canvas) return;

    canvas.onmousemove = null;
    canvas.onmouseleave = null;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function getPerformanceChartData(fundData) {
    if (!Array.isArray(fundData) || fundData.length === 0) {
        return null;
    }
    const prices = fundData.map(item => item.price);
    const dates = fundData.map(item => item.date);
    const dailyRates = fundData.map(item => item.dailyRate);
    const rawAcPrices = fundData.map(item => item.acPrice ?? null);
    const hasAC = rawAcPrices.some(v => v !== null && v > 0);
    const acPrices = hasAC ? rawAcPrices : null;
    if (prices.length === 0 || dates.length === 0) {
        return null;
    }
    const firstForDir = hasAC ? (acPrices.find(v => v > 0) || prices[0]) : prices[0];
    const lastForDir = hasAC ? ([...acPrices].reverse().find(v => v > 0) || prices[prices.length - 1]) : prices[prices.length - 1];
    return {
        prices,
        dates,
        dailyRates,
        acPrices,
        isUp: lastForDir >= firstForDir
    };
}

function resetFundDetailPerformance(code = currentFundDetailCode) {
    if (code) {
        resetFundDetailViewState();
        clearFundDetailPerformanceSession(code);
    } else {
        resetFundDetailViewState();
    }
}

function clearFundDetailPerformanceSession(code) {
    if (!code) return;
    delete _performanceState[code];
}

function getCurrentPerformanceState(code = currentFundDetailCode) {
    if (!code) return null;
    return _performanceState[code] || null;
}

function getCurrentPerformanceChartData() {
    const state = getCurrentPerformanceState();
    if (!state || !Array.isArray(state.fundData) || state.fundData.length === 0) {
        return null;
    }
    return getPerformanceChartData(state.fundData);
}

function getRecentPerformancePreviewList(fundData, limit = 6) {
    if (!Array.isArray(fundData) || fundData.length === 0) {
        return [];
    }
    return fundData.slice(-limit).reverse();
}

function cancelFundDetailLayoutSync() {
    if (fundDetailLayoutFrameId) {
        cancelAnimationFrame(fundDetailLayoutFrameId);
        fundDetailLayoutFrameId = null;
    }
}

function resizeFundDetailCharts() {
    const overlay = document.getElementById('fundDetailOverlay');
    if (!overlay || !overlay.classList.contains('visible')) return;

    const detailCanvas = document.getElementById('detailChart');
    const intradayState = fundDetailChartRenderState.intraday;
    if (detailCanvas && intradayState) {
        drawChart(
            intradayState.code,
            intradayState.currentPrice,
            intradayState.basePrice,
            intradayState.points
        );
    }

    const perfCanvas = document.getElementById('perfChart');
    const performanceChartData = getCurrentPerformanceChartData();
    if (perfCanvas && performanceChartData) {
        const perfState = getCurrentPerformanceState();
        const comparisonData = perfState?.comparisonData ?? null;
        drawPerfChartWithComparison(perfCanvas, performanceChartData, comparisonData);
    }

    const myReturnCanvas = document.getElementById('myReturnChart');
    if (myReturnCanvas) {
        const state = _myReturnState[currentFundDetailCode];
        if (state && state.fundHistory.length > 0) {
            const dates = state.fundHistory.map(h => h.date);
            let sum = 0;
            const profits = state.fundHistory.map(h => {
                sum += h.profit;
                return sum;
            });

            drawMyReturnChartWithComparison(myReturnCanvas, {
                profits,
                dates,
                isUp: sum >= 0
            });
        }
    }
}

function scheduleFundDetailLayoutSync() {
    cancelFundDetailLayoutSync();
    fundDetailLayoutFrameId = requestAnimationFrame(() => {
        fundDetailLayoutFrameId = null;
        resizeFundDetailCharts();
    });
}

function applyFundDetailSize() {
    const box = document.querySelector('.fund-detail-box');
    const fitBtn = document.getElementById('fundDetailFitBtn');
    if (!box) return;

    box.classList.toggle('fit-page', fundDetailFitPage);
    if (fitBtn) fitBtn.textContent = fundDetailFitPage ? '恢复默认' : '贴合页面';

    scheduleFundDetailLayoutSync();
}

function toggleFundDetailFitPage() {
    fundDetailFitPage = !fundDetailFitPage;
    applyFundDetailSize();
}

function observeFundDetailLayout() {
    const box = document.querySelector('.fund-detail-box');
    if (!box || typeof ResizeObserver === 'undefined') return;

    if (fundDetailResizeObserver) {
        fundDetailResizeObserver.disconnect();
    }

    fundDetailResizeObserver = new ResizeObserver(() => {
        scheduleFundDetailLayoutSync();
    });
    fundDetailResizeObserver.observe(box);
}

window.addEventListener('resize', () => {
    scheduleFundDetailLayoutSync();
});

function syncFundDetailLayout() {
    scheduleFundDetailLayoutSync();
}

function resetFundDetailViewState() {
    resetFundDetailChartRenderState();
    resetPerformanceViewState();
}

function cleanupFundDetailSessionState(code) {
    if (code) {
        resetFundDetailPerformance(code);
    }
}

function beginFundDetailSession(code) {
    if (currentFundDetailCode) {
        resetFundDetailPerformance(currentFundDetailCode);
    }
    currentFundDetailCode = code;
    currentFundDetailSessionId += 1;
    return currentFundDetailSessionId;
}

function isCurrentFundDetail(code, sessionId = currentFundDetailSessionId) {
    return currentFundDetailCode === code && currentFundDetailSessionId === sessionId;
}

function createFundDetailStaleGuard(code, sessionId = currentFundDetailSessionId) {
    return () => !isCurrentFundDetail(code, sessionId);
}

function drawChart(code, currentPrice, basePrice, chartPoints) {
    const canvas = document.getElementById('detailChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || canvas.parentElement?.clientWidth || canvas.offsetWidth || 400;
    const height = rect.height || canvas.offsetHeight || 220;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const padding = { top: 20, right: 10, bottom: 30, left: 52 };
    const cw = width - padding.left - padding.right;
    const ch = height - padding.top - padding.bottom;

    let points = chartPoints && chartPoints.length > 0 ? chartPoints : [];
    if (points.length === 0) {
        const rate = basePrice > 0 ? ((currentPrice - basePrice) / basePrice * 100) : 0;
        points = [{ time: '--', rate: 0 }, { time: getToday(), rate }];
    }

    const rates = points.map(p => p.rate);
    const absMax = Math.max(Math.abs(Math.max(...rates)), Math.abs(Math.min(...rates)), 0.05);
    const yMax = absMax * 1.2;
    const yMin = -absMax * 1.2;
    const yRange = yMax - yMin;
    const toY = r => padding.top + ch * (1 - (r - yMin) / yRange);

    const isIntraday = points.length > 0 && isIntradayChartTime(points[0].time);
    const toX = isIntraday
        ? t => padding.left + (cw / CONSTANTS.INTRADAY_CHART_TOTAL_MINUTES) * getIntradayChartOffsetMinutes(t)
        : (_, i) => padding.left + (cw / Math.max(points.length - 1, 1)) * i;

    const lastRate = rates[rates.length - 1];
    const isUp = lastRate >= 0;
    const lineColor = isUp ? '#ff7875' : '#73d13d';

    ctx.fillStyle = '#0a1525';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = padding.top + (ch / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(padding.left + cw, y);
        ctx.stroke();
    }

    const zeroY = toY(0);
    ctx.strokeStyle = 'rgba(100,140,180,0.5)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padding.left, zeroY);
    ctx.lineTo(padding.left + cw, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    const grad = ctx.createLinearGradient(0, padding.top, 0, padding.top + ch);
    if (isUp) {
        grad.addColorStop(0, 'rgba(245,34,45,0.25)');
        grad.addColorStop(1, 'rgba(245,34,45,0)');
    } else {
        grad.addColorStop(0, 'rgba(57,181,110,0)');
        grad.addColorStop(1, 'rgba(57,181,110,0.25)');
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(isIntraday ? toX(points[0].time) : toX(null, 0), zeroY);
    points.forEach((p, i) => ctx.lineTo(isIntraday ? toX(p.time) : toX(null, i), toY(p.rate)));
    ctx.lineTo(isIntraday ? toX(points[points.length - 1].time) : toX(null, points.length - 1), zeroY);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    points.forEach((p, i) => {
        const x = isIntraday ? toX(p.time) : toX(null, i);
        if (i === 0) ctx.moveTo(x, toY(p.rate));
        else ctx.lineTo(x, toY(p.rate));
    });
    ctx.stroke();

    ctx.fillStyle = '#4a6a90';
    ctx.font = '10px Inter';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
        const r = yMax - (yRange / 4) * i;
        ctx.fillText(formatProfit(r, '%'), padding.left - 4, padding.top + (ch / 4) * i + 4);
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = '#4a6a90';
    if (isIntraday) {
        getIntradayAxisTicks().forEach(({ time, min }) => {
            ctx.fillText(time, padding.left + (cw / CONSTANTS.INTRADAY_CHART_TOTAL_MINUTES) * min, height - 8);
        });
    } else {
        const idxs = [0, Math.floor(points.length / 2), points.length - 1];
        idxs.forEach(idx => {
            if (points[idx]) ctx.fillText(points[idx].time, toX(null, idx), height - 8);
        });
    }

    canvas.onmousemove = (e) => {
        const tooltip = document.getElementById('chartTooltip');
        if (!tooltip) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        if (x < padding.left || x > padding.left + cw) {
            tooltip.style.display = 'none';
            return;
        }
        let idx = 0;
        let minDist = Infinity;
        points.forEach((p, i) => {
            const px = isIntraday ? toX(p.time) : toX(null, i);
            const d = Math.abs(px - x);
            if (d < minDist) {
                minDist = d;
                idx = i;
            }
        });
        const pt = points[idx];
        if (pt) {
            const clr = pt.rate >= 0 ? '#ff7875' : '#73d13d';
            const est = basePrice > 0 ? `¥${(basePrice * (1 + pt.rate / 100)).toFixed(4)} ` : '';
            tooltip.innerHTML = `<div style="font-size:10px;color:#8aacce;">${pt.time}</div><div style="font-size:12px;font-weight:bold;color:#e8f0ff;">${est}<span style="color:${clr}">${formatProfit(pt.rate, '%')}</span></div>`;
            tooltip.style.display = 'block';
            const pr = canvas.parentElement.getBoundingClientRect();
            let left = (rect.left - pr.left) + x + 12;
            if (left + 145 > pr.width) left = (rect.left - pr.left) + x - 155;
            tooltip.style.left = left + 'px';
            tooltip.style.top = ((rect.top - pr.top) + (e.clientY - rect.top) - 52) + 'px';
        }
    };
    canvas.onmouseleave = () => {
        const tooltip = document.getElementById('chartTooltip');
        if (tooltip) tooltip.style.display = 'none';
    };
}

function drawMyReturnChartWithComparison(canvas, chartData) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.parentElement?.clientWidth || canvas.getBoundingClientRect().width || canvas.parentElement?.offsetWidth || canvas.offsetWidth || 360;
    const height = canvas.getBoundingClientRect().height || parseInt(canvas.style.height) || canvas.offsetHeight || 180;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const pad = { top: 20, right: 10, bottom: 25, left: 52 };
    const cw = width - pad.left - pad.right;
    const ch = height - pad.top - pad.bottom;

    const { profits, dates, isUp } = chartData;
    const maxP = Math.max(...profits, 1);
    const minP = Math.min(...profits, -1);
    const range = maxP - minP || 1;

    const maxIndex = Math.max(dates.length - 1, 1);
    const toX = i => pad.left + (cw / maxIndex) * i;
    const toY = p => pad.top + ch * (1 - (p - minP) / range);

    let currentHoverIndex = null;
    const renderChart = (hoverIndex = null) => {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        ctx.fillStyle = '#0d1b2e';
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = 'rgba(30, 58, 95, 0.3)';
        ctx.lineWidth = 1;
        [0, 0.25, 0.5, 0.75, 1].forEach(p => {
            const y = pad.top + ch * p;
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(pad.left + cw, y);
            ctx.stroke();
        });

        const zeroY = toY(0);
        if (zeroY >= pad.top && zeroY <= pad.top + ch) {
            ctx.strokeStyle = 'rgba(100,140,180,0.4)';
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(pad.left, zeroY);
            ctx.lineTo(pad.left + cw, zeroY);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        if (hoverIndex !== null) {
            const hx = toX(hoverIndex);
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(hx, pad.top);
            ctx.lineTo(hx, pad.top + ch);
            ctx.stroke();
        }

        const fundColor = isUp ? '#ff7875' : '#73d13d';
        const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch);
        gradient.addColorStop(0, isUp ? 'rgba(255,120,117,0.15)' : 'rgba(115,209,61,0.15)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(toX(0), zeroY);
        profits.forEach((p, i) => ctx.lineTo(toX(i), toY(p)));
        ctx.lineTo(toX(profits.length - 1), zeroY);
        ctx.fill();

        ctx.strokeStyle = fundColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        profits.forEach((p, i) => {
            if (i === 0) ctx.moveTo(toX(i), toY(p));
            else ctx.lineTo(toX(i), toY(p));
        });
        ctx.stroke();

        if (hoverIndex !== null) {
            const hx = toX(hoverIndex);
            const hy = toY(profits[hoverIndex]);
            ctx.fillStyle = fundColor;
            ctx.beginPath();
            ctx.arc(hx, hy, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        ctx.fillStyle = '#6985a3';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(maxP.toFixed(0), pad.left - 5, pad.top + 5);
        ctx.fillText(minP.toFixed(0), pad.left - 5, pad.top + ch);
        ctx.fillText(((maxP + minP) / 2).toFixed(0), pad.left - 5, pad.top + ch / 2 + 4);

        ctx.textAlign = 'left';
        ctx.fillText(dates[0], pad.left, height - 10);
        ctx.textAlign = 'right';
        ctx.fillText(dates[dates.length - 1], width - pad.right, height - 10);
    };

    renderChart();

    canvas.onmousemove = (e) => {
        const tooltip = document.getElementById('myReturnChartTooltip');
        if (!tooltip) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        if (x < pad.left || x > pad.left + cw) {
            tooltip.style.display = 'none';
            renderChart(null);
            return;
        }
        const relativeX = Math.max(0, Math.min(cw, x - pad.left));
        const idx = Math.max(0, Math.min(dates.length - 1, Math.round((relativeX / cw) * maxIndex)));

        if (idx !== currentHoverIndex) {
            currentHoverIndex = idx;
            renderChart(idx);
        }

        const date = dates[idx];
        const p = profits[idx];
        const clr = p >= 0 ? '#ff7875' : '#73d13d';
        tooltip.innerHTML = `
            <div style="font-size:10px;color:#8aacce;margin-bottom:4px;">${date}</div>
            <div style="font-size:11px;"><span style="color:#8aacce;">累计收益</span> <span style="color:${clr};font-weight:bold;">${formatProfit(p)}</span></div>
        `;
        tooltip.style.display = 'block';
        const pr = canvas.parentElement.getBoundingClientRect();
        let left = (rect.left - pr.left) + x + 12;
        if (left + 120 > pr.width) left = (rect.left - pr.left) + x - 130;
        tooltip.style.left = left + 'px';
        tooltip.style.top = '10px';
    };

    canvas.onmouseleave = () => {
        const tooltip = document.getElementById('myReturnChartTooltip');
        if (tooltip) tooltip.style.display = 'none';
        renderChart(null);
    };
}

function drawPerfChartWithComparison(canvas, chartData, comparisonData = null) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.parentElement?.clientWidth || canvas.getBoundingClientRect().width || canvas.parentElement?.offsetWidth || canvas.offsetWidth || 360;
    const height = canvas.getBoundingClientRect().height || parseInt(canvas.style.height) || canvas.offsetHeight || 220;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const pad = { top: 30, right: 10, bottom: 28, left: 52 };
    const cw = width - pad.left - pad.right;
    const ch = height - pad.top - pad.bottom;

    const { prices, dates, isUp, acPrices, dailyRates } = chartData;
    const baseP = prices[0];
    const baseAC = acPrices ? (acPrices.find(v => v > 0) || null) : null;
    let fundReturns = prices.map((p, i) => {
        const ac = acPrices ? acPrices[i] : null;
        if (baseAC && ac != null && ac > 0) {
            return (ac - baseAC) / baseAC * 100;
        }
        return (p - baseP) / baseP * 100;
    });

    let similarReturns = null;
    let benchmarkReturns = null;
    if (comparisonData) {
        const alignData = (dataArray) => {
            if (!Array.isArray(dataArray) || dataArray.length === 0) return null;
            const map = new Map();
            dataArray.forEach(d => {
                if (d.date && !isNaN(d.rate)) map.set(d.date, d.rate);
            });
            if (map.size === 0) return null;

            let baseRate = 0;
            const firstChartDate = dates[0];
            const sortedDates = Array.from(map.keys()).sort();
            if (map.has(firstChartDate)) {
                baseRate = map.get(firstChartDate);
            } else {
                const prevDate = [...sortedDates].reverse().find(d => d <= firstChartDate);
                baseRate = prevDate ? map.get(prevDate) : map.get(sortedDates[0]);
            }
            if (baseRate === undefined || isNaN(baseRate)) baseRate = 0;

            let lastValidRate = baseRate;
            return dates.map(date => {
                let currentRate = map.get(date);
                if (currentRate === undefined || isNaN(currentRate)) {
                    const prevDate = [...sortedDates].reverse().find(d => d <= date);
                    if (prevDate) currentRate = map.get(prevDate);
                }
                if (currentRate === undefined || isNaN(currentRate)) {
                    currentRate = lastValidRate;
                } else {
                    lastValidRate = currentRate;
                }
                const result = currentRate - baseRate;
                return isNaN(result) ? 0 : result;
            });
        };

        const alignedFundSeries = alignData(comparisonData.fundSeries);
        if (alignedFundSeries) {
            fundReturns = alignedFundSeries;
        }
        similarReturns = alignData(comparisonData.similarAvg);
        benchmarkReturns = alignData(comparisonData.benchmark);
    }

    const allReturns = [...fundReturns];
    if (similarReturns) allReturns.push(...similarReturns.filter(v => v !== null));
    if (benchmarkReturns) allReturns.push(...benchmarkReturns.filter(v => v !== null));

    const maxR = Math.max(...allReturns, 0.01);
    const minR = Math.min(...allReturns, -0.01);
    const range = maxR - minR || 0.01;

    const maxIndex = Math.max(prices.length - 1, 1);
    const toX = i => pad.left + (cw / maxIndex) * i;
    const toY = r => pad.top + ch * (1 - (r - minR) / range);

    const perfState = getCurrentPerformanceState();
    let currentHoverIndex = null;
    let pendingHoverIndex = null;
    let hoverFrameId = null;

    const findMarkerIndex = (rawDate) => {
        const markerDate = normalizePerfDate(rawDate);
        if (!markerDate) return -1;

        let idx = dates.findIndex(d => normalizePerfDate(d) === markerDate);
        if (idx !== -1) return idx;

        const markerTime = parseYmdDate(markerDate)?.getTime();
        if (!markerTime) return -1;

        let bestIdx = -1;
        let bestDiff = Infinity;
        dates.forEach((d, i) => {
            const chartTime = parseYmdDate(normalizePerfDate(d))?.getTime();
            if (!chartTime) return;
            const diff = Math.abs(chartTime - markerTime);
            if (diff < bestDiff) {
                bestDiff = diff;
                bestIdx = i;
            }
        });

        return bestDiff <= 15 * CONSTANTS.DAY_MS ? bestIdx : -1;
    };

    const renderChart = (hoverIndex = null) => {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        ctx.fillStyle = '#111f35';
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const y = pad.top + (ch / 4) * i;
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(pad.left + cw, y);
            ctx.stroke();
        }

        const zeroY = toY(0);
        if (zeroY >= pad.top && zeroY <= pad.top + ch) {
            ctx.strokeStyle = 'rgba(100,140,180,0.5)';
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(pad.left, zeroY);
            ctx.lineTo(pad.left + cw, zeroY);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        const fundColor = isUp ? '#ff7875' : '#73d13d';
        const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch);
        gradient.addColorStop(0, isUp ? 'rgba(255,120,117,0.2)' : 'rgba(115,209,61,0.2)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(toX(0), zeroY);
        fundReturns.forEach((r, i) => ctx.lineTo(toX(i), toY(r)));
        ctx.lineTo(toX(fundReturns.length - 1), zeroY);
        ctx.closePath();
        ctx.fill();

        if (benchmarkReturns) {
            ctx.strokeStyle = '#8c8c8c';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            let started = false;
            benchmarkReturns.forEach((r, i) => {
                if (r === null) return;
                const x = toX(i);
                const y = toY(r);
                if (!started) {
                    ctx.moveTo(x, y);
                    started = true;
                } else {
                    ctx.lineTo(x, y);
                }
            });
            ctx.stroke();
        }

        if (similarReturns) {
            ctx.strokeStyle = '#3498db';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            let started = false;
            similarReturns.forEach((r, i) => {
                if (r === null) return;
                const x = toX(i);
                const y = toY(r);
                if (!started) {
                    ctx.moveTo(x, y);
                    started = true;
                } else {
                    ctx.lineTo(x, y);
                }
            });
            ctx.stroke();
        }

        ctx.strokeStyle = fundColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        fundReturns.forEach((r, i) => {
            if (i === 0) ctx.moveTo(toX(i), toY(r));
            else ctx.lineTo(toX(i), toY(r));
        });
        ctx.stroke();

        if (perfState && (perfState.tradeHistory || perfState.sourceFund?.addedDate)) {
            const tradeHistory = normalizeTradeRecordList(
                Array.isArray(perfState.tradeHistory) ? perfState.tradeHistory : [],
                { source: 'order' }
            );
            const addedDate = perfState.sourceFund?.addedDate || perfState.addedDate || '';
            const markers = [];
            const hasInitialTrade = tradeHistory.some(adj => getTradeDisplayType(adj) === 'initial');

            if (addedDate && !hasInitialTrade) {
                markers.push({ date: addedDate, type: 'initial', label: '建', color: '#ff4d4f' });
            }

            tradeHistory.forEach(adj => {
                const date = getTradeMarkerDate(adj);
                if (!date) return;
                const type = getTradeDisplayType(adj);
                if (type === 'initial' || type === 'add' || type === 'remove' || type === 'clear') {
                    markers.push({
                        date,
                        type,
                        label: getTradeDisplayLabel(adj, 'short'),
                        color: getTradeDisplayColor(adj)
                    });
                }
            });

            const seenMarkers = new Set();
            markers.forEach(m => {
                const idx = findMarkerIndex(m.date);
                if (idx < 0) return;
                const key = `${m.type}:${normalizePerfDate(m.date)}:${idx}`;
                if (seenMarkers.has(key)) return;
                seenMarkers.add(key);

                const x = toX(idx);
                const y = toY(fundReturns[idx]);
                const badgeW = 24;
                const badgeH = 16;
                const badgeX = x - badgeW / 2;
                const badgeY = Math.max(pad.top + 2, y - 20);

                ctx.strokeStyle = m.color;
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.moveTo(x, pad.top);
                ctx.lineTo(x, pad.top + ch);
                ctx.stroke();
                ctx.setLineDash([]);

                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.arc(x, y, 8, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = m.color;
                ctx.beginPath();
                ctx.arc(x, y, 6.5, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = m.color;
                ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1;
                ctx.strokeRect(badgeX, badgeY, badgeW, badgeH);
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 10px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(m.label, x, badgeY + badgeH / 2);
            });
        }

        if (hoverIndex !== null && hoverIndex >= 0 && hoverIndex < fundReturns.length) {
            const hoverX = toX(hoverIndex);
            const hoverY = toY(fundReturns[hoverIndex]);
            ctx.strokeStyle = 'rgba(105,177,255,0.65)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(hoverX, pad.top);
            ctx.lineTo(hoverX, pad.top + ch);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(pad.left, hoverY);
            ctx.lineTo(pad.left + cw, hoverY);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = '#0a1525';
            ctx.beginPath();
            ctx.arc(hoverX, hoverY, 4.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = fundColor;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(hoverX, hoverY, 4.5, 0, Math.PI * 2);
            ctx.stroke();

            if (similarReturns && similarReturns[hoverIndex] !== null) {
                const similarY = toY(similarReturns[hoverIndex]);
                ctx.fillStyle = '#0a1525';
                ctx.beginPath();
                ctx.arc(hoverX, similarY, 3.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#3498db';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(hoverX, similarY, 3.5, 0, Math.PI * 2);
                ctx.stroke();
            }

            if (benchmarkReturns && benchmarkReturns[hoverIndex] !== null) {
                const benchY = toY(benchmarkReturns[hoverIndex]);
                ctx.fillStyle = '#0a1525';
                ctx.beginPath();
                ctx.arc(hoverX, benchY, 3.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#8c8c8c';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(hoverX, benchY, 3.5, 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        ctx.fillStyle = '#4a6a90';
        ctx.font = '10px Inter';
        ctx.textAlign = 'right';
        for (let i = 0; i <= 4; i++) {
            const r = maxR - (range / 4) * i;
            ctx.fillText(formatProfit(r, '%'), pad.left - 4, pad.top + (ch / 4) * i + 4);
        }

        ctx.textAlign = 'center';
        ctx.fillStyle = '#4a6a90';
        const fmtD = s => s ? s.slice(5) : '';
        if (dates.length > 0) {
            const mid = Math.floor(dates.length / 2);
            ctx.fillText(fmtD(dates[0]), toX(0), height - 8);
            ctx.fillText(fmtD(dates[mid]), toX(mid), height - 8);
            ctx.fillText(fmtD(dates[dates.length - 1]), toX(dates.length - 1), height - 8);
        }
    };

    renderChart();

    const scheduleHoverRender = (hoverIndex) => {
        pendingHoverIndex = hoverIndex;
        if (hoverFrameId) return;
        hoverFrameId = requestAnimationFrame(() => {
            hoverFrameId = null;
            if (currentHoverIndex === pendingHoverIndex) return;
            currentHoverIndex = pendingHoverIndex;
            renderChart(currentHoverIndex);
        });
    };

    canvas.onmousemove = (e) => {
        const tooltip = document.getElementById('perfChartTooltip');
        if (!tooltip) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        if (x < pad.left || x > pad.left + cw) {
            hidePerformanceTooltip();
            scheduleHoverRender(null);
            return;
        }
        const relativeX = Math.max(0, Math.min(cw, x - pad.left));
        const idx = Math.max(0, Math.min(prices.length - 1, Math.round((relativeX / cw) * maxIndex)));
        scheduleHoverRender(idx);

        const fundR = fundReturns[idx];
        const date = dates[idx];
        const p = prices[idx];
        if (!date) return;

        const fundClr = fundR >= 0 ? '#ff7875' : '#73d13d';
        let html = `<div style="font-size:10px;color:#8aacce;margin-bottom:4px;">${date}</div>`;

        if (perfState) {
            const periods = buildHoldingPeriodsFromTrades(
                Array.isArray(perfState.tradeHistory) ? perfState.tradeHistory : [],
                perfState.sourceFund?.addedDate || perfState.addedDate || ''
            );
            const holdDay = holdDayForDate(periods, date);
            if (holdDay !== null) {
                html = `<div style="font-size:10px;color:#8aacce;margin-bottom:4px;">${date} (持有第 ${holdDay} 天)</div>`;
            }
        }

        html += `<div style="color:#c0d8f0;font-size:12px;font-weight:bold;margin-bottom:2px;">净值: ${parseFloat(p).toFixed(4)}</div>`;
        html += `<div style="font-size:11px;"><span style="color:#ff7875;">●</span> <span style="color:#8aacce;">本基金</span> <span style="color:${fundClr};">${formatProfit(fundR, '%')}</span></div>`;

        if (similarReturns && similarReturns[idx] !== null) {
            const similarR = similarReturns[idx];
            const similarClr = similarR >= 0 ? '#ff7875' : '#73d13d';
            html += `<div style="font-size:11px;"><span style="color:#3498db;">●</span> <span style="color:#8aacce;">同类平均</span> <span style="color:${similarClr};">${formatProfit(similarR, '%')}</span></div>`;
        }

        if (benchmarkReturns && benchmarkReturns[idx] !== null) {
            const benchR = benchmarkReturns[idx];
            const benchClr = benchR >= 0 ? '#ff7875' : '#73d13d';
            html += `<div style="font-size:11px;"><span style="color:#8c8c8c;">●</span> <span style="color:#8aacce;">业绩基准</span> <span style="color:${benchClr};">${formatProfit(benchR, '%')}</span></div>`;
        }

        if (perfState) {
            const tradeHistory = normalizeTradeRecordList(
                Array.isArray(perfState.tradeHistory) ? perfState.tradeHistory : [],
                { source: 'order' }
            );
            const addedDate = perfState.sourceFund?.addedDate || perfState.addedDate || '';
            const dayMarkers = [];
            const tooltipDate = normalizePerfDate(date);
            const hasInitialTrade = tradeHistory.some(adj => getTradeDisplayType(adj) === 'initial');
            if (!hasInitialTrade && normalizePerfDate(addedDate) === tooltipDate) {
                dayMarkers.push({ label: '建仓', color: '#1890ff' });
            }
            tradeHistory.forEach(adj => {
                const d = getTradeMarkerDate(adj);
                if (normalizePerfDate(d) !== tooltipDate) return;
                const type = getTradeDisplayType(adj);
                if (type === 'initial' || type === 'add' || type === 'remove' || type === 'clear') {
                    dayMarkers.push({
                        label: getTradeDisplayLabel(adj),
                        color: getTradeDisplayColor(adj)
                    });
                }
            });
            if (dayMarkers.length > 0) {
                const markerHtml = dayMarkers.map(m => `<span style="background:${m.color};color:#fff;padding:1px 4px;border-radius:3px;margin-right:4px;font-size:10px;">${m.label}</span>`).join('');
                html += `<div style="margin-top:6px;border-top:1px solid rgba(255,255,255,0.1);padding-top:4px;">${markerHtml}</div>`;
            }
        }

        tooltip.innerHTML = html;
        tooltip.style.display = 'block';
        const pr = canvas.parentElement.getBoundingClientRect();
        let left = (rect.left - pr.left) + x + 12;
        if (left + 160 > pr.width) left = (rect.left - pr.left) + x - 170;
        tooltip.style.left = left + 'px';
        tooltip.style.top = ((rect.top - pr.top) + Math.min(Math.max((e.clientY - rect.top) - 60, 0), ch)) + 'px';
    };

    canvas.onmouseleave = () => {
        hidePerformanceTooltip();
        scheduleHoverRender(null);
    };
}
