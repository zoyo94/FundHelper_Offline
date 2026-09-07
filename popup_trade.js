// ==================== 交易域：归一化 / 迁移 / 运行时状态 ====================

function buildConfirmedTransactionsState() {
    return {
        add: [],
        remove: [],
        dividend: [],
        dividend_reinvest: []
    };
}

let runtimeTradeOrdersMap = new Map();

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
        shares: roundShares(safeFloat(source.shares, 0)),
        feeRate: safeFloat(source.feeRate, 0),
        fee: safeFloat(source.fee, 0),
        dividendAmount: safeFloat(source.dividendAmount, 0),
        perShare: safeFloat(source.perShare, 0),
        confirmedShares: roundShares(safeFloat(source.confirmedShares, 0)),
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

/**
 * 根据历史交易订单计算累计买入总成本（含手续费）。
 * 用于计算累计收益率时的分母，解决减仓后 amount-holdProfit 失真的问题。
 * 只累加 initial / add / dividend_reinvest 类型的已确认订单金额。
 * @param {Array} orders - 交易订单列表
 * @returns {number} 历史总买入成本（元）
 */
function calculateTotalInvestedCostFromOrders(orders = []) {
    const confirmedOrders = normalizeTradeRecordList(orders, { source: 'order' })
        .filter(o => o.status === 'confirmed');
    let totalCost = 0;
    for (const order of confirmedOrders) {
        const displayType = getTradeDisplayType(order);
        if (displayType === 'initial' || displayType === 'add') {
            // 取已确认的买入金额（含手续费），优先使用 amount
            const amount = safeFloat(order.amount, 0);
            if (amount > 0) totalCost += amount;
        }
        // dividend_reinvest 分红再投资：实际上是额外买入，也加入成本
        if (displayType === 'dividend_reinvest') {
            const amount = safeFloat(order.dividendAmount || order.amount, 0);
            if (amount > 0) totalCost += amount;
        }
    }
    return round2(totalCost);
}

/**
 * 从已确认订单流水反推当前持仓的实占成本（建仓/加仓/红利再投累加，减仓按比例扣减）
 */
function calculatePositionCostFromOrders(orders = []) {
    const confirmedOrders = normalizeTradeRecordList(orders, { source: 'order' })
        .filter(order => order.status === 'confirmed')
        .sort(compareTradeExecutionOrder);

    let shares = 0;
    let cost = 0;

    confirmedOrders.forEach(order => {
        const displayType = getTradeDisplayType(order);
        const shareEffect = getTradeShareEffect(order);

        if (displayType === 'initial') {
            const amount = safeFloat(order.amount, 0);
            shares = Math.max(0, roundShares(Math.abs(shareEffect)));
            cost = round2(amount);
            return;
        }

        if (displayType === 'add' || displayType === 'dividend_reinvest') {
            const amount = safeFloat(displayType === 'dividend_reinvest'
                ? (order.dividendAmount || order.amount)
                : order.amount, 0);
            shares = Math.max(0, roundShares(shares + shareEffect));
            cost = round2(cost + amount);
            return;
        }

        if (displayType === 'remove' || displayType === 'clear') {
            const oldShares = shares;
            shares = Math.max(0, roundShares(shares + shareEffect));
            if (oldShares > 0.001 && cost > 0) {
                const soldShares = Math.min(oldShares, Math.abs(shareEffect));
                cost = round2(Math.max(0, cost - round2((soldShares / oldShares) * cost)));
            }
            if (displayType === 'clear' || shares <= 0.001) {
                shares = 0;
                cost = 0;
            }
            return;
        }

        if (displayType === 'dividend') {
            // 现金分红：份额不变，持仓成本减少（相当于收回部分本金）
            const amount = safeFloat(order.dividendAmount || order.amount, 0);
            cost = round2(Math.max(0, cost - amount));
        }
    });

    return round2(cost);
}

function getTradeShareEffect(record) {
    const normalized = normalizeTradeRecord(record);
    const displayType = getTradeDisplayType(normalized);
    const navPrice = getTradeExecutionNav(normalized);
    const feeRate = safeFloat(normalized.feeRate, 0) / 100;

    if (displayType === 'initial') {
        if (normalized.shares > 0) return roundShares(normalized.shares);
        if (normalized.amount > 0 && navPrice > 0) return roundShares((normalized.amount * (1 - feeRate)) / navPrice);
        return 0;
    }

    if (displayType === 'add') {
        if (normalized.confirmedShares > 0) return roundShares(normalized.confirmedShares);
        if (normalized.shares > 0) return roundShares(normalized.shares);
        if (normalized.amount > 0 && navPrice > 0) {
            return roundShares((normalized.amount * (1 - feeRate)) / navPrice);
        }
        return 0;
    }

    if (displayType === 'remove' || displayType === 'clear') {
        if (normalized.confirmedShares > 0) return -roundShares(normalized.confirmedShares);
        if (normalized.shares > 0) return -roundShares(normalized.shares);
        if (normalized.amount > 0 && navPrice > 0) return -roundShares(normalized.amount / navPrice);
        return 0;
    }

    if (displayType === 'dividend_reinvest') {
        if (normalized.confirmedShares > 0) return roundShares(normalized.confirmedShares);
        if (normalized.shares > 0) return roundShares(normalized.shares);
        if (normalized.dividendAmount > 0 && navPrice > 0) {
            return roundShares(normalized.dividendAmount / navPrice);
        }
        return 0;
    }

    return 0;
}

function isPositionBuildingTradeRecord(record) {
    const displayType = getTradeDisplayType(record);
    return displayType === 'initial' || displayType === 'add';
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
            shares = Math.max(0, roundShares(Math.abs(shareEffect)));
            addedDate = shares > 0 ? tradeDate : '';
            return;
        }

        if (displayType === 'add' || displayType === 'dividend_reinvest') {
            if (shares <= 0 && shareEffect > 0) {
                addedDate = tradeDate || addedDate;
            }
            shares = Math.max(0, roundShares(shares + shareEffect));
            if (shares > 0 && !addedDate) {
                addedDate = tradeDate || '';
            }
            return;
        }

        if (displayType === 'remove' || displayType === 'clear') {
            shares = Math.max(0, roundShares(shares + shareEffect));
            if (displayType === 'clear' || shares <= 0.001) {
                shares = 0;
                addedDate = '';
            }
        }
    });

    return {
        orders: confirmedOrders,
        shares: roundShares(shares),
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
            shares: roundShares(safeFloat(right.shares, safeFloat(left.shares, 0))),
            feeRate: safeFloat(right.feeRate, safeFloat(left.feeRate, 0)),
            fee: safeFloat(right.fee, safeFloat(left.fee, 0)),
            dividendAmount: safeFloat(right.dividendAmount, safeFloat(left.dividendAmount, 0)),
            perShare: safeFloat(right.perShare, safeFloat(left.perShare, 0)),
            confirmedShares: roundShares(safeFloat(right.confirmedShares, safeFloat(left.confirmedShares, 0))),
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
        shares: roundShares(safeFloat(right.shares, safeFloat(left.shares, 0))),
        feeRate: safeFloat(right.feeRate, safeFloat(left.feeRate, 0)),
        fee: safeFloat(right.fee, safeFloat(left.fee, 0)),
        dividendAmount: safeFloat(right.dividendAmount, safeFloat(left.dividendAmount, 0)),
        perShare: safeFloat(right.perShare, safeFloat(left.perShare, 0)),
        confirmedShares: roundShares(safeFloat(right.confirmedShares, safeFloat(left.confirmedShares, 0))),
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
            nextOrder.confirmedShares = roundShares((normalized.amount * (1 - feeRate)) / executionNav);
        } else if ((displayType === 'remove' || displayType === 'clear') && normalized.shares > 0) {
            nextOrder.amount = round2(normalized.shares * executionNav);
            nextOrder.confirmedShares = roundShares(normalized.shares);
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
