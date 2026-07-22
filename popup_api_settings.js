const LIVE_API_FIELD_DEFAULTS = Object.freeze({
    code: 'code',
    name: 'name',
    prevPrice: 'dwjz',
    price: 'gsz',
    rate: 'gszzl',
    date: 'jzrq',
    time: 'gztime'
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

let liveApiSettings = normalizeLiveApiSettings(null);
let liveApiProfiles = [];
let activeLiveApiProfileId = '';

function getLiveApiTimeout() {
    return liveApiSettings.source === 'wealthagent' ? 45000 : CONFIG.API_TIMEOUT;
}

function getLiveApiBatchSize() {
    return liveApiSettings.source === 'wealthagent' ? 2 : CONFIG.BATCH_SIZE;
}

function getLiveApiBatchDelay() {
    return liveApiSettings.source === 'wealthagent' ? 300 : CONFIG.BATCH_DELAY;
}

function isWealthAgentLiveApi() {
    return liveApiSettings.source === 'wealthagent';
}

function isFundValuationLastApi() {
    return liveApiSettings.source === 'fundvaluationlast';
}

function isBatchLiveApi() {
    return liveApiSettings.requestMode === 'batch';
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
    const estimateDate = normalizePerfDate(point?.pre_date || '');
    const price = Number(point?.pre_nav);
    const rate = Number(point?.nav_pct);
    if (estimateDate !== getToday() || !Number.isFinite(price) || !Number.isFinite(rate)) return null;

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
        const text = await fetchConfiguredLiveApiText(url, 10000);
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
    const source = ['fundgz', 'custom', 'wealthagent', 'fundvaluationlast', 'sina', 'eastmoney_history'].includes(value?.source) ? value.source : 'fundgz';
    const defaults = source === 'wealthagent'
        ? WEALTHAGENT_LIVE_API_SETTINGS
        : source === 'fundvaluationlast' ? FUND_VALUATION_LAST_SETTINGS
            : source === 'sina' ? SINA_LIVE_API_SETTINGS
                : source === 'eastmoney_history' ? EASTMONEY_HISTORY_API_SETTINGS : DEFAULT_LIVE_API_SETTINGS;
    const rawTemplate = safeString(value?.urlTemplate, defaults.urlTemplate);
    return {
        source,
        category: value?.category === 'history' ? 'history' : (defaults.category || 'live'),
        enabled: value?.enabled === undefined ? defaults.enabled !== false : value.enabled !== false,
        name: safeString(value?.name, defaults.name),
        urlTemplate: source === 'fundvaluationlast'
            ? rawTemplate.replaceAll('{code}', '{codes}')
            : rawTemplate,
        responseType: ['auto', 'json', 'jsonp', 'eastmoney_js'].includes(value?.responseType) ? value.responseType : defaults.responseType,
        dataPath: safeString(value?.dataPath, defaults.dataPath),
        dataKind: value?.dataKind === 'nav' ? 'nav' : defaults.dataKind,
        requestMode: value?.requestMode === 'batch' ? 'batch' : defaults.requestMode,
        fields: normalizeLiveApiFields(value?.fields, defaults.fields)
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
        createLiveApiProfile('sina_default', SINA_LIVE_API_SETTINGS),
        createLiveApiProfile('fundgz_default', { ...DEFAULT_LIVE_API_SETTINGS, category: 'live', enabled: false }),
        createLiveApiProfile('wealthagent_local', { ...WEALTHAGENT_LIVE_API_SETTINGS, category: 'live', enabled: false }),
        createLiveApiProfile('eastmoney_history_default', EASTMONEY_HISTORY_API_SETTINGS)
    ];
}

function getApiProfileIdentity(profile) {
    const category = profile?.category === 'history' ? 'history' : 'live';
    let template = safeString(profile?.urlTemplate, '').trim().toLowerCase();
    template = template.replace('fundcomapi.eastmoney.com', 'fundcomapi.tiantianfunds.com');
    template = template.replaceAll('{code}', '{codes}');
    if (template.includes('/fundvaluationlast')) template = 'tiantian-fundvaluationlast';
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

function buildHistoryApiUrl(code) {
    const profile = getEnabledApiProfiles('history')[0] || EASTMONEY_HISTORY_API_SETTINGS;
    return buildLiveApiUrl(code, profile);
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
        .replaceAll('{timestamp}', String(Date.now()));
}

function buildLiveApiBatchUrl(codes, settings = liveApiSettings) {
    const serializedCodes = encodeURIComponent(codes.join(','));
    if (settings.urlTemplate.includes('{codes}')) {
        return settings.urlTemplate.replaceAll('{codes}', serializedCodes).replaceAll('{timestamp}', String(Date.now()));
    }
    return settings.urlTemplate
        .replaceAll('{code}', serializedCodes)
        .replaceAll('{timestamp}', String(Date.now()));
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
    elements.apiSettingsBtn.title = `数据源管理：实时 ${liveCount}，历史 ${historyCount}`;
    elements.apiSettingsBtn.setAttribute('aria-label', elements.apiSettingsBtn.title);
}

function getOptionalOriginPattern(urlTemplate) {
    const probe = urlTemplate.replaceAll('{code}', '000001').replaceAll('{timestamp}', '0');
    const url = new URL(probe);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 HTTP 或 HTTPS 接口');
    return `${url.origin}/*`;
}

async function requestLiveApiPermission(urlTemplate) {
    const origin = getOptionalOriginPattern(urlTemplate);
    if (await chrome.permissions.contains({ origins: [origin] })) return true;
    return chrome.permissions.request({ origins: [origin] });
}

function liveApiSettingsFromForm(getField) {
    const source = getField('source').value;
    return normalizeLiveApiSettings({
        source,
        category: getField('category')?.value || 'live',
        enabled: (getField('enabled')?.value || 'true') === 'true',
        name: getField('name').value,
        urlTemplate: getField('urlTemplate').value,
        responseType: getField('responseType').value,
        dataPath: getField('dataPath').value,
        dataKind: getField('dataKind').value,
        requestMode: getField('requestMode').value,
        fields: {
            code: getField('fieldCode').value,
            name: getField('fieldName').value,
            prevPrice: getField('fieldPrevPrice').value,
            price: getField('fieldPrice').value,
            rate: getField('fieldRate').value,
            date: getField('fieldDate').value,
            time: getField('fieldTime').value
        }
    });
}

async function testLiveApiSettings(settings, code) {
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
    if (settings.requestMode === 'batch' && settings.source === 'fundvaluationlast') {
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

async function openLiveApiSettings() {
    const current = normalizeLiveApiSettings(liveApiSettings);
    let getFormField = null;
    const result = await showFormModal({
        title: '接口适配器',
        subTitle: `当前使用：${current.name}`,
        actionText: '保存并刷新',
        layout: 'double',
        fields: [
            { id: 'source', label: '配置类型', type: 'select', value: current.source, options: [{ value: 'fundgz', label: '天天基金（内置）' }, { value: 'wealthagent', label: 'WealthAgent（本机）' }, { value: 'custom', label: '自定义适配器' }] },
            { id: 'name', label: '接口名称', value: current.name },
            { id: 'urlTemplate', label: 'URL 模板', value: current.urlTemplate },
            { id: 'responseType', label: '响应类型', type: 'select', value: current.responseType, options: [{ value: 'auto', label: '自动识别' }, { value: 'json', label: 'JSON' }, { value: 'jsonp', label: 'JSONP' }, { value: 'eastmoney_js', label: '东财净值 JS' }] },
            { id: 'dataKind', type: 'hidden', value: current.category === 'history' ? 'nav' : 'estimate' },
            { id: 'dataPath', label: '数据路径', value: current.dataPath, placeholder: '例如 data.result；根对象留空' },
            { id: 'fieldName', label: '名称字段路径', value: current.fields.name },
            { id: 'fieldPrevPrice', label: '上期净值字段路径', value: current.fields.prevPrice },
            { id: 'fieldPrice', label: '当前估值字段路径', value: current.fields.price },
            { id: 'fieldRate', label: '涨跌率字段路径', value: current.fields.rate },
            { id: 'fieldDate', label: '净值日期字段路径', value: current.fields.date },
            { id: 'fieldTime', label: '估值时间字段路径', value: current.fields.time },
            { id: 'testCode', label: '测试基金代码', value: '000001' }
        ],
        onRender: ({ root, getField }) => {
            getFormField = getField;
            const source = getField('source');
            const responseType = getField('responseType');
            const configurableIds = ['name', 'urlTemplate', 'responseType', 'dataKind', 'dataPath', 'fieldName', 'fieldPrevPrice', 'fieldPrice', 'fieldRate', 'fieldDate', 'fieldTime', 'testCode'];
            const mappingIds = ['dataKind', 'dataPath', 'fieldName', 'fieldPrevPrice', 'fieldPrice', 'fieldRate', 'fieldDate', 'fieldTime'];
            const sync = () => {
                const custom = source.value === 'custom';
                const wealthAgent = source.value === 'wealthagent';
                if (wealthAgent) {
                    const preset = WEALTHAGENT_LIVE_API_SETTINGS;
                    getField('name').value = preset.name;
                    getField('urlTemplate').value = preset.urlTemplate;
                    getField('responseType').value = preset.responseType;
                    getField('dataKind').value = preset.dataKind;
                    getField('dataPath').value = preset.dataPath;
                    getField('fieldName').value = preset.fields.name;
                    getField('fieldPrevPrice').value = preset.fields.prevPrice;
                    getField('fieldPrice').value = preset.fields.price;
                    getField('fieldRate').value = preset.fields.rate;
                    getField('fieldDate').value = preset.fields.date;
                    getField('fieldTime').value = preset.fields.time;
                }
                configurableIds.forEach(id => { getField(id).disabled = !custom; });
                const preset = responseType.value === 'eastmoney_js';
                if (preset) getField('dataKind').value = 'nav';
                mappingIds.forEach(id => { getField(id).disabled = !custom || preset; });
            };
            source.addEventListener('change', sync);
            responseType.addEventListener('change', sync);

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
                    const kindLabel = parsed.dataKind === 'nav' ? '已公布净值' : '盘中实时估值';
                    testStatus.textContent = `成功（${kindLabel}）：${parsed.name || '未命名'}，净值 ${parsed.gsz ?? parsed.dwjz}，涨跌 ${parsed.gszzl ?? '--'}，日期 ${parsed.gztime || parsed.jzrq || '--'}`;
                } catch (error) {
                    testStatus.textContent = `失败：${error.message}`;
                } finally {
                    testButton.disabled = false;
                }
            };
            testRow.append(testButton, testStatus);
            root.querySelector('.form-modal').appendChild(testRow);
            sync();
        }
    });
    if (!result) return;

    const next = liveApiSettingsFromForm(getFormField);
    if (!next.urlTemplate.includes('{code}')) {
        showToast('URL 模板必须包含 {code}', 'error');
        return;
    }
    try {
        if (!await requestLiveApiPermission(next.urlTemplate)) {
            showToast('未授予该接口的访问权限', 'error');
            return;
        }
    } catch (error) {
        showToast(`接口地址无效：${error.message}`, 'error');
        return;
    }
    liveApiSettings = next;
    await storageHelper.set(CONFIG.LIVE_API_SETTINGS_STORAGE_KEY, next);
    updateLiveApiSettingsButton();
    showToast(`接口已切换为：${next.name}`, 'success');
    triggerUnifiedRefresh('api-settings');
}

function liveApiSettingsFromValues(values) {
    return normalizeLiveApiSettings({
        source: values.source,
        category: values.category,
        enabled: values.enabled === true || values.enabled === 'true',
        name: values.name,
        urlTemplate: values.urlTemplate,
        responseType: values.responseType,
        dataPath: values.dataPath,
        dataKind: values.dataKind,
        requestMode: values.requestMode,
        fields: {
            code: values.fieldCode,
            name: values.fieldName,
            prevPrice: values.fieldPrevPrice,
            price: values.fieldPrice,
            rate: values.fieldRate,
            date: values.fieldDate,
            time: values.fieldTime
        }
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
            { id: 'category', label: '接口分类', type: 'select', value: current.category, options: [{ value: 'live', label: '实时估值' }, { value: 'history', label: '历史净值' }] },
            { id: 'enabled', label: '启用状态', type: 'select', value: String(current.enabled !== false), options: [{ value: 'true', label: '已启用' }, { value: 'false', label: '已停用' }] },
            { id: 'requestMode', label: '请求策略', type: 'select', value: ['wealthagent', 'fundvaluationlast'].includes(current.source) ? 'batch' : 'single', options: [{ value: 'single', label: '逐个请求' }, { value: 'batch', label: '批量请求' }] },
            { id: 'name', label: '接口名称', value: current.name, required: true },
            { id: 'urlTemplate', label: 'URL 模板', value: current.urlTemplate, required: true },
            { id: 'responseType', label: '响应类型', type: 'select', value: current.responseType, options: [{ value: 'auto', label: '自动识别' }, { value: 'json', label: 'JSON' }, { value: 'jsonp', label: 'JSONP' }, { value: 'eastmoney_js', label: '东财净值 JS' }] },
            { id: 'dataKind', label: '数据语义', type: 'select', value: current.dataKind, options: [{ value: 'estimate', label: '盘中实时估值' }, { value: 'nav', label: '已公布净值' }] },
            { id: 'dataPath', label: '数据路径', value: current.dataPath, placeholder: '例如 data.result；根对象留空' },
            { id: 'fieldCode', label: '基金代码字段路径', value: current.fields.code },
            { id: 'fieldName', label: '名称字段路径', value: current.fields.name },
            { id: 'fieldPrevPrice', label: '上期净值字段路径', value: current.fields.prevPrice },
            { id: 'fieldPrice', label: '当前估值字段路径', value: current.fields.price },
            { id: 'fieldRate', label: '涨跌率字段路径', value: current.fields.rate },
            { id: 'fieldDate', label: '净值日期字段路径', value: current.fields.date },
            { id: 'fieldTime', label: '估值时间字段路径', value: current.fields.time },
            { id: 'testCode', label: '测试基金代码', value: '000001' }
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
                getField('responseType').value = value.responseType;
                getField('dataKind').value = value.dataKind;
                getField('dataPath').value = value.dataPath;
                getField('fieldCode').value = value.fields.code;
                getField('fieldName').value = value.fields.name;
                getField('fieldPrevPrice').value = value.fields.prevPrice;
                getField('fieldPrice').value = value.fields.price;
                getField('fieldRate').value = value.fields.rate;
                getField('fieldDate').value = value.fields.date;
                getField('fieldTime').value = value.fields.time;
            };
            const rememberCurrent = () => {
                const index = profiles.findIndex(profile => profile.id === selectedId);
                if (index >= 0) profiles[index] = { id: selectedId, ...liveApiSettingsFromForm(getField) };
            };
            const renderOptions = () => {
                const categoryIndexes = { live: 0, history: 0 };
                profileSelect.replaceChildren(...profiles.map(profile => {
                    const option = document.createElement('option');
                    option.value = profile.id;
                    const category = profile.category === 'history' ? '历史' : '实时';
                    categoryIndexes[profile.category] = (categoryIndexes[profile.category] || 0) + 1;
                    option.textContent = `${category} ${categoryIndexes[profile.category]} · ${profile.enabled === false ? '停用' : '启用'} · ${profile.name}`;
                    return option;
                }));
                profileSelect.value = selectedId;
            };
            const sync = () => {
                const eastmoneyJs = responseType.value === 'eastmoney_js';
                getField('dataKind').value = getField('category').value === 'history' ? 'nav' : 'estimate';
                mappingIds.forEach(id => { getField(id).disabled = eastmoneyJs; });
            };
            profileSelect.addEventListener('change', () => {
                rememberCurrent();
                selectedId = profileSelect.value;
                applyProfile(profiles.find(profile => profile.id === selectedId));
                sync();
            });
            getField('requestMode').addEventListener('change', sync);
            getField('category').addEventListener('change', sync);
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
                    const kind = parsed.dataKind === 'nav' ? '已公布净值' : '盘中实时估值';
                    testStatus.textContent = `成功（${kind}）：${parsed.name || '未命名'}，净值 ${parsed.gsz ?? parsed.dwjz}，涨跌 ${parsed.gszzl ?? '--'}`;
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
    const validPlaceholder = next.requestMode === 'batch'
        ? next.urlTemplate.includes('{codes}') || next.urlTemplate.includes('{code}')
        : next.urlTemplate.includes('{code}');
    if (!validPlaceholder) { showToast(`URL 模板必须包含 ${next.requestMode === 'batch' ? '{codes}' : '{code}'}`, 'error'); return; }
    try {
        if (!await requestLiveApiPermission(next.urlTemplate)) { showToast('未授予该接口的访问权限', 'error'); return; }
    } catch (error) {
        showToast(`接口地址无效：${error.message}`, 'error');
        return;
    }
    const selectedIndex = profiles.findIndex(profile => profile.id === selectedId);
    profiles[selectedIndex] = { id: selectedId, ...next };
    liveApiProfiles = profiles;
    activeLiveApiProfileId = selectedId;
    liveApiSettings = { ...(profiles.find(profile => profile.category === 'live' && profile.enabled) || next) };
    await persistLiveApiProfiles();
    updateLiveApiSettingsButton();
    showToast('数据源配置已保存', 'success');
    triggerUnifiedRefresh('api-settings');
}
