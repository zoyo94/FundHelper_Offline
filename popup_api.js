// ==================== 请求 / 行情 / 历史净值接口域 ====================

// 三个 proxyFetch* 的公共骨架：超时兜底 + lastError 兜底 + 一次性 resolve。
// extract 负责从成功响应中提取返回值；任何失败路径都 resolve(null)（调用方按"无数据"降级）。
function _proxySendMessage(message, timeout, extract) {
    return new Promise((resolve) => {
        let resolved = false;
        const done = (value) => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timer);
            resolve(value);
        };
        const timer = setTimeout(() => done(null), timeout);
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError || !response?.success || !response.data) {
                done(null);
                return;
            }
            done(extract(response.data));
        });
    });
}

function proxyFetchSina(url, timeout = 5000) {
    return _proxySendMessage({ type: 'FETCH_SINA', url }, timeout,
        data => {
            const content = String(data).match(/"([^"]*)"/s);
            return content ? content[1] : null;
        });
}

function proxyFetchJson(url, { timeout = 5000, headers = {} } = {}) {
    return _proxySendMessage({ type: 'FETCH_JSON', url, headers }, timeout, data => data);
}

function proxyFetchText(url, { timeout = 5000, headers = {} } = {}) {
    return _proxySendMessage({ type: 'FETCH_TEXT', url, headers }, timeout,
        data => (typeof data === 'string' ? data : null));
}

async function fetchLiveApiText(url, timeout = CONFIG.API_TIMEOUT) {
    const direct = await withTimeout(
        fetch(url)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.text();
            })
            .catch((err) => {
                console.warn('[live-api] 直连失败, 尝试 Background 代理:', url, err.message);
                return null;
            }),
        timeout,
        null
    );
    if (direct !== null) return direct;

    return proxyFetchText(url, {
        timeout,
        headers: {
            'Referer': 'https://fund.eastmoney.com/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    });
}

function withTimeout(promise, ms, fallback) {
    const timer = new Promise(resolve => setTimeout(() => resolve(fallback), ms));
    return Promise.race([promise, timer]);
}

// ==================== push2 行情接口闸门 ====================
// 东财 push2 对请求频率极其敏感：实测同一 URL 间隔 1 秒连发两次，第二次会被直接断连
//（popup 报 net::ERR_EMPTY_RESPONSE，curl 报 HTTP 000）；间隔 1.5 秒仍偶发断连，
// 是"上一请求后的冷却窗口"行为。取 1800ms 作为最小间隔留足余量。
// 启动时涨跌家数(push2)、涨跌停(push2ex)、指数行情(push2)、穿透估值股票行情(push2)
// 曾并发打出 3~4 个请求，必然触发断连。统一闸门：全局同时只有一个 push2 请求在飞，
// 请求之间强制最小间隔，失败退避重试一次、再换备用域名（82.push2 为东财备用节点，
// 部分网络不可用，仅作最后一次尝试）；连续失败则会话级降级提示（不刷屏）。
const PUSH2_MIN_INTERVAL_MS = 1800;
// 重试间隔须 ≥ PUSH2_MIN_INTERVAL_MS：task 内部的重试不经过 pump 的最小间隔检查，
// 若首次请求快速失败（断连是秒级返回），间隔过短的重试仍会撞进东财的冷却窗口
const PUSH2_RETRY_DELAY_MS = 1800;
const PUSH2_ATTEMPT_TIMEOUT_MS = 6000;
const PUSH2_ALT_HOST = 'https://82.push2.eastmoney.com/';
// 优先级：数值越大越先执行。穿透估值的股票行情在 loadData 关键路径上（priority=1），
// 涨跌家数/指数行情属于装饰性指标（priority=0），避免首屏被装饰性请求堵住。
const _push2Queue = [];
let _push2Running = false;
let _push2LastRequestAt = 0;
let _push2DegradedNotified = false;

function _push2Sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function _push2Pump() {
    if (_push2Running) return;
    const next = _push2Queue.shift();
    if (!next) return;
    _push2Running = true;
    const waitMs = Math.max(0, _push2LastRequestAt + PUSH2_MIN_INTERVAL_MS - Date.now());
    if (waitMs > 0) await _push2Sleep(waitMs);
    try {
        next.resolve(await next.task());
    } catch (error) {
        next.reject(error);
    } finally {
        _push2LastRequestAt = Date.now();
        _push2Running = false;
        _push2Pump();
    }
}

// 串行闸门：无论调用方如何并发，都排队执行；高优先级插队到低优先级之前；
// 前一个失败不影响后续
function _enqueuePush2(task, priority = 0) {
    return new Promise((resolve, reject) => {
        const entry = { task, priority, resolve, reject };
        const insertAt = _push2Queue.findIndex(item => item.priority < priority);
        if (insertAt < 0) _push2Queue.push(entry);
        else _push2Queue.splice(insertAt, 0, entry);
        _push2Pump();
    });
}

async function _attemptPush2(url) {
    const headers = {
        'Referer': 'https://quote.eastmoney.com/',
        'Accept': 'application/json, text/plain, */*'
    };
    const proxied = await proxyFetchText(url, { timeout: PUSH2_ATTEMPT_TIMEOUT_MS, headers }).catch(() => null);
    if (proxied) return proxied;
    const direct = await withTimeout(
        fetch(url, { headers })
            .then(res => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
            .catch(() => null),
        PUSH2_ATTEMPT_TIMEOUT_MS,
        null
    );
    return direct;
}

// push2 专用取文本：串行 + 退避重试 + 备用域名；全部失败返回 null
function fetchPush2Text(url, priority = 0) {
    return _enqueuePush2(async () => {
        let text = await _attemptPush2(url);
        if (text) return text;
        await _push2Sleep(PUSH2_RETRY_DELAY_MS);
        text = await _attemptPush2(url);
        if (text) return text;
        if (url.startsWith('https://push2.eastmoney.com/')) {
            text = await _attemptPush2(url.replace('https://push2.eastmoney.com/', PUSH2_ALT_HOST));
        }
        if (!text && !_push2DegradedNotified) {
            _push2DegradedNotified = true;
            console.warn('[push2] 行情接口连续失败（东财限流或网络受限），相关指标降级显示；后续不再重复提示');
        }
        return text;
    });
}

// push2 专用取 JSON（与 fetchPush2Text 共用闸门）
async function fetchPush2Json(url, priority = 0) {
    const text = await fetchPush2Text(url, priority);
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch (e) {
        console.warn('[push2] 响应不是合法 JSON:', url.slice(0, 80));
        return null;
    }
}

function isPush2Url(url) {
    return typeof url === 'string' && url.includes('push2');
}

async function fetchEastmoneyJson(url, timeout = CONFIG.MARKET_BREADTH_TIMEOUT, priority = 0) {
    // push2 系接口统一走闸门（串行 + 重试 + 备用域名），避免频控断连
    if (isPush2Url(url)) {
        return await fetchPush2Json(url, priority);
    }
    const direct = await withTimeout(
        fetch(url)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .catch((err) => {
                console.warn('[eastmoney] 直连失败:', url, err);
                return null;
            }),
        timeout,
        null
    );
    if (direct) return direct;

    const proxied = await proxyFetchJson(url, {
        timeout,
        headers: {
            'Referer': 'https://quote.eastmoney.com/',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*'
        }
    });
    if (!proxied) {
        console.warn('[eastmoney] 代理请求失败:', url.slice(0, 80));
    }
    return proxied;
}

async function fetchBatchLiveInfo(codes, timeout = CONFIG.API_TIMEOUT, fallback = null) {
    return Promise.all(
        codes.map(code => {
            const fb = typeof fallback === 'function' ? fallback(code) : fallback;
            return withTimeout(fetchLiveInfo(code), timeout, fb)
                .then(live => ({ code, live }));
        })
    );
}

async function fetchLiveInfo(code) {
    const cleanCode = code.trim();

    if (/^\d{6}$/.test(cleanCode)) {
        return await _fetchOutOfMarketFund(cleanCode);
    }

    return await _fetchFuturesSina(cleanCode);
}

/**
 * 场外基金 / 场内基金：天天基金估值 + 东财历史净值，并发请求后合并
 */
async function _fetchOutOfMarketFund(cleanCode) {
    const [mainLive, t2] = await Promise.all([
        fetchPrioritizedLiveInfo([cleanCode]).then(results => {
            const live = results?.[0]?.live;
            return hasUsableLiveEstimate(live) || Number(live?.prevPrice) > 0 ? live : null;
        }).catch((error) => {
            console.warn('[live-api] 主估值接口请求失败:', cleanCode, error.message);
            return null;
        }),
        fetchPrioritizedHistoryText(cleanCode).catch(() => null)
    ]);

    const r2 = t2 !== null ? { status: 'fulfilled', value: t2 } : { status: 'rejected', reason: new Error('请求历史接口失败') };

    const mainResult = mainLive;
    const fallbackResult = await _parseEastmoneyResponse(r2, cleanCode, !!mainResult);

    if (mainResult && fallbackResult) {
        mainResult.acNetValue = fallbackResult.acNetValue;
        mainResult.dividendList = fallbackResult.dividendList;
        mainResult.prevTradingDayPrice = fallbackResult.prevTradingDayPrice;
        mainResult.prevTradingDayDate = fallbackResult.prevTradingDayDate;
        if (fallbackResult.prevPriceDate && (!mainResult.prevPriceDate || fallbackResult.prevPriceDate > mainResult.prevPriceDate)) {
            mainResult.prevPrice = fallbackResult.prevPrice;
            mainResult.prevPriceDate = fallbackResult.prevPriceDate;
        }
        debugDividendTrace(cleanCode, 'fetch-merged-main-fallback', {
            mainPrevPriceDate: mainResult.prevPriceDate || '',
            mainPrevPrice: mainResult.prevPrice || 0,
            prevTradingDayDate: mainResult.prevTradingDayDate || '',
            prevTradingDayPrice: mainResult.prevTradingDayPrice || 0,
            dividendListLength: Array.isArray(mainResult.dividendList) ? mainResult.dividendList.length : 0
        });
        return mainResult;
    }
    if (mainResult) {
        debugDividendTrace(cleanCode, 'fetch-return-main-only', {
            prevPriceDate: mainResult.prevPriceDate || '',
            prevPrice: mainResult.prevPrice || 0,
            hasDividendList: Array.isArray(mainResult.dividendList)
        });
        return mainResult;
    }
    if (fallbackResult) {
        debugDividendTrace(cleanCode, 'fetch-return-fallback-only', {
            prevPriceDate: fallbackResult.prevPriceDate || '',
            prevTradingDayDate: fallbackResult.prevTradingDayDate || '',
            prevTradingDayPrice: fallbackResult.prevTradingDayPrice || 0,
            dividendListLength: fallbackResult.dividendList.length
        });
        return fallbackResult;
    }

    // 场外都失败，尝试新浪场内基金
    const onMarketResult = await _fetchOnMarketFundSina(cleanCode);
    if (onMarketResult) return onMarketResult;

    return { name: `[未知]${cleanCode}`, rate: 0, price: 0, prevPrice: 0 };
}


function _buildEastmoneyHistoryItems(cleanCode, netWorthData, acMap = new Map()) {
    return safeArray(netWorthData, []).map(item => ({
        code: cleanCode,
        date: item.x ? timestampToDate(item.x) : '',
        price: parseFloat(item.y),
        acPrice: acMap.get(item.x) || null,
        rate: typeof item.equityReturn !== 'undefined' ? parseFloat(item.equityReturn) : null,
        dividend: item.unitMoney || ''
    })).filter(item => item.date && item.price > 0);
}

/**
 * 从东财 pingzhongdata 原始文本解析分红列表（unitMoney 字段含"分红"标注）。
 * 供分红检测在「实时源 / HistoryDB 兜底都为空」时主动抓取使用，独立于缓存与升级时机。
 * @returns {Array<{perShare:number,date:string,navPrice:number,desc:string}>}
 */
function extractDividendListFromEastmoneyText(extData) {
    if (!extData || !extData.includes('fS_name')) return [];
    const netWorthMatch = extData.match(/Data_netWorthTrend\s*=\s*(\[[\s\S]*?\])\s*;/);
    if (!netWorthMatch) return [];
    let netWorthData;
    try { netWorthData = JSON.parse(netWorthMatch[1]); } catch (e) { return []; }
    if (!Array.isArray(netWorthData) || netWorthData.length < 2) return [];
    const list = [];
    for (const item of netWorthData) {
        if (item.unitMoney && item.unitMoney.includes('分红')) {
            const match = item.unitMoney.match(/([0-9.]+)元/);
            if (match) {
                list.push({
                    perShare: parseFloat(match[1]),
                    date: item.x ? timestampToDate(item.x) : '',
                    navPrice: parseFloat(item.y) || 0,
                    desc: item.unitMoney
                });
            }
        }
    }
    return list;
}

/**
 * 从东财 pingzhongdata 原始文本构建完整历史净值条目（含 dividend 字段），
 * 用于触发 _persistEastmoneyHistoryGap 的安全升级（不会覆盖已有 price / acPrice）。
 */
function buildEastmoneyHistoryItemsFromText(cleanCode, extData) {
    if (!extData || !extData.includes('fS_name')) return [];
    const netWorthMatch = extData.match(/Data_netWorthTrend\s*=\s*(\[[\s\S]*?\])\s*;/);
    if (!netWorthMatch) return [];
    let netWorthData;
    try { netWorthData = JSON.parse(netWorthMatch[1]); } catch (e) { return []; }
    const acMap = new Map();
    const acMatch = extData.match(/Data_ACWorthTrend\s*=\s*(\[[\s\S]*?\]);/);
    if (acMatch) {
        try {
            JSON.parse(acMatch[1]).forEach(item => acMap.set(item[0], parseFloat(item[1])));
        } catch (e) { /* 忽略累计净值解析错误 */ }
    }
    return _buildEastmoneyHistoryItems(cleanCode, netWorthData, acMap);
}

async function _persistEastmoneyHistoryGap(cleanCode, dbItems, hasMainResult) {
    if (!Array.isArray(dbItems) || dbItems.length === 0) return;

    if (!hasMainResult) {
        await HistoryDB.batchPut(dbItems).catch(() => {});
        return;
    }

    const latestLocal = await HistoryDB.getLatest(cleanCode).catch(() => null);
    const latestLocalDate = normalizePerfDate(latestLocal?.date || '');
    const latestRemoteDate = normalizePerfDate(dbItems[dbItems.length - 1]?.date || '');

    if (!latestLocalDate) {
        await HistoryDB.batchPut(dbItems).catch(() => {});
        return;
    }

    // 直接全量比对当前获取到的历史净值数据
    // 现代浏览器中查询 IndexedDB 几千条数据只需几毫秒，全量比对可以彻底解决无论 1 个月还是 1 年未打开导致的断层
    if (dbItems.length === 0) return;

    const checkStartDate = dbItems[0].date;
    const localRange = await HistoryDB.getRange(cleanCode, checkStartDate, latestRemoteDate).catch(() => []);
    const localDateSet = new Set(localRange.map(item => item.date));
    const localByDate = new Map(localRange.map(item => [item.date, item]));

    // 筛选出本地没有的记录进行补全
    const missingItems = dbItems.filter(item => !localDateSet.has(item.date));

    // 已有记录的字段升级：主要是 unitMoney（东财标注分红有滞后，可能本地写入时为空、后续 fetch 时补上）
    // 仅当远端 dividend 非空且本地 dividend 为空时才更新，避免覆盖用户已编辑的字段
    const upgradeItems = [];
    for (const remoteItem of dbItems) {
        const localItem = localByDate.get(remoteItem.date);
        if (!localItem) continue;
        const remoteDividend = safeString(remoteItem.dividend, '');
        const localDividend = safeString(localItem.dividend, '');
        if (remoteDividend && !localDividend) {
            upgradeItems.push({ ...localItem, dividend: remoteDividend });
        }
    }

    if (missingItems.length > 0) {
        await HistoryDB.batchPut(missingItems).catch(() => {});
    }
    if (upgradeItems.length > 0) {
        await HistoryDB.batchPut(upgradeItems).catch(() => {});
    }
}

/**
 * 解析东财历史净值接口 (fund.eastmoney.com/pingzhongdata)
 */
async function _parseEastmoneyResponse(settled, cleanCode, hasMainResult) {
    if (settled.status !== 'fulfilled') {
        debugDividendTrace(cleanCode, 'fetch-fallback-error', { message: settled.reason?.message });
        return null;
    }
    try {
        const extData = settled.value;
        if (!extData || !extData.includes('fS_name')) {
            debugDividendTrace(cleanCode, 'fetch-fallback-invalid-data', {});
            return null;
        }

        const nameMatch = extData.match(/fS_name\s*=\s*"([^"]+)"/);
        const name = nameMatch ? nameMatch[1] : `[场外备用]${cleanCode}`;

        const netWorthMatch = extData.match(/Data_netWorthTrend\s*=\s*(\[[\s\S]*?\])\s*;/);
        if (!netWorthMatch) return null;

        const netWorthData = JSON.parse(netWorthMatch[1]);
        if (!netWorthData || netWorthData.length < 2) return null;

        const latest = netWorthData[netWorthData.length - 1];
        const prev = netWorthData[netWorthData.length - 2];
        const gsz = parseFloat(latest.y) || 0;
        const dateStr = latest.x ? timestampToDate(latest.x) : '';
        const prevTradingDayPrice = parseFloat(prev.y) || 0;
        const prevTradingDayDate = prev.x ? timestampToDate(prev.x) : '';

        const dividendList = [];
        for (const item of netWorthData) {
            if (item.unitMoney && item.unitMoney.includes('分红')) {
                const match = item.unitMoney.match(/([0-9.]+)元/);
                if (match) {
                    dividendList.push({
                        perShare: parseFloat(match[1]),
                        date: item.x ? timestampToDate(item.x) : '',
                        navPrice: parseFloat(item.y) || 0,
                        desc: item.unitMoney
                    });
                }
            }
        }

        let acNetValue = null;
        const acMapInner = new Map();
        const acMatch = extData.match(/Data_ACWorthTrend\s*=\s*(\[[\s\S]*?\]);/);
        if (acMatch) {
            try {
                const acData = JSON.parse(acMatch[1]);
                if (acData && acData.length > 0) {
                    acData.forEach(item => acMapInner.set(item[0], parseFloat(item[1])));
                    acNetValue = parseFloat(acData[acData.length - 1][1]) || null;
                }
            } catch (e) {
                console.warn('解析累计净值失败:', e);
            }
        }

        debugDividendTrace(cleanCode, 'fetch-fallback-success', {
            prevPriceDate: dateStr, prevTradingDayDate,
            prevTradingDayPrice, acNetValue,
            dividendListLength: dividendList.length,
            dividendList: dividendList.map(div => ({
                date: div.date, perShare: div.perShare, navPrice: div.navPrice
            }))
        });

        // 写历史净值到 DB：主接口失败时全量兜底；主接口成功时只补本地缺口日期，供收益历史回溯拆分多日收益。
        await _persistEastmoneyHistoryGap(
            cleanCode,
            _buildEastmoneyHistoryItems(cleanCode, netWorthData, acMapInner),
            hasMainResult
        );

        return {
            name, rate: null, price: gsz,
            prevPrice: gsz,
            prevPriceDate: dateStr,
            prevTradingDayPrice, prevTradingDayDate,
            acNetValue, dividendList,
            isFallback: true
        };
    } catch (e) {
        debugDividendTrace(cleanCode, 'fetch-fallback-error', { message: e.message });
        return null;
    }
}

/**
 * 场内基金：新浪行情 (hq.sinajs.cn)
 */
async function _fetchOnMarketFundSina(cleanCode) {
    try {
        const p = cleanCode.startsWith('5') ? 'sh' : 'sz';
        const url = `https://hq.sinajs.cn/list=${p}${cleanCode}`;
        const data = await proxyFetchSina(url);
        if (!data || typeof data !== 'string') return null;

        const parts = data.split(',');
        if (parts.length <= 10) return null;

        const cur = parseFloat(parts[3]);
        const pre = parseFloat(parts[2]);
        if (isNaN(cur) || isNaN(pre) || cur <= 0 || pre <= 0) return null;

        return {
            name: '[场]' + (parts[0] || cleanCode),
            rate: round2((cur - pre) / pre * 100),
            price: cur,
            prevPrice: pre
        };
    } catch (e) {
        console.warn(`场内基金解析失败 ${cleanCode}:`, e);
        return null;
    }
}

/**
 * 期货：新浪行情 (hq.sinajs.cn)
 */
async function _fetchFuturesSina(cleanCode) {
    try {
        const url = `https://hq.sinajs.cn/list=nf_${cleanCode.toUpperCase()}`;
        const fut = await proxyFetchSina(url);
        if (!fut || typeof fut !== 'string') {
            return { name: `[未知]${cleanCode}`, rate: 0, price: 0, prevPrice: 0 };
        }

        const parts = fut.split(',');
        if (parts.length > 10) {
            const cur = parseFloat(parts[8]);
            const pre = parseFloat(parts[5]);
            if (!isNaN(cur) && !isNaN(pre) && cur > 0 && pre > 0) {
                return {
                    name: '[期]' + (parts[0] || cleanCode),
                    rate: round2((cur - pre) / pre * 100),
                    price: cur,
                    prevPrice: pre
                };
            }
        }
    } catch (e) {
        console.warn(`期货解析失败 ${cleanCode}:`, e);
    }

    return { name: `[未知]${cleanCode}`, rate: 0, price: 0, prevPrice: 0 };
}

// ==================== 持仓穿透估值引擎 (Holdings Penetration Engine) ====================

const _fundHoldingsMemoryCache = new Map(); // code -> { timestamp, ttl, data }

// 穿透引擎调试开关：默认关闭，保持 console 干净。
// 需要排查穿透/持仓问题时，在 console 执行 `PEN_DEBUG = true` 再刷新一次即可看到全部诊断日志。
var PEN_DEBUG = false;

// 持仓缓存 TTL 分级：
//   有持仓        12h  —— 季报披露周期，盘中不变
//   确认无股票     6h  —— 债基/货基结论稳定，但留纠错窗口（换仓后能纠正）
//   源不可用      10min —— 网络/限流失败，短 TTL 便于尽快恢复
const HOLDINGS_TTL_HAS_DATA = 12 * 3600 * 1000;
const HOLDINGS_TTL_EMPTY = 6 * 3600 * 1000;
const HOLDINGS_TTL_FAILED = 10 * 60 * 1000;

async function fetchFundHoldingsWithCache(cleanCode) {
    const cached = _fundHoldingsMemoryCache.get(cleanCode);
    const now = Date.now();
    if (cached && (now - cached.timestamp < cached.ttl)) {
        return cached.data;
    }

    try {
        // 源1: fundmobapi（精确占比），但 Chrome 扩展环境可能因子域风控返回 Datas=null，仅作首选
        const mobapi = await tryFetchFundMobapi(cleanCode);
        const mobapiOk = mobapi && (mobapi.stocks.length > 0 || mobapi.fofs.length > 0);

        // 源2: pingzhongdata（fund.eastmoney.com 子域，环境已验证可用，仅股票代码无占比 → 总仓位等权近似兜底）
        const pgz = !mobapiOk ? await tryFetchPingzhongdata(cleanCode) : null;
        const pgzOk = pgz && pgz.stocks.length > 0;

        const result = mobapiOk ? mobapi : (pgzOk ? pgz : { stocks: [], fofs: [] });
        const hasData = result.stocks.length > 0 || result.fofs.length > 0;
        // 关键：空持仓（债基/货基）也必须进缓存——否则这些基金每轮刷新都会重跑
        // 「mobapi 失败 + pingzhongdata」两次请求，与 push2 共享东财域名风控额度，
        // 是 ERR_EMPTY_RESPONSE / 514 限流的持续来源（用户组合里 8 只债基 ≈ 16 请求/刷新）。
        // pgz === null 表示连兜底源都没拿到有效响应（网络/限流/页面结构变化），
        // 与"成功确认该基金无股票持仓"区分开，用更短 TTL 以便尽快重试。
        const bothSourcesDown = !mobapi && !pgz;
        const ttl = hasData
            ? HOLDINGS_TTL_HAS_DATA
            : (bothSourcesDown ? HOLDINGS_TTL_FAILED : HOLDINGS_TTL_EMPTY);
        _fundHoldingsMemoryCache.set(cleanCode, { timestamp: now, ttl, data: result });
        return result;
    } catch (e) {
        console.warn(`[holdings] 获取基金 ${cleanCode} 持仓失败:`, e.message);
        // 异常同样进负缓存（短 TTL），避免异常路径每轮重试加剧限流
        _fundHoldingsMemoryCache.set(cleanCode, {
            timestamp: now,
            ttl: HOLDINGS_TTL_FAILED,
            data: { stocks: [], fofs: [] }
        });
        return { stocks: [], fofs: [] };
    }
}

// 源1: 东财移动端持仓接口（基金重仓股 + 重仓基金，含精确占比）。
// 该子域在部分 Chrome 扩展环境会被差异化软失败（Datas=null），故仅作首选，失败由 pingzhongdata 兜底。
async function tryFetchFundMobapi(cleanCode) {
    try {
        const url = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition?FCODE=${cleanCode}&deviceid=Wap&plat=Wap&product=EFund&version=6.5.9`;
        let res = await fetchEastmoneyJson(url, 6000);
        if (PEN_DEBUG) console.log(`[holdings][mobapi] ${cleanCode}:`, res ? `Datas=${res.Datas ? 'has' : 'null'} fundStocksLen=${res?.Datas?.fundStocks?.length ?? 'undef'} fundfofsLen=${res?.Datas?.fundfofs?.length ?? 'undef'}` : 'NULL');
        if (!res || !res.Datas) return null;

        const fundStocks = safeArray(res.Datas.fundStocks, []);
        const fundFofs = safeArray(res.Datas.fundfofs, []);
        const stocks = fundStocks.map(s => ({
            code: String(s.GPDM || '').trim(),
            name: String(s.GPJC || '').trim(),
            weight: parseFloat(s.JZBL) || 0,
            market: String(s.TEXCH || '') === '1' ? 'sh' : 'sz'
        })).filter(s => s.code && s.weight > 0);

        const fofs = fundFofs.map(f => ({
            code: String(f.TZJJDM || '').trim(),
            name: String(f.TZJJMC || '').trim(),
            weight: parseFloat(f.ZJZBL) || 0
        })).filter(f => f.code && f.weight > 0);

        return { stocks, fofs };
    } catch (e) {
        console.warn(`[holdings][mobapi] ${cleanCode} 异常:`, e.message);
        return null;
    }
}

const _stockSourceCooldowns = new Map();

async function _fetchStockQuotesFromEastmoney(stocks, profile) {
    const secids = stocks.map(s => {
        const c = s.code;
        const prefix = /^[69]/.test(c) || /^5/.test(c) ? '1' : '0';
        return `${prefix}.${c}`;
    });
    const url = profile.urlTemplate.replaceAll('{secids}', encodeURIComponent(secids.join(',')));
    let text = null;
    if (isPush2Url(url)) {
        // 东财 push2 系接口必须走全局串行闸门（与指数/涨跌家数互斥，避免频控断连）。
        // priority=1：穿透行情在 loadData 关键路径上，优先于装饰性的指数/涨跌家数请求；
        // 闸门自带代理/直连双通道、退避重试与 82.push2 备用域名，比此处单次请求更稳。
        text = await fetchPush2Text(url, 1);
    } else {
        // 非东财 push2 的自定义源：保持代理 + 直连双通道
        try {
            if (typeof proxyFetchText === 'function') {
                text = await proxyFetchText(url, {
                    timeout: 5000,
                    headers: { 'Referer': 'https://quote.eastmoney.com/', 'Accept': 'application/json, text/plain, */*' }
                });
            }
        } catch (e) { text = null; }
        if (!text) {
            try {
                const r = await fetch(url, { headers: { 'Referer': 'https://quote.eastmoney.com/' }, signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined });
                if (r.ok) text = await r.text();
            } catch (e) { /* ignore */ }
        }
    }
    const resultMap = new Map();
    if (!text) return null; // network failure or empty
    try {
        const payload = parseJsonApiPayload(text, profile.responseType);
        const data = getValueByPath(payload, profile.dataPath);
        if (!Array.isArray(data)) return null;
        for (const item of data) {
            const code = String(getValueByPath(item, profile.fields.code) || '').trim();
            const price = parseFloat(getValueByPath(item, profile.fields.price)) || 0;
            const rate = parseFloat(getValueByPath(item, profile.fields.rate)) || 0;
            const name = String(getValueByPath(item, profile.fields.name) || '').trim();
            if (code && price > 0) {
                resultMap.set(code, { code, name, price, prevClose: 0, rate: round2(rate) });
            }
        }
    } catch (e) {
        console.warn(`[stock-quotes] ${profile.name} 解析失败:`, e.message);
        return null;
    }
    return resultMap;
}

async function _fetchStockQuotesFromTencent(stocks, profile) {
    const tencentCodes = stocks.map(s => {
        const c = String(s.code).trim();
        const prefix = /^[69]/.test(c) || /^5/.test(c) ? 'sh' : (/^[03]/.test(c) ? 'sz' : (/^[48]/.test(c) ? 'bj' : 'sh'));
        return `${prefix}${c}`;
    });
    const url = profile.urlTemplate.replaceAll('{codes}', tencentCodes.join(','));
    let text = null;
    try {
        const r = await fetch(url, { signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined });
        if (r.ok) {
            const buffer = await r.arrayBuffer();
            text = new TextDecoder('gbk').decode(buffer);
        }
    } catch (e) { text = null; }
    if (!text) return null;

    const resultMap = new Map();
    text.split(';').forEach(line => {
        if (!line.trim() || !line.includes('~')) return;
        const parts = line.split('~');
        if (parts.length < 33) return;
        const match = parts[0].match(/v_([a-z0-9]+)=/);
        if (!match) return;
        const rawCode = match[1].replace(/^[a-z]+/, ''); // strip prefix
        const name = String(parts[1] || '').trim();
        const price = parseFloat(parts[3]) || 0;
        const rate = parseFloat(parts[32]) || 0;
        if (rawCode && price > 0) {
            resultMap.set(rawCode, {
                code: rawCode,
                name,
                price,
                prevClose: parseFloat(parts[4]) || 0,
                rate: round2(rate)
            });
        }
    });
    if (resultMap.size === 0) return null;
    return resultMap;
}

async function fetchStockQuotesBatch(stocks) {
    if (!Array.isArray(stocks) || stocks.length === 0) return new Map();
    const profiles = typeof getEnabledStockApiProfiles === 'function' ? getEnabledStockApiProfiles() : [];
    if (profiles.length === 0) return new Map();

    const now = Date.now();
    let sortedProfiles = [...profiles].sort((a, b) => {
        const coolA = _stockSourceCooldowns.get(a.source) || 0;
        const coolB = _stockSourceCooldowns.get(b.source) || 0;
        return (coolA > now ? 1 : 0) - (coolB > now ? 1 : 0);
    });
    if (sortedProfiles.every(p => (_stockSourceCooldowns.get(p.source) || 0) > now)) {
        // all cooling down, clear cooldowns and try again
        _stockSourceCooldowns.clear();
    }

    for (const profile of sortedProfiles) {
        if (PEN_DEBUG) console.log(`[stock-quotes] 尝试源: ${profile.name}`);
        let resultMap = null;
        if (profile.source === 'stock_tencent' || profile.responseType === 'tencent_stock') {
            resultMap = await _fetchStockQuotesFromTencent(stocks, profile);
        } else {
            resultMap = await _fetchStockQuotesFromEastmoney(stocks, profile);
        }

        if (resultMap && resultMap.size > 0) {
            _stockSourceCooldowns.delete(profile.source);
            if (PEN_DEBUG) console.log(`[stock-quotes] 从 ${profile.name} 成功拉取 ${resultMap.size} 只股票行情`);
            return resultMap;
        } else {
            console.warn(`[stock-quotes] 源 ${profile.name} 无效或失败，冷却 60s`);
            _stockSourceCooldowns.set(profile.source, Date.now() + 60000);
        }
    }

    console.warn('[stock-quotes] 所有可用股票行情源均失败（请检查网络或权限）');
    return new Map();
}

// 源2: 东财基金详情页 pingzhongdata.js（fund.eastmoney.com 子域，环境已验证可用）。
// 提取前十大重仓股代码（stockCodes）+ 股票总仓位（Data_fundSharesPositions 最新值），
// 个股权重缺失时用「总仓位等权分摊到前十大」近似：方向正确、数值近似，优于空白。
async function tryFetchPingzhongdata(cleanCode) {
    try {
        const text = await proxyFetchText(`https://fund.eastmoney.com/pingzhongdata/${cleanCode}.js`, {
            timeout: 6000,
            headers: { 'Referer': 'https://fund.eastmoney.com/' }
        });
        if (!text) {
            console.warn(`[holdings][pingzhongdata] ${cleanCode}: 文本为空（抓取失败/被限流），持仓源不可用`);
            return null;
        }

        const scMatch = text.match(/var stockCodes\s*=\s*(\[[^\]]*\])/);
        if (!scMatch) {
            console.warn(`[holdings][pingzhongdata] ${cleanCode}: 未找到 stockCodes 变量（页面结构变化？）`);
            return null;
        }
        let codes;
        try { codes = JSON.parse(scMatch[1]); } catch { return null; }
        if (!Array.isArray(codes) || codes.length === 0) {
            if (PEN_DEBUG) console.log(`[holdings][pingzhongdata] ${cleanCode}: stockCodes 为空 []（债基/货基/无股票持仓）—— 无需穿透`);
            // 返回空持仓对象而非 null：表示"已成功确认该基金无股票持仓"，
            // 与下方的"抓取失败/被限流返回 null"区分开，让调用方能采用不同的缓存 TTL。
            return { stocks: [], fofs: [] };
        }

        // 股票总仓位（最新值，单位 %）
        let totalPos = 0;
        const posMatch = text.match(/var Data_fundSharesPositions\s*=\s*(\[[\s\S]*?\]);/);
        if (posMatch) {
            try {
                const arr = JSON.parse(posMatch[1]);
                if (Array.isArray(arr) && arr.length) {
                    const last = arr[arr.length - 1];
                    totalPos = parseFloat(Array.isArray(last) ? last[1] : last) || 0;
                }
            } catch {}
        }

        const stocks = codes.map(c => {
            const raw = String(c).trim();
            const code = raw.slice(0, 6);
            const market = /^[69]/.test(code) || /^5/.test(code) ? 'sh' : 'sz';
            return { code, name: '', market, weight: 0 };
        }).filter(s => /^\d{6}$/.test(s.code));
        if (stocks.length === 0) return { stocks: [], fofs: [] };

        // 等权近似：总股票仓位平摊到前十大重仓股
        const perWeight = totalPos > 0 ? round2(totalPos / stocks.length) : 0;
        stocks.forEach(s => { s.weight = perWeight; });

        if (PEN_DEBUG) console.log(`[holdings][pingzhongdata] ${cleanCode}: stockCodes=${stocks.length} totalPos=${totalPos}% perWeight=${perWeight}%`);
        return { stocks, fofs: [] };
    } catch (e) {
        console.warn(`[holdings][pingzhongdata] ${cleanCode} 异常:`, e.message);
        return null;
    }
}


async function fetchPenetrationValuation(code, prevPrice, sharedQuotes) {
    const basePrevPrice = Number(prevPrice) || 0;
    if (!(basePrevPrice > 0)) return null;

    const holdings = await fetchFundHoldingsWithCache(code);
    if (!holdings || (holdings.stocks.length === 0 && holdings.fofs.length === 0)) {
        if (PEN_DEBUG) console.log(`[penetration][${code}] 无可用持仓数据（债基/货基无股票 或 持仓源暂不可用），跳过穿透`);
        return null;
    }

    // 1. 股票穿透估值（二级债基、偏债混合、偏股基金）
    if (holdings.stocks && holdings.stocks.length > 0) {
        // 优先用调用方汇总后一次性拉取的共享行情（整次刷新只发 1 个 push2 请求，
        // 避免 N 只基金各发一个并行请求把东财打爆触发 ERR_EMPTY_RESPONSE 限流）；
        // 未传 sharedQuotes 时仍各自拉取（向后兼容）。
        const stockQuotes = (sharedQuotes && typeof sharedQuotes.get === 'function')
            ? sharedQuotes
            : await fetchStockQuotesBatch(holdings.stocks);
        let matched = 0;
        for (const s of holdings.stocks) if (stockQuotes.has(s.code)) matched++;
        if (PEN_DEBUG) console.log(`[penetration][${code}] 持仓股票=${holdings.stocks.length} 命中行情=${matched} quotesMapSize=${stockQuotes.size}`);
        let totalWeight = 0;
        let weightedSumRate = 0;
        const details = [];

        for (const s of holdings.stocks) {
            const q = stockQuotes.get(s.code);
            if (q && typeof q.rate === 'number') {
                const contrib = round4((q.rate * s.weight) / 100);
                weightedSumRate += contrib;
                totalWeight += s.weight;
                details.push({
                    code: s.code,
                    name: s.name,
                    weight: s.weight,
                    rate: q.rate,
                    contrib
                });
            }
        }

        if (details.length > 0) {
            const finalRate = round2(weightedSumRate);
            const estPrice = round4(basePrevPrice * (1 + finalRate / 100));
            return {
                rate: finalRate,
                price: estPrice,
                isPenetration: true,
                penetrationType: 'stocks',
                totalWeight: round2(totalWeight),
                details
            };
        }
    }

    // 2. FOF 重仓基金穿透估值
    if (holdings.fofs && holdings.fofs.length > 0) {
        const fofCodes = holdings.fofs.map(f => f.code);
        const fofLives = await fetchPrioritizedLiveInfo(fofCodes).catch(() => []);
        const fofLiveMap = new Map((fofLives || []).map(item => [item.code, item.live]));

        let totalWeight = 0;
        let weightedSumRate = 0;
        const details = [];

        for (const f of holdings.fofs) {
            const live = fofLiveMap.get(f.code);
            const rate = typeof live?.rate === 'number' ? live.rate : null;
            if (rate !== null && !isNaN(rate)) {
                const contrib = round4((rate * f.weight) / 100);
                weightedSumRate += contrib;
                totalWeight += f.weight;
                details.push({
                    code: f.code,
                    name: f.name,
                    weight: f.weight,
                    rate,
                    contrib
                });
            }
        }

        if (details.length > 0) {
            const finalRate = round2(weightedSumRate);
            const estPrice = round4(basePrevPrice * (1 + finalRate / 100));
            return {
                rate: finalRate,
                price: estPrice,
                isPenetration: true,
                penetrationType: 'fof',
                totalWeight: round2(totalWeight),
                details
            };
        }
    }

    return null;
}

const SUPPORTED_INDICES = [
    { code: '000001', market: 1, name: '上证指数' },
    { code: '000016', market: 1, name: '上证50' },
    { code: '399001', market: 0, name: '深证成指' },
    { code: '399330', market: 0, name: '深证100' },
    { code: '899050', market: 0, name: '北证50' },
    { code: '000300', market: 1, name: '沪深300' },
    { code: '399006', market: 0, name: '创业板指' },
    { code: '399102', market: 0, name: '创业板综' },
    { code: '399673', market: 0, name: '创业板50' },
    { code: '000688', market: 1, name: '科创50' },
    { code: '399005', market: 0, name: '中小100' },
    { code: '000905', market: 1, name: '中证500' },
    { code: '000906', market: 1, name: '中证800' },
    { code: '000852', market: 1, name: '中证1000' },
    { code: '000903', market: 1, name: '中证A100' },
    { code: '000982', market: 1, name: '500等权' },
    { code: '399303', market: 0, name: '国证2000' },
    { code: '000832', market: 1, name: '中证转债' },
    { code: '000012', market: 1, name: '国债指数' },
    { code: '000013', market: 1, name: '企债指数' },
    { code: 'IXIC', market: 100, name: '纳斯达克' },
    { code: 'NDX', market: 100, name: '纳指100' },
    { code: 'SPX', market: 100, name: '标普500' },
    { code: 'DJI', market: 100, name: '道琼斯' },
    { code: 'HSI', market: 100, name: '恒生指数' },
    { code: 'HSTECH', market: 124, name: '恒生科技' },
    { code: 'N225', market: 100, name: '日经225' },
    { code: 'TPX', market: 155, name: '东证指数' },
    { code: 'KS11', market: 100, name: '韩国综合' },
    { code: 'KQ11', market: 100, name: '韩国创业板' },
];

async function initIndexSettings() {
    const { [CONFIG.INDEX_SETTINGS_STORAGE_KEY]: saved } = await storageHelper.getAll([CONFIG.INDEX_SETTINGS_STORAGE_KEY]);
    indexSettings = Array.isArray(saved) && saved.length > 0 ? saved : SUPPORTED_INDICES.map(idx => idx.code);
    const legacyMap = { UDI: 'IXIC' };
    let migrated = false;
    indexSettings = indexSettings.map(code => {
        if (legacyMap[code]) {
            migrated = true;
            return legacyMap[code];
        }
        return code;
    });
    if (migrated) {
        await storageHelper.setAll({ [CONFIG.INDEX_SETTINGS_STORAGE_KEY]: indexSettings });
    }
}

let _fetchIndexQuotesPromise = null;

async function fetchIndexQuotes() {
    if (_fetchIndexQuotesPromise) return _fetchIndexQuotesPromise;
    _fetchIndexQuotesPromise = _fetchIndexQuotesImpl().finally(() => {
        _fetchIndexQuotesPromise = null;
    });
    return _fetchIndexQuotesPromise;
}

async function _fetchIndexQuotesImpl() {
    if (!indexSettings || indexSettings.length === 0) {
        indexQuotesData = [];
        renderMarketBreadthTicker();
        return;
    }

    const selectedIndices = SUPPORTED_INDICES.filter(idx => indexSettings.includes(idx.code));
    if (selectedIndices.length === 0) return;

    const TENCENT_MAP = {
        IXIC: 'usIXIC',
        NDX: 'usNDX',
        DJI: 'usDJI',
        HSI: 'hkHSI',
        HSTECH: 'hkHSTECH',
    };

    const SINA_MAP = {
        IXIC: 'int_nasdaq',
        SPX: 'int_sp500',
        DJI: 'int_dji',
        HSI: 'int_hangseng',
        N225: 'int_nikkei',
    };

    const YAHOO_MAP = {
        TPX: '%5ETOPX',
        KS11: '%5EKS11',
        KQ11: '%5EKQ11',
        N225: '%5EN225',
        SPX: '%5EGSPC',
    };

    const fetchFromEastmoney = async (indices) => {
        if (indices.length === 0) return [];
        const chunkSize = 5;
        const results = [];
        for (let i = 0; i < indices.length; i += chunkSize) {
            const chunk = indices.slice(i, i + chunkSize);
            const secids = chunk.map(idx => `${idx.market}.${idx.code}`).join(',');
            const settings = getSystemApiSettings('index', MARKET_INDEX_API_SETTINGS);
            if (settings.enabled === false) return results;
            const url = settings.urlTemplate
                .replaceAll('{secids}', encodeURIComponent(secids))
                .replaceAll('{timestamp}', String(Date.now()))
                .replaceAll('{random}', String(Math.random()));
            try {
                if (i > 0) await new Promise(r => setTimeout(r, 300));
                const res = await fetchEastmoneyJson(url, CONFIG.MARKET_BREADTH_TIMEOUT);
                const records = getValueByPath(res, settings.dataPath);
                if (res && res.rc === 0 && Array.isArray(records)) {
                    results.push(...records.map(item => ({
                        code: String(getValueByPath(item, settings.fields.indexCode)),
                        name: String(getValueByPath(item, settings.fields.indexName)),
                        price: (Number(getValueByPath(item, settings.fields.price)) <= 0) ? 0 : Number(getValueByPath(item, settings.fields.price)) / 100,
                        changeRate: Number(getValueByPath(item, settings.fields.changeRate)) === -1 ? 0 : Number(getValueByPath(item, settings.fields.changeRate)) / 100,
                        changeAmount: Number(getValueByPath(item, settings.fields.changeAmount)) === -1 ? 0 : Number(getValueByPath(item, settings.fields.changeAmount)) / 100,
                        marketValue: Number(getValueByPath(item, settings.fields.marketValue)) > 0 ? Number(getValueByPath(item, settings.fields.marketValue)) : undefined,
                    })));
                }
            } catch (e) {
                console.warn('[indexQuotes] 东财接口异常:', e);
            }
        }
        return results;
    };

    const fetchFromTencent = async (missingCodes) => {
        const settings = getEnabledApiProfileBySource('market_index_tencent', MARKET_INDEX_TENCENT_API_SETTINGS);
        if (!settings || settings.enabled === false) return [];
        const codes = missingCodes.filter(c => TENCENT_MAP[c]);
        if (codes.length === 0) return [];
        try {
            const query = codes.map(c => TENCENT_MAP[c]).join(',');
            const url = settings.urlTemplate
                .replaceAll('{codes}', encodeURIComponent(query))
                .replaceAll('{timestamp}', String(Date.now()))
                .replaceAll('{random}', String(Math.random()));
            const resp = await fetch(url);
            const text = await resp.text();
            const results = [];
            text.split(';').forEach(line => {
                const match = line.match(/v_([a-zA-Z0-9_]+)="(.+)"/);
                if (!match) return;
                const parts = match[2].split('~');
                const origCode = Object.keys(TENCENT_MAP).find(k => TENCENT_MAP[k] === match[1]);
                if (!origCode || parts.length <= 32) return;
                const price = parseFloat(parts[3]);
                if (!price || price <= 0) return;
                const info = SUPPORTED_INDICES.find(s => s.code === origCode);
                results.push({
                    code: origCode,
                    name: info?.name || parts[1],
                    price,
                    changeAmount: parseFloat(parts[31]) || 0,
                    changeRate: parseFloat(parts[32]) || 0,
                });
            });
            return results;
        } catch (e) {
            console.warn('[Tencent] 备用接口失败:', e);
            return [];
        }
    };

    const fetchFromSina = async (missingCodes) => {
        const settings = getEnabledApiProfileBySource('market_index_sina', MARKET_INDEX_SINA_API_SETTINGS);
        if (!settings || settings.enabled === false) return [];
        const codes = missingCodes.filter(c => SINA_MAP[c]);
        if (codes.length === 0) return [];
        try {
            // 新浪 hq.sinajs.cn 支持 list=code1,code2 批量：一次代理请求拿回全部缺失指数，
            // 避免东财主源故障时逐 code 串行往返（N 次代理延迟叠加，极易超时）
            const sinaCodes = codes.map(c => SINA_MAP[c]);
            const joined = sinaCodes.join(',');
            const url = settings.urlTemplate
                .replaceAll('{codes}', encodeURIComponent(joined))
                .replaceAll('{code}', encodeURIComponent(joined))
                .replaceAll('{timestamp}', String(Date.now()))
                .replaceAll('{random}', String(Math.random()));
            const text = await proxyFetchSina(url);
            if (!text) return [];
            // 批量响应按行返回：var hq_str_int_nasdaq="..."; 逐行提取载荷
            const payloadBySinaCode = new Map();
            text.split('\n').forEach(line => {
                const match = line.match(/hq_str_([^=]+)="([^"]*)"/);
                if (match) payloadBySinaCode.set(match[1].trim(), match[2]);
            });
            const results = [];
            for (let i = 0; i < codes.length; i++) {
                const code = codes[i];
                const raw = payloadBySinaCode.get(sinaCodes[i]);
                if (!raw) continue;
                const parts = raw.split(',');
                if (parts.length < 4) continue;
                const price = parseFloat(parts[1]);
                const changeAmount = parseFloat(parts[2]);
                const changeRate = parseFloat(parts[3]);
                if (!price || price <= 0) continue;
                const info = SUPPORTED_INDICES.find(s => s.code === code);
                results.push({
                    code,
                    name: info?.name || code,
                    price,
                    changeAmount: isNaN(changeAmount) ? 0 : changeAmount,
                    changeRate: isNaN(changeRate) ? 0 : changeRate,
                });
            }
            return results;
        } catch (e) {
            console.warn('[Sina] 备用接口失败:', e);
            return [];
        }
    };

    const fetchFromYahoo = async (missingCodes) => {
        const settings = getEnabledApiProfileBySource('market_index_yahoo', MARKET_INDEX_YAHOO_API_SETTINGS);
        if (!settings || settings.enabled === false) return [];
        const codes = missingCodes.filter(c => YAHOO_MAP[c]);
        if (codes.length === 0) return [];
        const results = [];
        for (const code of codes) {
            try {
                const url = settings.urlTemplate
                    .replaceAll('{code}', YAHOO_MAP[code])
                    .replaceAll('{codes}', YAHOO_MAP[code])
                    .replaceAll('{timestamp}', String(Date.now()))
                    .replaceAll('{random}', String(Math.random()));
                const resp = await fetch(url, { headers: { Accept: 'application/json' } });
                const json = await resp.json();
                const meta = json?.chart?.result?.[0]?.meta;
                if (!meta || !(meta.regularMarketPrice > 0)) continue;
                const price = meta.regularMarketPrice;
                const prevClose = meta.chartPreviousClose || meta.previousClose || price;
                const changeAmount = price - prevClose;
                const changeRate = prevClose > 0 ? (changeAmount / prevClose) * 100 : 0;
                const info = SUPPORTED_INDICES.find(s => s.code === code);
                results.push({ code, name: info?.name || code, price, changeAmount, changeRate });
            } catch (e) {
                console.warn(`[Yahoo] ${code} 获取失败:`, e.message);
            }
        }
        return results;
    };

    const mainData = await fetchFromEastmoney(selectedIndices);
    let successCodes = new Set(mainData.filter(d => d.price > 0).map(d => d.code));
    let combinedData = mainData.filter(d => d.price > 0);
    let missingCodes = indexSettings.filter(c => !successCodes.has(c));

    if (missingCodes.length > 0) {
        const tencentData = await fetchFromTencent(missingCodes);
        tencentData.forEach(f => {
            if (f.price > 0) {
                combinedData.push(f);
                successCodes.add(f.code);
            }
        });
        missingCodes = missingCodes.filter(c => !successCodes.has(c));
    }

    if (missingCodes.length > 0) {
        const sinaData = await fetchFromSina(missingCodes);
        sinaData.forEach(f => {
            if (f.price > 0) {
                combinedData.push(f);
                successCodes.add(f.code);
            }
        });
        missingCodes = missingCodes.filter(c => !successCodes.has(c));
    }

    if (missingCodes.length > 0) {
        const yahooData = await fetchFromYahoo(missingCodes);
        yahooData.forEach(f => {
            if (f.price > 0) {
                combinedData.push(f);
                successCodes.add(f.code);
            }
        });
    }

    const snapshot = await storageHelper.getAll([CONFIG.INDEX_QUOTES_STORAGE_KEY]);
    const rawSnapshot = snapshot?.[CONFIG.INDEX_QUOTES_STORAGE_KEY];
    const oldData = Array.isArray(rawSnapshot?.data)
        ? rawSnapshot.data
        : (Array.isArray(rawSnapshot) ? rawSnapshot : []);

    indexQuotesData = indexSettings.map(code => {
        const fresh = combinedData.find(d => d.code === code);
        if (fresh && fresh.price > 0) return fresh;
        const cached = oldData.find(d => d.code === code);
        return (cached && cached.price > 0) ? cached : null;
    }).filter(Boolean);

    if (indexQuotesData.length > 0) {
        await persistIndexQuotesSnapshot(indexQuotesData);
    }
}

async function fetchMarketBreadth() {
    const settings = getSystemApiSettings('breadth', MARKET_BREADTH_API_SETTINGS);
    if (settings.enabled === false) throw new Error('市场涨跌接口已停用');
    const quoteUrl = settings.urlTemplate
        .replaceAll('{timestamp}', String(Date.now()))
        .replaceAll('{random}', String(Math.random()));
    const changesUrl = (settings.secondaryUrlTemplate || MARKET_BREADTH_API_SETTINGS.secondaryUrlTemplate)
        .replaceAll('{timestamp}', String(Date.now()))
        .replaceAll('{random}', String(Math.random()));

    const [quoteData, changesData] = await Promise.all([
        fetchEastmoneyJson(quoteUrl, CONFIG.MARKET_BREADTH_TIMEOUT),
        fetchEastmoneyJson(changesUrl, CONFIG.MARKET_BREADTH_TIMEOUT)
    ]);

    const quoteRecords = getValueByPath(quoteData, settings.dataPath);
    const limitRecords = getValueByPath(changesData, settings.secondaryDataPath);
    if (!quoteData || quoteData.rc !== 0 || !Array.isArray(quoteRecords)) {
        throw new Error('上涨下跌家数接口不可用');
    }
    if (!changesData || changesData.rc !== 0 || !Array.isArray(limitRecords)) {
        throw new Error('涨跌停家数接口不可用');
    }

    const up = quoteRecords.reduce((sum, item) => sum + (Number(getValueByPath(item, settings.fields.upCount)) || 0), 0);
    const down = quoteRecords.reduce((sum, item) => sum + (Number(getValueByPath(item, settings.fields.downCount)) || 0), 0);
    const limitUpItem = limitRecords.find(item => Number(getValueByPath(item, settings.fields.limitType)) === 4);
    const limitDownItem = limitRecords.find(item => Number(getValueByPath(item, settings.fields.limitType)) === 8);
    const limitUp = Number(getValueByPath(limitUpItem, settings.fields.limitCount)) || 0;
    const limitDown = Number(getValueByPath(limitDownItem, settings.fields.limitCount)) || 0;
    // f106（平盘）为全市场值，两 board 记录回显同一数字，取首行避免翻倍
    const flat = quoteRecords.length ? (Number(getValueByPath(quoteRecords[0], settings.fields.flatCount)) || 0) : 0;

    return { limitUp, up, down, limitDown, flat };
}

async function refreshMarketBreadth(forceSkip = false) {
    if (forceSkip) {
        renderMarketBreadthTicker(marketBreadthData);
        return marketBreadthData;
    }

    const results = await Promise.allSettled([
        fetchMarketBreadth(),
        fetchIndexQuotes()
    ]);

    if (results[0].status === 'fulfilled' && results[0].value) {
        marketBreadthData = sanitizeMarketBreadthData(results[0].value);
        if (marketBreadthData) {
            await persistMarketBreadthSnapshot(marketBreadthData);
        }
    } else {
        const err = results[0].reason;
        console.warn('[marketBreadth] 广度数据刷新失败:', err);
        if (!marketBreadthData) {
            const fallback = await restoreMarketBreadthSnapshot();
            if (fallback) marketBreadthData = fallback;
        }
    }

    if (results[1].status === 'rejected' || (results[1].status === 'fulfilled' && indexQuotesData.length === 0)) {
        console.warn('[indexQuotes] 指数行情刷新失败或为空:', results[1].reason || 'Empty Data');
        if (indexQuotesData.length === 0) {
            indexQuotesData = await restoreIndexQuotesSnapshot();
        }
    }

    renderMarketBreadthTicker(marketBreadthData);
    return marketBreadthData;
}

function parseFundPeriodReturnResponse(payload) {
    const periodMap = {
        Z: 'w1',
        Y: 'm1',
        '3Y': 'm3',
        '6Y': 'm6',
        '1N': 'y1',
        LN: 'ly'
    };
    const result = { w1: null, m1: null, m3: null, m6: null, y1: null, ly: null };
    let recognizedCount = 0;

    if (!Array.isArray(payload?.Datas)) return null;
    payload.Datas.forEach(item => {
        const field = periodMap[item?.title];
        if (!field) return;
        recognizedCount++;
        const value = Number.parseFloat(item?.syl);
        result[field] = Number.isFinite(value) ? round2(value) : null;
    });

    return recognizedCount > 0 ? { ...result, source: 'official' } : null;
}

async function fetchFundPeriodReturns(code) {
    const cleanCode = String(code || '').trim();
    if (!/^\d{6}$/.test(cleanCode)) return null;

    try {
        const params = new URLSearchParams({
            FCODE: cleanCode,
            deviceid: 'Wap',
            plat: 'Wap',
            product: 'EFund',
            version: '2.0.0'
        });
        // 与 tryFetchFundMobapi 等同类接口保持一致：走 fetchEastmoneyJson（直连失败自动降级带 Referer 的代理），
        // 裸 fetch 不带 Referer 会被东财风控软失败返回 Datas=null
        const json = await fetchEastmoneyJson(
            `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNPeriodIncrease?${params}`,
            CONFIG.API_TIMEOUT
        );
        if (!json) throw new Error('接口无响应');
        return parseFundPeriodReturnResponse(json);
    } catch (error) {
        console.warn(`[fetchFundPeriodReturns] ${cleanCode} 官方区间收益获取失败:`, error.message);
        return null;
    }
}

async function fetchComparisonData(code) {
    try {
        const text = await fetchPrioritizedHistoryText(code);

        const parseDataArray = (data) => {
            if (!Array.isArray(data)) return null;
            return data.map(item => {
                if (Array.isArray(item)) {
                    return { date: formatDate(item[0]), rate: parseFloat(item[1]) || 0 };
                }
                return { date: formatDate(item.x), rate: parseFloat(item.y) || 0 };
            });
        };

        const parseVariable = (varName) => {
            const match = text.match(new RegExp(`var\\s+${varName}\\s*=\\s*(\\[[\\s\\S]+?\\]);`));
            if (!match) return null;
            try {
                return parseDataArray(JSON.parse(match[1]));
            } catch (e) {
                console.warn(`[fetchComparisonData] ${varName} 解析失败`, e);
            }
            return null;
        };

        let fundSeries = null;
        let similarAvg = null;
        let benchmark = null;
        let benchmarkLabel = '沪深300';

        const grandMatch = text.match(/var\s+Data_grandTotal\s*=\s*(\[[\s\S]+?\]);/);
        if (grandMatch) {
            try {
                const grandTotal = JSON.parse(grandMatch[1]);
                if (Array.isArray(grandTotal)) {
                    if (grandTotal[0]?.data) {
                        fundSeries = parseDataArray(grandTotal[0].data);
                    }
                    const similarEntry = grandTotal.find(e => e.name === '同类平均');
                    if (similarEntry) similarAvg = parseDataArray(similarEntry.data);

                    const fundName = grandTotal[0]?.name || '';
                    const benchEntry = grandTotal.find((e, index) =>
                        index > 0 &&
                        e.name !== '本基金' &&
                        e.name !== '同类平均' &&
                        !e.name.includes(code) &&
                        e.name !== fundName
                    );

                    if (benchEntry) {
                        benchmark = parseDataArray(benchEntry.data);
                        benchmarkLabel = benchEntry.name;
                    }
                }
            } catch (e) {
                console.warn('[fetchComparisonData] Data_grandTotal 解析失败', e);
            }
        }

        if (!similarAvg) {
            similarAvg = parseVariable('Data_similarType');
        }
        if (!benchmark) {
            benchmark = parseVariable('Data_index000300') || parseVariable('Data_rateInSimilarPersent');
            if (!benchmark) benchmarkLabel = '业绩基准';
        }

        return { fundSeries, similarAvg, benchmark, benchmarkLabel };
    } catch (e) {
        console.error('[fetchComparisonData] 获取对比数据失败:', e);
        return null;
    }
}

async function fetchFundNetValues(code, startDate, endDate, pageSize = 200, { preferFullHistory = false } = {}) {
    try {
        if (!preferFullHistory) {
            const url = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNHisNetList?FCODE=${code}&PAGEINDEX=1&PAGESIZE=${pageSize}&SDATE=${startDate}&EDATE=${endDate}&deviceid=wap&plat=Wap`;
            const res = await fetch(url);
            const data = await res.json();

            if (Array.isArray(data?.Datas) && data.Datas.length > 0) {
                const results = data.Datas.reverse().map((item, i, arr) => {
                    const price = parseFloat(item.DWJZ);
                    // 接口日涨幅已处理分红和份额折算；缺失时才按单位净值补算。
                    let dailyRate = item.JZZZL ? parseFloat(item.JZZZL) : null;
                    if (!Number.isFinite(dailyRate) && i > 0) {
                        const prevPrice = parseFloat(arr[i - 1].DWJZ);
                        if (prevPrice > 0) dailyRate = round2(((price - prevPrice) / prevPrice) * 100);
                    }
                    return {
                        date: item.FSRQ,
                        price,
                        acPrice: item.LJJZ ? parseFloat(item.LJJZ) : null,
                        dailyRate
                    };
                });
                if (results.length > 0) {
                    const fundInfo = typeof allFundsData !== 'undefined' ? allFundsData.find(f => f.code === code) : null;
                    const fundName = fundInfo?.name || '';
                    HistoryDB.batchPut(results.map(r => ({ ...r, code, name: fundName, rate: r.dailyRate })));
                }
                return results;
            }
        }

        const text = await fetchPrioritizedHistoryText(code);

        const match = text.match(/var\s+Data_netWorthTrend\s*=\s*(\[[\s\S]+?\]);/);
        const acMatchInner = text.match(/var\s+Data_ACWorthTrend\s*=\s*(\[[\s\S]+?\]);/);
        const acMapInner = new Map();
        if (acMatchInner) {
            try {
                const acData = JSON.parse(acMatchInner[1]);
                if (Array.isArray(acData)) {
                    acData.forEach(item => acMapInner.set(item[0], parseFloat(item[1])));
                }
            } catch (e) {
                console.warn('[fetchFundNetValues] Data_ACWorthTrend 解析失败', e);
            }
        }
        if (match) {
            try {
                const trendData = JSON.parse(match[1]);
                if (Array.isArray(trendData) && trendData.length > 0) {
                    const endTime = new Date(endDate).getTime();

                    // 全量历史：趋势数据本身就是基金成立日→今天能提供的全部，
                    // 不施加起始日期下界限制（避免裁掉早期历史），仅按今天截断上界
                    const filtered = trendData
                        .filter(item => item.x <= endTime)
                        .map((item, i, arr) => {
                            const price = parseFloat(item.y);
                            // equityReturn 已处理分红和份额折算；缺失时才按单位净值补算。
                            let dailyRate = typeof item.equityReturn !== 'undefined'
                                ? parseFloat(item.equityReturn)
                                : null;
                            if (!Number.isFinite(dailyRate) && i > 0) {
                                const prevPrice = parseFloat(arr[i - 1].y);
                                if (prevPrice > 0) dailyRate = round2(((price - prevPrice) / prevPrice) * 100);
                            }
                            return {
                                date: formatDate(item.x),
                                price,
                                acPrice: acMapInner.get(item.x) || null,
                                dailyRate,
                                dividend: item.unitMoney || ''
                            };
                        });

                    if (filtered.length > 0) {
                        const fundInfo = typeof allFundsData !== 'undefined' ? allFundsData.find(f => f.code === code) : null;
                        const fundName = fundInfo?.name || '';
                        HistoryDB.batchPut(filtered.map(f => ({ ...f, code, name: fundName, rate: f.dailyRate })));
                        return filtered;
                    }
                    return [];
                }
            } catch (parseErr) {
                console.warn(`[fetchFundNetValues] ${code} 全历史接口解析失败:`, parseErr);
            }
        }

        return null;
    } catch (e) {
        console.error('[fetchFundNetValues] 获取基金净值失败:', e);
        return null;
    }
}
