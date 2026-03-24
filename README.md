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
- 🖼️ **OCR 识别** - 支持截图批量导入资产，自动识别代码和金额
- 💰 **收益计算** - 自动/手动日结算，按接口交易日准确计算昨日收益并保留当日首份备份
- 🔄 **加减仓管理** - T+1/T+2 确认机制，自动计算份额
- 📁 **分组管理** - 自由分组，批量操作，灵活管理
- 🎨 **现代 UI** - 深色主题，流畅动画，优雅交互

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
- **OCR 批量添加**：上传持仓截图，自动识别并批量导入
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
- **Vanilla JavaScript** - 无框架依赖，轻量高效
- **Tesseract.js v4** - 离线 OCR 识别引擎
- **Chrome Storage API** - 本地数据持久化
- **Canvas API** - 走势图表绘制

### 项目结构

```
FundHelper_Offline/
├── manifest.json              # 扩展配置文件
├── popup.html                 # 主界面 HTML
├── popup.js                   # 核心业务逻辑 (3400+ 行)
├── popup.css                  # 样式文件
├── background.js              # 后台服务 (代理跨域请求)
├── tesseract.min.js           # OCR 核心库
├── worker.min.js              # OCR Worker
├── tesseract-core.wasm.js     # WASM 核心
├── chi_sim.traineddata.gz     # 中文简体训练数据
└── README.md                  # 项目文档
```

### 代码优化亮点

#### 1. 统一的 Storage 访问层（带错误处理）
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

#### 2. 数值格式化工具（带类型检查）
```javascript
function round2(num) {
    if (typeof num !== 'number' || isNaN(num)) {
        console.warn('round2: 输入不是有效数字:', num);
        return 0;
    }
    return parseFloat(num.toFixed(2));
}
```

#### 3. 全面使用 async/await
- 消除回调地狱
- 代码更清晰易读
- 错误处理更统一

#### 4. 走势数据持久化
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
    "shares": 9523.81,               // 当前持有份额 (保留6位小数)
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
  "name": "FundHelper Offline",
  "version": "1.7.2",
  "permissions": [
    "storage",           // 本地存储
    "unlimitedStorage"   // 无限存储空间
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

### Unreleased
- 🔄 **交易日驱动结算**：昨日收益展示改为依赖接口返回的最新交易日，避免周末、节假日或停更基金沿用旧值
- 📦 **首份备份语义收敛**：自动/手动结算统一写入当天第一次结算前快照，撤销后仍可继续导出和对比
- 📤 **新增备份导出入口**：FAB 菜单支持分别导出当前实时数据与当天首份备份数据
- 🎨 **FAB 与详情页体验优化**：悬浮菜单更整齐，历史业绩支持辅助线和“更多”完整净值列表

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
- 🛠️ `round6(num)` - 份额计算（保留6位小数）
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
