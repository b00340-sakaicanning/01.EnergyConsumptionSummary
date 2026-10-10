/**
 * tools/capture_manual_screenshots.js
 * 操作マニュアル用の注釈付きスクリーンショットを撮影し、gas_app/manual_images/ に保存する
 *
 * 実行: node tools/capture_manual_screenshots.js   (プロジェクトのルートで実行。事前に node gas_app/build.js を実行しておく)
 * 必要なもの: Google Chrome、reference/読込用データ/ の実データ (ロガーデータ・エネルギー計算表・月報PET)、
 *            インターネット接続 (画面が CDN の Chart.js・SheetJS を読み込むため)
 *
 * - gas_app/index.html をヘッドレス Chrome で開き、実データを投入して各場面の画面を作る
 * - 本番 (GAS) と同じ見た目にするため、開発用のデモボタンを隠し、デモデータの自動読込を止める
 * - 撮影の直前に、説明する箇所へ赤枠と番号のバッジを重ねる。番号はマニュアル本文の ❶❷❸… に対応する
 * - 表は先頭の数行だけを写す (実際の画面では、表の中をスクロールして全行を見られる)
 * - 画面を変更したときは、このスクリプトを再実行して撮り直し、node gas_app/build.js で manual.html を作り直す
 */

const fs = require('fs');
const path = require('path');
const { launchBrowser } = require('./browserDriver.js');

const projectRoot = path.join(__dirname, '..');
const siteDir = path.join(projectRoot, 'gas_app');
const outputDir = path.join(siteDir, 'manual_images');
const dataDir = path.join(projectRoot, 'reference', '読込用データ');
const VIEWPORT = { width: 1240, height: 900 };
// WebP の品質 (1〜100)。大きくすると鮮明になるが、manual.html の容量が増える
const WEBP_QUALITY = 75;
// 電力の画面に読み込む年度 (4月〜翌3月の12か月分のロガーデータを投入する)
const POWER_FISCAL_YEAR = '2024';

// ----- 投入するファイル -----
const loggerFilesOf = (fiscalYear) => {
  const yearDir = path.join(dataDir, 'CSVデータ', `${fiscalYear}年度`);
  return fs.readdirSync(yearDir).filter(d => /^\d{6}$/.test(d)).sort().flatMap(ym =>
    fs.readdirSync(path.join(yearDir, ym)).filter(f => /^AQ\d{8}_\d{3}\.TXT$/i.test(f)).sort().map(f => path.join(yearDir, ym, f)));
};
const excelFiles = () => fs.readdirSync(dataDir).filter(f => /\.xlsx$/i.test(f)).sort().map(f => path.join(dataDir, f));

// ----- ページへ注入するスクリプト -----
// スプレッドシートに何も保存されていない GAS 環境を模す (デモデータの自動読込を止め、反映は成功として扱う)
const GAS_STUB = `
  (function(){
    var responses = {
      loadSavedSummaryFromSpreadsheet: { success: true, savedYms: [], monthlySummary: {} },
      loadSavedFuelData: { success: true, months: {} },
      loadSavedTotalEnergyData: { success: true, months: {} },
      saveFuelMonthlyData: { success: true },
      saveTotalEnergyMonthlyData: { success: true },
      getSheetsDataForExport: { success: true, sheets: {} },
      getAppUrl: ''
    };
    function makeRunner(onSuccess, onFailure) {
      var runner = {
        withSuccessHandler: function(h){ return makeRunner(h, onFailure); },
        withFailureHandler: function(h){ return makeRunner(onSuccess, h); },
        saveAggregatedData: function(payload){ setTimeout(function(){ if (onSuccess) onSuccess({ success: true, yearMonth: payload.yearMonth }); }, 30); }
      };
      Object.keys(responses).forEach(function(fn){
        runner[fn] = function(){ setTimeout(function(){ if (onSuccess) onSuccess(JSON.parse(JSON.stringify(responses[fn]))); }, 30); };
      });
      return runner;
    }
    window.google = { script: { run: makeRunner(null, null) } };
  })();`;

// 注釈 (赤枠と番号のバッジ) と、撮影用の見た目の調整
const ANNOTATION_SCRIPT = `
  document.addEventListener('DOMContentLoaded', function(){
    var style = document.createElement('style');
    style.textContent =
      '.dev-only-btn { display: none !important; }' +
      '.capture-hide-toasts #toastContainer { visibility: hidden !important; }' +
      // 表は先頭の数行だけを写す (画像が縦に長くなりすぎないようにする)
      '.table-responsive { max-height: 262px !important; overflow: hidden !important; }' +
      '#manualAnnotationLayer { position: absolute; top: 0; left: 0; width: 100%; height: 0; pointer-events: none; z-index: 999999; }' +
      '.ann-box { position: absolute; border: 3px solid #ef4444; border-radius: 8px; box-sizing: border-box; box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.2), 0 4px 16px rgba(239, 68, 68, 0.15); }' +
      '.ann-badge { position: absolute; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%); color: #ffffff; font: 800 15px/1 -apple-system, "Segoe UI", Arial, sans-serif; border: 2.5px solid #ffffff; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.35); }';
    document.head.appendChild(style);
    document.body.classList.add('capture-hide-toasts');
  });
  // 注釈を描く。targets: [{ selector, closest, badge, pad, badgeAt, clampTo }]
  // closest: selector の要素から見て最も近い祖先を対象にする / clampTo: 指定した要素からはみ出す部分を切り詰める (スクロールする領域の中の要素用)
  window.__annotate = function(targets) {
    var old = document.getElementById('manualAnnotationLayer');
    if (old) old.remove();
    var layer = document.createElement('div');
    layer.id = 'manualAnnotationLayer';
    document.body.appendChild(layer);
    targets.forEach(function(t){
      var el = document.querySelector(t.selector);
      if (el && t.closest) el = el.closest(t.closest);
      if (!el) throw new Error('注釈の対象がありません: ' + t.selector);
      var r = el.getBoundingClientRect();
      var rectTop = r.top, rectBottom = r.bottom;
      if (t.clampTo) {
        var limit = document.querySelector(t.clampTo).getBoundingClientRect();
        rectTop = Math.max(rectTop, limit.top);
        rectBottom = Math.min(rectBottom, limit.bottom);
      }
      var pad = t.pad === undefined ? 5 : t.pad;
      var left = Math.max(r.left + window.scrollX - pad, 3);
      var top = rectTop + window.scrollY - pad;
      var width = Math.min(r.width + pad * 2, document.documentElement.clientWidth - left - 3);
      var box = document.createElement('div');
      box.className = 'ann-box';
      box.style.cssText = 'left:' + left + 'px; top:' + top + 'px; width:' + width + 'px; height:' + (rectBottom - rectTop + pad * 2) + 'px;';
      layer.appendChild(box);
      var badge = document.createElement('div');
      badge.className = 'ann-badge';
      badge.textContent = t.badge;
      // バッジの位置: 既定は枠の左上の角。badgeAt が 'top-right' なら右上の角
      var badgeLeft = t.badgeAt === 'top-right' ? left + width - 15 : left - 15;
      badge.style.cssText = 'left:' + Math.max(badgeLeft, 2) + 'px; top:' + Math.max(top - 15, 2) + 'px;';
      layer.appendChild(badge);
    });
    return true;
  };
  window.__clearAnnotations = function() { var old = document.getElementById('manualAnnotationLayer'); if (old) old.remove(); return true; };
  // 要素の上端・下端のページ上の位置。target は selector の文字列、または { selector, closest }
  window.__edge = function(target, edge) {
    var selector = typeof target === 'string' ? target : target.selector;
    var el = document.querySelector(selector);
    if (el && target.closest) el = el.closest(target.closest);
    if (!el) throw new Error('要素がありません: ' + selector);
    var r = el.getBoundingClientRect();
    return (edge === 'top' ? r.top : r.bottom) + window.scrollY;
  };`;

(async () => {
  if (!fs.existsSync(path.join(siteDir, 'index.html'))) throw new Error('gas_app/index.html がありません。先に node gas_app/build.js を実行してください');
  if (!fs.existsSync(dataDir)) throw new Error(`実データがありません: ${dataDir}`);

  const browser = await launchBrowser({ siteDir, viewport: VIEWPORT, injectScript: GAS_STUB + ANNOTATION_SCRIPT });
  const { goto, click, select, setFiles, settle, evalJs, screenshot } = browser;
  const saved = [];
  try {

  /**
   * 注釈を付けて撮影する
   * @param {string} name ファイル名 (拡張子なし)
   * @param {Object} scene { annotations: 注釈の対象の配列, from: 上端の要素 (省略時はページの先頭), to: 下端の要素, viewportOnly: 画面に見えている範囲だけを撮る }
   *   from・to は selector の文字列、または { selector, closest }
   */
  const shoot = async (name, scene) => {
    await settle();
    await evalJs('window.scrollTo(0, 0)');
    await evalJs(`window.__annotate(${JSON.stringify(scene.annotations || [])})`);
    let clip;
    if (!scene.viewportOnly) {
      const top = scene.from ? Math.max(await evalJs(`window.__edge(${JSON.stringify(scene.from)}, 'top')`) - 24, 0) : 0;
      const bottom = await evalJs(`window.__edge(${JSON.stringify(scene.to)}, 'bottom')`) + 24;
      clip = { x: 0, y: Math.round(top), width: VIEWPORT.width, height: Math.round(bottom - top) };
    }
    const filePath = path.join(outputDir, `${name}.webp`);
    await screenshot(filePath, { clip, quality: WEBP_QUALITY });
    await evalJs('window.__clearAnnotations()');
    saved.push({ name, bytes: fs.statSync(filePath).size });
    process.stdout.write(`  ${name}.webp (${(fs.statSync(filePath).size / 1024).toFixed(0)} KB)\n`);
  };
  const switchApp = id => click(`.app-switch-btn[data-app="${id}"]`);
  const switchPowerView = view => click(`.main-nav-btn[data-view="${view}"]`);

  console.log('スクリーンショットを撮影します (実データの読み込みに1〜2分かかります)');
  fs.mkdirSync(outputDir, { recursive: true });
  await goto('/index.html');

  // ----- データの投入: 電力の単月詳細集約に、ロガーデータ (1年度分) と Excel 2種を投入する -----
  await switchPowerView('monthlyView');
  await setFiles('#fileInput', [...loggerFilesOf(POWER_FISCAL_YEAR), ...excelFiles()]);
  await settle();

  // ===== 1章: システム概要と画面構成 =====
  await switchPowerView('annualView');
  await select('fiscalYearSelector', POWER_FISCAL_YEAR);
  await shoot('01_overview', {
    to: '#annualView .kpi-grid',
    annotations: [
      { selector: '.header-logo', badge: '1' },
      { selector: '#manualBtn', badge: '2' },
      { selector: '#syncStatusBadge', badge: '3' },
      { selector: '#scaleSettingBtn', badge: '4' },
      { selector: '#exportBtn', badge: '5' },
      { selector: '#syncBtn', badge: '6' },
      { selector: '#appSwitcher', badge: '7' },
      { selector: '#powerNav', badge: '8' }
    ]
  });

  // ===== 3章: 【電力】データの読み込みと単月の確認 =====
  await switchPowerView('monthlyView');
  await shoot('02_power_monthly_load', {
    from: '#appSwitcher',
    to: '#monthlyView .kpi-grid',
    annotations: [
      { selector: '#dropzone', badge: '1', pad: 2 },
      { selector: '#monthlyView .file-badges-container', badge: '2' },
      { selector: '#monthlyYearMonthSelect', closest: '.toolbar-card', badge: '3', pad: 2 },
      { selector: '#monthlyView .kpi-grid', badge: '4' }
    ]
  });
  await shoot('03_power_monthly_detail', {
    from: '#monthlyView .chart-grid',
    to: '#monthlyView .table-card',
    annotations: [
      { selector: '#dailyChart', closest: '.chart-card', badge: '1', pad: 2 },
      { selector: '#categoryChart', closest: '.chart-card', badge: '2', pad: 2 },
      { selector: '#monthlyView .table-card', badge: '3', pad: 2 }
    ]
  });

  // ===== 4章: 【電力】年間推移の確認 =====
  await switchPowerView('annualView');
  await shoot('04_power_annual_variety', {
    from: '#powerNav',
    to: '#annualView .table-card',
    annotations: [
      { selector: '#fiscalYearSelector', closest: '.toolbar-group', badge: '1' },
      { selector: '#operationModePills', closest: '.toolbar-group', badge: '2' },
      { selector: '#metricSelector', closest: '.toolbar-group', badge: '3' },
      { selector: '#annualView .kpi-grid', badge: '4' },
      { selector: '#annualStackedChart', closest: '.chart-card', badge: '5', pad: 2 },
      { selector: '#annualTrendChart', closest: '.chart-card', badge: '6', pad: 2 },
      { selector: '#annualView .table-card', badge: '7', pad: 2 }
    ]
  });
  await switchPowerView('annualEquipmentView');
  await shoot('05_power_annual_equipment', {
    from: '#powerNav',
    to: '#annualEquipmentView .table-card',
    annotations: [
      { selector: '#equipViewModePills', closest: '.toolbar-group', badge: '1' },
      { selector: '#annualEquipmentView .kpi-grid', badge: '2' },
      { selector: '#annualEquipmentTrendChart', closest: '.chart-card', badge: '3', pad: 2 },
      { selector: '#annualEquipmentDoughnutChart', closest: '.chart-card', badge: '4', pad: 2 },
      { selector: '#annualEquipmentView .table-card', badge: '5', pad: 2 }
    ]
  });
  await switchPowerView('annualView');
  await click('#scaleSettingBtn');
  await click('#scaleModeFixed');
  await shoot('06_scale_setting', {
    viewportOnly: true,
    annotations: [
      { selector: '#scaleModeAuto', closest: '.scale-mode-selector', badge: '1' },
      { selector: '#fixedScaleInputsArea', badge: '2', badgeAt: 'top-right', clampTo: '#scaleSettingModal .modal-body', pad: 2 },
      { selector: '#resetScaleModalBtn', badge: '3' },
      { selector: '#saveScaleModalBtn', badge: '4' }
    ]
  });
  await click('#scaleModeAuto');
  await click('#closeScaleModalBtn');

  // ===== 7章: スプレッドシートへの反映と Excel エクスポート (反映前のヘッダー) =====
  await shoot('11_sync_header', {
    to: '#appSwitcher',
    annotations: [
      { selector: '#syncStatusBadge', badge: '1' },
      { selector: '#exportBtn', badge: '2' },
      { selector: '#syncBtn', badge: '3' },
      { selector: '#appSwitcher', badge: '4' }
    ]
  });

  // ===== 5章: 【燃料エネルギー】 =====
  await switchApp('fuel');
  await select('fuelYearSelector', POWER_FISCAL_YEAR);
  await select('fuelMetricSelector', 'fuelMj');
  await shoot('07_fuel_main', {
    from: '#appSwitcher',
    to: '#fuelView .chart-grid',
    annotations: [
      { selector: '#fuelDropzone', badge: '1', pad: 2 },
      { selector: '#fuelView .file-badges-container', badge: '2' },
      { selector: '#fuelYearSelector', closest: '.toolbar-group', badge: '3' },
      { selector: '#fuelMetricSelector', closest: '.toolbar-group', badge: '4' },
      { selector: '#fuelView .kpi-grid', badge: '5' },
      { selector: '#fuelStackedChart', closest: '.chart-card', badge: '6', pad: 2 },
      { selector: '#fuelTrendChart', closest: '.chart-card', badge: '7', pad: 2 }
    ]
  });
  await shoot('08_fuel_tables', {
    from: { selector: '#fuelTableBody', closest: '.table-card' },
    to: { selector: '#fuelBreakdownTableBody', closest: '.table-card' },
    annotations: [
      { selector: '#fuelTableBody', closest: '.table-card', badge: '1', pad: 2 },
      { selector: '#fuelBreakdownTableBody', closest: '.table-card', badge: '2', pad: 2 }
    ]
  });

  // ===== 6章: 【トータルエネルギー】 =====
  await switchApp('total');
  await select('totalYearSelector', '2025');
  await shoot('09_total_monthly', {
    from: '#appSwitcher',
    to: '#totalEnergyView .chart-grid',
    annotations: [
      { selector: '#totalDropzone', badge: '1', pad: 2 },
      { selector: '#totalYearSelector', closest: '.toolbar-group', badge: '2' },
      { selector: '#totalModePills', closest: '.toolbar-group', badge: '3' },
      { selector: '#totalEnergyView .kpi-grid', badge: '4' },
      { selector: '#totalEnergyView .chart-grid', badge: '5', pad: 2 }
    ]
  });
  await click('#totalModePills .pill-btn[data-mode="yearly"]');
  await shoot('10_total_yearly', {
    from: '#totalYearSelector',
    to: '#totalSolarCard',
    annotations: [
      { selector: '#totalModePills', closest: '.toolbar-group', badge: '1' },
      { selector: '#totalEnergyView .chart-grid', badge: '2', pad: 2 },
      { selector: '#totalTableBody', closest: '.table-card', badge: '3', pad: 2 },
      { selector: '#totalSolarCard', badge: '4', pad: 2 }
    ]
  });
  await click('#totalModePills .pill-btn[data-mode="monthly"]');
  } finally {
    await browser.close();
  }
  const totalBytes = saved.reduce((sum, s) => sum + s.bytes, 0);
  console.log(`完了: ${saved.length} 枚 (計 ${(totalBytes / 1024).toFixed(0)} KB) を ${path.relative(projectRoot, outputDir)}/ に保存しました`);
  if (browser.consoleMessages.length > 0) {
    console.log('ページのエラー・警告:');
    browser.consoleMessages.slice(0, 10).forEach(m => console.log('  ' + m));
  }
})().catch(err => {
  console.error('撮影に失敗しました:', err.message);
  process.exit(1);
});
