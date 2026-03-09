// background.js - Service Worker (MV3)
// 代理新浪行情请求，解决 popup 直接请求时的跨域问题

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
});
