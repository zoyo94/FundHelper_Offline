// ==================== 初始化 ====================
async function initializePopup() {
    // 初始化历史数据库
    await HistoryDB.init();
    await migrateTradeDataOnce();

    // DOM 元素引用（在 DOM 准备就绪后往 elements 对象嵌入）
    Object.assign(elements, {
        addBtn: document.getElementById('addBtn'),
        groupList: document.getElementById('groupList'),
        groupFilter: document.getElementById('groupFilter'),
        tableBody: document.getElementById('fundTableBody'),
        status: document.getElementById('status'),
        statusText: document.getElementById('statusText'),
        selectionStatus: document.getElementById('selectionStatus'),
        fullscreenBtn: document.getElementById('fullscreenBtn'),
        refreshControl: document.getElementById('refreshControl'),
        refreshBtn: document.getElementById('refreshBtn'),
        refreshBtnText: document.getElementById('refreshBtnText'),
        refreshBtnIcon: document.getElementById('refreshBtnIcon'),
        marketTicker: document.getElementById('marketTicker'),
        marketTickerTrack: document.getElementById('marketTickerTrack'),
        indexSettingsBtn: document.getElementById('indexSettingsBtn'),
        apiSettingsBtn: document.getElementById('apiSettingsBtn'),
        notificationBtn: document.getElementById('notificationBtn'),
        columnConfigBtn: document.getElementById('columnConfigBtn'),
        columnConfigPanel: document.getElementById('columnConfigPanel'),
        allOrdersBtn: document.getElementById('allOrdersBtn'),
        fundSearchInput: document.getElementById('fundSearchInput'),
        totalAmount: document.getElementById('totalAmount'),
        totalTodayProfit: document.getElementById('totalTodayProfit'),
        totalTotalProfit: document.getElementById('totalTotalProfit'),
        totalYesterdayProfit: document.getElementById('totalYesterdayProfit'),
        totalPositionProfit: document.getElementById('totalPositionProfit'),
        exportBtn: document.getElementById('exportBtn'),
        importBtn: document.getElementById('importBtn'),
        importFile: document.getElementById('importFile'),
        modalOverlay: document.getElementById('modalOverlay'),
        modalTitle: document.getElementById('modalTitle'),
        modalMsg: document.getElementById('modalMsg'),
        modalInput: document.getElementById('modalInput'),
        modalFooter: document.getElementById('modalFooter'),
        toastContainer: document.getElementById('toastContainer'),
        batchGroupBtn: document.getElementById('batchGroupBtn'),
        batchClearBtn: document.getElementById('batchClearBtn'),
        profitCalendarBtn: document.getElementById('profitCalendarBtn'),
        filterBreadth: document.getElementById('filterBreadth'),
    });

    // 初始化通知中心
    await notificationCenter.init();
    await restoreLiveApiSettings();

    elements.addBtn.onclick = () => openFundEditor(null);
    if (elements.batchGroupBtn) elements.batchGroupBtn.onclick = () => batchChangeGroup();
    if (elements.batchClearBtn) elements.batchClearBtn.onclick = () => batchClearPositions();
    elements.exportBtn.onclick = exportFundsData;
    elements.importBtn.onclick = () => elements.importFile.click();
    if (elements.profitCalendarBtn) elements.profitCalendarBtn.onclick = () => openProfitCalendar();
    if (elements.allOrdersBtn) elements.allOrdersBtn.onclick = () => openAllOrdersModal();

    // 绑定通知中心按钮
    if (elements.notificationBtn) {
        elements.notificationBtn.onclick = () => notificationCenter.show();
    }
    if (elements.apiSettingsBtn) {
        elements.apiSettingsBtn.onclick = () => openLiveApiSettings();
        updateLiveApiSettingsButton();
    }
    if (elements.modalOverlay) {
        elements.modalOverlay.onclick = (e) => {
            if (e.target === elements.modalOverlay) {
                dismissModal();
            }
        };
    }

    // MV3 已移除 chrome.extension.getViews，改用 URL 参数判断是否全屏模式
    const isPopup = !new URLSearchParams(window.location.search).has('fullscreen');
    if (!isPopup) document.body.classList.add('is-fullscreen');

    checkBackup();
    refreshIntervalPicker.bind();
    await restoreAutoRefreshInterval();
    await initColumnVisibility();
    await initPinnedFunds();
    marketBreadthData = await restoreMarketBreadthSnapshot();
    indexQuotesData = await restoreIndexQuotesSnapshot();
    await initIndexSettings();
    renderMarketBreadthTicker();
    resetAutoRefreshCountdown();
    ensureRefreshCountdownTimer();
    triggerUnifiedRefresh('initial');

    elements.importFile.addEventListener('change', importFundsData);
    const importTradeCsvFile = document.getElementById('importTradeCsvFile');
    if (importTradeCsvFile) importTradeCsvFile.addEventListener('change', importTradeOrdersCSV);
    initFabMenu();

    elements.fullscreenBtn.onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') + '?fullscreen' });

    if (elements.indexSettingsBtn) {
        elements.indexSettingsBtn.onclick = () => openIndexSettings();
    }

    elements.refreshBtn.onclick = () => {
        triggerUnifiedRefresh('manual');
    };
    elements.refreshBtn.oncontextmenu = (e) => {
        e.preventDefault();
        toggleManualPause();
    };

    groupFilterController.bind();
    groupFilterController.onChange(() => {
        clearSelection();
        renderTable();
    });
    fundSearchController.bind();
    fundSearchController.onChange(() => {
        clearSelection();
        renderTable();
    });

    document.querySelectorAll('.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const field = th.dataset.sort;
            if (sortField === field) {
                sortDirection *= -1;
            } else {
                sortField = field;
                sortDirection = -1;
            }
            renderTable();
        });
    });

    // 基金详情弹窗关闭按钮
    const fundDetailClose = document.getElementById('fundDetailClose');
    const fundDetailFitBtn = document.getElementById('fundDetailFitBtn');
    const fundDetailOverlay = document.getElementById('fundDetailOverlay');
    if (fundDetailClose) {
        fundDetailClose.onclick = closeFundDetail;
    }
    if (fundDetailFitBtn) {
        fundDetailFitBtn.onclick = toggleFundDetailFitPage;
    }
    if (fundDetailOverlay) {
        fundDetailOverlay.onclick = (e) => {
            if (e.target === fundDetailOverlay) {
                closeFundDetail();
            }
        };
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initializePopup().catch(error => {
        console.error('[init] 初始化失败:', error);
        const statusText = document.getElementById('statusText');
        if (statusText) statusText.innerText = '初始化失败，请重载扩展';
        const body = document.getElementById('fundTableBody');
        if (body) {
            body.innerHTML = `<tr><td colspan="12" style="padding:16px;text-align:center;color:#ff7875;">初始化失败：${escapeHtml(error.message || String(error))}</td></tr>`;
        }
    });
});


function renderFilterBreadth(data = marketBreadthData) {
    if (!elements.filterBreadth) return;
    if (!data) {
        elements.filterBreadth.innerHTML = '<span class="filter-breadth-empty">--</span>';
        return;
    }
    elements.filterBreadth.innerHTML = `
        <span class="filter-breadth-item is-limit-up" title="涨停"><span class="filter-breadth-label">涨停</span><span class="filter-breadth-value">${data.limitUp}</span></span>
        <span class="filter-breadth-item is-up" title="上涨"><span class="filter-breadth-label">涨</span><span class="filter-breadth-value">${data.up}</span></span>
        <span class="filter-breadth-item is-flat" title="平盘"><span class="filter-breadth-label">平</span><span class="filter-breadth-value">${data.flat ?? 0}</span></span>
        <span class="filter-breadth-item is-down" title="下跌"><span class="filter-breadth-label">跌</span><span class="filter-breadth-value">${data.down}</span></span>
        <span class="filter-breadth-item is-limit-down" title="跌停"><span class="filter-breadth-label">跌停</span><span class="filter-breadth-value">${data.limitDown}</span></span>
    `;
}

function renderMarketBreadthTicker() {
    if (!elements.marketTicker || !elements.marketTickerTrack) return;

    // 补回涨跌停数量刷新
    renderFilterBreadth(marketBreadthData);

    // 指数设置弹窗打开时跳过 ticker 重渲染，避免动画闪烁
    if (elements.modalOverlay && elements.modalOverlay.dataset.mode === 'index-settings') return;

    if (indexQuotesData.length === 0) {
        elements.marketTicker.classList.add('is-unavailable');
        elements.marketTickerTrack.innerHTML = `<div class="market-ticker-copy"><span class="market-ticker-empty">指数加载中...</span></div>`;
        return;
    }

    // 格式化市值
    const formatMV = (val) => {
        if (!val || val <= 0) return '';
        if (val >= 1e12) return (val / 1e12).toFixed(2) + '万亿';
        if (val >= 1e8) return (val / 1e8).toFixed(2) + '亿';
        return val;
    };

    // 渲染单项 HTML
    const content = indexQuotesData.map(idx => {
        const sign = idx.changeRate >= 0 ? '+' : '';
        const cls = idx.changeRate >= 0 ? 'is-up' : 'is-down';
        const mvStr = idx.marketValue ? `<span class="market-ticker-mv">市值 ${formatMV(idx.marketValue)}</span>` : '';
        const changeStr = idx.changeAmount !== undefined ? `<span class="market-ticker-change">${sign}${idx.changeAmount.toFixed(2)}</span>` : '';

        return `<span class="market-ticker-item is-index ${cls}">
            <span class="market-ticker-label">${idx.name}</span>
            <span class="market-ticker-price">${idx.price.toFixed(2)}</span>
            ${changeStr}
            <span class="market-ticker-value">${sign}${idx.changeRate.toFixed(2)}%</span>
            ${mvStr}
        </span>`;
    }).join('');

    elements.marketTicker.classList.remove('is-unavailable');

    // 清理旧监听
    if (window._tickerResizeObserver) {
        window._tickerResizeObserver.disconnect();
        window._tickerResizeObserver = null;
    }

    // 三倍填充保证无缝循环，始终滚动（不判断容器宽度）
    elements.marketTickerTrack.innerHTML =
        `<div class="market-ticker-copy" id="market-ticker-content">${content}${content}${content}</div>`;

    const tickerContainer = elements.marketTickerTrack;
    const tickerContent = document.getElementById('market-ticker-content');
    if (!tickerContent) return;

    // 确保 keyframe 只注入一次
    const KF_ID = '_ticker-kf-style';
    if (!document.getElementById(KF_ID)) {
        const s = document.createElement('style');
        s.id = KF_ID;
        s.textContent = `@keyframes _ticker-run{from{transform:translateX(0)}to{transform:translateX(var(--_tw))}}`;
        document.head.appendChild(s);
    }

    const applyAnimation = () => {
        // 单份宽度 = 总宽度 / 3（三倍填充）
        const singleWidth = tickerContent.scrollWidth / 3;
        if (singleWidth <= 0) return;
        const duration = Math.max(6, singleWidth / 80); // 80px/s，最少6s
        tickerContent.style.setProperty('--_tw', `-${singleWidth}px`);
        tickerContent.style.animation = `_ticker-run ${duration}s linear infinite`;
    };

    // 等一帧确保 DOM 渲染完毕再取宽度
    requestAnimationFrame(applyAnimation);

    window._tickerResizeObserver = new ResizeObserver(applyAnimation);
    window._tickerResizeObserver.observe(tickerContainer);
}

function getAutoRefreshIntervalSeconds() {
    return Math.max(1, Math.round(autoRefreshIntervalMs / 1000));
}

function getAutoRefreshPauseCutoff(now = new Date()) {
    return new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        CONFIG.AUTO_REFRESH_PAUSE_HOUR,
        CONFIG.AUTO_REFRESH_PAUSE_MINUTE,
        0,
        0
    );
}

function isAutoRefreshPaused(now = new Date()) {
    if (isManuallyPaused) return true;

    // 增加周末判断
    const day = now.getDay();
    if (day === 0 || day === 6) return true;

    const hours = now.getHours();
    const minutes = now.getMinutes();
    const currentTimeValue = hours * 60 + minutes;

    // 9:00 之前不刷新
    if (currentTimeValue < 9 * 60) return true;

    // 11:30 - 13:00 午盘休市不刷新
    if (currentTimeValue >= 11 * 60 + 30 && currentTimeValue < 13 * 60) return true;

    // 15:30 之后不刷新 (对应 CONFIG.AUTO_REFRESH_PAUSE_HOUR 和 CONFIG.AUTO_REFRESH_PAUSE_MINUTE)
    const pauseTimeValue = CONFIG.AUTO_REFRESH_PAUSE_HOUR * 60 + CONFIG.AUTO_REFRESH_PAUSE_MINUTE;
    if (currentTimeValue >= pauseTimeValue) return true;

    return false;
}

function syncRefreshIntervalSelect() {
    if (typeof refreshIntervalPicker !== 'undefined' && refreshIntervalPicker.sync) {
        // 内部会判断 popoverEl 是否存在
        refreshIntervalPicker.sync();
    }
    if (elements.refreshControl) {
        elements.refreshControl.classList.toggle('is-disabled', Boolean(unifiedRefreshPromise));
    }
}


function getNextAutoRefreshAt(now = Date.now()) {
    return isAutoRefreshPaused(new Date(now)) ? 0 : now + autoRefreshIntervalMs;
}

function updateRefreshButtonState(now = Date.now()) {
    if (!elements.refreshBtn) return;

    const currentTime = new Date(now);
    const pauseTimeLabel = formatTime(getAutoRefreshPauseCutoff(currentTime));
    syncRefreshIntervalSelect();
    const intervalSeconds = getAutoRefreshIntervalSeconds();
    const isRefreshing = Boolean(unifiedRefreshPromise);
    const isPaused = !isRefreshing && isAutoRefreshPaused(currentTime);
    const remainingMs = isRefreshing
        ? autoRefreshIntervalMs
        : (nextAutoRefreshAt ? Math.max(0, nextAutoRefreshAt - now) : autoRefreshIntervalMs);
    const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    const progress = isPaused
        ? 0
        : (autoRefreshIntervalMs > 0 ? Math.max(0, Math.min(1, remainingMs / autoRefreshIntervalMs)) : 0);

    if (elements.refreshControl) {
        elements.refreshControl.classList.toggle('is-refreshing', isRefreshing);
        elements.refreshControl.classList.toggle('is-low', !isRefreshing && !isPaused && progress <= 0.2);
        elements.refreshControl.classList.toggle('is-medium', !isRefreshing && !isPaused && progress > 0.2 && progress <= 0.5);
        elements.refreshControl.classList.toggle('is-empty', !isRefreshing && (isPaused || progress <= 0.02));
        elements.refreshControl.style.setProperty('--refresh-progress', String(isRefreshing ? 1 : progress));
    }

    if (isRefreshing) {
        elements.refreshBtn.classList.add('spinning');
        elements.refreshBtn.title = `正在刷新行情（当前自动刷新 ${intervalSeconds} 秒）`;
        elements.refreshBtn.setAttribute('aria-label', `正在刷新行情，当前自动刷新 ${intervalSeconds} 秒`);
        if (elements.refreshBtnText) elements.refreshBtnText.textContent = '刷新中';
        return;
    }

    elements.refreshBtn.classList.remove('spinning');

    if (isPaused) {
        let pauseReason = '';
        if (isManuallyPaused) {
            pauseReason = '手动暂停';
        } else {
            const day = currentTime.getDay();
            if (day === 0 || day === 6) {
                pauseReason = '周末休市暂停';
            } else if (currentTime.getHours() < 9) {
                pauseReason = '开盘前暂停，09:00 后恢复';
            } else {
                const currentTimeValue = currentTime.getHours() * 60 + currentTime.getMinutes();
                if (currentTimeValue >= 11 * 60 + 30 && currentTimeValue < 13 * 60) {
                    pauseReason = '午盘休市暂停，13:00 后恢复';
                } else {
                    pauseReason = `盘后暂停，至明日 09:00 恢复（今日 ${pauseTimeLabel} 已过）`;
                }
            }
        }
        const actionHint = isManuallyPaused ? '右键恢复' : '';
        elements.refreshBtn.title = `自动刷新已${pauseReason}${actionHint ? '，' + actionHint : ''}`;
        elements.refreshBtn.setAttribute('aria-label', `自动刷新已${pauseReason}，仍可手动刷新`);
        if (elements.refreshBtnText) elements.refreshBtnText.textContent = '已暂停';
        return;
    }

    elements.refreshBtn.title = `刷新行情（${remainingSeconds} 秒后自动刷新，当前 ${intervalSeconds} 秒，${pauseTimeLabel} 后自动暂停）右键可暂停`;
    elements.refreshBtn.setAttribute('aria-label', `刷新行情，${remainingSeconds} 秒后自动刷新，当前自动刷新 ${intervalSeconds} 秒，${pauseTimeLabel} 后自动暂停，右键可暂停`);
    if (elements.refreshBtnText) elements.refreshBtnText.textContent = `${remainingSeconds}s`;
}

function resetAutoRefreshCountdown(now = Date.now()) {
    nextAutoRefreshAt = getNextAutoRefreshAt(now);
    updateRefreshButtonState(now);
}

async function setAutoRefreshInterval(seconds, { silent = false, resetCountdown = true } = {}) {
    const normalizedSeconds = Number(seconds);
    if (!CONFIG.AUTO_REFRESH_OPTIONS.includes(normalizedSeconds)) {
        return false;
    }

    autoRefreshIntervalMs = normalizedSeconds * 1000;
    if (resetCountdown) {
        resetAutoRefreshCountdown();
    } else {
        nextAutoRefreshAt = getNextAutoRefreshAt();
        updateRefreshButtonState();
    }

    try {
        await storageHelper.setAll({ [CONFIG.AUTO_REFRESH_STORAGE_KEY]: normalizedSeconds });
    } catch (error) {
        console.warn('[refresh] 保存自动刷新间隔失败:', error);
    }

    if (!silent) {
        showToast(`自动刷新已切换为 ${normalizedSeconds} 秒`, 'success', CONFIG.TOAST_SHORT);
    }

    return true;
}

async function restoreAutoRefreshInterval() {
    try {
        const result = await storageHelper.getAll([CONFIG.AUTO_REFRESH_STORAGE_KEY]);
        const savedSeconds = Number(result?.[CONFIG.AUTO_REFRESH_STORAGE_KEY]);
        if (CONFIG.AUTO_REFRESH_OPTIONS.includes(savedSeconds)) {
            autoRefreshIntervalMs = savedSeconds * 1000;
        }
    } catch (error) {
        console.warn('[refresh] 读取自动刷新间隔失败:', error);
    }

    try {
        const result = await storageHelper.getAll([
            CONFIG.LIVE_API_REQUEST_DATE_STORAGE_KEY,
            CONFIG.LIVE_API_FINAL_REQUEST_DATE_STORAGE_KEY
        ]);
        const savedDate = result?.[CONFIG.LIVE_API_REQUEST_DATE_STORAGE_KEY];
        lastLiveApiRequestDate = typeof savedDate === 'string' ? savedDate : '';
        const savedFinalDate = result?.[CONFIG.LIVE_API_FINAL_REQUEST_DATE_STORAGE_KEY];
        lastLiveApiFinalRequestDate = typeof savedFinalDate === 'string' ? savedFinalDate : '';
    } catch (error) {
        console.warn('[refresh] 读取当日行情请求标记失败:', error);
        lastLiveApiRequestDate = '';
        lastLiveApiFinalRequestDate = '';
    }

    try {
        const result = await storageHelper.getAll([CONFIG.MANUAL_PAUSE_STORAGE_KEY]);
        isManuallyPaused = Boolean(result?.[CONFIG.MANUAL_PAUSE_STORAGE_KEY]);
    } catch (error) {
        console.warn('[refresh] 读取手动暂停状态失败:', error);
        isManuallyPaused = false;
    }

    syncRefreshIntervalSelect();
}

async function toggleManualPause() {
    isManuallyPaused = !isManuallyPaused;

    try {
        await storageHelper.setAll({ [CONFIG.MANUAL_PAUSE_STORAGE_KEY]: isManuallyPaused });
    } catch (error) {
        console.warn('[refresh] 保存手动暂停状态失败:', error);
    }

    if (isManuallyPaused) {
        nextAutoRefreshAt = 0;
        showToast('自动刷新已暂停', 'info', CONFIG.TOAST_SHORT);
    } else {
        resetAutoRefreshCountdown();
        ensureRefreshCountdownTimer();
        showToast('自动刷新已恢复', 'success', CONFIG.TOAST_SHORT);
    }

    updateRefreshButtonState();
}

function ensureRefreshCountdownTimer() {
    if (refreshCountdownTimer) return;

    refreshCountdownTimer = setInterval(() => {
        const now = Date.now();
        const nowDate = new Date(now);
        const paused = isAutoRefreshPaused(nowDate);

        // 持续更新按钮状态（显示倒计时或“已暂停”）
        updateRefreshButtonState(now);

        // 如果正在刷新中，不执行逻辑
        if (unifiedRefreshPromise) return;

        if (paused) {
            // 处于暂停期间，重置下一次刷新时间为 0
            if (nextAutoRefreshAt !== 0) {
                nextAutoRefreshAt = 0;
            }
            return;
        }

        // 处于活跃期间
        if (!nextAutoRefreshAt) {
            // 刚进入活跃期间（如 9:00 到了），立即触发一次刷新
            triggerUnifiedRefresh('auto');
        } else if (now >= nextAutoRefreshAt) {
            // 到达下一次刷新时间
            triggerUnifiedRefresh('auto');
        }
    }, 1000);
}

function openIndexSettings() {
    // 指数分组配置
    const INDEX_GROUPS = [
        { label: 'A 股', codes: ['000001', '000016', '399001', '399330', '899050', '000300', '399006', '399102', '399673', '000688', '399005', '000905', '000906', '000852', '000903', '000982', '399303'] },
        { label: '港股', codes: ['HSI', 'HSTECH'] },
        { label: '美股', codes: ['IXIC', 'NDX', 'SPX', 'DJI'] },
        { label: '日韩', codes: ['N225', 'TPX', 'KS11', 'KQ11'] },
    ];

    const renderSettingsContent = () => {
        const currentCodes = new Set(indexSettings);

        // 左栏：已添加列表
        const selectedHtml = indexSettings.length === 0
            ? `<div class="index-settings-empty">暂未添加，点击右侧指数即可添加</div>`
            : indexSettings.map(code => {
                const info = SUPPORTED_INDICES.find(s => s.code === code);
                if (!info) return '';
                const quote = indexQuotesData.find(q => q.code === code);
                const hasQuote = !!quote && typeof quote.price === 'number';
                const dirCls = hasQuote ? (quote.changeRate >= 0 ? 'index-card-up' : 'index-card-down') : 'index-card-none';
                const sign = hasQuote && quote.changeRate >= 0 ? '+' : '';
                const priceStr = hasQuote ? quote.price.toFixed(2) : '--.--';
                const rateStr = hasQuote ? `${sign}${quote.changeRate.toFixed(2)}%` : '';
                return `
                    <div class="index-card ${dirCls}" draggable="true" data-code="${code}">
                        <span class="index-card-drag-handle">⠿</span>
                        <span class="index-card-title">${info.name}</span>
                        <span class="index-card-price">${priceStr}</span>
                        <span class="index-card-rate">${rateStr}</span>
                        <span class="index-card-remove" data-action="remove" data-code="${code}">✕</span>
                    </div>`;
            }).join('');

        // 右栏：按分组显示可选指数
        const groupsHtml = INDEX_GROUPS.map(group => {
            const tagsHtml = group.codes.map(code => {
                const info = SUPPORTED_INDICES.find(s => s.code === code);
                if (!info) return '';
                const isActive = currentCodes.has(code);
                return `<span class="index-tag-item${isActive ? ' active' : ''}" data-action="toggle" data-code="${code}">${info.name}</span>`;
            }).join('');
            return `<div class="index-group">
                <div class="index-group-label">${group.label}</div>
                <div class="index-group-tags">${tagsHtml}</div>
            </div>`;
        }).join('');

        return `
            <div class="index-settings-container">
                <div class="index-settings-left">
                    <div class="index-settings-col-title">已添加 · 可拖动排序</div>
                    <div class="index-settings-selected-grid" id="indexSelectedGrid">
                        ${selectedHtml}
                    </div>
                </div>
                <div class="index-settings-right">
                    <div class="index-settings-col-title">点击添加 / 再次点击移除</div>
                    <div class="index-settings-all-list" id="indexAllTags">
                        ${groupsHtml}
                    </div>
                </div>
            </div>`;
    };

    showHtmlModal('指数设置', renderSettingsContent(), [
        {
            text: '保存', cls: 'modal-btn-primary', onClick: async () => {
                await storageHelper.setAll({ [CONFIG.INDEX_SETTINGS_STORAGE_KEY]: indexSettings });
                _closeModal();
                await fetchIndexQuotes();
                renderMarketBreadthTicker();
                showToast('✅ 指数行情配置已保存', 'success');
            }
        },
        { text: '取消', cls: '', onClick: () => _closeModal() }
    ]);

    // 设置宽屏 mode
    if (elements.modalOverlay) elements.modalOverlay.dataset.mode = 'index-settings';

    const bindEvents = () => {
        const grid = document.getElementById('indexSelectedGrid');
        const tags = document.getElementById('indexAllTags');
        if (!grid || !tags) return;

        const refresh = () => {
            const container = document.querySelector('.index-settings-container');
            if (container) {
                container.parentElement.innerHTML = renderSettingsContent();
                bindEvents();
            }
        };

        // 点击 toggle
        const handleAction = (e) => {
            const el = e.target.closest('[data-action]');
            if (!el) return;
            const { action, code } = el.dataset;
            if (!code) return;
            if (action === 'remove' || (action === 'toggle' && indexSettings.includes(code))) {
                indexSettings = indexSettings.filter(c => c !== code);
            } else if (action === 'toggle') {
                indexSettings.push(code);
            }
            refresh();
        };

        grid.addEventListener('click', handleAction);
        tags.addEventListener('click', handleAction);

        // 拖拽排序
        let dragSrc = null;
        grid.addEventListener('dragstart', e => {
            const card = e.target.closest('.index-card');
            if (!card) return;
            dragSrc = card;
            e.dataTransfer.effectAllowed = 'move';
            setTimeout(() => card.classList.add('dragging'), 0);
        });
        grid.addEventListener('dragend', () => {
            if (dragSrc) dragSrc.classList.remove('dragging');
            document.querySelectorAll('.index-card.drag-over').forEach(el => el.classList.remove('drag-over'));
            dragSrc = null;
        });
        grid.addEventListener('dragover', e => {
            e.preventDefault();
            const over = e.target.closest('.index-card');
            if (!over || over === dragSrc) return;
            document.querySelectorAll('.index-card.drag-over').forEach(el => el.classList.remove('drag-over'));
            over.classList.add('drag-over');
            const rect = over.getBoundingClientRect();
            const insertBefore = (e.clientY - rect.top) < (rect.height / 2);
            grid.insertBefore(dragSrc, insertBefore ? over : over.nextSibling);
        });
        grid.addEventListener('drop', e => {
            e.preventDefault();
            indexSettings = Array.from(grid.querySelectorAll('.index-card[data-code]')).map(el => el.dataset.code);
        });
    };

    setTimeout(bindEvents, 50);
}

async function triggerUnifiedRefresh(source = 'manual') {
    if (unifiedRefreshPromise) {
        return unifiedRefreshPromise;
    }

    const skipLiveRequests = source !== 'manual' && shouldSkipLiveRequestsAfterCutoff();

    unifiedRefreshPromise = (async () => {
        updateRefreshButtonState();
        await Promise.allSettled([
            loadData({ skipLiveRequests }),
            refreshMarketBreadth()
        ]);
        resetAutoRefreshCountdown();
    })().finally(() => {
        unifiedRefreshPromise = null;
        updateRefreshButtonState();
    });

    updateRefreshButtonState();
    return unifiedRefreshPromise;
}

window.addEventListener('beforeunload', () => {
    if (refreshCountdownTimer) {
        clearInterval(refreshCountdownTimer);
        refreshCountdownTimer = null;
    }
});
