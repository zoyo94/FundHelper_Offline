(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // popup.js
  var require_popup = __commonJS({
    "popup.js"() {
      var currentFundsData = [];
      var sortField = "todayProfit";
      var sortDirection = -1;
      var selectedCodes = /* @__PURE__ */ new Set();
      var lastClickedIndex = -1;
      function clearSelection() {
        selectedCodes.clear();
        lastClickedIndex = -1;
      }
      var apiLogger = {
        loggedApis: /* @__PURE__ */ new Set(),
        // 用于记录已打印日志的接口
        // 重置状态（在 loadData 开始时调用）
        reset() {
          this.loggedApis.clear();
          console.log("%c[API Monitor] \u65E5\u5FD7\u72B6\u6001\u5DF2\u91CD\u7F6E\uFF0C\u5F00\u59CB\u76D1\u6D4B\u63A5\u53E3...", "color: #1890ff; font-weight: bold;");
        },
        /**
         * 打印日志（仅第一次调用时打印）
         * @param {string} apiName 接口名称
         * @param {string} url 请求地址
         * @param {string} status 状态描述
         */
        log(apiName, url, status) {
          if (this.loggedApis.has(apiName)) return;
          console.log(`[API Monitor] ${apiName} | \u72B6\u6001: ${status} | \u5730\u5740: ${url}`);
          this.loggedApis.add(apiName);
        }
      };
      var elements = {
        addBtn: document.getElementById("addBtn"),
        groupList: document.getElementById("groupList"),
        groupFilter: document.getElementById("groupFilter"),
        tableBody: document.getElementById("fundTableBody"),
        status: document.getElementById("status"),
        fullscreenBtn: document.getElementById("fullscreenBtn"),
        refreshBtn: document.getElementById("refreshBtn"),
        totalAmount: document.getElementById("totalAmount"),
        totalTodayProfit: document.getElementById("totalTodayProfit"),
        totalTotalProfit: document.getElementById("totalTotalProfit"),
        totalYesterdayProfit: document.getElementById("totalYesterdayProfit"),
        exportBtn: document.getElementById("exportBtn"),
        importBtn: document.getElementById("importBtn"),
        importFile: document.getElementById("importFile"),
        // Modal 相关
        modalOverlay: document.getElementById("modalOverlay"),
        modalTitle: document.getElementById("modalTitle"),
        modalMsg: document.getElementById("modalMsg"),
        modalInput: document.getElementById("modalInput"),
        modalFooter: document.getElementById("modalFooter"),
        toastContainer: document.getElementById("toastContainer"),
        batchGroupBtn: document.getElementById("batchGroupBtn"),
        batchClearBtn: document.getElementById("batchClearBtn")
      };
      function showToast(msg, type = "info", duration = 3e3) {
        const toast = document.createElement("div");
        toast.className = `toast ${type}`;
        toast.textContent = msg;
        elements.toastContainer.appendChild(toast);
        setTimeout(() => {
          toast.classList.add("fade-out");
          toast.addEventListener("animationend", () => toast.remove());
        }, duration);
      }
      function showAlert(msg, title = "\u63D0\u793A") {
        return new Promise((resolve) => {
          _openModal(title, msg, false);
          _setFooter([
            { text: "\u786E\u5B9A", cls: "modal-btn-ok", onClick: () => {
              _closeModal();
              resolve();
            } }
          ]);
        });
      }
      function showConfirm(msg, title = "\u786E\u8BA4", danger = false) {
        return new Promise((resolve) => {
          _openModal(title, msg, false);
          _setFooter([
            { text: "\u53D6\u6D88", cls: "modal-btn-cancel", onClick: () => {
              _closeModal();
              resolve(false);
            } },
            { text: "\u786E\u5B9A", cls: danger ? "modal-btn-danger" : "modal-btn-ok", onClick: () => {
              _closeModal();
              resolve(true);
            } }
          ]);
        });
      }
      function showPrompt(msg, defaultVal = "", title = "\u8BF7\u8F93\u5165") {
        return new Promise((resolve) => {
          _openModal(title, msg, true, defaultVal);
          const onOk = () => {
            const val = elements.modalInput.value;
            _closeModal();
            resolve(val);
          };
          elements.modalInput.onkeydown = (e) => {
            if (e.key === "Enter") onOk();
          };
          _setFooter([
            { text: "\u53D6\u6D88", cls: "modal-btn-cancel", onClick: () => {
              _closeModal();
              resolve(null);
            } },
            { text: "\u786E\u5B9A", cls: "modal-btn-ok", onClick: onOk }
          ]);
          elements.modalInput.focus();
        });
      }
      function _openModal(title, msg, showInput, defaultVal = "") {
        elements.modalTitle.textContent = title;
        elements.modalMsg.textContent = msg;
        if (showInput) {
          elements.modalInput.value = defaultVal;
          elements.modalInput.style.display = "block";
        } else {
          elements.modalInput.style.display = "none";
        }
        elements.modalFooter.innerHTML = "";
        elements.modalOverlay.classList.add("visible");
      }
      function _closeModal() {
        elements.modalOverlay.classList.remove("visible");
        elements.modalInput.onkeydown = null;
      }
      function _setFooter(btns) {
        elements.modalFooter.innerHTML = "";
        btns.forEach(({ text, cls, onClick }) => {
          const btn = document.createElement("button");
          btn.textContent = text;
          btn.className = `modal-btn ${cls}`;
          btn.onclick = onClick;
          elements.modalFooter.appendChild(btn);
        });
      }
      function checkBackup() {
        chrome.storage.local.get(["backupFunds", "lastSettlementDate"], (res) => {
          const fabRollback = document.getElementById("fabRollback");
          if (fabRollback) {
            if (res.backupFunds && res.lastSettlementDate === getToday()) {
              fabRollback.style.display = "block";
            } else {
              fabRollback.style.display = "none";
            }
          }
        });
      }
      function backupFundsData() {
        return new Promise((resolve) => {
          chrome.storage.local.get(["myFunds", "lastUpdateDate", "lastDayProfits"], (res) => {
            const funds = res.myFunds || {};
            if (Object.keys(funds).length === 0) {
              resolve();
              return;
            }
            const backupData = {
              backupTime: (/* @__PURE__ */ new Date()).toLocaleString(),
              lastUpdateDate: res.lastUpdateDate || "",
              lastDayProfits: res.lastDayProfits || {},
              myFunds: funds
            };
            chrome.storage.local.set({ backupFunds: backupData }, () => {
              console.log("[Backup] \u6570\u636E\u5DF2\u5907\u4EFD:", backupData);
              resolve();
            });
          });
        });
      }
      async function manualSettlement() {
        const ok = await showConfirm("\u786E\u8BA4\u8FDB\u884C\u65E5\u7ED3\u7B97\u5417\uFF1F\n\u7CFB\u7EDF\u5C06\u5BF9\u6BD4\u6700\u65B0\u516C\u5E03\u7684\u51C0\u503C\u4E0E\u4E0A\u6B21\u7ED3\u7B97\u7684\u51C0\u503C\uFF0C\u8BA1\u7B97\u5E76\u8BB0\u5F55\u6536\u76CA\u3002", "\u65E5\u7ED3\u7B97\u786E\u8BA4");
        if (!ok) return;
        elements.status.innerText = "\u6B63\u5728\u5907\u4EFD\u6570\u636E...";
        await backupFundsData();
        elements.status.innerText = "\u6B63\u5728\u6267\u884C\u65E5\u7ED3\u7B97...";
        chrome.storage.local.get(["myFunds"], async (res) => {
          const funds = res.myFunds || {};
          let updatedCount = 0;
          for (const code in funds) {
            const item = funds[code];
            const live = currentFundsData.find((f) => f.code === code);
            if (!live || !live.prevPrice) continue;
            const basePrice = item.savedPrevPrice || (item.shares > 0 ? item.amount / item.shares : live.prevPrice);
            const actualProfit = parseFloat((item.shares * (live.prevPrice - basePrice)).toFixed(2));
            funds[code].holdProfit = parseFloat(((item.holdProfit || 0) + actualProfit).toFixed(2));
            funds[code].yesterdayProfit = actualProfit;
            funds[code].amount = parseFloat((item.shares * live.prevPrice).toFixed(2));
            funds[code].savedPrevPrice = live.prevPrice;
            funds[code].savedPrevDate = live.prevPriceDate || getToday();
            updatedCount++;
          }
          chrome.storage.local.set({
            myFunds: funds,
            lastSettlementDate: getToday(),
            // 记录今天已结算
            lastUpdateDate: (/* @__PURE__ */ new Date()).toLocaleDateString()
          }, () => {
            showToast(`\u2705 \u7ED3\u7B97\u5B8C\u6210\uFF01\u5DF2\u66F4\u65B0 ${updatedCount} \u6761`, "success");
            checkBackup();
            loadData();
          });
        });
      }
      async function rollbackSettlement() {
        chrome.storage.local.get(["backupFunds"], async (res) => {
          if (!res.backupFunds || !res.backupFunds.myFunds) {
            await showAlert("\u672A\u627E\u5230\u5907\u4EFD\u6570\u636E\uFF0C\u65E0\u6CD5\u64A4\u9500\uFF01");
            return;
          }
          const backup = res.backupFunds;
          const backupTime = backup.backupTime || "\u672A\u77E5\u65F6\u95F4";
          const ok = await showConfirm(
            `\u786E\u5B9A\u8981\u64A4\u9500\u65E5\u7ED3\u7B97\u5417\uFF1F

\u6570\u636E\u5C06\u6062\u590D\u81F3\u5907\u4EFD\u65F6\u95F4\uFF1A
\u3010${backupTime}\u3011

\u8BF7\u6CE8\u610F\uFF1A\u64A4\u9500\u540E\uFF0C\u5F53\u5929\u7684\u7ED3\u7B97\u72B6\u6001\u4E5F\u5C06\u91CD\u7F6E\u3002`,
            "\u64A4\u9500\u786E\u8BA4",
            true
          );
          if (!ok) return;
          chrome.storage.local.set({
            myFunds: backup.myFunds,
            lastDayProfits: backup.lastDayProfits || {},
            lastUpdateDate: backup.lastUpdateDate || "",
            // 【关键点】保持今天日期，防止 loadData 触发自动结算循环
            lastSettlementDate: getToday(),
            // 清空备份，防止重复撤销
            backupFunds: null
          }, () => {
            showToast("\u2705 \u5DF2\u6210\u529F\u64A4\u9500\uFF0C\u6570\u636E\u5DF2\u6062\u590D\uFF01", "success");
            checkBackup();
            loadData();
          });
        });
      }
      async function autoSettlement(funds, fetchedData, todayStr) {
        console.log("[autoSettlement] \u68C0\u6D4B\u5230\u51C0\u503C\u66F4\u65B0\uFF0C\u5F00\u59CB\u81EA\u52A8\u7ED3\u7B97...");
        elements.status.innerText = "\u6B63\u5728\u81EA\u52A8\u7ED3\u7B97...";
        const backupData = {
          backupTime: (/* @__PURE__ */ new Date()).toLocaleString(),
          myFunds: JSON.parse(JSON.stringify(funds))
          // 深拷贝当前数据
        };
        await new Promise((r) => chrome.storage.local.set({ backupFunds: backupData }, r));
        let updatedCount = 0;
        for (const { code, live } of fetchedData) {
          const item = funds[code];
          if (!item || !live || live.prevPrice <= 0) continue;
          const settlementPrice = live.prevPrice;
          const basePrice = item.savedPrevPrice || (item.shares > 0 ? item.amount / item.shares : settlementPrice);
          if (Math.abs(settlementPrice - basePrice) < 1e-5) continue;
          const actualProfit = parseFloat((item.shares * (settlementPrice - basePrice)).toFixed(2));
          funds[code].holdProfit = parseFloat(((item.holdProfit || 0) + actualProfit).toFixed(2));
          funds[code].yesterdayProfit = actualProfit;
          funds[code].amount = parseFloat((item.shares * settlementPrice).toFixed(2));
          funds[code].savedPrevPrice = settlementPrice;
          funds[code].savedPrevDate = live.prevPriceDate || todayStr;
          updatedCount++;
        }
        if (updatedCount === 0) {
          console.log("[autoSettlement] \u51C0\u503C\u65E0\u53D8\u5316\uFF0C\u8DF3\u8FC7");
          return;
        }
        chrome.storage.local.set({
          myFunds: funds,
          lastSettlementDate: todayStr,
          lastUpdateDate: (/* @__PURE__ */ new Date()).toLocaleDateString()
        }, () => {
          console.log(`[autoSettlement] \u2705 \u5B8C\u6210\uFF0C\u5171\u66F4\u65B0 ${updatedCount} \u6761`);
          showToast(`\u2705 \u5DF2\u81EA\u52A8\u5B8C\u6210\u65E5\u7ED3\u7B97\uFF08${updatedCount} \u6761\uFF09`, "success", 4e3);
          checkBackup();
          loadData();
        });
      }
      function getToday() {
        const now = /* @__PURE__ */ new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      }
      document.addEventListener("DOMContentLoaded", async () => {
        const isPopup = chrome.extension.getViews({ type: "popup" }).includes(window);
        if (!isPopup) document.body.classList.add("is-fullscreen");
        checkBackup();
        loadData();
        elements.importFile.addEventListener("change", importFundsData);
        initFabMenu();
      });
      elements.fullscreenBtn.onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
      elements.refreshBtn.onclick = () => {
        elements.refreshBtn.classList.add("spinning");
        loadData().finally(() => {
          setTimeout(() => elements.refreshBtn.classList.remove("spinning"), 500);
        });
      };
      elements.groupFilter.onchange = () => {
        clearSelection();
        renderTable();
      };
      document.querySelectorAll(".sortable").forEach((th) => {
        th.addEventListener("click", () => {
          const field = th.dataset.sort;
          if (sortField === field) {
            sortDirection *= -1;
          } else {
            sortField = field;
            sortDirection = -1;
          }
          renderTable();
        });
      });
      function proxyFetchSina(url) {
        apiLogger.log("\u65B0\u6D6A\u4EE3\u7406", url, "\u53D1\u8D77\u8BF7\u6C42");
        return new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: "FETCH_SINA", url }, (response) => {
            if (response && response.success && response.data) {
              const content = response.data.match(/"(.*)"/);
              const result = content ? content[1] : null;
              if (result) {
                apiLogger.log("\u65B0\u6D6A\u4EE3\u7406", url, "\u6210\u529F\u83B7\u53D6\u6570\u636E");
              } else {
                apiLogger.log("\u65B0\u6D6A\u4EE3\u7406", url, "\u8FD4\u56DE\u6570\u636E\u683C\u5F0F\u65E0\u6548");
              }
              resolve(result);
            } else {
              apiLogger.log("\u65B0\u6D6A\u4EE3\u7406", url, "\u8BF7\u6C42\u5931\u8D25\u6216\u65E0\u54CD\u5E94");
              resolve(null);
            }
          });
        });
      }
      async function fetchLiveInfo(code) {
        const cleanCode = code.trim();
        if (/^\d{6}$/.test(cleanCode)) {
          const url1 = `https://fundgz.1234567.com.cn/js/${cleanCode}.js?rt=${Date.now()}`;
          try {
            apiLogger.log("\u573A\u5916\u4E3B\u63A5\u53E3", url1, "\u53D1\u8D77\u8BF7\u6C42");
            const res = await fetch(url1);
            const text = await res.text();
            const jsonMatch = text.match(/jsonpgz\((.*)\)/);
            if (jsonMatch) {
              const d = JSON.parse(jsonMatch[1]);
              if (d && (d.gsz || d.dwjz)) {
                const dwjz = parseFloat(d.dwjz) || 0;
                const gsz = parseFloat(d.gsz || d.dwjz) || 0;
                const gszzl = parseFloat(d.gszzl) || 0;
                const gztime = d.gztime || "";
                apiLogger.log("\u573A\u5916\u4E3B\u63A5\u53E3", url1, "\u6210\u529F");
                return {
                  name: d.name || `[\u672A\u77E5]${cleanCode}`,
                  rate: gszzl,
                  price: gsz,
                  prevPrice: dwjz,
                  prevPriceDate: d.jzrq || "",
                  priceTime: gztime
                };
              }
            }
            apiLogger.log("\u573A\u5916\u4E3B\u63A5\u53E3", url1, "\u6570\u636E\u65E0\u6548(\u5C1D\u8BD5\u5907\u7528)");
          } catch (e) {
            apiLogger.log("\u573A\u5916\u4E3B\u63A5\u53E3", url1, `\u8BF7\u6C42\u5F02\u5E38(${e.message})`);
          }
          const url2 = `https://fund.eastmoney.com/pingzhongdata/${cleanCode}.js?v=${Date.now()}`;
          try {
            apiLogger.log("\u573A\u5916\u5907\u7528\u63A5\u53E3", url2, "\u53D1\u8D77\u8BF7\u6C42");
            const extData = await fetch(url2).then((r) => r.text());
            if (extData && extData.includes("fS_name")) {
              const nameMatch = extData.match(/fS_name\s*=\s*"([^"]+)"/);
              const name = nameMatch ? nameMatch[1] : `[\u573A\u5916\u5907\u7528]${cleanCode}`;
              const netWorthMatch = extData.match(/Data_netWorthTrend\s*=\s*(\[.*?\])\s*;/);
              if (netWorthMatch) {
                const netWorthData = JSON.parse(netWorthMatch[1]);
                if (netWorthData && netWorthData.length >= 2) {
                  const latest = netWorthData[netWorthData.length - 1];
                  const gsz = parseFloat(latest.y) || parseFloat(latest.unitMoney) || 0;
                  const dwjz = gsz;
                  const dateStr = latest.x ? (() => {
                    const d = new Date(latest.x);
                    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                  })() : "";
                  apiLogger.log("\u573A\u5916\u5907\u7528\u63A5\u53E3", url2, "\u6210\u529F");
                  return {
                    name,
                    rate: null,
                    price: gsz,
                    prevPrice: dwjz,
                    prevPriceDate: dateStr,
                    isFallback: true
                  };
                }
              }
            }
            apiLogger.log("\u573A\u5916\u5907\u7528\u63A5\u53E3", url2, "\u6570\u636E\u65E0\u6548");
          } catch (e) {
            apiLogger.log("\u573A\u5916\u5907\u7528\u63A5\u53E3", url2, `\u8BF7\u6C42\u5F02\u5E38(${e.message})`);
          }
          try {
            const p = cleanCode.startsWith("5") ? "sh" : "sz";
            const url = `https://hq.sinajs.cn/list=${p}${cleanCode}`;
            const data = await proxyFetchSina(url);
            if (data && data.split(",").length > 10) {
              const parts = data.split(",");
              const cur = parseFloat(parts[3]) || 0;
              const pre = parseFloat(parts[2]) || 0;
              const rate = pre !== 0 ? parseFloat(((cur - pre) / pre * 100).toFixed(2)) : 0;
              return {
                name: "[\u573A]" + (parts[0] || cleanCode),
                rate,
                price: cur,
                prevPrice: pre
              };
            }
          } catch (e) {
            console.warn(`\u573A\u5185\u57FA\u91D1\u89E3\u6790\u5931\u8D25 ${cleanCode}:`, e);
          }
        }
        try {
          const url = `https://hq.sinajs.cn/list=nf_${cleanCode.toUpperCase()}`;
          const fut = await proxyFetchSina(url);
          if (fut) {
            const parts = fut.split(",");
            if (parts.length > 10) {
              const cur = parseFloat(parts[8]) || 0;
              const pre = parseFloat(parts[5]) || 0;
              const rate = pre !== 0 ? parseFloat(((cur - pre) / pre * 100).toFixed(2)) : 0;
              return {
                name: "[\u671F]" + (parts[0] || cleanCode),
                rate,
                price: cur,
                prevPrice: pre
              };
            }
          }
        } catch (e) {
          console.warn(`\u671F\u8D27\u89E3\u6790\u5931\u8D25 ${cleanCode}:`, e);
        }
        return {
          name: `[\u672A\u77E5]${cleanCode}`,
          rate: 0,
          price: 0,
          prevPrice: 0
        };
      }
      async function loadData() {
        clearSelection();
        elements.status.innerText = "\u540C\u6B65\u884C\u60C5\u4E2D...";
        apiLogger.reset();
        return new Promise((resolve) => {
          chrome.storage.local.get(["myFunds", "lastSettlementDate"], async (res) => {
            let funds = res.myFunds || {};
            const codes = Object.keys(funds);
            let dataChanged = false;
            const results = [];
            const fetchedData = await Promise.all(
              codes.map(async (code, index) => {
                await new Promise((r) => setTimeout(r, index * 50));
                const live = await fetchLiveInfo(code);
                return { code, live };
              })
            );
            const todayStr = getToday();
            if (res.lastSettlementDate !== todayStr) {
              const needsSettlement = fetchedData.some(({ code, live }) => {
                if (!live || live.prevPrice <= 0) return false;
                const fund = funds[code];
                if (!fund.savedPrevPrice) return false;
                return Math.abs(live.prevPrice - fund.savedPrevPrice) > 1e-5;
              });
              if (needsSettlement) {
                await autoSettlement(funds, fetchedData, todayStr);
              }
            }
            for (const { code, live } of fetchedData) {
              if (live && live.prevPrice > 0) {
                const item = funds[code];
                if (item.pendingAdjustments && item.pendingAdjustments.length > 0) {
                  for (const adj of item.pendingAdjustments) {
                    if (adj.status === "confirmed") continue;
                    if (todayStr >= adj.targetDate) {
                      if (adj.type === "add") {
                        const actualRate = (adj.feeRate || 0) / 100;
                        const price = live.prevPrice;
                        if (price > 0) {
                          const deltaShares = adj.amount * (1 - actualRate) / price;
                          item.shares = parseFloat((item.shares + deltaShares).toFixed(6));
                          item.amount = parseFloat((item.shares * price).toFixed(2));
                          adj.status = "confirmed";
                          adj.confirmedPrice = price;
                          adj.confirmedShares = parseFloat(deltaShares.toFixed(6));
                          adj.confirmedDate = todayStr;
                          showToast(`\u2705 ${code} \u52A0\u4ED3\u5DF2\u786E\u8BA4 (\u51C0\u503C${price}, +${adj.confirmedShares}\u4EFD)`, "success");
                          dataChanged = true;
                        }
                      } else if (adj.type === "remove") {
                        const price = live.prevPrice;
                        if (price > 0) {
                          item.shares = parseFloat((item.shares - adj.shares).toFixed(6));
                          if (item.shares < 0) item.shares = 0;
                          item.amount = parseFloat((item.shares * price).toFixed(2));
                          adj.status = "confirmed";
                          adj.confirmedPrice = price;
                          adj.confirmedShares = adj.shares;
                          adj.confirmedDate = todayStr;
                          showToast(`\u2705 ${code} \u51CF\u4ED3\u5DF2\u786E\u8BA4 (\u51C0\u503C${price}, -${adj.shares}\u4EFD)`, "success");
                          dataChanged = true;
                        }
                      }
                    }
                  }
                }
                if (!item.shares && item.amount > 0) {
                  if (live.prevPrice > 0) {
                    item.shares = parseFloat((item.amount / live.prevPrice).toFixed(6));
                    dataChanged = true;
                  } else if (live.price > 0) {
                    item.shares = parseFloat((item.amount / live.price).toFixed(6));
                    dataChanged = true;
                  }
                }
                if (item.shares > 0 && Math.abs(item.amount - item.shares) < 1e-4 && live.prevPrice > 0 && !live.name.includes("[\u672A\u77E5]")) {
                  const correctedAmount = parseFloat((item.shares * live.prevPrice).toFixed(2));
                  item.amount = correctedAmount;
                  dataChanged = true;
                }
                let todayProfit, useFallbackNav = false;
                if (!live.isFallback && live.price > 0) {
                  todayProfit = item.shares ? parseFloat((item.shares * (live.price - live.prevPrice)).toFixed(2)) : 0;
                } else if (live.prevPrice > 0 && item.savedPrevPrice > 0) {
                  todayProfit = item.shares ? parseFloat((item.shares * (live.prevPrice - item.savedPrevPrice)).toFixed(2)) : 0;
                  useFallbackNav = true;
                } else {
                  todayProfit = null;
                }
                const totalProfit = parseFloat(((item.holdProfit || 0) + (todayProfit || 0)).toFixed(2));
                results.push({
                  code,
                  name: live.name,
                  amount: item.amount || 0,
                  yesterdayProfit: item.yesterdayProfit || 0,
                  group: item.group || "\u9ED8\u8BA4",
                  rate: live.rate,
                  prevPrice: live.prevPrice || 0,
                  price: live.price || 0,
                  prevPriceDate: live.prevPriceDate || "",
                  priceTime: live.priceTime || "",
                  todayProfit,
                  totalProfit,
                  holdProfit: item.holdProfit || 0,
                  shares: item.shares || 0,
                  useFallbackNav,
                  pendingAdjustments: item.pendingAdjustments
                });
              }
            }
            currentFundsData = results.filter(Boolean);
            const todayProfits = {};
            results.forEach((r) => {
              if (r) todayProfits[r.code] = r.todayProfit;
            });
            chrome.storage.local.set({ lastDayProfits: todayProfits });
            if (dataChanged) {
              chrome.storage.local.set({ myFunds: funds });
            }
            updateGroupFilter();
            renderTable();
            elements.status.innerText = `\u6700\u540E\u66F4\u65B0: ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`;
            resolve();
          });
        });
      }
      async function batchRecalculateShares() {
        if (selectedCodes.size === 0) return showToast("\u274C \u8BF7\u5148\u52FE\u9009\u57FA\u91D1", "error");
        const ok = await showConfirm(`\u786E\u8BA4\u6839\u636E\u5F53\u524D\u91D1\u989D\u91CD\u7B97\u9009\u4E2D\u7684 ${selectedCodes.size} \u652F\u57FA\u91D1\u7684\u4EFD\u989D\u5417\uFF1F`);
        if (!ok) return;
        chrome.storage.local.get(["myFunds"], async (res) => {
          const funds = res.myFunds || {};
          let count = 0;
          for (const code of selectedCodes) {
            if (funds[code]) {
              const live = await fetchLiveInfo(code);
              if (live && live.prevPrice > 0) {
                funds[code].shares = parseFloat((funds[code].amount / live.prevPrice).toFixed(6));
                count++;
              }
            }
          }
          chrome.storage.local.set({ myFunds: funds }, () => {
            showToast(`\u2705 \u5DF2\u91CD\u7B97 ${count} \u652F\u57FA\u91D1\u4EFD\u989D`, "success");
            loadData();
          });
        });
      }
      async function batchChangeGroup() {
        if (selectedCodes.size === 0) return showToast("\u274C \u8BF7\u5148\u52FE\u9009\u57FA\u91D1", "error");
        const newGroup = await showPrompt("\u8BF7\u8F93\u5165\u65B0\u7684\u5206\u7EC4\u540D\u79F0\uFF1A", "\u6279\u91CF\u4FEE\u6539\u5206\u7EC4", "\u9ED8\u8BA4");
        if (newGroup === null) return;
        chrome.storage.local.get(["myFunds"], (res) => {
          const funds = res.myFunds || {};
          selectedCodes.forEach((code) => {
            if (funds[code]) funds[code].group = newGroup || "\u9ED8\u8BA4";
          });
          chrome.storage.local.set({ myFunds: funds }, () => {
            showToast(`\u{1F4C1} \u5DF2\u5C06\u9009\u4E2D\u57FA\u91D1\u79FB\u81F3\u5206\u7EC4\uFF1A${newGroup || "\u9ED8\u8BA4"}`, "success");
            loadData();
          });
        });
      }
      async function batchClearPositions() {
        if (selectedCodes.size === 0) return showToast("\u274C \u8BF7\u5148\u52FE\u9009\u57FA\u91D1", "error");
        const ok = await showConfirm(`\u786E\u8BA4\u8981\u6E05\u7A7A\u9009\u4E2D ${selectedCodes.size} \u652F\u57FA\u91D1\u7684\u6301\u4ED3\u91D1\u989D\u548C\u4EFD\u989D\u5417\uFF1F(\u76C8\u4E8F\u6570\u636E\u4FDD\u7559)`, "\u6E05\u7A7A\u786E\u8BA4");
        if (!ok) return;
        chrome.storage.local.get(["myFunds"], (res) => {
          const funds = res.myFunds || {};
          selectedCodes.forEach((code) => {
            if (funds[code]) {
              funds[code].amount = 0;
              funds[code].shares = 0;
            }
          });
          chrome.storage.local.set({ myFunds: funds }, () => {
            showToast("\u{1F9F9} \u9009\u4E2D\u6301\u4ED3\u5DF2\u6E05\u7A7A", "success");
            loadData();
          });
        });
      }
      async function batchDeleteFunds() {
        if (selectedCodes.size === 0) return;
        const ok = await showConfirm(`\u786E\u5B9A\u8981\u5220\u9664\u9009\u4E2D\u7684 ${selectedCodes.size} \u652F\u57FA\u91D1\u5417\uFF1F\u8BE5\u64CD\u4F5C\u4E0D\u53EF\u6062\u590D\uFF01`, "\u5371\u9669\u64CD\u4F5C");
        if (!ok) return;
        chrome.storage.local.get(["myFunds"], (res) => {
          const funds = res.myFunds || {};
          selectedCodes.forEach((code) => delete funds[code]);
          chrome.storage.local.set({ myFunds: funds }, () => {
            showToast("\u{1F5D1} \u9009\u4E2D\u57FA\u91D1\u5DF2\u5220\u9664", "success");
            loadData();
          });
        });
      }
      function initFabMenu() {
        const fabMain = document.getElementById("fabMain");
        const fabMenu = document.getElementById("fabMenu");
        if (!fabMain) return;
        fabMain.onclick = (e) => {
          e.stopPropagation();
          fabMain.classList.toggle("active");
          fabMenu.classList.toggle("show");
        };
        document.addEventListener("click", () => {
          fabMain.classList.remove("active");
          fabMenu.classList.remove("show");
        });
        const bind = (id, fn) => {
          const el = document.getElementById(id);
          if (el) el.onclick = () => {
            fn();
            fabMain.classList.remove("active");
            fabMenu.classList.remove("show");
          };
        };
        bind("fabSelectAll", () => {
          const filter = elements.groupFilter.value;
          const visible = currentFundsData.filter((i) => filter === "all" || i.group === filter);
          const allSelected = visible.every((i) => selectedCodes.has(i.code));
          visible.forEach((i) => allSelected ? selectedCodes.delete(i.code) : selectedCodes.add(i.code));
          renderTable();
        });
        bind("fabAdd", () => openFundEditor());
        bind("fabOCRBatch", openOCRBatchAdd);
        bind("fabBatchCalc", batchRecalculateShares);
        bind("fabBatchGroup", batchChangeGroup);
        bind("fabBatchClear", batchClearPositions);
        bind("fabBatchDel", batchDeleteFunds);
        bind("fabSettlement", () => manualSettlement());
        bind("fabRollback", () => rollbackSettlement());
        bind("fabExport", exportFundsData);
        bind("fabImport", () => document.getElementById("importFile").click());
      }
      function nextTradingDay(date) {
        const d = new Date(date);
        do {
          d.setDate(d.getDate() + 1);
        } while (d.getDay() === 0 || d.getDay() === 6);
        return d;
      }
      function formatDate(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      }
      function getConfirmDate() {
        const now = /* @__PURE__ */ new Date();
        const day = now.getDay();
        const hour = now.getHours();
        const minute = now.getMinutes();
        const isWeekend = day === 0 || day === 6;
        const isAfterCutoff = !isWeekend && (hour > 15 || hour === 15 && minute > 0);
        let base = new Date(now);
        if (isWeekend) {
          while (base.getDay() === 0 || base.getDay() === 6) {
            base.setDate(base.getDate() + 1);
          }
          return formatDate(nextTradingDay(base));
        } else if (isAfterCutoff) {
          const t1 = nextTradingDay(base);
          return formatDate(nextTradingDay(t1));
        } else {
          return formatDate(nextTradingDay(base));
        }
      }
      function updateGroupFilter() {
        const groups = ["all", ...new Set(currentFundsData.map((item) => item.group))];
        if (elements.groupFilter) {
          const currentVal = elements.groupFilter.value;
          elements.groupFilter.innerHTML = groups.map(
            (g) => `<option value="${g}" ${g === currentVal ? "selected" : ""}>${g === "all" ? "\u5168\u90E8\u663E\u793A" : g}</option>`
          ).join("");
        }
        if (elements.groupList) {
          elements.groupList.innerHTML = groups.filter((g) => g !== "all").map((g) => `<option value="${g}">`).join("");
        }
      }
      function showFormModal(config) {
        return new Promise((resolve) => {
          const { title, subTitle, fields, actionText = "\u4FDD\u5B58" } = config;
          elements.modalTitle.textContent = title;
          let html = `<div class="form-header-sub">${subTitle || ""}</div>`;
          html += '<div class="form-container">';
          fields.forEach((field) => {
            if (field.type === "hidden") {
              html += `<input type="hidden" id="modal_field_${field.id}" value="${field.value ?? ""}">`;
              return;
            }
            html += `<div class="form-group">`;
            html += `<label for="modal_field_${field.id}">${field.label}</label>`;
            const value = field.value !== void 0 && field.value !== null ? field.value : "";
            if (field.type === "number" && field.showAll) {
              html += `<div style="display: flex; align-items: center; gap: 6px;">`;
              html += `<input type="number" id="modal_field_${field.id}" 
        placeholder="${field.placeholder || ""}" 
        value="${field.value !== void 0 && field.value !== null ? field.value : ""}"
        ${field.min !== void 0 ? `min="${field.min}"` : ""} 
        ${field.step !== void 0 ? `step="${field.step}"` : ""}
        style="flex: 1;">`;
              html += `<button type="button" class="all-btn" data-target="${field.id}" data-max="${field.max}">\u5168\u90E8</button>`;
              html += `</div>`;
            } else {
              html += `<input type="${field.type || "text"}" id="modal_field_${field.id}" 
        placeholder="${field.placeholder || ""}" 
        value="${field.value !== void 0 && field.value !== null ? field.value : ""}"
        ${field.min !== void 0 ? `min="${field.min}"` : ""} 
        ${field.step !== void 0 ? `step="${field.step}"` : ""}>`;
            }
            html += `</div>`;
          });
          html += "</div>";
          elements.modalMsg.innerHTML = html;
          elements.modalInput.style.display = "none";
          _setFooter([
            { text: "\u53D6\u6D88", cls: "modal-btn-cancel", onClick: () => {
              _closeModal();
              resolve(null);
            } },
            {
              text: actionText,
              cls: "modal-btn-ok",
              onClick: () => {
                const formData = {};
                fields.forEach((field) => {
                  const el = document.getElementById(`modal_field_${field.id}`);
                  let val = el.value;
                  if (field.type === "number" || field.type === "hidden") {
                    val = parseFloat(val) || 0;
                  }
                  formData[field.id] = val;
                });
                _closeModal();
                resolve(formData);
              }
            }
          ]);
          elements.modalOverlay.classList.add("visible");
          setTimeout(() => {
            document.querySelectorAll(".all-btn").forEach((btn) => {
              btn.addEventListener("click", () => {
                const targetId = btn.dataset.target;
                const max = btn.dataset.max;
                const input = document.getElementById(`modal_field_${targetId}`);
                if (input) {
                  input.value = max;
                  input.dispatchEvent(new Event("change"));
                }
              });
            });
          }, 50);
        });
      }
      async function adjustPosition(code, type) {
        try {
          const funds = await new Promise((r) => chrome.storage.local.get(["myFunds"], (res) => r(res.myFunds || {})));
          const fundItem = funds[code];
          if (!fundItem) {
            await showAlert("\u672A\u627E\u5230\u8BE5\u6807\u7684\u6570\u636E\uFF01");
            return;
          }
          const live = await fetchLiveInfo(code);
          const defaultNav = live?.prevPrice || 1;
          const isAdd = type === "add";
          const title = isAdd ? "\u52A0\u4ED3\u8BBE\u7F6E" : "\u51CF\u4ED3\u8BBE\u7F6E";
          const confirmDate = getConfirmDate();
          const _now = /* @__PURE__ */ new Date();
          const _isWeekend = _now.getDay() === 0 || _now.getDay() === 6;
          const _isAfterCutoff = !_isWeekend && (_now.getHours() > 15 || _now.getHours() === 15 && _now.getMinutes() > 0);
          const timingHint = _isWeekend ? "\u{1F4C5} \u5468\u672B\u4E0B\u5355\uFF0C\u987A\u5EF6\u81F3\u4E0B\u4E00\u4EA4\u6613\u65E5T+1\u786E\u8BA4" : _isAfterCutoff ? "\u23F0 15:00\u540E\u4E0B\u5355\uFF0C\u6309T+2\u786E\u8BA4" : "\u2705 15:00\u524D\u4E0B\u5355\uFF0C\u6309T+1\u786E\u8BA4";
          const subTitle = `${live?.name || code} (#${code})\u3000${timingHint}`;
          let fields = [];
          if (isAdd) {
            fields = [
              { id: "amount", label: "\u4E70\u5165\u91D1\u989D (\u5143)", type: "number", placeholder: "\u8BF7\u8F93\u5165\u91D1\u989D", value: "", min: 0 },
              { id: "feeRate", label: "\u4EA4\u6613\u8D39\u7387 (%)", type: "number", placeholder: "0.15", value: "0", step: "0.01" },
              { id: "confirmDate", label: "\u786E\u8BA4\u65E5\u671F\uFF08\u53EF\u624B\u52A8\u8C03\u6574\uFF09", type: "date", value: confirmDate },
              { id: "estNav", type: "hidden", value: defaultNav }
            ];
          } else {
            const maxShares = fundItem.shares || 0;
            fields = [
              {
                id: "shares",
                label: "\u5356\u51FA\u4EFD\u989D",
                type: "number",
                placeholder: `\u6700\u591A\u53EF\u5356 ${maxShares.toFixed(2)} \u4EFD`,
                value: "",
                min: 0,
                step: "0.01",
                showAll: true,
                max: maxShares
              },
              { id: "feeRate", label: "\u4EA4\u6613\u8D39\u7387 (%)", type: "number", placeholder: "0", value: "0", step: "0.01" },
              { id: "confirmDate", label: "\u786E\u8BA4\u65E5\u671F\uFF08\u53EF\u624B\u52A8\u8C03\u6574\uFF09", type: "date", value: confirmDate }
            ];
          }
          const formModalPromise = showFormModal({
            title,
            subTitle,
            fields,
            actionText: "\u786E\u8BA4" + (isAdd ? "\u52A0\u4ED3" : "\u51CF\u4ED3")
          });
          setTimeout(() => {
            const confirmDateInput = document.getElementById("modal_field_confirmDate");
            if (!confirmDateInput) return;
            const dateGroup = confirmDateInput.closest(".form-group");
            if (!dateGroup) return;
            const switcher = document.createElement("div");
            switcher.className = "timing-switcher";
            switcher.innerHTML = `
                <span>\u4E0B\u5355\u65F6\u95F4\uFF1A</span>
                <label id="timingBefore" class="timing-btn">15:00\u524D</label>
                <label id="timingAfter"  class="timing-btn">15:00\u540E</label>
            `;
            dateGroup.parentNode.insertBefore(switcher, dateGroup);
            const btnBefore = document.getElementById("timingBefore");
            const btnAfter = document.getElementById("timingAfter");
            let useAfterCutoff = _isAfterCutoff;
            function applyStyle() {
              btnBefore.className = "timing-btn" + (!useAfterCutoff ? " active-before" : "");
              btnAfter.className = "timing-btn" + (useAfterCutoff ? " active-after" : "");
            }
            function recalcDate() {
              const d = /* @__PURE__ */ new Date();
              const isWknd = d.getDay() === 0 || d.getDay() === 6;
              let base = new Date(d);
              let result2;
              if (isWknd) {
                while (base.getDay() === 0 || base.getDay() === 6) base.setDate(base.getDate() + 1);
                result2 = formatDate(nextTradingDay(base));
              } else if (useAfterCutoff) {
                result2 = formatDate(nextTradingDay(nextTradingDay(base)));
              } else {
                result2 = formatDate(nextTradingDay(base));
              }
              confirmDateInput.value = result2;
            }
            applyStyle();
            btnBefore.addEventListener("click", () => {
              useAfterCutoff = false;
              applyStyle();
              recalcDate();
            });
            btnAfter.addEventListener("click", () => {
              useAfterCutoff = true;
              applyStyle();
              recalcDate();
            });
          }, 80);
          const result = await formModalPromise;
          if (!result) return;
          if (isAdd) {
            const { amount, feeRate, confirmDate: confirmDate2 } = result;
            if (!fundItem.pendingAdjustments) fundItem.pendingAdjustments = [];
            fundItem.pendingAdjustments.push({
              type: "add",
              amount,
              feeRate,
              targetDate: confirmDate2,
              orderNav: defaultNav,
              // 下单时净值
              orderDate: (/* @__PURE__ */ new Date()).toLocaleDateString(),
              status: "pending"
            });
          } else {
            const { shares: inputShares, feeRate, confirmDate: confirmDate2 } = result;
            if (!fundItem.pendingAdjustments) fundItem.pendingAdjustments = [];
            fundItem.pendingAdjustments.push({
              type: "remove",
              shares: inputShares,
              feeRate,
              targetDate: confirmDate2,
              orderNav: defaultNav,
              // 下单时净值
              orderDate: (/* @__PURE__ */ new Date()).toLocaleDateString(),
              status: "pending"
            });
          }
          await new Promise((r) => chrome.storage.local.set({ myFunds: funds }, r));
          showToast(`\u2705 \u64CD\u4F5C\u6210\u529F\uFF01\u5C06\u5728 ${result.confirmDate} \u786E\u8BA4`, "success");
          loadData();
        } catch (e) {
          console.error(`${type}\u4ED3\u64CD\u4F5C\u5931\u8D25:`, e);
          showAlert(`\u64CD\u4F5C\u5931\u8D25: ${e.message}`);
        }
      }
      async function openFundEditor(existingCode = null) {
        let fund = null, live = null;
        let currentNav = 1;
        if (existingCode) {
          const funds = await new Promise((r) => chrome.storage.local.get(["myFunds"], (res) => r(res.myFunds || {})));
          fund = funds[existingCode];
          live = await fetchLiveInfo(existingCode);
          currentNav = live?.prevPrice || 1;
        }
        const fields = [
          { id: "code", label: "\u8D44\u4EA7\u4EE3\u7801 (\u5FC5\u586B)", type: "text", value: existingCode || "", placeholder: "\u5982: 005827" },
          { id: "amount", label: "\u6301\u6709\u91D1\u989D (\u5143)", type: "number", value: fund?.amount || "", min: 0, step: "0.01" },
          { id: "shares", label: "\u6301\u6709\u4EFD\u989D", type: "number", value: fund?.shares || "", step: "0.0001" },
          { id: "holdProfit", label: "\u7D2F\u8BA1\u76C8\u4E8F (\u5143)", type: "number", value: fund?.holdProfit || 0 },
          { id: "yesterdayProfit", label: "\u6628\u65E5\u6536\u76CA (\u5143)", type: "number", value: fund?.yesterdayProfit || 0 },
          { id: "group", label: "\u5206\u7EC4\u540D\u79F0", type: "text", value: fund?.group || "\u9ED8\u8BA4" }
        ];
        setTimeout(() => {
          const codeInput = document.getElementById("modal_field_code");
          const amtInput = document.getElementById("modal_field_amount");
          const shareInput = document.getElementById("modal_field_shares");
          if (existingCode) {
            codeInput.disabled = true;
          } else {
            codeInput.addEventListener("blur", async () => {
              const c = codeInput.value.trim();
              if (c.length >= 5) {
                const l = await fetchLiveInfo(c);
                if (l && l.prevPrice > 0) {
                  currentNav = l.prevPrice;
                  showToast(`\u5DF2\u83B7\u53D6\u6700\u65B0\u51C0\u503C: ${currentNav}`, "info", 2e3);
                  if (amtInput.value && !shareInput.value) {
                    shareInput.value = (parseFloat(amtInput.value) / currentNav).toFixed(4);
                  }
                }
              }
            });
          }
          amtInput.addEventListener("input", () => {
            const amt = parseFloat(amtInput.value) || 0;
            if (currentNav > 0) shareInput.value = (amt / currentNav).toFixed(4);
          });
          shareInput.addEventListener("input", () => {
            const sh = parseFloat(shareInput.value) || 0;
            if (currentNav > 0) amtInput.value = (sh * currentNav).toFixed(2);
          });
        }, 100);
        const result = await showFormModal({
          title: existingCode ? "\u7F16\u8F91\u6301\u4ED3" : "\u6DFB\u52A0\u8D44\u4EA7",
          subTitle: existingCode ? `${live?.name || existingCode}` : "\u8F93\u5165\u4EE3\u7801\u540E\u70B9\u51FB\u7A7A\u767D\u5904\uFF0C\u83B7\u53D6\u51C0\u503C\u8FDB\u884C\u8054\u52A8\u8BA1\u7B97",
          fields,
          actionText: "\u4FDD\u5B58"
        });
        if (!result) return;
        const code = (existingCode || result.code).trim().toUpperCase();
        if (!code) {
          await showAlert("\u8D44\u4EA7\u4EE3\u7801\u4E0D\u80FD\u4E3A\u7A7A\uFF01");
          return;
        }
        elements.status.innerText = "\u6B63\u5728\u4FDD\u5B58...";
        if (!existingCode && !live) {
          live = await fetchLiveInfo(code);
          if (!live || live.name.includes("[\u672A\u77E5]")) {
            const ok = await showConfirm(`\u672A\u68C0\u7D22\u5230\u4EE3\u7801 ${code} \u7684\u6570\u636E\uFF0C\u662F\u5426\u5F3A\u5236\u4FDD\u5B58\uFF1F`, "\u63D0\u793A", true);
            if (!ok) {
              elements.status.innerText = "\u51C6\u5907\u5C31\u7EEA";
              return;
            }
          }
        }
        chrome.storage.local.get(["myFunds"], async (res) => {
          const funds = res.myFunds || {};
          funds[code] = {
            ...funds[code] || {},
            // 保留可能存在的历史调整数据
            amount: parseFloat(result.amount) || 0,
            shares: parseFloat(result.shares) || 0,
            holdProfit: parseFloat(result.holdProfit) || 0,
            yesterdayProfit: parseFloat(result.yesterdayProfit) || 0,
            group: result.group || "\u9ED8\u8BA4",
            savedPrevPrice: funds[code]?.savedPrevPrice || live?.prevPrice || 1,
            savedPrevDate: funds[code]?.savedPrevDate || live?.prevPriceDate || getToday()
          };
          chrome.storage.local.set({ myFunds: funds }, () => {
            showToast(`\u2705 ${code} \u4FDD\u5B58\u6210\u529F\uFF01`, "success");
            elements.status.innerText = "\u51C6\u5907\u5C31\u7EEA";
            loadData();
          });
        });
      }
      elements.addBtn.onclick = () => openFundEditor(null);
      var centerModalOverlay = null;
      function initCenterModal() {
        centerModalOverlay = document.createElement("div");
        centerModalOverlay.className = "center-modal-overlay";
        centerModalOverlay.onclick = (e) => {
          if (e.target === centerModalOverlay) {
            hideCenterModal();
          }
        };
        document.body.appendChild(centerModalOverlay);
      }
      function showCenterMenu(code) {
        if (!centerModalOverlay) initCenterModal();
        const fund = currentFundsData.find((f) => f.code === code);
        if (!fund) return;
        const html = `
        <div class="center-modal-box">
            <div class="center-modal-header">
                <span class="modal-title">\u6301\u4ED3\u64CD\u4F5C</span>
                <span class="modal-link" id="transactionLink">\u4EA4\u6613\u8BB0\u5F55 ></span>
            </div>
            <div class="center-modal-info">
                <span class="info-name">${fund.name}</span>
                <span class="info-code">#${fund.code}</span>
            </div>
            <div class="center-modal-actions">
                <div class="action-row-double">
                    <button class="btn-op add" data-action="add" data-code="${code}">+ \u52A0\u4ED3</button>
                    <button class="btn-op remove" data-action="remove" data-code="${code}">\u2212 \u51CF\u4ED3</button>
                </div>
                <button class="btn-op edit" data-action="edit" data-code="${code}">\u270F\uFE0F \u7F16\u8F91\u6301\u4ED3</button>
                <button class="btn-op calc" data-action="calc_shares" data-code="${code}">\u{1F504} \u6839\u636E\u91D1\u989D\u91CD\u7B97\u4EFD\u989D</button>
                <button class="btn-op clear" data-action="clear" data-code="${code}">\u{1F9F9} \u6E05\u7A7A\u91D1\u989D</button>
                <button class="btn-op delete" data-action="delete" data-code="${code}">\u{1F5D1} \u5F7B\u5E95\u5220\u9664\u8D44\u4EA7</button>
            </div>
        </div>
    `;
        centerModalOverlay.innerHTML = html;
        const transactionLink = document.getElementById("transactionLink");
        if (transactionLink) {
          transactionLink.addEventListener("click", () => {
            hideCenterModal();
            showPendingTransactions(code);
          });
        }
        async function showPendingTransactions(code2) {
          const funds = await new Promise((r) => chrome.storage.local.get(["myFunds"], (res) => r(res.myFunds || {})));
          const fund2 = funds[code2];
          const txList = fund2?.pendingAdjustments || [];
          if (txList.length === 0) {
            await showAlert("\u6682\u65E0\u4EA4\u6613\u8BB0\u5F55");
            return;
          }
          const renderList = () => {
            let html2 = `<div class="tx-list">`;
            txList.forEach((adj, idx) => {
              const isPending = adj.status !== "confirmed";
              const typeLabel = adj.type === "add" ? "\u52A0\u4ED3" : "\u51CF\u4ED3";
              const typeCls = adj.type === "add" ? "add" : "remove";
              const statusBadge = `<span class="tx-badge ${isPending ? "pending" : "confirmed"}">${isPending ? "\u5F85\u786E\u8BA4" : "\u5DF2\u786E\u8BA4"}</span>`;
              const amountText = adj.type === "add" ? `\u4E70\u5165 <b class="${typeCls}">\xA5${adj.amount}</b>` : `\u5356\u51FA <b class="${typeCls}">${adj.shares} \u4EFD</b>`;
              const feeText = adj.feeRate > 0 ? ` &nbsp;\u8D39\u7387${adj.feeRate}%` : "";
              let navInfo = "";
              if (adj.orderNav) navInfo += `\u4E0B\u5355\u51C0\u503C ${adj.orderNav}`;
              if (adj.confirmedPrice) navInfo += `\u3000\u786E\u8BA4\u51C0\u503C ${adj.confirmedPrice}`;
              if (adj.confirmedShares && adj.type === "add") navInfo += `\u3000\u5230\u8D26 ${adj.confirmedShares} \u4EFD`;
              let dateInfo = `\u9884\u8BA1\u786E\u8BA4\u65E5 ${adj.targetDate}`;
              if (adj.confirmedDate) dateInfo = `\u786E\u8BA4\u65E5 ${adj.confirmedDate}`;
              if (adj.orderDate) dateInfo = `\u4E0B\u5355 ${adj.orderDate} \xB7 ` + dateInfo;
              const revokeBtn = isPending ? `<button data-revoke="${idx}" class="tx-revoke-btn">\u64A4\u9500</button>` : `<span class="tx-no-revoke">\u4E0D\u53EF\u64A4\u9500</span>`;
              html2 += `
                    <div class="tx-item">
                        <div class="tx-row-main">
                            <div class="tx-row-left">
                                <span class="tx-type ${typeCls}">${typeLabel}</span>
                                ${statusBadge}
                                <span class="tx-amount">${amountText}${feeText}</span>
                            </div>
                            ${revokeBtn}
                        </div>
                        ${navInfo ? `<div class="tx-nav">${navInfo}</div>` : ""}
                        <div class="tx-date">${dateInfo}</div>
                    </div>`;
            });
            html2 += `</div>`;
            return html2;
          };
          elements.modalTitle.textContent = "\u4EA4\u6613\u8BB0\u5F55";
          elements.modalMsg.innerHTML = renderList();
          elements.modalInput.style.display = "none";
          _setFooter([
            { text: "\u5173\u95ED", cls: "modal-btn-cancel", onClick: _closeModal }
          ]);
          elements.modalOverlay.classList.add("visible");
          elements.modalMsg.addEventListener("click", async (e) => {
            const btn = e.target.closest("[data-revoke]");
            if (!btn) return;
            const idx = parseInt(btn.dataset.revoke);
            const adj = txList[idx];
            if (!adj || adj.status === "confirmed") return;
            const typeLabel = adj.type === "add" ? `\u52A0\u4ED3 \xA5${adj.amount}` : `\u51CF\u4ED3 ${adj.shares}\u4EFD`;
            const ok = await showConfirm(`\u786E\u8BA4\u64A4\u9500\uFF1A${typeLabel}\uFF08${adj.targetDate}\uFF09\uFF1F`, "\u64A4\u9500\u786E\u8BA4", true);
            if (!ok) return;
            txList.splice(idx, 1);
            await new Promise((r) => chrome.storage.local.set({ myFunds: funds }, r));
            showToast("\u5DF2\u64A4\u9500\u8BE5\u7B14\u4EA4\u6613", "success");
            if (txList.length === 0) {
              _closeModal();
              loadData();
            } else {
              elements.modalMsg.innerHTML = renderList();
            }
            loadData();
          });
        }
        centerModalOverlay.querySelectorAll(".btn-op").forEach((btn) => {
          btn.addEventListener("click", () => {
            const action = btn.dataset.action;
            const c = btn.dataset.code;
            hideCenterModal();
            if (action === "add") adjustPosition(c, "add");
            else if (action === "remove") adjustPosition(c, "remove");
            else if (action === "edit") openFundEditor(c);
            else if (action === "clear") clearPosition(c);
            else if (action === "calc_shares") forceRecalculateShares(c);
            else if (action === "delete") removeFund(c);
          });
        });
        requestAnimationFrame(() => {
          centerModalOverlay.classList.add("visible");
        });
      }
      function hideCenterModal() {
        if (centerModalOverlay) {
          centerModalOverlay.classList.remove("visible");
        }
      }
      async function forceRecalculateShares(code) {
        elements.status.innerText = "\u6B63\u5728\u91CD\u65B0\u8BA1\u7B97\u4EFD\u989D...";
        const live = await fetchLiveInfo(code);
        if (!live || live.prevPrice <= 0) {
          await showAlert(`\u65E0\u6CD5\u83B7\u53D6 ${code} \u7684\u6709\u6548\u51C0\u503C\uFF0C\u8BA1\u7B97\u5931\u8D25\u3002`);
          elements.status.innerText = "\u51C6\u5907\u5C31\u7EEA";
          return;
        }
        chrome.storage.local.get(["myFunds"], (res) => {
          const funds = res.myFunds || {};
          if (funds[code]) {
            const newShares = parseFloat((funds[code].amount / live.prevPrice).toFixed(6));
            funds[code].shares = newShares;
            chrome.storage.local.set({ myFunds: funds }, () => {
              showToast(`\u2705 \u5DF2\u6309\u7167\u51C0\u503C ${live.prevPrice} \u4FEE\u6B63\u4EFD\u989D\u4E3A: ${newShares}`, "success");
              elements.status.innerText = "\u51C6\u5907\u5C31\u7EEA";
              loadData();
            });
          }
        });
      }
      function renderTable() {
        const filter = elements.groupFilter.value;
        let displayData = currentFundsData.filter((item) => filter === "all" || item.group === filter);
        displayData.sort((a, b) => {
          const valA = a[sortField] ?? 0;
          const valB = b[sortField] ?? 0;
          return (valA - valB) * sortDirection;
        });
        document.querySelectorAll(".sortable").forEach((th) => {
          th.textContent = th.textContent.replace(/[↑↓]/g, "");
          if (th.dataset.sort === sortField) {
            th.textContent += sortDirection === 1 ? "\u2191" : "\u2193";
          }
        });
        let sumAmount = 0, sumYesterdayProfit = 0, sumTodayProfit = 0, sumTotalProfit = 0;
        const fragment = document.createDocumentFragment();
        displayData.forEach((item, index) => {
          sumAmount += item.amount || 0;
          sumYesterdayProfit += item.yesterdayProfit || 0;
          sumTodayProfit += item.todayProfit || 0;
          sumTotalProfit += item.holdProfit || 0;
          const todayProfitText = item.todayProfit === null ? "\u2014" : `${item.todayProfit >= 0 ? "+" : ""}${item.todayProfit.toFixed(2)}`;
          const tr = document.createElement("tr");
          tr.dataset.code = item.code;
          _td(tr, String(index + 1));
          _td(tr, item.code);
          const tdName = document.createElement("td");
          const nameSpan = document.createElement("span");
          nameSpan.className = "fund-name";
          nameSpan.title = item.name;
          nameSpan.textContent = item.name;
          const groupSpan = document.createElement("span");
          groupSpan.className = "group-tag";
          groupSpan.dataset.code = item.code;
          groupSpan.textContent = item.group;
          tdName.appendChild(nameSpan);
          tdName.appendChild(groupSpan);
          tr.appendChild(tdName);
          const tdAmount = document.createElement("td");
          tdAmount.className = "editable-cell";
          tdAmount.dataset.field = "amount";
          tdAmount.dataset.code = item.code;
          const amountWrapper = document.createElement("div");
          amountWrapper.className = "cell-with-icon";
          const amountText = document.createElement("span");
          amountText.textContent = item.amount.toFixed(2);
          const gearIcon1 = document.createElement("span");
          gearIcon1.className = "settings-icon";
          gearIcon1.textContent = "\u2699\uFE0F";
          gearIcon1.dataset.code = item.code;
          gearIcon1.onclick = (e) => {
            e.stopPropagation();
            showCenterMenu(item.code);
          };
          amountWrapper.appendChild(amountText);
          amountWrapper.appendChild(gearIcon1);
          tdAmount.appendChild(amountWrapper);
          tr.appendChild(tdAmount);
          const tdShares = document.createElement("td");
          tdShares.className = "col-hide";
          const sharesWrapper = document.createElement("div");
          sharesWrapper.className = "cell-with-icon";
          const sharesText = document.createElement("span");
          sharesText.className = "editable-cell";
          sharesText.dataset.field = "shares";
          sharesText.dataset.code = item.code;
          sharesText.textContent = item.shares ? item.shares.toFixed(4) : "\u2014";
          sharesWrapper.appendChild(sharesText);
          tdShares.appendChild(sharesWrapper);
          tr.appendChild(tdShares);
          const tdNav = document.createElement("td");
          tdNav.className = "col-hide";
          const todayStr2 = getToday();
          const prevNavLine = document.createElement("div");
          prevNavLine.style.cssText = "display:flex; align-items:baseline; gap:4px;";
          const navVal = document.createElement("span");
          navVal.textContent = item.prevPrice > 0 ? item.prevPrice.toFixed(4) : "\u2014";
          navVal.style.fontWeight = "500";
          prevNavLine.appendChild(navVal);
          if (item.prevPriceDate) {
            const prevDateSpan = document.createElement("span");
            prevDateSpan.style.cssText = `font-size:10px; color:${item.prevPriceDate === todayStr2 ? "#8c8c8c" : "#fa8c16"};`;
            prevDateSpan.textContent = item.prevPriceDate.slice(5);
            prevNavLine.appendChild(prevDateSpan);
          }
          tdNav.appendChild(prevNavLine);
          const liveNavLine = document.createElement("div");
          liveNavLine.style.cssText = "display:flex; align-items:baseline; gap:4px; margin-top:2px; flex-wrap:wrap;";
          const priceSpan = document.createElement("span");
          if (item.price > 0) {
            priceSpan.textContent = item.price.toFixed(4);
            priceSpan.style.cssText = "font-weight:500; color:#ffc069;";
            const liveDateSpan = document.createElement("span");
            liveDateSpan.style.cssText = "font-size:10px; color:#8c8c8c;";
            liveDateSpan.textContent = (item.priceTime || todayStr2).slice(5);
            liveNavLine.appendChild(priceSpan);
            liveNavLine.appendChild(liveDateSpan);
          } else {
            priceSpan.textContent = "\u2014";
            priceSpan.style.color = "#8c8c8c";
            liveNavLine.appendChild(priceSpan);
          }
          if (item.rate !== null && item.rate !== void 0) {
            const rateSpan = document.createElement("span");
            rateSpan.style.cssText = `font-size:11px; font-weight:bold; color:${item.rate >= 0 ? "#f5222d" : "#389e0d"};`;
            rateSpan.textContent = `${item.rate >= 0 ? "+" : ""}${item.rate.toFixed(2)}%`;
            liveNavLine.appendChild(rateSpan);
          }
          tdNav.appendChild(liveNavLine);
          tr.appendChild(tdNav);
          _tdProfit(tr, item.yesterdayProfit, item.yesterdayProfit >= 0);
          const tdToday = document.createElement("td");
          if (item.todayProfit !== null) {
            tdToday.className = item.todayProfit >= 0 ? "up" : "down";
          }
          const todayAmtLine = document.createElement("div");
          todayAmtLine.textContent = todayProfitText;
          tdToday.appendChild(todayAmtLine);
          if (item.rate !== null && item.rate !== void 0) {
            const todayRateLine = document.createElement("div");
            todayRateLine.style.cssText = "font-size:10px; margin-top:1px; opacity:0.85;";
            todayRateLine.textContent = `${item.rate >= 0 ? "+" : ""}${item.rate.toFixed(2)}%`;
            tdToday.appendChild(todayRateLine);
          }
          tr.appendChild(tdToday);
          const tdHoldProfit = document.createElement("td");
          tdHoldProfit.className = `editable-cell ${item.holdProfit >= 0 ? "up" : "down"}`;
          tdHoldProfit.dataset.field = "holdProfit";
          tdHoldProfit.dataset.code = item.code;
          tdHoldProfit.textContent = `${item.holdProfit >= 0 ? "+" : ""}${item.holdProfit.toFixed(2)}`;
          tr.appendChild(tdHoldProfit);
          const tdOp = document.createElement("td");
          tdOp.className = "col-hide";
          const btnDel = document.createElement("button");
          btnDel.className = "del-btn";
          btnDel.dataset.code = item.code;
          btnDel.title = "\u5220\u9664";
          btnDel.textContent = "\u2715";
          tdOp.appendChild(btnDel);
          tr.appendChild(tdOp);
          fragment.appendChild(tr);
        });
        elements.tableBody.innerHTML = "";
        elements.tableBody.appendChild(fragment);
        elements.totalAmount.textContent = sumAmount.toLocaleString(void 0, { minimumFractionDigits: 2 });
        elements.totalYesterdayProfit.textContent = (sumYesterdayProfit >= 0 ? "+" : "") + sumYesterdayProfit.toFixed(2);
        elements.totalYesterdayProfit.className = sumYesterdayProfit >= 0 ? "up" : "down";
        elements.totalTodayProfit.textContent = (sumTodayProfit >= 0 ? "+" : "") + sumTodayProfit.toFixed(2);
        elements.totalTodayProfit.className = sumTodayProfit >= 0 ? "up" : "down";
        elements.totalTotalProfit.textContent = (sumTotalProfit >= 0 ? "+" : "") + sumTotalProfit.toFixed(2);
        elements.totalTotalProfit.className = sumTotalProfit >= 0 ? "up" : "down";
        elements.tableBody.onclick = (e) => {
          const target = e.target;
          const code = target.dataset.code;
          if (target.classList.contains("del-btn")) {
            removeFund(code);
          } else if (target.classList.contains("group-tag")) {
            openFundEditor(code);
          }
        };
        elements.tableBody.querySelectorAll(".editable-cell").forEach((cell) => {
          cell.onblur = () => {
            const code = cell.dataset.code;
            const field = cell.dataset.field;
            const valStr = cell.textContent.trim();
            const val = parseFloat(valStr);
            if (valStr === "" || isNaN(val)) {
              showToast("\u8BF7\u8F93\u5165\u6709\u6548\u7684\u6570\u5B57", "warning");
              loadData();
              return;
            }
            chrome.storage.local.get(["myFunds"], (res) => {
              const funds = res.myFunds || {};
              if (funds[code]) {
                if (funds[code][field] === val) return;
                funds[code][field] = val;
                const localItem = currentFundsData.find((f) => f.code === code);
                if (localItem) localItem[field] = val;
                chrome.storage.local.set({ myFunds: funds }, () => {
                  showToast("\u5DF2\u4FDD\u5B58", "success", 1500);
                  renderTable();
                });
              }
            });
          };
          cell.onkeydown = (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              cell.blur();
            }
          };
        });
        elements.tableBody.querySelectorAll("tr").forEach((tr, idx) => {
          if (tr.dataset.code && selectedCodes.has(tr.dataset.code)) {
            tr.classList.add("selected-row");
          }
          tr.addEventListener("click", (e) => {
            if (e.target.closest(".settings-icon, .group-tag, .del-btn, button")) return;
            const code = tr.dataset.code;
            if (!code) return;
            if (e.shiftKey && lastClickedIndex >= 0) {
              e.preventDefault();
              const start = Math.min(lastClickedIndex, idx);
              const end = Math.max(lastClickedIndex, idx);
              elements.tableBody.querySelectorAll("tr").forEach((r, i) => {
                if (i >= start && i <= end && r.dataset.code) {
                  selectedCodes.add(r.dataset.code);
                  r.classList.add("selected-row");
                }
              });
            } else {
              if (selectedCodes.has(code)) {
                selectedCodes.delete(code);
                tr.classList.remove("selected-row");
              } else {
                selectedCodes.add(code);
                tr.classList.add("selected-row");
              }
              lastClickedIndex = idx;
            }
            updateSelectionStatus();
          });
        });
        updateSelectionStatus();
      }
      function updateSelectionStatus() {
        const count = selectedCodes.size;
        const fabMain = document.getElementById("fabMain");
        if (count > 0) {
          elements.status.innerHTML = `\u5DF2\u9009\u4E2D <b style="color:#69b1ff">${count}</b> \u9879 &nbsp;<span id="clearSelectionBtn" style="color:#ff7875;cursor:pointer;font-size:11px;border:1px solid #ff7875;border-radius:10px;padding:1px 7px;">\u2715 \u53D6\u6D88\u9009\u62E9</span>`;
          document.getElementById("clearSelectionBtn").onclick = () => {
            clearSelection();
            renderTable();
          };
          if (fabMain) fabMain.style.background = "#fa8c16";
        } else {
          elements.status.innerText = `\u6700\u540E\u66F4\u65B0: ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`;
          if (fabMain) fabMain.style.background = "";
        }
      }
      async function clearPosition(code) {
        const ok = await showConfirm(
          `\u786E\u5B9A\u8981\u6E05\u7A7A\u57FA\u91D1 [${code}] \u7684\u6301\u4ED3\u5417\uFF1F

\u6B64\u64CD\u4F5C\u5C06\u6E05\u7A7A\u6301\u4ED3\u91D1\u989D\u548C\u4EFD\u989D\uFF0C\u4F46\u4F1A\u4FDD\u7559\u8BE5\u57FA\u91D1\u7684\u201C\u7D2F\u8BA1\u6536\u76CA\u201D\u3002`,
          "\u6E05\u7A7A\u6301\u4ED3\u786E\u8BA4",
          true
        );
        if (!ok) return;
        chrome.storage.local.get(["myFunds"], (res) => {
          const funds = res.myFunds || {};
          if (funds[code]) {
            resetFundPosition(funds[code]);
            chrome.storage.local.set({ myFunds: funds }, () => {
              showToast(`\u2705 \u57FA\u91D1 ${code} \u6301\u4ED3\u5DF2\u6E05\u7A7A`, "success");
              loadData();
            });
          }
        });
      }
      if (elements.batchGroupBtn) elements.batchGroupBtn.onclick = () => batchChangeGroup();
      if (elements.batchClearBtn) elements.batchClearBtn.onclick = () => batchClearPositions();
      function _td(tr, text) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
      }
      function _tdProfit(tr, value, isUp) {
        const td = document.createElement("td");
        td.className = isUp ? "up" : "down";
        td.textContent = `${isUp ? "+" : ""}${value.toFixed(2)}`;
        tr.appendChild(td);
      }
      function resetFundPosition(fund) {
        fund.amount = 0;
        fund.shares = 0;
        fund.lastClosedAmount = 0;
        fund.group = "\u5DF2\u64A4\u56DE";
        if (fund.cost !== void 0) fund.cost = 0;
      }
      async function removeFund(code) {
        const ok = await showConfirm(`\u786E\u5B9A\u5220\u9664 ${code}\uFF1F`, "\u5220\u9664\u786E\u8BA4", true);
        if (ok) {
          chrome.storage.local.get(["myFunds"], (res) => {
            const f = res.myFunds || {};
            delete f[code];
            chrome.storage.local.set({ myFunds: f }, loadData);
          });
        }
      }
      function exportFundsData() {
        chrome.storage.local.get(["myFunds", "lastUpdateDate", "lastDayProfits"], (res) => {
          const fundsData = res.myFunds || {};
          if (Object.keys(fundsData).length === 0) {
            showToast("\u6682\u65E0\u53EF\u5BFC\u51FA\u7684\u57FA\u91D1\u6570\u636E\uFF01", "warning");
            return;
          }
          const exportData = {
            exportTime: (/* @__PURE__ */ new Date()).toLocaleString(),
            lastUpdateDate: res.lastUpdateDate || "",
            lastDayProfits: res.lastDayProfits || {},
            myFunds: fundsData
          };
          const jsonStr = JSON.stringify(exportData, null, 2);
          const blob = new Blob([jsonStr], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          const now = /* @__PURE__ */ new Date();
          const fileName = `\u57FA\u91D1\u6570\u636E_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}.json`;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }, 100);
          showToast(`\u2705 \u6570\u636E\u5BFC\u51FA\u6210\u529F\uFF01\u6587\u4EF6\u540D: ${fileName}`, "success");
        });
      }
      elements.exportBtn.onclick = exportFundsData;
      function migrateFund(fund) {
        return {
          ...fund,
          amount: parseFloat(fund.amount) || 0,
          holdProfit: parseFloat(fund.holdProfit) || 0,
          shares: parseFloat(fund.shares) || 0,
          yesterdayProfit: parseFloat(fund.yesterdayProfit) || 0,
          group: typeof fund.group === "string" ? fund.group : "\u9ED8\u8BA4",
          savedPrevPrice: fund.savedPrevPrice ? parseFloat(fund.savedPrevPrice) : void 0,
          // pendingAdjustments（交易记录）原样保留，不做转换
          pendingAdjustments: Array.isArray(fund.pendingAdjustments) ? fund.pendingAdjustments : []
        };
      }
      function importFundsData(event) {
        const fileInput = event.target;
        const file = fileInput.files[0];
        if (!file) return;
        if (file.type !== "application/json" && !file.name.endsWith(".json")) {
          showToast("\u8BF7\u9009\u62E9 JSON \u683C\u5F0F\u7684\u5BFC\u51FA\u6587\u4EF6\uFF01", "error");
          fileInput.value = "";
          return;
        }
        const reader = new FileReader();
        reader.onload = async function(e) {
          try {
            const importData = JSON.parse(e.target.result);
            if (!importData.myFunds || typeof importData.myFunds !== "object") {
              await showAlert("\u5BFC\u5165\u6587\u4EF6\u683C\u5F0F\u9519\u8BEF\uFF1A\u672A\u627E\u5230\u6709\u6548\u57FA\u91D1\u6570\u636E\uFF01");
              fileInput.value = "";
              return;
            }
            const ok = await showConfirm(
              `\u786E\u8BA4\u5BFC\u5165\u3010${importData.exportTime || "\u672A\u77E5\u65F6\u95F4"}\u3011\u7684\u57FA\u91D1\u6570\u636E\uFF1F
\u6CE8\u610F\uFF1A\u5F53\u524D\u6570\u636E\u5C06\u88AB\u8986\u76D6\uFF01`,
              "\u5BFC\u5165\u786E\u8BA4",
              true
            );
            if (!ok) {
              fileInput.value = "";
              return;
            }
            const migratedFunds = {};
            for (const [code, fund] of Object.entries(importData.myFunds)) {
              migratedFunds[code] = migrateFund(fund);
            }
            const dataToSave = { myFunds: migratedFunds };
            if (importData.lastUpdateDate) dataToSave.lastUpdateDate = importData.lastUpdateDate;
            if (importData.lastDayProfits) dataToSave.lastDayProfits = importData.lastDayProfits;
            chrome.storage.local.set(dataToSave, () => {
              showToast("\u2705 \u6570\u636E\u5BFC\u5165\u6210\u529F\uFF01", "success");
              fileInput.value = "";
              loadData();
            });
          } catch (err) {
            await showAlert(`\u5BFC\u5165\u5931\u8D25: ${err.message}`);
            fileInput.value = "";
          }
        };
        reader.readAsText(file);
      }
      elements.importBtn.onclick = () => elements.importFile.click();
      var _ocrModalEl = null;
      var _ocrItems = [];
      function _sendToTesseract(action, payload) {
        return new Promise((resolve, reject) => {
          const jobId = "job_" + Math.random().toString(36).slice(2);
          const workerId = "main_thread";
          __TesseractDispatch(
            { workerId, jobId, action, payload },
            (msg) => {
              if (msg.status === "resolve") resolve(msg.data);
              else if (msg.status === "reject") reject(new Error(msg.data));
            }
          );
        });
      }
      async function _getOCRWorker(onLog) {
        if (window._tWorker) return window._tWorker;
        const extRoot = chrome.runtime.getURL("").replace(/\/$/, "");
        if (typeof __TesseractDispatch === "undefined") {
          throw new Error("__TesseractDispatch \u672A\u5B9A\u4E49\uFF0C\u8BF7\u786E\u8BA4 popup.html \u5DF2\u52A0\u8F7D worker.min.js");
        }
        await _sendToTesseract("load", {
          options: {
            corePath: chrome.runtime.getURL("tesseract-core.wasm.js"),
            langPath: extRoot,
            logging: false
          }
        });
        await _sendToTesseract("loadLanguage", {
          langs: "chi_sim",
          options: { langPath: extRoot, dataPath: null, cachePath: null, cacheMethod: "none", gzip: false }
        });
        await _sendToTesseract("initialize", {
          langs: "chi_sim",
          options: {}
        });
        const fakeWorker = {
          recognize: async (imageData) => {
            let imgBuffer = imageData;
            if (imageData instanceof Blob || imageData instanceof File) {
              imgBuffer = new Uint8Array(await imageData.arrayBuffer());
            }
            const result = await new Promise((resolve, reject) => {
              const jobId = "job_" + Math.random().toString(36).slice(2);
              __TesseractDispatch(
                {
                  workerId: "main_thread",
                  jobId,
                  action: "recognize",
                  payload: {
                    image: imgBuffer,
                    options: {},
                    output: { text: true, blocks: false, hocr: false, tsv: false }
                  }
                },
                (msg) => {
                  if (onLog) onLog(msg);
                  if (msg.status === "resolve") resolve(msg.data);
                  else if (msg.status === "reject") reject(new Error(String(msg.data)));
                }
              );
            });
            return { data: result };
          },
          terminate: () => {
            window._tWorker = null;
          }
        };
        window._tWorker = fakeWorker;
        return fakeWorker;
      }
      async function getCodeByName(name) {
        if (!name || name.length < 2) return null;
        function nameVariants(raw) {
          const clean = raw.replace(/\s+/g, "");
          const variants = [clean];
          let core = clean.replace(/发起联接[A-E]?$/, "").replace(/联接[A-E]?$/, "").replace(/指数[A-E]?$/, "").replace(/[（(]LOF[)）]/, "").replace(/ETF/, "").replace(/[A-E]$/, "");
          if (core !== clean && core.length >= 4) variants.push(core);
          const cjk = raw.replace(/[A-Za-z\(\)\（\）\s]+/g, "").replace(/发起联接$|联接$|指数$/, "");
          if (cjk !== clean && cjk !== core && cjk.length >= 4) variants.push(cjk);
          return [...new Set(variants)];
        }
        for (const query of nameVariants(name)) {
          try {
            const url = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=10&key=${encodeURIComponent(query)}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.Datas && data.Datas.length > 0) {
              for (const item of data.Datas) {
                const code = String(item.CODE || "");
                if (/^\d{6}$/.test(code)) return code;
              }
            }
          } catch (e) {
            console.warn("[OCR] \u4EE3\u7801\u53CD\u67E5\u5931\u8D25:", query, e);
          }
        }
        return null;
      }
      function _normalizeOCR(text) {
        return text.split("\n").map((line) => {
          let prev = null, l = line;
          while (prev !== l) {
            prev = l;
            l = l.replace(/([一-龥])\s+([一-龥])/g, "$1$2");
            l = l.replace(/([一-龥])\s+([（）\(\)])/g, "$1$2");
            l = l.replace(/([（）\(\)])\s+([一-龥])/g, "$1$2");
          }
          return l;
        }).join("\n");
      }
      function _parseOCRText(text) {
        console.log("[OCR RAW TEXT]\n", text);
        const normalized = _normalizeOCR(text);
        const lines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);
        const fullText = lines.join("\n");
        const result = [];
        if (!lines.length) return result;
        const CODE_RE = /\b(\d{6})\b/;
        const MONEY_RE = () => /[+-]?\d[\d,\.]*\.\d{1,2}(?!\d)(?!\s*%)/g;
        const VAL_RE = () => /[+-]?\d[\d,\.]*\.\d{2}(?!\d)(?!\s*%)/g;
        const NAME_EXCL = /收益|金额|赎回|购买|申购|到账|手续费|销售|暂停|T\+\d|万内/;
        const ALL_LABELS = ["\u6301\u6709\u91D1\u989D", "\u6628\u65E5\u6536\u76CA", "\u6301\u6709\u6536\u76CA\u7387", "\u6301\u6709\u6536\u76CA", "\u6301\u6709\u4EFD\u989D"];
        function parseAmt(str) {
          const s = str.replace(/[^\d\.\+-]/g, "");
          if (!s) return 0;
          const parts = s.replace(/^[+-]/, "").split(".");
          if (parts.length > 2) {
            const sign = s[0] === "-" ? -1 : 1;
            return sign * parseFloat(parts.slice(0, -1).join("") + "." + parts[parts.length - 1]);
          }
          return parseFloat(s) || 0;
        }
        function isNameLine(s) {
          if (!s || s.length < 2) return false;
          if (!/[\u4e00-\u9fa5]/.test(s)) return false;
          if (NAME_EXCL.test(s)) return false;
          if (CODE_RE.test(s)) return false;
          if (/^\d+(\.\d+)?$/.test(s)) return false;
          const cjk = (s.match(/[\u4e00-\u9fa5]/g) || []).length;
          return cjk / s.replace(/\s/g, "").length >= 0.3;
        }
        function nameSimilar(a, b) {
          const ca = a.replace(/[^\u4e00-\u9fa5]/g, "");
          const cb = b.replace(/[^\u4e00-\u9fa5]/g, "");
          if (!ca || !cb || ca.length < 4 || cb.length < 4) return false;
          const [shorter, longer] = ca.length <= cb.length ? [ca, cb] : [cb, ca];
          return longer.includes(shorter);
        }
        function getLabelPosFrom(lbl, startFrom) {
          if (lbl !== "\u6301\u6709\u6536\u76CA") {
            const idx = fullText.indexOf(lbl, startFrom);
            return idx !== -1 ? idx : void 0;
          }
          let s = startFrom;
          while (true) {
            const idx = fullText.indexOf(lbl, s);
            if (idx === -1) return void 0;
            if (fullText[idx + lbl.length] !== "\u7387") return idx;
            s = idx + 1;
          }
        }
        function segAfterLabel(lbl, startFrom) {
          const pos = getLabelPosFrom(lbl, startFrom);
          if (pos === void 0) return "";
          const segStart = pos + lbl.length;
          let segEnd = segStart + 200;
          ALL_LABELS.forEach((other) => {
            if (other === lbl) return;
            const op = getLabelPosFrom(other, startFrom);
            if (op !== void 0 && op > segStart && op < segEnd) segEnd = op;
          });
          return fullText.slice(segStart, segEnd);
        }
        function maxPosNum(seg) {
          let best = 0;
          for (const m of seg.match(MONEY_RE()) || []) {
            const v = parseAmt(m);
            if (v > best) best = v;
          }
          return best;
        }
        function firstNum(seg, mustPos = false) {
          for (const m of seg.match(MONEY_RE()) || []) {
            const v = parseAmt(m);
            if (mustPos && v < 0) continue;
            return v;
          }
          return 0;
        }
        const COL_HEAD_RE = /昨日收|总金额/;
        const modeB = [];
        const seenNames = /* @__PURE__ */ new Set();
        for (let i = 0; i < lines.length; i++) {
          if (!COL_HEAD_RE.test(lines[i])) continue;
          const hasYesterday = /昨日收/.test(lines[i]);
          let dataLine = "";
          for (let j = i + 1; j <= Math.min(i + 3, lines.length - 1); j++) {
            const ms = lines[j].match(VAL_RE());
            if (ms && ms.length >= 2) {
              dataLine = lines[j];
              break;
            }
          }
          if (!dataLine) continue;
          const nums = (dataLine.match(VAL_RE()) || []).map(parseAmt);
          let yp = 0, hp = 0, amt = 0;
          if (hasYesterday && nums.length >= 3) {
            [yp, hp, amt] = [nums[0], nums[1], nums[2]];
          } else if (nums.length >= 3) {
            [yp, hp, amt] = [nums[0], nums[1], nums[2]];
          } else if (nums.length === 2) {
            [hp, amt] = [nums[0], nums[1]];
          } else if (nums.length === 1) {
            amt = nums[0];
          }
          const posNums = nums.filter((v) => v > 0);
          if (posNums.length && Math.max(...posNums) > amt) amt = Math.max(...posNums);
          let fundName = "";
          for (let k = i - 1; k >= Math.max(0, i - 6); k--) {
            if (isNameLine(lines[k])) {
              fundName = lines[k];
              break;
            }
          }
          if (!fundName || seenNames.has(fundName)) continue;
          seenNames.add(fundName);
          modeB.push({
            code: "",
            name: fundName,
            amount: amt,
            holdProfit: hp,
            yesterdayProfit: yp,
            shares: 0,
            group: "\u9ED8\u8BA4",
            selected: true,
            _needLookup: true,
            _claimed: false
          });
        }
        const seenCodes = /* @__PURE__ */ new Set();
        for (let i = 0; i < lines.length; i++) {
          const codeMatch = lines[i].match(CODE_RE);
          if (!codeMatch) continue;
          const code = codeMatch[1];
          if (seenCodes.has(code)) continue;
          seenCodes.add(code);
          let fundName = "";
          for (let k = i - 1; k >= Math.max(0, i - 4); k--) {
            if (/[\u4e00-\u9fa5]/.test(lines[k])) {
              fundName = lines[k];
              break;
            }
          }
          const codePos = fullText.indexOf(code);
          const startFrom = Math.max(0, codePos - 10);
          let amount = maxPosNum(segAfterLabel("\u6301\u6709\u91D1\u989D", startFrom));
          let yesterday = firstNum(segAfterLabel("\u6628\u65E5\u6536\u76CA", startFrom));
          let hold = firstNum(segAfterLabel("\u6301\u6709\u6536\u76CA", startFrom));
          if (!amount) {
            const RATE_RE = /(\d+\.?\d*)\s*%/g;
            const linesAfterCode = lines.slice(i);
            for (let li = 0; li < linesAfterCode.length; li++) {
              const lbl = linesAfterCode[li];
              if (!/昨日收益|持有收益/.test(lbl)) continue;
              for (let vi = li + 1; vi <= Math.min(li + 3, linesAfterCode.length - 1); vi++) {
                const valLine = linesAfterCode[vi];
                const nums = (valLine.match(MONEY_RE()) || []).map((m) => parseAmt(m));
                const rates = [];
                let rm;
                RATE_RE.lastIndex = 0;
                while ((rm = RATE_RE.exec(valLine)) !== null) rates.push(parseFloat(rm[1]));
                if (!nums.length) continue;
                if (!yesterday && nums[0] !== void 0) yesterday = nums[0];
                if (!hold && nums[1] !== void 0) hold = nums[1];
                if (rates.length && Math.abs(rates[0]) > 0.01 && hold !== 0) {
                  const rateDec = rates[0] / 100;
                  amount = Math.round((hold / rateDec + hold) * 100) / 100;
                }
                break;
              }
              if (amount) break;
            }
          }
          for (const b of modeB) {
            if (nameSimilar(fundName, b.name)) {
              b._claimed = true;
              if (!amount && b.amount) {
                amount = b.amount;
                if (!hold) hold = b.holdProfit;
                if (!yesterday) yesterday = b.yesterdayProfit;
              }
            }
          }
          result.push({
            code,
            name: fundName,
            amount,
            holdProfit: hold,
            yesterdayProfit: yesterday,
            shares: 0,
            group: "\u9ED8\u8BA4",
            selected: true,
            _needLookup: false
          });
        }
        for (const b of modeB) {
          if (!b._claimed) {
            delete b._claimed;
            result.push(b);
          }
        }
        return result;
      }
      function _renderOCRTable() {
        const container = _ocrModalEl.querySelector("#_ocrResults");
        if (!_ocrItems.length) {
          container.innerHTML = '<p style="text-align:center;color:#6a8aaa;font-size:12px;padding:20px;">\u672A\u8BC6\u522B\u5230\u6709\u6548\u8D44\u4EA7\u4FE1\u606F\uFF0C\u8BF7\u786E\u8BA4\u56FE\u7247\u662F\u5426\u6E05\u6670</p>';
          return;
        }
        const C = "padding:4px 3px;";
        const I = "background:#0d1b2e;border:1px solid #2a4a72;border-radius:4px;color:#c8d8f0;padding:2px 4px;font-size:11px;width:100%;box-sizing:border-box;";
        let html = `
        <table style="width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed;">
            <colgroup>
                <col style="width:24px">
                <col style="width:68px">
                <col style="width:64px">
                <col style="width:80px">
                <col style="width:74px">
                <col style="width:74px">
                <col style="width:48px">
            </colgroup>
            <thead><tr style="color:#4a6a90;border-bottom:1px solid #1e3a5f;white-space:nowrap;">
                <th style="${C}"><input type="checkbox" id="_ocrChkAll" checked></th>
                <th style="${C}">\u4EE3\u7801</th>
                <th style="${C}">\u57FA\u91D1\u540D\u79F0</th>
                <th style="${C}">\u6301\u4ED3\u91D1\u989D(\u5143)</th>
                <th style="${C}">\u6301\u6709\u6536\u76CA(\u5143)</th>
                <th style="${C}">\u6628\u65E5\u6536\u76CA(\u5143)</th>
                <th style="${C}">\u5206\u7EC4</th>
            </tr></thead>
            <tbody>`;
        _ocrItems.forEach((a, idx) => {
          const codeStyle = a.code ? "" : "border-color:#f5222d;";
          const hpVal = a.holdProfit !== void 0 && a.holdProfit !== 0 ? a.holdProfit : "";
          const ypVal = a.yesterdayProfit !== void 0 && a.yesterdayProfit !== 0 ? a.yesterdayProfit : "";
          const nameStr = (a.name || "").replace(/"/g, "&quot;");
          html += `<tr style="border-bottom:1px solid #141f30;">
            <td style="${C}"><input type="checkbox" class="_oc" data-i="${idx}" ${a.selected ? "checked" : ""}></td>
            <td style="${C}"><input type="text" style="${I}${codeStyle}" value="${a.code || ""}" class="_oe" data-i="${idx}" data-f="code" placeholder="\u5F85\u586B"></td>
            <td style="${C}" title="${nameStr}"><span style="color:#8aacce;font-size:10px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${a.name || "\u2014"}</span></td>
            <td style="${C}"><input type="number" style="${I}" value="${a.amount || ""}" class="_oe" data-i="${idx}" data-f="amount" step="0.01" placeholder="0"></td>
            <td style="${C}"><input type="number" style="${I}" value="${hpVal}" class="_oe" data-i="${idx}" data-f="holdProfit" step="0.01" placeholder="0"></td>
            <td style="${C}"><input type="number" style="${I}" value="${ypVal}" class="_oe" data-i="${idx}" data-f="yesterdayProfit" step="0.01" placeholder="0"></td>
            <td style="${C}"><input type="text" style="${I}" value="${a.group}" class="_oe" data-i="${idx}" data-f="group"></td>
        </tr>`;
        });
        html += "</tbody></table>";
        container.innerHTML = html;
        container.querySelector("#_ocrChkAll").onchange = function() {
          _ocrItems.forEach((a) => a.selected = this.checked);
          container.querySelectorAll("._oc").forEach((cb) => cb.checked = this.checked);
        };
        container.querySelectorAll("._oc").forEach((cb) => {
          cb.onchange = () => {
            _ocrItems[+cb.dataset.i].selected = cb.checked;
          };
        });
        container.querySelectorAll("._oe").forEach((inp) => {
          inp.oninput = () => {
            const idx = +inp.dataset.i, f = inp.dataset.f;
            const numFields = ["amount", "holdProfit", "yesterdayProfit", "shares"];
            _ocrItems[idx][f] = numFields.includes(f) ? parseFloat(inp.value) || 0 : inp.value;
          };
        });
      }
      function openOCRBatchAdd() {
        if (_ocrModalEl) return;
        const overlay = document.createElement("div");
        overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);z-index:20000;display:flex;align-items:center;justify-content:center;";
        overlay.innerHTML = `
        <div style="background:#111f35;border:1px solid #2a4a72;border-radius:12px;width:510px;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 16px 48px rgba(0,0,0,.6);overflow:hidden;">
            <!-- \u6807\u9898\u680F -->
            <div style="padding:13px 18px;border-bottom:1px solid #1e3a5f;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
                <span style="font-size:14px;font-weight:700;color:#e8f0ff;">\u{1F4F7} \u56FE\u7247\u8BC6\u522B\u6279\u91CF\u6DFB\u52A0\u8D44\u4EA7</span>
                <span id="_ocrClose" style="cursor:pointer;color:#6a8aaa;font-size:20px;line-height:1;padding:0 2px;">\u2715</span>
            </div>
            <!-- \u4E0A\u4F20\u533A -->
            <div id="_ocrDrop" style="margin:14px;border:2px dashed #2a4a72;border-radius:8px;padding:22px 16px;text-align:center;cursor:pointer;color:#6a8aaa;font-size:13px;flex-shrink:0;transition:border-color .15s,background .15s;">
                <div style="font-size:30px;margin-bottom:8px;">\u{1F5BC}\uFE0F</div>
                <div style="margin-bottom:4px;">\u62D6\u62FD\u622A\u56FE\u5230\u6B64\u5904\uFF0C\u6216\u70B9\u51FB\u9009\u62E9\u56FE\u7247</div>
                <div style="font-size:11px;color:#4a6a90;margin-bottom:12px;">\u652F\u6301 JPG / PNG\uFF0C\u53EF\u4E00\u6B21\u9009\u591A\u5F20</div>
                <button id="_ocrPickBtn" style="background:#1a2f50;border:1px solid #2a4a72;color:#8aacce;border-radius:6px;padding:6px 18px;font-size:12px;cursor:pointer;">\u{1F4C2} \u9009\u62E9\u56FE\u7247</button>
            </div>
            <input type="file" id="_ocrFile" accept="image/*" multiple style="display:none;">
            <!-- \u8FDB\u5EA6\u63D0\u793A -->
            <div id="_ocrProg" style="display:none;padding:0 16px 10px;font-size:12px;color:#6a8aaa;flex-shrink:0;"></div>
            <!-- \u7ED3\u679C\u533A\uFF08\u53EF\u6EDA\u52A8\uFF09 -->
            <div id="_ocrResults" style="flex:1;overflow-y:auto;padding:0 14px 4px;min-height:0;"></div>
            <!-- \u5E95\u90E8\u64CD\u4F5C\u680F -->
            <div id="_ocrFoot" style="display:none;padding:10px 16px;border-top:1px solid #1e3a5f;justify-content:space-between;align-items:center;flex-shrink:0;">
                <span id="_ocrReupload" style="font-size:12px;color:#69b1ff;cursor:pointer;user-select:none;">\u21A9 \u91CD\u65B0\u4E0A\u4F20</span>
                <button id="_ocrSave" style="background:#1890ff;color:#fff;border:none;border-radius:6px;padding:7px 22px;font-size:13px;font-weight:600;cursor:pointer;">\u6279\u91CF\u4FDD\u5B58\u9009\u4E2D</button>
            </div>
        </div>`;
        document.body.appendChild(overlay);
        _ocrModalEl = overlay;
        const close = () => {
          overlay.remove();
          _ocrModalEl = null;
          _ocrItems = [];
        };
        overlay.querySelector("#_ocrClose").onclick = close;
        const fileInput = overlay.querySelector("#_ocrFile");
        const drop = overlay.querySelector("#_ocrDrop");
        overlay.querySelector("#_ocrPickBtn").onclick = (e) => {
          e.stopPropagation();
          fileInput.click();
        };
        drop.onclick = () => fileInput.click();
        drop.ondragover = (e) => {
          e.preventDefault();
          drop.style.borderColor = "#1890ff";
          drop.style.background = "rgba(24,144,255,0.05)";
        };
        drop.ondragleave = () => {
          drop.style.borderColor = "#2a4a72";
          drop.style.background = "";
        };
        drop.ondrop = (e) => {
          e.preventDefault();
          drop.style.borderColor = "#2a4a72";
          drop.style.background = "";
          _runOCR(Array.from(e.dataTransfer.files));
        };
        fileInput.onchange = () => _runOCR(Array.from(fileInput.files));
        overlay.querySelector("#_ocrSave").onclick = _saveOCRItems;
        overlay.querySelector("#_ocrReupload").onclick = () => {
          drop.style.display = "";
          overlay.querySelector("#_ocrProg").style.display = "none";
          overlay.querySelector("#_ocrResults").innerHTML = "";
          overlay.querySelector("#_ocrFoot").style.display = "none";
          _ocrItems = [];
          fileInput.value = "";
        };
      }
      async function _runOCR(files) {
        const imgs = files.filter((f) => f.type.startsWith("image/"));
        if (!imgs.length) {
          showToast("\u8BF7\u9009\u62E9\u56FE\u7247\u6587\u4EF6", "warning");
          return;
        }
        const drop = _ocrModalEl.querySelector("#_ocrDrop");
        const prog = _ocrModalEl.querySelector("#_ocrProg");
        const foot = _ocrModalEl.querySelector("#_ocrFoot");
        drop.style.display = "none";
        prog.style.display = "block";
        prog.textContent = "\u23F3 \u6B63\u5728\u521D\u59CB\u5316OCR\u5F15\u64CE\uFF0C\u9996\u6B21\u52A0\u8F7D\u9700\u8981\u51E0\u79D2...";
        _ocrItems = [];
        try {
          const worker = await _getOCRWorker((m) => {
            if (m.status === "recognizing text" && _ocrModalEl) {
              prog.textContent = `\u23F3 \u8BC6\u522B\u4E2D... ${Math.round((m.progress || 0) * 100)}%`;
            }
          });
          for (let i = 0; i < imgs.length; i++) {
            if (!_ocrModalEl) return;
            prog.textContent = `\u23F3 \u6B63\u5728\u8BC6\u522B\u7B2C ${i + 1} / ${imgs.length} \u5F20\u56FE\u7247...`;
            const { data: { text } } = await worker.recognize(imgs[i]);
            _ocrItems.push(..._parseOCRText(text));
          }
          const seenCodes = /* @__PURE__ */ new Set();
          const seenNames = /* @__PURE__ */ new Set();
          _ocrItems = _ocrItems.filter((a) => {
            if (a.code) {
              if (seenCodes.has(a.code)) return false;
              seenCodes.add(a.code);
              return true;
            }
            if (a.name) {
              if (seenNames.has(a.name)) return false;
              seenNames.add(a.name);
              return true;
            }
            return false;
          });
          const needLookup = _ocrItems.filter((a) => a._needLookup && a.name);
          if (needLookup.length > 0) {
            prog.textContent = `\u23F3 \u8BC6\u522B\u5B8C\u6210\uFF0C\u6B63\u5728\u53CD\u67E5\u57FA\u91D1\u4EE3\u7801\uFF08${needLookup.length} \u6761\uFF09...`;
            await Promise.all(needLookup.map(async (a) => {
              const code = await getCodeByName(a.name);
              a.code = code || "";
              a._needLookup = false;
            }));
          }
          if (_ocrItems.length) {
            const found = _ocrItems.filter((a) => a.code).length;
            const missing = _ocrItems.length - found;
            let msg = `\u2705 \u8BC6\u522B\u5B8C\u6210\uFF0C\u5171 ${_ocrItems.length} \u6761\uFF08${found} \u4E2A\u627E\u5230\u4EE3\u7801`;
            if (missing > 0) msg += `\uFF0C${missing} \u4E2A\u4EE3\u7801\u5F85\u624B\u586B`;
            prog.textContent = msg + `\uFF09\uFF0C\u8BF7\u6838\u5BF9\u540E\u6279\u91CF\u4FDD\u5B58`;
          } else {
            prog.textContent = "\u26A0\uFE0F \u672A\u8BC6\u522B\u5230\u6709\u6548\u57FA\u91D1\u4FE1\u606F\uFF0C\u8BF7\u68C0\u67E5\u56FE\u7247\u662F\u5426\u6E05\u6670\u6216\u5C1D\u8BD5\u88C1\u526A\u540E\u4E0A\u4F20";
          }
          _renderOCRTable();
          foot.style.display = "flex";
        } catch (e) {
          prog.textContent = "\u274C \u8BC6\u522B\u5931\u8D25\uFF1A" + e.message;
          console.error("[OCR]", e);
        }
      }
      async function _saveOCRItems() {
        const toSave = _ocrItems.filter((a) => a.selected && String(a.code || "").trim());
        if (!toSave.length) {
          showToast("\u8BF7\u81F3\u5C11\u52FE\u9009\u4E00\u4E2A\u6709\u6548\u4EE3\u7801\u7684\u8D44\u4EA7", "warning");
          return;
        }
        const btn = _ocrModalEl.querySelector("#_ocrSave");
        btn.disabled = true;
        btn.textContent = "\u4FDD\u5B58\u4E2D...";
        try {
          const funds = await new Promise((r) => chrome.storage.local.get(["myFunds"], (res) => r(res.myFunds || {})));
          for (const a of toSave) {
            const code = String(a.code).trim().toUpperCase();
            if (!code) continue;
            const existing = funds[code] || {};
            funds[code] = {
              ...existing,
              name: a.name || existing.name || "",
              amount: a.amount ?? 0,
              holdProfit: a.holdProfit ?? 0,
              // 持有收益（累计）
              yesterdayProfit: a.yesterdayProfit ?? 0,
              // 昨日收益
              group: a.group || "\u9ED8\u8BA4",
              // 净值相关：优先保留已有记录，若无则用默认值
              savedPrevPrice: existing.savedPrevPrice || 1,
              savedPrevDate: existing.savedPrevDate || getToday()
            };
            if (a.shares && a.shares > 0) {
              funds[code].shares = a.shares;
            }
          }
          await new Promise((r) => chrome.storage.local.set({ myFunds: funds }, r));
          showToast(`\u2705 \u6210\u529F\u4FDD\u5B58 ${toSave.length} \u4E2A\u8D44\u4EA7\uFF01`, "success");
          _ocrModalEl.remove();
          _ocrModalEl = null;
          _ocrItems = [];
          loadData();
        } catch (e) {
          btn.disabled = false;
          btn.textContent = "\u6279\u91CF\u4FDD\u5B58\u9009\u4E2D";
          showToast("\u4FDD\u5B58\u5931\u8D25\uFF1A" + e.message, "error");
        }
      }
    }
  });
  require_popup();
})();
