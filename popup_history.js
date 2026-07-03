// ==================== 历史数据域：IndexedDB / 历史净值同步 ====================

/**
 * HistoryDB 辅助对象 (基于 IndexedDB 持久化基金历史数据)
 * 用于存储基金的单位净值、累计净值、涨跌幅等“硬数据”，减少对 API 的依赖。
 */
const HistoryDB = {
    dbName: 'FundHelperDB',
    dbVersion: 3,
    storeName: 'fundHistory',
    orderStore: 'tradeOrders',
    stateStore: 'fundDailyState',
    db: null,

    init() {
        if (this.db) return Promise.resolve(this.db);
        if (this._initPromise) return this._initPromise;

        this._initPromise = new Promise((resolve, reject) => {
            try {
                const request = indexedDB.open(this.dbName, this.dbVersion);
                request.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(this.storeName)) {
                        const store = db.createObjectStore(this.storeName, { keyPath: ['code', 'date'] });
                        store.createIndex('code', 'code', { unique: false });
                    }
                    if (!db.objectStoreNames.contains(this.orderStore)) {
                        const store = db.createObjectStore(this.orderStore, { keyPath: 'id', autoIncrement: true });
                        store.createIndex('code', 'code', { unique: false });
                        store.createIndex('status', 'status', { unique: false });
                        store.createIndex('codeDate', ['code', 'date'], { unique: false });
                    }
                    if (!db.objectStoreNames.contains(this.stateStore)) {
                        const store = db.createObjectStore(this.stateStore, { keyPath: ['code', 'date'] });
                        store.createIndex('code', 'code', { unique: false });
                        store.createIndex('date', 'date', { unique: false });
                    }

                    if (e.oldVersion < 3 && db.objectStoreNames.contains('tradeHistory') && db.objectStoreNames.contains(this.orderStore)) {
                        const transaction = e.target.transaction;
                        let oldStore = null;
                        let newStore = null;
                        try {
                            oldStore = transaction.objectStore('tradeHistory');
                            newStore = transaction.objectStore(this.orderStore);
                        } catch (err) {
                            console.warn('[HistoryDB] 跳过旧交易流水迁移:', err);
                        }

                        if (oldStore && newStore) {
                            oldStore.openCursor().onsuccess = (event) => {
                                const cursor = event.target.result;
                                if (cursor) {
                                    const oldData = cursor.value;
                                    newStore.add({
                                        ...oldData,
                                        status: oldData.status || 'confirmed',
                                        createTime: Date.now()
                                    });
                                    cursor.continue();
                                }
                            };
                        }
                    }
                };
                request.onsuccess = (e) => {
                    this.db = e.target.result;
                    resolve(this.db);
                };
                request.onerror = (e) => {
                    this._initPromise = null;
                    console.error('[HistoryDB] 初始化失败:', e.target.error);
                    reject(e.target.error);
                };
            } catch (err) {
                this._initPromise = null;
                console.error('[HistoryDB] 浏览器不支持 IndexedDB:', err);
                reject(err);
            }
        });
        return this._initPromise;
    },

    async put(item) {
        if (!item.code || !item.date) return;
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readwrite');
            const store = tx.objectStore(this.storeName);
            const request = store.put(item);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async batchPut(items) {
        if (!Array.isArray(items) || items.length === 0) return;
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readwrite');
            const store = tx.objectStore(this.storeName);
            items.forEach(item => {
                if (item.code && item.date) store.put(item);
            });
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    },

    async get(code, date) {
        const db = await this.init();
        return new Promise((resolve) => {
            const tx = db.transaction(this.storeName, 'readonly');
            const store = tx.objectStore(this.storeName);
            const request = store.get([code, date]);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
        });
    },

    async getLatest(code) {
        const db = await this.init();
        return new Promise((resolve) => {
            const tx = db.transaction(this.storeName, 'readonly');
            const store = tx.objectStore(this.storeName);
            const index = store.index('code');
            const request = index.openCursor(IDBKeyRange.only(code), 'prev');
            request.onsuccess = (e) => resolve(e.target.result ? e.target.result.value : null);
            request.onerror = () => resolve(null);
        });
    },

    async getRange(code, startDate, endDate) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readonly');
            const store = tx.objectStore(this.storeName);
            const index = store.index('code');
            const range = IDBKeyRange.only(code);
            const request = index.openCursor(range);
            const results = [];
            request.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    const val = cursor.value;
                    if ((!startDate || val.date >= startDate) && (!endDate || val.date <= endDate)) {
                        results.push(val);
                    }
                    cursor.continue();
                } else {
                    resolve(results.sort((a, b) => a.date.localeCompare(b.date)));
                }
            };
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async addOrder(order) {
        const db = await this.init();
        const normalized = normalizeTradeRecord(order, { source: 'order' });
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.orderStore, 'readwrite');
            const store = tx.objectStore(this.orderStore);
            const request = store.add({ ...normalized, createTime: Date.now() });
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async updateOrderStatus(orderId, status, confirmDate = '') {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.orderStore, 'readwrite');
            const store = tx.objectStore(this.orderStore);
            const getReq = store.get(orderId);
            getReq.onsuccess = () => {
                const data = getReq.result;
                if (data) {
                    data.status = status;
                    if (confirmDate) data.confirmedDate = normalizePerfDate(confirmDate);
                    store.put(normalizeTradeRecord(data, { source: 'order' }));
                }
            };
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    },

    async updateOrder(orderId, patch = {}) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.orderStore, 'readwrite');
            const store = tx.objectStore(this.orderStore);
            const getReq = store.get(orderId);
            let resolved = false;
            getReq.onsuccess = () => {
                const data = getReq.result;
                if (data) {
                    const request = store.put(normalizeTradeRecord({ ...data, ...patch }, { source: 'order' }));
                    request.onsuccess = () => {
                        if (!resolved) {
                            resolved = true;
                            resolve({ action: 'updated', id: orderId });
                        }
                    };
                    request.onerror = (e) => {
                        if (!resolved) {
                            resolved = true;
                            reject(e.target.error);
                        }
                    };
                    return;
                }
                const payload = normalizeTradeRecord({ ...patch }, { source: 'order' });
                delete payload.id;
                const request = store.add({
                    ...payload,
                    createTime: payload.createTime || Date.now()
                });
                request.onsuccess = () => {
                    if (!resolved) {
                        resolved = true;
                        resolve({ action: 'inserted', id: request.result });
                    }
                };
                request.onerror = (e) => {
                    if (!resolved) {
                        resolved = true;
                        reject(e.target.error);
                    }
                };
            };
            tx.oncomplete = () => {
                if (!resolved) {
                    resolved = true;
                    resolve({ action: 'noop', id: orderId || null });
                }
            };
            tx.onerror = (e) => {
                if (!resolved) {
                    resolved = true;
                    reject(e.target.error);
                }
            };
        });
    },

    async getPendingOrders(code = null) {
        const db = await this.init();
        return new Promise((resolve) => {
            const tx = db.transaction(this.orderStore, 'readonly');
            const store = tx.objectStore(this.orderStore);
            const index = store.index('status');
            const request = index.getAll(IDBKeyRange.only('pending'));
            request.onsuccess = () => {
                let orders = normalizeTradeRecordList(request.result || [], { source: 'order' });
                if (code) orders = orders.filter(o => o.code === code);
                resolve(orders.sort((a, b) => (a.effectiveDate || a.date || '').localeCompare(b.effectiveDate || b.date || '')));
            };
        });
    },

    async getOrders(code) {
        const db = await this.init();
        return new Promise((resolve) => {
            const tx = db.transaction(this.orderStore, 'readonly');
            const store = tx.objectStore(this.orderStore);
            const index = store.index('code');
            const request = index.getAll(IDBKeyRange.only(code));
            request.onsuccess = () => {
                const orders = normalizeTradeRecordList(request.result || [], { source: 'order' });
                resolve(orders.sort((a, b) => (a.effectiveDate || a.date || '').localeCompare(b.effectiveDate || b.date || '')));
            };
            request.onerror = () => resolve([]);
        });
    },

    async replaceOrders(orders = []) {
        const db = await this.init();
        const normalizedOrders = normalizeTradeRecordList(orders, { source: 'order' });
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.orderStore, 'readwrite');
            const store = tx.objectStore(this.orderStore);
            const inserted = [];

            store.clear();

            normalizedOrders.forEach(order => {
                const payload = { ...order };
                delete payload.id;
                delete payload.orderId;
                const request = store.add({
                    ...payload,
                    createTime: payload.createTime || Date.now()
                });
                request.onsuccess = () => inserted.push({ ...payload, id: request.result });
            });

            tx.oncomplete = () => resolve(inserted);
            tx.onerror = (e) => reject(e.target.error);
        });
    },

    async replaceStateRecords(states = []) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.stateStore, 'readwrite');
            const store = tx.objectStore(this.stateStore);
            store.clear();

            safeArray(states, []).forEach(state => {
                if (state?.code && state?.date) {
                    store.put(state);
                }
            });

            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    },

    async deleteOrder(orderId) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.orderStore, 'readwrite');
            const store = tx.objectStore(this.orderStore);
            const request = store.delete(orderId);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async deleteOrdersByCode(code) {
        if (!code) return;
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.orderStore, 'readwrite');
            const store = tx.objectStore(this.orderStore);
            const index = store.index('code');
            const request = index.openCursor(IDBKeyRange.only(code));
            request.onsuccess = (e) => {
                const cursor = e.target.result;
                if (!cursor) return;
                cursor.delete();
                cursor.continue();
            };
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    },

    async putDailyState(state) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.stateStore, 'readwrite');
            const store = tx.objectStore(this.stateStore);
            const request = store.put(state);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async getDailyState(code, date) {
        const db = await this.init();
        return new Promise((resolve) => {
            const tx = db.transaction(this.stateStore, 'readonly');
            const store = tx.objectStore(this.stateStore);
            const request = store.get([code, date]);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
        });
    },

    async deleteStateRecordsByCode(code) {
        if (!code) return;
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.stateStore, 'readwrite');
            const store = tx.objectStore(this.stateStore);
            const index = store.index('code');
            const request = index.openCursor(IDBKeyRange.only(code));
            request.onsuccess = (e) => {
                const cursor = e.target.result;
                if (!cursor) return;
                cursor.delete();
                cursor.continue();
            };
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    },

    async getAllExportData() {
        const db = await this.init();
        const orders = await new Promise(r => {
            const tx = db.transaction(this.orderStore, 'readonly');
            tx.objectStore(this.orderStore).getAll().onsuccess = (e) => r(normalizeTradeRecordList(e.target.result || [], { source: 'order' }));
        });
        const states = await new Promise(r => {
            const tx = db.transaction(this.stateStore, 'readonly');
            tx.objectStore(this.stateStore).getAll().onsuccess = (e) => r(e.target.result);
        });
        return { orders, states };
    },

    async clearAllData() {
        const db = await this.init();
        await new Promise((resolve) => {
            const tx = db.transaction([this.storeName, this.orderStore, this.stateStore], 'readwrite');
            tx.objectStore(this.storeName).clear();
            tx.objectStore(this.orderStore).clear();
            tx.objectStore(this.stateStore).clear();
            tx.oncomplete = () => resolve();
        });
    },

    async clearUserDataOnly() {
        const db = await this.init();
        await new Promise((resolve) => {
            const tx = db.transaction([this.orderStore, this.stateStore], 'readwrite');
            tx.objectStore(this.orderStore).clear();
            tx.objectStore(this.stateStore).clear();
            tx.oncomplete = () => resolve();
        });
    }
};

async function syncFundHistory(code, force = false) {
    try {
        let forceSync = force;
        const syncedFlags = await storageHelper.get('fullHistorySyncedFlags', {});

        if (!forceSync) {
            if (!syncedFlags[code]) {
                forceSync = true;
            } else {
                const existingData = await HistoryDB.getRange(code, '2000-01-01', getToday());
                if (existingData.length < 10) {
                    forceSync = true;
                } else {
                    for (let i = 1; i < existingData.length; i++) {
                        const prevDate = new Date(existingData[i - 1].date);
                        const currDate = new Date(existingData[i].date);
                        const diffDays = Math.ceil(Math.abs(currDate - prevDate) / (1000 * 60 * 60 * 24));
                        if (diffDays > 12) {
                            forceSync = true;
                            break;
                        }
                    }
                }
            }
        }

        const latest = forceSync ? null : await HistoryDB.getLatest(code);
        const today = getToday();
        const yesterday = formatDate(new Date(Date.now() - CONSTANTS.DAY_MS));

        if (latest && latest.date >= yesterday && !forceSync) {
            return;
        }

        const startStr = (latest && !forceSync) ? latest.date : '2000-01-01';
        const data = await fetchFundNetValues(code, startStr, today, 200, { preferFullHistory: true });

        if (Array.isArray(data) && data.length > 0) {
            await HistoryDB.batchPut(data.map(item => ({
                code,
                date: item.date,
                price: item.price,
                acPrice: item.acPrice,
                rate: item.dailyRate,
                dividend: item.dividend || ''
            })));

            syncedFlags[code] = true;
            await storageHelper.set('fullHistorySyncedFlags', syncedFlags);
        }
    } catch (err) {
        console.warn(`[HistoryDB] ${code} 同步失败:`, err);
    }
}

async function checkAndFillHistoryGaps(funds) {
    const codes = Object.keys(funds || {});
    if (codes.length === 0) return;

    const oldStatus = elements.statusText.innerText;

    let count = 0;
    for (const code of codes) {
        if (/^\d{6}$/.test(code)) {
            await syncFundHistory(code);
            await new Promise(r => setTimeout(r, 600));
        }
        count++;
        if (count % 3 === 0) {
            elements.statusText.innerText = `同步历史数据 (${count}/${codes.length})...`;
        }
    }

    setTimeout(() => {
        if (elements.statusText.innerText.includes('同步历史数据')) {
            elements.statusText.innerText = oldStatus;
        }
    }, 2000);
}
