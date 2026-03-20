# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此代码库中工作时提供指导。

## 项目概述

Chrome 扩展（Manifest V3），用于离线追踪基金/期货资产。单页 popup 应用，支持 OCR 批量导入、实时估值和收益计算。所有数据通过 Chrome Storage API 本地存储。

## 开发流程

### 测试修改
1. 修改 `popup.js`、`popup.html` 或 `background.js` 代码
2. 在 Chrome 中打开 `chrome://extensions/`
3. 点击扩展卡片上的刷新图标
4. 点击扩展图标打开 popup 进行测试

### 调试方法
- **Popup 控制台**：右键 popup → 检查 → Console 标签
- **Background service worker**：`chrome://extensions/` → 点击扩展下方的 "service worker" 链接
- **存储检查**：Chrome DevTools → Application → Storage → Local Storage

无需构建过程 - 所有文件直接加载。

## 架构设计

### 组件交互

```
popup.html (UI 界面)
    ↓
popup.js (所有业务逻辑 ~3400 行)
    ↓
chrome.storage.local (数据持久化)
    ↓
background.js (仅用于新浪 API 的 CORS 代理)
```

**popup.js** 包含所有业务逻辑：
- 全局状态管理（`currentFundsData`、`selectedCodes`、`fundHistoryData`）
- 从多个 API 获取数据（天天基金、新浪、腾讯）
- UI 渲染和事件处理
- 结算计算
- OCR 集成

**background.js** 只有一个用途：
- 代理新浪 API 请求（`hq.sinajs.cn`）以绕过 CORS
- 添加必需的请求头（`Referer`、`User-Agent`）
- 响应来自 popup 的 `FETCH_SINA` 消息

**Storage 层** 已 Promise 化：
```javascript
const storage = {
    async get(keys) { ... },
    async set(data) { ... }
};
```

### 数据流

1. 用户打开 popup → 触发 `DOMContentLoaded`
2. 调用 `loadData()` → 从 storage + API 获取数据
3. `_loadDataImpl()` 处理数据 → 计算收益
4. UI 渲染表格显示当前状态
5. 用户操作 → 更新 storage → 调用 `loadData()` 刷新

## 关键模式与约定

### 必须使用的工具函数

- **Storage 访问**：使用 `storage.get()` / `storage.set()`（禁止直接用 `chrome.storage.local`）
- **数值格式化**：
  - 使用 `round2(num)` 处理所有金额（保留 2 位小数）
  - 使用 `round6(num)` 处理所有份额（保留 6 位小数）
  - 使用 `formatProfit(num, suffix)` 格式化收益显示（自动添加正负号）
- **日期时间格式化**：
  - 使用 `getToday()` 获取 YYYY-MM-DD 格式字符串
  - 使用 `formatDate(date)` 格式化日期为 YYYY-MM-DD
  - 使用 `formatTime(date)` 格式化时间为 HH:MM
  - 使用 `formatDateTimeForFile(date)` 格式化为文件名格式 YYYYMMDD_HHMM
- **用户反馈**：使用 `showToast(msg, type)` 显示通知

### 全面使用 Async/Await

所有 storage 操作和 API 调用都使用 async/await，禁止使用回调：
```javascript
// ✅ 正确
const { myFunds } = await storage.get(['myFunds']);

// ❌ 错误
chrome.storage.local.get(['myFunds'], (result) => { ... });
```

### 数据结构

**myFunds**（主存储键）：
```javascript
{
  "005827": {
    amount: 10000.00,              // 当前持仓金额
    shares: 9523.81,               // 当前持有份额
    holdProfit: 1234.56,           // 累计收益
    yesterdayProfit: 123.45,       // 昨日收益
    group: "股票型",                // 分组名称
    savedPrevPrice: 1.0500,        // 上次结算净值
    savedPrevDate: "2026-03-11",   // 上次结算日期
    pendingAdjustments: [          // T+1/T+2 待确认交易
      {
        type: "add",               // "add" 或 "remove"
        amount: 1000,              // 买入金额（加仓时）
        shares: 100,               // 卖出份额（减仓时）
        feeRate: 0.15,             // 费率 %
        targetDate: "2026-03-13",  // 确认日期
        orderDate: "2026-03-12",   // 下单日期
        orderNav: 1.0500,          // 下单净值
        status: "pending"          // "pending" 或 "confirmed"
      }
    ]
  }
}
```

**fundHistoryData**（日内走势数据）：
```javascript
{
  "005827": {
    date: "2026-03-12",
    points: [
      { time: "09:30", rate: 0 },
      { time: "10:00", rate: 0.52 }
    ]
  }
}
```

## OCR 集成（Tesseract.js v4）

### Worker 初始化模式

Worker 采用**懒加载**和**缓存**策略，避免重复初始化：
```javascript
if (!window._tWorker) {
    window._tWorker = await Tesseract.createWorker({
        workerPath: chrome.runtime.getURL('worker.min.js'),
        langPath: chrome.runtime.getURL('').replace(/\/$/, ''),
        corePath: chrome.runtime.getURL('tesseract-core.wasm.js'),
        logger: m => {}
    });
    await window._tWorker.loadLanguage('chi_sim');
    await window._tWorker.initialize('chi_sim');
}
```

### CSP 要求

`manifest.json` 必须包含：
```json
"content_security_policy": {
  "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
}
```

没有 `wasm-unsafe-eval`，Tesseract WASM 将无法加载。

### OCR 解析策略

1. 在 OCR 文本中查找 6 位数字基金代码
2. 在代码上下 ±5 行范围内搜索金额/份额
3. 向用户展示可编辑的结果表格
4. 用户确认后批量保存

## API 集成

### 多数据源

- **天天基金**（`fundgz.1234567.com.cn`）- 实时基金估值
- **新浪**（`hq.sinajs.cn`）- 期货行情（通过 background 代理）
- **腾讯**（`qt.gtimg.cn`）- 重仓股票行情

### Background 代理用法

从 popup 获取新浪 API：
```javascript
function proxyFetchSina(url, timeout = 5000) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            { type: 'FETCH_SINA', url },
            response => { ... }
        );
    });
}
```

Background 会自动添加必需的请求头。

## 结算逻辑

### 执行顺序（重要！）

**关键原则：分红检测必须在自动结算之前执行**

```javascript
// 1. 先检测分红（从 API 获取 dividendList）
// 2. 再执行自动结算（结算时能看到分红记录）
// 3. 最后处理待确认交易
```

这个顺序确保分红导致的净值下跌不会被误判为亏损。

### 自动结算

每天首次打开 popup 时运行：
1. **先检测分红**：从 API 的 `dividendList` 获取分红信息，创建待确认记录
2. **再执行结算**：比较 `savedPrevDate` 与今天日期
3. 如果是新的一天 → 计算昨日收益
4. 使用累计净值（`acNetValue`）检测分红，避免误判
5. 更新 `yesterdayProfit` 和 `savedPrevPrice`
6. 处理已确认的待处理调整（T+1/T+2）

### 手动结算

通过 FAB 菜单触发：
1. 备份当前数据到 `fundsBackup` + `backupDate`
2. 对所有基金执行结算
3. 允许当天内撤销

### 分红检测与处理

**双重检测机制**：

1. **API 分红列表检测**（第一优先级）
   - 从天天基金 API 获取 `dividendList`
   - 在自动结算**之前**执行
   - 创建 `type: 'dividend'` 的待确认记录
   - 标记 `autoDetected: true`

2. **累计净值差检测**（第二优先级）
   - 在结算时使用累计净值（`acNetValue`）
   - 计算公式：`dividendPerShare = (acNetValue - baseAcNet) - (price - basePrice)`
   - 如果 `dividendPerShare > 0`，说明有分红
   - 使用累计净值差计算总收益，避免误判

**分红处理流程**：
```javascript
// 分红日（如 3-13）：净值下跌
// 到账日（如 3-17）：用户看到通知
// 系统处理：
// 1. 检测到分红 → 创建 pending 记录
// 2. 结算时使用累计净值 → 正确计算收益
// 3. holdProfit 不会因分红而减少
```

**重要**：`autoDetected=true` 的分红在确认时不重复累加到 `holdProfit`，因为结算层已经通过累计净值差计入了。

## 重要注意事项

### 走势数据持久化

`fundHistoryData` 在每次刷新后保存到 storage：
- 关闭/重开 popup 数据不丢失
- 新的一天自动清空
- 支持跨会话的日内走势图

### 选中状态

`selectedCodes`（Set）跟踪多选：
- Shift+点击进行范围选择
- 用于批量操作（修改分组、清空、删除）
- 批量操作后清空

### Modal 系统

单个 modal 复用于所有对话框：
- `showAlert()` / `showConfirm()` / `showPrompt()` 封装 `_openModal()`
- 返回 Promise，在用户操作时 resolve
- 同时只能打开一个 modal

### FAB 菜单

带子菜单的悬浮操作按钮：
- 点击打开，点击外部关闭
- 所有批量操作都在这里
- OCR 批量添加入口

## 代码组织

尽管是单个 3885 行文件，`popup.js` 有清晰的分区：

1. **全局状态**（第 1-10 行）
2. **工具函数**（storage、格式化、日期、收益显示）
3. **Toast/Modal 系统**
4. **结算逻辑**（自动/手动/撤销）
5. **走势数据持久化**
6. **API 获取**（天天基金、新浪、腾讯）
7. **主数据加载**（`loadData()`）- **关键：分红检测在自动结算之前**
8. **批量操作**
9. **基金编辑器 modal**
10. **OCR 批量添加**
11. **详情页**
12. **事件处理器**
13. **DOMContentLoaded 初始化**

添加新功能时，遵循此组织模式。

## 最近更新

### v1.7.2 bug修复（2026-03-20）
- 🔧 **Chrome Storage API错误处理**：添加 `chrome.runtime.lastError` 检查，防止Promise永久pending
- 🔧 **数值格式化函数安全性**：为 `round2()`、`round6()`、`formatProfit()` 添加类型检查和默认值处理
- 🔧 **日期计算健壮性**：`calculateDividendArrivalDate()` 增加输入验证和fallback逻辑
- 🔧 **API数据解析改进**：新浪API数据解析增加数据验证，防止解析无效数据
- 🔧 **基础价格计算优化**：修复除零错误和undefined值处理，确保价格计算安全
- 🔧 **分红数据验证**：为分红列表数组操作添加结构验证，防止无效数据导致错误
- 🔧 **统一错误处理**：为 `_loadDataImpl()` 添加comprehensive错误捕获和用户反馈
- 🔧 **通用错误包装器**：新增 `withErrorHandling()` 函数，标准化异常处理流程
- ✅ **整体稳定性提升**：9个关键bug修复，大幅提升应用健壮性和错误恢复能力

### v1.7.1 修复（2026-03-18）
- 🐛 简化昨日收益计算逻辑，移除分红特殊处理
- 💡 统一使用净值差计算：`shares × (price - prevTradingDayPrice)`
- 📝 NAV 已自动反映分红影响（分红日 NAV 会下跌相应金额），无需额外调整

### v1.6 优化（2026-03-17）
- `round6(num)` - 份额计算（保留 6 位小数）
- `formatProfit(num, suffix)` - 收益格式化（自动添加正负号）
- `formatTime(date)` - 时间格式化 HH:MM
- `formatDateTimeForFile(date)` - 文件名时间格式
- 代码简化：统一使用工具函数，优化 38 处重复代码
- 分红逻辑修复：调整执行顺序，分红检测在自动结算之前

### v1.7 优化（用户体验与业务逻辑）

#### 用户体验优化
- **合并交易确认通知**：多笔待确认交易合并为一条通知，避免通知轰炸
- **分红检测静默处理**：改为只在通知中心记录，不弹 8 秒长 toast
- **简化编辑资产流程**：删除获取净值的 toast，只在保存时提示
- **统一批量操作确认**：提取 `confirmBatchOperation()` 通用函数

#### 业务逻辑修复
- **修复分红双重计算风险**：检查 `savedPrevDate` 判断分红是否已被结算层计入
  - 如果结算日期在分红日期之后 → 已计入，不重复累加
  - 如果结算日期在分红日期之前 → 未计入，需要手动累加
  - 避免分红被漏掉或重复计算

#### 代码改进
- 新增 `confirmBatchOperation()` 通用函数
- 优化交易确认逻辑，收集后合并通知
- 改进分红确认的判断逻辑

## 常见修改场景

### 添加新的批量操作

1. 在 `popup.html` 的 FAB 菜单中添加按钮
2. 在 popup.js 中创建 async 函数
3. 使用 `selectedCodes` 获取选中的基金
4. 通过 `storage.set()` 更新 storage
5. 调用 `loadData()` 刷新 UI
6. 显示 toast 反馈

### 添加新的 API 数据源

1. 在 `manifest.json` 中添加 host 权限
2. 如果有 CORS 问题 → 在 `background.js` 中添加代理逻辑
3. 在 popup.js 中创建 fetch 函数
4. 使用 `withTimeout(promise, ms, fallback)` 处理超时
5. 更新 `fetchLiveInfo()` 使用新数据源

### 修改数据结构

1. 更新 `loadData()` 和保存函数中的 storage 读写
2. 为现有用户添加迁移逻辑
3. 更新本文件中的类型注释
4. 使用新旧数据进行测试

## 测试清单

修改代码后，验证：

- [ ] Popup 打开时无控制台错误
- [ ] 关闭/重开 popup 后数据持久化
- [ ] 结算计算正确（特别是分红场景）
- [ ] 分红检测在自动结算之前执行
- [ ] 分红不会被误判为亏损
- [ ] OCR 批量添加正常工作（如有修改）
- [ ] 走势数据刷新后保留（如有修改）
- [ ] Background 代理新浪 API 正常（如有修改）
- [ ] 多选和批量操作正常
- [ ] Toast 通知正确显示
- [ ] Modal 对话框正确 resolve

## 常见问题排查

### 分红相关问题

**症状**：分红后累计收益减少，昨日收益显示为负数

**原因**：分红导致净值下跌被误判为亏损

**检查**：
1. 查看控制台是否有 `[分红]` 日志
2. 确认分红检测在自动结算之前执行
3. 检查 `pendingAdjustments` 中是否有分红记录
4. 验证 `autoDetected: true` 的分红不会重复计入

**解决**：确保 `loadData()` 中的执行顺序正确（分红检测 → 自动结算 → 交易确认）
