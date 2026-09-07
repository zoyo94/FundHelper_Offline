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
        const url = message.url;
        const incomingHeaders = message.headers && typeof message.headers === 'object' ? message.headers : {};
        // Chrome 扩展 service worker 的 fetch 会剥离 Referer / User-Agent 等禁止头，
        // 必须改用 fetch 规范的 referrer 选项传递来源，否则东财等接口会因缺少来源而软失败（Datas=null）。
        const referrer = incomingHeaders.Referer || incomingHeaders.referer || 'https://fund.eastmoney.com/';
        const headers = { ...incomingHeaders };
        delete headers.Referer;
        delete headers.referer;
        delete headers['User-Agent'];
        delete headers['user-agent'];
        fetch(url, { headers, referrer, referrerPolicy: 'unsafe-url' })
            .then(async res => {
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }
                const data = await res.json();
                sendResponse({ success: true, data });
            })
            .catch(err => {
                console.error('[background] FETCH_JSON 请求失败:', url, err);
                sendResponse({ success: false, error: err.message });
            });
        return true;
    }

    if (message.type === 'FETCH_TEXT') {
        const url = message.url;
        const defaultHeaders = {
            'Accept': 'application/json, text/plain, */*'
        };
        const incomingHeaders = message.headers && typeof message.headers === 'object' ? message.headers : {};
        const referrer = incomingHeaders.Referer || incomingHeaders.referer || 'https://fund.eastmoney.com/';
        const headers = { ...defaultHeaders, ...incomingHeaders };
        delete headers.Referer;
        delete headers.referer;
        delete headers['User-Agent'];
        delete headers['user-agent'];

        fetch(url, { headers, referrer, referrerPolicy: 'unsafe-url' })
            .then(async res => {
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }
                const text = await res.text();
                sendResponse({ success: true, data: text });
            })
            .catch(err => {
                console.error('[background] FETCH_TEXT 请求失败:', url, err);
                sendResponse({ success: false, error: err.message });
            });
        return true;
    }
});
