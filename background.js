// background.js - Service Worker (MV3)
// 代理请求：解决 popup 直接请求被目标站点拦截/中断的问题

const FUND_F10_REFERER_RULE_ID = 33010;

function ensureFundF10RefererRule() {
    if (!chrome.declarativeNetRequest?.updateDynamicRules) return;
    chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [FUND_F10_REFERER_RULE_ID],
        addRules: [{
            id: FUND_F10_REFERER_RULE_ID,
            priority: 1,
            action: {
                type: 'modifyHeaders',
                requestHeaders: [{
                    header: 'Referer',
                    operation: 'set',
                    value: 'http://fundf10.eastmoney.com/ccmx_000001.html'
                }]
            },
            condition: {
                urlFilter: '||fundf10.eastmoney.com/FundArchivesDatas.aspx',
                resourceTypes: ['xmlhttprequest']
            }
        }]
    }, () => {
        if (chrome.runtime.lastError) {
            console.warn('[background] F10 Referer 规则注册失败:', chrome.runtime.lastError.message);
        }
    });
}

ensureFundF10RefererRule();
chrome.runtime.onInstalled?.addListener(ensureFundF10RefererRule);
chrome.runtime.onStartup?.addListener(ensureFundF10RefererRule);

// FETCH_JSON / FETCH_TEXT 共用实现：唯一差异是响应解析方式（json / text）。
// 注意 Chrome 扩展 service worker 的 fetch 会剥离 Referer / User-Agent 等禁止头，
// 必须改用 fetch 规范的 referrer 选项传递来源，否则东财等接口会因缺少来源而软失败（Datas=null）。
function proxyFetchAndRespond(sendResponse, url, incomingHeaders, parseAs, label) {
    const safeHeaders = incomingHeaders && typeof incomingHeaders === 'object' ? incomingHeaders : {};
    const referrer = safeHeaders.Referer || safeHeaders.referer || 'https://fund.eastmoney.com/';
    const headers = {
        'Accept': 'application/json, text/plain, */*',
        ...safeHeaders
    };
    delete headers.Referer;
    delete headers.referer;
    delete headers['User-Agent'];
    delete headers['user-agent'];

    fetch(url, { headers, referrer, referrerPolicy: 'unsafe-url' })
        .then(async res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = parseAs === 'json' ? await res.json() : await res.text();
            sendResponse({ success: true, data });
        })
        .catch(err => {
            const isPush2Block = url.includes('push2.eastmoney.com') && err.message.includes('Failed to fetch');
            if (!isPush2Block) console.warn(`[background] ${label} 请求失败:`, url, err.message);
            sendResponse({ success: false, error: err.message });
        });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'FETCH_SINA') {
        fetch(message.url, {
            referrer: 'https://finance.sina.com.cn/',
            referrerPolicy: 'unsafe-url',
            headers: { 'Accept': '*/*' }
        })
            .then(res => res.text())
            .then(text => sendResponse({ success: true, data: text }))
            .catch(err => {
                console.error('[background] FETCH_SINA 请求失败:', message.url, err);
                sendResponse({ success: false, error: err.message });
            });

        // 返回 true 表示异步响应，必须保留
        return true;
    }

    if (message.type === 'FETCH_JSON') {
        proxyFetchAndRespond(sendResponse, message.url, message.headers, 'json', 'FETCH_JSON');
        // 返回 true 表示异步响应，必须保留
        return true;
    }

    if (message.type === 'FETCH_TEXT') {
        proxyFetchAndRespond(sendResponse, message.url, message.headers, 'text', 'FETCH_TEXT');
        // 返回 true 表示异步响应，必须保留
        return true;
    }
});
