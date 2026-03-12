const fs = require('fs');
let code = fs.readFileSync('popup.js', 'utf8');

const newLoadHoldings = `/**
 * 加载基金重仓股信息
 * @param {string} code - 基金代码
 */
async function loadHoldings(code) {
    const container = document.getElementById('tabHoldings');
    if (!container) return;

    try {
        const url = \`https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition?FCODE=\${code}&deviceid=Wap&plat=Wap&product=EFund&version=6.5.9\`;
        const res = await fetch(url);
        const data = await res.json();
        
        const stockCodes = [];
        const stockNames = [];
        const stockPercents = [];
        
        if (data && data.Datas && data.Datas.fundStocks && data.Datas.fundStocks.length > 0) {
            data.Datas.fundStocks.forEach(stock => {
                stockCodes.push(stock.GPDM);
                stockNames.push(stock.GPJC);
                stockPercents.push(stock.JZBL);
            });
        }
        
        if (stockCodes.length === 0) {
            container.innerHTML = \`
                <div style="text-align:center;padding:10px 0;">
                    <img src="https://fundpicturecdn.eastmoney.com/fund_detail_img/\${code}.png?t=\${Date.now()}"
                        style="width:100%;border-radius:6px;"
                        onerror="this.parentElement.innerHTML='<div class=\\'detail-error\\'>暂无重仓数据</div>';"
                    />
                </div>\`;
            return;
        }

        console.log('[loadHoldings] 获取到', stockCodes.length, '只重仓股');

        // 构建腾讯股票代码列表
        const stockList = stockCodes.slice(0, 10).map((c, idx) => {
            const stockData = data.Datas.fundStocks[idx];
            if (stockData.TEXCH === '1') return 'sh' + c;
            if (stockData.TEXCH === '2') return 'sz' + c;
            if (stockData.TEXCH === '5' || stockData.TEXCH === '8' || stockData.NEWTEXCH === '116') {
               let hkCode = c;
               while (hkCode.length < 5) hkCode = '0' + hkCode;
               return 'hk' + hkCode;
            }
            if (c.startsWith('6')) return 'sh' + c;
            return 'sz' + c;
        });

        const stockPrices = await fetchStockPrices(stockList);

        let html = '<div class="holdings-grid">';
        stockCodes.slice(0, 10).forEach((stockCode, idx) => {
            const marketCode = stockList[idx];
            const priceInfo = stockPrices[marketCode] || { rate: 0 };
            const changeClass = priceInfo.rate >= 0 ? 'up' : 'down';
            const changeSign = priceInfo.rate >= 0 ? '+' : '';
            const name = stockNames[idx] || stockCode;
            const percent = stockPercents[idx] || '--';

            html += \`
                <div class="holding-card">
                    <div class="holding-card-left">
                        <div class="holding-card-name">\${name}</div>
                        <div class="holding-card-badge">\${stockCode} · \${percent}%</div>
                    </div>
                    <div class="holding-card-right">
                        <div class="holding-card-rate \${changeClass}">\${changeSign}\${priceInfo.rate.toFixed(2)}%</div>
                    </div>
                </div>
            \`;
        });
        html += '</div>';
        container.innerHTML = html;

    } catch (err) {
        container.innerHTML = '<div class="detail-error">加载持仓失败</div>';
        console.error('[loadHoldings] 加载持仓失败:', err);
    }
}`;

const startIndex = code.indexOf('/**\n * 加载基金重仓股信息');
const endStr = '\n// ==================== 数据获取函数（优化版） ====================';
const endIndex = code.indexOf(endStr);
if (startIndex !== -1 && endIndex !== -1) {
  code = code.substring(0, startIndex) + newLoadHoldings + '\n\n' + code.substring(endIndex + 1);
  fs.writeFileSync('popup.js', code);
  console.log('Successfully patched popup.js');
} else {
  console.log('Failed to patch popup.js', startIndex, endIndex);
}

