// ==================== 交易域：归一化 / 迁移 / 运行时状态 ====================

function buildConfirmedTransactionsState() {
    return {
        add: [],
        remove: [],
        dividend: [],
        dividend_reinvest: []
    };
}

var runtimeTradeOrdersMap = new Map();

function normalizeTradeAction(rawType) {
    const type = safeString(rawType, '').toLowerCase();
    if (type === 'buy') return 'add';
    if (type === 'sell') return 'remove';
    if (['add', '加仓', '买入', '申购', '增持'].includes(type)) return 'add';
    if (['remove', '减仓', '卖出', '赎回', '清仓', '减持'].includes(type)) return 'remove';
    if (['dividend', '现金分红', '分红'].includes(type)) return 'dividend';
    if (['dividend_reinvest', '红利再投', '分红再投'].includes(type)) return 'dividend_reinvest';
    if (['initial', '建仓', '初始建仓'].includes(type)) return 'initial';
    return type;
}

function inferTradeActionFromRemark(record = {}) {
    const remark = safeString(record.remark, '');
    if (!remark) return '';
    if (remark.includes('加仓') || remark.includes('买入') || remark.includes('申购') || remark.includes('增持')) return 'add';
    if (remark.includes('减仓') || remark.includes('卖出') || remark.includes('赎回') || remark.includes('减持')) return 'remove';
    if (remark.includes('清仓')) return 'remove';
    if (remark.includes('红利再投') || remark.includes('分红再投')) return 'dividend_reinvest';
    if (remark.includes('分红')) return 'dividend';
    if (remark.includes('建仓') || remark.includes('初始化') || remark.includes('添加资产')) return 'initial';
    return '';
}

function inferTradeActionByShape(record = {}) {
    const orderDate = normalizePerfDate(record.orderDate || record.date || '');
    const targetDate = normalizePerfDate(record.targetDate || record.confirmDate || '');
    const confirmedDate = normalizePerfDate(record.confirmedDate || record.confirmDate || '');
    const amount = safeFloat(record.amount, 0);
    const shares = safeFloat(record.shares, 0);
    const confirmedShares = safeFloat(record.confirmedShares, 0);
    const dividendAmount = safeFloat(record.dividendAmount, 0);
    const perShare = safeFloat(record.perShare, 0);
    const dividendNavPrice = safeFloat(record.dividendNavPrice, 0);
    const isClear = Boolean(record.isClear);
    const hasDividendFields = Boolean(record.dividendDate) || dividendAmount > 0 || perShare > 0 || dividendNavPrice > 0;
    const hasLifecycleDates = Boolean(targetDate || confirmedDate);

    if (hasDividendFields) {
        return inferTradeActionFromRemark(record) === 'dividend_reinvest'
            ? 'dividend_reinvest'
            : 'dividend';
    }

    if (isClear) return 'remove';

    if (hasLifecycleDates) {
        if (amount > 0 && (confirmedShares > 0 || shares <= 0)) return 'add';
        if (shares > 0) return 'remove';
    }

    if (amount > 0 && shares <= 0) return 'add';
    if (shares > 0 && amount <= 0) return 'remove';

    const looksLikeInitial = (
        shares > 0
        && amount > 0
        && confirmedShares <= 0
        && !hasLifecycleDates
        && Boolean(orderDate)
    );
    if (looksLikeInitial) return 'initial';

    return '';
}

function inferTradeActionFromRecord(record = {}) {
    const raw = safeString(
        record.type
        || record.tradeType
        || record.action
        || record.opType
        || record.operation
        || record.kind
        || record.txnType
        || '',
        ''
    );
    const direct = normalizeTradeAction(raw);
    if (direct) return direct;
    return inferTradeActionFromRemark(record) || inferTradeActionByShape(record);
}

function getTradeRecordDate(record) {
    return normalizePerfDate(
        record?.confirmedDate
        || record?.confirmDate
        || record?.targetDate
        || record?.date
        || record?.orderDate
        || ''
    );
}

function getTradeMarkerDate(record) {
    const type = getTradeDisplayType(record);
    if (type === 'initial' || type === 'add' || type === 'remove' || type === 'clear') {
        return normalizePerfDate(
            record?.effectiveDate
            || record?.orderEffectiveDate
            ||
            record?.orderDate
            || record?.date
            || record?.targetDate
            || record?.confirmedDate
            || record?.confirmDate
            || ''
        );
    }
    if (isDividendType(type)) {
        return normalizePerfDate(
            record?.dividendDate
            || record?.targetDate
            || record?.confirmedDate
            || record?.date
            || record?.orderDate
            || ''
        );
    }
    return getTradeRecordDate(record);
}

function getDefaultLifecycleEffectiveDate(type, sourceName, orderDate, date, targetDate, confirmedDate) {
    const normalizedType = normalizeTradeAction(type);
    if (!['initial', 'add', 'remove'].includes(normalizedType)) {
        return '';
    }

    const normalizedSource = safeString(sourceName, '');
    if (['manual', 'manual_backfill', 'migration_initial'].includes(normalizedSource)) {
        return normalizePerfDate(orderDate || date || targetDate || confirmedDate || '');
    }

    return normalizePerfDate(targetDate || confirmedDate || orderDate || date || '');
}

function normalizeTradeRecord(record, fallback = {}) {
    const source = record && typeof record === 'object' ? record : {};
    const inferredType = inferTradeActionFromRecord(source);
    const type = inferredType || normalizeTradeAction(source.type || fallback.type);
    const sourceName = safeString(source.source, fallback.source || 'manual');
    const orderDate = normalizePerfDate(source.orderDate || fallback.orderDate || source.date || '');
    const targetDate = normalizePerfDate(source.targetDate || fallback.targetDate || source.confirmDate || '');
    const confirmedDate = normalizePerfDate(source.confirmedDate || source.confirmDate || fallback.confirmedDate || '');
    const effectiveDate = normalizePerfDate(
        source.effectiveDate
        || source.orderEffectiveDate
        || fallback.effectiveDate
        || fallback.orderEffectiveDate
        || ''
    );
    const normalized = {
        ...source,
        code: safeString(source.code, fallback.code || ''),
        name: safeString(source.name, fallback.name || ''),
        group: safeString(source.group, fallback.group || '默认'),
        type,
        orderDate,
        targetDate,
        confirmedDate,
        date: normalizePerfDate(source.date || fallback.date || orderDate || targetDate || confirmedDate),
        amount: safeFloat(source.amount, 0),
        shares: safeFloat(source.shares, 0),
        feeRate: safeFloat(source.feeRate, 0),
        fee: safeFloat(source.fee, 0),
        dividendAmount: safeFloat(source.dividendAmount, 0),
        perShare: safeFloat(source.perShare, 0),
        confirmedShares: safeFloat(source.confirmedShares, 0),
        confirmedPrice: safeFloat(source.confirmedPrice, 0),
        orderNav: safeFloat(source.orderNav, 0),
        dividendNavPrice: safeFloat(source.dividendNavPrice, 0),
        isClear: Boolean(source.isClear),
        status: safeString(source.status, confirmedDate ? 'confirmed' : 'pending'),
        source: sourceName,
        orderId: source.orderId || source.id || fallback.orderId || null
    };
    normalized.effectiveDate = effectiveDate || getDefaultLifecycleEffectiveDate(
        type,
        sourceName,
        orderDate,
        normalized.date,
        targetDate,
        confirmedDate
    ) || getTradeRecordDate(normalized);
    return normalized;
}

function normalizeTradeRecordList(list, fallback = {}) {
    return safeArray(list, []).map(item => normalizeTradeRecord(item, fallback));
}

function isClearTradeRecord(record) {
    const normalized = normalizeTradeRecord(record);
    return normalizeTradeAction(normalized.type) === 'remove'
        && Boolean(normalized.isClear || safeString(normalized.remark, '').includes('清仓'));
}

function getTradeDisplayType(record) {
    const normalizedType = normalizeTradeAction(record?.type || '');
    if (normalizedType === 'remove' && isClearTradeRecord(record)) {
        return 'clear';
    }
    return normalizedType;
}

function getTradeDisplayLabel(record, mode = 'full') {
    const displayType = getTradeDisplayType(record);
    if (mode === 'short') {
        if (displayType === 'initial') return '建';
        if (displayType === 'add') return '加';
        if (displayType === 'clear') return '清';
        if (displayType === 'remove') return '减';
        if (displayType === 'dividend') return '分';
        if (displayType === 'dividend_reinvest') return '投';
        return '记';
    }

    if (displayType === 'initial') return '建仓';
    if (displayType === 'add') return '加仓';
    if (displayType === 'clear') return '清仓';
    if (displayType === 'remove') return '减仓';
    if (displayType === 'dividend') return '现金分红';
    if (displayType === 'dividend_reinvest') return '红利再投';
    return '未知类型';
}

function getTradeDisplayColor(record) {
    const displayType = getTradeDisplayType(record);
    if (displayType === 'initial') return '#ff4d4f';
    if (displayType === 'add') return '#ff4d4f';
    if (displayType === 'clear') return '#faad14';
    if (displayType === 'remove') return '#52c41a';
    if (displayType === 'dividend') return '#1890ff';
    if (displayType === 'dividend_reinvest') return '#722ed1';
    return '#8c8c8c';
}

function getTradeExecutionNav(record) {
    return safeFloat(
        record?.confirmedPrice
        || record?.dividendNavPrice
        || record?.orderNav
        || record?.price,
        0
    );
}

function getTradeShareEffect(record) {
    const normalized = normalizeTradeRecord(record);
    const displayType = getTradeDisplayType(normalized);
    const navPrice = getTradeExecutionNav(normalized);
    const feeRate = safeFloat(normalized.feeRate, 0) / 100;

    if (displayType === 'initial') {
        if (normalized.shares > 0) return round6(normalized.shares);
        if (normalized.amount > 0 && navPrice > 0) return round6((normalized.amount * (1 - feeRate)) / navPrice);
        return 0;
    }

    if (displayType === 'add') {
        if (normalized.confirmedShares > 0) return round6(normalized.confirmedShares);
        if (normalized.shares > 0) return round6(normalized.shares);
        if (normalized.amount > 0 && navPrice > 0) {
            return round6((normalized.amount * (1 - feeRate)) / navPrice);
        }
        return 0;
    }

    if (displayType === 'remove' || displayType === 'clear') {
        if (normalized.confirmedShares > 0) return -round6(normalized.confirmedShares);
        if (normalized.shares > 0) return -round6(normalized.shares);
        if (normalized.amount > 0 && navPrice > 0) return -round6(normalized.amount / navPrice);
        return 0;
    }

    if (displayType === 'dividend_reinvest') {
        if (normalized.confirmedShares > 0) return round6(normalized.confirmedShares);
        if (normalized.shares > 0) return round6(normalized.shares);
        if (normalized.dividendAmount > 0 && navPrice > 0) {
            return round6(normalized.dividendAmount / navPrice);
        }
        return 0;
    }

    return 0;
}

function isPositionBuildingTradeRecord(record) {
    const displayType = getTradeDisplayType(record);
    return displayType === 'initial' || displayType === 'add';
}

function hasPositionBuildOrder(orders = []) {
    return normalizeTradeRecordList(orders, { source: 'order' })
        .some(order => isPositionBuildingTradeRecord(order));
}

function compareTradeExecutionOrder(left, right) {
    const leftDate = getTradeMarkerDate(left) || getTradeRecordDate(left) || '';
    const rightDate = getTradeMarkerDate(right) || getTradeRecordDate(right) || '';
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);

    const leftTime = safeInteger(left?.createTime, 0);
    const rightTime = safeInteger(right?.createTime, 0);
    if (leftTime !== rightTime) return leftTime - rightTime;

    const leftId = safeInteger(left?.id || left?.orderId, 0);
    const rightId = safeInteger(right?.id || right?.orderId, 0);
    return leftId - rightId;
}

function calculatePositionSnapshotFromTradeOrders(orders = []) {
    const confirmedOrders = normalizeTradeRecordList(orders, { source: 'order' })
        .filter(order => order.status === 'confirmed')
        .sort(compareTradeExecutionOrder);

    let shares = 0;
    let addedDate = '';

    confirmedOrders.forEach(order => {
        const displayType = getTradeDisplayType(order);
        const tradeDate = getTradeMarkerDate(order) || getTradeRecordDate(order) || '';
        const shareEffect = getTradeShareEffect(order);

        if (displayType === 'initial') {
            shares = Math.max(0, round6(Math.abs(shareEffect)));
            addedDate = shares > 0 ? tradeDate : '';
            return;
        }

        if (displayType === 'add' || displayType === 'dividend_reinvest') {
            if (shares <= 0 && shareEffect > 0) {
                addedDate = tradeDate || addedDate;
            }
            shares = Math.max(0, round6(shares + shareEffect));
            if (shares > 0 && !addedDate) {
                addedDate = tradeDate || '';
            }
            return;
        }

        if (displayType === 'remove' || displayType === 'clear') {
            shares = Math.max(0, round6(shares + shareEffect));
            if (displayType === 'clear' || shares <= 0.0000001) {
                shares = 0;
                addedDate = '';
            }
        }
    });

    return {
        orders: confirmedOrders,
        shares: round6(shares),
        addedDate: addedDate || ''
    };
}

function calculatePositionSnapshotFromTradeOrdersAtDate(orders = [], asOfDate = '') {
    const normalizedAsOfDate = normalizePerfDate(asOfDate || '');
    const filteredOrders = normalizeTradeRecordList(orders, { source: 'order' })
        .filter(order => {
            if (order.status !== 'confirmed') return false;
            if (!normalizedAsOfDate) return true;
            const tradeDate = getTradeMarkerDate(order) || getTradeRecordDate(order) || '';
            return !!tradeDate && tradeDate <= normalizedAsOfDate;
        });
    return calculatePositionSnapshotFromTradeOrders(filteredOrders);
}

function buildTradeRecordKey(record) {
    const normalized = normalizeTradeRecord(record);
    if (isDividendType(normalized.type)) {
        const settlementDate = normalized.targetDate || normalized.confirmedDate || normalized.date || normalized.orderDate;
        const amount = safeFloat(
            Number(normalized.dividendAmount) > 0 ? normalized.dividendAmount : normalized.amount,
            0
        );
        return `trade:${normalized.code}|${normalized.type}|dividend|${settlementDate}|${amount}|${safeFloat(normalized.perShare, 0)}`;
    }
    return `trade:${normalized.code}|${normalized.type}|${normalized.orderDate}|${normalized.targetDate}|${normalized.amount}|${normalized.shares}|${normalized.dividendAmount}|${normalized.isClear ? 1 : 0}`;
}

function mergeTradeRecords(existing, incoming) {
    const left = normalizeTradeRecord(existing);
    const right = normalizeTradeRecord(incoming);
    const leftType = normalizeTradeAction(left.type);
    const rightType = normalizeTradeAction(right.type);
    const leftSource = safeString(left.source, '');
    const rightSource = safeString(right.source, '');
    const shouldPreferIncomingInitial = (
        leftType === 'initial'
        && rightType === 'initial'
        && leftSource === 'migration_initial'
        && (rightSource === 'manual_backfill' || rightSource === 'manual')
    );
    const status = left.status === 'confirmed' || right.status === 'confirmed'
        ? 'confirmed'
        : (right.status || left.status || 'pending');

    if (shouldPreferIncomingInitial) {
        return normalizeTradeRecord({
            ...left,
            ...right,
            status,
            orderId: right.orderId || left.orderId || null,
            code: right.code || left.code,
            name: right.name || left.name,
            group: right.group || left.group,
            type: right.type || left.type,
            orderDate: right.orderDate || left.orderDate,
            targetDate: right.targetDate || left.targetDate,
            confirmedDate: right.confirmedDate || left.confirmedDate,
            date: right.date || left.date,
            amount: safeFloat(right.amount, safeFloat(left.amount, 0)),
            shares: safeFloat(right.shares, safeFloat(left.shares, 0)),
            feeRate: safeFloat(right.feeRate, safeFloat(left.feeRate, 0)),
            fee: safeFloat(right.fee, safeFloat(left.fee, 0)),
            dividendAmount: safeFloat(right.dividendAmount, safeFloat(left.dividendAmount, 0)),
            perShare: safeFloat(right.perShare, safeFloat(left.perShare, 0)),
            confirmedShares: safeFloat(right.confirmedShares, safeFloat(left.confirmedShares, 0)),
            confirmedPrice: safeFloat(right.confirmedPrice, safeFloat(left.confirmedPrice, 0)),
            orderNav: safeFloat(right.orderNav, safeFloat(left.orderNav, 0)),
            dividendNavPrice: safeFloat(right.dividendNavPrice, safeFloat(left.dividendNavPrice, 0)),
            isClear: Boolean(right.isClear || left.isClear),
            remark: right.remark || left.remark || '',
            source: right.source || left.source || 'manual'
        }, { source: right.source || left.source || 'manual' });
    }

    return normalizeTradeRecord({
        ...left,
        ...right,
        status,
        orderId: right.orderId || left.orderId || null,
        code: right.code || left.code,
        name: right.name || left.name,
        group: right.group || left.group,
        type: right.type || left.type,
        orderDate: right.orderDate || left.orderDate,
        targetDate: right.targetDate || left.targetDate,
        confirmedDate: right.confirmedDate || left.confirmedDate,
        date: right.date || left.date,
        amount: safeFloat(right.amount, safeFloat(left.amount, 0)),
        shares: safeFloat(right.shares, safeFloat(left.shares, 0)),
        feeRate: safeFloat(right.feeRate, safeFloat(left.feeRate, 0)),
        fee: safeFloat(right.fee, safeFloat(left.fee, 0)),
        dividendAmount: safeFloat(right.dividendAmount, safeFloat(left.dividendAmount, 0)),
        perShare: safeFloat(right.perShare, safeFloat(left.perShare, 0)),
        confirmedShares: safeFloat(right.confirmedShares, safeFloat(left.confirmedShares, 0)),
        confirmedPrice: safeFloat(right.confirmedPrice, safeFloat(left.confirmedPrice, 0)),
        orderNav: safeFloat(right.orderNav, safeFloat(left.orderNav, 0)),
        dividendNavPrice: safeFloat(right.dividendNavPrice, safeFloat(left.dividendNavPrice, 0)),
        isClear: Boolean(right.isClear || left.isClear),
        remark: right.remark || left.remark || '',
        source: right.source || left.source || 'manual'
    }, { source: right.source || left.source || 'manual' });
}

function mergeDuplicateTradeRecords(records) {
    const map = new Map();
    normalizeTradeRecordList(records).forEach(record => {
        const key = buildTradeRecordKey(record);
        const existing = map.get(key);
        if (!existing) {
            map.set(key, record);
            return;
        }
        map.set(key, mergeTradeRecords(existing, record));
    });
    return [...map.values()];
}

function buildInitialTradeRecordFromFund(code, fund = {}) {
    if (!code || !fund) return null;
    const shares = safeFloat(fund.shares, 0);
    const amount = round2(safeFloat(fund.amount, 0) - safeFloat(fund.holdProfit, 0));
    const addedDate = normalizePerfDate(fund.addedDate || '');
    if (!(shares > 0) || !(amount >= 0) || !addedDate) return null;

    return normalizeTradeRecord({
        code,
        name: safeString(fund.name, code),
        group: safeString(fund.group, '默认'),
        type: 'initial',
        date: addedDate,
        orderDate: addedDate,
        targetDate: addedDate,
        confirmedDate: addedDate,
        effectiveDate: addedDate,
        shares,
        amount,
        feeRate: 0,
        fee: 0,
        confirmedPrice: shares > 0 ? round4(amount / shares) : 0,
        orderNav: shares > 0 ? round4(amount / shares) : 0,
        price: shares > 0 ? round4(amount / shares) : 0,
        remark: '迁移补齐初始建仓',
        status: 'confirmed',
        source: 'migration_initial'
    }, { source: 'migration_initial' });
}

function fundHasPosition(fund = {}) {
    return safeFloat(fund?.amount, 0) > 0 || safeFloat(fund?.shares, 0) > 0;
}

function buildTradeOrdersFromFundsSnapshot(funds = {}, sourceLabel = 'snapshot_pending_adjustment') {
    const orderPool = [];

    for (const [code, fund] of Object.entries(funds || {})) {
        const fallback = {
            code,
            name: fund?.name || code,
            group: fund?.group || '默认',
            source: sourceLabel
        };

        normalizeTradeRecordList(fund?.pendingAdjustments, fallback).forEach(adj => {
            orderPool.push({
                ...adj,
                code,
                name: fund?.name || adj.name || code,
                group: fund?.group || adj.group || '默认',
                source: sourceLabel
            });
        });

        const hasBuildOrder = orderPool.some(order => {
            const normalized = normalizeTradeRecord(order, { code, source: 'order' });
            return normalized.code === code && isPositionBuildingTradeRecord(normalized);
        });
        if (!hasBuildOrder) {
            const initialOrder = buildInitialTradeRecordFromFund(code, fund);
            if (initialOrder) {
                orderPool.push(initialOrder);
            }
        }
    }

    const dedupedOrders = mergeDuplicateTradeRecords(orderPool);
    const lifecycleDedupedOrders = [];
    dedupedOrders.forEach(order => {
        const existing = lifecycleDedupedOrders.find(item => isSameTradeLifecycleOrder(item, order));
        if (!existing) {
            lifecycleDedupedOrders.push(order);
            return;
        }
        const merged = mergeTradeRecords(existing, order);
        const targetIndex = lifecycleDedupedOrders.indexOf(existing);
        lifecycleDedupedOrders[targetIndex] = merged;
    });
    return lifecycleDedupedOrders;
}

function isSameTradeLifecycleOrder(left, right) {
    const a = normalizeTradeRecord(left);
    const b = normalizeTradeRecord(right);
    if (!a.code || !b.code || a.code !== b.code) return false;
    if (!a.type || !b.type || a.type !== b.type) return false;

    const aOrderDate = a.orderDate || a.date || '';
    const bOrderDate = b.orderDate || b.date || '';
    const aTargetDate = a.targetDate || a.confirmedDate || '';
    const bTargetDate = b.targetDate || b.confirmedDate || '';

    if (aOrderDate !== bOrderDate) return false;
    if (aTargetDate !== bTargetDate) return false;

    if (a.type === 'remove') {
        return Math.abs(safeFloat(a.shares, 0) - safeFloat(b.shares, 0)) <= 0.000001;
    }
    if (a.type === 'add') {
        return Math.abs(safeFloat(a.amount, 0) - safeFloat(b.amount, 0)) <= 0.01;
    }
    if (isDividendType(a.type)) {
        const aDividendDate = normalizePerfDate(a.dividendDate || '');
        const bDividendDate = normalizePerfDate(b.dividendDate || '');
        if (aDividendDate && bDividendDate && aDividendDate !== bDividendDate) return false;
        const amountDiff = Math.abs(
            safeFloat(a.dividendAmount || a.amount, 0) - safeFloat(b.dividendAmount || b.amount, 0)
        );
        const perShareDiff = Math.abs(safeFloat(a.perShare, 0) - safeFloat(b.perShare, 0));
        return amountDiff <= 0.01 && perShareDiff <= 0.00001;
    }
    if (a.type === 'initial') {
        return true;
    }
    return Math.abs(safeFloat(a.amount, 0) - safeFloat(b.amount, 0)) <= 0.01
        && Math.abs(safeFloat(a.shares, 0) - safeFloat(b.shares, 0)) <= 0.000001;
}

async function findMatchingTradeOrderId(code, orderLike, preferredStatus = '') {
    if (!code) return null;
    const orders = await HistoryDB.getOrders(code).catch(() => []);
    const matched = orders.find(order => {
        if (preferredStatus && order.status !== preferredStatus) return false;
        return isSameTradeLifecycleOrder(order, orderLike);
    });
    return matched?.id || matched?.orderId || null;
}

async function cleanupDuplicateTradeLifecycleOrders(code, referenceOrder, keepId) {
    if (!code || !keepId) return;
    const orders = await HistoryDB.getOrders(code).catch(() => []);
    const duplicates = orders.filter(order => {
        const id = order.id || order.orderId || null;
        if (!id || id === keepId) return false;
        return isSameTradeLifecycleOrder(order, referenceOrder);
    });

    const deleteIds = duplicates.map(d => d.id || d.orderId || null).filter(Boolean);
    await Promise.all(deleteIds.map(id => HistoryDB.deleteOrder(id).catch(() => {})));
}

async function cleanupInitialOrdersForCode(code, keepId = null) {
    if (!code) return;
    const orders = await HistoryDB.getOrders(code).catch(() => []);
    const initialOrders = orders.filter(order => normalizeTradeAction(order.type) === 'initial');
    if (initialOrders.length <= 1) return;

    let preferred = initialOrders[0];
    for (let i = 1; i < initialOrders.length; i++) {
        preferred = pickPreferredInitialTradeOrder(preferred, initialOrders[i]);
    }

    let preferredId = preferred.id || preferred.orderId || null;
    const keepOrder = keepId
        ? initialOrders.find(order => (order.id || order.orderId || null) === keepId)
        : null;
    const shouldKeepRequestedOrder = keepOrder && preferredId === keepId;

    if (shouldKeepRequestedOrder) {
        const keptOrder = initialOrders.find(order => (order.id || order.orderId || null) === keepId);
        if (keptOrder) {
            preferred = mergeTradeRecords(preferred, keptOrder);
            preferredId = keepId;
            await HistoryDB.updateOrder(keepId, { ...preferred, id: keepId }).catch(() => {});
        }
    } else if (preferredId) {
        await HistoryDB.updateOrder(preferredId, { ...preferred, id: preferredId }).catch(() => {});
    }

    const deleteExtraIds = initialOrders
        .map(o => o.id || o.orderId || null)
        .filter(id => id && id !== preferredId);
    await Promise.all(deleteExtraIds.map(id => HistoryDB.deleteOrder(id).catch(() => {})));

    const current = safeArray(runtimeTradeOrdersMap.get(code), []);
    const next = current.filter(order => normalizeTradeAction(order.type) !== 'initial');
    next.push(normalizeTradeRecord({ ...preferred, id: preferredId, orderId: preferredId }, { source: 'order' }));
    runtimeTradeOrdersMap.set(code, normalizeTradeRecordList(next, { source: 'order' }));
}

async function syncFundAddedDateFromTradeOrders(code) {
    if (!code) return;
    const [orders, { myFunds }] = await Promise.all([
        HistoryDB.getOrders(code).catch(() => []),
        storageHelper.getAll(['myFunds'])
    ]);
    const snapshot = calculatePositionSnapshotFromTradeOrders(orders);
    const funds = myFunds || {};
    const fund = funds[code];
    if (!fund) return;

    const nextAddedDate = normalizePerfDate(snapshot.addedDate || '');
    const currentAddedDate = normalizePerfDate(fund.addedDate || '');
    if (!nextAddedDate && fundHasPosition(fund)) {
        if (currentAddedDate) {
            fund.addedDate = null;
            await storageHelper.setAll({ myFunds: funds });
        }
        return;
    }

    const shouldClearAddedDate = !nextAddedDate && !fundHasPosition(fund);
    if (!shouldClearAddedDate && (!nextAddedDate || nextAddedDate === currentAddedDate)) return;
    if (shouldClearAddedDate && !currentAddedDate) return;

    fund.addedDate = nextAddedDate || null;
    await storageHelper.setAll({ myFunds: funds });
}

function pickPreferredInitialTradeOrder(left, right) {
    const a = normalizeTradeRecord(left, { source: 'order' });
    const b = normalizeTradeRecord(right, { source: 'order' });
    const priorityOf = (order) => {
        const source = safeString(order.source, '');
        if (source === 'manual_backfill') return 4;
        if (source === 'manual') return 3;
        if (source === 'migration_initial') return 1;
        return 2;
    };

    const leftPriority = priorityOf(a);
    const rightPriority = priorityOf(b);
    if (leftPriority !== rightPriority) {
        return leftPriority > rightPriority ? a : b;
    }

    const leftHasNav = getTradeExecutionNav(a) > 0;
    const rightHasNav = getTradeExecutionNav(b) > 0;
    if (leftHasNav !== rightHasNav) {
        return rightHasNav ? b : a;
    }

    const leftCreateTime = safeInteger(a.createTime, 0);
    const rightCreateTime = safeInteger(b.createTime, 0);
    if (leftCreateTime !== rightCreateTime) {
        return rightCreateTime >= leftCreateTime ? b : a;
    }

    const leftId = safeInteger(a.id || a.orderId, 0);
    const rightId = safeInteger(b.id || b.orderId, 0);
    return rightId >= leftId ? b : a;
}

function dedupeInitialOrdersByCode(orders = []) {
    const byCode = new Map();
    const result = [];

    normalizeTradeRecordList(orders, { source: 'order' }).forEach(order => {
        if (normalizeTradeAction(order.type) !== 'initial' || !order.code) {
            result.push(order);
            return;
        }

        const existing = byCode.get(order.code);
        if (!existing) {
            byCode.set(order.code, order);
            return;
        }

        byCode.set(order.code, mergeTradeRecords(existing, pickPreferredInitialTradeOrder(existing, order)));
    });

    byCode.forEach(order => result.push(order));
    return result;
}

async function migrateTradeDataOnce() {
    const currentVersion = '16';
    const storedVersion = await storageHelper.get(CONFIG.TRADE_DATA_MIGRATION_STORAGE_KEY, '');
    if (storedVersion === currentVersion) {
        return false;
    }

    const { myFunds, backupFunds } = await storageHelper.getAll(['myFunds', 'backupFunds']);
    const funds = myFunds || {};
    const { orders } = await HistoryDB.getAllExportData();
    const orderPool = Array.isArray(orders) ? [...orders] : [];
    let fundsChanged = false;
    orderPool.push(...buildTradeOrdersFromFundsSnapshot(backupFunds?.myFunds || {}, 'backup_pending_adjustment'));
    orderPool.push(...buildTradeOrdersFromFundsSnapshot(funds, 'pending_adjustment'));

    const filteredOrders = orderPool.filter(order => {
        const normalized = normalizeTradeRecord(order, { source: 'order' });
        if (normalizeTradeAction(normalized.type) !== 'initial') return true;
        return !safeString(normalized.remark, '').includes('迁移生成初始建仓');
    });

    const dedupedOrders = mergeDuplicateTradeRecords(filteredOrders);
    const initialDedupeOrders = dedupeInitialOrdersByCode(dedupedOrders);
    const lifecycleDedupedOrders = [];
    initialDedupeOrders.forEach(order => {
        const existing = lifecycleDedupedOrders.find(item => isSameTradeLifecycleOrder(item, order));
        if (!existing) {
            lifecycleDedupedOrders.push(order);
            return;
        }
        const merged = mergeTradeRecords(existing, order);
        const targetIndex = lifecycleDedupedOrders.indexOf(existing);
        lifecycleDedupedOrders[targetIndex] = merged;
    });
    const correctedOrders = [];
    for (const order of lifecycleDedupedOrders) {
        const normalized = normalizeTradeRecord(order, { source: 'order' });
        const displayType = getTradeDisplayType(normalized);
        if (!['add', 'remove', 'clear'].includes(displayType) || normalized.status !== 'confirmed') {
            correctedOrders.push(normalized);
            continue;
        }

        const executionDate = normalizePerfDate(
            normalized.effectiveDate
            || normalized.orderEffectiveDate
            || normalized.orderDate
            || normalized.date
            || ''
        );
        const orderDate = normalizePerfDate(normalized.orderDate || normalized.date || '');
        const confirmedDate = normalizePerfDate(normalized.confirmedDate || '');
        const orderNav = safeFloat(normalized.orderNav, 0);
        const confirmedPrice = safeFloat(normalized.confirmedPrice || normalized.price, 0);
        const hasSuspiciousNavGap = orderDate
            && confirmedDate
            && orderDate !== confirmedDate
            && orderNav > 0
            && confirmedPrice > 0
            && Math.abs(orderNav - confirmedPrice) > 0.0001;
        let resolvedExecutionDate = executionDate;
        if (hasSuspiciousNavGap && (!resolvedExecutionDate || resolvedExecutionDate === confirmedDate)) {
            resolvedExecutionDate = orderDate;
        }
        if (!resolvedExecutionDate || !confirmedDate || (resolvedExecutionDate === confirmedDate && !hasSuspiciousNavGap)) {
            correctedOrders.push(normalized);
            continue;
        }

        const executionRecord = await HistoryDB.get(normalized.code, resolvedExecutionDate).catch(() => null);
        const executionNav = safeFloat(executionRecord?.price, 0) || (hasSuspiciousNavGap ? orderNav : 0);
        if (!(executionNav > 0)) {
            correctedOrders.push(normalized);
            continue;
        }

        const nextOrder = {
            ...normalized,
            effectiveDate: resolvedExecutionDate,
            orderNav: executionNav,
            confirmedPrice: executionNav,
            price: executionNav
        };
        if (displayType === 'add' && normalized.amount > 0) {
            const feeRate = safeFloat(normalized.feeRate, 0) / 100;
            nextOrder.confirmedShares = round6((normalized.amount * (1 - feeRate)) / executionNav);
        } else if ((displayType === 'remove' || displayType === 'clear') && normalized.shares > 0) {
            nextOrder.amount = round2(normalized.shares * executionNav);
            nextOrder.confirmedShares = normalized.shares;
        }
        correctedOrders.push(nextOrder);
    }

    await HistoryDB.replaceOrders(correctedOrders);

    for (const [code, fund] of Object.entries(funds)) {
        if (!fund) continue;
        const codeOrders = correctedOrders.filter(order => order.code === code);
        const snapshot = calculatePositionSnapshotFromTradeOrders(codeOrders);
        const derivedAddedDate = normalizePerfDate(snapshot.addedDate || '');
        const currentAddedDate = normalizePerfDate(fund.addedDate || '');
        const nextAddedDate = derivedAddedDate || '';
        const normalizedNextAddedDate = nextAddedDate || null;
        const normalizedCurrentAddedDate = currentAddedDate || null;
        if (normalizedNextAddedDate !== normalizedCurrentAddedDate) {
            fund.addedDate = normalizedNextAddedDate;
            fundsChanged = true;
        }
    }

    for (const [code, fund] of Object.entries(funds)) {
        if (fund && Object.prototype.hasOwnProperty.call(fund, 'pendingAdjustments')) {
            delete fund.pendingAdjustments;
            fundsChanged = true;
        }
    }

    if (fundsChanged) {
        await storageHelper.setAll({ myFunds: funds });
    }
    await storageHelper.set(CONFIG.TRADE_DATA_MIGRATION_STORAGE_KEY, currentVersion);
    return true;
}

function buildAutoDividendNotification(code, dividend, totalDividend, arrivalDate, isArrived) {
    if (isArrived) {
        return {
            message: `检测到 ${code} 分红：${dividend.date}，每份${dividend.perShare}元，共${totalDividend}元（已到账）`,
            type: 'success'
        };
    }
    return {
        message: `检测到 ${code} 分红：${dividend.date}，每份${dividend.perShare}元，共${totalDividend}元，预计${arrivalDate}到账`,
        type: 'info'
    };
}

function syncAutoDetectedDividendEntry(existingAdj, dividend, todayStr, shares = 0) {
    if (!existingAdj || !dividend || !dividend.date) return false;

    const nextArrivalDate = calculateDividendArrivalDate(dividend.date);
    const isArrived = nextArrivalDate < todayStr;
    let changed = false;

    if (existingAdj.dividendDate !== dividend.date) {
        existingAdj.dividendDate = dividend.date;
        changed = true;
    }
    if (existingAdj.perShare !== dividend.perShare) {
        existingAdj.perShare = dividend.perShare;
        changed = true;
    }
    if (dividend.navPrice && existingAdj.dividendNavPrice !== dividend.navPrice) {
        existingAdj.dividendNavPrice = dividend.navPrice;
        changed = true;
    }
    if (existingAdj.targetDate !== nextArrivalDate) {
        existingAdj.targetDate = nextArrivalDate;
        changed = true;
    }
    if (shares > 0) {
        const nextDividendAmount = round2(shares * dividend.perShare);
        if (existingAdj.dividendAmount !== nextDividendAmount) {
            existingAdj.dividendAmount = nextDividendAmount;
            changed = true;
        }
    }
    if (existingAdj.inferredBySettlement) {
        existingAdj.inferredBySettlement = false;
        changed = true;
    }

    if (existingAdj.status !== 'confirmed' && isArrived) {
        existingAdj.status = 'confirmed';
        existingAdj.confirmedDate = todayStr;
        changed = true;
    }

    return changed;
}

async function addAutoDetectedDividend(item, code, dividend, todayStr, inferredBySettlement = false) {
    const totalDividend = round2(item.shares * dividend.perShare);
    const arrivalDate = calculateDividendArrivalDate(dividend.date);
    const isArrived = arrivalDate < todayStr;

    const payload = normalizeTradeRecord({
        type: 'dividend',
        date: dividend.date,
        dividendAmount: totalDividend,
        perShare: dividend.perShare,
        dividendNavPrice: dividend.navPrice,
        dividendDate: dividend.date,
        targetDate: arrivalDate,
        orderDate: dividend.date,
        status: isArrived ? 'confirmed' : 'pending',
        confirmedDate: isArrived ? arrivalDate : undefined,
        autoDetected: true,
        inferredBySettlement: inferredBySettlement === true
    }, { code, name: item.name, group: item.group, source: 'auto_dividend' });

    await persistTradeOrder(payload, payload);
    return buildAutoDividendNotification(code, dividend, totalDividend, arrivalDate, isArrived);
}

function isSameRecordedDividendEvent(record, dividend, expectedAmount = 0) {
    if (!record || !dividend || !dividend.date || !isDividendType(record.type)) return false;

    const normalized = normalizeTradeRecord(record);
    const expectedArrivalDate = calculateDividendArrivalDate(dividend.date);
    const normalizedDividendDate = normalizePerfDate(dividend.date);
    const recordDividendDate = normalizePerfDate(normalized.dividendDate || '');
    const recordTargetDate = normalizePerfDate(normalized.targetDate || '');
    const recordOrderDate = normalizePerfDate(normalized.orderDate || '');
    const recordDate = normalizePerfDate(normalized.date || '');

    if (recordDividendDate && recordDividendDate === normalizedDividendDate) {
        return true;
    }
    if (recordOrderDate && recordOrderDate === normalizedDividendDate) {
        return true;
    }
    if (recordDate && recordDate === normalizedDividendDate) {
        return true;
    }
    if (recordTargetDate && expectedArrivalDate && recordTargetDate === expectedArrivalDate) {
        const existingAmount = safeFloat(
            Number(normalized.dividendAmount) > 0 ? normalized.dividendAmount : normalized.amount,
            0
        );
        if (!(expectedAmount > 0) || !(existingAmount > 0) || Math.abs(existingAmount - expectedAmount) <= 0.01) {
            return true;
        }
    }

    return false;
}

function getSettlementFallbackDividendDate(item, fallbackDate, fallbackPerShare = 0) {
    if (!item || !fallbackDate) return fallbackDate || '';
    const fallbackDateValue = new Date(fallbackDate);
    if (isNaN(fallbackDateValue.getTime())) return fallbackDate;

    const normalizedPerShare = Number(fallbackPerShare) || 0;
    const pendingAdjustments = getPendingAdjustments(item, item?.code);
    const matched = pendingAdjustments.find(adj => {
        if (!(isDividendType(adj.type) && adj.autoDetected === true)) return false;
        const adjDate = adj.dividendDate || '';
        if (!adjDate) return false;
        const adjDateValue = new Date(adjDate);
        if (isNaN(adjDateValue.getTime())) return false;
        const dayDiff = Math.abs(fallbackDateValue.getTime() - adjDateValue.getTime()) / CONSTANTS.DAY_MS;
        if (dayDiff > 2) return false;

        if (normalizedPerShare > 0) {
            const adjPerShare = Number(adj.perShare) || 0;
            if (!(adjPerShare > 0) || Math.abs(adjPerShare - normalizedPerShare) > 0.00001) {
                return false;
            }
        }

        return true;
    });

    return matched?.dividendDate || fallbackDate;
}

async function ensureAutoDetectedDividendEntry(item, code, dividend, todayStr, notify = false, source = 'api', existingRecords = []) {
    if (!item || !dividend || !dividend.date || typeof dividend.perShare !== 'number' || !(dividend.perShare > 0)) {
        debugDividendTrace(code, 'auto-dividend-skip-invalid-input', { source, dividend });
        return false;
    }
    const shares = Number(item.shares) || 0;
    if (!(shares > 0)) {
        debugDividendTrace(code, 'auto-dividend-skip-no-shares', { source, shares, dividend });
        return false;
    }

    const expectedAmount = round2(shares * dividend.perShare);
    const candidateRecords = safeArray(
        Array.isArray(existingRecords) && existingRecords.length > 0
            ? existingRecords
            : runtimeTradeOrdersMap.get(code),
        []
    );

    const existingOrder = candidateRecords.find(record =>
        isSameRecordedDividendEvent(record, dividend, expectedAmount)
    );

    if (existingOrder) {
        if (source === 'api' && existingOrder.inferredBySettlement) {
            const synced = syncAutoDetectedDividendEntry(existingOrder, dividend, todayStr, shares);
            if (synced && existingOrder.id) {
                await HistoryDB.updateOrder(existingOrder.id, existingOrder).catch(() => {});
            }
            debugDividendTrace(code, 'auto-dividend-sync-fallback-entry', {
                source, synced, dividend, existingOrder
            });
            return synced;
        }

        debugDividendTrace(code, 'auto-dividend-skip-existing-order', {
            source, dividend, expectedAmount, existingOrder
        });
        return false;
    }

    const notification = await addAutoDetectedDividend(item, code, dividend, todayStr, source === 'fallback');
    debugDividendTrace(code, 'auto-dividend-created', {
        source, dividend, totalDividend: notification ? round2(shares * (Number(dividend.perShare) || 0)) : 0, notify
    });

    if (notify && notification) {
        notificationCenter.add(notification.message, notification.type);
    }
    return true;
}

function extractDividendEventsFromHistoryRecords(records = [], addedDate = '') {
    const events = safeArray(records, [])
        .filter(record => record?.date && (!addedDate || record.date >= addedDate) && safeString(record?.dividend, '').includes('分红'))
        .map(record => {
            const desc = safeString(record.dividend, '');
            const match = desc.match(/([0-9.]+)元/);
            const perShare = safeFloat(match?.[1], 0);
            if (!(perShare > 0)) return null;
            return {
                date: normalizePerfDate(record.date || ''),
                perShare,
                navPrice: safeFloat(record.price, 0),
                desc
            };
        })
        .filter(Boolean);

    const deduped = [];
    const seen = new Set();
    for (const event of events) {
        const key = `${event.date}|${event.perShare}|${event.navPrice}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(event);
    }
    return deduped;
}

async function backfillHistoricalDividendOrdersFromHistoryDB(funds, todayStr, tradeOrdersMap = new Map()) {
    const results = await Promise.all(
        Object.entries(funds || {}).map(([code, item]) =>
            backfillHistoricalDividendOrdersForFund(code, item, todayStr, tradeOrdersMap.get(code) || [])
        )
    );
    return results.some(Boolean);
}

async function backfillHistoricalDividendOrdersForFund(code, item, todayStr = getToday(), existingOrders = []) {
    if (!code || !item || !item.addedDate) return false;

    const historyRecords = await HistoryDB.getRange(code, item.addedDate, todayStr).catch(() => []);
    if (!Array.isArray(historyRecords) || historyRecords.length === 0) return false;

    const dividendEvents = extractDividendEventsFromHistoryRecords(historyRecords, item.addedDate);
    if (dividendEvents.length === 0) return false;

    let changed = false;
    const nextOrders = normalizeTradeRecordList(existingOrders, { source: 'order' }).slice();

    for (const dividend of dividendEvents) {
        const snapshot = calculatePositionSnapshotFromTradeOrdersAtDate(nextOrders, dividend.date);
        const sharesAtDividendDate = snapshot.shares > 0
            ? snapshot.shares
            : (safeFloat(item.shares, 0) > 0 ? safeFloat(item.shares, 0) : 0);
        if (!(sharesAtDividendDate > 0)) {
            continue;
        }

        const created = await ensureAutoDetectedDividendEntry(
            { ...item, shares: sharesAtDividendDate },
            code,
            dividend,
            todayStr,
            false,
            'history_db',
            nextOrders
        );
        if (created) {
            changed = true;
            nextOrders.push(normalizeTradeRecord({
                code,
                name: item.name || code,
                group: item.group || '默认',
                type: 'dividend',
                date: dividend.date,
                orderDate: dividend.date,
                dividendDate: dividend.date,
                targetDate: calculateDividendArrivalDate(dividend.date),
                confirmedDate: calculateDividendArrivalDate(dividend.date) < todayStr ? calculateDividendArrivalDate(dividend.date) : '',
                dividendAmount: round2(sharesAtDividendDate * dividend.perShare),
                perShare: dividend.perShare,
                dividendNavPrice: dividend.navPrice,
                status: calculateDividendArrivalDate(dividend.date) < todayStr ? 'confirmed' : 'pending',
                source: 'auto_dividend'
            }, { source: 'order' }));
        }
    }

    return changed;
}

async function debugFundDividendBackfillFromHistoryDB(code, addedDate = '') {
    const normalizedCode = safeString(code, '');
    const normalizedAddedDate = normalizePerfDate(addedDate || '');
    if (!normalizedCode || !normalizedAddedDate) {
        return {
            code: normalizedCode,
            addedDate: normalizedAddedDate,
            historyCount: 0,
            dividendHistoryCount: 0,
            dividendEvents: [],
            orders: []
        };
    }

    const historyRecords = await HistoryDB.getRange(normalizedCode, normalizedAddedDate, getToday()).catch(() => []);
    const dividendRecords = safeArray(historyRecords, []).filter(record => safeString(record?.dividend, '').includes('分红'));
    const dividendEvents = extractDividendEventsFromHistoryRecords(historyRecords, normalizedAddedDate);
    const orders = await HistoryDB.getOrders(normalizedCode).catch(() => []);

    return {
        code: normalizedCode,
        addedDate: normalizedAddedDate,
        historyCount: safeArray(historyRecords, []).length,
        dividendHistoryCount: dividendRecords.length,
        dividendRecords: dividendRecords.map(record => ({
            date: record.date,
            price: record.price,
            dividend: record.dividend || ''
        })),
        dividendEvents,
        orders: normalizeTradeRecordList(orders, { source: 'order' }).filter(order => isDividendType(order.type))
    };
}

async function buildTradeOrdersMap(codes = []) {
    const entries = await Promise.all(
        safeArray(codes, []).map(async code => [code, await HistoryDB.getOrders(code).catch(() => [])])
    );
    return new Map(entries);
}

async function persistTradeOrder(adj, order) {
    const normalized = normalizeTradeRecord(order, { source: 'order' });
    let id = adj?.orderId || normalized.id || normalized.orderId || null;

    if (!id) {
        id = await findMatchingTradeOrderId(normalized.code, normalized, 'pending');
    }
    if (!id) {
        id = await findMatchingTradeOrderId(normalized.code, normalized);
    }

    if (id) {
        const result = await HistoryDB.updateOrder(id, { ...normalized, id });
        if (result?.action === 'inserted' && result?.id) {
            id = result.id;
        } else {
            id = result?.id || id;
        }
    } else {
        id = await HistoryDB.addOrder(normalized);
    }
    if (adj && id) adj.orderId = id;

    if (normalized.code && id) {
        await cleanupDuplicateTradeLifecycleOrders(normalized.code, normalized, id);
        if (normalizeTradeAction(normalized.type) === 'initial') {
            await cleanupInitialOrdersForCode(normalized.code, id);
        }
    }

    const code = normalized.code;
    if (code) {
        const current = safeArray(runtimeTradeOrdersMap.get(code), []);
        const nextOrder = { ...normalized, id, orderId: id };
        const next = current.filter(item => {
            const itemId = item.id || item.orderId || null;
            if (id && itemId === id) return false;
            return !isSameTradeLifecycleOrder(item, nextOrder);
        });
        next.push(nextOrder);
        runtimeTradeOrdersMap.set(code, normalizeTradeRecordList(next, { source: 'order' }));
    }
    return id;
}

async function rollbackTodayConfirmedOrdersToPending(todayStr = getToday()) {
    const { orders } = await HistoryDB.getAllExportData();
    if (!Array.isArray(orders) || orders.length === 0) return false;

    let changed = false;
    const nextOrders = orders.map(order => {
        const normalized = normalizeTradeRecord(order, { source: 'order' });
        const type = normalizeTradeAction(normalized.type);
        const shouldRollback = (
            ['add', 'remove', 'dividend', 'dividend_reinvest'].includes(type)
            && normalized.status === 'confirmed'
            && normalized.confirmedDate === todayStr
        );

        if (!shouldRollback) {
            return normalized;
        }

        changed = true;
        return normalizeTradeRecord({
            ...normalized,
            status: 'pending',
            confirmedDate: '',
            confirmedPrice: 0,
            confirmedShares: 0
        }, { source: 'order' });
    });

    if (!changed) return false;
    await HistoryDB.replaceOrders(nextOrders);
    return true;
}

async function detectAutoDividends(funds, fetchedData, todayStr, tradeOrdersMap = new Map()) {
    runtimeTradeOrdersMap = tradeOrdersMap;
    let dataChanged = false;

    for (const { code, live } of fetchedData) {
        if (!live?.dividendList?.length) {
            debugDividendTrace(code, 'detect-auto-dividend-no-list', {
                hasLive: Boolean(live),
                prevPriceDate: live?.prevPriceDate || '',
                listLength: Array.isArray(live?.dividendList) ? live.dividendList.length : 0
            });
            continue;
        }
        const item = funds[code];
        if (!item) {
            debugDividendTrace(code, 'detect-auto-dividend-no-fund-item', {
                prevPriceDate: live.prevPriceDate || '',
                listLength: live.dividendList.length
            });
            continue;
        }

        debugDividendTrace(code, 'detect-auto-dividend-start', {
            prevPriceDate: live.prevPriceDate || '',
            addedDate: item.addedDate || '',
            listLength: live.dividendList.length,
            orderCount: safeArray(tradeOrdersMap.get(code), []).length
        });

        for (const dividend of live.dividendList) {
            if (!dividend || !dividend.date || typeof dividend.perShare !== 'number') {
                console.warn('跳过无效的分红记录:', dividend);
                debugDividendTrace(code, 'detect-auto-dividend-invalid-record', { dividend });
                continue;
            }

            const divDate = dividend.date;
            if (item.addedDate && divDate < item.addedDate) {
                debugDividendTrace(code, 'detect-auto-dividend-skip-before-added-date', {
                    dividendDate: divDate,
                    addedDate: item.addedDate,
                    perShare: dividend.perShare
                });
                continue;
            }

            const created = await ensureAutoDetectedDividendEntry(
                item,
                code,
                dividend,
                todayStr,
                true,
                'api',
                tradeOrdersMap.get(code) || []
            );
            if (created) {
                dataChanged = true;
            }
            debugDividendTrace(code, 'detect-auto-dividend-ensure-result', {
                dividendDate: divDate,
                perShare: dividend.perShare,
                created
            });
        }

        debugDividendTrace(code, 'detect-auto-dividend-done', {
            pendingCount: safeArray(runtimeTradeOrdersMap.get(code), []).filter(o => o.status !== 'confirmed').length
        });
    }

    return dataChanged;
}

function getPendingAdjustments(item, code) {
    if (!item) return [];
    const targetCode = code || item.code;

    if (!targetCode || typeof runtimeTradeOrdersMap === 'undefined') {
        return [];
    }
    return safeArray(runtimeTradeOrdersMap.get(targetCode), []).filter(ord => ord.status !== 'confirmed');
}

function sumPendingDividendAmount(pendingAdjustments) {
    return round2(
        pendingAdjustments.reduce((total, adj) => {
            if (isDividendType(adj.type) && adj.status === 'pending') {
                return total + (adj.dividendAmount || 0);
            }
            return total;
        }, 0)
    );
}

function isDividendWithinDisplayedSettlementWindow(dividendDate, prevTradingDayDate = '', prevPriceDate = '') {
    if (!dividendDate) return true;
    if (prevTradingDayDate && prevPriceDate) {
        return dividendDate >= prevTradingDayDate && dividendDate <= prevPriceDate;
    }
    if (prevPriceDate) {
        return dividendDate <= prevPriceDate;
    }
    return true;
}

function sumPendingDisplayDividendAmount(pendingAdjustments, prevPriceDate = '', prevTradingDayDate = '') {
    return round2(
        pendingAdjustments.reduce((total, adj) => {
            if (!isDividendType(adj.type) || adj.status !== 'pending') return total;
            if (isDividendWithinDisplayedSettlementWindow(adj.dividendDate, prevTradingDayDate, prevPriceDate)) {
                return total + (adj.dividendAmount || 0);
            }
            return total;
        }, 0)
    );
}

function shouldAutoSettleFund(fund, live, dominantMarketPrevPriceDate = '') {
    if (!fund || !live || live.prevPrice <= 0 || !live.prevPriceDate) {
        return false;
    }
    if (dominantMarketPrevPriceDate && live.prevPriceDate !== dominantMarketPrevPriceDate) {
        return false;
    }
    const savedPrevDate = fund.savedPrevDate || '';
    return !savedPrevDate || live.prevPriceDate > savedPrevDate;
}

function buildSettlementEntry(code, live) {
    if (!live || live.prevPrice <= 0) return null;

    let rate = 0;
    if (live.prevTradingDayPrice > 0) {
        rate = round2((live.prevPrice - live.prevTradingDayPrice) / live.prevTradingDayPrice * 100);
    }

    return {
        code,
        price: live.prevPrice,
        prevPriceDate: live.prevPriceDate,
        acNetValue: live.acNetValue,
        rate,
        prevTradingDayPrice: live.prevTradingDayPrice || 0,
        prevTradingDayDate: live.prevTradingDayDate || '',
        dividendList: live.dividendList || []
    };
}

function collectAutoSettlementEntries(funds, fetchedData, dominantMarketPrevPriceDate = '') {
    const settlements = [];
    for (const { code, live } of fetchedData) {
        if (!shouldAutoSettleFund(funds[code], live, dominantMarketPrevPriceDate)) continue;
        const settlement = buildSettlementEntry(code, live);
        if (settlement) settlements.push(settlement);
    }
    return settlements;
}

async function saveSettlementState(funds, todayStr, autoSettlementBlockedDate = null, dailyProfitHistory = null) {
    const dataToSave = {
        myFunds: funds,
        lastSettlementDate: todayStr,
        autoSettlementBlockedDate,
        lastUpdateDate: todayStr
    };
    if (dailyProfitHistory) {
        dataToSave.dailyProfitHistory = normalizeDailyProfitHistory(dailyProfitHistory);
    }
    await storageHelper.setAll(dataToSave);
}
