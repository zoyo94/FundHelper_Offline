// ==================== 请求 / 行情 / 历史净值接口域 ====================

function proxyFetchSina(url, timeout = 5000) {
    apiLogger.log('新浪代理', url, '发起请求');
    return new Promise((resolve) => {
        let resolved = false;
        const timer = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                apiLogger.log('新浪代理', url, '请求超时');
                resolve(null);
            }
        }, timeout);

        chrome.runtime.sendMessage({ type: 'FETCH_SINA', url }, (response) => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timer);

            if (chrome.runtime.lastError) {
                apiLogger.log('新浪代理', url, `运行时错误: ${chrome.runtime.lastError.message}`);
                resolve(null);
                return;
            }

            if (response && response.success && response.data) {
                const content = response.data.match(/"([^"]*)"/s);
                const result = content ? content[1] : null;
                if (result) {
                    apiLogger.log('新浪代理', url, '成功获取数据');
                } else {
                    apiLogger.log('新浪代理', url, '返回数据格式无效');
                }
                resolve(result);
            } else {
                apiLogger.log('新浪代理', url, '请求失败或无响应');
                resolve(null);
            }
        });
    });
}

function proxyFetchJson(url, { timeout = 5000, headers = {}, tag = '通用代理' } = {}) {
    apiLogger.log(tag, url, '发起请求');
    return new Promise((resolve) => {
        let resolved = false;
        const timer = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                apiLogger.log(tag, url, '请求超时');
                resolve(null);
            }
        }, timeout);

        chrome.runtime.sendMessage({ type: 'FETCH_JSON', url, headers }, (response) => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timer);

            if (chrome.runtime.lastError) {
                apiLogger.log(tag, url, `运行时错误: ${chrome.runtime.lastError.message}`);
                resolve(null);
                return;
            }

            if (response && response.success && response.data) {
                apiLogger.log(tag, url, '成功获取数据');
                resolve(response.data);
            } else {
                apiLogger.log(tag, url, '请求失败或无响应');
                resolve(null);
            }
        });
    });
}

function withTimeout(promise, ms, fallback) {
    const timer = new Promise(resolve => setTimeout(() => resolve(fallback), ms));
    return Promise.race([promise, timer]);
}

async function fetchEastmoneyJson(url, timeout = CONFIG.MARKET_BREADTH_TIMEOUT) {
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

    return proxyFetchJson(url, {
        timeout,
        tag: '东方财富代理',
        headers: {
            'Referer': 'https://quote.eastmoney.com/',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*'
        }
    });
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
        const url1 = `https://fundgz.1234567.com.cn/js/${cleanCode}.js?rt=${Date.now()}`;
        let mainResult = null;
        try {
            apiLogger.log('场外主接口', url1, '发起请求');
            const res = await fetch(url1);
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            }
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
                    mainResult = {
                        name: d.name || `[未知]${cleanCode}`,
                        rate: gszzl,
                        price: gsz,
                        prevPrice: dwjz,
                        prevPriceDate: d.jzrq || '',
                        priceTime: gztime
                    };
                    debugDividendTrace(cleanCode, 'fetch-main-success', {
                        prevPrice: dwjz,
                        price: gsz,
                        prevPriceDate: d.jzrq || '',
                        priceTime: gztime
                    });
                }
            }
            if (!mainResult) {
                apiLogger.log('场外主接口', url1, '数据无效(尝试备用)');
                debugDividendTrace(cleanCode, 'fetch-main-invalid-data', {});
            }
        } catch (e) {
            apiLogger.log('场外主接口', url1, `请求异常(${e.message})`);
            debugDividendTrace(cleanCode, 'fetch-main-error', { message: e.message });
        }

        const url2 = `https://fund.eastmoney.com/pingzhongdata/${cleanCode}.js?v=${Date.now()}`;
        try {
            apiLogger.log('场外备用接口', url2, '发起请求');
            const res2 = await fetch(url2);
            if (!res2.ok) {
                throw new Error(`HTTP ${res2.status}: ${res2.statusText}`);
            }
            const extData = await res2.text();
            if (extData && extData.includes('fS_name')) {
                const nameMatch = extData.match(/fS_name\s*=\s*"([^"]+)"/);
                const name = nameMatch ? nameMatch[1] : `[场外备用]${cleanCode}`;
                const netWorthMatch = extData.match(/Data_netWorthTrend\s*=\s*(\[[\s\S]*?\])\s*;/);
                if (netWorthMatch) {
                    const netWorthData = JSON.parse(netWorthMatch[1]);
                    if (netWorthData && netWorthData.length >= 2) {
                        const latest = netWorthData[netWorthData.length - 1];
                        const prev = netWorthData[netWorthData.length - 2];
                        const gsz = parseFloat(latest.y) || 0;
                        const dwjz = gsz;
                        const dateStr = latest.x ? timestampToDate(latest.x) : '';
                        const prevTradingDayPrice = parseFloat(prev.y) || 0;
                        const prevTradingDayDate = prev.x ? timestampToDate(prev.x) : '';

                        const dividendList = [];
                        const recentData = netWorthData.slice(-CONSTANTS.HISTORY_DAYS_LIMIT);
                        for (const item of recentData) {
                            if (item.unitMoney && item.unitMoney.includes('分红')) {
                                const match = item.unitMoney.match(/([0-9.]+)元/);
                                if (match) {
                                    const divDate = item.x ? timestampToDate(item.x) : '';
                                    dividendList.push({
                                        perShare: parseFloat(match[1]),
                                        date: divDate,
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
                                    const latestAC = acData[acData.length - 1];
                                    acNetValue = parseFloat(latestAC[1]) || null;
                                }
                            } catch (e) {
                                console.warn('解析累计净值失败:', e);
                            }
                        }

                        apiLogger.log('场外备用接口', url2, '成功');
                        debugDividendTrace(cleanCode, 'fetch-fallback-success', {
                            prevPriceDate: dateStr,
                            prevTradingDayDate,
                            prevTradingDayPrice,
                            acNetValue,
                            dividendListLength: dividendList.length,
                            dividendList: dividendList.map(div => ({
                                date: div.date,
                                perShare: div.perShare,
                                navPrice: div.navPrice
                            }))
                        });

                        const fallbackResult = {
                            name,
                            rate: null,
                            price: gsz,
                            prevPrice: dwjz,
                            prevPriceDate: dateStr,
                            prevTradingDayPrice,
                            prevTradingDayDate,
                            acNetValue,
                            dividendList,
                            isFallback: true
                        };

                        if (mainResult) {
                            mainResult.acNetValue = acNetValue;
                            mainResult.dividendList = dividendList;
                            mainResult.prevTradingDayPrice = prevTradingDayPrice;
                            mainResult.prevTradingDayDate = prevTradingDayDate;

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

                        debugDividendTrace(cleanCode, 'fetch-return-fallback-only', {
                            prevPriceDate: fallbackResult.prevPriceDate || '',
                            prevTradingDayDate: fallbackResult.prevTradingDayDate || '',
                            prevTradingDayPrice: fallbackResult.prevTradingDayPrice || 0,
                            dividendListLength: fallbackResult.dividendList.length
                        });

                        if (Array.isArray(netWorthData)) {
                            const dbItems = netWorthData.map(item => ({
                                code: cleanCode,
                                date: item.x ? timestampToDate(item.x) : '',
                                price: parseFloat(item.y),
                                acPrice: acMapInner.get(item.x) || null,
                                rate: typeof item.equityReturn !== 'undefined' ? parseFloat(item.equityReturn) : null,
                                dividend: item.unitMoney || ''
                            })).filter(d => d.date);

                            if (dbItems.length > 0) {
                                HistoryDB.batchPut(dbItems).catch(() => {});
                            }
                        }

                        return fallbackResult;
                    }
                }
            }
            apiLogger.log('场外备用接口', url2, '数据无效');
            debugDividendTrace(cleanCode, 'fetch-fallback-invalid-data', {});
        } catch (e) {
            apiLogger.log('场外备用接口', url2, `请求异常(${e.message})`);
            debugDividendTrace(cleanCode, 'fetch-fallback-error', { message: e.message });
        }

        if (mainResult) {
            debugDividendTrace(cleanCode, 'fetch-return-main-only', {
                prevPriceDate: mainResult.prevPriceDate || '',
                prevPrice: mainResult.prevPrice || 0,
                hasDividendList: Array.isArray(mainResult.dividendList)
            });
            return mainResult;
        }

        try {
            const p = cleanCode.startsWith('5') ? 'sh' : 'sz';
            const url = `https://hq.sinajs.cn/list=${p}${cleanCode}`;
            const data = await proxyFetchSina(url);
            if (data && typeof data === 'string') {
                const parts = data.split(',');
                if (parts.length > 10) {
                    const cur = parseFloat(parts[3]);
                    const pre = parseFloat(parts[2]);
                    if (!isNaN(cur) && !isNaN(pre) && cur > 0 && pre > 0) {
                        const rate = round2((cur - pre) / pre * 100);
                        return {
                            name: '[场]' + (parts[0] || cleanCode),
                            rate,
                            price: cur,
                            prevPrice: pre
                        };
                    }
                }
            }
        } catch (e) {
            console.warn(`场内基金解析失败 ${cleanCode}:`, e);
        }
    }

    try {
        const url = `https://hq.sinajs.cn/list=nf_${cleanCode.toUpperCase()}`;
        const fut = await proxyFetchSina(url);
        if (fut && typeof fut === 'string') {
            const parts = fut.split(',');
            if (parts.length > 10) {
                const cur = parseFloat(parts[8]);
                const pre = parseFloat(parts[5]);
                if (!isNaN(cur) && !isNaN(pre) && cur > 0 && pre > 0) {
                    const rate = round2((cur - pre) / pre * 100);
                    return {
                        name: '[期]' + (parts[0] || cleanCode),
                        rate,
                        price: cur,
                        prevPrice: pre
                    };
                }
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

async function fetchStockPrices(codes) {
    if (!codes || codes.length === 0) return {};

    try {
        const list = codes.join(',');
        const url = `https://qt.gtimg.cn/q=${list}`;
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        const decoder = new TextDecoder('gbk');
        const text = decoder.decode(buffer);

        const result = {};
        const lines = text.split(';');

        lines.forEach(line => {
            if (!line.trim() || !line.includes('~')) return;

            const parts = line.split('~');
            if (parts.length < 33) return;

            const match = parts[0].match(/v_([a-z0-9]+)=/);
            if (!match) return;
            const fullCode = match[1];
            const rate = parseFloat(parts[32]) || 0;
            result[fullCode] = { rate };
        });

        return result;
    } catch (err) {
        console.error('获取股票行情失败:', err);
        return {};
    }
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
            const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?secids=${secids}&ut=bd1d9ddb04089700cf9c27f6f7426281&invt=2&fields=f14,f12,f13,f2,f3,f4,f20`;
            try {
                if (i > 0) await new Promise(r => setTimeout(r, 300));
                const res = await fetchEastmoneyJson(url, CONFIG.MARKET_BREADTH_TIMEOUT);
                if (res && res.rc === 0 && Array.isArray(res.data?.diff)) {
                    results.push(...res.data.diff.map(item => ({
                        code: String(item.f12),
                        name: String(item.f14),
                        price: (Number(item.f2) === -1 || Number(item.f2) <= 0) ? 0 : Number(item.f2) / 100,
                        changeRate: Number(item.f3) === -1 ? 0 : Number(item.f3) / 100,
                        changeAmount: Number(item.f4) === -1 ? 0 : Number(item.f4) / 100,
                        marketValue: Number(item.f20) > 0 ? Number(item.f20) : undefined,
                    })));
                }
            } catch (e) {
                console.warn('[indexQuotes] 东财接口异常:', e);
            }
        }
        return results;
    };

    const fetchFromTencent = async (missingCodes) => {
        const codes = missingCodes.filter(c => TENCENT_MAP[c]);
        if (codes.length === 0) return [];
        try {
            const query = codes.map(c => TENCENT_MAP[c]).join(',');
            const resp = await fetch(`https://qt.gtimg.cn/q=${query}`);
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
        const codes = missingCodes.filter(c => SINA_MAP[c]);
        if (codes.length === 0) return [];
        try {
            const query = codes.map(c => SINA_MAP[c]).join(',');
            const resp = await fetch(`https://hq.sinajs.cn/list=${query}`, {
                headers: { Referer: 'https://finance.sina.com.cn/' }
            });
            const text = await resp.text();
            const results = [];
            text.split('\n').forEach(line => {
                const match = line.match(/hq_str_(\w+)="([^"]*)"/);
                if (!match || !match[2]) return;
                const parts = match[2].split(',');
                if (parts.length < 4) return;
                const price = parseFloat(parts[1]);
                const changeAmount = parseFloat(parts[2]);
                const changeRate = parseFloat(parts[3]);
                if (!price || price <= 0) return;
                const origCode = Object.keys(SINA_MAP).find(k => SINA_MAP[k] === match[1]);
                if (!origCode) return;
                const info = SUPPORTED_INDICES.find(s => s.code === origCode);
                results.push({
                    code: origCode,
                    name: info?.name || origCode,
                    price,
                    changeAmount: isNaN(changeAmount) ? 0 : changeAmount,
                    changeRate: isNaN(changeRate) ? 0 : changeRate,
                });
            });
            return results;
        } catch (e) {
            console.warn('[Sina] 备用接口失败:', e);
            return [];
        }
    };

    const fetchFromYahoo = async (missingCodes) => {
        const codes = missingCodes.filter(c => YAHOO_MAP[c]);
        if (codes.length === 0) return [];
        const results = [];
        for (const code of codes) {
            try {
                const url = `https://query1.finance.yahoo.com/v8/finance/chart/${YAHOO_MAP[code]}?range=1d&interval=1d`;
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
    const quoteUrl = 'https://push2.eastmoney.com/api/qt/ulist.np/get?secids=1.000001,0.399001&ut=bd1d9ddb04089700cf9c27f6f7426281&invt=2&fields=f14,f12,f13,f104,f105,f106';
    const changesUrl = 'https://push2ex.eastmoney.com/getStockCountChanges?type=4,8&ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wzchanges';

    const [quoteData, changesData] = await Promise.all([
        fetchEastmoneyJson(quoteUrl, CONFIG.MARKET_BREADTH_TIMEOUT),
        fetchEastmoneyJson(changesUrl, CONFIG.MARKET_BREADTH_TIMEOUT)
    ]);

    if (!quoteData || quoteData.rc !== 0 || !Array.isArray(quoteData.data?.diff)) {
        throw new Error('上涨下跌家数接口不可用');
    }
    if (!changesData || changesData.rc !== 0 || !Array.isArray(changesData.data?.ydlist)) {
        throw new Error('涨跌停家数接口不可用');
    }

    const up = quoteData.data.diff.reduce((sum, item) => sum + (Number(item.f104) || 0), 0);
    const down = quoteData.data.diff.reduce((sum, item) => sum + (Number(item.f105) || 0), 0);
    const limitUp = Number(changesData.data.ydlist.find(item => Number(item.t) === 4)?.ct) || 0;
    const limitDown = Number(changesData.data.ydlist.find(item => Number(item.t) === 8)?.ct) || 0;

    return { limitUp, up, down, limitDown };
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

async function fetchComparisonData(code, startDate, endDate) {
    try {
        const url = `https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`;
        const res = await fetch(url);
        const text = await res.text();

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
                    let dailyRate = item.JZZZL ? parseFloat(item.JZZZL) : null;
                    if (dailyRate === null && i > 0) {
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

        const url2 = `https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`;
        const res2 = await fetch(url2);
        const text = await res2.text();

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
                    const startTime = new Date(startDate).getTime();
                    const endTime = new Date(endDate).getTime();

                    const filtered = trendData
                        .filter(item => item.x >= startTime && item.x <= endTime)
                        .map((item, i, arr) => {
                            const price = parseFloat(item.y);
                            let dailyRate = typeof item.equityReturn !== 'undefined' ? parseFloat(item.equityReturn) : null;
                            if (dailyRate === null && i > 0) {
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
