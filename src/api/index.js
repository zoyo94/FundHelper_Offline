export const apiLogger = {
    loggedApis: new Set(), // 用于记录已打印日志的接口

    // 重置状态（在 loadData 开始时调用）
    reset() {
        this.loggedApis.clear();
        console.log('%c[API Monitor] 日志状态已重置，开始监测接口...', 'color: #1890ff; font-weight: bold;');
    },

    /**
     * 打印日志（仅第一次调用时打印）
     * @param {string} apiName 接口名称
     * @param {string} url 请求地址
     * @param {string} status 状态描述
     */
    log(apiName, url, status) {
        if (this.loggedApis.has(apiName)) return; // 已经记录过，跳过

        console.log(`[API Monitor] ${apiName} | 状态: ${status} | 地址: ${url}`);
        this.loggedApis.add(apiName);
    }
};

// ==================== 新浪行情代理请求 ====================
export function proxyFetchSina(url) {
    // --- 新增日志 ---
    apiLogger.log('新浪代理', url, '发起请求');
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'FETCH_SINA', url: url }, (response) => {
            if (response && response.success && response.data) {
                const content = response.data.match(/"(.*)"/);
                const result = content ? content[1] : null;
                // --- 新增日志：记录成功 ---
                if (result) {
                    apiLogger.log('新浪代理', url, '成功获取数据');
                } else {
                    apiLogger.log('新浪代理', url, '返回数据格式无效');
                }
                resolve(result);
            } else {
                // --- 新增日志：记录失败 ---
                apiLogger.log('新浪代理', url, '请求失败或无响应');
                resolve(null);
            }
        });
    });
}
// ==================== 综合行情接口 ====================
export async function fetchLiveInfo(code) {
    const cleanCode = code.trim();
    if (/^\d{6}$/.test(cleanCode)) {
        // 1. 场外基金（主接口）
        const url1 = `https://fundgz.1234567.com.cn/js/${cleanCode}.js?rt=${Date.now()}`;
        try {
            apiLogger.log('场外主接口', url1, '发起请求');
            const res = await fetch(url1);
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
                    return {
                        name: d.name || `[未知]${cleanCode}`,
                        rate: gszzl,
                        price: gsz,
                        prevPrice: dwjz,
                        prevPriceDate: d.jzrq || '',
                        priceTime: gztime
                    };
                }
            }
            apiLogger.log('场外主接口', url1, '数据无效(尝试备用)');
        } catch (e) {
            apiLogger.log('场外主接口', url1, `请求异常(${e.message})`);
        }
        // 1.5 场外基金备用接口
        const url2 = `https://fund.eastmoney.com/pingzhongdata/${cleanCode}.js?v=${Date.now()}`;
        try {
            apiLogger.log('场外备用接口', url2, '发起请求');
            const extData = await fetch(url2).then(r => r.text());
            if (extData && extData.includes('fS_name')) {
                const nameMatch = extData.match(/fS_name\s*=\s*"([^"]+)"/);
                const name = nameMatch ? nameMatch[1] : `[场外备用]${cleanCode}`;
                const netWorthMatch = extData.match(/Data_netWorthTrend\s*=\s*(\[.*?\])\s*;/);
                if (netWorthMatch) {
                    const netWorthData = JSON.parse(netWorthMatch[1]);
                    if (netWorthData && netWorthData.length >= 2) {
                        const latest = netWorthData[netWorthData.length - 1];
                        const gsz = parseFloat(latest.y) || parseFloat(latest.unitMoney) || 0;
                        const dwjz = gsz;
                        const dateStr = latest.x ? (() => { const d = new Date(latest.x); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })() : '';
                        apiLogger.log('场外备用接口', url2, '成功');
                        return {
                            name: name,
                            rate: null,
                            price: gsz,
                            prevPrice: dwjz,
                            prevPriceDate: dateStr,
                            isFallback: true
                        };
                    }
                }
            }
            apiLogger.log('场外备用接口', url2, '数据无效');
        } catch (e) {
            apiLogger.log('场外备用接口', url2, `请求异常(${e.message})`);
        }
        // 2. 场内基金（ETF/LOF）
        try {
            const p = cleanCode.startsWith('5') ? 'sh' : 'sz';
            const url = `https://hq.sinajs.cn/list=${p}${cleanCode}`;
            const data = await proxyFetchSina(url);
            if (data && data.split(',').length > 10) {
                const parts = data.split(',');
                const cur = parseFloat(parts[3]) || 0;
                const pre = parseFloat(parts[2]) || 0;
                const rate = pre !== 0 ? parseFloat(((cur - pre) / pre * 100).toFixed(2)) : 0;
                return {
                    name: '[场]' + (parts[0] || cleanCode),
                    rate: rate,
                    price: cur,
                    prevPrice: pre
                };
            }
        } catch (e) {
            console.warn(`场内基金解析失败 ${cleanCode}:`, e);
        }
    }
    // 3. 期货
    try {
        const url = `https://hq.sinajs.cn/list=nf_${cleanCode.toUpperCase()}`;
        const fut = await proxyFetchSina(url);
        if (fut) {
            const parts = fut.split(',');
            if (parts.length > 10) {
                const cur = parseFloat(parts[8]) || 0;
                const pre = parseFloat(parts[5]) || 0;
                const rate = pre !== 0 ? parseFloat(((cur - pre) / pre * 100).toFixed(2)) : 0;
                return {
                    name: '[期]' + (parts[0] || cleanCode),
                    rate: rate,
                    price: cur,
                    prevPrice: pre
                };
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
