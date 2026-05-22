// ==================== 优化工具函数库 ====================
// 这些函数减少重复代码，提升可读性和一致性

/**
 * 安全的数字转换函数
 * @param {*} value - 任意值
 * @param {number} defaultValue - 默认值（默认 0）
 * @returns {number}
 */
const safeNumber = (value, defaultValue = 0) => {
    if (value === null || value === undefined) return defaultValue;
    const num = Number(value);
    return isNaN(num) ? defaultValue : num;
};

/**
 * 安全的浮点数转换函数（保留精度）
 * @param {*} value - 任意值
 * @param {number} defaultValue - 默认值（默认 0）
 * @returns {number}
 */
const safeFloat = (value, defaultValue = 0) => {
    if (value === null || value === undefined) return defaultValue;
    const num = parseFloat(value);
    return isNaN(num) ? defaultValue : num;
};

/**
 * 安全的整数转换函数
 * @param {*} value - 任意值
 * @param {number} defaultValue - 默认值（默认 0）
 * @returns {number}
 */
const safeInteger = (value, defaultValue = 0) => {
    if (value === null || value === undefined) return defaultValue;
    const num = parseInt(value, 10);
    return isNaN(num) ? defaultValue : num;
};

/**
 * 安全的字符串转换函数
 * @param {*} value - 任意值
 * @param {string} defaultValue - 默认值（默认 ''）
 * @returns {string}
 */
const safeString = (value, defaultValue = '') => {
    if (value === null || value === undefined) return defaultValue;
    const str = String(value).trim();
    return str === '' ? defaultValue : str;
};

/**
 * 安全的日期转换函数
 * @param {*} value - 任意值（Date 对象、时间戳、字符串）
 * @param {Date} defaultValue - 默认值（默认当前日期）
 * @returns {Date}
 */
const safeDate = (value, defaultValue = new Date()) => {
    if (value === null || value === undefined) return defaultValue;
    if (value instanceof Date) return value;
    const num = Number(value);
    return isNaN(num) ? defaultValue : new Date(num);
};

/**
 * 获取默认数组
 * @param {*} value - 任意值
 * @param {Array} defaultValue - 默认数组（默认 []）
 * @returns {Array}
 */
const safeArray = (value, defaultValue = []) => {
    if (value === null || value === undefined) return defaultValue;
    return Array.isArray(value) ? value : defaultValue;
};

/**
 * 获取默认对象
 * @param {*} value - 任意值
 * @param {Object} defaultValue - 默认对象（默认 {}）
 * @returns {Object}
 */
const safeObject = (value, defaultValue = {}) => {
    if (value === null || value === undefined) return defaultValue;
    return typeof value === 'object' && value !== null ? value : defaultValue;
};

/**
 * 安全的条件运算
 * @param {boolean} condition - 条件
 * @param {*} trueValue - 为真时的值
 * @param {*} falseValue - 为假时的值
 * @returns {*}
 */
const when = (condition, trueValue, falseValue) => condition ? trueValue : falseValue;

/**
 * 确保数值为非负
 * @param {number} value - 数值
 * @returns {number}
 */
const nonNegative = (value) => Math.max(0, safeNumber(value, 0));

/**
 * 确保数值为非负浮点数
 * @param {number} value - 数值
 * @returns {number}
 */
const nonNegativeFloat = (value) => Math.max(0, safeFloat(value, 0));

/**
 * 检查数值是否有效（大于 0）
 * @param {number} value - 数值
 * @returns {boolean}
 */
const isValidPositiveNumber = (value) => {
    const num = safeNumber(value, 0);
    return num > 0;
};

/**
 * 检查数值是否非零
 * @param {number} value - 数值
 * @returns {boolean}
 */
const isNonZeroNumber = (value) => {
    const num = safeNumber(value, 0);
    return num !== 0;
};

/**
 * 格式化数字（保留指定小数位）
 * @param {number} num - 数字
 * @param {number} decimals - 小数位数（默认 2）
 * @returns {string}
 */
const formatNumber = (num, decimals = 2) => {
    return safeNumber(num, 0).toFixed(decimals);
};

/**
 * 安全的除法运算（避免除零）
 * @param {number} dividend - 被除数
 * @param {number} divisor - 除数
 * @param {number} defaultValue - 除零时的默认值
 * @returns {number}
 */
const safeDivide = (dividend, divisor, defaultValue = 0) => {
    const d1 = safeNumber(dividend, 0);
    const d2 = safeNumber(divisor, 0);
    return d2 === 0 ? defaultValue : d1 / d2;
};

/**
 * 安全的乘法运算（避免精度问题）
 * @param {number} a - 第一个数
 * @param {number} b - 第二个数
 * @param {number} precision - 精度（默认 2）
 * @returns {number}
 */
const safeMultiply = (a, b, precision = 2) => {
    const n1 = safeNumber(a, 0);
    const n2 = safeNumber(b, 0);
    return Math.round(n1 * n2 * Math.pow(10, precision)) / Math.pow(10, precision);
};

/**
 * 幂运算（安全的浮点数幂）
 * @param {number} base - 底数
 * @param {number} exponent - 指数
 * @param {number} defaultValue - 无效时的默认值
 * @returns {number}
 */
const safePow = (base, exponent, defaultValue = 0) => {
    const b = safeNumber(base, 0);
    const e = safeNumber(exponent, 0);
    if (isNaN(b) || isNaN(e)) return defaultValue;
    return Math.pow(b, e);
};

// 导出所有工具函数（在 popup.js 中引入）
const OPTIMIZATION_UTILS = {
    safeNumber,
    safeFloat,
    safeInteger,
    safeString,
    safeDate,
    safeArray,
    safeObject,
    when,
    nonNegative,
    nonNegativeFloat,
    isValidPositiveNumber,
    isNonZeroNumber,
    formatNumber,
    safeDivide,
    safeMultiply,
    safePow
};