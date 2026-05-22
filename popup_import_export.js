function downloadJsonFile(data, fileName) {
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}

const TRADE_ORDER_CSV_COLUMNS = [
    { key: 'id', type: 'int' },
    { key: 'orderId', type: 'int' },
    { key: 'code', type: 'string' },
    { key: 'name', type: 'string' },
    { key: 'group', type: 'string' },
    { key: 'type', type: 'string' },
    { key: 'status', type: 'string' },
    { key: 'source', type: 'string' },
    { key: 'date', type: 'string' },
    { key: 'orderDate', type: 'string' },
    { key: 'targetDate', type: 'string' },
    { key: 'confirmedDate', type: 'string' },
    { key: 'effectiveDate', type: 'string' },
    { key: 'dividendDate', type: 'string' },
    { key: 'amount', type: 'float' },
    { key: 'shares', type: 'float' },
    { key: 'confirmedShares', type: 'float' },
    { key: 'price', type: 'float' },
    { key: 'confirmedPrice', type: 'float' },
    { key: 'orderNav', type: 'float' },
    { key: 'dividendAmount', type: 'float' },
    { key: 'perShare', type: 'float' },
    { key: 'dividendNavPrice', type: 'float' },
    { key: 'feeRate', type: 'float' },
    { key: 'fee', type: 'float' },
    { key: 'isClear', type: 'bool' },
    { key: 'remark', type: 'string' },
    { key: 'autoDetected', type: 'bool' },
    { key: 'inferredBySettlement', type: 'string' },
    { key: 'createTime', type: 'int' }
];

function csvEscapeString(v) {
    if (v === null || v === undefined) return '""';
    return '"' + String(v).replace(/"/g, '""') + '"';
}

function formatTradeOrderCSVCell(value, type) {
    if (type === 'string') return csvEscapeString(value);
    if (type === 'bool') {
        if (value === true) return 'true';
        if (value === false) return 'false';
        return '""';
    }
    if (type === 'int' || type === 'float') {
        if (value === null || value === undefined || value === '') return '""';
        const n = Number(value);
        if (!Number.isFinite(n)) return '""';
        return type === 'int' ? String(Math.trunc(n)) : String(n);
    }
    return csvEscapeString(value);
}

function parseTradeOrderCSV(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuote = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuote) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else { inQuote = false; }
            } else {
                field += c;
            }
        } else if (c === '"') {
            inQuote = true;
        } else if (c === ',') {
            row.push(field); field = '';
        } else if (c === '\n') {
            row.push(field); rows.push(row); row = []; field = '';
        } else if (c === '\r') {
            // skip
        } else {
            field += c;
        }
    }
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows.filter(r => r.length > 0 && r.some(cell => cell !== ''));
}

function parseTradeOrderCSVCell(raw, type) {
    if (raw === undefined || raw === null) return undefined;
    const s = String(raw).trim();
    if (s === '') return undefined;
    if (type === 'string') return s;
    if (type === 'bool') {
        const lc = s.toLowerCase();
        if (lc === 'true' || lc === '1' || lc === 'yes') return true;
        if (lc === 'false' || lc === '0' || lc === 'no') return false;
        return undefined;
    }
    if (type === 'int' || type === 'float') {
        const n = Number(s);
        if (!Number.isFinite(n)) return undefined;
        return type === 'int' ? Math.trunc(n) : n;
    }
    return s;
}

async function exportTradeOrdersCSV() {
    const { orders } = await HistoryDB.getAllExportData();
    if (!Array.isArray(orders) || orders.length === 0) {
        showToast('暂无可导出的订单数据！', 'warning');
        return;
    }
    const sorted = [...orders].sort((a, b) => {
        const da = a.effectiveDate || a.confirmedDate || a.date || '';
        const db = b.effectiveDate || b.confirmedDate || b.date || '';
        if (da !== db) return da.localeCompare(db);
        return (a.id || 0) - (b.id || 0);
    });
    const header = TRADE_ORDER_CSV_COLUMNS.map(col => csvEscapeString(col.key)).join(',');
    const body = sorted.map(order =>
        TRADE_ORDER_CSV_COLUMNS.map(col => formatTradeOrderCSVCell(order[col.key], col.type)).join(',')
    ).join('\n');
    const csv = '﻿' + header + '\n' + body + '\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trade_orders_${formatDateTimeForFile()}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
    showToast(`✅ 已导出 ${sorted.length} 条订单到 ${a.download}`, 'success');
}

function importTradeOrdersCSV(event) {
    const fileInput = event.target;
    const file = fileInput.files[0];
    if (!file) return;
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
        showToast('请选择 CSV 文件！', 'error');
        fileInput.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            let text = String(e.target.result || '');
            if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
            const rows = parseTradeOrderCSV(text);
            if (rows.length < 2) {
                await showAlert('CSV 文件没有可导入的订单数据！');
                fileInput.value = '';
                return;
            }
            const header = rows[0].map(h => h.trim());
            const columnMap = TRADE_ORDER_CSV_COLUMNS.map(col => ({
                col,
                index: header.indexOf(col.key)
            }));
            const missing = columnMap.filter(({ col, index }) =>
                index < 0 && ['code', 'type'].includes(col.key)
            );
            if (missing.length > 0) {
                await showAlert(`CSV 缺少必要列：${missing.map(m => m.col.key).join('、')}`);
                fileInput.value = '';
                return;
            }

            const parsedOrders = [];
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (!row || row.every(cell => cell === '')) continue;
                const record = {};
                for (const { col, index } of columnMap) {
                    if (index < 0) continue;
                    const value = parseTradeOrderCSVCell(row[index], col.type);
                    if (value !== undefined) record[col.key] = value;
                }
                if (!record.code) continue;
                if (record.id !== undefined) delete record.id;
                parsedOrders.push(record);
            }

            if (parsedOrders.length === 0) {
                await showAlert('CSV 没有解析到任何有效订单。');
                fileInput.value = '';
                return;
            }

            const ok = await showConfirm(
                `将用 CSV 中的 ${parsedOrders.length} 条订单覆盖现有订单表，确认继续？\n（基金主表 myFunds 不会被改动）`,
                '导入订单 CSV',
                true
            );
            if (!ok) { fileInput.value = ''; return; }

            const normalized = normalizeTradeRecordList(parsedOrders, { source: 'csv_import' });
            await HistoryDB.replaceOrders(normalized);
            fileInput.value = '';
            showToast(`✅ 已用 CSV 覆盖订单表，共 ${normalized.length} 条`, 'success');
            await loadData();
        } catch (err) {
            console.error('[ImportTradeCSV] 失败:', err);
            await showAlert(`导入失败：${err.message || err}`);
            fileInput.value = '';
        }
    };
    reader.readAsText(file, 'utf-8');
}

function buildFundsExportData({ myFunds, lastUpdateDate, lastDayProfits, dailyProfitHistory, tradeHistoryDB, metadata = {} }) {
    return {
        exportTime: new Date().toLocaleString(),
        lastUpdateDate: lastUpdateDate || '',
        lastDayProfits: cloneData(lastDayProfits || {}),
        dailyProfitHistory: normalizeDailyProfitHistory(dailyProfitHistory),
        myFunds: cloneData(myFunds || {}),
        tradeHistoryDB: tradeHistoryDB || [],
        ...metadata
    };
}

async function exportFundsData() {
    const { myFunds, lastUpdateDate, lastDayProfits, dailyProfitHistory } = await storageHelper.getAll(['myFunds', 'lastUpdateDate', 'lastDayProfits', 'dailyProfitHistory']);
    const fundsData = myFunds || {};
    if (Object.keys(fundsData).length === 0) {
        showToast('暂无可导出的基金数据！', 'warning');
        return;
    }

    const { orders, states } = await HistoryDB.getAllExportData();

    const fundsDataWithNames = JSON.parse(JSON.stringify(fundsData));
    for (const code in fundsDataWithNames) {
        let foundName = fundsDataWithNames[code].name;

        if (!foundName || foundName === code) {
            const memoryItem = (typeof allFundsData !== 'undefined') ? allFundsData.find(f => f.code === code) : null;
            if (memoryItem && memoryItem.name && memoryItem.name !== code) {
                foundName = memoryItem.name;
            }
        }

        if (!foundName || foundName === code) {
            const latestOrder = orders.find(o => o.code === code && o.name && o.name !== code);
            const latestState = states.find(s => s.code === code && s.name && s.name !== code);
            if (latestOrder) foundName = latestOrder.name;
            else if (latestState) foundName = latestState.name;
        }

        const oldItem = fundsDataWithNames[code];
        fundsDataWithNames[code] = {
            name: foundName || code,
            ...oldItem
        };
    }

    const exportData = buildFundsExportData({
        myFunds: fundsDataWithNames,
        lastUpdateDate,
        lastDayProfits,
        dailyProfitHistory,
        tradeHistoryDB: orders,
        metadata: {
            fundDailyStateDB: states
        }
    });

    const fileName = `基金数据_${formatDateTimeForFile()}.json`;
    downloadJsonFile(exportData, fileName);
    showToast(`✅ 数据导出成功！文件名: ${fileName}`, 'success');
}

async function exportBackupFundsData() {
    const { backupFunds } = await storageHelper.getAll(['backupFunds']);
    if (!hasTodayBackup(backupFunds)) {
        showToast('今天还没有可导出的备份数据！', 'warning');
        return;
    }

    const exportData = buildFundsExportData({
        myFunds: backupFunds.myFunds,
        lastUpdateDate: backupFunds.lastUpdateDate,
        lastDayProfits: backupFunds.lastDayProfits,
        dailyProfitHistory: backupFunds.dailyProfitHistory,
        tradeHistoryDB: backupFunds.tradeHistoryDB || [],
        metadata: getBackupExportMetadata(backupFunds)
    });

    const backupDateTag = (backupFunds.backupDate || getToday()).replace(/-/g, '');
    const fileName = `基金备份数据_${backupDateTag}_${formatDateTimeForFile()}.json`;
    downloadJsonFile(exportData, fileName);
    showToast(`✅ 备份数据导出成功！文件名: ${fileName}`, 'success');
}

function migrateFund(fund, code = '') {
    const migratedFund = {
        ...fund,
        amount: parseFloat(fund.amount) || 0,
        holdProfit: parseFloat(fund.holdProfit) || 0,
        shares: parseFloat(fund.shares) || 0,
        yesterdayProfit: parseFloat(fund.yesterdayProfit) || 0,
        group: typeof fund.group === 'string' ? fund.group : '默认',
        dividendMode: fund.dividendMode || 'cash',
        savedPrevPrice: fund.savedPrevPrice ? parseFloat(fund.savedPrevPrice) : undefined,
        addedDate: fund.addedDate || null,
        holdDaysBase: Math.max(0, Math.floor(Number(fund.holdDaysBase) || 0)),
    };
    delete migratedFund.pendingAdjustments;
    syncAddedDateByPosition(migratedFund, getToday());
    return migratedFund;
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
                migratedFunds[code] = migrateFund(fund, code);
            }

            const dataToSave = { myFunds: migratedFunds };
            if (importData.lastUpdateDate) dataToSave.lastUpdateDate = importData.lastUpdateDate;
            if (importData.lastDayProfits) dataToSave.lastDayProfits = importData.lastDayProfits;
            if (importData.dailyProfitHistory) dataToSave.dailyProfitHistory = normalizeDailyProfitHistory(importData.dailyProfitHistory);
            dataToSave.lastSettlementDate = null;
            dataToSave.autoSettlementBlockedDate = null;
            dataToSave.notifications = [];
            dataToSave.notificationDate = getToday();
            notificationCenter.notifications = [];
            notificationCenter.updateBadge();

            if (Array.isArray(importData.tradeHistoryDB) || Object.values(importData.myFunds || {}).some(fund => Array.isArray(fund?.pendingAdjustments))) {
                try {
                    await HistoryDB.clearUserDataOnly();
                    const nextOrders = Array.isArray(importData.tradeHistoryDB)
                        ? importData.tradeHistoryDB
                            .filter(t => t && t.type !== 'daily_settlement')
                            .map(t => ({ ...t, status: t.status || 'confirmed' }))
                        : buildTradeOrdersFromFundsSnapshot(importData.myFunds || {}, 'import_pending_adjustment');
                    await HistoryDB.replaceOrders(nextOrders);
                    if (Array.isArray(importData.fundDailyStateDB)) {
                        await HistoryDB.replaceStateRecords(importData.fundDailyStateDB);
                    }
                    console.log('[Import] 成功从备份中恢复交易流水账');
                } catch (dbErr) {
                    console.error('[Import] 恢复 HistoryDB 失败:', dbErr);
                }
            }

            await storageHelper.setAll(dataToSave);
            showToast('✅ 外部数据导入成功，资产列表已更新', 'success', CONFIG.TOAST_NORMAL, true);
            fileInput.value = '';
            loadData();
        } catch (err) {
            await showAlert(`导入失败: ${err.message}`);
            fileInput.value = '';
        }
    };
    reader.readAsText(file);
}
