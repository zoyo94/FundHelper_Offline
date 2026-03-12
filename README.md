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
- 💰 **收益计算** - 自动日结算，精确计算当日收益和累计收益
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
- 每日首次打开自动结算
- 对比昨日净值计算收益
- 自动更新持仓金额

#### 手动日结算
- 点击「日结算」按钮
- 自动备份数据
- 支持撤销操作

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
- 多周期收益对比
- 业绩走势图表
- 风险指标分析

### 6️⃣ 数据管理

#### 导出数据
- 导出为 JSON 格式
- 包含所有持仓和交易记录
- 文件名自动带时间戳

#### 导入数据
- 支持导入之前导出的 JSON 文件
- 自动数据迁移和格式转换
- 导入前确认提示

#### 数据备份
- 日结算前自动备份
- 支持撤销结算恢复数据
- 备份数据当日有效

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

#### 1. 统一的 Storage 访问层
```javascript
const storage = {
    async get(keys) {
        return new Promise(resolve => chrome.storage.local.get(keys, resolve));
    },
    async set(data) {
        return new Promise(resolve => chrome.storage.local.set(data, resolve));
    }
};
```

#### 2. 数值格式化工具
```javascript
function round2(num) {
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
    "amount": 10000.00,              // 持仓金额
    "shares": 9523.81,               // 持有份额
    "holdProfit": 1234.56,           // 累计收益
    "yesterdayProfit": 123.45,       // 昨日收益
    "group": "股票型",                // 分组名称
    "savedPrevPrice": 1.0500,        // 上次结算净值
    "savedPrevDate": "2026-03-11",   // 上次结算日期
    "pendingAdjustments": [          // 待确认交易
      {
        "type": "add",               // 交易类型: add/remove
        "amount": 1000,              // 买入金额
        "feeRate": 0.15,             // 费率
        "targetDate": "2026-03-13",  // 确认日期
        "orderDate": "2026-03-12",   // 下单日期
        "orderNav": 1.0500,          // 下单净值
        "status": "pending"          // 状态: pending/confirmed
      }
    ]
  }
}
```

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
  "version": "1.4",
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

---

## 🐛 常见问题

### Q: 为什么有些基金显示「接口获取不到数据」？
A: 可能是该基金类型不支持或接口暂时不可用，可以手动输入数据。

### Q: OCR 识别不准确怎么办？
A: 识别结果支持手动编辑，修改后再批量保存即可。

### Q: 走势图数据会保留多久？
A: 今日数据会持久化保存，刷新页面不丢失，第二天自动清空重新记录。

### Q: 如何备份数据？
A: 点击「导出」按钮导出 JSON 文件，妥善保管即可。

### Q: 支持哪些资产类型？
A: 目前支持基金（6位数字代码）和期货（字母+数字代码）。

---

## 📝 更新日志

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
