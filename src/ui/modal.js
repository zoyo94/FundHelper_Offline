// ==================== DOM 元素引用 ====================
export const elements = {
    addBtn: document.getElementById('addBtn'),
    groupList: document.getElementById('groupList'),
    groupFilter: document.getElementById('groupFilter'),
    tableBody: document.getElementById('fundTableBody'),
    status: document.getElementById('status'),
    fullscreenBtn: document.getElementById('fullscreenBtn'),
    refreshBtn: document.getElementById('refreshBtn'),
    totalAmount: document.getElementById('totalAmount'),
    totalTodayProfit: document.getElementById('totalTodayProfit'),
    totalTotalProfit: document.getElementById('totalTotalProfit'),
    totalYesterdayProfit: document.getElementById('totalYesterdayProfit'),
    exportBtn: document.getElementById('exportBtn'),
    importBtn: document.getElementById('importBtn'),
    importFile: document.getElementById('importFile'),
    // Modal 相关
    modalOverlay: document.getElementById('modalOverlay'),
    modalTitle: document.getElementById('modalTitle'),
    modalMsg: document.getElementById('modalMsg'),
    modalInput: document.getElementById('modalInput'),
    modalFooter: document.getElementById('modalFooter'),
    toastContainer: document.getElementById('toastContainer'),
    batchGroupBtn: document.getElementById('batchGroupBtn'),
    batchClearBtn: document.getElementById('batchClearBtn'),
};

export function showToast(msg, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        toast.addEventListener('animationend', () => toast.remove());
    }, duration);
}

export function showAlert(msg, title = '提示') {
    return new Promise(resolve => {
        _openModal(title, msg, false);
        _setFooter([
            { text: '确定', cls: 'modal-btn-ok', onClick: () => { _closeModal(); resolve(); } }
        ]);
    });
}

export function showConfirm(msg, title = '确认', danger = false) {
    return new Promise(resolve => {
        _openModal(title, msg, false);
        _setFooter([
            { text: '取消', cls: 'modal-btn-cancel', onClick: () => { _closeModal(); resolve(false); } },
            { text: '确定', cls: danger ? 'modal-btn-danger' : 'modal-btn-ok', onClick: () => { _closeModal(); resolve(true); } }
        ]);
    });
}

export function showPrompt(msg, defaultVal = '', title = '请输入') {
    return new Promise(resolve => {
        _openModal(title, msg, true, defaultVal);
        const onOk = () => {
            const val = elements.modalInput.value;
            _closeModal();
            resolve(val);
        };
        elements.modalInput.onkeydown = (e) => { if (e.key === 'Enter') onOk(); };
        _setFooter([
            { text: '取消', cls: 'modal-btn-cancel', onClick: () => { _closeModal(); resolve(null); } },
            { text: '确定', cls: 'modal-btn-ok', onClick: onOk }
        ]);
        elements.modalInput.focus();
    });
}

export function _openModal(title, msg, showInput, defaultVal = '') {
    elements.modalTitle.textContent = title;
    elements.modalMsg.innerHTML = msg; // Changed to innerHTML to support custom inputs
    if (showInput) {
        elements.modalInput.value = defaultVal;
        elements.modalInput.style.display = 'block';
    } else {
        elements.modalInput.style.display = 'none';
    }
    elements.modalFooter.innerHTML = '';
    elements.modalOverlay.classList.add('visible');
}

export function _closeModal() {
    elements.modalOverlay.classList.remove('visible');
    elements.modalInput.onkeydown = null;
}

export function _setFooter(btns) {
    elements.modalFooter.innerHTML = '';
    btns.forEach(({ text, cls, onClick }) => {
        const btn = document.createElement('button');
        btn.textContent = text;
        btn.className = `modal-btn ${cls}`;
        btn.onclick = onClick;
        elements.modalFooter.appendChild(btn);
    });
}
