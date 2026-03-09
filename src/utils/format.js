export function formatAmount(val) {
    if (val === undefined || val === null || isNaN(val)) return '0.00';
    return Number(val).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatProfit(val, prefix = false) {
    if (val === undefined || val === null || isNaN(val)) return '0.00';
    const num = Number(val);
    const sign = num > 0 && prefix ? '+' : '';
    return sign + num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function getProfitClass(val) {
    if (!val || val === 0) return '';
    return val > 0 ? 'up' : 'down';
}
