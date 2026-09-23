/* ============================================================
   CONFIGURATION
   ============================================================ */
const CFG = {
    PASSWORD: '356890',
    USERS: [
        'Sunny', 'Srimon', 'Rahul', 'Supam', 'Ayan', 'Soumik',
        'Subhankar', 'Nasim', 'Sahariar', 'Saptak', 'Alta'
    ],
    FOLDERS: {
        ABTA:           { label: 'ABTA',           icon: '📘' },
        QUESTION_BUNCH: { label: 'Question Bunch', icon: '📗' }
    },
    MODELS_PER_FOLDER: 24,
    TOTAL_QS: 40,
    EXAM_SEC: 1800
};

/* ============================================================
   STATE
   ============================================================ */
let curUser = null;
let test = null;
let viewingCtx = null;
let isReviewMode = false;
let activeFolder = 'ABTA';

/* ============================================================
   FIRESTORE
   ============================================================ */
const SUB_COL  = 'submissions';
const CMT_COL  = 'comments';
const USER_COL = 'users';
let unsubSubs = null;
let unsubCmts = null;
let cachedSubs = [];
let cachedCmts = {};

let userProfile = null;
let settingsInterval = null;
let lockMode = 'set';

/* ============================================================
   DOM HELPERS
   ============================================================ */
const $ = id => document.getElementById(id);
const show = id => { const el = $(id); if (el) el.style.display = 'block'; };
const hide = id => { const el = $(id); if (el) el.style.display = 'none'; };

function setConnStatus(online) {
    const el = $('connStatus');
    if (!el) return;
    el.className = 'conn-status ' + (online ? 'connected' : 'disconnected');
    el.textContent = online ? '● Connected' : '○ Disconnected';
}

/* ============================================================
   LOGIN FLOW
   ============================================================ */
function initLogin() {
    const u = sessionStorage.getItem('ms_user');
    if (u && CFG.USERS.includes(u)) {
        window.location.replace('dashboard.html');
        return;
    }
    const gate = $('gateBox');
    const user = $('userBox');
    if (gate) gate.style.display = 'block';
    if (user) user.style.display = 'none';
}

function unlockGate() {
    const inp = $('gateInput');
    const err = $('gateErr');
    if (!inp || !err) return;
    const val = inp.value.trim();
    if (val === CFG.PASSWORD) {
        err.textContent = '';
        $('gateBox').style.display = 'none';
        $('userBox').style.display = 'block';
        renderUserList();
    } else {
        err.textContent = '❌ Wrong password. Try again.';
        inp.value = '';
        inp.focus();
    }
}

function renderUserList() {
    const list = $('userList');
    if (!list) return;
    list.innerHTML = CFG.USERS.map(u => `
        <button onclick="pickUser('${u}')">
            ${u}
            <span class="sub">Click to enter dashboard</span>
        </button>
    `).join('');
}

function pickUser(u) {
    sessionStorage.setItem('ms_user', u);
    document.querySelectorAll('.login-users button').forEach(b => {
        b.style.pointerEvents = 'none';
    });
    setTimeout(() => {
        try { window.location.href = 'dashboard.html'; }
        catch (e) { window.location.replace('dashboard.html'); }
    }, 60);
}

function logout() {
    if (test && test.interval) clearInterval(test.interval);
    test = null;
    if (unsubSubs) { try { unsubSubs(); } catch (e) {} unsubSubs = null; }
    if (unsubCmts) { try { unsubCmts(); } catch (e) {} unsubCmts = null; }
    if (settingsInterval) { clearInterval(settingsInterval); settingsInterval = null; }

    if (curUser) {
        sessionStorage.removeItem('ms_unlocked_' + curUser);
        sessionStorage.removeItem('ms_setup_done_' + curUser);
        sessionStorage.removeItem('ms_session_start_' + curUser);
        sessionStorage.removeItem('ms_pending_' + curUser);
    }
    curUser = null;
    sessionStorage.removeItem('ms_user');
    window.location.href = 'index.html';
}

function checkSession() {
    const u = sessionStorage.getItem('ms_user');
    if (!u || !CFG.USERS.includes(u)) {
        window.location.href = 'index.html';
        return false;
    }
    curUser = u;

    if (!sessionStorage.getItem('ms_session_start_' + u)) {
        sessionStorage.setItem('ms_session_start_' + u, Date.now());
    }

    const badge = $('navBadge'); if (badge) badge.textContent = u[0];
    const navUser = $('navUser'); if (navUser) navUser.textContent = u;

    if (!window._clockInt) {
        window._clockInt = setInterval(() => {
            const el = document.getElementById('navClock');
            if (el) el.textContent = new Date().toLocaleTimeString('en-IN', { hour12: false });
        }, 1000);
    }

    try { renderFolderCards(); } catch (e) { console.error('renderFolderCards error:', e); }
    try { renderDash(); } catch (e) { console.error('renderDash error:', e); }

    subscribeToData();
    loadUserProfile();

    return true;
}

/* ============================================================
   FIRESTORE REAL-TIME
   ============================================================ */
function subscribeToData() {
    if (typeof db === 'undefined' || !db) {
        console.error('Firestore db is undefined. Check firebase-config.js');
        setConnStatus(false);
        return;
    }

    if (unsubSubs) { try { unsubSubs(); } catch (e) {} }
    try {
        unsubSubs = db.collection(SUB_COL).onSnapshot(snap => {
            const subs = [];
            snap.forEach(doc => subs.push({ id: doc.id, ...doc.data() }));
            cachedSubs = subs;
            if (curUser) {
                try { renderFolderCards(); } catch (e) { console.error(e); }
                try { renderDash(); } catch (e) { console.error(e); }
            }
            setConnStatus(true);
        }, err => {
            console.error('subs listener error:', err);
            setConnStatus(false);
        });
    } catch (err) {
        console.error('Failed to attach subs listener:', err);
        setConnStatus(false);
    }

    if (unsubCmts) { try { unsubCmts(); } catch (e) {} }
    try {
        unsubCmts = db.collection(CMT_COL).onSnapshot(snap => {
            const cmts = {};
            snap.forEach(doc => {
                const d = doc.data();
                const key = d.f + '-' + d.m + '-' + d.q;
                if (!cmts[key]) cmts[key] = [];
                cmts[key].push({ ...d, id: doc.id });
            });
            Object.keys(cmts).forEach(k => cmts[k].sort((a, b) => a.time - b.time));
            cachedCmts = cmts;
            setConnStatus(true);
        }, err => {
            console.error('cmts listener error:', err);
            setConnStatus(false);
        });
    } catch (err) {
        console.error('Failed to attach cmts listener:', err);
        setConnStatus(false);
    }
}

/* ============================================================
   STORE
   ============================================================ */
const Store = {
    subs() { return cachedSubs; },
    subsFor(folder) { return cachedSubs.filter(s => s.f === folder); },

    mySub(folder, m) {
        return cachedSubs.find(s => s.u === curUser && s.f === folder && s.m === m);
    },

    async saveSub({ u, f, m, ans, sp }) {
        try {
            const existing = cachedSubs.find(x => x.u === u && x.f === f && x.m === m);
            if (existing && existing.id) {
                await db.collection(SUB_COL).doc(existing.id).update({
                    ans, ts: Date.now(), sp
                });
                existing.ans = ans; existing.sp = sp; existing.ts = Date.now();
            } else {
                const ref = await db.collection(SUB_COL).add({
                    u, f, m, ans, ts: Date.now(), sp
                });
                cachedSubs.push({ id: ref.id, u, f, m, ans, sp, ts: Date.now() });
            }
        } catch (err) {
            console.error('saveSub error:', err);
            alert('Failed to save. Check your connection.');
        }
    },

    async updateAns(folder, m, ans) {
        try {
            const existing = cachedSubs.find(x => x.u === curUser && x.f === folder && x.m === m);
            if (existing && existing.id) {
                await db.collection(SUB_COL).doc(existing.id).update({
                    ans, ts: Date.now()
                });
            }
        } catch (err) {
            console.error('updateAns error:', err);
            alert('Failed to save. Check connection.');
        }
    },

    cmts() { return cachedCmts; },

    async addCmt(f, m, q, u, t) {
        try {
            const ref = await db.collection(CMT_COL).add({ f, m, q, u, t, time: Date.now() });
            const key = f + '-' + m + '-' + q;
            if (!cachedCmts[key]) cachedCmts[key] = [];
            cachedCmts[key].push({ f, m, q, u, t, time: Date.now(), id: ref.id });
            return cachedCmts;
        } catch (err) {
            console.error('addCmt error:', err);
            alert('Failed to post comment. Check your connection.');
            return cachedCmts;
        }
    }
};

/* ============================================================
   FOLDER CARDS
   ============================================================ */
function renderFolderCards() {
    const row = $('folderRow');
    if (!row) return;
    const subs = Store.subs();
    row.innerHTML = Object.entries(CFG.FOLDERS).map(([key, f]) => {
        const mine = subs.filter(s => s.u === curUser && s.f === key).length;
        const pct = Math.round((mine / CFG.MODELS_PER_FOLDER) * 100);
        const active = key === activeFolder ? 'active' : '';
        return `
            <div class="folder-card ${active}" onclick="openFolder('${key}')">
                <div class="folder-icon">${f.icon}</div>
                <div class="folder-info">
                    <div class="folder-name">${f.label}</div>
                    <div class="folder-meta">${mine}/${CFG.MODELS_PER_FOLDER} done · ${pct}%</div>
                    <div class="folder-bar"><div class="folder-bar-fill" style="width:${pct}%;"></div></div>
                </div>
            </div>
        `;
    }).join('');
}

function openFolder(key) {
    activeFolder = key;
    renderFolderCards();
    renderDash();
}

/* ============================================================
   DASHBOARD RENDER
   ============================================================ */
function renderDash() {
    if (!curUser) return;

    try {
        const f = activeFolder;
        const fLabel = CFG.FOLDERS[f].label;
        const TOTAL_MODELS = CFG.MODELS_PER_FOLDER;

        const titleEl = $('dashTitle');
        if (titleEl) titleEl.textContent = CFG.FOLDERS[f].icon + ' ' + fLabel + ' — Model Sets';

        const subs = Store.subsFor(f);
        const mine = subs.filter(s => s.u === curUser);
        const given = mine.length;
        const pending = TOTAL_MODELS - given;
        const tSec = mine.reduce((s, x) => s + (x.sp || 0), 0);
        const tStr = tSec >= 3600
            ? Math.floor(tSec / 3600) + 'h ' + Math.floor((tSec % 3600) / 60) + 'm'
            : Math.floor(tSec / 60) + 'm';

        const userCounts = {};
        CFG.USERS.forEach(u => { userCounts[u] = subs.filter(s => s.u === u).length; });
        const sorted = CFG.USERS.slice().sort((a, b) => userCounts[b] - userCounts[a]);
        const rank = sorted.indexOf(curUser) + 1;

        const globalDone = new Set(subs.map(s => s.u + '-' + s.m)).size;
        const totalPossible = CFG.USERS.length * TOTAL_MODELS;
        const globalPct = totalPossible ? Math.round((globalDone / totalPossible) * 100) : 0;

        const sGiven = $('statGiven'); if (sGiven) sGiven.textContent = given;
        const sPending = $('statPending'); if (sPending) sPending.textContent = pending;
        const sTime = $('statTime'); if (sTime) sTime.textContent = tStr;
        const sRank = $('statRank'); if (sRank) sRank.textContent = rank + '/' + CFG.USERS.length;
        const sGlobal = $('statGlobal'); if (sGlobal) sGlobal.textContent = globalPct + '%';

        const pendingTest = JSON.parse(sessionStorage.getItem('ms_pending_' + curUser) || 'null');

        const list = $('modelList');
        if (!list) return;
        list.innerHTML = '';

        for (let m = 1; m <= TOTAL_MODELS; m++) {
            const mySub = mine.find(s => s.m === m);
            const taken = !!mySub;
            const totalSubbed = subs.filter(s => s.m === m).length;
            const hasPending = pendingTest && pendingTest.f === f && pendingTest.m === m && !taken;

            let skippedCount = 0;
            if (mySub && mySub.ans && typeof mySub.ans === 'object') {
                for (let q = 1; q <= CFG.TOTAL_QS; q++) {
                    if (mySub.ans[q] === null || mySub.ans[q] === undefined) skippedCount++;
                }
            }

            const row = document.createElement('div');
            row.className = 'model-row ' + (hasPending ? 'resume' : taken ? 'done' : 'pending');
            row.innerHTML = `
                <div class="mi">
                    <span class="num">${String(m).padStart(2, '0')}</span>
                    <span class="status">
                        ${hasPending
                            ? '<span class="resume-badge">⏸ Interrupted · Q' + pendingTest.curQ + '</span>'
                            : taken
                                ? skippedCount > 0
                                    ? '<span class="done-badge">✓ Completed</span> <span class="skip-badge">(' + skippedCount + ' skipped)</span>'
                                    : '<span class="done-badge">✓ Completed</span>'
                                : '○ Not taken'}
                        · <span style="color:var(--text-muted);font-size:9px;">${totalSubbed}/${CFG.USERS.length} submitted</span>
                    </span>
                </div>
                <div class="ma">
                    ${hasPending
                        ? `<button class="btn btn-warning btn-sm" onclick="resumeTest()">▶ Continue</button>`
                        : !taken
                            ? `<button class="btn btn-blue btn-sm" onclick="startTest(${m})">Test</button>`
                            : ''}
                    ${taken ? `<button class="btn btn-outline btn-sm" onclick="viewModel(${m})">View</button>` : ''}
                    ${taken && skippedCount > 0
                        ? `<button class="btn btn-outline btn-sm" style="border-color:var(--orange);color:var(--orange);" onclick="answerSkipped(${m})">✏️ Ans ${skippedCount}</button>`
                        : ''}
                    ${hasPending ? `<button class="btn btn-sm btn-ghost" onclick="discardPending()" style="color:var(--text-muted);">✕</button>` : ''}
                </div>
            `;
            list.appendChild(row);
        }
    } catch (err) {
        console.error('renderDash crashed:', err);
        const list = $('modelList');
        if (list) {
            list.innerHTML = `
                <div style="padding:20px;background:rgba(239,68,68,0.1);border:1px solid var(--red);border-radius:8px;color:var(--red);text-align:center;">
                    ⚠️ Dashboard render error: ${err.message}
                </div>
            `;
        }
    }
}

/* ============================================================
   PENDING TEST
   ============================================================ */
function persistTest() {
    if (!test || !curUser || isReviewMode) return;
    sessionStorage.setItem('ms_pending_' + curUser, JSON.stringify({
        f: test.f, m: test.m, ans: test.ans, curQ: test.curQ, timer: test.timer
    }));
}

function resumeTest() {
    const raw = sessionStorage.getItem('ms_pending_' + curUser);
    if (!raw) return;
    const p = JSON.parse(raw);

    if (p.f !== activeFolder) {
        activeFolder = p.f;
        renderFolderCards();
    }

    isReviewMode = false;
    test = { f: p.f, m: p.m, ans: p.ans, curQ: p.curQ, timer: p.timer, interval: null };

    $('testTitle').textContent = CFG.FOLDERS[p.f].label + ' · Set ' + String(p.m).padStart(2, '0');
    $('submitBtn').style.display = 'inline-flex';
    $('reviewSaveBtn').style.display = 'none';
    $('reviewBadge').style.display = 'none';
    $('testHint').textContent = 'Leave blank = Skip · Auto-submit at 0:00';
    show('pageTest');
    renderQ();
    startTimer();
    sessionStorage.removeItem('ms_pending_' + curUser);
    renderDash();
}

function discardPending() {
    if (confirm('Discard your in-progress test? All unsaved answers will be lost.')) {
        sessionStorage.removeItem('ms_pending_' + curUser);
        renderDash();
    }
}

/* ============================================================
   ANSWER SKIPPED (🔒 restricted review mode)
   ============================================================ */
function answerSkipped(m) {
    const mySub = Store.mySub(activeFolder, m);
    if (!mySub || !mySub.ans) { alert('You must complete the test first.'); return; }

    const skippedList = [];
    for (let q = 1; q <= CFG.TOTAL_QS; q++) {
        if (mySub.ans[q] === null || mySub.ans[q] === undefined) skippedList.push(q);
    }
    if (skippedList.length === 0) { alert('No skipped questions in this set.'); return; }

    isReviewMode = true;
    test = {
        f: activeFolder,
        m,
        ans: JSON.parse(JSON.stringify(mySub.ans)),
        curQ: skippedList[0],
        timer: 0,
        interval: null,
        lockedAnswers: JSON.parse(JSON.stringify(mySub.ans)), // 🔒 frozen snapshot
        skippedList: skippedList
    };

    $('testTitle').textContent = CFG.FOLDERS[activeFolder].label + ' · Set ' + String(m).padStart(2, '0') + ' — Skipped';
    $('testTimer').textContent = '--:--';
    $('testTimer').classList.remove('warning');
    $('submitBtn').style.display = 'none';
    $('reviewSaveBtn').style.display = 'inline-flex';
    $('reviewBadge').style.display = 'inline';
    $('testHint').textContent = '🔒 Only skipped questions are editable.';
    show('pageTest');
    renderQ();
}

async function saveReview() {
    if (!test || !isReviewMode) return;
    saveAns();

    // 🔒 Rebuild from locked snapshot — only skipped Qs can change
    const finalAns = { ...test.lockedAnswers };
    if (test.skippedList) {
        test.skippedList.forEach(q => { finalAns[q] = test.ans[q]; });
    }

    await Store.updateAns(test.f, test.m, finalAns);

    test = null;
    isReviewMode = false;
    document.querySelectorAll('input[name="qo"]').forEach(r => {
        r.checked = false;
        r.disabled = false;
    });
    hide('pageTest');
    renderDash();
}

/* ============================================================
   TEST ENGINE
   ============================================================ */
function startTest(m) {
    if (Store.mySub(activeFolder, m)) {
        alert('Already completed this set.');
        return;
    }

    const raw = sessionStorage.getItem('ms_pending_' + curUser);
    if (raw) {
        const p = JSON.parse(raw);
        if (p.f === activeFolder && p.m === m) {
            if (confirm('You have an interrupted test for this set. Continue where you left off?')) {
                resumeTest();
                return;
            }
            sessionStorage.removeItem('ms_pending_' + curUser);
        }
    }

    isReviewMode = false;
    test = { f: activeFolder, m, ans: {}, curQ: 1, timer: CFG.EXAM_SEC, interval: null };
    for (let i = 1; i <= CFG.TOTAL_QS; i++) test.ans[i] = null;

    persistTest();

    $('testTitle').textContent = CFG.FOLDERS[activeFolder].label + ' · Set ' + String(m).padStart(2, '0');
    $('submitBtn').style.display = 'inline-flex';
    $('reviewSaveBtn').style.display = 'none';
    $('reviewBadge').style.display = 'none';
    $('testHint').textContent = 'Leave blank = Skip · Auto-submit at 0:00';
    show('pageTest');
    renderQ();
    startTimer();
}

function exitTest() {
    if (isReviewMode) {
        if (confirm('Close review? Unsaved changes will be lost.')) {
            test = null;
            isReviewMode = false;
            document.querySelectorAll('input[name="qo"]').forEach(r => {
                r.checked = false;
                r.disabled = false;
            });
            hide('pageTest');
        }
        return;
    }
    if (test && test.interval) { clearInterval(test.interval); test.interval = null; }
    if (confirm('Quit test? Your progress will be lost.')) {
        sessionStorage.removeItem('ms_pending_' + curUser);
        test = null;
        document.querySelectorAll('input[name="qo"]').forEach(r => r.checked = false);
        hide('pageTest');
        renderDash();
    }
}

function renderQ() {
    if (!test) return;
    const q = test.curQ;
    $('qNum').textContent = 'Q' + String(q).padStart(2, '0');
    $('testProgress').textContent = q + ' / ' + CFG.TOTAL_QS;

    // 🔒 Determine if this Q is editable
    const isEditable = !isReviewMode || (test.skippedList && test.skippedList.includes(q));

    const radios = document.querySelectorAll('input[name="qo"]');
    const sel = test.ans[q];
    radios.forEach(r => {
        r.checked = (r.value === sel);
        r.disabled = !isEditable;
        r.closest('label').classList.toggle('selected', r.value === sel);
        r.closest('label').classList.toggle('locked', !isEditable);
    });

    // 🔒 Lock note
    const qBox = document.querySelector('.q-box');
    if (qBox) {
        let lockNote = qBox.querySelector('.lock-note');
        if (isReviewMode) {
            if (!lockNote) {
                lockNote = document.createElement('div');
                lockNote.className = 'lock-note';
                qBox.insertBefore(lockNote, qBox.querySelector('.q-opts'));
            }
            lockNote.textContent = isEditable
                ? '✏️ Skipped — edit and save below.'
                : '🔒 Already submitted — cannot be changed.';
            lockNote.style.color = isEditable ? 'var(--orange)' : 'var(--text-muted)';
            lockNote.style.display = 'block';
        } else if (lockNote) {
            lockNote.style.display = 'none';
        }
    }

    updatePalette();

    if (isReviewMode && test.skippedList) {
        const idx = test.skippedList.indexOf(q);
        $('prevBtn').disabled = (idx <= 0);
        $('nextBtn').disabled = (idx >= test.skippedList.length - 1);
    } else {
        $('prevBtn').disabled = (q === 1);
        $('nextBtn').disabled = (q === CFG.TOTAL_QS);
    }
}

function updatePalette() {
    if (!test) return;
    const p = $('qPalette');
    if (!p) return;
    p.innerHTML = '';

    // 🔒 In review mode, show ONLY skipped questions
    if (isReviewMode && test.skippedList) {
        test.skippedList.forEach(qNum => {
            const a = test.ans[qNum];
            let cls = '';
            if (qNum === test.curQ) cls = 'current';
            else if (a !== null && a !== undefined) cls = 'done';
            const btn = document.createElement('button');
            btn.className = cls;
            btn.textContent = qNum;
            btn.onclick = () => goQ(qNum);
            p.appendChild(btn);
        });
        return;
    }

    // Normal test mode
    for (let i = 1; i <= CFG.TOTAL_QS; i++) {
        const a = test.ans[i];
        let cls = '';
        if (i === test.curQ) cls = 'current';
        else if (a !== null && a !== undefined) cls = 'done';
        const btn = document.createElement('button');
        btn.className = cls;
        btn.textContent = i;
        btn.onclick = () => goQ(i);
        p.appendChild(btn);
    }
}

function saveAns() {
    if (!test) return;

    // 🔒 Block writes to locked answers
    if (isReviewMode) {
        if (!test.skippedList || !test.skippedList.includes(test.curQ)) return;
    }

    const radios = document.querySelectorAll('input[name="qo"]');
    let sel = null;
    radios.forEach(r => { if (r.checked) sel = r.value; });
    test.ans[test.curQ] = sel;
    if (!isReviewMode) persistTest();
}

function goQ(n) {
    saveAns();
    // 🔒 Block jumping to non-skipped Qs in review mode
    if (isReviewMode && test.skippedList && !test.skippedList.includes(n)) return;
    test.curQ = n;
    renderQ();
    if (!isReviewMode) persistTest();
}

function nextQ() {
    saveAns();
    if (isReviewMode && test.skippedList) {
        const idx = test.skippedList.indexOf(test.curQ);
        if (idx < test.skippedList.length - 1) {
            test.curQ = test.skippedList[idx + 1];
            renderQ();
        }
        return;
    }
    if (test.curQ < CFG.TOTAL_QS) {
        test.curQ++;
        renderQ();
        if (!isReviewMode) persistTest();
    }
}

function prevQ() {
    saveAns();
    if (isReviewMode && test.skippedList) {
        const idx = test.skippedList.indexOf(test.curQ);
        if (idx > 0) {
            test.curQ = test.skippedList[idx - 1];
            renderQ();
        }
        return;
    }
    if (test.curQ > 1) {
        test.curQ--;
        renderQ();
        if (!isReviewMode) persistTest();
    }
}

function startTimer() {
    if (test.interval) clearInterval(test.interval);
    updTimer();
    test.interval = setInterval(() => {
        test.timer--;
        updTimer();
        if (test.timer % 5 === 0) persistTest();
        if (test.timer <= 0) {
            clearInterval(test.interval);
            test.interval = null;
            alert('⏰ Time is up! Auto-submitting.');
            submitTest();
        }
    }, 1000);
}

function updTimer() {
    if (!test) return;
    const m = Math.floor(test.timer / 60);
    const s = test.timer % 60;
    const el = $('testTimer');
    if (!el) return;
    el.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    el.classList.toggle('warning', test.timer <= 120);
}

async function submitTest() {
    if (!test) return;
    if (test.interval) { clearInterval(test.interval); test.interval = null; }
    saveAns();

    const sp = CFG.EXAM_SEC - test.timer;
    await Store.saveSub({ u: curUser, f: test.f, m: test.m, ans: { ...test.ans }, sp });
    sessionStorage.removeItem('ms_pending_' + curUser);

    test = null;
    document.querySelectorAll('input[name="qo"]').forEach(r => r.checked = false);
    hide('pageTest');
    renderDash();
}

/* ============================================================
   VIEW ENGINE
   ============================================================ */
function viewModel(m) {
    const f = activeFolder;
    viewingCtx = { f, m };
    const subs = Store.subsFor(f);
    const ms = subs.filter(s => s.m === m);

    const mySub = ms.find(s => s.u === curUser);
    if (!mySub) {
        alert('You must take this test first before viewing comparisons!');
        return;
    }

    $('viewTitle').textContent = CFG.FOLDERS[f].label + ' · Set ' + String(m).padStart(2, '0') + ' — Comparison';

    const uAns = {}, uSub = {};
    CFG.USERS.forEach(u => {
        const s = ms.find(x => x.u === u);
        if (s) { uAns[u] = s.ans || {}; uSub[u] = true; }
        else { uAns[u] = {}; uSub[u] = false; }
    });

    // 🔀 Sort: submitters first, then non-submitters (preserve CFG order within each group)
    const orderedUsers = CFG.USERS.slice().sort((a, b) => {
        if (uSub[a] && !uSub[b]) return -1;
        if (!uSub[a] && uSub[b]) return 1;
        return CFG.USERS.indexOf(a) - CFG.USERS.indexOf(b);
    });

    const totalSubmitted = CFG.USERS.filter(u => uSub[u]).length;

    const mismatches = [];
    for (let q = 1; q <= CFG.TOTAL_QS; q++) {
        const answers = {};
        let anyAnswered = false;

        CFG.USERS.forEach(u => {
            if (uSub[u]) {
                const a = uAns[u] ? uAns[u][q] : null;
                answers[u] = a;
                if (a !== null && a !== undefined) anyAnswered = true;
            } else {
                answers[u] = '__NA__';
            }
        });

        if (!anyAnswered) continue;

        const validAnswers = CFG.USERS
            .map(u => answers[u])
            .filter(a => a !== null && a !== undefined && a !== '__NA__');

        const allSubmitted = CFG.USERS.every(u => uSub[u]);
        const allSame = validAnswers.length > 0 && validAnswers.every(a => a === validAnswers[0]);

        if (!allSubmitted || !allSame) {
            mismatches.push({ q, answers });
        }
    }

    renderView(f, m, mismatches, uSub, uAns, mySub, totalSubmitted, orderedUsers);
    show('pageView');
}

function renderView(f, m, mismatches, uSub, uAns, mySub, totalSubmitted, orderedUsers) {
    const el = $('viewBody');
    if (!el) return;

    if (!mySub || typeof mySub.sp !== 'number') {
        el.innerHTML = '<p style="padding:40px;text-align:center;color:var(--text-muted);">No submission data found for you in this set.</p>';
        return;
    }

    const users = orderedUsers || CFG.USERS;
    const myTimeStr = Math.floor(mySub.sp / 60) + 'm ' + (mySub.sp % 60) + 's';

    if (mismatches.length === 0) {
        el.innerHTML = `
            <div class="view-stats">
                <div class="vs"><div class="vs-lbl">Mismatches</div><div class="vs-val">0</div></div>
                <div class="vs"><div class="vs-lbl">Submitted</div><div class="vs-val">${totalSubmitted}/${CFG.USERS.length}</div></div>
                <div class="vs"><div class="vs-lbl">Questions</div><div class="vs-val">${CFG.TOTAL_QS}</div></div>
                <div class="vs"><div class="vs-lbl">Your Time</div><div class="vs-val">${myTimeStr}</div></div>
            </div>
            <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:40px;text-align:center;">
                <div style="font-size:40px;margin-bottom:10px;">🎉</div>
                <h3 style="color:var(--text-primary);">No Mismatches!</h3>
                <p style="color:var(--text-muted);font-size:12px;margin-top:6px;">
                    ${totalSubmitted < CFG.USERS.length
                        ? 'Only ' + totalSubmitted + '/' + CFG.USERS.length + ' friends have submitted so far.<br>Check back later.'
                        : 'Everyone agrees on every question.'}
                </p>
            </div>
        `;
        return;
    }

    // 📊 Sort mismatches by strongest disagreement first
    const sortedMismatches = mismatches.slice().sort((a, b) => {
        const score = (mm) => {
            const vals = CFG.USERS.map(u => mm.answers[u]).filter(x => x && x !== '__NA__');
            if (!vals.length) return 0;
            const counts = { A: 0, B: 0, C: 0, D: 0 };
            vals.forEach(v => { if (counts[v] !== undefined) counts[v]++; });
            const max = Math.max(...Object.values(counts));
            return vals.length - max; // higher = more disagreement
        };
        return score(b) - score(a);
    });

    let html = `
        <div class="view-stats">
            <div class="vs"><div class="vs-lbl">Mismatches</div><div class="vs-val">${mismatches.length}</div></div>
            <div class="vs"><div class="vs-lbl">Submitted</div><div class="vs-val">${totalSubmitted}/${CFG.USERS.length}</div></div>
            <div class="vs"><div class="vs-lbl">Questions</div><div class="vs-val">${CFG.TOTAL_QS}</div></div>
            <div class="vs"><div class="vs-lbl">Your Time</div><div class="vs-val">${myTimeStr}</div></div>
        </div>
        <div class="view-note">
            Showing <strong>${mismatches.length}</strong> questions where answers differ or not all friends have submitted.
            <span style="color:var(--blue-glow);">Majority vote</span> = most common answer.
        </div>
        <table class="vtable">
            <thead><tr>
                <th>Q#</th>
                ${users.map(u => `<th class="${uSub[u] ? 'th-sub' : 'th-nosub'}">${u}</th>`).join('')}
                <th>Majority<br><span style="font-size:8px;opacity:0.7;font-weight:500;">${mismatches.length} mismatches</span></th>
                <th>💬</th>
            </tr></thead>
            <tbody>
    `;

    sortedMismatches.forEach(({ q, answers }) => {
        const counts = { A: 0, B: 0, C: 0, D: 0 };
        CFG.USERS.forEach(u => {
            const a = answers[u];
            if (a && a !== '__NA__' && a !== null && counts.hasOwnProperty(a)) counts[a]++;
        });
        const maxCount = Math.max(...Object.values(counts));
        const topOptions = Object.keys(counts).filter(k => counts[k] === maxCount && maxCount > 0);
        let vote, vClass;
        if (topOptions.length === 0) { vote = '—'; vClass = 'vc'; }
        else if (topOptions.length === 1) { vote = '✓ ' + topOptions[0] + ' (' + maxCount + 'x)'; vClass = 'vc'; }
        else { vote = '⚖ Tie: ' + topOptions.join('/'); vClass = 'vc tie'; }

        const cmts = Store.cmts();
        const key = f + '-' + m + '-' + q;
        const hasCmt = cmts[key] && cmts[key].length > 0;

        html += `
            <tr class="mrow">
                <td><strong>${String(q).padStart(2, '0')}</strong></td>
                ${users.map(u => {
                    const a = answers[u];
                    if (a === '__NA__') return '<td class="ac na">—<span class="sub-lbl">no test</span></td>';
                    if (a === null || a === undefined) return '<td class="ac sk">⏭<span class="sub-lbl">skipped</span></td>';
                    return '<td class="ac">' + a + '</td>';
                }).join('')}
                <td class="${vClass}">${vote}</td>
                <td><button class="cb" onclick="toggleCmt('${f}',${m},${q})">${hasCmt ? '💬 ' + cmts[key].length : 'Comment'}</button></td>
            </tr>
            <tr id="cmtR-${f}-${m}-${q}" style="display:none;">
                <td colspan="${users.length + 3}" style="padding:8px;">
                    <div class="cp">
                        <div class="ct">💬 Question ${String(q).padStart(2, '0')} — Discussion</div>
                        <div id="cmtL-${f}-${m}-${q}"></div>
                        <div class="ci">
                            <input type="text" id="cmtI-${f}-${m}-${q}" placeholder="Conclude the right answer..." />
                            <button class="btn btn-blue btn-sm" onclick="postCmt('${f}',${m},${q})">Post</button>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    });

    html += '</tbody></table>';
    el.innerHTML = html;

    sortedMismatches.forEach(({ q }) => renderCmt(f, m, q));
}

/* ============================================================
   COMMENTS
   ============================================================ */
function toggleCmt(f, m, q) {
    const row = $('cmtR-' + f + '-' + m + '-' + q);
    if (!row) return;
    if (!row.style.display || row.style.display === 'none') {
        row.style.display = 'table-row';
        renderCmt(f, m, q);
    } else {
        row.style.display = 'none';
    }
}

function renderCmt(f, m, q) {
    const c = Store.cmts();
    const key = f + '-' + m + '-' + q;
    const list = $('cmtL-' + f + '-' + m + '-' + q);
    if (!list) return;
    const items = c[key] || [];
    if (!items.length) {
        list.innerHTML = '<p style="font-size:10px;color:var(--text-muted);padding:5px 0;">No comments yet. Start the discussion!</p>';
        return;
    }
    list.innerHTML = items.map(x => `
        <div class="cm">
            <span class="cu">${x.u}</span>
            <span class="ctm">${new Date(x.time).toLocaleString()}</span>
            <span class="ctx">${x.t}</span>
        </div>
    `).join('');
}

async function postCmt(f, m, q) {
    const inp = $('cmtI-' + f + '-' + m + '-' + q);
    if (!inp || !inp.value.trim()) return;
    await Store.addCmt(f, m, q, curUser, inp.value.trim());
    inp.value = '';
    renderCmt(f, m, q);
    viewModel(m);
}

function closeView() {
    hide('pageView');
    viewingCtx = null;
}

/* ============================================================
   EXPORT
   ============================================================ */
function exportComparison() {
    const f = activeFolder;
    const subs = Store.subsFor(f);
    if (subs.length === 0) { alert('No data to export yet.'); return; }

    let text = '=== ' + CFG.FOLDERS[f].label + ' — Comparison Export ===\n';
    text += 'Exported: ' + new Date().toLocaleString() + '\n';
    text += 'Users: ' + CFG.USERS.join(', ') + '\n\n';

    for (let m = 1; m <= CFG.MODELS_PER_FOLDER; m++) {
        const ms = subs.filter(s => s.m === m);
        if (ms.length === 0) continue;

        const uAns = {}, uSub = {};
        CFG.USERS.forEach(u => {
            const s = ms.find(x => x.u === u);
            if (s) { uAns[u] = s.ans || {}; uSub[u] = true; }
            else { uAns[u] = {}; uSub[u] = false; }
        });

        let hasMismatch = false;
        let lines = [];
        for (let q = 1; q <= CFG.TOTAL_QS; q++) {
            const ans = {};
            let any = false;
            CFG.USERS.forEach(u => {
                if (uSub[u]) {
                    const a = uAns[u][q];
                    ans[u] = a;
                    if (a !== null && a !== undefined) any = true;
                } else { ans[u] = '—'; }
            });
            if (!any) continue;
            const valid = CFG.USERS.map(u => ans[u]).filter(a => a && a !== '—');
            if (valid.length < 2) continue;
            if (!valid.every(a => a === valid[0])) {
                hasMismatch = true;
                lines.push('  Q' + String(q).padStart(2, '0') + ': ' +
                    CFG.USERS.map(u => u + '=' + (ans[u] || '⏭')).join(' | '));
            }
        }

        if (hasMismatch) {
            text += '--- Set ' + String(m).padStart(2, '0') + ' ---\n';
            text += lines.join('\n') + '\n\n';
        }
    }

    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = f.toLowerCase() + '_comparison_' + Date.now() + '.txt';
    a.click();
    URL.revokeObjectURL(a.href);
}

function exportView() {
    if (!viewingCtx) return;
    const { f, m } = viewingCtx;
    const subs = Store.subsFor(f);
    const ms = subs.filter(s => s.m === m);

    let text = '=== ' + CFG.FOLDERS[f].label + ' · Set ' + String(m).padStart(2, '0') + ' — Comparison ===\n';
    text += 'Exported: ' + new Date().toLocaleString() + '\n\n';

    const uAns = {}, uSub = {};
    CFG.USERS.forEach(u => {
        const s = ms.find(x => x.u === u);
        if (s) { uAns[u] = s.ans || {}; uSub[u] = true; }
        else { uAns[u] = {}; uSub[u] = false; }
    });

    for (let q = 1; q <= CFG.TOTAL_QS; q++) {
        const answers = {};
        let any = false;
        CFG.USERS.forEach(u => {
            if (uSub[u]) {
                const a = uAns[u][q];
                answers[u] = a;
                if (a !== null && a !== undefined) any = true;
            } else { answers[u] = '—'; }
        });
        if (!any) continue;

        const valid = CFG.USERS.map(u => answers[u]).filter(a => a && a !== '—');
        const allSame = valid.length > 0 && valid.every(a => a === valid[0]);
        const allSub = CFG.USERS.every(u => uSub[u]);

        if (!allSub || !allSame) {
            text += 'Q' + String(q).padStart(2, '0') + ': ';
            text += CFG.USERS.map(u => u + '=[' + (answers[u] || '⏭') + ']').join(' | ');

            const counts = { A: 0, B: 0, C: 0, D: 0 };
            CFG.USERS.forEach(u => {
                const a = answers[u];
                if (a && a !== '—' && counts.hasOwnProperty(a)) counts[a]++;
            });
            const max = Math.max(...Object.values(counts));
            const top = Object.keys(counts).filter(k => counts[k] === max && max > 0);
            text += ' → Majority: ' + (top.length === 1 ? top[0] + ' (' + max + 'x)' : 'Tie: ' + top.join('/'));
            text += '\n';
        }
    }

    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = f.toLowerCase() + '_set' + String(m).padStart(2, '0') + '_comparison.txt';
    a.click();
    URL.revokeObjectURL(a.href);
}

/* ============================================================
   HOT QUESTIONS
   ============================================================ */
function showHotQuestions() {
    const f = activeFolder;
    const subs = Store.subsFor(f);
    if (subs.length < 2) {
        alert('Need at least 2 submissions in ' + CFG.FOLDERS[f].label + '.');
        return;
    }

    const qHeat = {};
    for (let m = 1; m <= CFG.MODELS_PER_FOLDER; m++) {
        const ms = subs.filter(s => s.m === m);
        if (ms.length < 2) continue;

        const uAns = {}, uSub = {};
        CFG.USERS.forEach(u => {
            const s = ms.find(x => x.u === u);
            if (s) { uAns[u] = s.ans || {}; uSub[u] = true; }
            else { uAns[u] = {}; uSub[u] = false; }
        });

        for (let q = 1; q <= CFG.TOTAL_QS; q++) {
            const ans = {};
            let any = false;
            CFG.USERS.forEach(u => {
                if (uSub[u]) {
                    const a = uAns[u][q];
                    ans[u] = a;
                    if (a !== null && a !== undefined) any = true;
                } else { ans[u] = '—'; }
            });
            if (!any) continue;
            const valid = CFG.USERS.map(u => ans[u]).filter(a => a && a !== '—');
            if (valid.length >= 2 && !valid.every(a => a === valid[0])) {
                qHeat[q] = (qHeat[q] || 0) + 1;
            }
        }
    }

    const sorted = Object.entries(qHeat).sort((a, b) => b[1] - a[1]);
    const body = $('hotBody');
    if (!body) return;

    if (sorted.length === 0) {
        body.innerHTML = '<p style="color:var(--text-muted);text-align:center;">No hot questions found yet.</p>';
    } else {
        body.innerHTML = `
            <p style="color:var(--text-secondary);margin-bottom:10px;font-size:11px;">
                🔥 Hot questions in <strong>${CFG.FOLDERS[f].label}</strong> — most disagreements across sets:
            </p>
            <table class="vtable">
                <thead><tr><th>Rank</th><th>Question</th><th>Mismatches</th><th>Heat</th></tr></thead>
                <tbody>
                    ${sorted.slice(0, 20).map(([q, count], i) => {
                        const barW = Math.min(100, Math.round((count / sorted[0][1]) * 100));
                        const emoji = count >= 5 ? '🔥' : count >= 3 ? '⚡' : '📌';
                        return `<tr>
                            <td>#${i + 1}</td>
                            <td><strong>Q${String(q).padStart(2, '0')}</strong></td>
                            <td>${count}</td>
                            <td><div style="display:flex;align-items:center;gap:5px;">
                                <div style="height:7px;width:${barW}px;background:var(--blue-mid);border-radius:4px;max-width:110px;"></div>
                                ${emoji}
                            </div></td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        `;
    }

    show('hotModal');
}

function closeHot() { hide('hotModal'); }

/* ============================================================
   🔒 PER-USER LOCK (SHA-256 + Firestore)
   ============================================================ */
async function hashPassword(password, salt) {
    const enc = new TextEncoder();
    const data = enc.encode(salt + '::' + password + '::modelset');
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, '0')).join('');
}

function makeSalt() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function loadUserProfile() {
    if (typeof db === 'undefined' || !db) return;
    try {
        const snap = await db.collection(USER_COL).doc(curUser).get();
        if (snap.exists) {
            userProfile = { u: curUser, ...snap.data() };
        } else {
            userProfile = { u: curUser, locked: false };
        }
    } catch (e) {
        console.warn('Could not load user profile:', e);
        userProfile = { u: curUser, locked: false };
    }

    if (userProfile.theme && userProfile.theme !== 'system') {
        document.documentElement.setAttribute('data-theme', userProfile.theme);
    }

    if (!userProfile.locked && !sessionStorage.getItem('ms_setup_done_' + curUser)) {
        openLockModal('set');
    } else if (userProfile.locked && !sessionStorage.getItem('ms_unlocked_' + curUser)) {
        openLockModal('unlock');
    } else {
        startSettingsInterval();
    }
}

function openLockModal(mode) {
    lockMode = mode;
    const m = $('lockModal');
    if (!m) return;
    m.style.display = 'flex';

    const t = $('lockTitle'), d = $('lockDesc'), b = $('lockBtn');
    const c = $('lockCancelBtn'), h = $('lockHint');
    const p1 = $('lockPass1'), p2 = $('lockPass2');
    $('lockErr').textContent = '';
    p1.value = p2.value = '';
    if (h) h.value = userProfile?.hint || '';

    if (mode === 'set') {
        t.textContent = '🔒 Secure Your Dashboard';
        d.textContent = 'Set a private password. You\'ll need it every time you open your dashboard on a new device. Others cannot access your test results without it.';
        b.textContent = 'Set Password';
        b.className = 'btn btn-blue gate-btn';
        c.style.display = 'none';
        h.style.display = 'block';
        p2.style.display = 'block';
    } else if (mode === 'change') {
        t.textContent = '🔑 Change Your Password';
        d.textContent = 'Enter and confirm your new dashboard password.';
        b.textContent = 'Update Password';
        b.className = 'btn btn-blue gate-btn';
        c.style.display = 'block';
        h.style.display = 'block';
        p2.style.display = 'block';
    } else {
        t.textContent = '🔐 Enter Your Password';
        let txt = 'Welcome back, ' + curUser + '. Enter your dashboard password to continue.';
        if (userProfile?.hint) txt += '\n\nHint: ' + userProfile.hint;
        d.textContent = txt;
        b.textContent = 'Unlock →';
        b.className = 'btn btn-blue gate-btn';
        c.style.display = 'block';
        h.style.display = 'none';
        p2.style.display = 'none';
    }
    setTimeout(() => p1.focus(), 100);
}

function cancelLock() {
    if (lockMode === 'unlock') {
        logout();
        return;
    }
    hide('lockModal');
}

async function submitLock() {
    const p1 = $('lockPass1').value;
    const p2 = $('lockPass2').value;
    const hint = ($('lockHint')?.value || '').trim();
    const err = $('lockErr');
    err.textContent = '';

    if (!p1 || p1.length < 4) { err.textContent = 'Password must be at least 4 characters.'; return; }

    if (lockMode === 'unlock') {
        const hash = await hashPassword(p1, userProfile.salt);
        if (hash === userProfile.hash) {
            sessionStorage.setItem('ms_unlocked_' + curUser, '1');
            hide('lockModal');
            startSettingsInterval();
        } else {
            err.textContent = '❌ Wrong password.';
            $('lockPass1').value = '';
        }
        return;
    }

    if (p1 !== p2) { err.textContent = 'Passwords do not match.'; return; }

    try {
        const salt = makeSalt();
        const hash = await hashPassword(p1, salt);
        await db.collection(USER_COL).doc(curUser).set({
            u: curUser,
            locked: true,
            hash,
            salt,
            hint: hint || '',
            theme: userProfile?.theme || 'system',
            updatedAt: Date.now(),
            createdAt: userProfile?.createdAt || Date.now()
        }, { merge: true });

        userProfile = { ...userProfile, locked: true, hash, salt, hint };
        sessionStorage.setItem('ms_unlocked_' + curUser, '1');
        sessionStorage.setItem('ms_setup_done_' + curUser, '1');

        $('lockTitle').textContent = '✅ Done!';
        $('lockDesc').textContent = 'Your dashboard is now protected.';
        setTimeout(() => {
            hide('lockModal');
            startSettingsInterval();
        }, 700);
    } catch (e) {
        console.error(e);
        err.textContent = 'Failed to save. Check your connection.';
    }
}

/* ============================================================
   ⚙️ SETTINGS PANEL
   ============================================================ */
function openSettings() {
    const m = $('settingsModal');
    if (!m) return;
    m.style.display = 'flex';

    $('setUserName').textContent = curUser;
    const start = parseInt(sessionStorage.getItem('ms_session_start_' + curUser) || Date.now(), 10);
    $('setSessionStart').textContent = new Date(start).toLocaleTimeString();

    if (userProfile?.locked) {
        $('setLockStatus').textContent = '🔒 Enabled';
        $('setLockStatus').style.color = 'var(--green)';
        $('hintRow').style.display = userProfile.hint ? 'flex' : 'none';
        $('setLockHint').textContent = userProfile.hint || '—';
    } else {
        $('setLockStatus').textContent = '○ Not set';
        $('setLockStatus').style.color = 'var(--text-muted)';
        $('hintRow').style.display = 'none';
    }

    const subs = Store.subs();
    const apta = subs.filter(s => s.u === curUser && s.f === 'ABTA').length;
    const qb = subs.filter(s => s.u === curUser && s.f === 'QUESTION_BUNCH').length;
    const tSec = subs.filter(s => s.u === curUser).reduce((a, x) => a + (x.sp || 0), 0);
    const tStr = tSec >= 3600
        ? Math.floor(tSec / 3600) + 'h ' + Math.floor((tSec % 3600) / 60) + 'm'
        : Math.floor(tSec / 60) + 'm';
    $('setAptaCount').textContent = apta + '/' + CFG.MODELS_PER_FOLDER;
    $('setQbCount').textContent = qb + '/' + CFG.MODELS_PER_FOLDER;
    $('setTotalTime').textContent = tStr;
    $('setRank').textContent = $('statRank').textContent;

    const t = userProfile?.theme || 'system';
    $('setTheme').textContent = t.charAt(0).toUpperCase() + t.slice(1);
}

function closeSettings() {
    hide('settingsModal');
}

function changeLockPassword() {
    closeSettings();
    openLockModal('change');
}

async function removeLock() {
    if (!confirm('Remove dashboard lock? Anyone with your name can access your data.')) return;
    try {
        await db.collection(USER_COL).doc(curUser).update({
            locked: false, hash: null, salt: null, hint: '', updatedAt: Date.now()
        });
        userProfile.locked = false;
        sessionStorage.removeItem('ms_unlocked_' + curUser);
        alert('Lock removed.');
        openSettings();
    } catch (e) {
        alert('Failed to remove lock.');
    }
}

/* ============================================================
   🎨 THEME OVERRIDE
   ============================================================ */
function forceTheme(mode) {
    const root = document.documentElement;
    if (mode === 'system') {
        root.removeAttribute('data-theme');
        document.body.style.colorScheme = '';
    } else {
        root.setAttribute('data-theme', mode);
        document.body.style.colorScheme = mode;
    }
    if (userProfile) userProfile.theme = mode;
    if (db && curUser) {
        db.collection(USER_COL).doc(curUser).set({ theme: mode }, { merge: true }).catch(() => {});
    }
    const t = $('setTheme'); if (t) t.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
}

/* ============================================================
   📤 EXPORT MY DATA
   ============================================================ */
function exportMyData() {
    const subs = Store.subs().filter(s => s.u === curUser);
    const data = {
        user: curUser,
        exportedAt: new Date().toISOString(),
        submissions: subs.map(s => ({
            folder: s.f, model: s.m, timeSpent: s.sp,
            answers: s.ans, submittedAt: new Date(s.ts).toISOString()
        }))
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = curUser.toLowerCase() + '_my_data_' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
}

/* ============================================================
   🧹 CLEAR LOCAL CACHE
   ============================================================ */
function clearLocalData() {
    if (!confirm('Clear local cache? You will be signed out and unsaved in-progress tests will be lost.')) return;
    const keys = Object.keys(sessionStorage).filter(k => k.startsWith('ms_'));
    keys.forEach(k => sessionStorage.removeItem(k));
    alert('Local cache cleared.');
    window.location.href = 'index.html';
}

/* ============================================================
   ⏱ SESSION TIMER
   ============================================================ */
function startSettingsInterval() {
    if (settingsInterval) clearInterval(settingsInterval);
    sessionStorage.setItem('ms_session_start_' + curUser,
        sessionStorage.getItem('ms_session_start_' + curUser) || Date.now());

    settingsInterval = setInterval(() => {
        const el = $('setSessionDur');
        if (!el) return;
        const start = parseInt(sessionStorage.getItem('ms_session_start_' + curUser), 10);
        const sec = Math.floor((Date.now() - start) / 1000);
        const m = Math.floor(sec / 60), s = sec % 60;
        el.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }, 1000);
}
function logout() {
    if (test && test.interval) clearInterval(test.interval);
    test = null;
    if (unsubSubs) { try { unsubSubs(); } catch (e) {} unsubSubs = null; }
    if (unsubCmts) { try { unsubCmts(); } catch (e) {} unsubCmts = null; }
    if (settingsInterval) { clearInterval(settingsInterval); settingsInterval = null; }

    if (curUser) {
        sessionStorage.removeItem('ms_unlocked_' + curUser);
        sessionStorage.removeItem('ms_setup_done_' + curUser);
        sessionStorage.removeItem('ms_session_start_' + curUser);
        sessionStorage.removeItem('ms_pending_' + curUser);
    }
    curUser = null;
    sessionStorage.removeItem('ms_user');
    window.location.href = 'index.html';
}

function checkSession() {
    const u = sessionStorage.getItem('ms_user');
    if (!u || !CFG.USERS.includes(u)) {
        window.location.href = 'index.html';
        return false;
    }
    curUser = u;

    if (!sessionStorage.getItem('ms_session_start_' + u)) {
        sessionStorage.setItem('ms_session_start_' + u, Date.now());
    }

    const badge = $('navBadge'); if (badge) badge.textContent = u[0];
    const navUser = $('navUser'); if (navUser) navUser.textContent = u;

    if (!window._clockInt) {
        window._clockInt = setInterval(() => {
            const el = document.getElementById('navClock');
            if (el) el.textContent = new Date().toLocaleTimeString('en-IN', { hour12: false });
        }, 1000);
    }

    try { renderFolderCards(); } catch (e) { console.error('renderFolderCards error:', e); }
    try { renderDash(); } catch (e) { console.error('renderDash error:', e); }

    subscribeToData();

    // 🔒 Load user's lock profile and possibly show lock modal
    loadUserProfile();

    return true;
}

/* ============================================================
   FIRESTORE REAL-TIME
   ============================================================ */
function subscribeToData() {
    if (typeof db === 'undefined' || !db) {
        console.error('Firestore db is undefined. Check firebase-config.js');
        setConnStatus(false);
        return;
    }

    if (unsubSubs) { try { unsubSubs(); } catch (e) {} }
    try {
        unsubSubs = db.collection(SUB_COL).onSnapshot(snap => {
            const subs = [];
            snap.forEach(doc => subs.push({ id: doc.id, ...doc.data() }));
            cachedSubs = subs;
            if (curUser) {
                try { renderFolderCards(); } catch (e) { console.error(e); }
                try { renderDash(); } catch (e) { console.error(e); }
            }
            setConnStatus(true);
        }, err => {
            console.error('subs listener error:', err);
            setConnStatus(false);
        });
    } catch (err) {
        console.error('Failed to attach subs listener:', err);
        setConnStatus(false);
    }

    if (unsubCmts) { try { unsubCmts(); } catch (e) {} }
    try {
        unsubCmts = db.collection(CMT_COL).onSnapshot(snap => {
            const cmts = {};
            snap.forEach(doc => {
                const d = doc.data();
                const key = d.f + '-' + d.m + '-' + d.q;
                if (!cmts[key]) cmts[key] = [];
                cmts[key].push({ ...d, id: doc.id });
            });
            Object.keys(cmts).forEach(k => cmts[k].sort((a, b) => a.time - b.time));
            cachedCmts = cmts;
            setConnStatus(true);
        }, err => {
            console.error('cmts listener error:', err);
            setConnStatus(false);
        });
    } catch (err) {
        console.error('Failed to attach cmts listener:', err);
        setConnStatus(false);
    }
}

/* ============================================================
   STORE
   ============================================================ */
const Store = {
    subs() { return cachedSubs; },
    subsFor(folder) { return cachedSubs.filter(s => s.f === folder); },

    mySub(folder, m) {
        return cachedSubs.find(s => s.u === curUser && s.f === folder && s.m === m);
    },

    async saveSub({ u, f, m, ans, sp }) {
        try {
            const existing = cachedSubs.find(x => x.u === u && x.f === f && x.m === m);
            if (existing && existing.id) {
                await db.collection(SUB_COL).doc(existing.id).update({
                    ans, ts: Date.now(), sp
                });
                existing.ans = ans; existing.sp = sp; existing.ts = Date.now();
            } else {
                const ref = await db.collection(SUB_COL).add({
                    u, f, m, ans, ts: Date.now(), sp
                });
                cachedSubs.push({ id: ref.id, u, f, m, ans, sp, ts: Date.now() });
            }
        } catch (err) {
            console.error('saveSub error:', err);
            alert('Failed to save. Check your connection.');
        }
    },

    async updateAns(folder, m, ans) {
        try {
            const existing = cachedSubs.find(x => x.u === curUser && x.f === folder && x.m === m);
            if (existing && existing.id) {
                await db.collection(SUB_COL).doc(existing.id).update({
                    ans, ts: Date.now()
                });
            }
        } catch (err) {
            console.error('updateAns error:', err);
            alert('Failed to save. Check connection.');
        }
    },

    cmts() { return cachedCmts; },

    async addCmt(f, m, q, u, t) {
        try {
            const ref = await db.collection(CMT_COL).add({ f, m, q, u, t, time: Date.now() });
            const key = f + '-' + m + '-' + q;
            if (!cachedCmts[key]) cachedCmts[key] = [];
            cachedCmts[key].push({ f, m, q, u, t, time: Date.now(), id: ref.id });
            return cachedCmts;
        } catch (err) {
            console.error('addCmt error:', err);
            alert('Failed to post comment. Check your connection.');
            return cachedCmts;
        }
    }
};

/* ============================================================
   FOLDER CARDS
   ============================================================ */
function renderFolderCards() {
    const row = $('folderRow');
    if (!row) return;
    const subs = Store.subs();
    row.innerHTML = Object.entries(CFG.FOLDERS).map(([key, f]) => {
        const mine = subs.filter(s => s.u === curUser && s.f === key).length;
        const pct = Math.round((mine / CFG.MODELS_PER_FOLDER) * 100);
        const active = key === activeFolder ? 'active' : '';
        return `
            <div class="folder-card ${active}" onclick="openFolder('${key}')">
                <div class="folder-icon">${f.icon}</div>
                <div class="folder-info">
                    <div class="folder-name">${f.label}</div>
                    <div class="folder-meta">${mine}/${CFG.MODELS_PER_FOLDER} done · ${pct}%</div>
                    <div class="folder-bar"><div class="folder-bar-fill" style="width:${pct}%;"></div></div>
                </div>
            </div>
        `;
    }).join('');
}

function openFolder(key) {
    activeFolder = key;
    renderFolderCards();
    renderDash();
}

/* ============================================================
   DASHBOARD RENDER
   ============================================================ */
function renderDash() {
    if (!curUser) return;

    try {
        const f = activeFolder;
        const fLabel = CFG.FOLDERS[f].label;
        const TOTAL_MODELS = CFG.MODELS_PER_FOLDER;

        const titleEl = $('dashTitle');
        if (titleEl) titleEl.textContent = CFG.FOLDERS[f].icon + ' ' + fLabel + ' — Model Sets';

        const subs = Store.subsFor(f);
        const mine = subs.filter(s => s.u === curUser);
        const given = mine.length;
        const pending = TOTAL_MODELS - given;
        const tSec = mine.reduce((s, x) => s + (x.sp || 0), 0);
        const tStr = tSec >= 3600
            ? Math.floor(tSec / 3600) + 'h ' + Math.floor((tSec % 3600) / 60) + 'm'
            : Math.floor(tSec / 60) + 'm';

        const userCounts = {};
        CFG.USERS.forEach(u => { userCounts[u] = subs.filter(s => s.u === u).length; });
        const sorted = CFG.USERS.slice().sort((a, b) => userCounts[b] - userCounts[a]);
        const rank = sorted.indexOf(curUser) + 1;

        const globalDone = new Set(subs.map(s => s.u + '-' + s.m)).size;
        const totalPossible = CFG.USERS.length * TOTAL_MODELS;
        const globalPct = totalPossible ? Math.round((globalDone / totalPossible) * 100) : 0;

        const sGiven = $('statGiven'); if (sGiven) sGiven.textContent = given;
        const sPending = $('statPending'); if (sPending) sPending.textContent = pending;
        const sTime = $('statTime'); if (sTime) sTime.textContent = tStr;
        const sRank = $('statRank'); if (sRank) sRank.textContent = rank + '/' + CFG.USERS.length;
        const sGlobal = $('statGlobal'); if (sGlobal) sGlobal.textContent = globalPct + '%';

        const pendingTest = JSON.parse(sessionStorage.getItem('ms_pending_' + curUser) || 'null');

        const list = $('modelList');
        if (!list) return;
        list.innerHTML = '';

        for (let m = 1; m <= TOTAL_MODELS; m++) {
            const mySub = mine.find(s => s.m === m);
            const taken = !!mySub;
            const totalSubbed = subs.filter(s => s.m === m).length;
            const hasPending = pendingTest && pendingTest.f === f && pendingTest.m === m && !taken;

            let skippedCount = 0;
            if (mySub && mySub.ans && typeof mySub.ans === 'object') {
                for (let q = 1; q <= CFG.TOTAL_QS; q++) {
                    if (mySub.ans[q] === null || mySub.ans[q] === undefined) skippedCount++;
                }
            }

            const row = document.createElement('div');
            row.className = 'model-row ' + (hasPending ? 'resume' : taken ? 'done' : 'pending');
            row.innerHTML = `
                <div class="mi">
                    <span class="num">${String(m).padStart(2, '0')}</span>
                    <span class="status">
                        ${hasPending
                            ? '<span class="resume-badge">⏸ Interrupted · Q' + pendingTest.curQ + '</span>'
                            : taken
                                ? skippedCount > 0
                                    ? '<span class="done-badge">✓ Completed</span> <span class="skip-badge">(' + skippedCount + ' skipped)</span>'
                                    : '<span class="done-badge">✓ Completed</span>'
                                : '○ Not taken'}
                        · <span style="color:var(--text-muted);font-size:9px;">${totalSubbed}/${CFG.USERS.length} submitted</span>
                    </span>
                </div>
                <div class="ma">
                    ${hasPending
                        ? `<button class="btn btn-warning btn-sm" onclick="resumeTest()">▶ Continue</button>`
                        : !taken
                            ? `<button class="btn btn-blue btn-sm" onclick="startTest(${m})">Test</button>`
                            : ''}
                    ${taken ? `<button class="btn btn-outline btn-sm" onclick="viewModel(${m})">View</button>` : ''}
                    ${taken && skippedCount > 0
                        ? `<button class="btn btn-outline btn-sm" style="border-color:var(--orange);color:var(--orange);" onclick="answerSkipped(${m})">✏️ Ans ${skippedCount}</button>`
                        : ''}
                    ${hasPending ? `<button class="btn btn-sm btn-ghost" onclick="discardPending()" style="color:var(--text-muted);">✕</button>` : ''}
                </div>
            `;
            list.appendChild(row);
        }
    } catch (err) {
        console.error('renderDash crashed:', err);
        const list = $('modelList');
        if (list) {
            list.innerHTML = `
                <div style="padding:20px;background:rgba(239,68,68,0.1);border:1px solid var(--red);border-radius:8px;color:var(--red);text-align:center;">
                    ⚠️ Dashboard render error: ${err.message}
                </div>
            `;
        }
    }
}

/* ============================================================
   PENDING TEST
   ============================================================ */
function persistTest() {
    if (!test || !curUser || isReviewMode) return;
    sessionStorage.setItem('ms_pending_' + curUser, JSON.stringify({
        f: test.f, m: test.m, ans: test.ans, curQ: test.curQ, timer: test.timer
    }));
}

function resumeTest() {
    const raw = sessionStorage.getItem('ms_pending_' + curUser);
    if (!raw) return;
    const p = JSON.parse(raw);

    if (p.f !== activeFolder) {
        activeFolder = p.f;
        renderFolderCards();
    }

    isReviewMode = false;
    test = { f: p.f, m: p.m, ans: p.ans, curQ: p.curQ, timer: p.timer, interval: null };

    $('testTitle').textContent = CFG.FOLDERS[p.f].label + ' · Set ' + String(p.m).padStart(2, '0');
    $('submitBtn').style.display = 'inline-flex';
    $('reviewSaveBtn').style.display = 'none';
    $('reviewBadge').style.display = 'none';
    $('testHint').textContent = 'Leave blank = Skip · Auto-submit at 0:00';
    show('pageTest');
    renderQ();
    startTimer();
    sessionStorage.removeItem('ms_pending_' + curUser);
    renderDash();
}

function discardPending() {
    if (confirm('Discard your in-progress test? All unsaved answers will be lost.')) {
        sessionStorage.removeItem('ms_pending_' + curUser);
        renderDash();
    }
}

/* ============================================================
   ANSWER SKIPPED
   ============================================================ */
function answerSkipped(m) {
    const mySub = Store.mySub(activeFolder, m);
    if (!mySub || !mySub.ans) { alert('You must complete the test first.'); return; }

    let skipped = 0;
    for (let q = 1; q <= CFG.TOTAL_QS; q++) {
        if (mySub.ans[q] === null || mySub.ans[q] === undefined) skipped++;
    }
    if (skipped === 0) { alert('No skipped questions in this set.'); return; }

    isReviewMode = true;
    let firstSkipped = 1;
    for (let q = 1; q <= CFG.TOTAL_QS; q++) {
        if (mySub.ans[q] === null || mySub.ans[q] === undefined) { firstSkipped = q; break; }
    }

    test = {
        f: activeFolder,
        m,
        ans: JSON.parse(JSON.stringify(mySub.ans)),
        curQ: firstSkipped,
        timer: 0,
        interval: null
    };

    $('testTitle').textContent = CFG.FOLDERS[activeFolder].label + ' · Set ' + String(m).padStart(2, '0') + ' — Skipped';
    $('testTimer').textContent = '--:--';
    $('testTimer').classList.remove('warning');
    $('submitBtn').style.display = 'none';
    $('reviewSaveBtn').style.display = 'inline-flex';
    $('reviewBadge').style.display = 'inline';
    $('testHint').textContent = 'Answer the skipped questions and save. No timer.';
    show('pageTest');
    renderQ();
}

async function saveReview() {
    if (!test || !isReviewMode) return;
    saveAns();
    await Store.updateAns(test.f, test.m, { ...test.ans });
    test = null;
    isReviewMode = false;
    document.querySelectorAll('input[name="qo"]').forEach(r => r.checked = false);
    hide('pageTest');
    renderDash();
}

/* ============================================================
   TEST ENGINE
   ============================================================ */
function startTest(m) {
    if (Store.mySub(activeFolder, m)) {
        alert('Already completed this set.');
        return;
    }

    const raw = sessionStorage.getItem('ms_pending_' + curUser);
    if (raw) {
        const p = JSON.parse(raw);
        if (p.f === activeFolder && p.m === m) {
            if (confirm('You have an interrupted test for this set. Continue where you left off?')) {
                resumeTest();
                return;
            }
            sessionStorage.removeItem('ms_pending_' + curUser);
        }
    }

    isReviewMode = false;
    test = { f: activeFolder, m, ans: {}, curQ: 1, timer: CFG.EXAM_SEC, interval: null };
    for (let i = 1; i <= CFG.TOTAL_QS; i++) test.ans[i] = null;

    persistTest();

    $('testTitle').textContent = CFG.FOLDERS[activeFolder].label + ' · Set ' + String(m).padStart(2, '0');
    $('submitBtn').style.display = 'inline-flex';
    $('reviewSaveBtn').style.display = 'none';
    $('reviewBadge').style.display = 'none';
    $('testHint').textContent = 'Leave blank = Skip · Auto-submit at 0:00';
    show('pageTest');
    renderQ();
    startTimer();
}

function exitTest() {
    if (isReviewMode) {
        if (confirm('Close review? Unsaved changes will be lost.')) {
            test = null;
            isReviewMode = false;
            document.querySelectorAll('input[name="qo"]').forEach(r => r.checked = false);
            hide('pageTest');
        }
        return;
    }
    if (test && test.interval) { clearInterval(test.interval); test.interval = null; }
    if (confirm('Quit test? Your progress will be lost.')) {
        sessionStorage.removeItem('ms_pending_' + curUser);
        test = null;
        document.querySelectorAll('input[name="qo"]').forEach(r => r.checked = false);
        hide('pageTest');
        renderDash();
    }
}

function renderQ() {
    if (!test) return;
    const q = test.curQ;
    $('qNum').textContent = 'Q' + String(q).padStart(2, '0');
    $('testProgress').textContent = q + ' / ' + CFG.TOTAL_QS;

    const radios = document.querySelectorAll('input[name="qo"]');
    const sel = test.ans[q];
    radios.forEach(r => {
        r.checked = (r.value === sel);
        r.closest('label').classList.toggle('selected', r.value === sel);
    });

    updatePalette();
    $('prevBtn').disabled = (q === 1);
    $('nextBtn').disabled = (q === CFG.TOTAL_QS);
}

function updatePalette() {
    if (!test) return;
    const p = $('qPalette');
    if (!p) return;
    p.innerHTML = '';
    for (let i = 1; i <= CFG.TOTAL_QS; i++) {
        const a = test.ans[i];
        let cls = '';
        if (i === test.curQ) cls = 'current';
        else if (a !== null && a !== undefined) cls = 'done';
        const btn = document.createElement('button');
        btn.className = cls;
        btn.textContent = i;
        btn.onclick = () => goQ(i);
        p.appendChild(btn);
    }
}

function saveAns() {
    if (!test) return;
    const radios = document.querySelectorAll('input[name="qo"]');
    let sel = null;
    radios.forEach(r => { if (r.checked) sel = r.value; });
    test.ans[test.curQ] = sel;
    if (!isReviewMode) persistTest();
}

function goQ(n) { saveAns(); test.curQ = n; renderQ(); if (!isReviewMode) persistTest(); }
function nextQ() { saveAns(); if (test.curQ < CFG.TOTAL_QS) { test.curQ++; renderQ(); if (!isReviewMode) persistTest(); } }
function prevQ() { saveAns(); if (test.curQ > 1) { test.curQ--; renderQ(); if (!isReviewMode) persistTest(); } }

function startTimer() {
    if (test.interval) clearInterval(test.interval);
    updTimer();
    test.interval = setInterval(() => {
        test.timer--;
        updTimer();
        if (test.timer % 5 === 0) persistTest();
        if (test.timer <= 0) {
            clearInterval(test.interval);
            test.interval = null;
            alert('⏰ Time is up! Auto-submitting.');
            submitTest();
        }
    }, 1000);
}

function updTimer() {
    if (!test) return;
    const m = Math.floor(test.timer / 60);
    const s = test.timer % 60;
    const el = $('testTimer');
    if (!el) return;
    el.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    el.classList.toggle('warning', test.timer <= 120);
}

async function submitTest() {
    if (!test) return;
    if (test.interval) { clearInterval(test.interval); test.interval = null; }
    saveAns();

    const sp = CFG.EXAM_SEC - test.timer;
    await Store.saveSub({ u: curUser, f: test.f, m: test.m, ans: { ...test.ans }, sp });
    sessionStorage.removeItem('ms_pending_' + curUser);

    test = null;
    document.querySelectorAll('input[name="qo"]').forEach(r => r.checked = false);
    hide('pageTest');
    renderDash();
}

/* ============================================================
   VIEW ENGINE
   ============================================================ */
function viewModel(m) {
    const f = activeFolder;
    viewingCtx = { f, m };
    const subs = Store.subsFor(f);
    const ms = subs.filter(s => s.m === m);

    const mySub = ms.find(s => s.u === curUser);
    if (!mySub) {
        alert('You must take this test first before viewing comparisons!');
        return;
    }

    $('viewTitle').textContent = CFG.FOLDERS[f].label + ' · Set ' + String(m).padStart(2, '0') + ' — Comparison';

    const uAns = {}, uSub = {};
    CFG.USERS.forEach(u => {
        const s = ms.find(x => x.u === u);
        if (s) { uAns[u] = s.ans || {}; uSub[u] = true; }
        else { uAns[u] = {}; uSub[u] = false; }
    });

    const totalSubmitted = CFG.USERS.filter(u => uSub[u]).length;

    const mismatches = [];
    for (let q = 1; q <= CFG.TOTAL_QS; q++) {
        const answers = {};
        let anyAnswered = false;

        CFG.USERS.forEach(u => {
            if (uSub[u]) {
                const a = uAns[u] ? uAns[u][q] : null;
                answers[u] = a;
                if (a !== null && a !== undefined) anyAnswered = true;
            } else {
                answers[u] = '__NA__';
            }
        });

        if (!anyAnswered) continue;

        const validAnswers = CFG.USERS
            .map(u => answers[u])
            .filter(a => a !== null && a !== undefined && a !== '__NA__');

        const allSubmitted = CFG.USERS.every(u => uSub[u]);
        const allSame = validAnswers.length > 0 && validAnswers.every(a => a === validAnswers[0]);

        if (!allSubmitted || !allSame) {
            mismatches.push({ q, answers });
        }
    }

    renderView(f, m, mismatches, uSub, uAns, mySub, totalSubmitted);
    show('pageView');
}

function renderView(f, m, mismatches, uSub, uAns, mySub, totalSubmitted) {
    const el = $('viewBody');
    if (!el) return;

    if (!mySub || typeof mySub.sp !== 'number') {
        el.innerHTML = '<p style="padding:40px;text-align:center;color:var(--text-muted);">No submission data found for you in this set.</p>';
        return;
    }

    const myTimeStr = Math.floor(mySub.sp / 60) + 'm ' + (mySub.sp % 60) + 's';

    if (mismatches.length === 0) {
        el.innerHTML = `
            <div class="view-stats">
                <div class="vs"><div class="vs-lbl">Mismatches</div><div class="vs-val">0</div></div>
                <div class="vs"><div class="vs-lbl">Submitted</div><div class="vs-val">${totalSubmitted}/${CFG.USERS.length}</div></div>
                <div class="vs"><div class="vs-lbl">Questions</div><div class="vs-val">${CFG.TOTAL_QS}</div></div>
                <div class="vs"><div class="vs-lbl">Your Time</div><div class="vs-val">${myTimeStr}</div></div>
            </div>
            <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:40px;text-align:center;">
                <div style="font-size:40px;margin-bottom:10px;">🎉</div>
                <h3 style="color:var(--text-primary);">No Mismatches!</h3>
                <p style="color:var(--text-muted);font-size:12px;margin-top:6px;">
                    ${totalSubmitted < CFG.USERS.length
                        ? 'Only ' + totalSubmitted + '/' + CFG.USERS.length + ' friends have submitted so far.<br>Check back later.'
                        : 'Everyone agrees on every question.'}
                </p>
            </div>
        `;
        return;
    }

    let html = `
        <div class="view-stats">
            <div class="vs"><div class="vs-lbl">Mismatches</div><div class="vs-val">${mismatches.length}</div></div>
            <div class="vs"><div class="vs-lbl">Submitted</div><div class="vs-val">${totalSubmitted}/${CFG.USERS.length}</div></div>
            <div class="vs"><div class="vs-lbl">Questions</div><div class="vs-val">${CFG.TOTAL_QS}</div></div>
            <div class="vs"><div class="vs-lbl">Your Time</div><div class="vs-val">${myTimeStr}</div></div>
        </div>
        <div class="view-note">
            Showing <strong>${mismatches.length}</strong> questions where answers differ or not all friends have submitted.
            <span style="color:var(--blue-glow);">Majority vote</span> = most common answer.
        </div>
        <table class="vtable">
            <thead><tr>
                <th>Q#</th>
                ${CFG.USERS.map(u => `<th>${u}</th>`).join('')}
                <th>Majority</th><th>💬</th>
            </tr></thead>
            <tbody>
    `;

    mismatches.forEach(({ q, answers }) => {
        const counts = { A: 0, B: 0, C: 0, D: 0 };
        CFG.USERS.forEach(u => {
            const a = answers[u];
            if (a && a !== '__NA__' && a !== null && counts.hasOwnProperty(a)) counts[a]++;
        });
        const maxCount = Math.max(...Object.values(counts));
        const topOptions = Object.keys(counts).filter(k => counts[k] === maxCount && maxCount > 0);
        let vote, vClass;
        if (topOptions.length === 0) { vote = '—'; vClass = 'vc'; }
        else if (topOptions.length === 1) { vote = '✓ ' + topOptions[0] + ' (' + maxCount + 'x)'; vClass = 'vc'; }
        else { vote = '⚖ Tie: ' + topOptions.join('/'); vClass = 'vc tie'; }

        const cmts = Store.cmts();
        const key = f + '-' + m + '-' + q;
        const hasCmt = cmts[key] && cmts[key].length > 0;

        html += `
            <tr class="mrow">
                <td><strong>${String(q).padStart(2, '0')}</strong></td>
                ${CFG.USERS.map(u => {
    const a = answers[u];
    if (a === '__NA__') return '<td class="ac na">—<span class="sub-lbl">no test</span></td>';
    if (a === null || a === undefined) return '<td class="ac sk">⏭<span class="sub-lbl">skipped</span></td>';
    return '<td class="ac">' + a + '</td>';
}).join('')}
                <td class="${vClass}">${vote}</td>
                <td><button class="cb" onclick="toggleCmt('${f}',${m},${q})">${hasCmt ? '💬 ' + cmts[key].length : 'Comment'}</button></td>
            </tr>
            <tr id="cmtR-${f}-${m}-${q}" style="display:none;">
                <td colspan="${CFG.USERS.length + 3}" style="padding:8px;">
                    <div class="cp">
                        <div class="ct">💬 Question ${String(q).padStart(2, '0')} — Discussion</div>
                        <div id="cmtL-${f}-${m}-${q}"></div>
                        <div class="ci">
                            <input type="text" id="cmtI-${f}-${m}-${q}" placeholder="Conclude the right answer..." />
                            <button class="btn btn-blue btn-sm" onclick="postCmt('${f}',${m},${q})">Post</button>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    });

    html += '</tbody></table>';
    el.innerHTML = html;

    mismatches.forEach(({ q }) => renderCmt(f, m, q));
}

/* ============================================================
   COMMENTS
   ============================================================ */
function toggleCmt(f, m, q) {
    const row = $('cmtR-' + f + '-' + m + '-' + q);
    if (!row) return;
    if (!row.style.display || row.style.display === 'none') {
        row.style.display = 'table-row';
        renderCmt(f, m, q);
    } else {
        row.style.display = 'none';
    }
}

function renderCmt(f, m, q) {
    const c = Store.cmts();
    const key = f + '-' + m + '-' + q;
    const list = $('cmtL-' + f + '-' + m + '-' + q);
    if (!list) return;
    const items = c[key] || [];
    if (!items.length) {
        list.innerHTML = '<p style="font-size:10px;color:var(--text-muted);padding:5px 0;">No comments yet. Start the discussion!</p>';
        return;
    }
    list.innerHTML = items.map(x => `
        <div class="cm">
            <span class="cu">${x.u}</span>
            <span class="ctm">${new Date(x.time).toLocaleString()}</span>
            <span class="ctx">${x.t}</span>
        </div>
    `).join('');
}

async function postCmt(f, m, q) {
    const inp = $('cmtI-' + f + '-' + m + '-' + q);
    if (!inp || !inp.value.trim()) return;
    await Store.addCmt(f, m, q, curUser, inp.value.trim());
    inp.value = '';
    renderCmt(f, m, q);
    viewModel(m);
}

function closeView() {
    hide('pageView');
    viewingCtx = null;
}

/* ============================================================
   EXPORT
   ============================================================ */
function exportComparison() {
    const f = activeFolder;
    const subs = Store.subsFor(f);
    if (subs.length === 0) { alert('No data to export yet.'); return; }

    let text = '=== ' + CFG.FOLDERS[f].label + ' — Comparison Export ===\n';
    text += 'Exported: ' + new Date().toLocaleString() + '\n';
    text += 'Users: ' + CFG.USERS.join(', ') + '\n\n';

    for (let m = 1; m <= CFG.MODELS_PER_FOLDER; m++) {
        const ms = subs.filter(s => s.m === m);
        if (ms.length === 0) continue;

        const uAns = {}, uSub = {};
        CFG.USERS.forEach(u => {
            const s = ms.find(x => x.u === u);
            if (s) { uAns[u] = s.ans || {}; uSub[u] = true; }
            else { uAns[u] = {}; uSub[u] = false; }
        });

        let hasMismatch = false;
        let lines = [];
        for (let q = 1; q <= CFG.TOTAL_QS; q++) {
            const ans = {};
            let any = false;
            CFG.USERS.forEach(u => {
                if (uSub[u]) {
                    const a = uAns[u][q];
                    ans[u] = a;
                    if (a !== null && a !== undefined) any = true;
                } else { ans[u] = '—'; }
            });
            if (!any) continue;
            const valid = CFG.USERS.map(u => ans[u]).filter(a => a && a !== '—');
            if (valid.length < 2) continue;
            if (!valid.every(a => a === valid[0])) {
                hasMismatch = true;
                lines.push('  Q' + String(q).padStart(2, '0') + ': ' +
                    CFG.USERS.map(u => u + '=' + (ans[u] || '⏭')).join(' | '));
            }
        }

        if (hasMismatch) {
            text += '--- Set ' + String(m).padStart(2, '0') + ' ---\n';
            text += lines.join('\n') + '\n\n';
        }
    }

    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = f.toLowerCase() + '_comparison_' + Date.now() + '.txt';
    a.click();
    URL.revokeObjectURL(a.href);
}

function exportView() {
    if (!viewingCtx) return;
    const { f, m } = viewingCtx;
    const subs = Store.subsFor(f);
    const ms = subs.filter(s => s.m === m);

    let text = '=== ' + CFG.FOLDERS[f].label + ' · Set ' + String(m).padStart(2, '0') + ' — Comparison ===\n';
    text += 'Exported: ' + new Date().toLocaleString() + '\n\n';

    const uAns = {}, uSub = {};
    CFG.USERS.forEach(u => {
        const s = ms.find(x => x.u === u);
        if (s) { uAns[u] = s.ans || {}; uSub[u] = true; }
        else { uAns[u] = {}; uSub[u] = false; }
    });

    for (let q = 1; q <= CFG.TOTAL_QS; q++) {
        const answers = {};
        let any = false;
        CFG.USERS.forEach(u => {
            if (uSub[u]) {
                const a = uAns[u][q];
                answers[u] = a;
                if (a !== null && a !== undefined) any = true;
            } else { answers[u] = '—'; }
        });
        if (!any) continue;

        const valid = CFG.USERS.map(u => answers[u]).filter(a => a && a !== '—');
        const allSame = valid.length > 0 && valid.every(a => a === valid[0]);
        const allSub = CFG.USERS.every(u => uSub[u]);

        if (!allSub || !allSame) {
            text += 'Q' + String(q).padStart(2, '0') + ': ';
            text += CFG.USERS.map(u => u + '=[' + (answers[u] || '⏭') + ']').join(' | ');

            const counts = { A: 0, B: 0, C: 0, D: 0 };
            CFG.USERS.forEach(u => {
                const a = answers[u];
                if (a && a !== '—' && counts.hasOwnProperty(a)) counts[a]++;
            });
            const max = Math.max(...Object.values(counts));
            const top = Object.keys(counts).filter(k => counts[k] === max && max > 0);
            text += ' → Majority: ' + (top.length === 1 ? top[0] + ' (' + max + 'x)' : 'Tie: ' + top.join('/'));
            text += '\n';
        }
    }

    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = f.toLowerCase() + '_set' + String(m).padStart(2, '0') + '_comparison.txt';
    a.click();
    URL.revokeObjectURL(a.href);
}

/* ============================================================
   HOT QUESTIONS
   ============================================================ */
function showHotQuestions() {
    const f = activeFolder;
    const subs = Store.subsFor(f);
    if (subs.length < 2) {
        alert('Need at least 2 submissions in ' + CFG.FOLDERS[f].label + '.');
        return;
    }

    const qHeat = {};
    for (let m = 1; m <= CFG.MODELS_PER_FOLDER; m++) {
        const ms = subs.filter(s => s.m === m);
        if (ms.length < 2) continue;

        const uAns = {}, uSub = {};
        CFG.USERS.forEach(u => {
            const s = ms.find(x => x.u === u);
            if (s) { uAns[u] = s.ans || {}; uSub[u] = true; }
            else { uAns[u] = {}; uSub[u] = false; }
        });

        for (let q = 1; q <= CFG.TOTAL_QS; q++) {
            const ans = {};
            let any = false;
            CFG.USERS.forEach(u => {
                if (uSub[u]) {
                    const a = uAns[u][q];
                    ans[u] = a;
                    if (a !== null && a !== undefined) any = true;
                } else { ans[u] = '—'; }
            });
            if (!any) continue;
            const valid = CFG.USERS.map(u => ans[u]).filter(a => a && a !== '—');
            if (valid.length >= 2 && !valid.every(a => a === valid[0])) {
                qHeat[q] = (qHeat[q] || 0) + 1;
            }
        }
    }

    const sorted = Object.entries(qHeat).sort((a, b) => b[1] - a[1]);
    const body = $('hotBody');
    if (!body) return;

    if (sorted.length === 0) {
        body.innerHTML = '<p style="color:var(--text-muted);text-align:center;">No hot questions found yet.</p>';
    } else {
        body.innerHTML = `
            <p style="color:var(--text-secondary);margin-bottom:10px;font-size:11px;">
                🔥 Hot questions in <strong>${CFG.FOLDERS[f].label}</strong> — most disagreements across sets:
            </p>
            <table class="vtable">
                <thead><tr><th>Rank</th><th>Question</th><th>Mismatches</th><th>Heat</th></tr></thead>
                <tbody>
                    ${sorted.slice(0, 20).map(([q, count], i) => {
                        const barW = Math.min(100, Math.round((count / sorted[0][1]) * 100));
                        const emoji = count >= 5 ? '🔥' : count >= 3 ? '⚡' : '📌';
                        return `<tr>
                            <td>#${i + 1}</td>
                            <td><strong>Q${String(q).padStart(2, '0')}</strong></td>
                            <td>${count}</td>
                            <td><div style="display:flex;align-items:center;gap:5px;">
                                <div style="height:7px;width:${barW}px;background:var(--blue-mid);border-radius:4px;max-width:110px;"></div>
                                ${emoji}
                            </div></td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        `;
    }

    show('hotModal');
}

function closeHot() { hide('hotModal'); }

/* ============================================================
   🔒 PER-USER LOCK (SHA-256 + Firestore)
   ============================================================ */
async function hashPassword(password, salt) {
    const enc = new TextEncoder();
    const data = enc.encode(salt + '::' + password + '::modelset');
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, '0')).join('');
}

function makeSalt() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function loadUserProfile() {
    if (typeof db === 'undefined' || !db) return;
    try {
        const snap = await db.collection(USER_COL).doc(curUser).get();
        if (snap.exists) {
            userProfile = { u: curUser, ...snap.data() };
        } else {
            userProfile = { u: curUser, locked: false };
        }
    } catch (e) {
        console.warn('Could not load user profile:', e);
        userProfile = { u: curUser, locked: false };
    }

    // Apply saved theme
    if (userProfile.theme && userProfile.theme !== 'system') {
        document.documentElement.setAttribute('data-theme', userProfile.theme);
    }

    // Decide which lock modal to show
    if (!userProfile.locked && !sessionStorage.getItem('ms_setup_done_' + curUser)) {
        openLockModal('set');
    } else if (userProfile.locked && !sessionStorage.getItem('ms_unlocked_' + curUser)) {
        openLockModal('unlock');
    } else {
        startSettingsInterval();
    }
}

function openLockModal(mode) {
    lockMode = mode;
    const m = $('lockModal');
    if (!m) return;
    m.style.display = 'flex';

    const t = $('lockTitle'), d = $('lockDesc'), b = $('lockBtn');
    const c = $('lockCancelBtn'), h = $('lockHint');
    const p1 = $('lockPass1'), p2 = $('lockPass2');
    $('lockErr').textContent = '';
    p1.value = p2.value = '';
    if (h) h.value = userProfile?.hint || '';

    if (mode === 'set') {
        t.textContent = '🔒 Secure Your Dashboard';
        d.textContent = 'Set a private password. You\'ll need it every time you open your dashboard on a new device. Others cannot access your test results without it.';
        b.textContent = 'Set Password';
        b.className = 'btn btn-blue gate-btn';
        c.style.display = 'none';
        h.style.display = 'block';
        p2.style.display = 'block';
    } else if (mode === 'change') {
        t.textContent = '🔑 Change Your Password';
        d.textContent = 'Enter and confirm your new dashboard password.';
        b.textContent = 'Update Password';
        b.className = 'btn btn-blue gate-btn';
        c.style.display = 'block';
        h.style.display = 'block';
        p2.style.display = 'block';
    } else {
        t.textContent = '🔐 Enter Your Password';
        let txt = 'Welcome back, ' + curUser + '. Enter your dashboard password to continue.';
        if (userProfile?.hint) txt += '\n\nHint: ' + userProfile.hint;
        d.textContent = txt;
        b.textContent = 'Unlock →';
        b.className = 'btn btn-blue gate-btn';
        c.style.display = 'block';
        h.style.display = 'none';
        p2.style.display = 'none';
    }
    setTimeout(() => p1.focus(), 100);
}

function cancelLock() {
    if (lockMode === 'unlock') {
        logout();
        return;
    }
    hide('lockModal');
}

async function submitLock() {
    const p1 = $('lockPass1').value;
    const p2 = $('lockPass2').value;
    const hint = ($('lockHint')?.value || '').trim();
    const err = $('lockErr');
    err.textContent = '';

    if (!p1 || p1.length < 4) { err.textContent = 'Password must be at least 4 characters.'; return; }

    if (lockMode === 'unlock') {
        const hash = await hashPassword(p1, userProfile.salt);
        if (hash === userProfile.hash) {
            sessionStorage.setItem('ms_unlocked_' + curUser, '1');
            hide('lockModal');
            startSettingsInterval();
        } else {
            err.textContent = '❌ Wrong password.';
            $('lockPass1').value = '';
        }
        return;
    }

    if (p1 !== p2) { err.textContent = 'Passwords do not match.'; return; }

    try {
        const salt = makeSalt();
        const hash = await hashPassword(p1, salt);
        await db.collection(USER_COL).doc(curUser).set({
            u: curUser,
            locked: true,
            hash,
            salt,
            hint: hint || '',
            theme: userProfile?.theme || 'system',
            updatedAt: Date.now(),
            createdAt: userProfile?.createdAt || Date.now()
        }, { merge: true });

        userProfile = { ...userProfile, locked: true, hash, salt, hint };
        sessionStorage.setItem('ms_unlocked_' + curUser, '1');
        sessionStorage.setItem('ms_setup_done_' + curUser, '1');

        $('lockTitle').textContent = '✅ Done!';
        $('lockDesc').textContent = 'Your dashboard is now protected.';
        setTimeout(() => {
            hide('lockModal');
            startSettingsInterval();
        }, 700);
    } catch (e) {
        console.error(e);
        err.textContent = 'Failed to save. Check your connection.';
    }
}

/* ============================================================
   ⚙️ SETTINGS PANEL
   ============================================================ */
function openSettings() {
    const m = $('settingsModal');
    if (!m) return;
    m.style.display = 'flex';

    $('setUserName').textContent = curUser;
    const start = parseInt(sessionStorage.getItem('ms_session_start_' + curUser) || Date.now(), 10);
    $('setSessionStart').textContent = new Date(start).toLocaleTimeString();

    if (userProfile?.locked) {
        $('setLockStatus').textContent = '🔒 Enabled';
        $('setLockStatus').style.color = 'var(--green)';
        $('hintRow').style.display = userProfile.hint ? 'flex' : 'none';
        $('setLockHint').textContent = userProfile.hint || '—';
    } else {
        $('setLockStatus').textContent = '○ Not set';
        $('setLockStatus').style.color = 'var(--text-muted)';
        $('hintRow').style.display = 'none';
    }

    const subs = Store.subs();
    const apta = subs.filter(s => s.u === curUser && s.f === 'ABTA').length;
    const qb = subs.filter(s => s.u === curUser && s.f === 'QUESTION_BUNCH').length;
    const tSec = subs.filter(s => s.u === curUser).reduce((a, x) => a + (x.sp || 0), 0);
    const tStr = tSec >= 3600
        ? Math.floor(tSec / 3600) + 'h ' + Math.floor((tSec % 3600) / 60) + 'm'
        : Math.floor(tSec / 60) + 'm';
    $('setAptaCount').textContent = apta + '/' + CFG.MODELS_PER_FOLDER;
    $('setQbCount').textContent = qb + '/' + CFG.MODELS_PER_FOLDER;
    $('setTotalTime').textContent = tStr;
    $('setRank').textContent = $('statRank').textContent;

    const t = userProfile?.theme || 'system';
    $('setTheme').textContent = t.charAt(0).toUpperCase() + t.slice(1);
}

function closeSettings() {
    hide('settingsModal');
}

function changeLockPassword() {
    closeSettings();
    openLockModal('change');
}

async function removeLock() {
    if (!confirm('Remove dashboard lock? Anyone with your name can access your data.')) return;
    try {
        await db.collection(USER_COL).doc(curUser).update({
            locked: false, hash: null, salt: null, hint: '', updatedAt: Date.now()
        });
        userProfile.locked = false;
        sessionStorage.removeItem('ms_unlocked_' + curUser);
        alert('Lock removed.');
        openSettings();
    } catch (e) {
        alert('Failed to remove lock.');
    }
}

/* ============================================================
   🎨 THEME OVERRIDE
   ============================================================ */
function forceTheme(mode) {
    const root = document.documentElement;
    if (mode === 'system') {
        root.removeAttribute('data-theme');
        document.body.style.colorScheme = '';
    } else {
        root.setAttribute('data-theme', mode);
        document.body.style.colorScheme = mode;
    }
    if (userProfile) userProfile.theme = mode;
    if (db && curUser) {
        db.collection(USER_COL).doc(curUser).set({ theme: mode }, { merge: true }).catch(() => {});
    }
    const t = $('setTheme'); if (t) t.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
}

/* ============================================================
   📤 EXPORT MY DATA
   ============================================================ */
function exportMyData() {
    const subs = Store.subs().filter(s => s.u === curUser);
    const data = {
        user: curUser,
        exportedAt: new Date().toISOString(),
        submissions: subs.map(s => ({
            folder: s.f, model: s.m, timeSpent: s.sp,
            answers: s.ans, submittedAt: new Date(s.ts).toISOString()
        }))
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = curUser.toLowerCase() + '_my_data_' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
}

/* ============================================================
   🧹 CLEAR LOCAL CACHE
   ============================================================ */
function clearLocalData() {
    if (!confirm('Clear local cache? You will be signed out and unsaved in-progress tests will be lost.')) return;
    const keys = Object.keys(sessionStorage).filter(k => k.startsWith('ms_'));
    keys.forEach(k => sessionStorage.removeItem(k));
    alert('Local cache cleared.');
    window.location.href = 'index.html';
}

/* ============================================================
   ⏱ SESSION TIMER
   ============================================================ */
function startSettingsInterval() {
    if (settingsInterval) clearInterval(settingsInterval);
    sessionStorage.setItem('ms_session_start_' + curUser,
        sessionStorage.getItem('ms_session_start_' + curUser) || Date.now());

    settingsInterval = setInterval(() => {
        const el = $('setSessionDur');
        if (!el) return;
        const start = parseInt(sessionStorage.getItem('ms_session_start_' + curUser), 10);
        const sec = Math.floor((Date.now() - start) / 1000);
        const m = Math.floor(sec / 60), s = sec % 60;
        el.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }, 1000);
}
