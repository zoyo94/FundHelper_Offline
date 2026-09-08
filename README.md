# FundHelper - 本地私有资产收益追踪器

<div align="center">

**Chrome Extension MV3 | 纯本地存储 (Local-First) | 实时估值走势 | OCR 批量导入**

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue?logo=google-chrome)](https://www.google.com/chrome/)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)](https://developer.chrome.com/docs/extensions/mv3/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

</div>

---

## 📖 项目简介

FundHelper 是一款纯本地存储 (Local-First)、隐私优先的 Chrome 资产追踪扩展。所有资产持仓、交易订单与历史快照完全存放在您的浏览器本地（IndexedDB & LocalStorage），不经过任何中转服务器或云端。

> [!NOTE]
> **联网与离线功能说明**：
> - 🌐 **实时行情需要联网**：最新基金估值、历史净值及大盘指数需要请求金融公开数据接口。
> - 🔒 **数据管理完全本地**：资产查看、收益计算、OCR 截图识别、历史订单管理及备份导出 100% 本地处理，断网亦可查看已存持仓。

### ✨ 核心特性

- 🔒 **纯本地存储** - 零账号注册，所有资产与订单数据仅保存在您本地浏览器中
- 📊 **实时估值** - 自动拉取最新净值和估值，实时计算持仓与累计收益
- 💰 **持仓累计收益** - 新增持仓成本追踪，独立展示当前持有部分的盈亏，与累计收益互补
- 📈 **走势图表** - 今日估值走势图，支持刷新后数据保留
- 🖼️ **OCR 识别** - 本地 WASM 识别截图批量导入资产，自动提取代码与金额
- 💰 **收益计算** - 自动/手动日结算，按接口交易日准确计算昨日收益并保留首份备份
- ⚡ **快速刷新** - 估值与历史净值并发请求，刷新耗时大幅缩短
- 🔄 **加减仓管理** - T+1/T+2 确认机制，自动计算份额与交割状态
- 📁 **分组管理** - 自由分组，批量操作，灵活管理
- 🎨 **现代 UI** - 深色主题，流畅动画，优雅交互
- ⚙️ **列显示控制** - 顶部齿轮面板按需开关列，偏好自动持久化，全屏列独立生效
- 🧱 **区间数据硬保留** - 近1周/1月/3月/6月/1年涨跌幅跨会话保留，次日静默刷新
- 📅 **成立以来涨跌幅** - 全屏表格展示基金成立以来总收益率
- 📈 **指数行情实时监控** - 支持 20+ 指数（A股/美股/港股/日本/韩国等），实时涨跌幅、市值，可自定义追踪列表

---

## 🚀 快速开始

### 安装方式

1. **下载项目**
   ```bash
   git clone https://github.com/yourusername/FundHelper_Offline.git
   cd FundHelper_Offline
   ```

2. **加载扩展**
   - 打开 Chrome 浏览器
   - 访问 `chrome://extensions/`
   - 开启右上角「开发者模式」
   - 点击「加载已解压的扩展程序」
   - 选择项目文件夹

3. **开始使用**
   - 点击扩展图标打开主界面
   - 点击「➕」按钮添加第一个资产
   - 或使用「📷 图片识别批量添加」快速导入

---

## 📚 功能详解

### 1️⃣ 资产管理

#### 添加资产
- **手动添加**：输入代码、金额、份额等信息
- **OCR 批量添加**：上传持仓截图，自动识别并批量导入；结果表格支持编辑确认净值日、费率%、分红方式，「批量填写」栏可一键应用到选中行；保存流程与手动新增一致（写入 HistoryDB initial 订单 + 补录历史分红）
- **支持类型**：基金（6位数字）、期货（字母+数字）

#### 编辑资产
- 双击表格行打开详情页
- 点击齿轮图标快速操作
- 表格内直接编辑金额、份额、收益

#### 批量操作
- 多选资产（支持 Shift 范围选择）
- 批量修改分组
- 批量清空持仓
- 批量删除资产
- 批量重算份额

### 2️⃣ 加减仓管理

#### 加仓
- 输入买入金额和费率
- 自动计算 T+1/T+2 确认日期
- 到期自动确认份额

#### 减仓
- 输入卖出份额
- 自动计算 T+1/T+2 确认日期
- 到期自动扣减份额

#### 交易记录
- 查看所有待确认/已确认交易
- 撤销待确认交易
- 详细的交易信息展示

### 3️⃣ 收益计算

#### 自动日结算
- 每次打开时按接口返回的 `prevPriceDate` 检查是否需要结算
- 仅结算净值日期真正推进的资产，支持同一天晚到数据补结算
- 周末/节假日或接口未更新时，不会把旧的昨日收益误当成新收益

#### 手动日结算
- 点击「日结算」按钮
- 首次执行前自动保存“当天第一份结算前快照”
- 同日多次结算不会覆盖首份备份，支持撤销后继续对比

#### 收益展示
- **当日预估收益**：基于实时估值计算
- **昨日收益**：上次结算的实际收益
- **持仓累计收益**：当前持有部分的盈亏（amount - positionCost），不含已卖出仓位
- **累计收益**：全部历史盈亏，含已卖出仓位 + 现金分红
- **总收益**：持有收益 + 当日预估收益

### 4️⃣ 实时估值走势

#### 今日走势图
- 自动记录每次刷新的估值数据
- 绘制 09:30-15:00 分时走势
- 支持鼠标悬停查看详情
- **刷新页面数据保留，第二天自动清空**

#### 历史走势
- 查看近 1 月/3 月/6 月/1 年走势
- 对比基准收益率
- 计算最大回撤、年化收益、波动率

### 5️⃣ 基金详情

#### 基本信息
- 单位净值、估值净值
- 昨日涨幅、估值涨幅
- 持仓金额、当日收益、持有收益

#### 前 10 重仓股
- 实时股票行情
- 持仓占比
- 涨跌幅展示

#### 历史业绩
- 多周期收益对比（近1月/3月/6月/1年/3年/成立来）
- 业绩走势图表，支持辅助线悬停对比
- 点击「更多」罗列当前周期全部历史净值

### 6️⃣ 数据管理

#### 导出数据
- 导出当前实时数据为 JSON 格式
- 包含当前持仓、交易记录和昨日收益快照
- 文件名自动带时间戳

#### 导出备份数据
- 从 FAB 菜单导出最近一次结算前快照（备份在每天首次结算前自动生成）
- 适合在撤销前后对比差异，也可追溯任意历史结算日的数据
- 备份不是今天生成时会提示备份日期并二次确认；从未产生过备份时才拒绝导出

#### 导入数据
- 支持导入之前导出的 JSON 文件
- 自动数据迁移和格式转换
- 导入前确认提示

#### 数据备份
- 自动/手动结算前统一尝试备份
- `backupFunds` 始终表示“当天第一次结算前”的原始快照
- 同日多次结算、撤销后再次结算都不会覆盖这份首份备份
- 撤销结算只恢复数据，不会清空当天首份备份

---

## 🛠️ 技术架构

### 核心技术栈

- **Chrome Extension Manifest V3** - 最新扩展规范
- **Vanilla JavaScript** - 无框架依赖，轻量高效，25 个职责单一的模块
- **Tesseract.js v4** - 离线 OCR 识别引擎（按需懒加载）
- **Chrome Storage API** - 本地数据持久化
- **Canvas API** - 走势图表绘制
- **Eastmoney/Tencent/Sina API** - 多源指数行情数据

### 项目结构

```
FundHelper_Offline/
├── manifest.json                    # 扩展配置文件 (v3.7.0)
├── popup.html                       # 主界面 HTML (311 行，纯结构)
│
├── popup_base.css                   # 基础样式：重置 / Header / 指数面板 / 统计栏 / 筛选栏
├── popup_components.css             # 组件样式：表格 / Toast / Modal / 表单弹窗 / 响应式
├── popup_overlay.css                # 弹窗样式：居中操作弹窗 / 基金详情 / 刷新间隔
│
├── popup.js                         # 配置 / 全局状态 / 通用工具 (~590 行)
├── popup_history.js                 # IndexedDB 持久化 (HistoryDB)
├── background.js                    # 后台服务 (代理新浪 API)
│
├── popup_api.js                     # 多源行情接口 (天天/东财/新浪/腾讯)
├── popup_fund_detail.js             # 基金详情弹窗数据装载
├── popup_ocr.js                     # OCR 批量识别 (Tesseract.js 懒加载)
├── popup_import_export.js           # 数据导入导出 (JSON / CSV)
│
├── popup_trade.js                   # 交易归一化 / 持仓快照 / 订单 CRUD / 迁移
├── popup_trade_dividend.js          # 分红检测 / 自动录入 / 历史补录
├── popup_trade_settlement.js        # 结算运行时 / 挂起调整 / 状态持久化
├── popup_trade_utils.js             # 交易日计算 / 份额金额计算 / 撤销截止
├── popup_trade_form.js              # 交易表单 / 加减仓 / 历史补录 / 基金编辑器
│
├── popup_batch_ops.js               # 批量操作：分组 / 清仓 / 删除 / 重算
├── popup_center_menu.js             # 居中弹窗菜单 / 待确认交易 / 清除订单
├── popup_ui.js                      # Toast / Modal / 通知中心
│
├── popup_perf_cache.js              # 业绩缓存 / 状态 / 周期配置 / 工具函数
├── popup_perf_init.js               # 初始化 / 事件绑定 / 刷新间隔选择器
├── popup_perf_data.js               # 数据加载 / 行情刷新 / 指数行情
├── popup_perf_render.js             # 表格渲染 / 选中状态 / 删除基金
├── popup_perf_chart.js              # Canvas 走势图绘制
├── popup_perf_panel.js              # 业绩面板布局
├── popup_perf_state.js              # 业绩缓存与会话状态
├── popup_perf_table.js              # 业绩表格渲染
│
├── popup_settlement_rollback.js     # 撤销结算 / 备份管理 / 份额推导 (核心算法)
├── popup_profit_calendar_ui.js      # 收益日历 UI (纯展示层，按月/年/全周期切换)
├── popup_settlement_run.js          # 手动/自动日结算 / 状态持久化
│
├── tesseract.min.js                 # OCR 核心库 (按需懒加载)
├── worker.min.js                    # OCR Worker
├── tesseract-core.wasm.js           # WASM 核心
├── chi_sim.traineddata              # 中文简体训练数据
└── README.md                        # 项目文档
```

> v3.5.0 架构演进：从 `popup_settlement_rollback.js` 拆分出纯展示层 `popup_profit_calendar_ui.js`；重构 `<colgroup>` 定宽与 `updateStickyLeft` 动态冻结列；新增 `calculatePositionCostFromOrders` 与 `calculateTotalInvestedCostFromOrders` 解决累计收益率分母失真；全链路统一 `escapeHtml()` XSS 防御；完善 MV3 `declarativeNetRequest` 规则解决天天基金 F10 请求 Referer 限制。

### 代码优化亮点

#### 1. CSS 模块化拆分
- 4530 行内联 `<style>` 提取为 3 个独立 CSS 文件（base / components / overlay）
- popup.html 从 4784 行缩减至 275 行，改样式不再需要在 HTML 中翻找

#### 2. JS 模块化拆分（14 → 25 个模块）
- 原始 `popup_perf.js`（4710 行）拆分为 4 个文件：缓存 / 初始化 / 数据加载 / 渲染
- 原始 `popup_settlement.js`（2121 行）拆分为 2 个文件：撤销结算 / 日结算运行时
- 原始 `popup_trade.js`（1473 行）拆分为 3 个文件：核心 / 分红 / 结算
- 原始 `popup_position_ui.js`（1833 行）拆分为 3 个文件：批量操作 / 交易表单 / 居中菜单
- 最大文件从 4710 行降至 1463 行，超过 500 行的文件从 8 个降至 6 个

#### 3. OCR 引擎懒加载
- Tesseract 三个脚本从 `<script>` 硬编码改为点击"传图识别"时动态加载
- 不使用 OCR 功能时不再加载 WASM 核心，弹窗打开速度提升

#### 4. fetchLiveInfo 函数拆分
- 233 行单体函数拆分为 5 个子函数，每个只做一件事：
  - `fetchLiveInfo()` — 主路由
  - `_fetchOutOfMarketFund()` — 场外基金并发请求 + 合并
  - `_parseFundgzResponse()` — 解析天天基金估值
  - `_parseEastmoneyResponse()` — 解析东财历史净值
  - `_fetchOnMarketFundSina()` / `_fetchFuturesSina()` — 场内基金 / 期货

#### 5. 统一的 Storage 访问层（带错误处理）
```javascript
const storage = {
    async get(keys) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(keys, (result) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(`Storage get error: ${chrome.runtime.lastError.message}`));
                } else {
                    resolve(result);
                }
            });
        });
    },
    async set(data) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.set(data, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(`Storage set error: ${chrome.runtime.lastError.message}`));
                } else {
                    resolve();
                }
            });
        });
    }
};
```

#### 6. 数值格式化工具（带类型检查）
```javascript
function round2(num) {
    if (typeof num !== 'number' || isNaN(num)) {
        console.warn('round2: 输入不是有效数字:', num);
        return 0;
    }
    return parseFloat(num.toFixed(2));
}
```

#### 7. 全面使用 async/await
- 消除回调地狱
- 代码更清晰易读
- 错误处理更统一

#### 8. 走势数据持久化
- 自动保存到 `chrome.storage.local`
- 刷新页面数据不丢失
- 第二天自动清理旧数据

---

## 📊 数据结构

### myFunds 数据格式

```javascript
{
  "005827": {
    "amount": 10000.00,              // 当前持仓金额
    "shares": 9523.81,               // 当前持有份额 (保留2位小数)
    "holdProfit": 1234.56,           // 累计收益 (含已卖出盈亏 + 现金分红)
    "positionCost": 8765.44,        // 持仓成本 (买入总额 - 现金分红 - 按比例减仓)
    "yesterdayProfit": 123.45,       // 昨日收益 (上次结算的单日收益)
    "group": "股票型",                // 分组名称
    "dividendMode": "cash",          // 分红方式: "cash"(现金分红) | "reinvest"(红利再投)
    "savedPrevPrice": 1.0500,        // 上次结算净值 (结算基准价格)
    "savedPrevDate": "2026-03-11",   // 上次结算日期
    "savedAcNetValue": 1.0520,       // 上次结算累计净值 (用于分红检测)
    "addedDate": "2026-03-01",       // 资产添加日期 (用于过滤历史分红)
    "pendingAdjustments": [          // 待确认交易记录
      {
        // 加仓记录
        "type": "add",               // 交易类型
        "amount": 1000,              // 买入金额
        "feeRate": 0.15,             // 申购费率 (%)
        "targetDate": "2026-03-13",  // 确认日期 (T+1/T+2)
        "orderDate": "2026-03-12",   // 下单日期
        "orderNav": 1.0500,          // 下单时净值
        "status": "pending",         // 状态: "pending" | "confirmed"
        "confirmedPrice": 1.0520,    // 确认时净值 (确认后)
        "confirmedShares": 952.38,   // 确认份额 (确认后)
        "confirmedDate": "2026-03-13" // 确认日期 (确认后)
      },
      {
        // 减仓记录
        "type": "remove",
        "shares": 500,               // 赎回份额
        "feeRate": 0.5,              // 赎回费率 (%)
        "targetDate": "2026-03-15",
        "orderDate": "2026-03-14",
        "orderNav": 1.0600,
        "status": "pending"
      },
      {
        // 分红记录 (自动检测)
        "type": "dividend",
        "dividendAmount": 50.25,     // 分红金额 (总额)
        "perShare": 0.0053,          // 每份分红 (元/份)
        "dividendNavPrice": 1.0500,  // 分红日净值
        "dividendDate": "2026-03-10", // 分红日期 (权益登记日)
        "targetDate": "2026-03-12",  // 到账日期 (D+2工作日)
        "orderDate": "2026-03-11",   // 记录日期
        "status": "pending",
        "autoDetected": true,        // 自动检测标记
        "confirmedDate": "2026-03-12" // 确认到账日期 (确认后)
      },
      {
        // 红利再投记录
        "type": "dividend_reinvest",
        "dividendAmount": 30.15,
        "perShare": 0.0032,
        "dividendNavPrice": 1.0480,
        "dividendDate": "2026-02-28",
        "targetDate": "2026-03-02",
        "status": "confirmed",
        "autoDetected": true,
        "confirmedDate": "2026-03-02",
        "reinvestShares": 28.77      // 再投资份额 (确认后)
      }
    ]
  }
}
```

### pendingAdjustments 交易类型详解

#### 1. 加仓 (type: "add")
- `amount`: 买入金额
- `feeRate`: 申购费率 (%)
- `orderNav`: 下单时净值 (参考)
- 确认后自动增加 `shares` 和 `amount`

#### 2. 减仓 (type: "remove")
- `shares`: 赎回份额
- `feeRate`: 赎回费率 (%)
- `orderNav`: 下单时净值 (参考)
- 确认后自动减少 `shares` 和 `amount`，扣减手续费

#### 3. 现金分红 (type: "dividend")
- `dividendAmount`: 分红总金额
- `perShare`: 每份分红金额
- `dividendDate`: 权益登记日 (分红日)
- `targetDate`: 到账日期 (D+2工作日，遇周末顺延)
- `autoDetected`: 是否为系统自动检测

#### 4. 红利再投 (type: "dividend_reinvest")
- 同现金分红字段
- `reinvestShares`: 再投资增加的份额
- 确认后自动增加 `shares`

### fundHistoryData 数据格式

```javascript
{
  "005827": {
    "date": "2026-03-12",            // 日期
    "points": [                      // 走势点
      { "time": "09:30", "rate": 0 },
      { "time": "10:00", "rate": 0.52 },
      { "time": "11:30", "rate": 0.78 }
    ]
  }
}
```

---

## 🔧 配置说明

### manifest.json 关键配置

```json
{
  "manifest_version": 3,
  "name": "资产收益助手",
  "version": "3.7.0",
  "permissions": [
    "storage",
    "declarativeNetRequestWithHostAccess"
  ],
  "host_permissions": [
    "https://fundgz.1234567.com.cn/*",
    "https://fundcomapi.tiantianfunds.com/*",
    "https://fundcomapi.eastmoney.com/*",
    "https://stock.finance.sina.com.cn/*",
    "https://hq.sinajs.cn/*",
    "https://fund.eastmoney.com/*",
    "http://fundf10.eastmoney.com/*",
    "https://fundsuggest.eastmoney.com/*",
    "https://fundmobapi.eastmoney.com/*",
    "https://push2.eastmoney.com/*",
    "https://push2ex.eastmoney.com/*",
    "https://qt.gtimg.cn/*",
    "https://query1.finance.yahoo.com/*"
  ],
  "optional_host_permissions": [
    "http://*/*",
    "https://*/*"
  ],
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  }
}
```

### CSP 说明
- `wasm-unsafe-eval` - 允许 Tesseract.js WASM 运行
- 必须配置才能使用 OCR 功能

---

## 🎨 界面预览

### 主界面
- 深色主题，护眼舒适
- 表格展示所有持仓
- 实时更新估值和收益
- 支持分组筛选和排序

### 详情页
- 基金基本信息
- 今日估值走势图
- 前 10 重仓股票
- 历史业绩分析

### FAB 悬浮菜单
- 📷 图片识别批量添加
- 📁 批量修改分组
- 🧹 批量清空持仓
- 🗑️ 批量删除
- 🔄 批量重算份额
- 📅 手动日结算
- ↩️ 撤销结算
- 📤 导出当前数据
- 🗂️ 导出备份数据

---

## 🐛 常见问题

### Q: 为什么有些基金显示「接口获取不到数据」？
A: 可能是该基金类型不支持或接口暂时不可用，可以手动输入数据。

### Q: OCR 识别不准确怎么办？
A: 识别结果支持手动编辑，修改后再批量保存即可。

### Q: 走势图数据会保留多久？
A: 今日数据会持久化保存，刷新页面不丢失，第二天自动清空重新记录。

### Q: 如何备份数据？
A: 当天首次自动/手动结算前会自动生成一份首份快照，可通过 FAB 中的「导出当前数据」或「导出备份数据」分别导出实时数据和备份快照。

### Q: 支持哪些资产类型？
A: 目前支持基金（6位数字代码）和期货（字母+数字代码）。

---

## 📝 更新日志

### v3.7.0 (2026-09-08) - push2 全局串行闸门 + 股票行情双源 + AppState 状态收敛

#### push2 全局串行闸门
- 🔧 **东财 push2 频控治理**：实测 push2 对请求频率极其敏感（间隔 1 秒连发即被断连，`ERR_EMPTY_RESPONSE`），启动时涨跌家数/涨跌停/指数行情/穿透股票行情曾并发打出 3~4 个请求必然触发断连。新增统一闸门：全局同时只有一个 push2 请求在飞，请求间强制最小间隔 1800ms；高优先级插队（穿透行情 priority=1 优先于装饰性指标）；失败退避重试 + `82.push2` 备用域名；连续失败会话级降级提示（不刷屏）。
- 🐛 **穿透股票行情接入闸门（本次复查修复）**：闸门初版实现遗漏了最关键的调用方——`_fetchStockQuotesFromEastmoney` 仍直连请求、绕过串行闸门，与指数/涨跌家数并发仍可能复现断连。现已接入（priority=1），非 push2 的自定义源保持原双通道。
- 🐛 **重试间隔对齐冷却窗口（本次复查修复）**：闸门内重试间隔 800ms 小于 1800ms 最小间隔，快速失败后的重试仍会撞进东财冷却窗口，已对齐为 1800ms。

#### 股票行情双源（stock 数据源分类）
- ✨ 新增 `stock` 数据源分类（数据源管理中可停用/改地址/测试）：东财 push2（主）+ 腾讯 `qt.gtimg.cn`（备，GBK 解码），单源失败自动冷却 60s 切换备源，全部冷却时重置重试。腾讯字段映射：名称=`~[1]`、现价=`~[3]`、昨收=`~[4]`、涨跌幅=`~[32]`，代码去 `sh/sz/bj` 前缀与持仓代码对齐。
- 🧹 删除死代码 `fetchStockPrices`（旧腾讯单源实现，已被 settings 驱动版完全替代，无调用点）。

#### 架构与重构
- 🏗️ **AppState 全局状态收敛**：popup.js 中 30+ 个散落顶层 `let` 收敛为单一 `AppState` 命名空间，经 `defineProperty(globalThis)` 访问器桥接——各模块既有裸名读写（`allFundsData = ...`、`selectedCodes.add(...)`）透明转发，25+ 个模块零改动。
- 🏗️ **`_loadDataImpl` 拆分为 8 个阶段函数**（init → fetchLive → penetration → dividends/settlement → processFunds → intraday → persist → render），通过 ctx 对象共享状态；保持原单 try/catch 整体错误兜底语义，逐字段核对与原实现等价。
- 🔧 background.js：`FETCH_JSON`/`FETCH_TEXT` 合并为 `proxyFetchAndRespond` 共用实现（唯一差异是 json/text 解析）；push2 断连静默处理避免与闸门降级提示双份刷屏。
- 🗑️ 清理调试残留：`[diag][item-build]` / `[diag][render-nav]` 探针移除，穿透诊断日志统一由 `PEN_DEBUG` 开关控制。

### v3.6.0 (2026-09-07) - 穿透稳定性治理 + 请求限流优化 + 节假日历年份修复

#### 穿透估值：行情字段修正与请求合并
- 🐛 **push2 行情字段映射修复（穿透此前必然失败的真因）**：`fetchStockQuotesBatch` 原请求 `fields=f43,f57,f58,f170` 并把 `f57` 当作股票代码。实测 push2 该字段集下 `f57` 是**数值字段而非代码字符串**，响应中根本不含代码 → `resultMap` 的键全为乱码 → `stockQuotes.get(s.code)` 永远 miss → `details` 恒为空 → 静默返回 null（不报错、不告警，极具迷惑性）。改为标准字段 `f12,f14,f2,f3`（f12=代码、f2=现价、f3=涨跌幅%，`fltt=2` 返回真实小数），并保留 `f12||f57` / `f2||f43` / `f3||f170` 双套兜底。
- ⚡ **整次刷新只发 1 个行情请求（修复「这轮有估值、下轮又没有」的随机抖动）**：原先每只基金各自调用 `fetchPenetrationValuation` → 各发一个 push2 请求（14 只基金 ≈ 14 个并发），叠加晴雨表指数请求后东财直接 `ERR_EMPTY_RESPONSE` 丢包。改为四阶段：①判定需穿透的基金 → ②并行拉各基金持仓（命中缓存不触网）→ ③**汇总全部重仓股代码，整次刷新只发 1 个批量请求** → ④各基金复用共享行情计算。push2 请求数 **14 → 1**。
- 🎯 **穿透定位定案：只兜底「无真实估值」的基金**：fundgz 给出真实盘中估值（`gsz≠dwjz`，有真实波动）时**直接用它、不穿透**；只有 `gsz==dwjz`（无真实波动）的伪估值才走穿透。同步撤回此前「交易时段内按日期强插穿透」的临时方案——那是拿穿透去覆盖 fundgz 更权威的盘中估算，属口径混乱。
- 🐛 **已结算保护（复查新增）**：晚间官方净值公布后，fundgz 的 `dwjz` 切到今日净值并回 `gsz==dwjz`（无波动伪估值）→ 门控判"无估值"→ 穿透触发，但此时 `prevPrice` **已包含今日涨幅**，再叠加今日重仓股涨幅 = 双重计入，夜间会显示虚高/虚低的错误估值。修复：`prevPriceDate === 今天`（今日净值已公布）时跳过穿透。盘中 `prevPriceDate` 恒为上一交易日，不影响日间穿透。

#### 性能：持仓缓存补齐负缓存（持续限流的根因之一）
- 🐛 **`fetchFundHoldingsWithCache` 只缓存非空结果**，导致纯债/无股票基金（`stockCodes=[]`）的「空结论」永不进缓存 → 每轮刷新都重跑「mobapi 失败 + pingzhongdata」两次请求。用户组合里 8 只债基 ≈ **每次刷新 16 个纯冗余请求**，与 push2 共享东财域名风控额度，是限流的持续来源。
- ✅ 改为**分级 TTL 负缓存**：有持仓 12h / 确认无股票 6h / 源不可用（网络·限流）10min。同时把 `tryFetchPingzhongdata` 的返回语义拆开——「成功确认无持仓」返回空持仓对象、「抓取失败/被限流」返回 `null`，让调用方能区分二者并采用不同 TTL（否则限流会被误当成"这基金没股票"而长期缓存）。异常路径同样进短 TTL 负缓存。

#### 节假日历：年份覆盖判定修复
- 🐛 **当年法定节假日可能永久缺失**：`ensureTradingCalendar` 拉取「当年+次年」时用 `fetchedYear` 记录**最后一次成功**的年份。若当年拉取失败、次年成功，`fetchedYear` 会被写成次年并持久化 → 此后 `cached.year >= currentYear` 恒成立 → **当年数据再也不会补拉**，只能退化到周末规则，国庆/春节前的 T+1/T+2 确认日会算错。
- 🐛 **判断侧同源问题**：`isTradingDayDate` 用 `_tradingCalendar.year >= d.getFullYear()`，在只有次年数据时会拿次年的 `offDays/workDays` 去判断当年日期 → 当年法定假日不在集合中，被**误判为交易日**。
- ✅ 两处改为按**年份集合** `years.includes(targetYear)` 判定覆盖；缓存结构新增 `years` 数组（保留 `year` 字段以兼容旧数据）。未覆盖时退化为周末规则——宁可少认节假日，也不能把假期当交易日。

#### 可维护性
- 🧹 **收敛穿透链路的刷屏日志**：`[holdings][mobapi]`（`Datas=null` 是本环境常态，每只基金每次刷新都打）、`[stock-quotes]` 三条成功日志、`[penetration]*` 系列，统一由全局开关 `PEN_DEBUG` 控制（默认关闭，console 保持干净；排查时在 console 执行 `PEN_DEBUG = true` 即可恢复全部诊断输出）。失败与异常告警（`console.warn`）一律保留。
- 🗑️ 移除已完成使命的 `[diag][item-build]` 调试探针。

### v3.5.0 (2026-08-15 ~ 2026-08-27) - 穿透估值引擎 + 收益日历重构 + 成本口径严格化

> 本版迭代跨度较长，期间 manifest 版本号未随每轮迭代递增，故合并为一个版本条目、按迭代日期倒序分节。

#### 08-27 · 持仓穿透估值引擎：门控修复 + 双源兜底（修复「无估值」）

- 🐛 **穿透估值触发门控修复**：原 `popup_perf_data.js` 用 `hasUsableLiveEstimate(live)`（price>0 && rate≠null）判断是否「已有估值」而跳过穿透。但纯债/定开债/FOF 的 fundgz 返回 `gsz==dwjz`（price=昨收净值、rate=0 但非 null），被误判为有效估值，导致穿透引擎**从未触发**、这些基金在 15:00 前完全无盘中参考。
- ✅ 新门控 `hasRealIntradayEstimate = hasUsableLiveEstimate && (|rate|>1e-4 || |price-prevPrice|>1e-4)`：仅当官方确实给出有意义的盘中涨跌时才跳过；`gsz==dwjz` 伪估值一律触发穿透。真有估值的基金（含真横盘）不受影响。
- 🐛 **真实根因（多轮排查确认）**：`fundmobapi.eastmoney.com`（移动端持仓接口）在 Chrome 扩展 background 代理请求下被东财**差异化软失败**——返回 `Success=true` 但 `Datas=null`（沙箱/直连 curl 完全正常，含带扩展 `Origin: chrome-extension://` 头也正常）。同一环境下 `fund.eastmoney.com`（pingzhongdata，分红检测已验证可用）与 `hq.sinajs.cn` 均正常，证明是 fundmobapi 子域针对扩展环境的风控，非 Referer/UA/Origin 单一因素。
- ✅ **双源兜底方案**：`fetchFundHoldingsWithCache` 改为「源1 fundmobapi（精确占比，首选）→ 源2 pingzhongdata（fund.eastmoney.com 子域，环境已验证可用，提取前十大 `stockCodes` + 股票总仓位 `Data_fundSharesPositions`，个股权重缺失时用总仓位等权分摊）」。任一源成功即用。
- ✅ 沙箱端到端实测（001258）：pingzhongdata 等权近似 **+0.33% / estPrice 1.5762**，与 fundmobapi 精确口径 **+0.30% / 1.5757** 仅差 0.03%，精度足够；新浪 `hq.sinajs.cn` 经 FETCH_TEXT 代理拉重仓股实时行情，加权算法正确。
- 📌 行为：二级债基/偏债混合（有股票持仓）15:00 前显示穿透估值 + `[穿透]` 徽章；纯债/定开债（无股票持仓）穿透返回 null，如实显示 `—`（符合既定口径）；纯债 FOF 底层全为债/ETF，盘中加权≈0 时显示穿透 0%；股票代码（如 000070）fundmobapi 无持仓、pingzhongdata 无 stockCodes，如实显示 `—`。

#### 08-26 · 收益日历：合计实时重算 + 去重声明

**日历合计与明细对账修复**
- 🐛 **日历「合计」实时按 byCode 求和、永不读脏字段**：`dailyProfitHistory.byCode` 是「那一天的真实经济效果」（acPrice 模型下已含分红经济效应），日历顶层合计改为 `ΣbyCode` 实时重算，与明细行 profit 之和严格自洽，杜绝历史上 `entry.totalProfit` 与 `byCode` 失同步造成的"明细加总 ≠ 合计"。
- 🐛 **detail row 删除「合计 = profit + dividend」列**：原 combined 列在 acPrice 模型下与 profit 重复计算（acPrice 已含分红经济效应，+ dividend 即双计）。删除后单只基金行只剩真实盈亏，分红金额仅以 chip 旁注（"当笔为该日现金流入"），不再混入数字求和。
- 🐛 **`normalizeDailyProfitHistory` 收敛脏数据**：原本优先用 `entry.totalProfit/totalDividend` 覆盖重算的 Σ值，会把历史上的脏字段固化下来。现改为强制以 byCode 之和为准——所有写入路径（`recordDailyProfitHistory` / `backfillMissingDailyProfitHistory` / `mergeDailyProfitHistories`）的末步都经过这道收敛，保证下次任意结算/日历打开后总量与明细恒等。

**代码复用 / UI 减少重复**
- 🧹 新增共用 helper `sumEntryByCodeOnly(entry)` 与 `sumEntryCashDividends(entry)`，日历顶部「选中日合计」、月合计、年合计、历史合计、detail 颜色判断全部走同一套求和逻辑，删除 5 处重复手算（`Object.values(...).reduce(...)`），主页面"昨日收益列求和"沿用 `dailyProfitHistory.byCode` 同一份数据源，与日历完全一致。

#### 08-26 · 收益日历：分红标注修复

**收益日历分红落库修复**
- 🐛 **日历"分"标记与分红明细不再为空**：`backfillMissingDailyProfitHistory` 此前只统计 `status === 'confirmed'` 的分红订单，而自动检测到的分红在现金未到账前是 `pending` 单，导致已被检测出的分红（如 004433 / 021584）始终不出现在收益日历。现改为：只要交易流水里存在该自动分红单（无论到账与否），就在日历的 `dividendsByCode` 显式标注——除息日与每份金额均为已确定事实，不应因未到账而消失。仅「手动录入且仍 pending」的分红单不计入，避免误标。
- 🐛 **手动「触发日结算」同样回填分红**：`manualSettlement` 原先只跑 `recordDailyProfitHistory`（只写收益、不写分红），现补跑一次历史回溯，使手动结算路径的日历也能显示分红。

**僵尸参数清理**
- 🗑️ 移除 `reconcileDailyProfitHistory` 的 `dominantMarketPrevPriceDate` 僵尸门控（与 README 既定方向一致）：该参数非空才允许跑历史回溯，否则整体跳过，是上次 `dominantMarketPrevPriceDate` 清理遗漏的残留。移除后无论当日是否有主流市场净值日期，回溯都会执行，分红必落日历。
- 🗑️ 删除已无调用方的 `getDominantMarketPrevPriceDate` 死函数及其在 `popup_perf_data.js` 的未使用局部变量。

#### 08-24 · 收益日历 UI 解耦 + 累计成本计算重构 + 表格动态冻结列

**架构与模块化**
- 📅 **收益日历 UI 独立模块化**：从 `popup_settlement_rollback.js` 拆分出纯展示层 `popup_profit_calendar_ui.js`（~586 行），使结算回滚算法（纯数据流与逆推推导）与日历弹窗/视图切换（DOM 渲染）完全解耦，大幅降低单文件体量与维护难度。
- 📦 **依赖与引入规范**：在 `popup.html` 明确按层级组织脚本依赖，保持离线优先与轻量化原生加载。

**金融收益与成本算法重构**
- 💰 **解决累计收益率分母失真**：新增 `calculateTotalInvestedCostFromOrders()` 与 `calculatePositionCostFromOrders()`：
  - 精确累加 `initial`、`add`、`dividend_reinvest` 等已确认买入订单流水，作为累计收益率计算的真实投入本金分母，彻底解决多次减仓/清仓后使用 `amount - holdProfit` 导致分母接近 0 或失真的问题。
  - 支持无完整流水时的 `amount - holdProfit` 兜底平滑回退。
- 📊 **持仓累计收益与昨日收益语义对齐**：
  - 严格展示昨日（自然日）真实结算收益，非最新结算日收益标注具体结算日期；
  - 表格独立支持 `positionProfit`（持仓累计收益）列排序与汇总。

**界面交互与布局优化**
- 📐 **`<colgroup>` 显式定宽与 `updateStickyLeft` 动态冻结**：
  - 在 `popup.html` 中引入 `<colgroup>` 规范 18 列基准宽度，解决 `table-layout: fixed` 布局抖动；
  - `popup.js` 新增 `updateStickyLeft()`，动态累加所有可见冻结列宽度，无论列开关如何配置，冻结列均可平滑前移对齐，不再出现错位或空白。
- ⚙️ **列配置面板增强**：支持 `positionProfit` 列独立显隐持久化与一键重置默认布局。

**安全与网络底层升级**
- 🔒 **全链路 XSS 防御**：对基金名称、重仓股票名/代码、估值时间、接口错误提示等全部统一加上 `escapeHtml()` 转义，阻断潜在 DOM 注入风险。
- 🌐 **MV3 `declarativeNetRequest` 动态规则**：`background.js` 新增针对天天基金 F10（`FundArchivesDatas.aspx`）的 Referer 动态规则，稳定支持重仓股数据获取；重构 `popup_api_settings.js` 接口配置与点路径解析 (`getValueByPath`)。
- 🛡️ **离线净值走势兜底**：`loadMyReturnPeriod` 增加 `HistoryDB` 本地日涨幅回退提取，确保未先查看业绩走势 tab 时收益分析依然完整可用。

#### 08-15 · 昨日收益严格化 + 区间涨幅官方接口 + 性能与 UI 修复

**昨日收益口径严格化**
- 🐛 **昨日收益严格按自然日**：仅当 `prevPriceDate === 昨日` 才计入昨日收益，昨天无净值更新（节假日/QDII/定开债滞后）的基金显示为 —，并在下方橙色标注最近结算日期，不再用更早的结算收益冒充昨日
- 🐛 **总额不再虚增**：`sumYesterdayProfit` 严格过滤，昨日无更新的基金不计入总额

**区间涨跌幅对齐平台**
- ✨ **接入天天基金 FundMNPeriodIncrease 官方区间涨幅接口**（`fetchFundPeriodReturns`），与微众银行等平台数据源一致
- 🐛 **走势图尖刺修复**：归一化序列优先用累计净值（acPrice），缺失处按相邻比例桥接，消除 acPrice/price 混用导致的尖刺
- 🐛 **区间涨幅锚点修正**：目标日有净值用目标日，否则取前一交易日（平台口径）；缓存版本迭代 V2→V5

**历史同步优化**
- ⚡ **每天仅首次刷新执行历史同步**：内存 + 存储双标记门控，避免每次刷新都重跑全量同步；新基金当天强制补齐
- 🐛 **全量历史同步去除起始日期限制**：自动递归补齐，不再硬编码下界

**性能与 UI**
- ⚡ **业绩刷新改分批并发**：`fetchAllFundPerfData` 由串行 `sleep(500)` 改为每批 5 个并发、批间 300ms 限流，20 基金从 ~10s 降至 ~2-3s
- 🐛 **净值列内联 padding 修复**：删除 `tdNav.style.cssText` 内联 padding（曾覆盖 CSS 导致调 padding 无效），改由 CSS 统一控制
- 🎨 **表格列宽收紧**：区间列 72→64，冻结列小幅收窄，`sticky left` 同步重算
- 🎨 **列间距收紧**：`th,td` padding 全屏 `5px 4px` / 小窗 `5px 3px`，并修正小窗覆盖规则

**代码清理**
- 🗑️ 删除过时诊断脚本 `diagnostic_161725.js`
- 🐛 历史同步 `checkAndFillHistoryGaps` 改 `await` + try/catch，失败当天可重试

### v3.4.0 (2026-08-07) - 持仓累计收益 + 代码审查与统一

#### 新功能：持仓累计收益
- 💰 **新增 `positionCost` 字段**：从已确认订单流水反推当前持仓的实占成本
  - 建仓/加仓：`cost += 买入金额`
  - 减仓：`cost -= (卖出份额/当前份额) × cost`（按比例扣减）
  - 现金分红：`cost -= 分红金额`（收回部分本金）
  - 红利再投：`cost += 分红金额`（又买回去了）
  - 清仓：`cost = 0`
- 📊 **表格新增"持仓累计收益"列**：`positionProfit = amount - positionCost`
  - 与"累计收益"（含已卖出盈亏）并列，互补对比
  - 对于从未减仓的基金，两者理论一致
- 🔄 **每次刷新自动重算**：`positionCost` 是派生值，不依赖手动维护
- ⚙️ **列显示设置**：`TABLE_COLUMNS` 已加入 `positionProfit`，面板可开关
- 🧪 **11 个边界测试** (`test_position_cost.js`)：覆盖建仓/加仓/减仓/清仓/清仓后再买入/频繁加减仓/超卖兜底/现金分红/红利再投/分红混合等场景，全部通过

#### 代码审查修复
- 🐛 **删除死代码**：移除 `popup_api_settings.js` 旧版 `openLiveApiSettings`（~102 行，已被新版覆盖）
- 🐛 **QDII 昨日收益修复**：去掉 `getDisplayedYesterdayProfitFromHistory` 中 `dominantMarketPrevPriceDate` 强制置零，滞后净值基金正常显示
- 🔒 **XSS 防御统一**：`fund.name`、股票名、错误信息、估值时间 4 处未转义 `innerHTML` 均补 `escapeHtml()`
- ⚡ **backfill 增量化**：`reconcileDailyProfitHistory` 会话级缓存，同日同基金集合跳过重复 IndexedDB 全扫
- 🧹 **priceUpdates 对齐**：`recordDailyProfitHistory` 移除 `dominantMarketPrevPriceDate` 强制过滤，与结算层一致
- 🧹 **`var` → `let`**：`popup_center_menu.js:1`、`popup_trade.js:12` 两处统一声明风格

#### UI 调整
- 🎨 **汇总栏平铺 5 列**：`grid-template-columns: repeat(5, ...)`，顺序改为总资产→昨日收益→当日估值→持仓累计收益→累计收益

### v3.3.0 (2026-07-22) - 数据源管理 + 估值补缺

- 新增统一数据源管理：实时估值与历史净值分类维护，支持启停、排序、测试、新增、编辑和删除
- 实时估值按优先级逐级补缺，默认使用天天基金批量接口，再由新浪财经补充缺失基金
- 历史净值接口取消业务层硬编码，支持可编辑 URL、故障切换及通用 JSON/JSONP 字段映射
- 自动迁移并去重旧接口配置，WealthAgent 和旧 fundgz 默认停用
- 修复接口空估值被解析为 0、批量 `{code}/{codes}` 兼容及新浪当日估值校验
- 修复结算兜底分红与历史接口分红重复生成订单的问题

### v3.2.0 (2026-07-03) - 架构优化 + 结算修复 + UI 增强

#### 架构优化
- 🎨 **CSS 外联**：4530 行内联 `<style>` 提取为 `popup_base.css` / `popup_components.css` / `popup_overlay.css` 三个文件，popup.html 从 4784 行缩减至 275 行
- 📦 **JS 模块化拆分**：14 个模块进一步拆分为 25 个职责单一的模块
  - `popup_perf.js`（4710 行）→ 4 个文件：缓存 / 初始化 / 数据加载 / 渲染
  - `popup_settlement.js`（2121 行）→ 2 个文件：撤销结算 / 日结算运行时
  - `popup_trade.js`（1473 行）→ 3 个文件：核心 / 分红 / 结算
  - `popup_position_ui.js`（1833 行）→ 3 个文件：批量操作 / 交易表单 / 居中菜单
  - 最大文件从 4710 行降至 1463 行
- ⚡ **OCR 懒加载**：Tesseract 三个脚本从 `<script>` 硬编码改为点击"传图识别"时动态加载，不使用 OCR 时不加载 WASM 核心
- 🔧 **fetchLiveInfo 拆分**：233 行单体函数拆为 5 个子函数（路由 / 场外基金 / 估值解析 / 净值解析 / 期货）
- 🧹 **清理调试日志**：移除 6 处残留 `console.log`

#### 结算系统修复
- 🐛 **QDII/封闭期基金不结算**：去掉 `shouldAutoSettleFund` / `hasFreshYesterdayProfit` / `recordDailyProfitHistory` 三处对 `dominantMarketPrevPriceDate` 的强制过滤，改为按每个基金自己的 `prevPriceDate` 独立结算，净值日期滞后的基金也能正确更新收益
- 🐛 **普通加仓允许填过去日期**：添加校验，到账日期不能早于今天，引导用户使用「补录历史交易」功能
- 🐛 **`backfillHistoricalTrade` 中 `live` 变量未定义**：补上 `const live = await fetchLiveInfo(code)`

#### UI 增强
- 🎨 **汇总栏百分比**：昨日收益/当日估值/累计收益均显示百分比，总资产显示本金
- 🎨 **全屏模式隐藏全屏按钮**
- 🎨 **刷新间隔下拉菜单**：颜色改为深蓝主题一致，尺寸缩小，触发按钮透明无边框
- 🎨 **涨跌停数据居中显示**

### v3.1.0 (2026-05-27) - 性能优化 + OCR 建仓补全 + Bug 修复
- ⚡ **fetchLiveInfo 并发**：天天估值（url1）与东财历史净值（url2）改为 `Promise.allSettled` 同步请求，刷新耗时从 ~16s 降至 ~8s；历史净值仅在 url1 失败时写盘，正常刷新不触发大批量 DB 写入
- ⚡ **多处并发优化**：分红补录、订单清理、名字恢复、删除基金等循环均改为 `Promise.all`，`buildTradeOrdersMap` 提前启动与行情请求并发
- 📋 **OCR 建仓补全（方案A）**：结果表格新增确认净值日/费率%/分红方式三列，顶部「批量填写」栏一键应用到选中行；保存时写 `type:initial` 订单到 IndexedDB、补录历史分红、完整写入 `dividendMode`/`savedAcNetValue` 等字段，与手动新增资产完全一致
- 🧹 **代码重构**：提取 `getSelectedFunds()`/`deriveAndValidateTradeInput()`/`_makeOCRItem()` 等辅助函数，统一 `isDividendType()` 调用，删除重复 IIFE 与死 CSS
- 🐛 **Bug 修复**：修复 `batchPut` 守门丢失（并发重构引入）；修复 OCR `isNewFund` 用持仓金额判断导致零持仓老基金误写重复 initial 订单

### v3.0.0 (2026-05-22) - 架构重构与 IndexedDB 持久化
- 🏗️ **模块化拆分**：8400 行单体 `popup.js` 按职责拆分为 13 个模块（api/history/perf/perf_chart/perf_panel/perf_state/perf_table/position_ui/trade/fund_detail/import_export/ocr 等）
- 💾 **IndexedDB 持久化层**：新增 `HistoryDB`（`tradeOrders` / 历史净值 / 状态快照 store），原 `chrome.storage.local` 仅保留配置与持仓快照
- 📋 **交易订单 CSV 导入导出**：完整覆盖 30 列订单字段（含 `createTime` 时间戳、`autoDetected` 标记），支持 Excel mangling 修复工具
- 🎛️ **FAB 菜单分组**：扁平 17 项按钮重构为 6 个分组（批量操作 / 日结算 / 数据维护 / 导入导出 / 全选 / 添加资产），子菜单一致从右侧侧出
- 🪟 **批量操作弹窗复用 form 模式**：批量修改分组 / 批量清空持仓 / 批量删除三个确认弹窗统一使用 `data-mode="form"` 紧凑布局，文案明确列出影响范围
- 📐 **净值列居中 / 估值收益单行**：表格视觉精简，去除冗余百分比副行
- 📊 **业绩走势重做**：基于 ECharts 重写走势图、面板与缓存层
- 📅 **收益日历视觉统一**：复用项目暗色 modal 体系，紧凑 callout / option / fund-list 子类
- 🧰 **新增维护工具**：重建收益日历缓存、订单一致性检查
- 🐍 **trade CSV 修复脚本** (`/tmp/fix_trade_csv.py`)：从清洁导出还原 Excel 篡改后的日期/布尔值/科学计数法精度

### v2.0.0 (2026-04-24) - 指数行情系统与版本号升级
- 📈 **指数行情实时监控** - 支持 20+ 指数（A股/美股/港股/日本/韩国等）
  - 上证综指、深证成指、沪深300、上证50、创业板指、中小100
  - 纳斯达克、纳指100、标普500、道琼斯、恒生指数、恒生科技
  - 日经225、东证指数、韩国综合等国际指数
- 🎨 **Header 优化** - 指数行情移至 Header 中间区域，标题与操作按钮并排
- 🔄 **自动降级请求** - 三级数据源降级（东财主接口 → 腾讯备用 → 新浪备用）
- 📊 **指数详情** - 支持实时价格、涨跌幅、涨跌额、市值展示
- 🔧 **代码优化** - 移除重复常量，提升可维护性

### v1.7.7 (2026-04-15) - 分红结算与收益日历同步修复
- 🧮 **现金分红结算修正**：昨日收益在现金分红场景自动补回分红金额，避免分红日误显示为负值
- 🧾 **分红订单一致性修复**：手动结算改为实时拉取行情并先执行分红检测，修复”有分红提示但无分红订单”
- 📅 **收益日历同步修复**：日历记录改为复用结算后 `yesterdayProfit`，并统一为”先结算后写日历”，与主表保持一致

### v1.7.6 (2026-04-14) - UI 体验优化
- 🎨 **收益日历视觉统一**：回归项目暗色 modal 体系，去掉独立视觉层级
- 🧩 **面板样式合并**：统一 toolbar/summary/detail 面板样式，共享边框渐变与内阴影
- 💊 **Pill 样式复用**：合并 meta-item/detail-badge/summary-days 为统一 pill 样式
- 📐 **布局优化**：去掉收益日历 modal 上下留白，改用 CSS mode 控制布局
- 🧹 **代码清理**：删除 JS 内联根样式覆写，移至 CSS scoped override
- 📝 **基金详情精简**：删除正文重复标题，只保留 overlay 顶部标题
- ✨ **文案优化**：精简收益日历文案与图标，减少视觉噪音
- ⚙️ **列显示控制**：新增顶部齿轮列设置面板，支持列开关与持久化，必显列锁定；全屏列按全屏规则独立生效
- 🧱 **区间涨跌幅硬保留**：近1周/1月/3月/6月/1年数据按日缓存到本地，重开 popup 先显示旧值，次日再静默刷新
- 📅 **成立以来涨跌幅**：全屏表格新增"成立以来"列，拉取基金全量历史净值计算，与其他区间列同步缓存

### v1.7.4 (2026-03-25) - 结算体验与详情页稳定性优化
- 🔄 **昨日收益展示更稳**：按主流交易日判断昨日收益是否新鲜，避免个别停更或慢更新基金把有效收益误显示为 0
- 📈 **分时走势记录修正**：仅在交易时段记录今日估值点，修复盘前刷新导致走势图出现 09:30 之前异常点的问题
- 📦 **首份备份语义固定**：自动/手动结算统一保留“当天第一次结算前快照”，同日重复结算不会覆盖，撤销后仍可继续导出和对比
- 📤 **备份导出入口增强**：FAB 菜单支持分别导出当前实时数据与当天首份备份数据，文件名携带备份日期更易辨认
- 🧭 **详情页异步竞态修复**：切换基金或关闭详情弹窗时，旧请求不会再回写新界面，历史业绩切周期更稳定
- 🎨 **FAB 菜单细节美化**：统一按钮尺寸、间距和面板层次感，保留原有交互习惯

### v1.7.2 (2026-03-20) - 稳定性大幅提升
- 🔧 **Chrome Storage API错误处理**：添加完善的错误捕获，防止数据操作失败
- 🔧 **数值格式化安全性**：为所有数值处理函数添加类型检查，防止NaN错误
- 🔧 **日期计算健壮性**：分红到账日期计算增加输入验证和异常处理
- 🔧 **API数据解析改进**：新浪API数据解析增加严格验证，避免解析无效数据
- 🔧 **价格计算优化**：修复除零错误和undefined值处理，确保计算安全
- 🔧 **分红数据验证**：为分红列表操作添加结构验证，防止数据异常
- 🔧 **统一错误处理**：为核心数据加载函数添加完整的错误捕获和用户反馈
- 🔧 **错误处理框架**：新增通用错误包装器，标准化异常处理流程
- ✅ **整体稳定性**：修复9个关键bug，大幅提升应用健壮性和错误恢复能力

### v1.7.1 (2026-03-18)
- 🐛 简化昨日收益计算逻辑，移除分红特殊处理
- 💡 统一使用净值差计算：`shares × (price - prevTradingDayPrice)`
- 📝 NAV已自动反映分红影响，无需额外调整

### v1.7 (2026-03-17) - 用户体验优化
- ✨ **合并交易确认通知**：多笔待确认交易合并显示，避免通知轰炸
- 🔇 **分红检测静默处理**：改为只在通知中心记录，不弹长时间toast
- ⚡ **简化编辑流程**：删除冗余的净值获取提示，只在保存时反馈
- 🔧 **统一批量操作确认**：提取通用确认函数，改善用户体验
- 🐛 **修复分红双重计算**：智能检查结算日期，避免分红被重复计入或漏掉

### v1.6 (2026-03-17) - 代码优化
- 🛠️ `roundShares(num)` - 份额计算（保留2位小数，和 App 口径一致）
- 🎨 `formatProfit(num, suffix)` - 收益格式化（自动添加正负号）
- ⏰ `formatTime(date)` - 时间格式化 HH:MM
- 📁 `formatDateTimeForFile(date)` - 文件名时间格式
- 🔧 代码简化：统一使用工具函数，优化38处重复代码
- 🐛 分红逻辑修复：调整执行顺序，分红检测在自动结算之前

### v1.4 (2026-03-12)
- ✨ 新增走势数据持久化，刷新页面不丢失
- 🐛 修复前10重仓股票错误提示
- ⚡ 优化代码结构，减少 150+ 行冗余代码
- 🔧 统一 Storage 访问层，全面使用 async/await
- 🎨 优化错误提示文案
- 🗑️ 删除冗余的 patch.js 开发工具

### v1.3
- ✨ 新增 OCR 图片识别批量添加功能
- 📊 新增今日估值走势图
- 🔄 新增加减仓 T+1/T+2 确认机制
- 💾 新增数据导入导出功能

### v1.2
- ✨ 新增基金详情页
- 📈 新增历史业绩分析
- 🏢 新增前10重仓股票展示
- 🎯 优化日结算逻辑

### v1.1
- ✨ 新增批量操作功能
- 📁 新增分组管理
- 🔄 新增自动日结算
- 💰 优化收益计算逻辑

### v1.0
- 🎉 首次发布
- 📊 基础资产追踪功能
- 💰 收益计算功能
- 🎨 深色主题 UI

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

### 开发环境与调试方法
1. **Clone 项目**：下载或 Clone 源代码到本地
2. **加载测试**：打开 Chrome `chrome://extensions/` → 开启「开发者模式」 → 点击「加载已解压的扩展程序」选择本项目目录
3. **测试修改**：修改代码后，在 `chrome://extensions/` 页面点击卡片刷图标，即可重新打开 Popup 测试（无需构建步骤，纯原生开发）
4. **调试技巧**：
   - **Popup 控制台**：右键 popup 面板 → 检查 → Console 标签
   - **Background Service Worker**：`chrome://extensions/` → 点击扩展卡片下方的 "service worker" 链接
   - **存储检查**：Chrome DevTools → Application → Storage (Local Storage & IndexedDB)

### 代码规范
- 全面使用 `async/await` 处理异步逻辑
- 使用 `storageHelper.get()` / `storageHelper.set()` 访问存储
- 数值计算统一使用 `round2()` 格式化处理
- 关键数据结构与逻辑保持模块化与注释清晰

---

## 📄 许可证

MIT License

---

## 👨‍💻 作者

**Zoyo**

如有问题或建议，欢迎联系！

---

<div align="center">

**⭐ 如果这个项目对你有帮助，请给个 Star！⭐**

Made with ❤️ by Zoyo

</div>
