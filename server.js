#!/usr/bin/env node
/**
 * Copyright (c) Local Transfer by camzzz
 * Licensed under the MIT License.
 * See LICENSE file in the project root for full license text.
 *
 * Inspired by the original "Local Encrypted Transfer" by loxy0devlp.
 * This variant is a plain (no-encryption) local sender / receiver for
 * localhost and LAN users, with a glassy animated web UI.
 *
 * Pure Node.js — only dependency is `formidable` for streaming multipart uploads.
 */

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');

let formidable;
try {
    // formidable v3 exports { formidable, Formidable, ... }
    const mod = require('formidable');
    formidable = mod.formidable || mod.default || mod;
} catch (e) {
    console.error('\x1b[31m[!]\x1b[0m Missing dependency: formidable');
    console.error('    Run \x1b[36mnpm install\x1b[0m first.');
    process.exit(1);
}

/* ============ Credits ============ */
const credits = {
    tool_name:    'Local Transfer',
    tool_version: '1.0',
    tool_license: 'MIT License',
    tool_github:  'github.com/cameleonnbss',
    developer:    'camzzz',
    based_on:     'Local Encrypted Transfer by loxy0devlp',
};

/* ============ Paths ============ */
const ROOT          = __dirname;
const STORAGE_DIR   = path.join(ROOT, 'Storage');
const STRUCTURE_DIR = path.join(ROOT, 'Structure');
const CONFIG_DIR    = path.join(ROOT, 'Config');
const CONFIG_FILE   = path.join(CONFIG_DIR, 'Config.json');
const LOGS_FILE     = path.join(CONFIG_DIR, 'Logs.json');

/* ============ Config ============ */
let config = { host: '0.0.0.0', port: 9999 };
try { config = Object.assign(config, JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))); }
catch (e) { console.warn(`[!] Could not read Config.json — using defaults: ${e.message}`); }
const HOST = config.host;
const PORT = config.port;

/* ============ Banner ============ */
const banner = `
 \x1b[36m _                    _                      _\x1b[0m                 \x1b[35mmade by\x1b[0m \x1b[32mcamzzz\x1b[0m
\x1b[36m| |    ___   ___ __ _| |  ___  ___ _ __   __| | ___ _ __\x1b[0m       \x1b[37mhttps://github.com/cameleonnbss\x1b[0m
\x1b[36m| |   / _ \\ / __/ _\` | | / __|/ _ \\ '_ \\ / _\` |/ _ \\ '__|\x1b[0m
\x1b[36m| |__| (_) | (_| (_| | | \\__ \\  __/ | | | (_| |  __/ |\x1b[0m   \x1b[34mno crypt  -  local host  -  lan ready\x1b[0m
\x1b[36m|____|\\___/ \\___\\__,_|_| |___/\\___|_| |_|\\__,_|\\___|_|\x1b[0m   \x1b[34mv${credits.tool_version}  (${credits.tool_license})\x1b[0m
`;

/* ============ Helpers ============ */
function ensureDirs() {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
    fs.mkdirSync(CONFIG_DIR,  { recursive: true });
    if (!fs.existsSync(LOGS_FILE)) fs.writeFileSync(LOGS_FILE, '{}');
}

function loadLogs() {
    try {
        const data = JSON.parse(fs.readFileSync(LOGS_FILE, 'utf-8'));
        return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    } catch { return {}; }
}

function saveLogs(data) {
    fs.writeFileSync(LOGS_FILE, JSON.stringify(data, null, 2));
}

function humanSize(num) {
    const units = ['B','KB','MB','GB','TB'];
    let i = 0;
    while (Math.abs(num) >= 1024 && i < units.length - 1) { num /= 1024; i++; }
    return `${num.toFixed(num < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function getLocalIp() {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
        for (const iface of ifaces[name] || []) {
            if (iface.family === 'IPv4' && !iface.internal) return iface.address;
        }
    }
    return '127.0.0.1';
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

// Sync Logs.json with what's actually on disk
const IGNORED_STORAGE_ENTRIES = new Set(['.gitkeep', '.DS_Store', 'Thumbs.db', 'desktop.ini']);

function scanStorage() {
    const files = loadLogs();
    const onDisk = new Set();
    for (const entry of fs.readdirSync(STORAGE_DIR)) {
        if (IGNORED_STORAGE_ENTRIES.has(entry)) continue;
        try {
            if (fs.statSync(path.join(STORAGE_DIR, entry)).isFile()) onDisk.add(entry);
        } catch {}
    }
    for (const name of Object.keys(files)) {
        if (!onDisk.has(name)) delete files[name];
    }
    let nextNum = Object.values(files).reduce((m, n) => Math.max(m, n), 0);
    for (const name of onDisk) {
        if (!(name in files)) {
            files[name] = ++nextNum;
        }
    }
    saveLogs(files);
    return files;
}

function buildFileList() {
    const files = scanStorage();
    const enriched = [];
    let totalBytes = 0;
    const entries = Object.entries(files).sort((a, b) => a[1] - b[1]);
    for (const [name, number] of entries) {
        const full = path.join(STORAGE_DIR, name);
        let size = 0, mtime = 0;
        try {
            const stat = fs.statSync(full);
            size = stat.size; mtime = stat.mtimeMs;
        } catch {}
        totalBytes += size;
        const d = new Date(mtime);
        const dateStr = mtime
            ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
            : '—';
        enriched.push({
            name,
            number,
            size_bytes: size,
            size: size ? humanSize(size) : '—',
            date: dateStr,
            ext: (path.extname(name).slice(1) || 'file').toLowerCase(),
            mtime: mtime,
        });
    }
    // Snapshot hash so clients can cheaply detect changes (no DOM diff if unchanged)
    const hashInput = enriched.map(f => `${f.name}:${f.size_bytes}:${f.mtime}`).join('|');
    const hash = crypto.createHash('sha1').update(hashInput).digest('hex').slice(0, 16);
    return { enriched, totalBytes, hash };
}

// Load and inject HTML template (CSS + JS inline)
function buildHtml() {
    const css = fs.readFileSync(path.join(STRUCTURE_DIR, 'Css.css'), 'utf-8');
    const js  = fs.readFileSync(path.join(STRUCTURE_DIR, 'Javascript.js'), 'utf-8');
    let html  = fs.readFileSync(path.join(STRUCTURE_DIR, 'Html.html'), 'utf-8');
    const title1 = `${credits.tool_name} v${credits.tool_version} (by ${credits.developer})`;
    const title2 = credits.tool_name;
    return html
        .replace('/*%CSS%*/',        css)
        .replace('/*%JAVASCRIPT%*/', js)
        .replace('/*%TITLE1%*/',     title1)
        .replace('/*%TITLE2%*/',     title2)
        .replace(/\/\*%GITHUB%\*\//g, credits.tool_github)
        .replace(/\/\*%DEVELOPER%\*\//g, credits.developer);
}

/* ============ HTTP server ============ */
const server = http.createServer((req, res) => {
    // WHATWG URL parsing (req.url is relative, so use a base)
    const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(parsed.pathname);

    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const sendJson = (obj, status = 200) => {
        const body = JSON.stringify(obj);
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(body);
    };
    const sendText = (text, status = 200, ct = 'text/plain; charset=utf-8') => {
        res.writeHead(status, { 'Content-Type': ct });
        res.end(text);
    };

    /* ----- GET / — render page ----- */
    if (req.method === 'GET' && pathname === '/') {
        try {
            const html = buildHtml();
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
        } catch (e) {
            console.log(`\x1b[31m[x]\x1b[0m Render failed: ${e.message}`);
            sendText('Render error', 500);
        }
        return;
    }

    /* ----- POST / — receive upload (multipart, streamed to disk) ----- */
    if (req.method === 'POST' && pathname === '/') {
        const form = formidable({
            uploadDir: STORAGE_DIR,
            keepExtensions: false,
            maxFileSize: 8 * 1024 * 1024 * 1024, // 8 GB
            filename: (name, ext, part) => {
                let safe = path.basename(part.originalFilename || 'unnamed');
                if (!safe) safe = `file_${Date.now()}`;
                let target = path.join(STORAGE_DIR, safe);
                if (fs.existsSync(target)) {
                    const b = path.basename(safe, path.extname(safe));
                    const e = path.extname(safe);
                    safe = `${b}_${Date.now()}${e}`;
                }
                return safe;
            }
        });

        form.parse(req, (err, fields, files) => {
            if (err) {
                console.log(`\x1b[31m[x]\x1b[0m Upload error: ${err.message}`);
                return sendText('Upload error', 400);
            }
            const uploaded = files.file;
            if (!uploaded) {
                console.log('\x1b[31m[x]\x1b[0m No file in POST');
                return sendText('No file', 400);
            }
            const file = Array.isArray(uploaded) ? uploaded[0] : uploaded;
            scanStorage();
            console.log(`\x1b[32m[+]\x1b[0m File received: \x1b[37m${file.originalFilename}\x1b[0m \x1b[36m(${humanSize(file.size)})\x1b[0m`);
            return sendText('OK', 200);
        });
        return;
    }

    /* ----- GET /api/files — JSON list (for live polling) ----- */
    if (req.method === 'GET' && pathname === '/api/files') {
        const { enriched, totalBytes, hash } = buildFileList();
        return sendJson({
            files: enriched,
            count: enriched.length,
            total_bytes: totalBytes,
            total_size: humanSize(totalBytes),
            hash,
            server_time: Date.now(),
        });
    }

    /* ----- GET /download/:filename ----- */
    if (req.method === 'GET' && pathname.startsWith('/download/')) {
        const safe = path.basename(pathname.slice('/download/'.length));
        const full = path.join(STORAGE_DIR, safe);
        if (!fs.existsSync(full)) return sendText('File not found', 404);
        console.log(`\x1b[32m[+]\x1b[0m File downloaded: \x1b[37m${safe}\x1b[0m`);
        const stat = fs.statSync(full);
        res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': stat.size,
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safe)}`,
        });
        fs.createReadStream(full).pipe(res);
        return;
    }

    /* ----- POST /delete/:filename ----- */
    if (req.method === 'POST' && pathname.startsWith('/delete/')) {
        const safe = path.basename(pathname.slice('/delete/'.length));
        const full = path.join(STORAGE_DIR, safe);
        if (!fs.existsSync(full)) return sendText('File not found', 404);
        try {
            fs.unlinkSync(full);
            const logs = loadLogs();
            delete logs[safe];
            saveLogs(logs);
            console.log(`\x1b[32m[+]\x1b[0m File deleted: \x1b[37m${safe}\x1b[0m`);
            return sendText('OK', 200);
        } catch (e) {
            console.log(`\x1b[31m[x]\x1b[0m Delete failed: ${e.message}`);
            return sendText('Error', 500);
        }
    }

    /* ----- GET /favicon.ico ----- */
    if (req.method === 'GET' && pathname === '/favicon.ico') {
        const ico = path.join(STRUCTURE_DIR, 'Icone.ico');
        if (fs.existsSync(ico)) {
            const data = fs.readFileSync(ico);
            res.writeHead(200, { 'Content-Type': 'image/vnd.microsoft.icon' });
            return res.end(data);
        }
        return sendText('', 204);
    }

    return sendText('Not found', 404);
});

/* ============ Boot ============ */
ensureDirs();
const IP = getLocalIp();
console.log(banner);
console.log('\x1b[34mAccess:\x1b[0m');
console.log(` * Local   : \x1b[32mhttp://localhost:${PORT}\x1b[0m`);
console.log(` * Network : \x1b[32mhttp://${IP}:${PORT}\x1b[0m`);
console.log(`\x1b[34mStorage :\x1b[0m \x1b[37m${STORAGE_DIR}\x1b[0m`);
console.log('\x1b[34mLogs:\x1b[0m');

server.listen(PORT, HOST, () => {
    const actualPort = server.address().port;
    console.log(`\x1b[32m[+]\x1b[0m Listening on \x1b[37m${HOST}:${actualPort}\x1b[0m`);
});

process.on('SIGINT', () => {
    console.log('\n\x1b[34m[!]\x1b[0m Shutting down. Bye!');
    process.exit(0);
});

process.on('uncaughtException', (e) => {
    console.log(`\x1b[31m[x]\x1b[0m Fatal: ${e.message}`);
});
