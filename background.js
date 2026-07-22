// background.js - Service Worker (MV3)
// 代理请求：解决 popup 直接请求被目标站点拦截/中断的问题

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'FETCH_SINA') {
        fetch(message.url, {
            headers: {
                // 模拟普通浏览器请求头，防止被新浪反爬拒绝
                'Referer': 'https://finance.sina.com.cn',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
            }
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
        const headers = message.headers && typeof message.headers === 'object' ? message.headers : {};
        fetch(url, { headers })
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
            'Referer': 'https://fund.eastmoney.com/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };
        const headers = message.headers && typeof message.headers === 'object'
            ? { ...defaultHeaders, ...message.headers }
            : defaultHeaders;

        fetch(url, { headers })
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
