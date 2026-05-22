let _ocrModalEl = null;
let _ocrItems = [];

function _sendToTesseract(action, payload) {
    return new Promise((resolve, reject) => {
        const jobId = 'job_' + Math.random().toString(36).slice(2);
        const workerId = 'main_thread';
        __TesseractDispatch(
            { workerId, jobId, action, payload },
            (msg) => {
                if (msg.status === 'resolve') resolve(msg.data);
                else if (msg.status === 'reject') reject(new Error(msg.data));
            }
        );
    });
}

async function _getOCRWorker(onLog) {
    if (window._tWorker) return window._tWorker;
    const extRoot = chrome.runtime.getURL('').replace(/\/$/, '');

    if (typeof __TesseractDispatch === 'undefined') {
        throw new Error('__TesseractDispatch 未定义，请确认 popup.html 已加载 worker.min.js');
    }

    await _sendToTesseract('load', {
        options: {
            corePath: chrome.runtime.getURL('tesseract-core.wasm.js'),
            langPath: extRoot,
            logging: false,
        }
    });
    await _sendToTesseract('loadLanguage', {
        langs: 'chi_sim',
        options: { langPath: extRoot, dataPath: null, cachePath: null, cacheMethod: 'none', gzip: false }
    });
    await _sendToTesseract('initialize', {
        langs: 'chi_sim',
        options: {}
    });

    const fakeWorker = {
        recognize: async (imageData) => {
            let imgBuffer = imageData;
            if (imageData instanceof Blob || imageData instanceof File) {
                imgBuffer = new Uint8Array(await imageData.arrayBuffer());
            }
            const result = await new Promise((resolve, reject) => {
                const jobId = 'job_' + Math.random().toString(36).slice(2);
                __TesseractDispatch(
                    {
                        workerId: 'main_thread', jobId, action: 'recognize',
                        payload: {
                            image: imgBuffer, options: {},
                            output: { text: true, blocks: false, hocr: false, tsv: false }
                        }
                    },
                    (msg) => {
                        if (onLog) onLog(msg);
                        if (msg.status === 'resolve') resolve(msg.data);
                        else if (msg.status === 'reject') reject(new Error(String(msg.data)));
                    }
                );
            });
            return { data: result };
        },
        terminate: () => { window._tWorker = null; }
    };

    window._tWorker = fakeWorker;
    return fakeWorker;
}

async function getCodeByName(name) {
    if (!name || name.length < 2) return null;

    function nameVariants(raw) {
        const clean = raw.replace(/\s+/g, '');
        const variants = [clean];
        let core = clean
            .replace(/发起联接[A-E]?$/, '')
            .replace(/联接[A-E]?$/, '')
            .replace(/指数[A-E]?$/, '')
            .replace(/[（(]LOF[)）]/, '')
            .replace(/ETF/, '')
            .replace(/[A-E]$/, '');
        if (core !== clean && core.length >= 4) variants.push(core);
        const cjk = raw.replace(/[A-Za-z\(\)\（\）\s]+/g, '')
            .replace(/发起联接$|联接$|指数$/, '');
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
                    const code = String(item.CODE || '');
                    if (/^\d{6}$/.test(code)) return code;
                }
            }
        } catch (e) {
            console.warn('[OCR] 代码反查失败:', query, e);
        }
    }
    return null;
}

function _normalizeOCR(text) {
    return text.split('\n').map(line => {
        let prev = null;
        let nextLine = line;
        while (prev !== nextLine) {
            prev = nextLine;
            nextLine = nextLine.replace(/([一-龥])\s+([一-龥])/g, '$1$2');
            nextLine = nextLine.replace(/([一-龥])\s+([（）\(\)])/g, '$1$2');
            nextLine = nextLine.replace(/([（）\(\)])\s+([一-龥])/g, '$1$2');
        }
        return nextLine;
    }).join('\n');
}

function _parseOCRText(text) {
    const normalized = _normalizeOCR(text);
    const lines = normalized.split('\n').map(l => l.trim()).filter(Boolean);
    const fullText = lines.join('\n');
    const result = [];
    if (!lines.length) return result;

    const CODE_RE = /\b(\d{6})\b/;
    const MONEY_RE = () => /[+-]?\d[\d,\.]*\.\d{1,2}(?!\d)(?!\s*%)/g;
    const VAL_RE = () => /[+-]?\d[\d,\.]*\.\d{2}(?!\d)(?!\s*%)/g;
    const NAME_EXCL = /收益|金额|赎回|购买|申购|到账|手续费|销售|暂停|T\+\d|万内/;
    const ALL_LABELS = ['持有金额', '昨日收益', '持有收益率', '持有收益', '持有份额'];

    function parseAmt(str) {
        const s = str.replace(/[^\d\.\+-]/g, '');
        if (!s) return 0;
        const parts = s.replace(/^[+-]/, '').split('.');
        if (parts.length > 2) {
            const sign = s[0] === '-' ? -1 : 1;
            return sign * parseFloat(parts.slice(0, -1).join('') + '.' + parts[parts.length - 1]);
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
        return cjk / s.replace(/\s/g, '').length >= 0.3;
    }

    function nameSimilar(a, b) {
        const ca = a.replace(/[^\u4e00-\u9fa5]/g, '');
        const cb = b.replace(/[^\u4e00-\u9fa5]/g, '');
        if (!ca || !cb || ca.length < 4 || cb.length < 4) return false;
        const [shorter, longer] = ca.length <= cb.length ? [ca, cb] : [cb, ca];
        return longer.includes(shorter);
    }

    function getLabelPosFrom(lbl, startFrom) {
        if (lbl !== '持有收益') {
            const idx = fullText.indexOf(lbl, startFrom);
            return idx !== -1 ? idx : undefined;
        }
        let s = startFrom;
        while (true) {
            const idx = fullText.indexOf(lbl, s);
            if (idx === -1) return undefined;
            if (fullText[idx + lbl.length] !== '率') return idx;
            s = idx + 1;
        }
    }

    function segAfterLabel(lbl, startFrom) {
        const pos = getLabelPosFrom(lbl, startFrom);
        if (pos === undefined) return '';
        const segStart = pos + lbl.length;
        let segEnd = segStart + 200;
        ALL_LABELS.forEach(other => {
            if (other === lbl) return;
            const op = getLabelPosFrom(other, startFrom);
            if (op !== undefined && op > segStart && op < segEnd) segEnd = op;
        });
        return fullText.slice(segStart, segEnd);
    }

    function maxPosNum(seg) {
        let best = 0;
        for (const m of (seg.match(MONEY_RE()) || [])) {
            const v = parseAmt(m);
            if (v > best) best = v;
        }
        return best;
    }

    function firstNum(seg, mustPos = false) {
        for (const m of (seg.match(MONEY_RE()) || [])) {
            const v = parseAmt(m);
            if (mustPos && v < 0) continue;
            return v;
        }
        return 0;
    }

    const COL_HEAD_RE = /昨日收|总金额/;
    const modeB = [];
    const seenNames = new Set();

    for (let i = 0; i < lines.length; i++) {
        if (!COL_HEAD_RE.test(lines[i])) continue;
        const hasYesterday = /昨日收/.test(lines[i]);

        let dataLine = '';
        for (let j = i + 1; j <= Math.min(i + 3, lines.length - 1); j++) {
            const ms = lines[j].match(VAL_RE());
            if (ms && ms.length >= 2) { dataLine = lines[j]; break; }
        }
        if (!dataLine) continue;

        const nums = (dataLine.match(VAL_RE()) || []).map(parseAmt);
        let yp = 0;
        let hp = 0;
        let amt = 0;
        if (hasYesterday && nums.length >= 3) {
            [yp, hp, amt] = [nums[0], nums[1], nums[2]];
        } else if (nums.length >= 3) {
            [yp, hp, amt] = [nums[0], nums[1], nums[2]];
        } else if (nums.length === 2) {
            [hp, amt] = [nums[0], nums[1]];
        } else if (nums.length === 1) {
            amt = nums[0];
        }
        const posNums = nums.filter(v => v > 0);
        if (posNums.length && Math.max(...posNums) > amt) amt = Math.max(...posNums);

        let fundName = '';
        for (let k = i - 1; k >= Math.max(0, i - 6); k--) {
            if (isNameLine(lines[k])) { fundName = lines[k]; break; }
        }
        if (!fundName || seenNames.has(fundName)) continue;
        seenNames.add(fundName);

        modeB.push({
            code: '', name: fundName, amount: amt, holdProfit: hp, yesterdayProfit: yp,
            shares: 0, group: '默认', selected: true, _needLookup: true, _claimed: false
        });
    }

    const seenCodes = new Set();

    for (let i = 0; i < lines.length; i++) {
        const codeMatch = lines[i].match(CODE_RE);
        if (!codeMatch) continue;
        const code = codeMatch[1];
        if (seenCodes.has(code)) continue;
        seenCodes.add(code);

        let fundName = '';
        for (let k = i - 1; k >= Math.max(0, i - 4); k--) {
            if (/[\u4e00-\u9fa5]/.test(lines[k])) { fundName = lines[k]; break; }
        }

        const codePos = fullText.indexOf(code);
        const startFrom = Math.max(0, codePos - 10);

        let amount = maxPosNum(segAfterLabel('持有金额', startFrom));
        let yesterday = firstNum(segAfterLabel('昨日收益', startFrom));
        let hold = firstNum(segAfterLabel('持有收益', startFrom));

        if (!amount) {
            const RATE_RE = /(\d+\.?\d*)\s*%/g;
            const linesAfterCode = lines.slice(i);
            for (let li = 0; li < linesAfterCode.length; li++) {
                const lbl = linesAfterCode[li];
                if (!/昨日收益|持有收益/.test(lbl)) continue;
                for (let vi = li + 1; vi <= Math.min(li + 3, linesAfterCode.length - 1); vi++) {
                    const valLine = linesAfterCode[vi];
                    const nums = (valLine.match(MONEY_RE()) || []).map(m => parseAmt(m));
                    const rates = [];
                    let rm;
                    RATE_RE.lastIndex = 0;
                    while ((rm = RATE_RE.exec(valLine)) !== null) rates.push(parseFloat(rm[1]));
                    if (!nums.length) continue;
                    if (!yesterday && nums[0] !== undefined) yesterday = nums[0];
                    if (!hold && nums[1] !== undefined) hold = nums[1];
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
            code, name: fundName, amount, holdProfit: hold, yesterdayProfit: yesterday,
            shares: 0, group: '默认', selected: true, _needLookup: false
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
    const container = _ocrModalEl.querySelector('#_ocrResults');
    if (!_ocrItems.length) {
        container.innerHTML = '<p style="text-align:center;color:#6a8aaa;font-size:12px;padding:20px;">未识别到有效资产信息，请确认图片是否清晰</p>';
        return;
    }
    const C = 'padding:4px 3px;';
    const I = 'background:#0d1b2e;border:1px solid #2a4a72;border-radius:4px;color:#c8d8f0;padding:2px 4px;font-size:11px;width:100%;box-sizing:border-box;';

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
                <th style="${C}">代码</th>
                <th style="${C}">基金名称</th>
                <th style="${C}">持仓金额(元)</th>
                <th style="${C}">持有收益(元)</th>
                <th style="${C}">昨日收益(元)</th>
                <th style="${C}">分组</th>
            </tr></thead>
            <tbody>`;

    _ocrItems.forEach((a, idx) => {
        const codeStyle = a.code ? '' : 'border-color:#f5222d;';
        const hpVal = (a.holdProfit !== undefined && a.holdProfit !== 0) ? a.holdProfit : '';
        const ypVal = (a.yesterdayProfit !== undefined && a.yesterdayProfit !== 0) ? a.yesterdayProfit : '';
        const nameStr = (a.name || '').replace(/"/g, '&quot;');
        html += `<tr style="border-bottom:1px solid #141f30;">
            <td style="${C}"><input type="checkbox" class="_oc" data-i="${idx}" ${a.selected ? 'checked' : ''}></td>
            <td style="${C}"><input type="text" style="${I}${codeStyle}" value="${a.code || ''}" class="_oe" data-i="${idx}" data-f="code" placeholder="待填"></td>
            <td style="${C}" title="${nameStr}"><span style="color:#8aacce;font-size:10px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${a.name || '—'}</span></td>
            <td style="${C}"><input type="number" style="${I}" value="${a.amount || ''}" class="_oe" data-i="${idx}" data-f="amount" step="0.01" placeholder="0"></td>
            <td style="${C}"><input type="number" style="${I}" value="${hpVal}" class="_oe" data-i="${idx}" data-f="holdProfit" step="0.01" placeholder="0"></td>
            <td style="${C}"><input type="number" style="${I}" value="${ypVal}" class="_oe" data-i="${idx}" data-f="yesterdayProfit" step="0.01" placeholder="0"></td>
            <td style="${C}"><input type="text" style="${I}" value="${a.group}" class="_oe" data-i="${idx}" data-f="group"></td>
        </tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;

    container.querySelector('#_ocrChkAll').onchange = function () {
        _ocrItems.forEach(a => a.selected = this.checked);
        container.querySelectorAll('._oc').forEach(cb => cb.checked = this.checked);
    };
    container.querySelectorAll('._oc').forEach(cb => {
        cb.onchange = () => { _ocrItems[+cb.dataset.i].selected = cb.checked; };
    });
    container.querySelectorAll('._oe').forEach(inp => {
        inp.oninput = () => {
            const idx = +inp.dataset.i;
            const f = inp.dataset.f;
            const numFields = ['amount', 'holdProfit', 'yesterdayProfit', 'shares'];
            _ocrItems[idx][f] = numFields.includes(f)
                ? (parseFloat(inp.value) || 0) : inp.value;
        };
    });
}

function openOCRBatchAdd() {
    if (_ocrModalEl) return;

    _ocrItems = [
        { code: '', name: '', amount: '', holdProfit: '', yesterdayProfit: '', group: '默认', selected: true },
        { code: '', name: '', amount: '', holdProfit: '', yesterdayProfit: '', group: '默认', selected: true },
        { code: '', name: '', amount: '', holdProfit: '', yesterdayProfit: '', group: '默认', selected: true }
    ];

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);z-index:20000;display:flex;align-items:center;justify-content:center;';

    overlay.innerHTML = `
        <div style="background:#111f35;border:1px solid #2a4a72;border-radius:12px;width:600px;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 16px 48px rgba(0,0,0,.6);overflow:hidden;">
            <div style="padding:13px 18px;border-bottom:1px solid #1e3a5f;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
                <span style="font-size:14px;font-weight:700;color:#e8f0ff;">⚡ 批量添加数据</span>
                <span id="_ocrClose" style="cursor:pointer;color:#6a8aaa;font-size:20px;line-height:1;padding:0 2px;">✕</span>
            </div>

            <div style="padding:14px; display:flex; gap:10px; border-bottom:1px solid #1e3a5f; flex-shrink:0; background:#0a1525;">
                <textarea id="_batchText" placeholder="在此粘贴纯文本 (如: 000001 1000)\n或者直接在下方表格手动录入..." style="flex:1; height:60px; background:#0d1b2e; border:1px solid #2a4a72; border-radius:6px; color:#c8d8f0; padding:8px; font-size:12px; resize:none;"></textarea>
                <div style="display:flex; flex-direction:column; gap:8px; width:100px;">
                    <button id="_btnParseText" style="flex:1; background:#1a2f50; color:#8aacce; border:1px solid #2a4a72; border-radius:6px; cursor:pointer; font-size:12px;">解析文本</button>
                    <button id="_ocrPickBtn" style="flex:1; background:#1890ff; border:none; color:#fff; border-radius:6px; cursor:pointer; font-size:12px; font-weight:bold;">📷 传图识别</button>
                </div>
            </div>
            <input type="file" id="_ocrFile" accept="image/*" multiple style="display:none;">

            <div id="_ocrProg" style="display:none;padding:8px 16px;font-size:12px;color:#fa8c16;background:rgba(250,140,22,0.1);flex-shrink:0;"></div>

            <div id="_ocrResults" style="flex:1;overflow-y:auto;padding:10px 14px;min-height:240px;"></div>

            <div id="_ocrFoot" style="padding:10px 16px;border-top:1px solid #1e3a5f;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
                <button id="_ocrAddRow" style="background:transparent; border:1px dashed #2a4a72; color:#69b1ff; border-radius:6px; padding:6px 14px; font-size:12px; cursor:pointer;">+ 增加一行</button>
                <button id="_ocrSave" style="background:#1890ff;color:#fff;border:none;border-radius:6px;padding:7px 22px;font-size:13px;font-weight:600;cursor:pointer;">批量保存</button>
            </div>
        </div>`;

    document.body.appendChild(overlay);
    _ocrModalEl = overlay;

    const closeOCRModal = () => {
        overlay.remove();
        _ocrModalEl = null;
        _ocrItems = [];
    };

    overlay.onclick = (e) => {
        if (e.target === overlay) {
            closeOCRModal();
        }
    };

    _renderOCRTable();

    overlay.querySelector('#_ocrClose').onclick = closeOCRModal;

    const fileInput = overlay.querySelector('#_ocrFile');
    overlay.querySelector('#_ocrPickBtn').onclick = () => fileInput.click();
    fileInput.onchange = () => _runOCR(Array.from(fileInput.files));

    overlay.querySelector('#_ocrAddRow').onclick = () => {
        _ocrItems.push({ code: '', name: '', amount: '', holdProfit: '', yesterdayProfit: '', group: '默认', selected: true });
        _renderOCRTable();
    };

    overlay.querySelector('#_btnParseText').onclick = () => {
        const text = overlay.querySelector('#_batchText').value;
        const lines = text.split('\n');
        _ocrItems = _ocrItems.filter(item => item.code || item.amount);
        lines.forEach(line => {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 2 && /^\d{6}$/.test(parts[0])) {
                _ocrItems.push({
                    code: parts[0], name: '', amount: parseFloat(parts[1]) || 0,
                    holdProfit: 0, yesterdayProfit: 0, group: '默认', selected: true
                });
            }
        });
        overlay.querySelector('#_batchText').value = '';
        _renderOCRTable();
    };

    overlay.querySelector('#_ocrSave').onclick = _saveOCRItems;
}

async function _runOCR(files) {
    const imgs = files.filter(f => f.type.startsWith('image/'));
    if (!imgs.length) { showToast('请选择图片文件', 'warning'); return; }

    const prog = _ocrModalEl.querySelector('#_ocrProg');
    prog.style.display = 'block';
    prog.textContent = '⏳ 正在初始化OCR引擎，首次加载需要几秒...';

    _ocrItems = _ocrItems.filter(item => item.code || item.amount);

    try {
        const worker = await _getOCRWorker(m => {
            if (m.status === 'recognizing text' && _ocrModalEl) {
                prog.textContent = `⏳ 识别中... ${Math.round((m.progress || 0) * 100)}%`;
            }
        });

        for (let i = 0; i < imgs.length; i++) {
            if (!_ocrModalEl) return;
            prog.textContent = `⏳ 正在识别第 ${i + 1} / ${imgs.length} 张图片...`;
            const { data: { text } } = await worker.recognize(imgs[i]);
            _ocrItems.push(..._parseOCRText(text));
        }

        if (!_ocrModalEl) return;
        const seenCodes = new Set();
        const seenNames = new Set();
        _ocrItems = _ocrItems.filter(a => {
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
            return true;
        });

        const needLookup = _ocrItems.filter(a => a._needLookup && a.name);
        if (!_ocrModalEl) return;
        if (needLookup.length > 0) {
            prog.textContent = `⏳ 正在反查基金代码（${needLookup.length} 条）...`;
            await Promise.all(needLookup.map(async (a) => {
                const code = await getCodeByName(a.name);
                a.code = code || '';
                a._needLookup = false;
            }));
        }

        if (_ocrItems.length) {
            const found = _ocrItems.filter(a => a.code).length;
            prog.textContent = `✅ 识别完成（${found} 个找到代码），请核对后批量保存`;
        } else {
            prog.textContent = '⚠️ 未识别到有效基金信息，请手动补充';
        }

        if (!_ocrModalEl) return;
        _renderOCRTable();
    } catch (e) {
        prog.textContent = '❌ 识别失败：' + e.message;
    }
}

async function _saveOCRItems() {
    const toSave = _ocrItems.filter(a => a.selected && String(a.code || '').trim());
    if (!toSave.length) { showToast('请至少勾选一个有效代码的资产', 'warning'); return; }

    const btn = _ocrModalEl.querySelector('#_ocrSave');
    btn.disabled = true;
    btn.textContent = '保存中...';

    try {
        const { myFunds } = await storageHelper.getAll(['myFunds']);
        const funds = myFunds || {};
        for (const a of toSave) {
            const code = String(a.code).trim().toUpperCase();
            if (!code) continue;
            const existing = funds[code] || {};
            let actualPrevPrice = existing.savedPrevPrice;
            if (!actualPrevPrice) {
                try {
                    const liveInfo = await fetchLiveInfo(code);
                    actualPrevPrice = liveInfo?.prevPrice || 0;
                } catch (e) {
                    actualPrevPrice = 0;
                }
            }
            funds[code] = {
                ...existing,
                name: a.name || existing.name || '',
                amount: a.amount ?? 0,
                holdProfit: a.holdProfit ?? 0,
                yesterdayProfit: a.yesterdayProfit ?? 0,
                group: a.group || '默认',
                savedPrevPrice: actualPrevPrice || existing.savedPrevPrice || undefined,
                savedPrevDate: existing.savedPrevDate || getToday(),
            };
            if (a.shares && a.shares > 0) {
                funds[code].shares = a.shares;
            }
            syncAddedDateByPosition(funds[code], getToday());
        }

        await storageHelper.setAll({ myFunds: funds });
        showToast(`✅ 成功保存 ${toSave.length} 个资产！`, 'success');
        _ocrModalEl.remove();
        _ocrModalEl = null;
        _ocrItems = [];
        loadData();
    } catch (e) {
        btn.disabled = false;
        btn.textContent = '批量保存选中';
        showToast('保存失败：' + e.message, 'error');
    }
}
