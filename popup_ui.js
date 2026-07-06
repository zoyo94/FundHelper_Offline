// ==================== Toast / Modal 工具函数 ====================

// ==================== 通知中心 ====================
const notificationCenter = {
    notifications: [],

    // 初始化：加载今天的通知
    async init() {
        const { notifications, notificationDate } = await storageHelper.getAll(['notifications', 'notificationDate']);
        const todayStr = getToday();

        // 如果是新的一天，清空通知
        if (notificationDate !== todayStr) {
            this.notifications = [];
            await storageHelper.setAll({ notifications: [], notificationDate: todayStr });
        } else {
            this.notifications = notifications || [];
        }

        this.updateBadge();
    },

    // 添加通知
    async add(message, type = 'info') {
        const notification = {
            id: Date.now(),
            message,
            type,
            time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        };

        this.notifications.unshift(notification); // 新通知在前
        await storageHelper.setAll({ notifications: this.notifications });
        this.updateBadge();
    },

    // 更新角标
    updateBadge() {
        const badge = document.getElementById('notificationBadge');
        if (badge) {
            const count = this.notifications.length;
            if (count > 0) {
                badge.textContent = count > 99 ? '99+' : count;
                badge.style.display = 'block';
            } else {
                badge.style.display = 'none';
            }
        }
    },

    // 清空所有通知
    async clear() {
        this.notifications = [];
        await storageHelper.setAll({ notifications: [], notificationDate: getToday() });
        this.updateBadge();
    },

    // 显示通知列表
    show() {
        const renderContent = () => {
            if (this.notifications.length === 0) {
                elements.modalMsg.innerHTML = '<div class="notification-empty">今天还没有通知</div>';
            } else {
                let html = '<div class="notification-list">';
                this.notifications.forEach(notif => {
                    html += `
                        <div class="notification-item">
                            <div class="notification-header">
                                <span class="notification-type ${notif.type}">${this.getTypeLabel(notif.type)}</span>
                                <span class="notification-time">${notif.time}</span>
                            </div>
                            <div class="notification-message">${escapeHtml(notif.message)}</div>
                        </div>
                    `;
                });
                html += '</div>';
                elements.modalMsg.innerHTML = html;
            }
        };

        showHtmlModal('通知中心', '', [
            {
                text: '清空', cls: 'modal-btn-danger', onClick: async () => {
                    await this.clear();
                    renderContent();
                    // 清空后只保留关闭按钮
                    setCloseOnlyFooter();
                }
            },
            getCloseFooterButton()
        ]);
        renderContent();
    },

    getTypeLabel(type) {
        const labels = {
            info: '提示',
            success: '成功',
            warning: '警告',
            error: '错误'
        };
        return labels[type] || '提示';
    }
};

/**
 * 显示底部 Toast 提示（同时添加到通知中心）
 * 优化：确保 toast 元素正确移除，防止内存泄漏
 * @param {string} msg
 * @param {string} type
 * @param {number} duration
 * @param {boolean} silent - 为 true 时只弹 toast，不写入通知中心
 */
function showToast(msg, type = 'info', duration = CONFIG.TOAST_NORMAL, silent = false) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    elements.toastContainer.appendChild(toast);

    const removeToast = () => {
        if (toast.parentNode) {
            toast.remove();
        }
    };

    setTimeout(() => {
        toast.classList.add('fade-out');
        toast.addEventListener('animationend', removeToast, { once: true });
        // 备用清理：防止 animationend 未触发
        setTimeout(removeToast, 500);
    }, duration);

    // 添加到通知中心（静默模式下跳过）
    if (!silent) notificationCenter.add(msg, type);
}

function setModalDismissHandler(handler = null) {
    modalDismissHandler = typeof handler === 'function' ? handler : null;
}

function dismissModal() {
    const handler = modalDismissHandler;
    if (handler) {
        handler();
        return;
    }
    _closeModal();
}

function setModalVisibility(isVisible) {
    elements.modalOverlay.classList.toggle('visible', isVisible);
    elements.modalOverlay.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
}

function resetModalTransientState() {
    elements.modalOverlay.dataset.mode = '';
    elements.modalInput.onkeydown = null;
    elements.modalMsg.onclick = null;
    elements.modalMsg.style.whiteSpace = '';
    elements.modalMsg.style.lineHeight = '';
}

function getCloseFooterButton() {
    return { text: '关闭', cls: 'modal-btn-cancel', onClick: _closeModal };
}

function getCancelFooterButton(onClick) {
    return { text: '取消', cls: 'modal-btn-cancel', onClick };
}

function getConfirmFooterButton(onClick, danger = false, text = '确定') {
    return { text, cls: danger ? 'modal-btn-danger' : 'modal-btn-ok', onClick };
}

function setCloseOnlyFooter() {
    _setFooter([getCloseFooterButton()]);
}

function setConfirmOnlyFooter(onConfirm, danger = false, text = '确定') {
    _setFooter([getConfirmFooterButton(onConfirm, danger, text)]);
}

function setCancelConfirmFooter(onCancel, onConfirm, danger = false, confirmText = '确定') {
    _setFooter([
        getCancelFooterButton(onCancel),
        getConfirmFooterButton(onConfirm, danger, confirmText)
    ]);
}

function resolveAndCloseModal(resolve, value) {
    _closeModal();
    resolve(value);
}

function createResolveAndCloseHandler(resolve, value) {
    return () => {
        resolveAndCloseModal(resolve, value);
    };
}

function showAlert(msg, title = '提示') {
    return new Promise(resolve => {
        const onClose = createResolveAndCloseHandler(resolve);
        _openModal(title, msg, false, '', onClose);
        setConfirmOnlyFooter(onClose);
    });
}

function showConfirm(msg, title = '确认', danger = false) {
    return new Promise(resolve => {
        const onCancel = createResolveAndCloseHandler(resolve, false);
        const onConfirm = createResolveAndCloseHandler(resolve, true);
        _openModal(title, msg, false, '', onCancel);
        setCancelConfirmFooter(onCancel, onConfirm, danger);
    });
}

function showPrompt(msg, { defaultVal = '', title = '请输入' } = {}) {
    return new Promise(resolve => {
        const onCancel = createResolveAndCloseHandler(resolve, null);
        _openModal(title, msg, true, defaultVal, onCancel);
        const onOk = () => {
            const val = elements.modalInput.value;
            resolveAndCloseModal(resolve, val);
        };
        resetModalTransientState();
        elements.modalInput.onkeydown = (e) => { if (e.key === 'Enter') onOk(); };
        setCancelConfirmFooter(onCancel, onOk);
        elements.modalInput.focus();
    });
}

function _openModal(title, msg, showInput, defaultVal = '', onDismiss = null) {
    setModalDismissHandler(onDismiss);
    resetModalTransientState();
    elements.modalTitle.textContent = title;
    elements.modalMsg.textContent = msg;
    if (showInput) {
        elements.modalInput.value = defaultVal;
        elements.modalInput.style.display = 'block';
    } else {
        elements.modalInput.value = '';
        elements.modalInput.style.display = 'none';
    }
    elements.modalFooter.replaceChildren();
    setModalVisibility(true);
}

function _closeModal() {
    setModalDismissHandler(null);
    setModalVisibility(false);
    const wasIndexSettings = elements.modalOverlay.dataset.mode === 'index-settings';
    elements.modalOverlay.dataset.mode = '';
    elements.modalOverlay.dataset.formLayout = '';
    const modalBox = elements.modalOverlay.querySelector('.modal-box');
    if (modalBox) {
        modalBox.style.width = '';
        modalBox.style.maxWidth = '';
        modalBox.style.maxHeight = '';
        modalBox.style.overflowY = '';
    }
    elements.modalOverlay.style.removeProperty('top');
    elements.modalOverlay.style.removeProperty('bottom');
    elements.modalOverlay.style.removeProperty('overflow-y');
    elements.modalInput.value = '';
    elements.modalInput.onkeydown = null;
    elements.modalMsg.onclick = null; // 清空撤销等临时绑定，防止泄漏到下一个弹窗
    elements.modalMsg.style.whiteSpace = '';
    elements.modalMsg.style.lineHeight = '';
    elements.modalFooter.replaceChildren();
    if (wasIndexSettings) renderMarketBreadthTicker();
}
function _setFooter(btns) {
    elements.modalFooter.replaceChildren();
    btns.forEach(({ text, cls, onClick }) => {
        const btn = document.createElement('button');
        btn.textContent = text;
        btn.className = `modal-btn ${cls}`;
        btn.onclick = onClick;
        elements.modalFooter.appendChild(btn);
    });
}

function showHtmlModal(title, html, footerBtns = null) {
    setModalDismissHandler(_closeModal);
    resetModalTransientState();
    elements.modalTitle.style.display = '';
    elements.modalFooter.style.display = '';
    const modalBox = elements.modalOverlay.querySelector('.modal-box');
    if (modalBox) {
        modalBox.style.padding = '';
        modalBox.style.width = '';
        modalBox.style.maxWidth = '';
        modalBox.style.maxHeight = '';
        modalBox.style.overflowY = '';
    }

    elements.modalTitle.textContent = title;
    elements.modalMsg.innerHTML = html;
    elements.modalMsg.style.whiteSpace = 'normal';
    elements.modalMsg.style.lineHeight = '1.35';
    elements.modalInput.value = '';
    elements.modalInput.style.display = 'none';
    _setFooter(footerBtns || [getCloseFooterButton()]);
    setModalVisibility(true);
}

function getOrderDisplayDate(order = {}) {
    return normalizePerfDate(
        order.orderDate
        || order.date
        || order.effectiveDate
        || order.targetDate
        || order.confirmedDate
        || ''
    );
}

function getOrderConfirmTime(order = {}) {
    const confirmedDate = normalizePerfDate(order.confirmedDate || order.confirmDate || '');
    if (confirmedDate) return confirmedDate;
    if (order.status !== 'confirmed') return '待确认';
    return normalizePerfDate(order.targetDate || order.effectiveDate || order.date || '') || '—';
}

function getOrderDisplayAmount(order = {}) {
    if (isDividendType(order.type) && safeFloat(order.dividendAmount, 0) > 0) {
        return safeFloat(order.dividendAmount, 0);
    }
    return safeFloat(order.amount, 0);
}

function getOrderDisplayShares(order = {}) {
    const confirmedShares = safeFloat(order.confirmedShares, 0);
    if (confirmedShares > 0) return confirmedShares;
    return safeFloat(order.shares, 0);
}

function formatOrderAmount(value, digits = 2, zeroText = '0.00') {
    const num = safeFloat(value, 0);
    if (num === 0) return zeroText;
    return num.toFixed(digits);
}

function formatOrderOptionalNumber(value, digits = 2) {
    const num = safeFloat(value, 0);
    return num > 0 ? num.toFixed(digits) : '—';
}

function buildOrderSearchMatcher(query) {
    return createSearchMatcher(query, [
        order => getOrderDisplayDate(order),
        order => order?.code,
        order => order?.name,
        order => order?.group,
        order => getOrderDisplayAmount(order),
        order => getOrderDisplayShares(order),
        order => getTradeExecutionNav(order),
        order => order?.fee,
        order => getOrderConfirmTime(order),
        order => getTradeDisplayLabel(order),
        order => order?.remark
    ]);
}

async function openAllOrdersModal() {
    showHtmlModal('所有订单', '<div class="orders-loading">订单加载中...</div>', [getCloseFooterButton()]);
    elements.modalOverlay.dataset.mode = 'all-orders';

    let orders = [];
    try {
        orders = await HistoryDB.getAllOrders();
    } catch (error) {
        console.error('[Orders] 读取订单失败:', error);
        elements.modalMsg.innerHTML = '<div class="orders-empty">订单读取失败</div>';
        showToast('订单读取失败', 'error');
        return;
    }

    const html = `
        <div class="orders-modal">
            <div class="orders-toolbar">
                <input id="ordersSearchInput" class="orders-search-input" type="search" placeholder="搜索日期/代码/名称/金额" aria-label="搜索订单">
                <span id="ordersResultCount" class="orders-result-count"></span>
            </div>
            <div class="orders-table-wrap">
                <table class="orders-table">
                    <colgroup>
                        <col class="oc-index">
                        <col class="oc-date">
                        <col class="oc-confirm">
                        <col class="oc-type">
                        <col class="oc-code">
                        <col class="oc-name">
                        <col class="oc-amount">
                        <col class="oc-shares">
                        <col class="oc-nav">
                        <col class="oc-fee">
                    </colgroup>
                    <thead>
                        <tr>
                            <th>序号</th>
                            <th>日期</th>
                            <th>确认时间</th>
                            <th>类型</th>
                            <th>代码</th>
                            <th>名称</th>
                            <th>金额</th>
                            <th>份数</th>
                            <th>净值</th>
                            <th>手续费</th>
                        </tr>
                    </thead>
                    <tbody id="ordersTableBody"></tbody>
                </table>
            </div>
        </div>
    `;

    elements.modalMsg.innerHTML = html;
    const searchInput = document.getElementById('ordersSearchInput');
    const countEl = document.getElementById('ordersResultCount');
    const tbody = document.getElementById('ordersTableBody');

    const renderOrders = () => {
        const query = searchInput?.value || '';
        const matcher = buildOrderSearchMatcher(query);
        const filteredOrders = orders.filter(matcher);
        const fragment = document.createDocumentFragment();

        filteredOrders.forEach((order, index) => {
            const tr = document.createElement('tr');
            const typeLabel = getTradeDisplayLabel(order);
            const typeColor = getTradeDisplayColor(order);
            const cells = [
                String(index + 1),
                getOrderDisplayDate(order) || '—',
                getOrderConfirmTime(order),
                typeLabel,
                order.code || '—',
                order.name || '—',
                formatOrderAmount(getOrderDisplayAmount(order)),
                formatOrderOptionalNumber(getOrderDisplayShares(order)),
                formatOrderOptionalNumber(getTradeExecutionNav(order), 4),
                formatOrderAmount(order.fee, 2)
            ];
            cells.forEach((text, cellIndex) => {
                const td = document.createElement('td');
                td.textContent = text;
                if (cellIndex === 3) {
                    td.className = 'order-type';
                    td.style.color = typeColor;
                }
                if ([6, 7, 8, 9].includes(cellIndex)) td.className = 'num';
                tr.appendChild(td);
            });
            fragment.appendChild(tr);
        });

        if (filteredOrders.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 10;
            td.className = 'orders-empty-cell';
            td.textContent = orders.length === 0 ? '暂无订单记录' : '没有匹配的订单';
            tr.appendChild(td);
            fragment.appendChild(tr);
        }

        tbody.replaceChildren(fragment);
        if (countEl) {
            countEl.textContent = orders.length === filteredOrders.length
                ? `共 ${orders.length} 条`
                : `${filteredOrders.length} / ${orders.length} 条`;
        }
    };

    if (searchInput) {
        searchInput.addEventListener('input', renderOrders);
        searchInput.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || !searchInput.value) return;
            searchInput.value = '';
            renderOrders();
        });
        searchInput.focus();
    }
    renderOrders();
}

function showFormModal({ title, subTitle = '', fields = [], actionText = '确认', layout = 'auto', formClass = '', onRender = null } = {}) {
    return new Promise(resolve => {
        const onCancel = createResolveAndCloseHandler(resolve, null);
        _openModal(title, '', false, '', onCancel);
        elements.modalOverlay.dataset.mode = 'form';
        elements.modalOverlay.dataset.formLayout = layout;
        const modalBox = elements.modalOverlay.querySelector('.modal-box');
        if (modalBox) {
            modalBox.style.width = '';
            modalBox.style.maxWidth = '';
            modalBox.style.maxHeight = '';
            modalBox.style.overflowY = '';
            if (layout === 'double') {
                modalBox.style.maxWidth = '560px';
            } else {
                modalBox.style.maxWidth = '420px';
            }
        }

        const formHtml = `
            ${subTitle ? `<div class="form-header-sub">${escapeHtml(subTitle)}</div>` : ''}
            <div class="form-modal ${escapeHtml(formClass)}" style="${layout === 'double' ? 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 12px;align-items:start;' : ''}">
                ${safeArray(fields, []).map(field => {
                    if (field?.type === 'hidden') {
                        return `<input id="modal_field_${field.id}" type="hidden" value="${escapeHtml(field.value ?? '')}">`;
                    }
                    const label = field?.label ? `<label for="modal_field_${field.id}">${escapeHtml(field.label)}</label>` : '';
                    const commonAttrs = [
                        `id="modal_field_${field.id}"`,
                        field?.placeholder ? `placeholder="${escapeHtml(field.placeholder)}"` : '',
                        field?.min !== undefined ? `min="${field.min}"` : '',
                        field?.max !== undefined ? `max="${field.max}"` : '',
                        field?.step !== undefined ? `step="${field.step}"` : '',
                        field?.list ? `list="${escapeHtml(field.list)}"` : ''
                    ].filter(Boolean).join(' ');

                    let inputHtml = '';
                    if (field?.type === 'select') {
                        inputHtml = `
                            <select ${commonAttrs}>
                                ${(field.options || []).map(opt => `<option value="${escapeHtml(opt.value)}" ${opt.value === field.value ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`).join('')}
                            </select>
                        `;
                    } else {
                        const inputType = field?.type || 'text';
                        const valueAttr = field?.type !== 'password' ? `value="${escapeHtml(field.value ?? '')}"` : '';
                        inputHtml = `<input type="${inputType}" ${commonAttrs} ${valueAttr}>`;
                    }

                    return `
                        <div class="form-group">
                            ${label}
                            ${inputHtml}
                        </div>
                    `;
                }).join('')}
            </div>
        `;

        elements.modalMsg.innerHTML = formHtml;
        if (typeof onRender === 'function') {
            try {
                onRender({
                    root: elements.modalMsg,
                    overlay: elements.modalOverlay,
                    getField: (fieldId) => document.getElementById(`modal_field_${fieldId}`)
                });
            } catch (error) {
                console.error('[showFormModal] onRender 执行失败:', error);
            }
        }

        const onConfirm = () => {
            const result = {};
            let valid = true;
            for (const field of safeArray(fields, [])) {
                if (!field || field.type === 'hidden') {
                    if (field?.id) result[field.id] = field.value ?? '';
                    continue;
                }
                const input = document.getElementById(`modal_field_${field.id}`);
                if (!input) continue;
                result[field.id] = input.value;
                if (field.required && !input.value) valid = false;
            }
            if (!valid) return;
            resolveAndCloseModal(resolve, result);
        };

        setCancelConfirmFooter(onCancel, onConfirm, false, actionText);
    });
}
