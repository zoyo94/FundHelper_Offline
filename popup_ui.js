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
