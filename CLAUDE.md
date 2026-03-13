# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FundHelper_Offline is a Chrome Extension (Manifest V3) for offline asset tracking (funds/futures). It's a single-page popup application with all business logic in `popup.js` (~3900 lines), using vanilla JavaScript with no framework dependencies.

## Architecture

### Core Files
- `manifest.json` - MV3 configuration, v1.4, includes `wasm-unsafe-eval` CSP for Tesseract.js
- `popup.html` - Main UI (580×550px), deep theme, FAB menu
- `popup.js` - All business logic: data management, API calls, UI rendering, OCR batch import
- `background.js` - Service worker that proxies Sina API requests to bypass CORS

### Data Flow
1. User opens popup → `DOMContentLoaded` → `restoreFundHistoryData()` → `loadData()`
2. `loadData()` fetches live data for all funds → calculates profits → renders table
3. All data stored in `chrome.storage.local` (no backend)
4. Background worker proxies Sina stock API via `chrome.runtime.sendMessage({ type: 'FETCH_SINA' })`

### Key Data Structures

**myFunds** (chrome.storage.local):
```javascript
{
  "005827": {
    amount: 10000.00,              // Position amount
    shares: 9523.81,               // Shares held
    holdProfit: 1234.56,           // Cumulative profit
    yesterdayProfit: 123.45,       // Yesterday's profit
    group: "股票型",                // Group name
    savedPrevPrice: 1.0500,        // Last settlement NAV
    savedPrevDate: "2026-03-11",   // Last settlement date
    savedAcNetValue: 2.1234,       // Last settlement cumulative NAV (for dividend detection)
    pendingAdjustments: [          // Pending buy/sell orders (T+1/T+2)
      {
        type: "add",               // "add" or "remove"
        amount: 1000,              // Buy amount
        feeRate: 0.15,             // Fee rate
        targetDate: "2026-03-13",  // Confirmation date
        orderDate: "2026-03-12",   // Order date
        orderNav: 1.0500,          // Order NAV
        status: "pending"          // "pending" or "confirmed"
      }
    ]
  }
}
```

**fundHistoryData** (chrome.storage.local + in-memory):
```javascript
{
  "005827": {
    date: "2026-03-12",            // Date
    points: [                      // Intraday valuation points
      { time: "09:30", rate: 0 },
      { time: "10:00", rate: 0.52 }
    ]
  }
}
```

## Key Functions

### Data Management
- `loadData()` - Main refresh function: fetches live data, calculates profits, renders table
- `fetchLiveInfo(code)` - Fetches real-time fund/futures data from multiple APIs (Eastmoney, Sina)
- `storage.get(keys)` / `storage.set(data)` - Promisified chrome.storage.local wrapper

### Settlement System
- `autoSettlement(funds, fetchedData, todayStr)` - Auto-settlement on first daily open
- `manualSettlement()` - Manual settlement via FAB menu
- `rollbackSettlement()` - Undo today's settlement (restores backup)
- `_applySettlementLoop(funds, settlements, todayStr)` - Core settlement logic with dividend detection

### Position Adjustments (T+1/T+2)
- `adjustPosition(code, type)` - Add/remove position with confirmation date calculation
- `getConfirmDate()` - Calculates T+1/T+2 confirmation date (skips weekends)
- `nextTradingDay(date)` - Returns next trading day (skips weekends)

### Batch Operations
- `batchChangeGroup()` - Batch modify group for selected funds
- `batchClearPositions()` - Batch clear positions (reset amount/shares/profit)
- `batchDeleteFunds()` - Batch delete selected funds
- `batchRecalculateShares()` - Recalculate shares based on current amount and NAV

### OCR Batch Import
- `openOCRBatchAdd()` - Opens OCR modal for batch import from screenshots
- Tesseract.js worker cached in `window._tWorker` to avoid re-initialization
- Parsing strategy: find 6-digit codes → search ±5 lines for amount/shares
- Results editable in table before batch save

### UI Rendering
- `renderTable()` - Renders fund table with sorting, selection, profit colors
- `openFundEditor(code)` - Opens add/edit modal for single fund
- `showCenterMenu(code)` - Opens fund detail page (chart, holdings, history)
- `updateGroupFilter()` - Updates group filter dropdown

### Utilities
- `round2(num)` - Rounds to 2 decimal places
- `getToday()` - Returns YYYY-MM-DD string
- `showToast(msg, type)` - Toast notification
- `showConfirm(msg)` - Confirmation dialog
- `proxyFetchSina(url)` - Proxies Sina API via background worker

## Tesseract.js v4 in MV3

**Worker initialization** (must use chrome.runtime.getURL):
```javascript
const w = await Tesseract.createWorker({
    workerPath: chrome.runtime.getURL('worker.min.js'),
    langPath: chrome.runtime.getURL('').replace(/\/$/, ''),
    corePath: chrome.runtime.getURL('tesseract-core.wasm.js'),
    logger: m => {}
});
await w.loadLanguage('chi_sim');
await w.initialize('chi_sim');
```

**Required CSP in manifest.json**:
```json
"content_security_policy": {
  "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
}
```

## API Endpoints

- **Eastmoney Fund**: `https://fundgz.1234567.com.cn/js/{code}.js` (real-time valuation)
- **Eastmoney Fund Detail**: `https://fund.eastmoney.com/{code}.html` (holdings, history)
- **Sina Futures**: `https://hq.sinajs.cn/list={code}` (futures quotes, proxied via background.js)
- **Tencent Stocks**: `https://qt.gtimg.cn/q={code}` (stock quotes for fund holdings)

## Development Notes

### Code Style
- All async operations use `async/await` (no callbacks)
- Use `storage.get/set` for chrome.storage.local access
- Use `round2()` for all profit/amount calculations
- Use `getToday()` for date strings

### Common Patterns
- **Adding new fund**: `openFundEditor(null)` → user fills form → saves to `myFunds`
- **Editing fund**: Double-click table row → `openFundEditor(code)` → edit → save
- **Batch operations**: Select rows → click FAB menu button → confirm → update `myFunds`
- **Settlement**: `manualSettlement()` → backup data → update `savedPrevPrice/savedPrevDate` → calculate `yesterdayProfit`

### Dividend Detection
The settlement system automatically detects fund dividends by comparing cumulative NAV (`acNetValue`). If NAV drops but cumulative NAV is unchanged, it's a dividend (not a loss). See `_applySettlementLoop()` for implementation.

### Chart Data Persistence
- `fundHistoryData` is saved to chrome.storage.local on every refresh (debounced 1s)
- On popup open, `restoreFundHistoryData()` loads data and clears non-today entries
- Chart data survives page refresh but auto-clears next day

## Testing

No automated tests. Manual testing workflow:
1. Load extension in Chrome (`chrome://extensions/` → Developer mode → Load unpacked)
2. Click extension icon to open popup
3. Test features: add fund, edit, batch operations, OCR import, settlement, etc.
4. Check `chrome.storage.local` in DevTools → Application → Storage

## Common Tasks

- **Add new API endpoint**: Update `fetchLiveInfo()` and add host permission to `manifest.json`
- **Add new batch operation**: Add button to FAB menu in `initFabMenu()`, implement handler function
- **Modify settlement logic**: Edit `_applySettlementLoop()` (handles dividend detection, profit calculation)
- **Change UI layout**: Edit `popup.html` inline styles or add to `<style>` block
- **Debug API calls**: Check `apiLogger` console output (logs each API once per refresh)
