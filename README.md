# FundHelper Offline - 离线资产收益追踪器

<div align="center">

**Chrome Extension MV3 | 基金/期货离线追踪 | OCR 批量导入 | 实时估值走势**

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue?logo=google-chrome)](https://www.google.com/chrome/)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)](https://developer.chrome.com/docs/extensions/mv3/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

</div>

---

## 📖 项目简介

FundHelper Offline 是一款功能强大的 Chrome 扩展，专为投资者设计，提供离线资产收益追踪、实时估值监控、OCR 批量导入等功能。支持基金、期货等多种资产类型，数据完全本地存储，保护您的隐私。

### ✨ 核心特性

- 🎯 **离线追踪** - 所有数据存储在本地，无需联网即可查看持仓
- 📊 **实时估值** - 自动获取最新净值和估值，实时计算收益
- 📈 **走势图表** - 今日估值走势图，支持刷新后数据保留
- 🖼️ **OCR 识别** - 支持截图批量导入资产，自动识别代码和金额；导入时可补填确认净值日、费率、分红方式，与手动新增完全一致
- 💰 **收益计算** - 自动/手动日结算，按接口交易日准确计算昨日收益并保留当日首份备份
- ⚡ **快速刷新** - 天天估值与东财历史净值并发请求，刷新耗时从 ~16s 降至 ~8s
- 🔄 **加减仓管理** - T+1/T+2 确认机制，自动计算份额
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
- **持有收益**：累计总收益
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
- 从 FAB 菜单导出当天首份结算前快照
- 适合在撤销前后对比差异
- 当天尚未生成备份时会给出明确提示

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
├── manifest.json                    # 扩展配置文件 (v3.2.0)
├── popup.html                       # 主界面 HTML (275 行，纯结构)
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
├── popup_settlement_rollback.js     # 撤销结算 / 备份管理 / 份额推导
├── popup_settlement_run.js          # 手动/自动日结算 / 状态持久化
│
├── tesseract.min.js                 # OCR 核心库 (按需懒加载)
├── worker.min.js                    # OCR Worker
├── tesseract-core.wasm.js           # WASM 核心
├── chi_sim.traineddata              # 中文简体训练数据
└── README.md                        # 项目文档
```

> v3.2.0 架构优化：CSS 从 HTML 内联提取为 3 个独立文件；JS 从 14 个模块进一步拆分为 25 个职责单一的模块，最大文件从 4710 行降至 1463 行；OCR 引擎改为按需懒加载；`fetchLiveInfo` 从 233 行单体函数拆分为 5 个子函数。

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
    "holdProfit": 1234.56,           // 累计收益 (历史总盈亏)
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
  "version": "3.3.0",
  "permissions": [
    "storage"
  ],
  "host_permissions": [
    "https://fundgz.1234567.com.cn/*",
    "https://hq.sinajs.cn/*",
    "https://fund.eastmoney.com/*"
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

### 开发环境
1. Clone 项目
2. 修改代码
3. 在 Chrome 中加载测试
4. 提交 PR

### 代码规范
- 使用 async/await 而非回调
- 使用 `storage.get/set` 访问数据
- 使用 `round2()` 格式化数值
- 添加必要的注释

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
