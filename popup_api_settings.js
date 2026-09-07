const LIVE_API_FIELD_DEFAULTS = Object.freeze({
    code: 'code',
    name: 'name',
    prevPrice: 'dwjz',
    price: 'gsz',
    rate: 'gszzl',
    date: 'jzrq',
    time: 'gztime'
});

const HOLDINGS_API_FIELD_DEFAULTS = Object.freeze({
    stockCode: 'GPDM', stockName: 'GPJC', holdingPercent: 'JZBL', exchange: 'TEXCH', newExchange: 'NEWTEXCH'
});
const INDEX_API_FIELD_DEFAULTS = Object.freeze({
    indexCode: 'f12', indexName: 'f14', price: 'f2', changeAmount: 'f4', changeRate: 'f3', marketValue: 'f20'
});
const BREADTH_API_FIELD_DEFAULTS = Object.freeze({
    upCount: 'f104', downCount: 'f105', flatCount: 'f106', limitType: 't', limitCount: 'ct'
});

const API_FIELD_LAYOUTS = Object.freeze({
    live: [
        ['fieldCode', 'code', '基金代码字段路径'], ['fieldName', 'name', '名称字段路径'],
        ['fieldPrevPrice', 'prevPrice', '上期净值字段路径'], ['fieldPrice', 'price', '当前估值字段路径'],
        ['fieldRate', 'rate', '涨跌率字段路径'], ['fieldDate', 'date', '净值日期字段路径'],
        ['fieldTime', 'time', '估值时间字段路径']
    ],
    history: [
        ['fieldCode', 'code', '基金代码字段路径'], ['fieldName', 'name', '基金名称字段路径'],
        ['fieldPrice', 'price', '单位净值字段路径'], ['fieldRate', 'rate', '净值涨跌幅字段路径'],
        ['fieldDate', 'date', '净值日期字段路径']
    ],
    holdings: [
        ['fieldCode', 'stockCode', '股票代码字段路径'], ['fieldName', 'stockName', '股票名称字段路径'],
        ['fieldPrevPrice', 'holdingPercent', '持仓占比字段路径'], ['fieldPrice', 'exchange', '交易所字段路径'],
        ['fieldRate', 'newExchange', '新交易所字段路径']
    ],
    index: [
        ['fieldCode', 'indexCode', '指数代码字段路径'], ['fieldName', 'indexName', '指数名称字段路径'],
        ['fieldPrevPrice', 'price', '指数点位字段路径'], ['fieldPrice', 'changeAmount', '涨跌额字段路径'],
        ['fieldRate', 'changeRate', '涨跌幅字段路径'], ['fieldDate', 'marketValue', '市场规模字段路径']
    ],
    breadth: [
        ['fieldCode', 'upCount', '上涨家数字段路径'], ['fieldName', 'downCount', '下跌家数字段路径'],
        ['fieldDate', 'flatCount', '平盘家数字段路径'], ['fieldPrevPrice', 'limitType', '涨跌停类型字段路径'], ['fieldPrice', 'limitCount', '涨跌停家数字段路径']
    ],
    // 节假日历无字段映射：空布局让所有映射输入框在表单里自动隐藏
    calendar: []
});

const DEFAULT_LIVE_API_SETTINGS = Object.freeze({
    source: 'fundgz',
    name: '天天基金',
    urlTemplate: 'https://fundgz.1234567.com.cn/js/{code}.js?rt={timestamp}',
    responseType: 'jsonp',
    dataPath: '',
    dataKind: 'estimate',
    requestMode: 'single',
    fields: LIVE_API_FIELD_DEFAULTS
});

const WEALTHAGENT_LIVE_API_SETTINGS = Object.freeze({
    source: 'wealthagent',
    name: 'WealthAgent（本机）',
    urlTemplate: 'http://127.0.0.1:8000/api/valuation/{code}',
    responseType: 'json',
    dataPath: 'data',
    dataKind: 'estimate',
    requestMode: 'batch',
    fields: {
        code: 'fund_code',
        name: 'fund_name',
        prevPrice: 'previous_nav',
        price: 'estimated_nav',
        rate: 'estimated_change_percent',
        date: 'nav_date',
        time: 'timestamp'
    }
});

const FUND_VALUATION_LAST_SETTINGS = Object.freeze({
    source: 'fundvaluationlast',
    name: '天天基金新估值（批量）',
    urlTemplate: 'https://fundcomapi.tiantianfunds.com/mm/newCore/FundValuationLast?FCODES={codes}&FIELDS=FCODE,SHORTNAME,GSZZL,GZTIME,GSZ,NAV,PDATE',
    responseType: 'json',
    dataPath: 'data',
    dataKind: 'estimate',
    requestMode: 'batch',
    fields: {
        code: 'FCODE',
        name: 'SHORTNAME',
        prevPrice: 'NAV',
        price: 'GSZ',
        rate: 'GSZZL',
        date: 'PDATE',
        time: 'GZTIME'
    }
});

const FUND_VALUATION_LAST_SINGLE_SETTINGS = Object.freeze({
    source: 'fundvaluationlast_single',
    name: '天天基金新估值（逐个）',
    urlTemplate: 'https://fundcomapi.tiantianfunds.com/mm/newCore/FundValuationLast?FCODES={code}&FIELDS=FCODE,SHORTNAME,GSZZL,GZTIME,GSZ,NAV,PDATE',
    responseType: 'json',
    dataPath: 'data',
    dataKind: 'estimate',
    requestMode: 'single',
    fields: {
        code: 'FCODE',
        name: 'SHORTNAME',
        prevPrice: 'NAV',
        price: 'GSZ',
        rate: 'GSZZL',
        date: 'PDATE',
        time: 'GZTIME'
    }
});

const SINA_LIVE_API_SETTINGS = Object.freeze({
    source: 'sina',
    category: 'live',
    enabled: true,
    name: '新浪财经估值（逐个）',
    urlTemplate: 'https://stock.finance.sina.com.cn/fundInfo/api/openapi.php/FdFundService.getEstimateNetworthPic?symbol={code}',
    responseType: 'json', dataPath: 'result.data.networth[last]', dataKind: 'estimate', requestMode: 'single',
    fields: { code: '', name: '', prevPrice: '', price: 'pre_nav', rate: 'nav_pct', date: 'pre_date', time: 'min_time' }
});

const EASTMONEY_HISTORY_API_SETTINGS = Object.freeze({
    source: 'eastmoney_history',
    category: 'history',
    enabled: true,
    name: '天天基金历史净值',
    urlTemplate: 'https://fund.eastmoney.com/pingzhongdata/{code}.js?v={timestamp}',
    responseType: 'eastmoney_js', dataPath: 'Data_netWorthTrend', dataKind: 'nav', requestMode: 'single',
    fields: { code: '', name: 'fS_name', prevPrice: '', price: 'y', rate: 'equityReturn', date: 'x', time: '' }
});

const FUND_HOLDINGS_API_SETTINGS = Object.freeze({
    source: 'fund_holdings', category: 'holdings', enabled: true,
    name: '基金前十重仓股票',
    urlTemplate: 'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition?FCODE={code}&deviceid=Wap&plat=Wap&product=EFund&version=6.5.9',
    secondaryUrlTemplate: 'http://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code={code}&topline=10&year=&month=&rt={random}',
    responseType: 'json', dataPath: 'Datas.fundStocks', dataKind: 'estimate', requestMode: 'single',
    fields: HOLDINGS_API_FIELD_DEFAULTS
});

const MARKET_INDEX_API_SETTINGS = Object.freeze({
    source: 'market_index', category: 'index', enabled: true,
    name: '市场指数行情',
    urlTemplate: 'https://push2.eastmoney.com/api/qt/ulist.np/get?secids={secids}&ut=bd1d9ddb04089700cf9c27f6f7426281&invt=2&fields=f14,f12,f13,f2,f3,f4,f20',
    responseType: 'json', dataPath: 'data.diff', dataKind: 'estimate', requestMode: 'batch',
    fields: INDEX_API_FIELD_DEFAULTS
});

const MARKET_INDEX_TENCENT_API_SETTINGS = Object.freeze({
    source: 'market_index_tencent', category: 'index', enabled: true,
    name: '市场指数备用（腾讯）',
    urlTemplate: 'https://qt.gtimg.cn/q={codes}',
    responseType: 'tencent_index', dataPath: '', dataKind: 'estimate', requestMode: 'batch',
    fields: INDEX_API_FIELD_DEFAULTS
});

const MARKET_INDEX_SINA_API_SETTINGS = Object.freeze({
    source: 'market_index_sina', category: 'index', enabled: true,
    name: '市场指数备用（新浪）',
    urlTemplate: 'https://hq.sinajs.cn/list={codes}',
    responseType: 'sina_index', dataPath: '', dataKind: 'estimate', requestMode: 'batch',
    fields: INDEX_API_FIELD_DEFAULTS
});

const MARKET_INDEX_YAHOO_API_SETTINGS = Object.freeze({
    source: 'market_index_yahoo', category: 'index', enabled: true,
    name: '市场指数备用（Yahoo）',
    urlTemplate: 'https://query1.finance.yahoo.com/v8/finance/chart/{code}?range=1d&interval=1d',
    responseType: 'yahoo_index', dataPath: '', dataKind: 'estimate', requestMode: 'batch',
    fields: INDEX_API_FIELD_DEFAULTS
});

const MARKET_BREADTH_API_SETTINGS = Object.freeze({
    source: 'market_breadth', category: 'breadth', enabled: true,
    name: '市场涨跌情况',
    urlTemplate: 'https://push2.eastmoney.com/api/qt/ulist.np/get?secids=1.000001,0.399001&ut=bd1d9ddb04089700cf9c27f6f7426281&invt=2&fields=f14,f12,f13,f104,f105,f106',
    secondaryUrlTemplate: 'https://push2ex.eastmoney.com/getStockCountChanges?type=4,8&ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wzchanges',
    secondaryDataPath: 'data.ydlist',
    responseType: 'json', dataPath: 'data.diff', dataKind: 'estimate', requestMode: 'batch',
    fields: BREADTH_API_FIELD_DEFAULTS
});

const HOLIDAY_CALENDAR_API_SETTINGS = Object.freeze({
    source: 'holiday_calendar', category: 'calendar', enabled: true,
    name: '节假日历（holiday-cn）',
    urlTemplate: 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json',
    responseType: 'json', dataPath: 'days', dataKind: 'estimate', requestMode: 'single',
    fields: LIVE_API_FIELD_DEFAULTS
});

const API_CATEGORIES = Object.freeze(['live', 'history', 'holdings', 'index', 'breadth', 'calendar']);
const API_CATEGORY_LABELS = Object.freeze({ live: '实时', history: '历史', holdings: '重仓', index: '指数', breadth: '涨跌', calendar: '日历' });

let liveApiSettings = normalizeLiveApiSettings(null);
let liveApiProfiles = [];
let activeLiveApiProfileId = '';

function getLiveApiTimeout() {
    return liveApiSettings.source === 'wealthagent' ? 45000 : CONFIG.API_TIMEOUT;
}


async function fetchConfiguredLiveApiText(url, timeout = getLiveApiTimeout()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.text();
    } finally {
        clearTimeout(timer);
    }
}

function getConfiguredSystemApiHeaders(url) {
    const headers = {
        'Referer': 'https://fund.eastmoney.com/',
        'Accept': 'application/json, text/plain, */*'
    };
    if (safeString(url, '').startsWith('http://fundf10.eastmoney.com/')) {
        let code = '000001';
        try {
            code = new URL(url).searchParams.get('code') || code;
        } catch (_) {}
        headers.Referer = `http://fundf10.eastmoney.com/ccmx_${code}.html`;
        headers.Accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
    }
    return headers;
}

async function fetchConfiguredSystemApiText(url, timeout = 15000, headers = {}) {
    const requiresProxy = safeString(url, '').startsWith('http://fundf10.eastmoney.com/');
    if (typeof proxyFetchText === 'function') {
        const proxied = await proxyFetchText(url, {
            timeout,
            headers: { ...getConfiguredSystemApiHeaders(url), ...headers }
        });
        if (proxied) return proxied;
    }
    if (requiresProxy) throw new Error('F10 备用接口未返回持仓数据');
    return fetchConfiguredLiveApiText(url, timeout);
}

function mapConfiguredLiveApiData(data, settings = liveApiSettings) {
    if (!data || typeof data !== 'object') return null;
    const fields = settings.fields || LIVE_API_FIELD_DEFAULTS;
    return {
        name: getValueByPath(data, fields.name),
        dwjz: getValueByPath(data, fields.prevPrice),
        gsz: getValueByPath(data, fields.price),
        gszzl: getValueByPath(data, fields.rate),
        jzrq: getValueByPath(data, fields.date),
        gztime: getValueByPath(data, fields.time),
        dataKind: settings.dataKind
    };
}

function toConfiguredLiveInfo(data, code, settings = liveApiSettings) {
    const mapped = mapConfiguredLiveApiData(data, settings);
    if (!mapped || (!mapped.gsz && !mapped.dwjz)) return null;
    const rawRate = mapped.gszzl;
    const parsedRate = rawRate === null || rawRate === undefined || rawRate === ''
        ? null
        : parseFloat(rawRate);
    return {
        name: mapped.name || `[未知]${code}`,
        rate: mapped.dataKind === 'nav' || !Number.isFinite(parsedRate) ? null : parsedRate,
        price: parseFloat(mapped.gsz || mapped.dwjz) || 0,
        prevPrice: parseFloat(mapped.dwjz) || 0,
        prevPriceDate: mapped.jzrq || '',
        priceTime: mapped.gztime || ''
    };
}

function getWealthAgentBatchUrl(settings = liveApiSettings) {
    return settings.urlTemplate.replace('/{code}', '/batch');
}

async function fetchFundValuationLastChunk(codes, settings = FUND_VALUATION_LAST_SETTINGS) {
    const primaryUrl = buildLiveApiBatchUrl(codes, settings);
    const urls = [primaryUrl];
    if (primaryUrl.includes('fundcomapi.tiantianfunds.com')) {
        urls.push(primaryUrl.replace('fundcomapi.tiantianfunds.com', 'fundcomapi.eastmoney.com'));
    }
    let lastError = null;
    for (const url of urls) {
        try {
            const text = await fetchConfiguredLiveApiText(url, 10000);
            const payload = JSON.parse(text);
            if (!payload?.success || !Array.isArray(payload.data)) throw new Error('接口未返回有效数据');
            return payload.data;
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('天天基金新估值接口不可用');
}

function toFundValuationLastLiveInfo(item, code) {
    const toNullableNumber = value => {
        if (value === null || value === undefined || value === '') return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    };
    const nav = toNullableNumber(item?.NAV);
    const gsz = toNullableNumber(item?.GSZ);
    const rate = toNullableNumber(item?.GSZZL);
    const hasEstimate = gsz !== null && rate !== null;
    return {
        name: safeString(item?.SHORTNAME, `[未知]${code}`),
        rate: hasEstimate ? rate : null,
        price: hasEstimate ? gsz : (nav ?? 0),
        prevPrice: nav ?? 0,
        prevPriceDate: safeString(item?.PDATE, ''),
        priceTime: safeString(item?.GZTIME, '')
    };
}

function parseSinaFundValuation(text, code, baseLive) {
    const source = safeString(text, '').trim();
    if (!source) return null;

    let payload;
    try {
        payload = JSON.parse(source);
    } catch (_) {
        const wrapped = source.match(/^[^(]*\(([\s\S]*)\)\s*;?$/);
        if (!wrapped) return null;
        try {
            payload = JSON.parse(wrapped[1]);
        } catch (_) {
            return null;
        }
    }

    const data = payload?.result?.data;
    const points = safeArray(data?.networth, []);
    if (payload?.result?.status?.code !== 0 || points.length === 0) return null;

    const closeTime = `${safeString(data?.time_range?.[1]?.[1], '15:00')}:00`;
    const point = [...points].reverse().find(item => safeString(item?.min_time, '') <= closeTime) || points[points.length - 1];
    const estimateDate = normalizePerfDate(point?.pre_date || data?.date || data?.gzdate || '') || getToday();
    const price = Number(point?.pre_nav);
    const rate = Number(point?.nav_pct);
    if (!Number.isFinite(price) || !Number.isFinite(rate)) return null;

    return {
        ...baseLive,
        name: baseLive?.name || `[未知]${code}`,
        price,
        rate,
        priceTime: `${estimateDate} ${safeString(point?.min_time, '').slice(0, 5)}`,
        valuationSource: 'sina'
    };
}

async function fetchSinaFundValuation(code, baseLive, settings = SINA_LIVE_API_SETTINGS) {
    const url = buildLiveApiUrl(code, settings);
    try {
        const text = settings.category === 'holdings'
            ? await fetchConfiguredSystemApiText(url, 10000)
            : await fetchConfiguredLiveApiText(url, 10000);
        return parseSinaFundValuation(text, code, baseLive);
    } catch (error) {
        console.warn('[live-api] 新浪估值补缺失败:', code, error.message);
        return null;
    }
}

async function fillMissingFundValuationsFromSina(results, settings = SINA_LIVE_API_SETTINGS) {
    const missingIndexes = results
        .map((result, index) => result?.live?.rate === null ? index : -1)
        .filter(index => index >= 0);

    for (let offset = 0; offset < missingIndexes.length; offset += 5) {
        const indexes = missingIndexes.slice(offset, offset + 5);
        const values = await Promise.all(indexes.map(index =>
            fetchSinaFundValuation(results[index].code, results[index].live, settings)
        ));
        values.forEach((live, valueIndex) => {
            if (live) results[indexes[valueIndex]].live = live;
        });
    }
    return results;
}

async function fetchFundValuationLastBatchLiveInfo(codes, settings = FUND_VALUATION_LAST_SETTINGS) {
    const resultByCode = new Map();
    for (let index = 0; index < codes.length; index += 50) {
        const chunk = codes.slice(index, index + 50);
        const items = await fetchFundValuationLastChunk(chunk, settings);
        items.forEach(item => resultByCode.set(String(item?.FCODE || ''), item));
    }
    const results = codes.map(code => ({ code, live: toFundValuationLastLiveInfo(resultByCode.get(code), code) }));
    return results;
}

async function fetchFundValuationLastSingleLiveInfo(codes, settings = FUND_VALUATION_LAST_SINGLE_SETTINGS) {
    const results = [];
    for (const code of codes) {
        const text = await fetchConfiguredLiveApiText(buildLiveApiUrl(code, settings), 10000);
        const payload = JSON.parse(text);
        const item = Array.isArray(payload?.data) ? payload.data[0] : payload?.data;
        results.push({ code, live: toFundValuationLastLiveInfo(item, code) });
    }
    return results;
}

async function fetchWealthAgentBatchLiveInfo(codes, settings = liveApiSettings) {
    const timeout = Math.min(240000, Math.max(60000, codes.length * 15000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(getWealthAgentBatchUrl(settings), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ fund_codes: codes, prefer_holdings: true }),
            signal: controller.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const valuesByCode = new Map(
            safeArray(payload?.data).map(item => [String(item?.fund_code || ''), item])
        );
        return codes.map(code => ({
            code,
            live: toConfiguredLiveInfo(valuesByCode.get(code), code, settings)
                || { name: `[无估值]${code}`, rate: null, price: 0, prevPrice: 0 }
        }));
    } finally {
        clearTimeout(timer);
    }
}

function normalizeLiveApiFields(fields, defaults = LIVE_API_FIELD_DEFAULTS) {
    const value = fields && typeof fields === 'object' ? fields : {};
    return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [
        key,
        safeString(value[key], fallback)
    ]));
}

function normalizeLiveApiSettings(value) {
    const source = ['fundgz', 'custom', 'wealthagent', 'fundvaluationlast', 'fundvaluationlast_single', 'sina', 'eastmoney_history', 'fund_holdings', 'market_index', 'market_index_tencent', 'market_index_sina', 'market_index_yahoo', 'market_breadth', 'holiday_calendar'].includes(value?.source) ? value.source : 'fundgz';
    const defaults = source === 'wealthagent'
        ? WEALTHAGENT_LIVE_API_SETTINGS
        : source === 'fundvaluationlast' ? FUND_VALUATION_LAST_SETTINGS
            : source === 'fundvaluationlast_single' ? FUND_VALUATION_LAST_SINGLE_SETTINGS
                : source === 'sina' ? SINA_LIVE_API_SETTINGS
                    : source === 'eastmoney_history' ? EASTMONEY_HISTORY_API_SETTINGS
                        : source === 'fund_holdings' ? FUND_HOLDINGS_API_SETTINGS
                            : source === 'market_index' ? MARKET_INDEX_API_SETTINGS
                                : source === 'market_index_tencent' ? MARKET_INDEX_TENCENT_API_SETTINGS
                                    : source === 'market_index_sina' ? MARKET_INDEX_SINA_API_SETTINGS
                                        : source === 'market_index_yahoo' ? MARKET_INDEX_YAHOO_API_SETTINGS
                                            : source === 'market_breadth' ? MARKET_BREADTH_API_SETTINGS
                                                : source === 'holiday_calendar' ? HOLIDAY_CALENDAR_API_SETTINGS : DEFAULT_LIVE_API_SETTINGS;
    const rawTemplate = safeString(value?.urlTemplate, defaults.urlTemplate);
    const category = API_CATEGORIES.includes(value?.category) ? value.category : (defaults.category || 'live');
    const categoryFieldDefaults = category === 'holdings' ? HOLDINGS_API_FIELD_DEFAULTS
        : category === 'index' ? INDEX_API_FIELD_DEFAULTS
            : category === 'breadth' ? BREADTH_API_FIELD_DEFAULTS : defaults.fields;
    return {
        source,
        category,
        enabled: value?.enabled === undefined ? defaults.enabled !== false : value.enabled !== false,
        name: safeString(value?.name, defaults.name),
        urlTemplate: source === 'fundvaluationlast'
            ? rawTemplate.replaceAll('{code}', '{codes}')
            : rawTemplate,
        secondaryUrlTemplate: safeString(value?.secondaryUrlTemplate, defaults.secondaryUrlTemplate || ''),
        secondaryDataPath: safeString(value?.secondaryDataPath, defaults.secondaryDataPath || ''),
        responseType: ['auto', 'json', 'jsonp', 'eastmoney_js', 'tencent_index', 'sina_index', 'yahoo_index'].includes(value?.responseType) ? value.responseType : defaults.responseType,
        dataPath: safeString(value?.dataPath, defaults.dataPath),
        dataKind: value?.dataKind === 'nav' ? 'nav' : defaults.dataKind,
        requestMode: value?.requestMode === 'batch' ? 'batch' : defaults.requestMode,
        fields: normalizeLiveApiFields(value?.fields, categoryFieldDefaults)
    };
}

function createLiveApiProfile(id, value) {
    return { id, ...normalizeLiveApiSettings(value) };
}

function makeLiveApiProfileId() {
    return `api_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createDefaultLiveApiProfiles() {
    return [
        createLiveApiProfile('fundvaluationlast_default', { ...FUND_VALUATION_LAST_SETTINGS, category: 'live', enabled: true }),
        createLiveApiProfile('fundgz_default', { ...DEFAULT_LIVE_API_SETTINGS, category: 'live', enabled: true }),
        createLiveApiProfile('sina_default', SINA_LIVE_API_SETTINGS),
        createLiveApiProfile('fundvaluationlast_single_default', { ...FUND_VALUATION_LAST_SINGLE_SETTINGS, category: 'live', enabled: false }),
        createLiveApiProfile('wealthagent_local', { ...WEALTHAGENT_LIVE_API_SETTINGS, category: 'live', enabled: false }),
        createLiveApiProfile('eastmoney_history_default', EASTMONEY_HISTORY_API_SETTINGS),
        createLiveApiProfile('fund_holdings_default', FUND_HOLDINGS_API_SETTINGS),
        createLiveApiProfile('market_index_default', MARKET_INDEX_API_SETTINGS),
        createLiveApiProfile('market_index_tencent_default', MARKET_INDEX_TENCENT_API_SETTINGS),
        createLiveApiProfile('market_index_sina_default', MARKET_INDEX_SINA_API_SETTINGS),
        createLiveApiProfile('market_index_yahoo_default', MARKET_INDEX_YAHOO_API_SETTINGS),
        createLiveApiProfile('market_breadth_default', MARKET_BREADTH_API_SETTINGS),
        createLiveApiProfile('holiday_calendar_default', HOLIDAY_CALENDAR_API_SETTINGS)
    ];
}

function getApiProfileIdentity(profile) {
    const category = API_CATEGORIES.includes(profile?.category) ? profile.category : 'live';
    let template = safeString(profile?.urlTemplate, '').trim().toLowerCase();
    template = template.replace('fundcomapi.eastmoney.com', 'fundcomapi.tiantianfunds.com');
    template = template.replaceAll('{code}', '{codes}');
    if (template.includes('/fundvaluationlast')) template = `tiantian-fundvaluationlast-${safeString(profile?.source, '')}-${safeString(profile?.requestMode, '')}`;
    if (category === 'history' && template.includes('/pingzhongdata/')) template = 'eastmoney-pingzhongdata';
    if (template.includes('/fdfundservice.getestimatenetworthpic')) template = 'sina-estimate-networth';
    return `${category}|${template}`;
}

function dedupeApiProfiles(profiles) {
    const seen = new Set();
    return profiles.filter(profile => {
        const identity = getApiProfileIdentity(profile);
        if (!identity || identity.endsWith('|')) return true;
        if (seen.has(identity)) return false;
        seen.add(identity);
        return true;
    });
}

async function restoreLiveApiSettings() {
    const stored = await storageHelper.getAll([
        CONFIG.LIVE_API_PROFILES_STORAGE_KEY,
        CONFIG.LIVE_API_ACTIVE_PROFILE_STORAGE_KEY,
        CONFIG.LIVE_API_SETTINGS_STORAGE_KEY
    ]);
    const savedProfiles = safeArray(stored?.[CONFIG.LIVE_API_PROFILES_STORAGE_KEY]);
    if (savedProfiles.length > 0) {
        const hasDataSourceSchema = savedProfiles.some(profile =>
            profile?.category === 'live' || profile?.category === 'history' || typeof profile?.enabled === 'boolean'
        );
        if (hasDataSourceSchema) {
            liveApiProfiles = savedProfiles.map((profile, index) => createLiveApiProfile(
                safeString(profile?.id, `api_saved_${index}`), profile
            ));
        } else {
            const builtinIds = new Set(createDefaultLiveApiProfiles().map(profile => profile.id));
            const legacyActiveId = safeString(stored?.[CONFIG.LIVE_API_ACTIVE_PROFILE_STORAGE_KEY], '');
            const customProfiles = savedProfiles
                .filter(profile => !builtinIds.has(profile?.id))
                .map((profile, index) => createLiveApiProfile(
                    safeString(profile?.id, `api_saved_${index}`), {
                        ...profile,
                        category: 'live',
                        enabled: profile?.id === legacyActiveId
                    }
                ));
            liveApiProfiles = [...createDefaultLiveApiProfiles(), ...customProfiles];
        }
        for (const builtin of createDefaultLiveApiProfiles()) {
            if (!liveApiProfiles.some(profile => profile.id === builtin.id)) liveApiProfiles.push(builtin);
        }
    } else {
        liveApiProfiles = createDefaultLiveApiProfiles();
        const legacy = stored?.[CONFIG.LIVE_API_SETTINGS_STORAGE_KEY];
        if (legacy && legacy.source !== 'fundgz' && legacy.source !== 'wealthagent') {
            liveApiProfiles.push(createLiveApiProfile(makeLiveApiProfileId(), legacy));
        }
    }
    liveApiProfiles = dedupeApiProfiles(liveApiProfiles);
    const enabledLiveProfiles = liveApiProfiles.filter(profile => profile.category === 'live' && profile.enabled);
    if (enabledLiveProfiles.length <= 1) {
        const fundgzProfile = liveApiProfiles.find(profile => profile.id === 'fundgz_default' || profile.source === 'fundgz');
        if (fundgzProfile) fundgzProfile.enabled = true;
    }
    activeLiveApiProfileId = safeString(stored?.[CONFIG.LIVE_API_ACTIVE_PROFILE_STORAGE_KEY], '');
    if (!liveApiProfiles.some(profile => profile.id === activeLiveApiProfileId)) {
        const legacy = normalizeLiveApiSettings(stored?.[CONFIG.LIVE_API_SETTINGS_STORAGE_KEY]);
        const matched = liveApiProfiles.find(profile => profile.source === legacy.source && profile.urlTemplate === legacy.urlTemplate);
        activeLiveApiProfileId = matched?.id || liveApiProfiles[0].id;
    }
    const firstEnabledLive = liveApiProfiles.find(profile => profile.category === 'live' && profile.enabled);
    liveApiSettings = { ...(firstEnabledLive || liveApiProfiles.find(profile => profile.id === activeLiveApiProfileId)) };
    await persistLiveApiProfiles();
}

function getEnabledApiProfiles(category) {
    return liveApiProfiles.filter(profile => profile.category === category && profile.enabled !== false);
}

function getSystemApiSettings(category, fallback) {
    return getEnabledApiProfiles(category)[0]
        || liveApiProfiles.find(profile => profile.category === category)
        || fallback;
}

function getEnabledApiProfileBySource(source, fallback = null) {
    return liveApiProfiles.find(profile => profile.source === source && profile.enabled !== false) || fallback;
}

async function fetchPrioritizedHistoryText(code) {
    const profiles = getEnabledApiProfiles('history');
    const candidates = profiles.length > 0 ? profiles : [EASTMONEY_HISTORY_API_SETTINGS];
    let lastError = null;
    for (const profile of candidates) {
        try {
            const text = await fetchConfiguredLiveApiText(buildLiveApiUrl(code, profile), 15000);
            if (!text) throw new Error('响应为空');
            if (profile.responseType === 'eastmoney_js' && !text.includes('Data_netWorthTrend')) {
                throw new Error('未找到历史净值数组');
            }
            if (profile.responseType === 'eastmoney_js') return text;

            const payload = parseJsonApiPayload(text, profile.responseType);
            const records = getValueByPath(payload, profile.dataPath);
            if (!Array.isArray(records) || records.length === 0) throw new Error('历史数据路径没有指向数组');
            const trend = records.map(record => {
                const rawDate = getValueByPath(record, profile.fields.date);
                const timestamp = Number(rawDate) || Date.parse(rawDate);
                return {
                    x: Number.isFinite(timestamp) ? timestamp : 0,
                    y: Number(getValueByPath(record, profile.fields.price)),
                    equityReturn: Number(getValueByPath(record, profile.fields.rate)) || 0,
                    unitMoney: ''
                };
            }).filter(record => record.x > 0 && Number.isFinite(record.y));
            if (trend.length === 0) throw new Error('未解析到有效历史净值');
            trend.sort((a, b) => a.x - b.x);
            return `var fS_name="";var Data_netWorthTrend=${JSON.stringify(trend)};var Data_ACWorthTrend=[];`;
        } catch (error) {
            lastError = error;
            console.warn(`[history-api] 数据源 ${profile.name} 请求失败:`, error.message);
        }
    }
    throw lastError || new Error('没有可用的历史净值数据源');
}

async function persistLiveApiProfiles() {
    await storageHelper.setAll({
        [CONFIG.LIVE_API_PROFILES_STORAGE_KEY]: liveApiProfiles,
        [CONFIG.LIVE_API_ACTIVE_PROFILE_STORAGE_KEY]: activeLiveApiProfileId,
        [CONFIG.LIVE_API_SETTINGS_STORAGE_KEY]: liveApiSettings
    });
}

function buildLiveApiUrl(code, settings = liveApiSettings) {
    return settings.urlTemplate
        .replaceAll('{code}', encodeURIComponent(code))
        .replaceAll('{codes}', encodeURIComponent(code))
        .replaceAll('{timestamp}', String(Date.now()))
        .replaceAll('{random}', String(Math.random()));
}

function buildLiveApiBatchUrl(codes, settings = liveApiSettings) {
    const serializedCodes = encodeURIComponent(codes.join(','));
    if (settings.urlTemplate.includes('{codes}')) {
        return settings.urlTemplate
            .replaceAll('{codes}', serializedCodes)
            .replaceAll('{timestamp}', String(Date.now()))
            .replaceAll('{random}', String(Math.random()));
    }
    return settings.urlTemplate
        .replaceAll('{code}', serializedCodes)
        .replaceAll('{timestamp}', String(Date.now()))
        .replaceAll('{random}', String(Math.random()));
}

function getValueByPath(value, path) {
    const normalized = safeString(path, '');
    if (!normalized) return value;
    const tokens = normalized.match(/[^.[\]]+|\[(?:\d+|first|last)\]/g) || [];
    let current = value;
    for (let token of tokens) {
        token = token.replace(/^\[|\]$/g, '');
        if (['__proto__', 'prototype', 'constructor'].includes(token)) return undefined;
        if (token === 'first') token = 0;
        if (token === 'last') token = Array.isArray(current) ? current.length - 1 : -1;
        if (current === null || current === undefined || token === -1) return undefined;
        current = current[token];
    }
    return current;
}

function parseJsonApiPayload(raw, responseType) {
    if (responseType === 'json') return JSON.parse(raw);
    const jsonpMatch = raw.match(/^\s*[\w$.]+\s*\(([\s\S]*)\)\s*;?\s*$/);
    if (responseType === 'jsonp') {
        if (!jsonpMatch) throw new Error('响应不是有效 JSONP');
        return JSON.parse(jsonpMatch[1]);
    }
    try {
        return JSON.parse(raw);
    } catch (_) {
        if (jsonpMatch) return JSON.parse(jsonpMatch[1]);
        throw new Error('响应不是 JSON 或 JSONP');
    }
}

function parseEastmoneyF10HoldingsPayload(raw) {
    const contentMatch = safeString(raw, '').match(/content\s*:\s*("(?:\\.|[^"\\])*")\s*,\s*arryear/);
    if (!contentMatch) return [];
    let html = '';
    try {
        html = JSON.parse(contentMatch[1]);
    } catch (_) {
        html = contentMatch[1].slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    if (!html || typeof DOMParser === 'undefined') return [];

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const firstTable = doc.querySelector('table.tzxq tbody');
    if (!firstTable) return [];

    return Array.from(firstTable.querySelectorAll('tr')).map(row => {
        const cells = Array.from(row.querySelectorAll('td'));
        const quoteHref = cells[1]?.querySelector('a')?.getAttribute('href') || '';
        const quoteMatch = quoteHref.match(/unify\/r\/(\d+)\.([0-9A-Za-z]+)/);
        const market = quoteMatch?.[1] || '';
        const stockCode = safeString(cells[1]?.textContent, '').trim();
        return {
            GPDM: stockCode,
            GPJC: safeString(cells[2]?.textContent, '').trim(),
            JZBL: safeString(cells.find(cell => cell.textContent.includes('%'))?.textContent, '').replace('%', '').trim(),
            TEXCH: market === '1' ? '1' : market === '0' ? '2' : '',
            NEWTEXCH: market === '116' ? '116' : ''
        };
    }).filter(stock => stock.GPDM && stock.GPJC);
}

function readHoldingsFromPayload(payload, settings) {
    const records = getValueByPath(payload, settings.dataPath || 'Datas.fundStocks');
    return Array.isArray(records) ? records : [];
}

function getHoldingsApiErrorMessage(payload, fallback = '接口未返回重仓股票') {
    const message = safeString(payload?.ErrMsg || payload?.ErrorMessage || payload?.Message, fallback);
    const code = payload?.ErrCode ?? payload?.ErrorCode;
    return code === undefined || code === null ? message : `${message}（ErrCode: ${code}）`;
}

async function fetchConfiguredHoldingsRecords(code, settings = FUND_HOLDINGS_API_SETTINGS) {
    const candidates = [buildLiveApiUrl(code, settings)];
    if (settings.secondaryUrlTemplate) {
        candidates.push(settings.secondaryUrlTemplate
            .replaceAll('{code}', encodeURIComponent(code))
            .replaceAll('{timestamp}', String(Date.now()))
            .replaceAll('{random}', String(Math.random())));
    }

    let lastError = null;
    for (let index = 0; index < candidates.length; index++) {
        const url = candidates[index];
        try {
            const text = await fetchConfiguredSystemApiText(url, 15000);
            if (url.includes('fundf10.eastmoney.com')) {
                const records = parseEastmoneyF10HoldingsPayload(text);
                if (records.length > 0) return records;
                throw new Error('F10 备用接口未返回持仓表格');
            }

            const payload = parseJsonApiPayload(text, settings.responseType);
            const records = readHoldingsFromPayload(payload, settings);
            if (records.length > 0) return records;
            throw new Error(getHoldingsApiErrorMessage(payload));
        } catch (error) {
            lastError = error;
            const isLastCandidate = index === candidates.length - 1;
            if (isLastCandidate) {
                console.warn('[holdings-api] 数据源请求失败:', error.message);
            } else {
                console.debug('[holdings-api] 数据源请求失败，尝试备用源:', error.message);
            }
        }
    }
    throw lastError || new Error('没有可用的前十重仓股票数据源');
}

function parseEastmoneyJsPayload(raw) {
    const name = raw.match(/fS_name\s*=\s*["']([^"']+)["']/)?.[1];
    const trendText = raw.match(/Data_netWorthTrend\s*=\s*(\[[\s\S]*?\])\s*;/)?.[1];
    if (!trendText) throw new Error('未找到 Data_netWorthTrend');
    const trend = JSON.parse(trendText);
    if (!Array.isArray(trend) || trend.length === 0) throw new Error('净值趋势为空');
    const latest = trend[trend.length - 1];
    const previous = trend.length > 1 ? trend[trend.length - 2] : latest;
    return {
        name,
        dwjz: latest.y,
        gsz: latest.y,
        gszzl: latest.equityReturn,
        jzrq: latest.x ? timestampToDate(latest.x) : '',
        gztime: latest.x ? timestampToDate(latest.x) : '',
        previousNav: previous.y,
        dataKind: 'nav'
    };
}

function parseConfiguredLiveApiResponse(text, settings = liveApiSettings) {
    const raw = safeString(text, '');
    if (!raw) return null;
    try {
        // Content detection takes priority so stale or mismatched saved types
        // cannot force Eastmoney variable scripts through the JSONP parser.
        if (settings.responseType === 'eastmoney_js' || raw.includes('Data_netWorthTrend')) {
            return parseEastmoneyJsPayload(raw);
        }
        const payload = parseJsonApiPayload(raw, settings.responseType);
        const data = getValueByPath(payload, settings.dataPath);
        if (!data || typeof data !== 'object') throw new Error('数据路径没有指向对象');
        return mapConfiguredLiveApiData(data, settings);
    } catch (error) {
        const looksStructured = /^[\[{]/.test(raw) || /^\s*[\w$.]+\s*\(/.test(raw);
        if (looksStructured) {
            console.warn(`[live-api] ${settings.name || '未命名接口'}响应格式损坏（${settings.responseType}）:`, error.message);
        } else if (CONFIG.DEBUG_DIVIDEND_TRACE) {
            console.debug(`[live-api] ${settings.name || '未命名接口'}未返回可解析数据，已回退`, {
                responseType: settings.responseType,
                contentType: /^\s*</.test(raw) ? 'html' : 'unknown'
            });
        }
        return null;
    }
}

function parseConfiguredLiveApiBatchResponse(text, settings = liveApiSettings) {
    const raw = safeString(text, '');
    if (!raw) return [];
    try {
        const payload = parseJsonApiPayload(raw, settings.responseType);
        const data = getValueByPath(payload, settings.dataPath);
        if (Array.isArray(data)) return data;
        // Backward compatible with a former single-item path such as data[0].
        const arrayPath = safeString(settings.dataPath, '').replace(/\[(?:0|first|last)\]$/, '');
        const parent = arrayPath ? getValueByPath(payload, arrayPath) : payload;
        if (Array.isArray(parent)) return parent;
        throw new Error('数据路径没有指向数组');
    } catch (error) {
        console.warn(`[live-api] ${settings.name || '未命名接口'}批量响应解析失败:`, error.message);
        return [];
    }
}

async function fetchGenericBatchLiveInfo(codes, settings = liveApiSettings) {
    const itemByCode = new Map();
    for (let index = 0; index < codes.length; index += 50) {
        const chunk = codes.slice(index, index + 50);
        const text = await fetchConfiguredLiveApiText(buildLiveApiBatchUrl(chunk, settings), 15000);
        const items = parseConfiguredLiveApiBatchResponse(text, settings);
        for (const item of items) {
            const itemCode = safeString(
                getValueByPath(item, settings.fields.code)
                ?? item?.FCODE ?? item?.fund_code ?? item?.code,
                ''
            );
            if (itemCode) itemByCode.set(itemCode, item);
        }
    }
    return codes.map(code => ({
        code,
        live: toConfiguredLiveInfo(itemByCode.get(code), code, settings)
            || { name: `[无估值]${code}`, rate: null, price: 0, prevPrice: 0 }
    }));
}

function mappedResponseToLiveInfo(mapped, code) {
    if (!mapped || (!mapped.gsz && !mapped.dwjz)) return null;
    const rate = mapped.gszzl === null || mapped.gszzl === undefined || mapped.gszzl === ''
        ? null : Number(mapped.gszzl);
    return {
        name: mapped.name || `[未知]${code}`,
        rate: mapped.dataKind === 'nav' || !Number.isFinite(rate) ? null : rate,
        price: Number(mapped.gsz || mapped.dwjz) || 0,
        prevPrice: Number(mapped.dwjz) || 0,
        prevPriceDate: mapped.jzrq || '',
        priceTime: mapped.gztime || ''
    };
}

async function fetchGenericSingleLiveInfo(codes, settings) {
    const results = [];
    const batchSize = 5;
    for (let offset = 0; offset < codes.length; offset += batchSize) {
        const chunk = codes.slice(offset, offset + batchSize);
        const values = await Promise.all(chunk.map(async code => {
            try {
                const text = await fetchConfiguredLiveApiText(buildLiveApiUrl(code, settings), 10000);
                return mappedResponseToLiveInfo(parseConfiguredLiveApiResponse(text, settings), code);
            } catch (_) {
                return null;
            }
        }));
        values.forEach((live, index) => results.push({
            code: chunk[index],
            live: live || { name: `[无估值]${chunk[index]}`, rate: null, price: 0, prevPrice: 0 }
        }));
    }
    return results;
}

async function fetchLiveInfoByProfile(codes, profile, baseByCode) {
    if (profile.source === 'fundvaluationlast') return fetchFundValuationLastBatchLiveInfo(codes, profile);
    if (profile.source === 'fundvaluationlast_single') return fetchFundValuationLastSingleLiveInfo(codes, profile);
    if (profile.source === 'wealthagent') return fetchWealthAgentBatchLiveInfo(codes, profile);
    if (profile.source === 'sina') {
        const seed = codes.map(code => ({
            code,
            live: baseByCode.get(code) || { name: `[未知]${code}`, rate: null, price: 0, prevPrice: 0 }
        }));
        return fillMissingFundValuationsFromSina(seed, profile);
    }
    return profile.requestMode === 'batch'
        ? fetchGenericBatchLiveInfo(codes, profile)
        : fetchGenericSingleLiveInfo(codes, profile);
}

function hasUsableLiveEstimate(live) {
    return Number(live?.price) > 0 && live?.rate !== null && live?.rate !== undefined && live?.rate !== '';
}

async function fetchPrioritizedLiveInfo(codes) {
    const profiles = getEnabledApiProfiles('live');
    const resultByCode = new Map(codes.map(code => [code, null]));

    for (const profile of profiles) {
        const pendingCodes = codes.filter(code => !hasUsableLiveEstimate(resultByCode.get(code)));
        if (pendingCodes.length === 0) break;
        try {
            const values = await fetchLiveInfoByProfile(pendingCodes, profile, resultByCode);
            values.forEach(({ code, live }) => {
                const previous = resultByCode.get(code);
                if (!live) return;
                resultByCode.set(code, {
                    ...previous,
                    ...live,
                    name: live.name?.startsWith('[未知]') ? (previous?.name || live.name) : live.name,
                    prevPrice: Number(live.prevPrice) > 0 ? live.prevPrice : (previous?.prevPrice || 0),
                    prevPriceDate: live.prevPriceDate || previous?.prevPriceDate || '',
                    valuationSource: profile.name
                });
            });
        } catch (error) {
            console.warn(`[live-api] 数据源 ${profile.name} 请求失败:`, error.message);
        }
    }

    return codes.map(code => ({
        code,
        live: resultByCode.get(code) || { name: `[无估值]${code}`, rate: null, price: 0, prevPrice: 0 }
    }));
}

function updateLiveApiSettingsButton() {
    if (!elements.apiSettingsBtn) return;
    const liveCount = getEnabledApiProfiles('live').length;
    const historyCount = getEnabledApiProfiles('history').length;
    const systemCount = ['holdings', 'index', 'breadth', 'calendar'].filter(category => getEnabledApiProfiles(category).length > 0).length;
    elements.apiSettingsBtn.title = `数据源管理：实时 ${liveCount}，历史 ${historyCount}，功能 ${systemCount}`;
    elements.apiSettingsBtn.setAttribute('aria-label', elements.apiSettingsBtn.title);
}

function getOptionalOriginPattern(urlTemplate) {
    const probe = urlTemplate
        .replaceAll('{code}', '000001')
        .replaceAll('{codes}', '000001')
        .replaceAll('{secids}', '1.000001')
        .replaceAll('{year}', String(new Date().getFullYear()))
        .replaceAll('{timestamp}', '0')
        .replaceAll('{random}', '0.1');
    const url = new URL(probe);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 HTTP 或 HTTPS 接口');
    return `${url.origin}/*`;
}

async function requestLiveApiPermission(urlTemplate) {
    const origin = getOptionalOriginPattern(urlTemplate);
    if (await chrome.permissions.contains({ origins: [origin] })) return true;
    return chrome.permissions.request({ origins: [origin] });
}

function getApiFieldLayout(category) {
    return API_FIELD_LAYOUTS[category] || API_FIELD_LAYOUTS.live;
}

function readApiFields(getValue, category) {
    return Object.fromEntries(getApiFieldLayout(category).map(([fieldId, key]) => [
        key,
        safeString(getValue(fieldId), '')
    ]));
}

function applyApiFieldsToForm(getField, category, fields) {
    const layout = getApiFieldLayout(category);
    const byFieldId = new Map(layout.map(entry => [entry[0], entry]));
    ['fieldCode', 'fieldName', 'fieldPrevPrice', 'fieldPrice', 'fieldRate', 'fieldDate', 'fieldTime'].forEach(fieldId => {
        const input = getField(fieldId);
        const group = input?.closest('.form-group');
        const entry = byFieldId.get(fieldId);
        if (!input || !group) return;
        group.style.display = entry ? '' : 'none';
        if (!entry) return;
        input.value = safeString(fields?.[entry[1]], '');
        const label = group.querySelector('label');
        if (label) label.textContent = entry[2];
    });
}

function liveApiSettingsFromForm(getField) {
    const source = getField('source').value;
    const category = getField('category')?.value || 'live';
    return normalizeLiveApiSettings({
        source,
        category,
        enabled: (getField('enabled')?.value || 'true') === 'true',
        name: getField('name').value,
        urlTemplate: getField('urlTemplate').value,
        secondaryUrlTemplate: getField('secondaryUrlTemplate')?.value || '',
        secondaryDataPath: getField('secondaryDataPath')?.value || '',
        responseType: getField('responseType').value,
        dataPath: getField('dataPath').value,
        dataKind: getField('dataKind').value,
        requestMode: getField('requestMode').value,
        fields: readApiFields(fieldId => getField(fieldId)?.value, category)
    });
}

async function testLiveApiSettings(settings, code) {
    if (['holdings', 'index', 'breadth', 'calendar'].includes(settings.category)) {
        let url = settings.urlTemplate
            .replaceAll('{code}', encodeURIComponent(code.split(',')[0].trim() || '000001'))
            .replaceAll('{secids}', '1.000001,0.399001')
            .replaceAll('{timestamp}', String(Date.now()))
            .replaceAll('{random}', String(Math.random()));

        if (settings.category === 'calendar') {
            const year = new Date().getFullYear();
            const calendarUrl = settings.urlTemplate
                .replaceAll('{year}', String(year))
                .replaceAll('{timestamp}', String(Date.now()))
                .replaceAll('{random}', String(Math.random()));
            const text = await fetchConfiguredLiveApiText(calendarUrl, 10000);
            const payload = JSON.parse(text);
            const days = safeArray(payload?.days);
            if (days.length === 0) throw new Error('日历接口未返回有效节假日数据');
            const offCount = days.filter(day => day?.isOffDay).length;
            return { systemSummary: `${year} 年节假日 ${days.length} 条：休市 ${offCount} 天，调休上班 ${days.length - offCount} 天` };
        }

        if (settings.category === 'holdings') {
            const data = await fetchConfiguredHoldingsRecords(code.split(',')[0].trim() || '000001', settings);
            const stocks = data.slice(0, 10).map(stock =>
                `${safeString(getValueByPath(stock, settings.fields.stockName), getValueByPath(stock, settings.fields.stockCode) || '未知')} ${safeString(getValueByPath(stock, settings.fields.holdingPercent), '--')}%`
            );
            return { systemSummary: `重仓股票 ${stocks.length} 只：${stocks.join('、')}` };
        }

        if (settings.category === 'index') {
            if (settings.source === 'market_index_tencent' || settings.responseType === 'tencent_index') {
                const testUrl = settings.urlTemplate
                    .replaceAll('{codes}', 'usIXIC')
                    .replaceAll('{code}', 'usIXIC')
                    .replaceAll('{timestamp}', String(Date.now()))
                    .replaceAll('{random}', String(Math.random()));
                const text = await fetchConfiguredLiveApiText(testUrl, 10000);
                const match = text.match(/="(.+)"/);
                const parts = match?.[1]?.split('~') || [];
                if (parts.length <= 32) throw new Error('腾讯指数接口未返回有效内容');
                return { systemSummary: `纳斯达克 ${parts[3] || '--'}（${parts[32] || '--'}%）` };
            }

            if (settings.source === 'market_index_sina' || settings.responseType === 'sina_index') {
                const testUrl = settings.urlTemplate
                    .replaceAll('{codes}', 'int_nasdaq')
                    .replaceAll('{code}', 'int_nasdaq')
                    .replaceAll('{timestamp}', String(Date.now()))
                    .replaceAll('{random}', String(Math.random()));
                const text = typeof proxyFetchSina === 'function'
                    ? await proxyFetchSina(testUrl)
                    : await fetchConfiguredLiveApiText(testUrl, 10000);
                const parts = safeString(text, '').split(',');
                if (parts.length < 4) throw new Error('新浪指数接口未返回有效内容');
                return { systemSummary: `纳斯达克 ${parts[1] || '--'}（${parts[3] || '--'}%）` };
            }

            if (settings.source === 'market_index_yahoo' || settings.responseType === 'yahoo_index') {
                const testUrl = settings.urlTemplate
                    .replaceAll('{code}', '%5EGSPC')
                    .replaceAll('{codes}', '%5EGSPC')
                    .replaceAll('{timestamp}', String(Date.now()))
                    .replaceAll('{random}', String(Math.random()));
                const text = await fetchConfiguredLiveApiText(testUrl, 10000);
                const meta = JSON.parse(text)?.chart?.result?.[0]?.meta;
                if (!meta || !(meta.regularMarketPrice > 0)) throw new Error('Yahoo 指数接口未返回有效内容');
                const prevClose = meta.chartPreviousClose || meta.previousClose || meta.regularMarketPrice;
                const rate = prevClose > 0 ? ((meta.regularMarketPrice - prevClose) / prevClose * 100) : 0;
                return { systemSummary: `标普500 ${Number(meta.regularMarketPrice).toFixed(2)}（${rate.toFixed(2)}%）` };
            }

            const text = await fetchConfiguredLiveApiText(url, 10000);
            const payload = parseJsonApiPayload(text, settings.responseType);
            const data = getValueByPath(payload, settings.dataPath);
            if (!Array.isArray(data) || data.length === 0) {
                const apiMessage = safeString(payload?.ErrMsg || payload?.ErrorMessage || payload?.Message, '接口未返回列表');
                throw new Error(`${apiMessage}（ErrCode: ${payload?.ErrCode ?? payload?.ErrorCode ?? '--'}）`);
            }

            const indices = data.map(item => {
                const price = Number(getValueByPath(item, settings.fields.price));
                const rate = Number(getValueByPath(item, settings.fields.changeRate));
                return `${safeString(getValueByPath(item, settings.fields.indexName), getValueByPath(item, settings.fields.indexCode) || '指数')} ${price > 0 ? (price / 100).toFixed(2) : '--'}（${Number.isFinite(rate) ? (rate / 100).toFixed(2) : '--'}%）`;
            });
            return { systemSummary: indices.join('；') };
        }

        if (settings.category === 'breadth') {
            const text = await fetchConfiguredLiveApiText(url, 10000);
            const payload = parseJsonApiPayload(text, settings.responseType);
            const data = getValueByPath(payload, settings.dataPath);
            if (!Array.isArray(data) || data.length === 0) {
                const apiMessage = safeString(payload?.ErrMsg || payload?.ErrorMessage || payload?.Message, '接口未返回列表');
                throw new Error(`${apiMessage}（ErrCode: ${payload?.ErrCode ?? payload?.ErrorCode ?? '--'}）`);
            }
            const up = data.reduce((sum, item) => sum + (Number(getValueByPath(item, settings.fields.upCount)) || 0), 0);
            const down = data.reduce((sum, item) => sum + (Number(getValueByPath(item, settings.fields.downCount)) || 0), 0);
            if (!settings.secondaryUrlTemplate) throw new Error('未配置涨跌停辅助 URL');
            const secondaryText = await fetchConfiguredLiveApiText(settings.secondaryUrlTemplate
                .replaceAll('{timestamp}', String(Date.now()))
                .replaceAll('{random}', String(Math.random())), 10000);
            const secondary = parseJsonApiPayload(secondaryText, settings.responseType);
            const limitRecords = getValueByPath(secondary, settings.secondaryDataPath);
            if (!Array.isArray(limitRecords)) throw new Error('涨跌停接口未返回有效内容');
            const limitUp = Number(getValueByPath(limitRecords.find(item => Number(getValueByPath(item, settings.fields.limitType)) === 4), settings.fields.limitCount)) || 0;
            const limitDown = Number(getValueByPath(limitRecords.find(item => Number(getValueByPath(item, settings.fields.limitType)) === 8), settings.fields.limitCount)) || 0;
            // f106（平盘）为全市场值，两 board 记录回显同一数字，取首行避免翻倍
            const flat = data.length ? (Number(getValueByPath(data[0], settings.fields.flatCount)) || 0) : 0;
            return { systemSummary: `上涨 ${up} 家，下跌 ${down} 家，涨停 ${limitUp} 家，跌停 ${limitDown} 家，平盘 ${flat} 家` };
        }
    }
    const hasPlaceholder = settings.requestMode === 'batch'
        ? settings.urlTemplate.includes('{codes}') || settings.urlTemplate.includes('{code}')
        : settings.urlTemplate.includes('{code}');
    if (!hasPlaceholder) throw new Error(settings.requestMode === 'batch' ? 'URL 模板必须包含 {codes}' : 'URL 模板必须包含 {code}');
    if (!await requestLiveApiPermission(settings.urlTemplate)) throw new Error('未授予接口访问权限');
    if (settings.source === 'sina') {
        const live = await fetchSinaFundValuation(code.split(',')[0].trim(), null, settings);
        if (!live) throw new Error('新浪未返回当日估值');
        return { name: live.name, dwjz: live.prevPrice, gsz: live.price, gszzl: live.rate, jzrq: live.prevPriceDate, gztime: live.priceTime, dataKind: 'estimate' };
    }
    if (settings.source === 'fundvaluationlast') {
        const [result] = await fetchFundValuationLastBatchLiveInfo(code.split(',').map(item => item.trim()).filter(Boolean), settings);
        const live = result?.live;
        if (!live || (!live.price && !live.prevPrice)) throw new Error('未解析到有效净值字段');
        return {
            name: live.name,
            dwjz: live.prevPrice,
            gsz: live.price,
            gszzl: live.rate,
            jzrq: live.prevPriceDate,
            gztime: live.priceTime,
            dataKind: 'estimate'
        };
    }
    if (settings.source === 'fundvaluationlast_single') {
        const [result] = await fetchFundValuationLastSingleLiveInfo(code.split(',').map(item => item.trim()).filter(Boolean), settings);
        const live = result?.live;
        if (!live || (!live.price && !live.prevPrice)) throw new Error('未解析到有效净值字段');
        return {
            name: live.name,
            dwjz: live.prevPrice,
            gsz: live.price,
            gszzl: live.rate,
            jzrq: live.prevPriceDate,
            gztime: live.priceTime,
            dataKind: 'estimate'
        };
    }
    if (settings.requestMode === 'batch') {
        const [result] = await fetchGenericBatchLiveInfo(code.split(',').map(item => item.trim()).filter(Boolean), settings);
        const live = result?.live;
        if (!live || (!live.price && !live.prevPrice)) throw new Error('未解析到有效净值字段');
        return {
            name: live.name,
            dwjz: live.prevPrice,
            gsz: live.price,
            gszzl: live.rate,
            jzrq: live.prevPriceDate,
            gztime: live.priceTime,
            dataKind: settings.dataKind
        };
    }
    const text = await fetchLiveApiText(buildLiveApiUrl(code, settings));
    if (!text) throw new Error('接口请求失败或超时');
    const result = parseConfiguredLiveApiResponse(text, settings);
    if (!result || (!result.gsz && !result.dwjz)) throw new Error('未解析到有效净值字段');
    return result;
}

function liveApiSettingsFromValues(values) {
    const category = values.category || 'live';
    return normalizeLiveApiSettings({
        source: values.source,
        category: values.category,
        enabled: values.enabled === true || values.enabled === 'true',
        name: values.name,
        urlTemplate: values.urlTemplate,
        secondaryUrlTemplate: values.secondaryUrlTemplate,
        secondaryDataPath: values.secondaryDataPath,
        responseType: values.responseType,
        dataPath: values.dataPath,
        dataKind: values.dataKind,
        requestMode: values.requestMode,
        fields: readApiFields(fieldId => values[fieldId], category)
    });
}

// The later declaration intentionally replaces the legacy single-profile dialog.
async function openLiveApiSettings() {
    const profiles = liveApiProfiles.map(profile => ({ ...profile, fields: { ...profile.fields } }));
    let selectedId = activeLiveApiProfileId;
    let getFieldRef = null;
    const current = profiles.find(profile => profile.id === selectedId) || profiles[0];
    const result = await showFormModal({
        title: '数据源管理',
        subTitle: '同类数据源按列表顺序依次补缺',
        actionText: '保存配置',
        layout: 'double',
        fields: [
            { id: 'profileId', label: '已保存接口', type: 'select', value: current.id, options: profiles.map(profile => ({ value: profile.id, label: profile.name })) },
            { id: 'source', type: 'hidden', value: current.source },
            { id: 'category', label: '接口分类', type: 'select', value: current.category, options: [{ value: 'live', label: '实时估值' }, { value: 'history', label: '历史净值' }, { value: 'holdings', label: '前十重仓股票' }, { value: 'index', label: '市场指数' }, { value: 'breadth', label: '市场涨跌' }, { value: 'calendar', label: '节假日历' }] },
            { id: 'enabled', label: '启用状态', type: 'select', value: String(current.enabled !== false), options: [{ value: 'true', label: '已启用' }, { value: 'false', label: '已停用' }] },
            { id: 'requestMode', label: '请求策略', type: 'select', value: current.requestMode, options: [{ value: 'single', label: '逐个请求' }, { value: 'batch', label: '批量请求' }] },
            { id: 'name', label: '接口名称', value: current.name, required: true },
            { id: 'urlTemplate', label: 'URL 模板', value: current.urlTemplate, required: true },
            { id: 'secondaryUrlTemplate', label: '辅助 URL（市场涨跌停）', value: current.secondaryUrlTemplate || '' },
            { id: 'secondaryDataPath', label: '辅助数据路径（涨跌停列表）', value: current.secondaryDataPath || '' },
            { id: 'responseType', label: '响应类型', type: 'select', value: current.responseType, options: [{ value: 'auto', label: '自动识别' }, { value: 'json', label: 'JSON' }, { value: 'jsonp', label: 'JSONP' }, { value: 'eastmoney_js', label: '东财净值 JS' }, { value: 'tencent_index', label: '腾讯指数文本' }, { value: 'sina_index', label: '新浪指数文本' }, { value: 'yahoo_index', label: 'Yahoo 指数 JSON' }] },
            { id: 'dataKind', label: '数据语义', type: 'select', value: current.dataKind, options: [{ value: 'estimate', label: '盘中实时估值' }, { value: 'nav', label: '已公布净值' }] },
            { id: 'dataPath', label: '数据路径', value: current.dataPath, placeholder: '例如 data.result；根对象留空' },
            { id: 'fieldCode', label: '基金代码字段路径', value: current.fields.code },
            { id: 'fieldName', label: '名称字段路径', value: current.fields.name },
            { id: 'fieldPrevPrice', label: '上期净值字段路径', value: current.fields.prevPrice },
            { id: 'fieldPrice', label: '当前估值字段路径', value: current.fields.price },
            { id: 'fieldRate', label: '涨跌率字段路径', value: current.fields.rate },
            { id: 'fieldDate', label: '净值日期字段路径', value: current.fields.date },
            { id: 'fieldTime', label: '估值时间字段路径', value: current.fields.time },
            { id: 'testCode', label: '测试基金代码（仅基金接口）', value: '000001' }
        ],
        onRender: ({ root, getField }) => {
            getFieldRef = getField;
            const profileSelect = getField('profileId');
            const responseType = getField('responseType');
            const mappingIds = ['dataKind', 'dataPath', 'fieldCode', 'fieldName', 'fieldPrevPrice', 'fieldPrice', 'fieldRate', 'fieldDate', 'fieldTime'];
            const applyProfile = profile => {
                const value = normalizeLiveApiSettings(profile);
                getField('source').value = value.source;
                getField('category').value = value.category;
                getField('enabled').value = String(value.enabled !== false);
                getField('requestMode').value = value.requestMode;
                getField('name').value = value.name;
                getField('urlTemplate').value = value.urlTemplate;
                getField('secondaryUrlTemplate').value = value.secondaryUrlTemplate || '';
                getField('secondaryDataPath').value = value.secondaryDataPath || '';
                getField('responseType').value = value.responseType;
                getField('dataKind').value = value.dataKind;
                getField('dataPath').value = value.dataPath;
                applyApiFieldsToForm(getField, value.category, value.fields);
            };
            const rememberCurrent = () => {
                const index = profiles.findIndex(profile => profile.id === selectedId);
                if (index >= 0) profiles[index] = { id: selectedId, ...liveApiSettingsFromForm(getField) };
            };
            const renderOptions = () => {
                const categoryIndexes = { live: 0, history: 0, holdings: 0, index: 0, breadth: 0 };
                profileSelect.replaceChildren(...profiles.map(profile => {
                    const option = document.createElement('option');
                    option.value = profile.id;
                    const category = API_CATEGORY_LABELS[profile.category] || '实时';
                    categoryIndexes[profile.category] = (categoryIndexes[profile.category] || 0) + 1;
                    option.textContent = `${category} ${categoryIndexes[profile.category]} · ${profile.enabled === false ? '停用' : '启用'} · ${profile.name}`;
                    return option;
                }));
                profileSelect.value = selectedId;
            };
            const sync = () => {
                const eastmoneyJs = responseType.value === 'eastmoney_js';
                const category = getField('category').value;
                const operational = ['holdings', 'index', 'breadth', 'calendar'].includes(category);
                const secondaryGroup = getField('secondaryUrlTemplate').closest('.form-group');
                const secondaryLabel = secondaryGroup?.querySelector('label');
                const secondaryDataGroup = getField('secondaryDataPath').closest('.form-group');
                getField('dataKind').value = getField('category').value === 'history' ? 'nav' : 'estimate';
                mappingIds.forEach(id => { getField(id).disabled = eastmoneyJs; });
                getField('dataKind').closest('.form-group').style.display = operational ? 'none' : '';
                if (secondaryGroup) secondaryGroup.style.display = ['holdings', 'breadth'].includes(category) ? '' : 'none';
                if (secondaryLabel) secondaryLabel.textContent = category === 'holdings' ? '备用 URL（F10 持仓）' : '辅助 URL（市场涨跌停）';
                if (secondaryDataGroup) secondaryDataGroup.style.display = category === 'breadth' ? '' : 'none';
                getField('testCode').disabled = !['live', 'history', 'holdings'].includes(category);
            };
            profileSelect.addEventListener('change', () => {
                rememberCurrent();
                selectedId = profileSelect.value;
                applyProfile(profiles.find(profile => profile.id === selectedId));
                sync();
            });
            getField('requestMode').addEventListener('change', sync);
            getField('category').addEventListener('change', () => {
                const category = getField('category').value;
                const defaults = category === 'holdings' ? HOLDINGS_API_FIELD_DEFAULTS
                    : category === 'index' ? INDEX_API_FIELD_DEFAULTS
                        : category === 'breadth' ? BREADTH_API_FIELD_DEFAULTS : LIVE_API_FIELD_DEFAULTS;
                applyApiFieldsToForm(getField, category, defaults);
                sync();
            });
            responseType.addEventListener('change', sync);

            const toolsRow = document.createElement('div');
            toolsRow.style.cssText = 'grid-column:1/-1;display:flex;gap:8px;align-items:center;';
            const addButton = document.createElement('button');
            addButton.type = 'button';
            addButton.className = 'modal-btn modal-btn-cancel';
            addButton.textContent = '新增接口';
            addButton.onclick = () => {
                rememberCurrent();
                const category = getField('category').value;
                const profile = createLiveApiProfile(makeLiveApiProfileId(), { source: 'custom', category, enabled: true, name: '新接口', urlTemplate: '', responseType: 'auto', dataKind: category === 'history' ? 'nav' : 'estimate', requestMode: 'single', fields: LIVE_API_FIELD_DEFAULTS });
                profiles.push(profile);
                selectedId = profile.id;
                renderOptions();
                applyProfile(profile);
                sync();
                getField('name').focus();
            };
            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'modal-btn modal-btn-danger';
            deleteButton.textContent = '删除当前';
            deleteButton.onclick = () => {
                if (profiles.length === 1) { showToast('至少保留一个接口配置', 'error'); return; }
                const index = profiles.findIndex(profile => profile.id === selectedId);
                profiles.splice(index, 1);
                selectedId = profiles[Math.max(0, index - 1)].id;
                renderOptions();
                applyProfile(profiles.find(profile => profile.id === selectedId));
                sync();
            };
            const moveButton = (label, delta) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'modal-btn modal-btn-cancel';
                button.textContent = label;
                button.onclick = () => {
                    rememberCurrent();
                    const index = profiles.findIndex(profile => profile.id === selectedId);
                    const category = profiles[index]?.category;
                    const target = delta < 0
                        ? profiles.map((profile, i) => profile.category === category && i < index ? i : -1).filter(i => i >= 0).pop()
                        : profiles.findIndex((profile, i) => profile.category === category && i > index);
                    if (target === undefined || target < 0) return;
                    [profiles[index], profiles[target]] = [profiles[target], profiles[index]];
                    renderOptions();
                };
                return button;
            };
            toolsRow.append(addButton, moveButton('上移', -1), moveButton('下移', 1), deleteButton);
            root.querySelector('.form-modal').appendChild(toolsRow);

            const testRow = document.createElement('div');
            testRow.style.cssText = 'grid-column:1/-1;display:flex;align-items:center;gap:10px;min-height:34px;';
            const testButton = document.createElement('button');
            testButton.type = 'button';
            testButton.className = 'modal-btn modal-btn-cancel';
            testButton.textContent = '测试解析';
            const testStatus = document.createElement('span');
            testStatus.style.cssText = 'font-size:12px;color:#adc8e9;overflow-wrap:anywhere;';
            testButton.onclick = async () => {
                testButton.disabled = true;
                testStatus.textContent = '正在请求...';
                try {
                    const parsed = await testLiveApiSettings(liveApiSettingsFromForm(getField), safeString(getField('testCode').value, '000001'));
                    if (parsed.systemSummary) {
                        testStatus.textContent = `成功：${parsed.systemSummary}`;
                    } else {
                        const kind = parsed.dataKind === 'nav' ? '已公布净值' : '盘中实时估值';
                        testStatus.textContent = `成功（${kind}）：${parsed.name || '未命名'}，净值 ${parsed.gsz ?? parsed.dwjz}，涨跌 ${parsed.gszzl ?? '--'}`;
                    }
                } catch (error) {
                    testStatus.textContent = `失败：${error.message}`;
                } finally {
                    testButton.disabled = false;
                }
            };
            testRow.append(testButton, testStatus);
            root.querySelector('.form-modal').appendChild(testRow);
            renderOptions();
            applyProfile(current);
            sync();
        }
    });
    if (!result) return;

    const next = liveApiSettingsFromValues(result);
    const requiresCodePlaceholder = ['live', 'history', 'holdings'].includes(next.category);
    const validPlaceholder = !requiresCodePlaceholder || (next.requestMode === 'batch'
        ? next.urlTemplate.includes('{codes}') || next.urlTemplate.includes('{code}')
        : next.urlTemplate.includes('{code}'));
    if (!validPlaceholder) { showToast(`URL 模板必须包含 ${next.requestMode === 'batch' ? '{codes}' : '{code}'}`, 'error'); return; }
    try {
        if (!await requestLiveApiPermission(next.urlTemplate)) { showToast('未授予该接口的访问权限', 'error'); return; }
        if (['holdings', 'breadth'].includes(next.category) && next.secondaryUrlTemplate
            && !await requestLiveApiPermission(next.secondaryUrlTemplate)) {
            showToast('未授予辅助接口访问权限', 'error');
            return;
        }
    } catch (error) {
        showToast(`接口地址无效：${error.message}`, 'error');
        return;
    }
    const selectedIndex = profiles.findIndex(profile => profile.id === selectedId);
    profiles[selectedIndex] = { id: selectedId, ...next };
    liveApiProfiles = profiles;
    activeLiveApiProfileId = selectedId;
    // 只从启用中的实时源取配置；全部停用时不能回退到刚编辑的（可能已停用）配置，
    // 否则系统会静默使用用户明确停用的数据源
    const firstEnabledLive = profiles.find(profile => profile.category === 'live' && profile.enabled);
    if (firstEnabledLive) {
        liveApiSettings = { ...firstEnabledLive };
    } else {
        showToast('注意：实时估值数据源已全部停用，实时估值将不可用', 'warning');
    }
    await persistLiveApiProfiles();
    updateLiveApiSettingsButton();
    showToast('数据源配置已保存', 'success');
    triggerUnifiedRefresh('api-settings');
}
