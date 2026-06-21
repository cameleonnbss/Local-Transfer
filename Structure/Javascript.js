/* Copyright (c) Local Transfer by camzzz
 * Licensed under the MIT License.
 * See LICENSE file in the project root for full license text.
 */

(() => {
    'use strict';

    /* ============ Element refs ============ */
    const form          = document.getElementById('uploadForm');
    const fileInput     = document.getElementById('fileInput');
    const dropZone      = document.getElementById('dropZone');
    const dropSub       = document.getElementById('dropSub');
    const queueEl       = document.getElementById('queue');
    const uploadBtn     = document.getElementById('uploadBtn');
    const clearBtn      = document.getElementById('clearBtn');
    const refreshBtn    = document.getElementById('refreshBtn');
    const searchInput   = document.getElementById('searchInput');
    const fileList      = document.getElementById('fileList');
    const topProgress   = document.getElementById('topProgress');
    const progressBar   = topProgress.querySelector('.top-progress__bar');
    const toastWrap     = document.getElementById('toasts');
    const statFiles     = document.getElementById('statFiles');
    const statSize      = document.getElementById('statSize');
    const statStatus    = document.getElementById('statStatus');
    const statStatusText= document.getElementById('statStatusText');
    const statusDot     = statStatus ? statStatus.querySelector('.dot') : null;

    let pending = [];            // [{file, id}]
    let lastFileSnapshot = [];   // last seen file list (for diff / new-file animation)
    let lastHash = null;         // server-side snapshot hash — skip DOM work if unchanged
    let pollTimer = null;
    let isOnline = true;
    let consecutiveFailures = 0;
    let knownFileNames = new Set();  // files the user has already been notified about
    let firstLoad = true;
    let activeDownloads = new Set();  // filenames currently being downloaded — preserve spinner

    const POLL_INTERVAL_MS = 1500;       // 1.5s for snappy live updates
    const POLL_INTERVAL_OFFLINE_MS = 3000; // slower retry when host is down
    const NEW_BADGE_TTL_MS = 10000;      // NEW badge shows for 10s after first appearance

    /* ============ Helpers ============ */
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    function fmtSize(b) {
        if (b == null || isNaN(b)) return '0 B';
        const u = ['B','KB','MB','GB','TB'];
        let i = 0, n = b;
        while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
        return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, m => ({
            '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
        }[m]));
    }

    function iconKindFor(ext) {
        const sets = {
            img:  ['png','jpg','jpeg','gif','webp','svg','bmp'],
            vid:  ['mp4','mkv','mov','avi','webm'],
            aud:  ['mp3','wav','flac','ogg','aac'],
            zip:  ['zip','rar','7z','tar','gz'],
            code: ['py','js','ts','html','css','cpp','c','cs','java','go','rs','sh','json','xml','yml','yaml'],
            doc:  ['pdf','doc','docx','txt','md','xls','xlsx','ppt','pptx'],
        };
        for (const k in sets) if (sets[k].includes(ext)) return k;
        return 'file';
    }

    /* ============ Toasts ============ */
    function toast({ type = 'info', title = '', sub = '', ms = 3200 } = {}) {
        const el = document.createElement('div');
        el.className = `toast toast--${type}`;
        const iconMap = { ok: '✓', err: '!', info: 'i' };
        el.innerHTML = `
            <div class="toast__icon">${iconMap[type] || 'i'}</div>
            <div class="toast__body">
                <div class="toast__title"></div>
                <div class="toast__sub"></div>
            </div>`;
        el.querySelector('.toast__title').textContent = title;
        el.querySelector('.toast__sub').textContent   = sub;
        toastWrap.appendChild(el);
        requestAnimationFrame(() => el.classList.add('show'));
        const hide = () => {
            el.classList.remove('show');
            el.classList.add('hide');
            setTimeout(() => el.remove(), 360);
        };
        const t = setTimeout(hide, ms);
        el.addEventListener('click', () => { clearTimeout(t); hide(); });
    }

    /* ============ Subtle chime (Web Audio API, no asset needed) ============ */
    let audioCtx = null;
    function playChime() {
        try {
            if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const ctx = audioCtx;
            if (ctx.state === 'suspended') ctx.resume();
            const now = ctx.currentTime;
            // Two short tones (E5 -> A5) — pleasant, unobtrusive
            [[659.25, 0.00, 0.10], [880.00, 0.08, 0.14]].forEach(([freq, start, dur]) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0, now + start);
                gain.gain.linearRampToValueAtTime(0.10, now + start + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
                osc.connect(gain).connect(ctx.destination);
                osc.start(now + start);
                osc.stop(now + start + dur + 0.02);
            });
        } catch (e) { /* silent — audio is best-effort */ }
    }

    /* ============ Host status indicator ============ */
    function setStatus(state) {
        // state: 'online' | 'offline' | 'reconnecting' | 'idle'
        if (!statStatus || !statusDot || !statStatusText) return;
        statusDot.className = 'dot';
        statStatus.classList.remove('is-offline', 'is-reconnecting');
        switch (state) {
            case 'online':
                statStatusText.textContent = 'live';
                break;
            case 'offline':
                statusDot.classList.add('dot--err');
                statStatus.classList.add('is-offline');
                statStatusText.textContent = 'offline';
                break;
            case 'reconnecting':
                statusDot.classList.add('dot--warn');
                statStatus.classList.add('is-reconnecting');
                statStatusText.textContent = 'reconnecting';
                break;
            case 'idle':
            default:
                statusDot.classList.add('dot--idle');
                statStatusText.textContent = 'connecting';
                break;
        }
    }

    /* ============ Queue rendering ============ */
    function renderQueue() {
        if (!pending.length) {
            queueEl.hidden = true;
            queueEl.innerHTML = '';
            clearBtn.hidden = true;
            dropSub.textContent = 'any file type · any size · plain storage';
            return;
        }
        queueEl.hidden = false;
        clearBtn.hidden = false;
        queueEl.innerHTML = pending.map(item => `
            <div class="queue__item" data-id="${item.id}">
                <span class="queue__name" title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</span>
                <span class="queue__size">${fmtSize(item.file.size)}</span>
                <button type="button" class="queue__remove" data-id="${item.id}" aria-label="Remove">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6l-12 12"/></svg>
                </button>
            </div>`).join('');
        const totalBytes = pending.reduce((a,b) => a + b.file.size, 0);
        dropSub.textContent = `${pending.length} file${pending.length > 1 ? 's' : ''} ready · ${fmtSize(totalBytes)}`;
    }

    function addFiles(fileListLike) {
        const incoming = Array.from(fileListLike);
        if (!incoming.length) return;
        incoming.forEach(f => {
            pending.push({ file: f, id: (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`) });
        });
        renderQueue();
    }

    function removePending(id) {
        pending = pending.filter(p => p.id !== id);
        renderQueue();
    }

    /* ============ Dropzone events ============ */
    fileInput.addEventListener('change', () => {
        addFiles(fileInput.files);
        fileInput.value = '';
    });

    ['dragenter', 'dragover'].forEach(ev => {
        dropZone.addEventListener(ev, e => {
            e.preventDefault(); e.stopPropagation();
            dropZone.classList.add('dragover');
        });
    });
    ['dragleave', 'dragend'].forEach(ev => {
        dropZone.addEventListener(ev, e => {
            e.preventDefault(); e.stopPropagation();
            if (e.target === dropZone) dropZone.classList.remove('dragover');
        });
    });
    dropZone.addEventListener('drop', e => {
        e.preventDefault(); e.stopPropagation();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
            addFiles(e.dataTransfer.files);
        }
    });
    ['dragover', 'drop'].forEach(ev => window.addEventListener(ev, e => e.preventDefault()));

    /* ============ Queue remove / clear ============ */
    queueEl.addEventListener('click', e => {
        const btn = e.target.closest('.queue__remove');
        if (!btn) return;
        removePending(btn.dataset.id);
    });
    clearBtn.addEventListener('click', () => { pending = []; renderQueue(); });

    /* ============ File list rendering (live from /api/files) ============ */
    function renderFiles(files, opts = {}) {
        const isNewRefresh = opts.isNew === true;
        const previousNames = new Set(lastFileSnapshot.map(f => f.name));
        const newThisRefresh = new Set();

        // Detect which files are genuinely new in this refresh
        if (isNewRefresh) {
            for (const f of files) {
                if (!previousNames.has(f.name)) newThisRefresh.add(f.name);
            }
        }

        // Apply current search filter
        const q = (searchInput.value || '').trim().toLowerCase();

        if (!files.length) {
            fileList.innerHTML = `
                <li class="empty">
                    <div class="empty__icon">
                        <svg viewBox="0 0 64 64" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="10" y="14" width="44" height="36" rx="4"/>
                            <path d="M10 24h44M22 14V8M42 14V8"/>
                            <circle cx="22" cy="34" r="2.5"/><circle cx="32" cy="34" r="2.5"/><circle cx="42" cy="34" r="2.5"/>
                        </svg>
                    </div>
                    <h3>Nothing here yet</h3>
                    <p>Send a file from the panel above — it will land here.</p>
                </li>`;
            return;
        }

        fileList.innerHTML = files.map(f => {
            const kind = iconKindFor(f.ext);
            const label = (f.ext || 'DAT').slice(0,3).toUpperCase();
            const hidden = q && !(f.name || '').toLowerCase().includes(q);
            const isNewFile = newThisRefresh.has(f.name);
            const showNewBadge = isNewFile && !knownFileNames.has(f.name);
            return `
            <li class="file${isNewFile ? ' new' : ''}" data-name="${escapeHtml((f.name || '').toLowerCase())}" data-ext="${escapeHtml(f.ext || '')}"${hidden ? ' style="display:none"' : ''}>
                <div class="file__glow"></div>
                <div class="file__main">
                    <div class="file__icon file__icon--${kind}"><span>${escapeHtml(label)}</span></div>
                    <div class="file__body">
                        <div class="file__name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
                        <div class="file__sub">
                            <span class="file__tag">#${f.number}</span>
                            ${showNewBadge ? '<span class="file__new">NEW</span>' : ''}
                            <span class="file__size">${escapeHtml(f.size)}</span>
                            <span class="file__dot">·</span>
                            <span class="file__date">${escapeHtml(f.date)}</span>
                        </div>
                    </div>
                </div>
                <div class="file__actions">
                    <button type="button" class="btn btn--primary btn--sm download-btn" data-file="${escapeHtml(f.name)}">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 4v12M12 16l-4-4M12 16l4-4"/><path d="M4 20h16"/>
                        </svg>
                        <span>Get</span>
                    </button>
                    <button type="button" class="icon-btn icon-btn--danger delete-btn" data-file="${escapeHtml(f.name)}" title="Delete">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/>
                        </svg>
                    </button>
                </div>
            </li>`;
        }).join('');

        // If we have brand-new files, fire chime + toast once, and schedule NEW badge removal
        if (showNewBadgeCount(newThisRefresh, knownFileNames) > 0) {
            const trulyNew = files.filter(f => newThisRefresh.has(f.name) && !knownFileNames.has(f.name));
            if (trulyNew.length && !firstLoad) {
                playChime();
                if (trulyNew.length === 1) {
                    toast({ type: 'ok', title: 'New file received', sub: trulyNew[0].name, ms: 4000 });
                } else {
                    toast({ type: 'ok', title: `${trulyNew.length} new files`, sub: trulyNew.slice(0, 3).map(f => f.name).join(', ') + (trulyNew.length > 3 ? ` +${trulyNew.length - 3}` : ''), ms: 4500 });
                }
            }
            // Mark them as known after a delay so the badge disappears
            setTimeout(() => {
                trulyNew.forEach(f => knownFileNames.add(f.name));
            }, NEW_BADGE_TTL_MS);
        }

        lastFileSnapshot = files;
        firstLoad = false;
    }

    function showNewBadgeCount(newThisRefresh, knownFileNames) {
        let n = 0;
        for (const name of newThisRefresh) if (!knownFileNames.has(name)) n++;
        return n;
    }

    function updateStats(count, totalBytes) {
        statFiles.textContent = String(count);
        statSize.textContent = fmtSize(totalBytes);
    }

    /* ============ Polling /api/files with hash-based diffing ============ */
    async function refreshFiles({ forceRender = false } = {}) {
        try {
            const res = await fetch('/api/files', { credentials: 'same-origin', cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const files = data.files || [];

            // Online — reset failure counter
            if (!isOnline || consecutiveFailures > 0) {
                isOnline = true;
                consecutiveFailures = 0;
                setStatus('online');
            }

            // Skip the DOM work entirely if the snapshot hasn't changed
            if (!forceRender && data.hash && data.hash === lastHash) return;

            const wasInitialLoad = (lastHash === null);
            lastHash = data.hash;
            renderFiles(files, { isNew: !wasInitialLoad });
            updateStats(data.count || 0, data.total_bytes || 0);
        } catch (err) {
            consecutiveFailures++;
            if (consecutiveFailures === 1) {
                // First failure — show reconnecting state
                setStatus('reconnecting');
            } else if (consecutiveFailures >= 3) {
                // After 3 consecutive failures (~4.5s at 1.5s interval), mark offline
                if (isOnline) {
                    isOnline = false;
                    setStatus('offline');
                    toast({ type: 'err', title: 'Host unreachable', sub: 'Will keep retrying…', ms: 5000 });
                }
            }
            // Slow down polling when offline
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = setInterval(() => refreshFiles(), POLL_INTERVAL_OFFLINE_MS);
            }
        }
    }

    function startPolling() {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(() => refreshFiles(), POLL_INTERVAL_MS);
    }
    function stopPolling() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    // Restore normal polling speed once we're back online
    function restorePollingIfOnline() {
        if (isOnline && pollTimer) {
            clearInterval(pollTimer);
            pollTimer = setInterval(() => refreshFiles(), POLL_INTERVAL_MS);
        }
    }

    /* ============ Upload (sequential with progress, no full reload) ============ */
    async function uploadOne(item, idx, total) {
        const fd = new FormData();
        fd.append('file', item.file, item.file.name);
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/');
            xhr.upload.onprogress = e => {
                if (e.lengthComputable) {
                    const pct = (e.loaded / e.total) * 100;
                    const base = (idx / total) * 100;
                    const mine = (pct / 100) * (100 / total);
                    progressBar.style.width = `${base + mine}%`;
                }
            };
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) resolve();
                else reject(new Error(`HTTP ${xhr.status}`));
            };
            xhr.onerror = () => reject(new Error('Network error'));
            xhr.send(fd);
        });
    }

    form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!pending.length) {
            toast({ type: 'err', title: 'No file selected', sub: 'Pick or drop a file first.' });
            return;
        }
        uploadBtn.disabled = true;
        topProgress.classList.add('active');
        progressBar.style.width = '0%';

        const total = pending.length;
        let okCount = 0, failCount = 0;
        const failedItems = [];

        for (let i = 0; i < pending.length; i++) {
            const item = pending[i];
            try {
                await uploadOne(item, i, total);
                okCount++;
                toast({ type: 'ok', title: 'Sent', sub: item.file.name, ms: 2400 });
            } catch (err) {
                failCount++;
                failedItems.push(item);
                toast({ type: 'err', title: 'Failed', sub: `${item.file.name} — ${err.message}`, ms: 5000 });
                console.error('Upload failed for', item.file.name, err);
            }
        }

        progressBar.style.width = '100%';
        await sleep(280);
        topProgress.classList.remove('active');
        await sleep(200);
        progressBar.style.width = '0%';
        uploadBtn.disabled = false;

        if (failCount === 0) {
            pending = [];
            renderQueue();
            toast({ type: 'ok', title: 'All sent', sub: `${okCount} file${okCount > 1 ? 's' : ''} uploaded.`, ms: 2600 });
        } else {
            pending = failedItems;
            renderQueue();
            toast({ type: 'info', title: 'Partial', sub: `${okCount} ok, ${failCount} failed — retry ready.`, ms: 4000 });
        }

        // Immediately refresh the file list so sender sees their file appear.
        // forceRender (not isNew) — we DON'T want the chime/new-badge to fire for
        // files the user just uploaded themselves.
        await refreshFiles({ forceRender: true });
    });

    /* ============ Download / Delete (delegated) ============ */
    fileList.addEventListener('click', async e => {
        const dlBtn = e.target.closest('.download-btn');
        const delBtn = e.target.closest('.delete-btn');

        if (dlBtn) {
            const name = dlBtn.dataset.file;
            dlBtn.disabled = true;
            const original = dlBtn.innerHTML;
            dlBtn.innerHTML = `<svg class="spinning" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg><span>...</span>`;
            try {
                const res = await fetch(`/download/${encodeURIComponent(name)}`, { credentials: 'same-origin' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = name;
                document.body.appendChild(a); a.click(); a.remove();
                URL.revokeObjectURL(url);
                toast({ type: 'ok', title: 'Downloaded', sub: name, ms: 2400 });
            } catch (err) {
                toast({ type: 'err', title: 'Download failed', sub: name, ms: 3600 });
            } finally {
                dlBtn.disabled = false;
                dlBtn.innerHTML = original;
            }
            return;
        }

        if (delBtn) {
            const name = delBtn.dataset.file;
            const item = delBtn.closest('.file');
            if (!confirm(`Delete "${name}" from the server?`)) return;
            delBtn.disabled = true;
            try {
                const res = await fetch(`/delete/${encodeURIComponent(name)}`, { method: 'POST', credentials: 'same-origin' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                if (item) {
                    item.style.transition = 'all 280ms ease';
                    item.style.opacity = '0';
                    item.style.transform = 'translateX(20px) scale(0.95)';
                    setTimeout(() => item.remove(), 280);
                }
                toast({ type: 'ok', title: 'Deleted', sub: name, ms: 2400 });
                // Sync stats + snapshot across all devices
                await refreshFiles({ forceRender: true });
            } catch (err) {
                toast({ type: 'err', title: 'Delete failed', sub: name, ms: 3600 });
                delBtn.disabled = false;
            }
        }
    });

    /* ============ Search filter ============ */
    searchInput.addEventListener('input', () => {
        const q = searchInput.value.trim().toLowerCase();
        Array.from(fileList.querySelectorAll('.file')).forEach(li => {
            const name = (li.dataset.name || '').toLowerCase();
            li.style.display = !q || name.includes(q) ? '' : 'none';
        });
    });

    /* ============ Refresh button ============ */
    refreshBtn.addEventListener('click', async () => {
        const svg = refreshBtn.querySelector('svg');
        svg.classList.add('spinning');
        await refreshFiles({ forceRender: true });
        await sleep(400);
        svg.classList.remove('spinning');
        toast({ type: 'info', title: 'Refreshed', sub: 'File list updated.', ms: 1600 });
        restorePollingIfOnline();
    });

    /* ============ Keyboard ============ */
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && document.activeElement === searchInput) {
            searchInput.value = '';
            searchInput.dispatchEvent(new Event('input'));
            searchInput.blur();
        }
    });

    /* ============ Pause polling when tab hidden ============ */
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopPolling();
        } else {
            // Coming back to the tab — force a refresh and resume polling
            refreshFiles({ forceRender: true });
            startPolling();
        }
    });

    /* ============ Online/offline browser events ============ */
    window.addEventListener('online', () => {
        isOnline = true;
        consecutiveFailures = 0;
        setStatus('reconnecting');
        refreshFiles({ forceRender: true }).then(() => {
            restorePollingIfOnline();
        });
    });
    window.addEventListener('offline', () => {
        setStatus('offline');
        toast({ type: 'err', title: 'Network offline', sub: 'Will resume when reconnected.', ms: 5000 });
    });

    /* ============ Boot ============ */
    // No SSR — fetch file list immediately from /api/files, then poll every 1.5s.
    // This is what makes cross-device work: any device uploads, every other device
    // sees the new file appear within ~1.5s with a NEW badge + chime.
    setStatus('idle');
    lastFileSnapshot = [];
    refreshFiles();
    startPolling();
})();
