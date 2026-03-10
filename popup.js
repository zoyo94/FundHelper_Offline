// ==================== 全局状态 ====================
let currentFundsData = [];
let sortField = 'todayProfit'; // 默认排序字段
let sortDirection = -1;        // 1:升序, -1:降序
let selectedCodes = new Set();
let lastClickedIndex = -1; // 上次点击行索引，用于 Shift 范围选

function clearSelection() {
    selectedCodes.clear();
    lastClickedIndex = -1;
}

// --- 新增：API 日志控制器 ---
const apiLogger = {
    loggedApis: new Set(), // 用于记录已打印日志的接口

    // 重置状态（在 loadData 开始时调用）
    reset() {
        this.loggedApis.clear();
        console.log('%c[API Monitor] 日志状态已重置，开始监测接口...', 'color: #1890ff; font-weight: bold;');
    },

    /**
     * 打印日志（仅第一次调用时打印）
     * @param {string} apiName 接口名称
     * @param {string} url 请求地址
     * @param {string} status 状态描述
     */
    log(apiName, url, status) {
        if (this.loggedApis.has(apiName)) return; // 已经记录过，跳过

        console.log(`[API Monitor] ${apiName} | 状态: ${status} | 地址: ${url}`);
        this.loggedApis.add(apiName);
    }
};

// ==================== DOM 元素引用 ====================
let elements = {};  // populated in DOMContentLoaded

// ==================== Toast / Modal 工具函数 ====================

/**
 * 显示底部 Toast 提示
 */
function showToast(msg, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        toast.addEventListener('animationend', () => toast.remove());
    }, duration);
}

function showAlert(msg, title = '提示') {
    return new Promise(resolve => {
        _openModal(title, msg, false);
        _setFooter([
            { text: '确定', cls: 'modal-btn-ok', onClick: () => { _closeModal(); resolve(); } }
        ]);
    });
}

function showConfirm(msg, title = '确认', danger = false) {
    return new Promise(resolve => {
        _openModal(title, msg, false);
        _setFooter([
            { text: '取消', cls: 'modal-btn-cancel', onClick: () => { _closeModal(); resolve(false); } },
            { text: '确定', cls: danger ? 'modal-btn-danger' : 'modal-btn-ok', onClick: () => { _closeModal(); resolve(true); } }
        ]);
    });
}

function showPrompt(msg, defaultVal = '', title = '请输入') {
    return new Promise(resolve => {
        _openModal(title, msg, true, defaultVal);
        const onOk = () => {
            const val = elements.modalInput.value;
            _closeModal();
            resolve(val);
        };
        elements.modalInput.onkeydown = (e) => { if (e.key === 'Enter') onOk(); };
        _setFooter([
            { text: '取消', cls: 'modal-btn-cancel', onClick: () => { _closeModal(); resolve(null); } },
            { text: '确定', cls: 'modal-btn-ok', onClick: onOk }
        ]);
        elements.modalInput.focus();
    });
}

function _openModal(title, msg, showInput, defaultVal = '') {
    elements.modalTitle.textContent = title;
    elements.modalMsg.textContent = msg;
    if (showInput) {
        elements.modalInput.value = defaultVal;
        elements.modalInput.style.display = 'block';
    } else {
        elements.modalInput.style.display = 'none';
    }
    elements.modalFooter.innerHTML = '';
    elements.modalOverlay.classList.add('visible');
}

function _closeModal() {
    elements.modalOverlay.classList.remove('visible');
    elements.modalInput.onkeydown = null;
    elements.modalMsg.onclick = null; // 清空撤销等临时绑定，防止泄漏到下一个弹窗
}

function _setFooter(btns) {
    elements.modalFooter.innerHTML = '';
    btns.forEach(({ text, cls, onClick }) => {
        const btn = document.createElement('button');
        btn.textContent = text;
        btn.className = `modal-btn ${cls}`;
        btn.onclick = onClick;
        elements.modalFooter.appendChild(btn);
    });
}

// ==================== 撤销结算功能 ====================
function checkBackup() {
    chrome.storage.local.get(['backupFunds', 'lastSettlementDate'], (res) => {
        const fabRollback = document.getElementById('fabRollback');
        if (fabRollback) {
            if (res.backupFunds && res.lastSettlementDate === getToday()) {
                fabRollback.style.display = 'block';
            } else {
                fabRollback.style.display = 'none';
            }
        }
    });
}



// ==================== 1. 新增：统一的备份函数 ====================
/**
 * 执行结算前，先备份当前数据（模拟导出功能）
 * @returns {Promise<void>}
 */
function backupFundsData() {
    return new Promise(resolve => {
        chrome.storage.local.get(['myFunds', 'lastUpdateDate', 'lastDayProfits'], (res) => {
            const funds = res.myFunds || {};
            if (Object.keys(funds).length === 0) {
                resolve();
                return;
            }
            // 将当前数据存入 backupFunds 字段，结构完全模拟导出文件
            const backupData = {
                backupTime: new Date().toLocaleString(),
                lastUpdateDate: res.lastUpdateDate || '',
                lastDayProfits: res.lastDayProfits || {},
                myFunds: funds
            };
            chrome.storage.local.set({ backupFunds: backupData }, () => {
                console.log('[Backup] 数据已备份:', backupData);
                resolve();
            });
        });
    });
}
/**
 * 结算核心逻辑（手动/自动共用）
 * @param {Object} funds        - myFunds 对象（直接修改）
 * @param {Array}  settlements  - [{code, price, prevPriceDate}]
 * @param {string} todayStr     - YYYY-MM-DD
 * @param {boolean} skipUnchanged - 是否跳过未变化项（自动结算传 true）
 * @returns {number} updatedCount
 */
function _applySettlementLoop(funds, settlements, todayStr, skipUnchanged = false) {
    let updatedCount = 0;
    for (const { code, price, prevPriceDate } of settlements) {
        const item = funds[code];
        if (!item || price <= 0) continue;
        const basePrice = item.savedPrevPrice || (item.shares > 0 ? (item.amount / item.shares) : price);
        if (skipUnchanged && Math.abs(price - basePrice) < 0.00001) continue;
        const actualProfit = parseFloat((item.shares * (price - basePrice)).toFixed(2));
        funds[code].holdProfit = parseFloat(((item.holdProfit || 0) + actualProfit).toFixed(2));
        funds[code].yesterdayProfit = actualProfit;
        funds[code].amount = parseFloat((item.shares * price).toFixed(2));
        funds[code].savedPrevPrice = price;
        funds[code].savedPrevDate = prevPriceDate || todayStr;
        updatedCount++;
    }
    return updatedCount;
}

// ==================== 2. 修改：手动日结算（增加备份步骤）====================
async function manualSettlement() {
    const ok = await showConfirm('确认进行日结算吗？\n系统将对比最新公布的净值与上次结算的净值，计算并记录收益。', '日结算确认');
    if (!ok) return;
    elements.status.innerText = '正在备份数据...';
    // 【关键修改】结算前先备份！
    await backupFundsData();
    elements.status.innerText = '正在执行日结算...';
    chrome.storage.local.get(['myFunds'], (res) => {
        const funds = res.myFunds || {};
        const settlements = Object.keys(funds).map(code => {
            const live = currentFundsData.find(f => f.code === code);
            return (live && live.prevPrice) ? { code, price: live.prevPrice, prevPriceDate: live.prevPriceDate } : null;
        }).filter(Boolean);
        const updatedCount = _applySettlementLoop(funds, settlements, getToday(), false);
        chrome.storage.local.set({
            myFunds: funds,
            lastSettlementDate: getToday(),
            lastUpdateDate: new Date().toLocaleDateString()
        }, () => {
            showToast(`✅ 结算完成！已更新 ${updatedCount} 条`, 'success');
            checkBackup();
            loadData();
        });
    });
}
// ==================== 3. 修改：撤销结算（使用备份数据覆盖）====================
async function rollbackSettlement() {
    // 1. 检查是否有备份
    chrome.storage.local.get(['backupFunds'], async (res) => {
        if (!res.backupFunds || !res.backupFunds.myFunds) {
            await showAlert('未找到备份数据，无法撤销！');
            return;
        }
        const backup = res.backupFunds;
        const backupTime = backup.backupTime || '未知时间';
        // 2. 确认提示
        const ok = await showConfirm(
            `确定要撤销日结算吗？\n\n数据将恢复至备份时间：\n【${backupTime}】\n\n请注意：撤销后，当天的结算状态也将重置。`,
            '撤销确认',
            true
        );
        if (!ok) return;
        // 3. 执行恢复（直接覆盖）
        chrome.storage.local.set({
            myFunds: backup.myFunds,
            lastDayProfits: backup.lastDayProfits || {},
            lastUpdateDate: backup.lastUpdateDate || '',
            // 【关键点】保持今天日期，防止 loadData 触发自动结算循环
            lastSettlementDate: getToday(),
            // 清空备份，防止重复撤销
            backupFunds: null
        }, () => {
            showToast('✅ 已成功撤销，数据已恢复！', 'success');
            checkBackup(); // 隐藏撤销按钮
            loadData();    // 刷新界面
        });
    });
}
// ==================== 4. 自动结算部分（确保也有备份）====================
async function autoSettlement(funds, fetchedData, todayStr) {
    console.log('[autoSettlement] 检测到净值更新，开始自动结算...');
    elements.status.innerText = '正在自动结算...';
    // 1. 备份原始数据
    // 构造和手动备份一样的结构
    const backupData = {
        backupTime: new Date().toLocaleString(),
        myFunds: JSON.parse(JSON.stringify(funds)) // 深拷贝当前数据
    };
    await new Promise(r => chrome.storage.local.set({ backupFunds: backupData }, r));
    // 将 fetchedData 转换为 _applySettlementLoop 所需格式
    const settlements = fetchedData
        .filter(({ live }) => live && live.prevPrice > 0)
        .map(({ code, live }) => ({ code, price: live.prevPrice, prevPriceDate: live.prevPriceDate }));
    const updatedCount = _applySettlementLoop(funds, settlements, todayStr, true);
    if (updatedCount === 0) {
        console.log('[autoSettlement] 净值无变化，跳过');
        return;
    }
    // 写入结算结果，await 确保外层 loadData 读到最新数据
    await new Promise(r => chrome.storage.local.set({
        myFunds: funds,
        lastSettlementDate: todayStr,
        lastUpdateDate: new Date().toLocaleDateString()
    }, r));
    console.log('[autoSettlement] ✅ 完成，共更新 ' + updatedCount + ' 条');
    showToast('✅ 已自动完成日结算（' + updatedCount + ' 条）', 'success', 4000);
    checkBackup();
    // 不调用 loadData()，由外层 loadData 继续执行，避免重复读取引发竞态
}


function getToday() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', async () => {
    // DOM 元素引用（在 DOM 准备就绪后往 elements 对象嵌入）
    Object.assign(elements, {
        addBtn: document.getElementById('addBtn'),
        groupList: document.getElementById('groupList'),
        groupFilter: document.getElementById('groupFilter'),
        tableBody: document.getElementById('fundTableBody'),
        status: document.getElementById('status'),
        fullscreenBtn: document.getElementById('fullscreenBtn'),
        refreshBtn: document.getElementById('refreshBtn'),
        totalAmount: document.getElementById('totalAmount'),
        totalTodayProfit: document.getElementById('totalTodayProfit'),
        totalTotalProfit: document.getElementById('totalTotalProfit'),
        totalYesterdayProfit: document.getElementById('totalYesterdayProfit'),
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
    });

    elements.addBtn.onclick = () => openFundEditor(null);
    if (elements.batchGroupBtn) elements.batchGroupBtn.onclick = () => batchChangeGroup();
    if (elements.batchClearBtn) elements.batchClearBtn.onclick = () => batchClearPositions();
    elements.exportBtn.onclick = exportFundsData;
    elements.importBtn.onclick = () => elements.importFile.click();

    const isPopup = chrome.extension.getViews({ type: 'popup' }).includes(window);
    if (!isPopup) document.body.classList.add('is-fullscreen');

    checkBackup();
    loadData();

    elements.importFile.addEventListener('change', importFundsData);
    initFabMenu();

    elements.fullscreenBtn.onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });

    elements.refreshBtn.onclick = () => {
        elements.refreshBtn.classList.add('spinning');
        loadData().finally(() => {
            setTimeout(() => elements.refreshBtn.classList.remove('spinning'), 500);
        });
    };

    elements.groupFilter.onchange = () => {
        clearSelection();

        renderTable();
    };

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
});


// ==================== 新浪行情代理请求 ====================
function proxyFetchSina(url) {
    // --- 新增日志 ---
    apiLogger.log('新浪代理', url, '发起请求');
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'FETCH_SINA', url: url }, (response) => {
            if (response && response.success && response.data) {
                const content = response.data.match(/"(.*)"/);
                const result = content ? content[1] : null;
                // --- 新增日志：记录成功 ---
                if (result) {
                    apiLogger.log('新浪代理', url, '成功获取数据');
                } else {
                    apiLogger.log('新浪代理', url, '返回数据格式无效');
                }
                resolve(result);
            } else {
                // --- 新增日志：记录失败 ---
                apiLogger.log('新浪代理', url, '请求失败或无响应');
                resolve(null);
            }
        });
    });
}
// ==================== 综合行情接口 ====================
async function fetchLiveInfo(code) {
    const cleanCode = code.trim();
    if (/^\d{6}$/.test(cleanCode)) {
        // 1. 场外基金（主接口）
        // 【修复】将 url 定义提到 try 外面
        const url1 = `https://fundgz.1234567.com.cn/js/${cleanCode}.js?rt=${Date.now()}`;
        try {
            apiLogger.log('场外主接口', url1, '发起请求');
            const res = await fetch(url1);
            const text = await res.text();
            const jsonMatch = text.match(/jsonpgz\((.*)\)/);
            if (jsonMatch) {
                const d = JSON.parse(jsonMatch[1]);
                if (d && (d.gsz || d.dwjz)) {
                    const dwjz = parseFloat(d.dwjz) || 0;
                    const gsz = parseFloat(d.gsz || d.dwjz) || 0;
                    const gszzl = parseFloat(d.gszzl) || 0;
                    const gztime = d.gztime || '';
                    apiLogger.log('场外主接口', url1, '成功');
                    return {
                        name: d.name || `[未知]${cleanCode}`,
                        rate: gszzl,
                        price: gsz,
                        prevPrice: dwjz,
                        prevPriceDate: d.jzrq || '',
                        priceTime: gztime
                    };
                }
            }
            apiLogger.log('场外主接口', url1, '数据无效(尝试备用)');
        } catch (e) {
            apiLogger.log('场外主接口', url1, `请求异常(${e.message})`);
        }
        // 1.5 场外基金备用接口
        // 【修复】将 url 定义提到 try 外面
        const url2 = `https://fund.eastmoney.com/pingzhongdata/${cleanCode}.js?v=${Date.now()}`;
        try {
            apiLogger.log('场外备用接口', url2, '发起请求');
            const extData = await fetch(url2).then(r => r.text());
            if (extData && extData.includes('fS_name')) {
                const nameMatch = extData.match(/fS_name\s*=\s*"([^"]+)"/);
                const name = nameMatch ? nameMatch[1] : `[场外备用]${cleanCode}`;
                const netWorthMatch = extData.match(/Data_netWorthTrend\s*=\s*(\[.*?\])\s*;/);
                if (netWorthMatch) {
                    const netWorthData = JSON.parse(netWorthMatch[1]);
                    if (netWorthData && netWorthData.length >= 2) {
                        const latest = netWorthData[netWorthData.length - 1];
                        const gsz = parseFloat(latest.y) || parseFloat(latest.unitMoney) || 0;
                        const dwjz = gsz;
                        const dateStr = latest.x ? (() => { const d = new Date(latest.x); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })() : '';
                        apiLogger.log('场外备用接口', url2, '成功');
                        return {
                            name: name,
                            rate: null,
                            price: gsz,
                            prevPrice: dwjz,
                            prevPriceDate: dateStr,
                            isFallback: true
                        };
                    }
                }
            }
            apiLogger.log('场外备用接口', url2, '数据无效');
        } catch (e) {
            apiLogger.log('场外备用接口', url2, `请求异常(${e.message})`);
        }
        // 2. 场内基金（ETF/LOF）
        try {
            const p = cleanCode.startsWith('5') ? 'sh' : 'sz';
            const url = `https://hq.sinajs.cn/list=${p}${cleanCode}`;
            // proxyFetchSina 内部已经有日志了，这里不需要重复加
            const data = await proxyFetchSina(url);
            if (data && data.split(',').length > 10) {
                const parts = data.split(',');
                const cur = parseFloat(parts[3]) || 0;
                const pre = parseFloat(parts[2]) || 0;
                const rate = pre !== 0 ? parseFloat(((cur - pre) / pre * 100).toFixed(2)) : 0;
                return {
                    name: '[场]' + (parts[0] || cleanCode),
                    rate: rate,
                    price: cur,
                    prevPrice: pre
                };
            }
        } catch (e) {
            console.warn(`场内基金解析失败 ${cleanCode}:`, e);
        }
    }
    // 3. 期货
    try {
        const url = `https://hq.sinajs.cn/list=nf_${cleanCode.toUpperCase()}`;
        // proxyFetchSina 内部已经有日志了
        const fut = await proxyFetchSina(url);
        if (fut) {
            const parts = fut.split(',');
            if (parts.length > 10) {
                const cur = parseFloat(parts[8]) || 0;
                const pre = parseFloat(parts[5]) || 0;
                const rate = pre !== 0 ? parseFloat(((cur - pre) / pre * 100).toFixed(2)) : 0;
                return {
                    name: '[期]' + (parts[0] || cleanCode),
                    rate: rate,
                    price: cur,
                    prevPrice: pre
                };
            }
        }
    } catch (e) {
        console.warn(`期货解析失败 ${cleanCode}:`, e);
    }
    return {
        name: `[未知]${cleanCode}`,
        rate: 0,
        price: 0,
        prevPrice: 0
    };
}

// 请求超时包装：超过 ms 仍无响应则返回 fallback
function withTimeout(promise, ms, fallback) {
    const timer = new Promise(r => setTimeout(() => r(fallback), ms));
    return Promise.race([promise, timer]);
}

// ==================== 加载数据 ====================
async function loadData() {
    clearSelection();
    elements.status.innerText = '同步行情中...';
    apiLogger.reset();
    return new Promise(resolve => {
        chrome.storage.local.get(['myFunds', 'lastSettlementDate'], async (res) => {
            let funds = res.myFunds || {};
            const codes = Object.keys(funds);
            let dataChanged = false;
            const results = [];
            // 1. 获取行情数据
            const fetchedData = await Promise.all(
                codes.map(async (code, index) => {
                    await new Promise(r => setTimeout(r, index * 50));
                    const live = await withTimeout(fetchLiveInfo(code), 8000, { name: '[超时]' + code, rate: 0, price: 0, prevPrice: 0 });
                    return { code, live };
                })
            );
            const todayStr = getToday();
            // 2. 自动结算逻辑
            if (res.lastSettlementDate !== todayStr) {
                const needsSettlement = fetchedData.some(({ code, live }) => {
                    if (!live || live.prevPrice <= 0) return false;
                    const fund = funds[code];
                    if (!fund.savedPrevPrice) return false;
                    return Math.abs(live.prevPrice - fund.savedPrevPrice) > 0.00001;
                });
                if (needsSettlement) {
                    await autoSettlement(funds, fetchedData, todayStr);
                }
            }
            // 3. 处理数据 & 自动确认份额
            for (const { code, live } of fetchedData) {
                if (live && live.prevPrice > 0) {
                    const item = funds[code];
                    // --- A. 处理待确认份额 ---
                    if (item.pendingAdjustments && item.pendingAdjustments.length > 0) {
                        for (const adj of item.pendingAdjustments) {
                            if (adj.status === 'confirmed') continue; // 已确认跳过
                            if (todayStr >= adj.targetDate) {
                                if (adj.type === 'add') {
                                    const actualRate = (adj.feeRate || 0) / 100;
                                    const price = live.prevPrice;
                                    if (price > 0) {
                                        const deltaShares = (adj.amount * (1 - actualRate)) / price;
                                        item.shares = parseFloat((item.shares + deltaShares).toFixed(6));
                                        item.amount = parseFloat((item.shares * price).toFixed(2));
                                        // 标记已确认，保留记录
                                        adj.status = 'confirmed';
                                        adj.confirmedPrice = price;
                                        adj.confirmedShares = parseFloat(deltaShares.toFixed(6));
                                        adj.confirmedDate = todayStr;
                                        showToast(`✅ ${code} 加仓已确认 (净值${price}, +${adj.confirmedShares}份)`, 'success');
                                        dataChanged = true;
                                    }
                                } else if (adj.type === 'remove') {
                                    const price = live.prevPrice;
                                    if (price > 0) {
                                        item.shares = parseFloat((item.shares - adj.shares).toFixed(6));
                                        if (item.shares < 0) item.shares = 0;
                                        item.amount = parseFloat((item.shares * price).toFixed(2));
                                        adj.status = 'confirmed';
                                        adj.confirmedPrice = price;
                                        adj.confirmedShares = adj.shares;
                                        adj.confirmedDate = todayStr;
                                        showToast(`✅ ${code} 减仓已确认 (净值${price}, -${adj.shares}份)`, 'success');
                                        dataChanged = true;
                                    }
                                }
                            }
                        }
                    }
                    // --- B. 原有份额修正逻辑 (必须放在 if(pending) 外面) ---
                    if (!item.shares && item.amount > 0) {
                        if (live.prevPrice > 0) {
                            item.shares = parseFloat((item.amount / live.prevPrice).toFixed(6));
                            dataChanged = true;
                        } else if (live.price > 0) {
                            item.shares = parseFloat((item.amount / live.price).toFixed(6));
                            dataChanged = true;
                        }
                    }
                    if (item.shares > 0 && Math.abs(item.amount - item.shares) < 0.0001 && live.prevPrice > 0 && !live.name.includes('[未知]')) {
                        const correctedAmount = parseFloat((item.shares * live.prevPrice).toFixed(2));
                        item.amount = correctedAmount;
                        dataChanged = true;
                    }
                    // --- C. 收益计算 ---
                    let todayProfit, useFallbackNav = false;
                    if (!live.isFallback && live.price > 0) {
                        todayProfit = item.shares ? parseFloat((item.shares * (live.price - live.prevPrice)).toFixed(2)) : 0;
                    } else if (live.prevPrice > 0 && item.savedPrevPrice > 0) {
                        todayProfit = item.shares ? parseFloat((item.shares * (live.prevPrice - item.savedPrevPrice)).toFixed(2)) : 0;
                        useFallbackNav = true;
                    } else {
                        todayProfit = null;
                    }
                    const totalProfit = parseFloat(((item.holdProfit || 0) + (todayProfit || 0)).toFixed(2));
                    // --- D. 构造结果集 ---
                    results.push({
                        code,
                        name: live.name,
                        amount: item.amount || 0,
                        yesterdayProfit: item.yesterdayProfit || 0,
                        group: item.group || '默认',
                        rate: live.rate,
                        prevPrice: live.prevPrice || 0,
                        price: live.price || 0,
                        prevPriceDate: live.prevPriceDate || '',
                        priceTime: live.priceTime || '',
                        todayProfit,
                        totalProfit,
                        holdProfit: item.holdProfit || 0,
                        shares: item.shares || 0,
                        useFallbackNav,
                        pendingAdjustments: item.pendingAdjustments
                    });
                }
            }
            currentFundsData = results.filter(Boolean);
            const todayProfits = {};
            results.forEach(r => { if (r) todayProfits[r.code] = r.todayProfit; });
            chrome.storage.local.set({ lastDayProfits: todayProfits });
            if (dataChanged) {
                chrome.storage.local.set({ myFunds: funds });
            }
            updateGroupFilter();
            renderTable();
            elements.status.innerText = `最后更新: ${new Date().toLocaleTimeString()}`;
            resolve();
        });
    });
}

// ==================== 批量操作核心逻辑 ====================

// 1. 批量重算份额 (根据金额和净值)
async function batchRecalculateShares() {
    if (selectedCodes.size === 0) return showToast('❌ 请先勾选基金', 'error');
    const ok = await showConfirm(`确认根据当前金额重算选中的 ${selectedCodes.size} 支基金的份额吗？`);
    if (!ok) return;

    chrome.storage.local.get(['myFunds'], async (res) => {
        const funds = res.myFunds || {};
        let count = 0;
        for (const code of selectedCodes) {
            if (funds[code]) {
                const live = await fetchLiveInfo(code);
                if (live && live.prevPrice > 0) {
                    funds[code].shares = parseFloat((funds[code].amount / live.prevPrice).toFixed(6));
                    count++;
                }
            }
        }
        chrome.storage.local.set({ myFunds: funds }, () => {
            showToast(`✅ 已重算 ${count} 支基金份额`, 'success');
            loadData();
        });
    });
}

// 2. 批量修改分组
async function batchChangeGroup() {
    if (selectedCodes.size === 0) return showToast('❌ 请先勾选基金', 'error');
    const newGroup = await showPrompt('请输入新的分组名称：', '批量修改分组', '默认');
    if (newGroup === null) return;

    chrome.storage.local.get(['myFunds'], (res) => {
        const funds = res.myFunds || {};
        selectedCodes.forEach(code => {
            if (funds[code]) funds[code].group = newGroup || '默认';
        });
        chrome.storage.local.set({ myFunds: funds }, () => {
            showToast(`📁 已将选中基金移至分组：${newGroup || '默认'}`, 'success');
            loadData();
        });
    });
}

// 3. 清空持仓（单个或批量统一入口，codes 传字符串或数组）
async function clearPositions(codes) {
    const codeList = Array.isArray(codes) ? codes : [codes];
    if (codeList.length === 0) return showToast('❌ 请先勾选基金', 'error');

    const isBatch = codeList.length > 1;
    const title = isBatch ? '批量清空确认' : '清空持仓确认';
    const desc = isBatch
        ? `确认要清空选中 ${codeList.length} 支基金的持仓和份额吗？`
        : `确定要清空基金 [${codeList[0]}] 的持仓吗？`;

    _openModal(title, '', false);
    elements.modalMsg.innerHTML = `
        <p style="margin-bottom:10px;">${desc}</p>
        ${!isBatch ? '<p style="font-size:12px;color:#8aacce;margin-bottom:15px;">此操作将清空持仓金额和份额，但会保留“累计收益”。</p>' : ''}
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;">
            <input type="checkbox" id="clearGroupChk" checked>
            同时将分组变更为“已撤回”
        </label>
    `;

    const ok = await new Promise(resolve => {
        _setFooter([
            { text: '取消', cls: 'modal-btn-cancel', onClick: () => { _closeModal(); resolve(false); } },
            {
                text: '确定', cls: 'modal-btn-danger', onClick: () => {
                    const isChecked = document.getElementById('clearGroupChk').checked;
                    _closeModal();
                    resolve(isChecked ? 'yes' : 'no');
                }
            }
        ]);
    });

    if (!ok) return;

    chrome.storage.local.get(['myFunds'], (res) => {
        const funds = res.myFunds || {};
        codeList.forEach(code => {
            if (funds[code]) resetFundPosition(funds[code], ok === 'yes');
        });
        chrome.storage.local.set({ myFunds: funds }, () => {
            showToast(isBatch ? '🧹 选中持仓已清空' : `✅ 基金 ${codeList[0]} 持仓已清空`, 'success');
            loadData();
        });
    });
}

// 批量清空入口（fabMenu 绑定保持不变）
async function batchClearPositions() {
    if (selectedCodes.size === 0) return showToast('❌ 请先勾选基金', 'error');
    await clearPositions([...selectedCodes]);
}
// 4. 批量删除
async function batchDeleteFunds() {
    if (selectedCodes.size === 0) return;
    const ok = await showConfirm(`确定要删除选中的 ${selectedCodes.size} 支基金吗？该操作不可恢复！`, '危险操作');
    if (!ok) return;

    chrome.storage.local.get(['myFunds'], (res) => {
        const funds = res.myFunds || {};
        selectedCodes.forEach(code => delete funds[code]);
        chrome.storage.local.set({ myFunds: funds }, () => {
            showToast('🗑 选中基金已删除', 'success');
            loadData();
        });
    });
}

// ==================== 悬浮球交互绑定 ====================
function initFabMenu() {
    const fabMain = document.getElementById('fabMain');
    const fabMenu = document.getElementById('fabMenu');
    if (!fabMain) return;

    // 切换菜单显示
    fabMain.onclick = (e) => {
        e.stopPropagation();
        fabMain.classList.toggle('active');
        fabMenu.classList.toggle('show');
    };

    // 点击外部自动收起
    document.addEventListener('click', () => {
        fabMain.classList.remove('active');
        fabMenu.classList.remove('show');
    });

    // 统一绑定按钮事件
    const bind = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.onclick = () => {
            fn();
            fabMain.classList.remove('active');
            fabMenu.classList.remove('show');
        };
    };

    bind('fabSelectAll', () => {
        const filter = elements.groupFilter.value;
        const visible = currentFundsData.filter(i => filter === 'all' || i.group === filter);
        const allSelected = visible.every(i => selectedCodes.has(i.code));
        visible.forEach(i => allSelected ? selectedCodes.delete(i.code) : selectedCodes.add(i.code));
        renderTable();
    });
    bind('fabAdd', () => openFundEditor());
    bind('fabOCRBatch', openOCRBatchAdd);
    bind('fabBatchCalc', batchRecalculateShares);
    bind('fabBatchGroup', batchChangeGroup);
    bind('fabBatchClear', batchClearPositions);
    bind('fabBatchDel', batchDeleteFunds);
    bind('fabSettlement', () => manualSettlement());
    bind('fabRollback', () => rollbackSettlement());
    bind('fabExport', exportFundsData);
    bind('fabImport', () => document.getElementById('importFile').click());
}

// 确保在页面加载时启动
// ==================== 交易确认日期计算 ====================
/**
 * 获取下一个交易日（跳过周六日）
 * 注意：未内置节假日，如遇法定假日用户可手动调整确认日期
 */
function nextTradingDay(date) {
    const d = new Date(date);
    do {
        d.setDate(d.getDate() + 1);
    } while (d.getDay() === 0 || d.getDay() === 6); // 跳过周日(0)和周六(6)
    return d;
}

function formatDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 计算基金申购/赎回的确认日期
 * 规则：
 *   15:00前提交 → T日净值成交 → T+1个交易日确认
 *   15:00后提交 → T+1日净值成交 → T+2个交易日确认
 *   周末提交 → 视为下一个交易日15:00前提交（T+1确认）
 */
function getConfirmDate() {
    const now = new Date();
    const day = now.getDay(); // 0=周日, 6=周六
    const hour = now.getHours();
    const minute = now.getMinutes();
    const isWeekend = (day === 0 || day === 6);
    const isAfterCutoff = !isWeekend && (hour > 15 || (hour === 15 && minute > 0));

    let base = new Date(now);

    if (isWeekend) {
        // 周末：找到下一个交易日作为提交日，再+1
        while (base.getDay() === 0 || base.getDay() === 6) {
            base.setDate(base.getDate() + 1);
        }
        // 此时 base 是下一个交易日（相当于T），确认日是再下一个交易日
        return formatDate(nextTradingDay(base));
    } else if (isAfterCutoff) {
        // 15:00后：T+2个交易日
        const t1 = nextTradingDay(base);
        return formatDate(nextTradingDay(t1));
    } else {
        // 15:00前：T+1个交易日
        return formatDate(nextTradingDay(base));
    }
}

// ==================== 更新分组筛选下拉 ====================
function updateGroupFilter() {
    const groups = ['all', ...new Set(currentFundsData.map(item => item.group))];

    // 加个保护，防止找不到 groupFilter 报错
    if (elements.groupFilter) {
        const currentVal = elements.groupFilter.value;
        elements.groupFilter.innerHTML = groups.map(g =>
            `<option value="${g}" ${g === currentVal ? 'selected' : ''}>${g === 'all' ? '全部显示' : g}</option>`
        ).join('');
    }

    // 【修复点】：增加 if 判断。因为旧的输入框已经删除，groupList 不存在了，直接赋值会报错 null
    if (elements.groupList) {
        elements.groupList.innerHTML = groups.filter(g => g !== 'all').map(g => `<option value="${g}">`).join('');
    }
}

// ==================== 1. 新增：通用表单弹窗函数 ====================
/**
 * 显示一个包含表单的模态框（替代多个连续 prompt）
 * @param {Object} config 配置对象
 * @returns {Promise<Object|null>} 返回表单数据或 null
 */
function showFormModal(config) {
    return new Promise(resolve => {
        const { title, subTitle, fields, actionText = '保存' } = config;
        // 1. 设置标题和副标题
        elements.modalTitle.textContent = title;
        // 构建内容区域
        let html = `<div class="form-header-sub">${subTitle || ''}</div>`;
        html += '<div class="form-container">';
        fields.forEach(field => {
            // hidden 字段只渲染隐藏 input，不包裹 form-group
            if (field.type === 'hidden') {
                html += `<input type="hidden" id="modal_field_${field.id}" value="${field.value ?? ''}">`;
                return;
            }
            html += `<div class="form-group">`;
            html += `<label for="modal_field_${field.id}">${field.label}</label>`;
            const value = (field.value !== undefined && field.value !== null) ? field.value : '';
            if (field.type === 'number' && field.showAll) {
                html += `<div style="display: flex; align-items: center; gap: 6px;">`;
                html += `<input type="number" id="modal_field_${field.id}" 
        placeholder="${field.placeholder || ''}" 
        value="${field.value !== undefined && field.value !== null ? field.value : ''}"
        ${field.min !== undefined ? `min="${field.min}"` : ''} 
        ${field.step !== undefined ? `step="${field.step}"` : ''}
        style="flex: 1;">`;
                html += `<button type="button" class="all-btn" data-target="${field.id}" data-max="${field.max}">全部</button>`;
                html += `</div>`;
            } else {
                // 原有的输入框生成代码（保持不变）
                html += `<input type="${field.type || 'text'}" id="modal_field_${field.id}" 
    placeholder="${field.placeholder || ''}" 
    value="${field.value !== undefined && field.value !== null ? field.value : ''}"
    ${field.list ? `list="${field.list}"` : ''} 
    ${field.min !== undefined ? `min="${field.min}"` : ''} 
    ${field.step !== undefined ? `step="${field.step}"` : ''}>`;
            }
            html += `</div>`;
        });
        html += '</div>';
        elements.modalMsg.innerHTML = html; // 使用 innerHTML 注入表单
        elements.modalInput.style.display = 'none'; // 隐藏默认的单输入框
        // 2. 设置底部按钮
        _setFooter([
            { text: '取消', cls: 'modal-btn-cancel', onClick: () => { _closeModal(); resolve(null); } },
            {
                text: actionText,
                cls: 'modal-btn-ok',
                onClick: () => {
                    // 收集数据
                    const formData = {};
                    fields.forEach(field => {
                        const el = document.getElementById(`modal_field_${field.id}`);
                        let val = el.value;
                        // 数字类型转换
                        if (field.type === 'number' || field.type === 'hidden') {
                            val = parseFloat(val) || 0;
                        }
                        formData[field.id] = val;
                    });
                    _closeModal();
                    resolve(formData);
                }
            }
        ]);
        elements.modalOverlay.classList.add('visible');
        setTimeout(() => {
            document.querySelectorAll('.all-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const targetId = btn.dataset.target;
                    const max = btn.dataset.max;
                    const input = document.getElementById(`modal_field_${targetId}`);
                    if (input) {
                        input.value = max;
                        // 触发 change 事件（可选）
                        input.dispatchEvent(new Event('change'));
                    }
                });
            });
        }, 50);
    });
}

// ==================== 2. 重写：加仓/减仓逻辑 ====================
async function adjustPosition(code, type) {
    try {
        // 获取基础数据
        const funds = await new Promise(r => chrome.storage.local.get(['myFunds'], res => r(res.myFunds || {})));
        const fundItem = funds[code];
        if (!fundItem) {
            await showAlert('未找到该标的数据！');
            return;
        }
        const live = await fetchLiveInfo(code);
        const defaultNav = live?.prevPrice || 1.0000;
        // 1. 构建表单配置
        const isAdd = type === 'add';
        const title = isAdd ? '加仓设置' : '减仓设置';
        // 计算确认日期并生成提示文字
        const confirmDate = getConfirmDate();
        const _now = new Date();
        const _isWeekend = _now.getDay() === 0 || _now.getDay() === 6;
        const _isAfterCutoff = !_isWeekend && (_now.getHours() > 15 || (_now.getHours() === 15 && _now.getMinutes() > 0));
        const timingHint = _isWeekend ? '📅 周末下单，顺延至下一交易日T+1确认'
            : _isAfterCutoff ? '⏰ 15:00后下单，按T+2确认'
                : '✅ 15:00前下单，按T+1确认';
        const subTitle = `${live?.name || code} (#${code})　${timingHint} `;
        let fields = [];
        if (isAdd) {
            // --- 加仓逻辑：输入金额 ---
            fields = [
                { id: 'amount', label: '买入金额 (元)', type: 'number', placeholder: '请输入金额', value: '', min: 0 },
                { id: 'feeRate', label: '交易费率 (%)', type: 'number', placeholder: '0.15', value: '0', step: '0.01' },
                { id: 'confirmDate', label: '确认日期（可手动调整）', type: 'date', value: confirmDate },
                { id: 'estNav', type: 'hidden', value: defaultNav }
            ];
        } else {
            // --- 减仓逻辑：输入份额 ---
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
                { id: 'confirmDate', label: '确认日期（可手动调整）', type: 'date', value: confirmDate }
            ];
        }
        // 2. 唤起表单，并在渲染后注入「下单时间」切换器
        const formModalPromise = showFormModal({
            title,
            subTitle,
            fields,
            actionText: '确认' + (isAdd ? '加仓' : '减仓')
        });

        // 表单渲染后插入切换器
        setTimeout(() => {
            const confirmDateInput = document.getElementById('modal_field_confirmDate');
            if (!confirmDateInput) return;

            // 在确认日期字段的 form-group 前插入切换器
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
            let useAfterCutoff = _isAfterCutoff;

            function applyStyle() {
                btnBefore.className = 'timing-btn' + (!useAfterCutoff ? ' active-before' : '');
                btnAfter.className = 'timing-btn' + (useAfterCutoff ? ' active-after' : '');
            }

            function recalcDate() {
                const d = new Date();
                const isWknd = d.getDay() === 0 || d.getDay() === 6;
                let base = new Date(d);
                let result;
                if (isWknd) {
                    while (base.getDay() === 0 || base.getDay() === 6) base.setDate(base.getDate() + 1);
                    result = formatDate(nextTradingDay(base));
                } else if (useAfterCutoff) {
                    result = formatDate(nextTradingDay(nextTradingDay(base)));
                } else {
                    result = formatDate(nextTradingDay(base));
                }
                confirmDateInput.value = result;
            }

            applyStyle();

            btnBefore.addEventListener('click', () => {
                useAfterCutoff = false;
                applyStyle();
                recalcDate();
            });

            btnAfter.addEventListener('click', () => {
                useAfterCutoff = true;
                applyStyle();
                recalcDate();
            });
        }, 80);

        const result = await formModalPromise;
        if (!result) return; // 用户取消
        if (isAdd) {
            const { amount, feeRate, confirmDate } = result;
            if (!fundItem.pendingAdjustments) fundItem.pendingAdjustments = [];
            fundItem.pendingAdjustments.push({
                type: 'add',
                amount: amount,
                feeRate: feeRate,
                targetDate: confirmDate,
                orderNav: defaultNav,        // 下单时净值
                orderDate: new Date().toLocaleDateString(),
                status: 'pending'
            });
        } else {
            const { shares: inputShares, feeRate, confirmDate } = result;
            if (!fundItem.pendingAdjustments) fundItem.pendingAdjustments = [];
            fundItem.pendingAdjustments.push({
                type: 'remove',
                shares: inputShares,
                feeRate: feeRate,
                targetDate: confirmDate,
                orderNav: defaultNav,        // 下单时净值
                orderDate: new Date().toLocaleDateString(),
                status: 'pending'
            });
        }
        // 保存
        await new Promise(r => chrome.storage.local.set({ myFunds: funds }, r));
        showToast(`✅ 操作成功！将在 ${result.confirmDate} 确认`, 'success');
        loadData();
    } catch (e) {
        console.error(`${type} 仓操作失败: `, e);
        showAlert(`操作失败: ${e.message} `);
    }
}
// ==================== 统一的：添加资产 / 编辑持仓 ====================
async function openFundEditor(existingCode = null) {
    let fund = null, live = null;
    let currentNav = 1.0000; // 默认净值

    if (existingCode) {
        const funds = await new Promise(r => chrome.storage.local.get(['myFunds'], res => r(res.myFunds || {})));
        fund = funds[existingCode];
        live = await fetchLiveInfo(existingCode);
        currentNav = live?.prevPrice || 1.0000;
    }

    const fields = [
        { id: 'code', label: '资产代码 (必填)', type: 'text', value: existingCode || '', placeholder: '如: 005827' },
        { id: 'amount', label: '持有金额 (元)', type: 'number', value: fund?.amount || '', min: 0, step: '0.01' },
        { id: 'shares', label: '持有份额', type: 'number', value: fund?.shares || '', step: '0.0001' },
        { id: 'holdProfit', label: '累计盈亏 (元)', type: 'number', value: fund?.holdProfit || 0 },
        { id: 'yesterdayProfit', label: '昨日收益 (元)', type: 'number', value: fund?.yesterdayProfit || 0 },
        { id: 'group', label: '分组名称', type: 'text', value: fund?.group || '默认', list: 'groupList' }
    ];

    // 弹窗出现后，注入联动计算逻辑
    setTimeout(() => {
        const codeInput = document.getElementById('modal_field_code');
        const amtInput = document.getElementById('modal_field_amount');
        const shareInput = document.getElementById('modal_field_shares');

        if (existingCode) {
            codeInput.disabled = true; // 编辑时禁止修改代码
        } else {
            // 新增时，输入代码后失去焦点，自动拉取净值
            codeInput.addEventListener('blur', async () => {
                const c = codeInput.value.trim();
                if (c.length >= 5) {
                    const l = await fetchLiveInfo(c);
                    if (l && l.prevPrice > 0) {
                        currentNav = l.prevPrice;
                        showToast(`已获取最新净值: ${currentNav} `, 'info', 2000);
                        // 如果此时有金额没份额，顺手算一下
                        if (amtInput.value && !shareInput.value) {
                            shareInput.value = (parseFloat(amtInput.value) / currentNav).toFixed(4);
                        }
                    }
                }
            });
        }

        // 相辅相成 1：金额变动 -> 算份额
        amtInput.addEventListener('input', () => {
            const amt = parseFloat(amtInput.value) || 0;
            if (currentNav > 0) shareInput.value = (amt / currentNav).toFixed(4);
        });

        // 相辅相成 2：份额变动 -> 算金额
        shareInput.addEventListener('input', () => {
            const sh = parseFloat(shareInput.value) || 0;
            if (currentNav > 0) amtInput.value = (sh * currentNav).toFixed(2);
        });
    }, 100);

    const result = await showFormModal({
        title: existingCode ? '编辑持仓' : '添加资产',
        subTitle: existingCode ? `${live?.name || existingCode} ` : '输入代码后点击空白处，获取净值进行联动计算',
        fields: fields,
        actionText: '保存'
    });

    if (!result) return;

    const code = (existingCode || result.code).trim().toUpperCase();
    if (!code) { await showAlert('资产代码不能为空！'); return; }

    elements.status.innerText = '正在保存...';

    // 如果是新增，且没获取过行情，再确认一次
    if (!existingCode && !live) {
        live = await fetchLiveInfo(code);
        if (!live || live.name.includes('[未知]')) {
            const ok = await showConfirm(`未检索到代码 ${code} 的数据，是否强制保存？`, '提示', true);
            if (!ok) { elements.status.innerText = '准备就绪'; return; }
        }
    }

    chrome.storage.local.get(['myFunds'], async (res) => {
        const funds = res.myFunds || {};
        funds[code] = {
            ...(funds[code] || {}), // 保留可能存在的历史调整数据
            amount: parseFloat(result.amount) || 0,
            shares: parseFloat(result.shares) || 0,
            holdProfit: parseFloat(result.holdProfit) || 0,
            yesterdayProfit: parseFloat(result.yesterdayProfit) || 0,
            group: result.group || '默认',
            savedPrevPrice: funds[code]?.savedPrevPrice || live?.prevPrice || 1,
            savedPrevDate: funds[code]?.savedPrevDate || live?.prevPriceDate || getToday()
        };

        chrome.storage.local.set({ myFunds: funds }, () => {
            showToast(`✅ ${code} 保存成功！`, 'success');
            elements.status.innerText = '准备就绪';
            loadData();
        });
    });
}

// 绑定添加按钮



// ==================== 居中弹窗逻辑 ====================
var centerModalOverlay = null;
/**
 * 初始化居中弹窗容器
 */
function initCenterModal() {
    centerModalOverlay = document.createElement('div');
    centerModalOverlay.className = 'center-modal-overlay';
    // 点击背景关闭
    centerModalOverlay.onclick = (e) => {
        if (e.target === centerModalOverlay) {
            hideCenterModal();
        }
    };
    document.body.appendChild(centerModalOverlay);
}
/**
 * 显示居中弹窗
 */
function showCenterMenu(code) {
    if (!centerModalOverlay) initCenterModal();
    const fund = currentFundsData.find(f => f.code === code);
    if (!fund) return;

    // 构建HTML，去掉内联 onclick
    const html = `
        <div class="center-modal-box">
            <div class="center-modal-header">
                <span class="modal-title">持仓操作</span>
                <span class="modal-link" id="transactionLink">交易记录 ></span>
            </div>
            <div class="center-modal-info">
                <span class="info-name">${fund.name}</span>
                <span class="info-code">#${fund.code}</span>
            </div>
            <div class="center-modal-actions">
                <div class="action-row-double">
                    <button class="btn-op add" data-action="add" data-code="${code}">+ 加仓</button>
                    <button class="btn-op remove" data-action="remove" data-code="${code}">− 减仓</button>
                </div>
                <button class="btn-op edit" data-action="edit" data-code="${code}">✏️ 编辑持仓</button>
                <button class="btn-op calc" data-action="calc_shares" data-code="${code}">🔄 根据金额重算份额</button>
                <button class="btn-op clear" data-action="clear" data-code="${code}">🧹 清空金额</button>
                <button class="btn-op delete" data-action="delete" data-code="${code}">🗑 彻底删除资产</button>
            </div>
        </div>
            `;
    centerModalOverlay.innerHTML = html;

    // 绑定交易记录链接
    const transactionLink = document.getElementById('transactionLink');
    // 在 showCenterMenu 中，为“交易记录”链接绑定新函数
    if (transactionLink) {
        transactionLink.addEventListener('click', () => {
            hideCenterModal();  // 关键：先关闭操作弹窗
            showPendingTransactions(code);
        });
    }

    async function showPendingTransactions(code) {
        const funds = await new Promise(r => chrome.storage.local.get(['myFunds'], res => r(res.myFunds || {})));
        const fund = funds[code];
        const txList = fund?.pendingAdjustments || [];

        if (txList.length === 0) {
            await showAlert('暂无交易记录');
            return;
        }

        const renderList = () => {
            let html = `<div class="tx-list">`;
            txList.forEach((adj, idx) => {
                const isPending = adj.status !== 'confirmed';
                const typeLabel = adj.type === 'add' ? '加仓' : '减仓';
                const typeCls = adj.type === 'add' ? 'add' : 'remove';

                const statusBadge = `<span class="tx-badge ${isPending ? 'pending' : 'confirmed'}">${isPending ? '待确认' : '已确认'}</span>`;

                const amountText = adj.type === 'add'
                    ? `买入 <b class="${typeCls}">¥${adj.amount}</b>`
                    : `卖出 <b class="${typeCls}">${adj.shares} 份</b>`;
                const feeText = adj.feeRate > 0 ? `&nbsp;费率${adj.feeRate}%` : '';

                let navInfo = '';
                if (adj.orderNav) navInfo += `下单净值 ${adj.orderNav} `;
                if (adj.confirmedPrice) navInfo += `　确认净值 ${adj.confirmedPrice} `;
                if (adj.confirmedShares && adj.type === 'add') navInfo += `　到账 ${adj.confirmedShares} 份`;

                let dateInfo = `预计确认日 ${adj.targetDate} `;
                if (adj.confirmedDate) dateInfo = `确认日 ${adj.confirmedDate} `;
                if (adj.orderDate) dateInfo = `下单 ${adj.orderDate} · ` + dateInfo;

                const revokeBtn = isPending
                    ? `<button data-revoke="${idx}" class="tx-revoke-btn">撤销</button>`
                    : `<span class="tx-no-revoke">不可撤销</span>`;

                html += `
            <div class="tx-item">
                <div class="tx-row-main">
                    <div class="tx-row-left">
                        <span class="tx-type ${typeCls}">${typeLabel}</span>
                        ${statusBadge}
                        <span class="tx-amount">${amountText}${feeText}</span>
                    </div>
                    ${revokeBtn}
                </div>
                        ${navInfo ? `<div class="tx-nav">${navInfo}</div>` : ''}
        <div class="tx-date">${dateInfo}</div>
                    </div>`;
            });
            html += `</div>`;
            return html;
        };

        // 打开 Modal 显示列表
        elements.modalTitle.textContent = '交易记录';
        elements.modalMsg.innerHTML = renderList();
        elements.modalInput.style.display = 'none';
        _setFooter([
            { text: '关闭', cls: 'modal-btn-cancel', onClick: _closeModal }
        ]);
        elements.modalOverlay.classList.add('visible');

        // 绑定撤销按钮（用 onclick 替代 addEventListener，防止每次打开叠加监听器）
        elements.modalMsg.onclick = async (e) => {
            const btn = e.target.closest('[data-revoke]');
            if (!btn) return;
            const idx = parseInt(btn.dataset.revoke);
            const adj = txList[idx];
            if (!adj || adj.status === 'confirmed') return;

            const typeLabel = adj.type === 'add' ? `加仓 ¥${adj.amount} ` : `减仓 ${adj.shares} 份`;
            const ok = await showConfirm(`确认撤销：${typeLabel}（${adj.targetDate}）？`, '撤销确认', true);
            if (!ok) return;

            txList.splice(idx, 1);
            await new Promise(r => chrome.storage.local.set({ myFunds: funds }, r));
            showToast('已撤销该笔交易', 'success');

            if (txList.length === 0) {
                _closeModal();
            } else {
                elements.modalMsg.innerHTML = renderList();
            }
            loadData(); // 只调用一次
        };
    }

    // 绑定其他按钮（原有代码已正确绑定）
    centerModalOverlay.querySelectorAll('.btn-op').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            const c = btn.dataset.code;
            hideCenterModal();

            if (action === 'add') adjustPosition(c, 'add');
            else if (action === 'remove') adjustPosition(c, 'remove');
            else if (action === 'edit') openFundEditor(c); // 注意这里换成了新函数
            else if (action === 'clear') clearPosition(c);
            // ======= 下面是新增的两个动作 =======
            else if (action === 'calc_shares') forceRecalculateShares(c);
            else if (action === 'delete') removeFund(c); // 直接复用你已有的 removeFund 函数
        });
    });

    // 显示弹窗
    requestAnimationFrame(() => {
        centerModalOverlay.classList.add('visible');
    });
}
/**
 * 隐藏弹窗
 */
function hideCenterModal() {
    if (centerModalOverlay) {
        centerModalOverlay.classList.remove('visible');
    }
}

// ==================== 强制根据金额重新计算份额 ====================
async function forceRecalculateShares(code) {
    elements.status.innerText = '正在重新计算份额...';
    const live = await fetchLiveInfo(code);
    if (!live || live.prevPrice <= 0) {
        await showAlert(`无法获取 ${code} 的有效净值，计算失败。`);
        elements.status.innerText = '准备就绪';
        return;
    }

    chrome.storage.local.get(['myFunds'], (res) => {
        const funds = res.myFunds || {};
        if (funds[code]) {
            // 用当前金额 除以 当前净值
            const newShares = parseFloat((funds[code].amount / live.prevPrice).toFixed(6));
            funds[code].shares = newShares;

            chrome.storage.local.set({ myFunds: funds }, () => {
                showToast(`✅ 已按照净值 ${live.prevPrice} 修正份额为: ${newShares} `, 'success');
                elements.status.innerText = '准备就绪';
                loadData();
            });
        }
    });
}

// ==================== 修改：渲染表格 ====================
function renderTable() {
    const filter = elements.groupFilter.value;
    let displayData = currentFundsData.filter(item => filter === 'all' || item.group === filter);
    displayData.sort((a, b) => {
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
    let sumAmount = 0, sumYesterdayProfit = 0, sumTodayProfit = 0, sumTotalProfit = 0;
    const fragment = document.createDocumentFragment();
    displayData.forEach((item, index) => {
        sumAmount += item.amount || 0;
        sumYesterdayProfit += item.yesterdayProfit || 0;
        sumTodayProfit += item.todayProfit || 0;
        sumTotalProfit += item.holdProfit || 0;
        const todayProfitText = item.todayProfit === null
            ? '—'
            : `${item.todayProfit >= 0 ? '+' : ''}${item.todayProfit.toFixed(2)} `;
        const tr = document.createElement('tr');
        tr.dataset.code = item.code;
        _td(tr, String(index + 1));
        // -- 代码 --
        _td(tr, item.code);
        // -- 名称/分组 --
        const tdName = document.createElement('td');
        const nameSpan = document.createElement('span');
        nameSpan.className = 'fund-name';
        nameSpan.title = item.name;
        nameSpan.textContent = item.name;
        const groupSpan = document.createElement('span');
        groupSpan.className = 'group-tag';
        groupSpan.dataset.code = item.code;
        groupSpan.textContent = item.group;
        tdName.appendChild(nameSpan);
        tdName.appendChild(groupSpan);
        tr.appendChild(tdName);
        // -- 持仓金额 (全屏和小屏都显示) --
        const tdAmount = document.createElement('td');
        tdAmount.className = 'editable-cell';
        tdAmount.contentEditable = 'true';
        tdAmount.dataset.field = 'amount';
        tdAmount.dataset.code = item.code;
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
        const sharesWrapper = document.createElement('div');
        sharesWrapper.className = 'cell-with-icon';
        const sharesText = document.createElement('span');
        sharesText.className = 'editable-cell'; // 保留可编辑
        sharesText.contentEditable = 'true';
        sharesText.dataset.field = 'shares';
        sharesText.dataset.code = item.code;
        sharesText.textContent = item.shares ? item.shares.toFixed(4) : '—';
        sharesWrapper.appendChild(sharesText);
        tdShares.appendChild(sharesWrapper);
        tr.appendChild(tdShares);
        // ... [净值列、昨日收益列、估值收益列代码保持不变] ...
        const tdNav = document.createElement('td');
        tdNav.className = 'col-hide';
        const todayStr2 = getToday();
        const prevNavLine = document.createElement('div');
        prevNavLine.style.cssText = 'display:flex; align-items:baseline; gap:4px;';
        const navVal = document.createElement('span');
        navVal.textContent = item.prevPrice > 0 ? item.prevPrice.toFixed(4) : '—';
        navVal.style.fontWeight = '500';
        prevNavLine.appendChild(navVal);
        if (item.prevPriceDate) {
            const prevDateSpan = document.createElement('span');
            prevDateSpan.style.cssText = `font-size:10px; color:${item.prevPriceDate === todayStr2 ? '#8c8c8c' : '#fa8c16'};`;
            prevDateSpan.textContent = item.prevPriceDate.slice(5);
            prevNavLine.appendChild(prevDateSpan);
        }
        tdNav.appendChild(prevNavLine);
        const liveNavLine = document.createElement('div');
        liveNavLine.style.cssText = 'display:flex; align-items:baseline; gap:4px; margin-top:2px; flex-wrap:wrap;';
        const priceSpan = document.createElement('span');
        if (item.price > 0) {
            priceSpan.textContent = item.price.toFixed(4);
            priceSpan.style.cssText = 'font-weight:500; color:#ffc069;';
            const liveDateSpan = document.createElement('span');
            liveDateSpan.style.cssText = 'font-size:10px; color:#8c8c8c;';
            liveDateSpan.textContent = (item.priceTime || todayStr2).slice(5);
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
            rateSpan.textContent = `${item.rate >= 0 ? '+' : ''}${item.rate.toFixed(2)}% `;
            liveNavLine.appendChild(rateSpan);
        }
        tdNav.appendChild(liveNavLine);
        tr.appendChild(tdNav);
        _tdProfit(tr, item.yesterdayProfit, item.yesterdayProfit >= 0);
        const tdToday = document.createElement('td');
        if (item.todayProfit !== null) {
            tdToday.className = item.todayProfit >= 0 ? 'up' : 'down';
        }
        const todayAmtLine = document.createElement('div');
        todayAmtLine.textContent = todayProfitText;
        tdToday.appendChild(todayAmtLine);
        if (item.rate !== null && item.rate !== undefined) {
            const todayRateLine = document.createElement('div');
            todayRateLine.style.cssText = 'font-size:10px; margin-top:1px; opacity:0.85;';
            todayRateLine.textContent = `${item.rate >= 0 ? '+' : ''}${item.rate.toFixed(2)}% `;
            tdToday.appendChild(todayRateLine);
        }
        tr.appendChild(tdToday);
        // 累计收益
        const tdHoldProfit = document.createElement('td');
        tdHoldProfit.className = `editable-cell ${item.holdProfit >= 0 ? 'up' : 'down'}`;
        tdHoldProfit.contentEditable = 'true';
        tdHoldProfit.dataset.field = 'holdProfit';
        tdHoldProfit.dataset.code = item.code;
        tdHoldProfit.textContent = `${item.holdProfit >= 0 ? '+' : ''}${item.holdProfit.toFixed(2)} `;
        tr.appendChild(tdHoldProfit);
        // -- 操作列 (只保留删除) --
        const tdOp = document.createElement('td');
        tdOp.className = 'col-hide';
        const btnDel = document.createElement('button');
        btnDel.className = 'del-btn';
        btnDel.dataset.code = item.code;
        btnDel.title = '删除';
        btnDel.textContent = '✕';
        tdOp.appendChild(btnDel);
        tr.appendChild(tdOp);
        fragment.appendChild(tr);
    });
    elements.tableBody.innerHTML = '';
    elements.tableBody.appendChild(fragment);
    // ... [汇总统计代码保持不变] ...
    elements.totalAmount.textContent = sumAmount.toLocaleString(undefined, { minimumFractionDigits: 2 });
    elements.totalYesterdayProfit.textContent = (sumYesterdayProfit >= 0 ? '+' : '') + sumYesterdayProfit.toFixed(2);
    elements.totalYesterdayProfit.className = sumYesterdayProfit >= 0 ? 'up' : 'down';
    elements.totalTodayProfit.textContent = (sumTodayProfit >= 0 ? '+' : '') + sumTodayProfit.toFixed(2);
    elements.totalTodayProfit.className = sumTodayProfit >= 0 ? 'up' : 'down';
    elements.totalTotalProfit.textContent = (sumTotalProfit >= 0 ? '+' : '') + sumTotalProfit.toFixed(2);
    elements.totalTotalProfit.className = sumTotalProfit >= 0 ? 'up' : 'down';
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
    // 绑定可编辑单元格事件
    elements.tableBody.querySelectorAll('.editable-cell').forEach(cell => {
        cell.onblur = () => {
            const code = cell.dataset.code;
            const field = cell.dataset.field;
            const valStr = cell.textContent.trim();
            const val = parseFloat(valStr);
            if (valStr === '' || isNaN(val)) {
                showToast('请输入有效的数字', 'warning');
                loadData();
                return;
            }
            chrome.storage.local.get(['myFunds'], (res) => {
                const funds = res.myFunds || {};
                if (funds[code]) {
                    if (funds[code][field] === val) return;
                    funds[code][field] = val;
                    const localItem = currentFundsData.find(f => f.code === code);
                    if (localItem) localItem[field] = val;
                    chrome.storage.local.set({ myFunds: funds }, () => {
                        showToast('已保存', 'success', 1500);
                        renderTable();
                    });
                }
            });
        };
        cell.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); cell.blur(); } };
    });
    // ---- 行点击选择（文件管理器风格）----
    elements.tableBody.querySelectorAll('tr').forEach((tr, idx) => {
        // 渲染时恢复选中高亮
        if (tr.dataset.code && selectedCodes.has(tr.dataset.code)) {
            tr.classList.add('selected-row');
        }

        tr.addEventListener('click', (e) => {
            // 点击操作按钮/齿轮/group-tag/del-btn 时不触发选择
            if (e.target.closest('.settings-icon, .group-tag, .del-btn, button')) return;

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
        // 修复：去掉了 id="clearSelectionBtn" 两边的空格，保证 DOM 能精准获取
        elements.status.innerHTML =
            `已选中 <b style="color:#69b1ff">${count}</b> 项 &nbsp; ` +
            `<span id="clearSelectionBtn" style="color:#ff7875;cursor:pointer;font-size:11px;border:1px solid #ff7875;border-radius:10px;padding:1px 7px;">✕ 取消选择</span>`;

        document.getElementById('clearSelectionBtn').onclick = () => {
            clearSelection();
            renderTable();
        };
        if (fabMain) fabMain.style.background = '#fa8c16';
    } else {
        elements.status.innerText = `最后更新: ${new Date().toLocaleTimeString()}`;
        if (fabMain) fabMain.style.background = '';
    }
}

// --- 单点清空（委托给统一函数）---
function clearPosition(code) { return clearPositions(code); }





function _td(tr, text) {
    const td = document.createElement('td');
    td.textContent = text;
    tr.appendChild(td);
}

function _tdProfit(tr, value, isUp) {
    const td = document.createElement('td');
    td.className = isUp ? 'up' : 'down';
    td.textContent = `${isUp ? '+' : ''}${value.toFixed(2)}`;
    tr.appendChild(td);
}
// 辅助函数：重置单个基金的持仓数据
function resetFundPosition(fund, shouldResetGroup = true) {
    fund.amount = 0;
    fund.shares = 0;
    fund.lastClosedAmount = 0;
    //fund.yesterdayProfit = 0;
    if (shouldResetGroup) fund.group = "已撤回"; // 核心：根据参数决定是否改分组
    if (fund.cost !== undefined) fund.cost = 0;
    // 注意：保留 holdProfit (累计收益)
}





async function removeFund(code) {
    const ok = await showConfirm(`确定删除 ${code}？`, '删除确认', true);
    if (ok) {
        chrome.storage.local.get(['myFunds'], (res) => {
            const f = res.myFunds || {};
            delete f[code];
            chrome.storage.local.set({ myFunds: f }, loadData);
        });
    }
}

function exportFundsData() {
    chrome.storage.local.get(['myFunds', 'lastUpdateDate', 'lastDayProfits'], (res) => {
        const fundsData = res.myFunds || {};
        if (Object.keys(fundsData).length === 0) {
            showToast('暂无可导出的基金数据！', 'warning');
            return;
        }

        const exportData = {
            exportTime: new Date().toLocaleString(),
            lastUpdateDate: res.lastUpdateDate || '',
            lastDayProfits: res.lastDayProfits || {},
            myFunds: fundsData
        };

        const jsonStr = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const now = new Date();
        const fileName = `基金数据_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.json`;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);

        showToast(`✅ 数据导出成功！文件名: ${fileName}`, 'success');
    });
}



function migrateFund(fund) {
    // 保留所有原始字段，只对数值类型做安全转换，防止旧格式数据类型错误
    return {
        ...fund,
        amount: parseFloat(fund.amount) || 0,
        holdProfit: parseFloat(fund.holdProfit) || 0,
        shares: parseFloat(fund.shares) || 0,
        yesterdayProfit: parseFloat(fund.yesterdayProfit) || 0,
        group: typeof fund.group === 'string' ? fund.group : '默认',
        savedPrevPrice: fund.savedPrevPrice ? parseFloat(fund.savedPrevPrice) : undefined,
        // pendingAdjustments（交易记录）原样保留，不做转换
        pendingAdjustments: Array.isArray(fund.pendingAdjustments) ? fund.pendingAdjustments : [],
    };
}

function importFundsData(event) {
    const fileInput = event.target;
    const file = fileInput.files[0];
    if (!file) return;

    if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
        showToast('请选择 JSON 格式的导出文件！', 'error');
        fileInput.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const importData = JSON.parse(e.target.result);
            if (!importData.myFunds || typeof importData.myFunds !== 'object') {
                await showAlert('导入文件格式错误：未找到有效基金数据！');
                fileInput.value = '';
                return;
            }

            const ok = await showConfirm(
                `确认导入【${importData.exportTime || '未知时间'}】的基金数据？\n注意：当前数据将被覆盖！`,
                '导入确认',
                true
            );
            if (!ok) { fileInput.value = ''; return; }

            const migratedFunds = {};
            for (const [code, fund] of Object.entries(importData.myFunds)) {
                migratedFunds[code] = migrateFund(fund);
            }

            const dataToSave = { myFunds: migratedFunds };
            if (importData.lastUpdateDate) dataToSave.lastUpdateDate = importData.lastUpdateDate;
            if (importData.lastDayProfits) dataToSave.lastDayProfits = importData.lastDayProfits;

            chrome.storage.local.set(dataToSave, () => {
                showToast('✅ 数据导入成功！', 'success');
                fileInput.value = '';
                loadData();
            });
        } catch (err) {
            await showAlert(`导入失败: ${err.message}`);
            fileInput.value = '';
        }
    };
    reader.readAsText(file);
}



// ==================== OCR 图片识别批量添加资产 ====================
let _ocrModalEl = null;
let _ocrItems = [];

/**
 * 懒加载并缓存 Tesseract Worker（v4 API）
 * @param {Function} onLog - 日志/进度回调
 */
// ── 主线程 OCR（完全绕过 Web Worker，避开 MV3 CSP 限制） ──
// worker.min.js 已改造：暴露 window.__TesseractDispatch，可在主线程直接调用
function _sendToTesseract(action, payload) {
    return new Promise((resolve, reject) => {
        const jobId = 'job_' + Math.random().toString(36).slice(2);
        const workerId = 'main_thread';
        __TesseractDispatch(
            { workerId, jobId, action, payload },
            (msg) => {
                if (msg.status === 'resolve') resolve(msg.data);
                else if (msg.status === 'reject') reject(new Error(msg.data));
                // progress 消息忽略或转发给 onLog
            }
        );
    });
}

async function _getOCRWorker(onLog) {
    if (window._tWorker) return window._tWorker;
    const extRoot = chrome.runtime.getURL('').replace(/\/$/, '');

    // 等待 worker.min.js 在主线程初始化（script 标签已在 popup.html 里加载）
    if (typeof __TesseractDispatch === 'undefined') {
        throw new Error('__TesseractDispatch 未定义，请确认 popup.html 已加载 worker.min.js');
    }

    // 初始化：load -> loadLanguage -> initialize
    await _sendToTesseract('load', {
        options: {
            corePath: chrome.runtime.getURL('tesseract-core.wasm.js'),
            langPath: extRoot,
            logging: false,
        }
    });
    await _sendToTesseract('loadLanguage', {
        langs: 'chi_sim',
        options: { langPath: extRoot, dataPath: null, cachePath: null, cacheMethod: 'none', gzip: false }
    });
    await _sendToTesseract('initialize', {
        langs: 'chi_sim',
        options: {}
    });

    // fake worker 对象，实现 recognize 接口
    const fakeWorker = {
        recognize: async (imageData) => {
            // 把 File/Blob 转成 Uint8Array，dispatchHandlers 需要 typed array
            let imgBuffer = imageData;
            if (imageData instanceof Blob || imageData instanceof File) {
                imgBuffer = new Uint8Array(await imageData.arrayBuffer());
            }
            const result = await new Promise((resolve, reject) => {
                const jobId = 'job_' + Math.random().toString(36).slice(2);
                __TesseractDispatch(
                    {
                        workerId: 'main_thread', jobId, action: 'recognize',
                        payload: {
                            image: imgBuffer, options: {},
                            output: { text: true, blocks: false, hocr: false, tsv: false }
                        }
                    },
                    (msg) => {
                        if (onLog) onLog(msg);
                        if (msg.status === 'resolve') resolve(msg.data);
                        else if (msg.status === 'reject') reject(new Error(String(msg.data)));
                    }
                );
            });
            return { data: result };  // 兼容 Tesseract 标准返回格式
        },
        terminate: () => { window._tWorker = null; }
    };

    window._tWorker = fakeWorker;
    return fakeWorker;
}

/**
 * 通过基金名称反推 6 位基金代码（调用东方财富搜索接口）
 * @param {string} name - 基金名称（部分匹配即可）
 * @returns {Promise<string|null>}
 */
async function getCodeByName(name) {
    if (!name || name.length < 2) return null;

    // 生成渐进缩短的查询变体：全名 → 去联接/ETF后缀 → 纯中文核心词
    function nameVariants(raw) {
        const clean = raw.replace(/\s+/g, '');
        const variants = [clean];
        // 去掉尾部份额标识和联接/LOF/ETF修饰
        let core = clean
            .replace(/发起联接[A-E]?$/, '')
            .replace(/联接[A-E]?$/, '')
            .replace(/指数[A-E]?$/, '')
            .replace(/[（(]LOF[)）]/, '')
            .replace(/ETF/, '')
            .replace(/[A-E]$/, '');
        if (core !== clean && core.length >= 4) variants.push(core);
        // 纯中文核心（去掉所有字母和括号）
        const cjk = raw.replace(/[A-Za-z\(\)\（\）\s]+/g, '')
            .replace(/发起联接$|联接$|指数$/, '');
        if (cjk !== clean && cjk !== core && cjk.length >= 4) variants.push(cjk);
        return [...new Set(variants)];
    }

    for (const query of nameVariants(name)) {
        try {
            const url = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=10&key=${encodeURIComponent(query)}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.Datas && data.Datas.length > 0) {
                // 只接受纯6位数字代码，跳过 F0T001/C4F002 等内部编码
                for (const item of data.Datas) {
                    const code = String(item.CODE || '');
                    if (/^\d{6}$/.test(code)) return code;
                }
            }
        } catch (e) {
            console.warn('[OCR] 代码反查失败:', query, e);
        }
    }
    return null;
}

/**
 * 去除 Tesseract OCR 在中文字符之间插入的多余空格
 * 逐行处理，避免跨行合并
 */
function _normalizeOCR(text) {
    return text.split('\n').map(line => {
        let prev = null, l = line;
        while (prev !== l) {
            prev = l;
            l = l.replace(/([一-龥])\s+([一-龥])/g, '$1$2');
            l = l.replace(/([一-龥])\s+([（）\(\)])/g, '$1$2');
            l = l.replace(/([（）\(\)])\s+([一-龥])/g, '$1$2');
        }
        return l;
    }).join('\n');
}

/**
 * 从 OCR 文本中提取资产信息（支持列表页和详情页）
 *
 * 流程：
 *   1. normalize：去除中文字符间空格（Tesseract chi_sim 常见问题）
 *   2. Mode B：解析列表页（无代码，按"昨日收益/持有收益/总金额"列头定位）
 *   3. Mode A：解析详情页（含6位基金代码），通过标签定位各字段
 *              若持有金额=0，与 Mode B 结果按名称相似度交叉引用
 *   4. 合并：Mode A 结果（带代码）+ 未被引用的 Mode B 结果（需反查代码）
 */
function _parseOCRText(text) {
    console.log('[OCR RAW TEXT]\n', text);

    const normalized = _normalizeOCR(text);
    const lines = normalized.split('\n').map(l => l.trim()).filter(Boolean);
    const fullText = lines.join('\n');
    const result = [];
    if (!lines.length) return result;

    const CODE_RE = /\b(\d{6})\b/;
    // 工厂函数：每次调用返回新实例，避免 /g 正则 lastIndex 状态污染
    const MONEY_RE = () => /[+-]?\d[\d,\.]*\.\d{1,2}(?!\d)(?!\s*%)/g;
    const VAL_RE = () => /[+-]?\d[\d,\.]*\.\d{2}(?!\d)(?!\s*%)/g;
    const NAME_EXCL = /收益|金额|赎回|购买|申购|到账|手续费|销售|暂停|T\+\d|万内/;
    const ALL_LABELS = ['持有金额', '昨日收益', '持有收益率', '持有收益', '持有份额'];

    function parseAmt(str) {
        const s = str.replace(/[^\d\.\+-]/g, '');
        if (!s) return 0;
        const parts = s.replace(/^[+-]/, '').split('.');
        if (parts.length > 2) {
            const sign = s[0] === '-' ? -1 : 1;
            return sign * parseFloat(parts.slice(0, -1).join('') + '.' + parts[parts.length - 1]);
        }
        return parseFloat(s) || 0;
    }

    function isNameLine(s) {
        if (!s || s.length < 2) return false;
        if (!/[\u4e00-\u9fa5]/.test(s)) return false;
        if (NAME_EXCL.test(s)) return false;
        if (CODE_RE.test(s)) return false;
        if (/^\d+(\.\d+)?$/.test(s)) return false;
        const cjk = (s.match(/[\u4e00-\u9fa5]/g) || []).length;
        return cjk / s.replace(/\s/g, '').length >= 0.3;
    }

    function nameSimilar(a, b) {
        const ca = a.replace(/[^\u4e00-\u9fa5]/g, '');
        const cb = b.replace(/[^\u4e00-\u9fa5]/g, '');
        if (!ca || !cb || ca.length < 4 || cb.length < 4) return false;
        const [shorter, longer] = ca.length <= cb.length ? [ca, cb] : [cb, ca];
        return longer.includes(shorter);
    }

    // 从 startFrom 位置开始找标签（持有收益 需跳过 持有收益率）
    function getLabelPosFrom(lbl, startFrom) {
        if (lbl !== '持有收益') {
            const idx = fullText.indexOf(lbl, startFrom);
            return idx !== -1 ? idx : undefined;
        }
        let s = startFrom;
        while (true) {
            const idx = fullText.indexOf(lbl, s);
            if (idx === -1) return undefined;
            if (fullText[idx + lbl.length] !== '率') return idx;
            s = idx + 1;
        }
    }

    // 提取标签后到下一个标签前的文本片段（从 startFrom 开始搜索标签）
    function segAfterLabel(lbl, startFrom) {
        const pos = getLabelPosFrom(lbl, startFrom);
        if (pos === undefined) return '';
        const segStart = pos + lbl.length;
        let segEnd = segStart + 200;
        ALL_LABELS.forEach(other => {
            if (other === lbl) return;
            const op = getLabelPosFrom(other, startFrom);
            if (op !== undefined && op > segStart && op < segEnd) segEnd = op;
        });
        return fullText.slice(segStart, segEnd);
    }

    function maxPosNum(seg) {
        let best = 0;
        for (const m of (seg.match(MONEY_RE()) || [])) {
            const v = parseAmt(m);
            if (v > best) best = v;
        }
        return best;
    }

    function firstNum(seg, mustPos = false) {
        for (const m of (seg.match(MONEY_RE()) || [])) {
            const v = parseAmt(m);
            if (mustPos && v < 0) continue;
            return v;
        }
        return 0;
    }

    // ══════════════════════════════════════════════
    // STEP 1: Mode B — 列表页解析
    // ══════════════════════════════════════════════
    const COL_HEAD_RE = /昨日收|总金额/;
    const modeB = [];
    const seenNames = new Set();

    for (let i = 0; i < lines.length; i++) {
        if (!COL_HEAD_RE.test(lines[i])) continue;
        const hasYesterday = /昨日收/.test(lines[i]);

        let dataLine = '';
        for (let j = i + 1; j <= Math.min(i + 3, lines.length - 1); j++) {
            const ms = lines[j].match(VAL_RE());
            if (ms && ms.length >= 2) { dataLine = lines[j]; break; }
        }
        if (!dataLine) continue;

        const nums = (dataLine.match(VAL_RE()) || []).map(parseAmt);
        let yp = 0, hp = 0, amt = 0;
        if (hasYesterday && nums.length >= 3) {
            [yp, hp, amt] = [nums[0], nums[1], nums[2]];
        } else if (nums.length >= 3) {
            [yp, hp, amt] = [nums[0], nums[1], nums[2]];
        } else if (nums.length === 2) {
            [hp, amt] = [nums[0], nums[1]];
        } else if (nums.length === 1) {
            amt = nums[0];
        }
        // 安全兜底：amt 取最大正数
        const posNums = nums.filter(v => v > 0);
        if (posNums.length && Math.max(...posNums) > amt) amt = Math.max(...posNums);

        let fundName = '';
        for (let k = i - 1; k >= Math.max(0, i - 6); k--) {
            if (isNameLine(lines[k])) { fundName = lines[k]; break; }
        }
        if (!fundName || seenNames.has(fundName)) continue;
        seenNames.add(fundName);

        modeB.push({
            code: '', name: fundName, amount: amt, holdProfit: hp, yesterdayProfit: yp,
            shares: 0, group: '默认', selected: true, _needLookup: true, _claimed: false
        });
    }

    // ══════════════════════════════════════════════
    // STEP 2: Mode A — 详情页（含6位基金代码）
    // ══════════════════════════════════════════════
    const seenCodes = new Set();

    for (let i = 0; i < lines.length; i++) {
        const codeMatch = lines[i].match(CODE_RE);
        if (!codeMatch) continue;
        const code = codeMatch[1];
        if (seenCodes.has(code)) continue;
        seenCodes.add(code);

        let fundName = '';
        for (let k = i - 1; k >= Math.max(0, i - 4); k--) {
            if (/[\u4e00-\u9fa5]/.test(lines[k])) { fundName = lines[k]; break; }
        }

        const codePos = fullText.indexOf(code);
        const startFrom = Math.max(0, codePos - 10);

        let amount = maxPosNum(segAfterLabel('持有金额', startFrom));
        let yesterday = firstNum(segAfterLabel('昨日收益', startFrom));
        let hold = firstNum(segAfterLabel('持有收益', startFrom));

        // ── 详情页金额重建：持有金额大字体常被OCR漏识别
        //    若 amount=0，在代码附近寻找"昨日收益/持有收益/持有收益率"三标签合并行，
        //    然后从下一个数值行提取 [yesterday, holdProfit] 和 持有收益率%，
        //    用公式 amount = holdProfit / rate% + holdProfit 反推持仓金额 ──
        if (!amount) {
            const RATE_RE = /(\d+\.?\d*)\s*%/g;
            // 在 startFrom 之后的行里找含"昨日收益"或"持有收益率"的行
            const linesAfterCode = lines.slice(i);
            for (let li = 0; li < linesAfterCode.length; li++) {
                const lbl = linesAfterCode[li];
                if (!/昨日收益|持有收益/.test(lbl)) continue;
                // 找下一个有数字的行
                for (let vi = li + 1; vi <= Math.min(li + 3, linesAfterCode.length - 1); vi++) {
                    const valLine = linesAfterCode[vi];
                    const nums = (valLine.match(MONEY_RE()) || []).map(m => parseAmt(m));
                    const rates = [];
                    let rm;
                    RATE_RE.lastIndex = 0;
                    while ((rm = RATE_RE.exec(valLine)) !== null) rates.push(parseFloat(rm[1]));
                    if (!nums.length) continue;
                    // 更新 yesterday / hold（若之前标签解析失败）
                    if (!yesterday && nums[0] !== undefined) yesterday = nums[0];
                    if (!hold && nums[1] !== undefined) hold = nums[1];
                    // 反推金额
                    if (rates.length && Math.abs(rates[0]) > 0.01 && hold !== 0) {
                        const rateDec = rates[0] / 100;
                        amount = Math.round((hold / rateDec + hold) * 100) / 100;
                    }
                    break;
                }
                if (amount) break;
            }
        }

        // 与 Mode B 交叉引用：找所有名称相似的条目，全部标记为已引用
        for (const b of modeB) {
            if (nameSimilar(fundName, b.name)) {
                b._claimed = true;
                // 若 amount 仍为 0，从 Mode B 补充
                if (!amount && b.amount) {
                    amount = b.amount;
                    if (!hold) hold = b.holdProfit;
                    if (!yesterday) yesterday = b.yesterdayProfit;
                }
            }
        }

        result.push({
            code, name: fundName, amount, holdProfit: hold, yesterdayProfit: yesterday,
            shares: 0, group: '默认', selected: true, _needLookup: false
        });
    }

    // ══════════════════════════════════════════════
    // STEP 3: 合并未被引用的 Mode B 条目
    // ══════════════════════════════════════════════
    for (const b of modeB) {
        if (!b._claimed) {
            delete b._claimed;
            result.push(b);
        }
    }

    return result;
}

/**
 * 渲染识别结果为可编辑表格（含昨日收益、持有收益列）
 */
function _renderOCRTable() {
    const container = _ocrModalEl.querySelector('#_ocrResults');
    if (!_ocrItems.length) {
        container.innerHTML = '<p style="text-align:center;color:#6a8aaa;font-size:12px;padding:20px;">未识别到有效资产信息，请确认图片是否清晰</p>';
        return;
    }
    const C = 'padding:4px 3px;';
    const I = 'background:#0d1b2e;border:1px solid #2a4a72;border-radius:4px;color:#c8d8f0;padding:2px 4px;font-size:11px;width:100%;box-sizing:border-box;';

    let html = `
        <table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed;">
            <colgroup>
                <col style="width:24px">
                <col style="width:68px">
                <col style="width:64px">
                <col style="width:80px">
                <col style="width:74px">
                <col style="width:74px">
                <col style="width:48px">
            </colgroup>
            <thead><tr style="color:#4a6a90;border-bottom:1px solid #1e3a5f;white-space:nowrap;">
                <th style="${C}"><input type="checkbox" id="_ocrChkAll" checked></th>
                <th style="${C}">代码</th>
                <th style="${C}">基金名称</th>
                <th style="${C}">持仓金额(元)</th>
                <th style="${C}">持有收益(元)</th>
                <th style="${C}">昨日收益(元)</th>
                <th style="${C}">分组</th>
            </tr></thead>
            <tbody>`;

    _ocrItems.forEach((a, idx) => {
        // 代码缺失时用红色边框提示
        const codeStyle = a.code ? '' : 'border-color:#f5222d;';
        const hpVal = (a.holdProfit !== undefined && a.holdProfit !== 0) ? a.holdProfit : '';
        const ypVal = (a.yesterdayProfit !== undefined && a.yesterdayProfit !== 0) ? a.yesterdayProfit : '';
        const nameStr = (a.name || '').replace(/"/g, '&quot;');
        html += `<tr style="border-bottom:1px solid #141f30;">
            <td style="${C}"><input type="checkbox" class="_oc" data-i="${idx}" ${a.selected ? 'checked' : ''}></td>
            <td style="${C}"><input type="text" style="${I}${codeStyle}" value="${a.code || ''}" class="_oe" data-i="${idx}" data-f="code" placeholder="待填"></td>
            <td style="${C}" title="${nameStr}"><span style="color:#8aacce;font-size:10px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${a.name || '—'}</span></td>
            <td style="${C}"><input type="number" style="${I}" value="${a.amount || ''}" class="_oe" data-i="${idx}" data-f="amount" step="0.01" placeholder="0"></td>
            <td style="${C}"><input type="number" style="${I}" value="${hpVal}" class="_oe" data-i="${idx}" data-f="holdProfit" step="0.01" placeholder="0"></td>
            <td style="${C}"><input type="number" style="${I}" value="${ypVal}" class="_oe" data-i="${idx}" data-f="yesterdayProfit" step="0.01" placeholder="0"></td>
            <td style="${C}"><input type="text" style="${I}" value="${a.group}" class="_oe" data-i="${idx}" data-f="group"></td>
        </tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;

    // 全选/取消全选
    container.querySelector('#_ocrChkAll').onchange = function () {
        _ocrItems.forEach(a => a.selected = this.checked);
        container.querySelectorAll('._oc').forEach(cb => cb.checked = this.checked);
    };
    // 单行勾选
    container.querySelectorAll('._oc').forEach(cb => {
        cb.onchange = () => { _ocrItems[+cb.dataset.i].selected = cb.checked; };
    });
    // 字段编辑（数字字段允许负值）
    container.querySelectorAll('._oe').forEach(inp => {
        inp.oninput = () => {
            const idx = +inp.dataset.i, f = inp.dataset.f;
            const numFields = ['amount', 'holdProfit', 'yesterdayProfit', 'shares'];
            _ocrItems[idx][f] = numFields.includes(f)
                ? (parseFloat(inp.value) || 0) : inp.value;
        };
    });
}

/**
 * 打开 OCR 批量添加弹窗
 */
function openOCRBatchAdd() {
    if (_ocrModalEl) return;

    // 打开时就给 3 个空行，这样界面一出来就有表格可以手动填
    _ocrItems = [
        { code: '', name: '', amount: '', holdProfit: '', yesterdayProfit: '', group: '默认', selected: true },
        { code: '', name: '', amount: '', holdProfit: '', yesterdayProfit: '', group: '默认', selected: true },
        { code: '', name: '', amount: '', holdProfit: '', yesterdayProfit: '', group: '默认', selected: true }
    ];

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);z-index:20000;display:flex;align-items:center;justify-content:center;';

    // HTML 结构彻底清理，去掉了不存在的 ID，顶部直接展示混合输入区
    overlay.innerHTML = `
        <div style="background:#111f35;border:1px solid #2a4a72;border-radius:12px;width:600px;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 16px 48px rgba(0,0,0,.6);overflow:hidden;">
            <div style="padding:13px 18px;border-bottom:1px solid #1e3a5f;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
                <span style="font-size:14px;font-weight:700;color:#e8f0ff;">⚡ 批量添加数据</span>
                <span id="_ocrClose" style="cursor:pointer;color:#6a8aaa;font-size:20px;line-height:1;padding:0 2px;">✕</span>
            </div>
            
            <div style="padding:14px; display:flex; gap:10px; border-bottom:1px solid #1e3a5f; flex-shrink:0; background:#0a1525;">
                <textarea id="_batchText" placeholder="在此粘贴纯文本 (如: 000001 1000)\n或者直接在下方表格手动录入..." style="flex:1; height:60px; background:#0d1b2e; border:1px solid #2a4a72; border-radius:6px; color:#c8d8f0; padding:8px; font-size:12px; resize:none;"></textarea>
                <div style="display:flex; flex-direction:column; gap:8px; width:100px;">
                    <button id="_btnParseText" style="flex:1; background:#1a2f50; color:#8aacce; border:1px solid #2a4a72; border-radius:6px; cursor:pointer; font-size:12px;">解析文本</button>
                    <button id="_ocrPickBtn" style="flex:1; background:#1890ff; border:none; color:#fff; border-radius:6px; cursor:pointer; font-size:12px; font-weight:bold;">📷 传图识别</button>
                </div>
            </div>
            <input type="file" id="_ocrFile" accept="image/*" multiple style="display:none;">
            
            <div id="_ocrProg" style="display:none;padding:8px 16px;font-size:12px;color:#fa8c16;background:rgba(250,140,22,0.1);flex-shrink:0;"></div>
            
            <div id="_ocrResults" style="flex:1;overflow-y:auto;padding:10px 14px;min-height:240px;"></div>
            
            <div id="_ocrFoot" style="padding:10px 16px;border-top:1px solid #1e3a5f;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
                <button id="_ocrAddRow" style="background:transparent; border:1px dashed #2a4a72; color:#69b1ff; border-radius:6px; padding:6px 14px; font-size:12px; cursor:pointer;">+ 增加一行</button>
                <button id="_ocrSave" style="background:#1890ff;color:#fff;border:none;border-radius:6px;padding:7px 22px;font-size:13px;font-weight:600;cursor:pointer;">批量保存</button>
            </div>
        </div>`;

    document.body.appendChild(overlay);
    _ocrModalEl = overlay;

    // 直接渲染表格
    _renderOCRTable();

    // 绑定事件
    overlay.querySelector('#_ocrClose').onclick = () => { overlay.remove(); _ocrModalEl = null; _ocrItems = []; };

    const fileInput = overlay.querySelector('#_ocrFile');
    overlay.querySelector('#_ocrPickBtn').onclick = () => fileInput.click();
    fileInput.onchange = () => _runOCR(Array.from(fileInput.files));

    overlay.querySelector('#_ocrAddRow').onclick = () => {
        _ocrItems.push({ code: '', name: '', amount: '', holdProfit: '', yesterdayProfit: '', group: '默认', selected: true });
        _renderOCRTable();
    };

    overlay.querySelector('#_btnParseText').onclick = () => {
        const text = overlay.querySelector('#_batchText').value;
        const lines = text.split('\n');
        // 过滤掉当前完全空白的行，腾出位置
        _ocrItems = _ocrItems.filter(item => item.code || item.amount);
        lines.forEach(line => {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 2 && /^\d{6}$/.test(parts[0])) {
                _ocrItems.push({
                    code: parts[0], name: '', amount: parseFloat(parts[1]) || 0,
                    holdProfit: 0, yesterdayProfit: 0, group: '默认', selected: true
                });
            }
        });
        overlay.querySelector('#_batchText').value = '';
        _renderOCRTable();
    };

    overlay.querySelector('#_ocrSave').onclick = _saveOCRItems;
}

/**
 * 执行 OCR 识别流程（支持详情页/列表页双模式）
 */
async function _runOCR(files) {
    const imgs = files.filter(f => f.type.startsWith('image/'));
    if (!imgs.length) { showToast('请选择图片文件', 'warning'); return; }

    const prog = _ocrModalEl.querySelector('#_ocrProg');
    prog.style.display = 'block';
    prog.textContent = '⏳ 正在初始化OCR引擎，首次加载需要几秒...';

    // 清空现有的空行，准备装入图片识别数据
    _ocrItems = _ocrItems.filter(item => item.code || item.amount);

    try {
        const worker = await _getOCRWorker(m => {
            if (m.status === 'recognizing text' && _ocrModalEl) {
                prog.textContent = `⏳ 识别中... ${Math.round((m.progress || 0) * 100)}%`;
            }
        });

        for (let i = 0; i < imgs.length; i++) {
            if (!_ocrModalEl) return;
            prog.textContent = `⏳ 正在识别第 ${i + 1} / ${imgs.length} 张图片...`;
            const { data: { text } } = await worker.recognize(imgs[i]);
            _ocrItems.push(..._parseOCRText(text));
        }

        if (!_ocrModalEl) return; // 去重前检查弹窗是否已关闭
        const seenCodes = new Set();
        const seenNames = new Set();
        _ocrItems = _ocrItems.filter(a => {
            if (a.code) {
                if (seenCodes.has(a.code)) return false;
                seenCodes.add(a.code); return true;
            }
            if (a.name) {
                if (seenNames.has(a.name)) return false;
                seenNames.add(a.name); return true;
            }
            return true; // 允许手动填写的无代码无名称行保留
        });

        const needLookup = _ocrItems.filter(a => a._needLookup && a.name);
        if (!_ocrModalEl) return; // 反查代码前检查弹窗是否已关闭
        if (needLookup.length > 0) {
            prog.textContent = `⏳ 正在反查基金代码（${needLookup.length} 条）...`;
            await Promise.all(needLookup.map(async (a) => {
                const code = await getCodeByName(a.name);
                a.code = code || '';
                a._needLookup = false;
            }));
        }

        if (_ocrItems.length) {
            const found = _ocrItems.filter(a => a.code).length;
            prog.textContent = `✅ 识别完成（${found} 个找到代码），请核对后批量保存`;
        } else {
            prog.textContent = '⚠️ 未识别到有效基金信息，请手动补充';
        }

        if (!_ocrModalEl) return; // 渲染前检查弹窗是否已关闭
        _renderOCRTable();
    } catch (e) {
        prog.textContent = '❌ 识别失败：' + e.message;
    }
}

/**
 * 批量保存已选中的 OCR 识别结果
 */
async function _saveOCRItems() {
    const toSave = _ocrItems.filter(a => a.selected && String(a.code || '').trim());
    if (!toSave.length) { showToast('请至少勾选一个有效代码的资产', 'warning'); return; }

    const btn = _ocrModalEl.querySelector('#_ocrSave');
    btn.disabled = true;
    btn.textContent = '保存中...';

    try {
        const funds = await new Promise(r => chrome.storage.local.get(['myFunds'], res => r(res.myFunds || {})));
        for (const a of toSave) {
            const code = String(a.code).trim().toUpperCase();
            if (!code) continue;
            const existing = funds[code] || {};
            funds[code] = {
                ...existing,
                name: a.name || existing.name || '',
                amount: a.amount ?? 0,
                holdProfit: a.holdProfit ?? 0,           // 持有收益（累计）
                yesterdayProfit: a.yesterdayProfit ?? 0, // 昨日收益
                group: a.group || '默认',
                // 净值相关：优先保留已有记录，若无则用默认值
                savedPrevPrice: existing.savedPrevPrice || 1,
                savedPrevDate: existing.savedPrevDate || getToday(),
            };
            // 份额仅当有值时才覆盖（默认不采集）
            if (a.shares && a.shares > 0) {
                funds[code].shares = a.shares;
            }
        }

        await new Promise(r => chrome.storage.local.set({ myFunds: funds }, r));
        showToast(`✅ 成功保存 ${toSave.length} 个资产！`, 'success');
        _ocrModalEl.remove();
        _ocrModalEl = null;
        _ocrItems = [];
        loadData();
    } catch (e) {
        btn.disabled = false;
        btn.textContent = '批量保存选中';
        showToast('保存失败：' + e.message, 'error');
    }
}
// getCodeByName 和 OCR 双模式解析已整合至上方 _parseOCRText / _runOCR 函数