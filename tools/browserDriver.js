/**
 * tools/browserDriver.js
 * ヘッドレス Chrome を DevTools Protocol で操作するための部品 (追加のパッケージは使わない。Node.js 22 以降)
 * gas_app/ を配信する簡易サーバーを立て、ページの操作・ファイルの投入・スクリーンショットの取得を行う。
 * マニュアル用スクリーンショットの撮影 (capture_manual_screenshots.js) と、画面の確認で使う
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png'
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * ブラウザを起動する
 * @param {Object} options
 *   siteDir: 配信するフォルダ (例: gas_app)
 *   viewport: { width, height } 画面の大きさ (既定 1240 x 900)
 *   injectScript: ページの読み込み前に実行するスクリプト (文字列。省略可)
 *   onRequest: (req, res) => boolean  サーバーへの要求を独自に処理する場合に指定 (処理したら true を返す。省略可)
 * @returns {Promise<Object>} ページを操作する関数群
 */
async function launchBrowser(options) {
  const siteDir = path.resolve(options.siteDir);
  const viewport = Object.assign({ width: 1240, height: 900 }, options.viewport || {});

  // 1. 簡易サーバー
  const server = http.createServer((req, res) => {
    if (options.onRequest && options.onRequest(req, res)) return;
    const file = path.join(siteDir, decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(siteDir)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(buf);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // 2. Chrome の起動と接続
  if (!fs.existsSync(CHROME_PATH)) throw new Error(`Chrome が見つかりません: ${CHROME_PATH} (環境変数 CHROME_PATH で指定できます)`);
  const debugPort = 9300 + Math.floor(Math.random() * 500);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-app-chrome-'));
  const chrome = spawn(CHROME_PATH, [
    '--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    `--window-size=${viewport.width},${viewport.height}`, 'about:blank'
  ], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 100 && !wsUrl; i++) {
    await sleep(200);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      wsUrl = (targets.find(t => t.type === 'page') || {}).webSocketDebuggerUrl;
    } catch (e) { /* 起動待ち */ }
  }
  if (!wsUrl) throw new Error('Chrome に接続できません');
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let seq = 0;
  const pending = new Map();
  const listeners = {};
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error))); else p.resolve(msg.result);
    } else {
      (listeners[msg.method] || []).forEach(fn => fn(msg.params));
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const on = (method, fn) => { (listeners[method] = listeners[method] || []).push(fn); };

  // ページ内のエラーと、開こうとした別タブのURLを記録する
  const consoleMessages = [];
  on('Runtime.consoleAPICalled', p => {
    if (p.type === 'error' || p.type === 'warning') {
      consoleMessages.push(`${p.type}: ` + p.args.map(a => (a.value !== undefined ? String(a.value) : (a.description || a.type))).join(' ').slice(0, 300));
    }
  });
  on('Runtime.exceptionThrown', p => consoleMessages.push('exception: ' + ((p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text).slice(0, 400)));
  on('Page.javascriptDialogOpening', () => send('Page.handleJavaScriptDialog', { accept: true }));

  await send('Page.enable');
  await send('Runtime.enable');
  await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
  // 画面が落ち着いたことを判定するための記録、グラフのアニメーション停止、通知の記録
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__lastMutation = Date.now(); window.__toasts = [];
    (function(){ var chartRef; Object.defineProperty(window, 'Chart', { configurable: true, get: function(){ return chartRef; }, set: function(v){ chartRef = v; try { v.defaults.animation = false; } catch (e) {} } }); })();
    document.addEventListener('DOMContentLoaded', function(){
      new MutationObserver(function(mutations){
        window.__lastMutation = Date.now();
        mutations.forEach(function(m){ m.addedNodes.forEach(function(n){
          if (n.nodeType === 1 && n.parentElement && n.parentElement.id === 'toastContainer') window.__toasts.push('[' + n.className.replace('toast ', '') + '] ' + n.innerText.replace(/\\n/g, ' '));
        }); });
      }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    });
    ${options.injectScript || ''}` });

  /** ページ内で式を評価して値を返す */
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('ページ内の処理でエラー: ' + JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result.value;
  };

  /** 読み込み・集計・描画が終わって画面が落ち着くまで待つ */
  const settle = async (maxMs = 600000) => {
    const started = Date.now();
    await sleep(250);
    for (;;) {
      const s = await evalJs(`(function(){
        var overlay = document.getElementById('globalLoadingOverlay');
        return { overlay: overlay ? getComputedStyle(overlay).display : 'none', quiet: Date.now() - window.__lastMutation, ready: document.readyState, pending: window.__gasPending || 0 };
      })()`);
      if (s.ready === 'complete' && s.overlay === 'none' && s.quiet > 900 && !s.pending) return;
      if (Date.now() - started > maxMs) throw new Error('画面が落ち着きません: ' + JSON.stringify(s));
      await sleep(200);
    }
  };

  const goto = async (urlPath) => {
    await send('Page.navigate', { url: baseUrl + urlPath });
    await settle();
    await evalJs(`document.fonts.ready.then(function(){ return true; })`);
  };
  const click = selector => evalJs(`(function(){ var e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('要素がありません: ' + ${JSON.stringify(selector)}); e.click(); return true; })()`);
  const select = (id, value) => evalJs(`(function(){
    var e = document.getElementById(${JSON.stringify(id)}); if (!e) throw new Error('要素がありません: ' + ${JSON.stringify(id)});
    e.value = ${JSON.stringify(value)};
    if (e.value !== ${JSON.stringify(value)}) throw new Error('選択肢がありません: ' + ${JSON.stringify(id)} + ' = ' + ${JSON.stringify(value)});
    e.dispatchEvent(new Event('change', { bubbles: true })); return e.value; })()`);
  /** ファイル選択の入力欄にファイルを設定する (ドラッグ＆ドロップの代わり) */
  const setFiles = async (selector, files) => {
    const doc = await send('DOM.getDocument');
    const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector });
    await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files });
  };

  /**
   * スクリーンショットを保存する
   * @param {string} filePath 保存先 (.webp / .png)
   * @param {Object} [opts] { clip: { x, y, width, height } (ページ座標)、fullPage: true でページ全体、quality: WebP の品質 }
   */
  const screenshot = async (filePath, opts = {}) => {
    const format = path.extname(filePath) === '.png' ? 'png' : 'webp';
    const params = { format, captureBeyondViewport: true };
    if (format === 'webp') params.quality = opts.quality || 82;
    if (opts.clip) {
      params.clip = Object.assign({ scale: 1 }, opts.clip);
    } else if (opts.fullPage) {
      const metrics = await send('Page.getLayoutMetrics');
      params.clip = { x: 0, y: 0, width: viewport.width, height: Math.ceil(metrics.cssContentSize.height), scale: 1 };
    } else {
      params.clip = { x: 0, y: 0, width: viewport.width, height: viewport.height, scale: 1 };
    }
    const r = await send('Page.captureScreenshot', params);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(r.data, 'base64'));
  };

  const close = async () => {
    ws.close();
    chrome.kill();
    server.close();
    await sleep(500);
    fs.rmSync(profileDir, { recursive: true, force: true });
  };

  return { baseUrl, viewport, consoleMessages, send, evalJs, settle, goto, click, select, setFiles, screenshot, close };
}

module.exports = { launchBrowser, sleep };
