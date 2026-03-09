export function getToday() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function nextTradingDay(date) {
    const d = new Date(date);
    do {
        d.setDate(d.getDate() + 1);
    } while (d.getDay() === 0 || d.getDay() === 6); // 跳过周日(0)和周六(6)
    return d;
}

export function formatDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getConfirmDate() {
    const now = new Date();
    const day = now.getDay(); // 0=周日, 6=周六
    const hour = now.getHours();
    const minute = now.getMinutes();
    const isWeekend = (day === 0 || day === 6);
    const isAfterCutoff = !isWeekend && (hour > 15 || (hour === 15 && minute > 0));

    let base = new Date(now);

    if (isWeekend) {
        while (base.getDay() === 0 || base.getDay() === 6) {
            base.setDate(base.getDate() + 1);
        }
        return formatDate(nextTradingDay(base));
    } else if (isAfterCutoff) {
        const t1 = nextTradingDay(base);
        return formatDate(nextTradingDay(t1));
    } else {
        return formatDate(nextTradingDay(base));
    }
}
