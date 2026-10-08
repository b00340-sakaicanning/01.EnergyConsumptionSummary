/**
 * gas_app/js/app.js
 * フロントエンドUI制御・イベントハンドリング・年間月別＆単月パイプライン連携
 * (月別電力使用量集約グラフ表示(総電力 2024).xlsx 準拠)
 * 燃料エネルギーの画面 (fuelView.js) との切り替えと、Excel・同期・エクスポートの共用もここで行う
 */

(function () {
  // アプリケーション状態
  const state = {
    currentApp: 'power',            // 'power' (電力) | 'fuel' (燃料エネルギー)
    currentView: 'annualView',      // 'annualView' | 'monthlyView' | 'annualEquipmentView'
    currentAnnualMode: 'combined',   // 'combined' | 'waterOnly' | 'fillingOnly'
    currentMetric: 'powerKwh',       // 'powerKwh', 'operationMin', etc.
    annualEquipmentViewMode: 'utilityGroup', // 'utilityGroup' | 'detail'
    annualData: null,                // 年間データセット
    loadedFiles: [],                 // [{ fileName, content }]
    currentAggregation: null,        // 単月1時間集計 (現在表示中)
    monthlyDatasets: {},             // { [ym]: { ym, aggResult, catResult, kpiResult, externalData } }
    annualDatasets: {},              // { [fiscalYear]: annualData }
    lastSelectedMonthlyYm: null,     // 直前に表示していた年月
    syncedYms: new Set(),            // スプレッドシート反映済み年月セット
    scaleConfig: null,               // グラフ目盛りスケール設定
    externalData: {
      electricity: { usedKwhThousand: 288.075, costThousandYen: 6176.992, unitPriceYenPerKwh: 21.4423 }
    }
  };

  // 品種8大分類キー
  const VARIETY_KEYS = AppConfig.VARIETY_KEYS;
  const SCALE_STORAGE_KEY = 'energy_app_chart_scale_config_v1';
  // 目盛り自動算出の高さの目安。AppConfig.SCALE_CONFIG は起動時にGAS側の値で置き換わるため、読込時点の値を既定として保持する
  const DEFAULT_AUTO_LAYOUT = AppConfig.SCALE_CONFIG.autoLayout;
  // 画面上部の副題 (表示中のアプリごと)
  const APP_SUBTITLES = {
    power: '月別電力使用量集約グラフ・品種別推移 ＆ 原単位KPIダッシュボード',
    fuel: '月別燃料エネルギー使用量集約グラフ・品種別推移 ＆ 原単位KPIダッシュボード (A重油・LNG)'
  };
  const hasFuelView = typeof FuelView !== 'undefined';
  const POWER_VIEW_IDS = ['annualView', 'annualEquipmentView', 'monthlyView'];
  const FUEL_SHEET_NAME = '燃料集約';

  // DOM要素
  let dropzone, fileInput, progressBarContainer, progressBarFill;
  let annualDemoBtn, demoBtn, syncBtn, exportBtn, toastContainer;
  let metricSelector, fiscalYearSelector;
  let monthlyYearMonthSelect, monthlyDataStatus;
  let scaleSettingBtn, scaleSettingModal, closeScaleModalBtn, saveScaleModalBtn, resetScaleModalBtn;
  let scaleModeAuto, scaleModeFixed;

  /**
   * グローバルローディング表示 (通常メッセージのみ)
   */
  function showLoading(message) {
    const overlay = document.getElementById('globalLoadingOverlay');
    const msgElem = document.getElementById('loadingMessage');
    const progArea = document.getElementById('loadingProgressArea');
    if (overlay) {
      if (msgElem && message) msgElem.textContent = message;
      if (progArea) progArea.style.display = 'none';
      overlay.style.display = 'flex';
    }
  }

  /**
   * グローバルローディングの進捗状況をリアルタイム更新 (スプレッドシート反映等)
   */
  function updateLoadingProgress(title, percent, detailMsg, logItem) {
    const overlay = document.getElementById('globalLoadingOverlay');
    const msgElem = document.getElementById('loadingMessage');
    const progArea = document.getElementById('loadingProgressArea');
    const barFill = document.getElementById('loadingProgressBarFill');
    const percentElem = document.getElementById('loadingProgressPercent');
    const detailElem = document.getElementById('loadingProgressDetail');
    const logList = document.getElementById('loadingLogList');

    if (!overlay) return;
    overlay.style.display = 'flex';

    if (msgElem && title) msgElem.textContent = title;
    if (progArea) progArea.style.display = 'flex';
    if (barFill) barFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    if (percentElem) percentElem.textContent = `${Math.round(percent)}%`;
    if (detailElem && detailMsg) detailElem.textContent = detailMsg;

    if (logList && logItem) {
      const itemEl = document.createElement('div');
      itemEl.className = 'loading-log-item done';
      itemEl.textContent = logItem;
      logList.appendChild(itemEl);
      logList.scrollTop = logList.scrollHeight;
    }
  }

  function hideLoading() {
    const overlay = document.getElementById('globalLoadingOverlay');
    const progArea = document.getElementById('loadingProgressArea');
    const logList = document.getElementById('loadingLogList');
    if (overlay) {
      overlay.style.display = 'none';
      if (progArea) progArea.style.display = 'none';
      if (logList) logList.innerHTML = '';
    }
  }

  /**
   * 目盛り設定のロード (LocalStorage > AppConfig.SCALE_CONFIG)
   */
  function loadScaleConfig() {
    try {
      const saved = localStorage.getItem(SCALE_STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn('Failed to load scale config from localStorage:', e);
    }
    return JSON.parse(JSON.stringify(AppConfig.SCALE_CONFIG || { mode: 'auto', fixedValues: {} }));
  }

  /**
   * 目盛り設定の保存
   */
  function saveScaleConfig(config) {
    state.scaleConfig = config;
    try {
      localStorage.setItem(SCALE_STORAGE_KEY, JSON.stringify(config));
    } catch (e) {
      console.warn('Failed to save scale config to localStorage:', e);
    }
    try {
      refreshCurrentCharts();
    } catch (e) {
      console.error('Failed to refresh charts after scale change:', e);
    }
  }

  /**
   * 目盛り設定の初期値復元
   */
  function resetScaleConfig() {
    const defaultConfig = JSON.parse(JSON.stringify(AppConfig.SCALE_CONFIG || { mode: 'auto', fixedValues: {} }));
    saveScaleConfig(defaultConfig);
    populateScaleModalForm(defaultConfig);
    showToast('目盛り設定を初期値にリセットしました', 'info');
  }

  /**
   * 目盛り自動算出の高さの目安 (電力・燃料エネルギーの両方のグラフで使う)
   */
  function getAutoLayout() {
    return { ...DEFAULT_AUTO_LAYOUT, ...((AppConfig.SCALE_CONFIG && AppConfig.SCALE_CONFIG.autoLayout) || {}) };
  }

  /**
   * 全データから共通の目盛りスケール設定を算出
   */
  function getScaleOptions() {
    const cfg = state.scaleConfig || AppConfig.SCALE_CONFIG;
    const mode = (cfg && cfg.mode) ? cfg.mode : 'auto';
    const fixed = (cfg && cfg.fixedValues) ? cfg.fixedValues : {};
    const layout = getAutoLayout();

    // 1. 単月詳細 (日別) 最大値の走査
    let maxDaily = 0;
    Object.values(state.monthlyDatasets).forEach(ds => {
      if (ds && ds.catResult && Array.isArray(ds.catResult.categoryDailyTotals)) {
        ds.catResult.categoryDailyTotals.forEach(d => {
          const total = d.categories ? (d.categories['総電力'] || 0) : (d.totalKwh || 0);
          if (total > maxDaily) maxDaily = total;
        });
      }
    });
    const autoDailyMax = maxDaily > 0 && typeof ChartManager !== 'undefined' && ChartManager.getNiceMax
      ? ChartManager.getNiceMax(maxDaily) : undefined;

    // 2. 年間データ (設備別および品種別) の最大値走査
    const metricMaxMap = {};
    let maxEquipTotal = 0;

    const allAnnualDataList = Object.values(state.annualDatasets);
    if (state.annualData && !allAnnualDataList.includes(state.annualData)) {
      allAnnualDataList.push(state.annualData);
    }

    allAnnualDataList.forEach(ad => {
      if (!ad) return;
      if (ad.equipmentSummary && ad.equipmentSummary.categories && ad.equipmentSummary.categories['総電力']) {
        const monthly = ad.equipmentSummary.categories['総電力'].monthly || [];
        monthly.forEach(v => {
          if (v > maxEquipTotal) maxEquipTotal = v;
        });
      }

      const modeData = (ad.modes && (ad.modes[state.currentAnnualMode] || ad.modes['combined'])) || ad[state.currentAnnualMode] || ad['combined'];
      if (modeData && typeof AppConfig !== 'undefined' && AppConfig.EVALUATION_METRICS) {
        AppConfig.EVALUATION_METRICS.forEach(m => {
          const mObj = modeData[m.key];
          if (!mObj || !mObj.months) return;

          const isRateMetric = AppConfig.RATE_METRIC_KEYS.includes(m.key);

          if (!metricMaxMap[m.key]) {
            metricMaxMap[m.key] = { maxMonthTotal: 0, maxVarietyVal: 0 };
          }

          Object.values(mObj.months).forEach(monthData => {
            if (!monthData) return;
            let mt = monthData.monthlyTotal || 0;
            if (monthData.varieties) {
              let vSum = 0;
              Object.values(monthData.varieties).forEach(vv => {
                if (vv && vv > 0) {
                  vSum += vv;
                  if (vv > metricMaxMap[m.key].maxVarietyVal) {
                    metricMaxMap[m.key].maxVarietyVal = vv;
                  }
                }
              });
              // 総量指標（積み上げ棒グラフ）のみ、品種合算値を考慮（原単位指標は比率のため合算しない）
              if (!isRateMetric && vSum > mt) mt = vSum;
            }
            if (mt > metricMaxMap[m.key].maxMonthTotal) {
              metricMaxMap[m.key].maxMonthTotal = mt;
            }
          });
        });
      }
    });

    // 品種別トレンドグラフ (総量系) の上限。品種単体の最大値から算出する
    // (集約グラフの上限は8品種の月計が基準のため、そのまま使うと品種単体の線が下に寄ってしまう)
    const getTrendMax = function(metricKey) {
      const dataStats = metricMaxMap[metricKey];
      return dataStats ? ChartManager.getAxisMaxForPeak(dataStats.maxVarietyVal, layout.trendPeakRatio) : undefined;
    };

    // 固定値モード ('fixed'): 集約グラフ・設備別・日別は設定値を使う。トレンドグラフは入力欄が無いため、常にデータから算出する
    if (mode === 'fixed') {
      return {
        mode: 'fixed',
        dailyMax: fixed.daily ? fixed.daily.totalKwh : 30000,
        annualEquipMax: fixed.annualEquipment ? fixed.annualEquipment.totalKwh : 600000,
        getAnnualVarietyScale: function(metricKey) {
          const isRate = AppConfig.RATE_METRIC_KEYS.includes(metricKey);
          const v = (fixed.annualVariety && fixed.annualVariety[metricKey] > 0)
            ? fixed.annualVariety[metricKey]
            : undefined;
          if (isRate) {
            return {
              barMax: v,
              lineMax: v ? Math.round(v * 0.6 * 100) / 100 : undefined
            };
          } else {
            return { max: v, trendMax: getTrendMax(metricKey) };
          }
        }
      };
    }

    // 自動最適化モード ('auto')
    const powerMonthMax = metricMaxMap['powerKwh'] ? metricMaxMap['powerKwh'].maxMonthTotal : 0;
    const synchronizedPowerMax = Math.max(maxEquipTotal, powerMonthMax);
    const autoPowerMax = synchronizedPowerMax > 0 && typeof ChartManager !== 'undefined' && ChartManager.getNiceMax
      ? ChartManager.getNiceMax(synchronizedPowerMax) : undefined;

    return {
      mode: 'auto',
      dailyMax: autoDailyMax,
      annualEquipMax: autoPowerMax,
      getAnnualVarietyScale: function(metricKey) {
        if (metricKey === 'powerKwh') {
          return { max: autoPowerMax, trendMax: getTrendMax(metricKey) };
        }
        const isRate = AppConfig.RATE_METRIC_KEYS.includes(metricKey);
        const dataStats = metricMaxMap[metricKey];
        if (!dataStats || typeof ChartManager === 'undefined' || !ChartManager.getNiceMax) return {};

        if (isRate) {
          // 棒グラフ（左軸・各品種）と月計折れ線グラフ（右軸・全体平均）は別々の軸を持つ。
          // 棒の最大を軸の中ほど、折れ線の最大を軸の上部に置き、棒を大きく見せつつ折れ線と重なりにくくする
          // (高さの目安は SCALE_CONFIG.autoLayout で調整する)
          return {
            barMax: ChartManager.getAxisMaxForPeak(dataStats.maxVarietyVal, layout.rateBarPeakRatio),
            lineMax: ChartManager.getAxisMaxForPeak(dataStats.maxMonthTotal, layout.rateLinePeakRatio)
          };
        } else {
          return {
            max: dataStats.maxMonthTotal > 0 ? ChartManager.getNiceMax(dataStats.maxMonthTotal) : undefined,
            trendMax: getTrendMax(metricKey)
          };
        }
      }
    };
  }

  /**
   * 現在表示中のグラフを再描画
   */
  function refreshCurrentCharts() {
    if (state.currentView === 'annualView') {
      renderAnnualView();
    } else if (state.currentView === 'annualEquipmentView') {
      renderAnnualEquipmentView();
    } else if (state.currentView === 'monthlyView') {
      if (state.lastSelectedMonthlyYm && state.monthlyDatasets[state.lastSelectedMonthlyYm]) {
        renderSingleMonthData(state.monthlyDatasets[state.lastSelectedMonthlyYm]);
      }
    }
  }

  /**
   * 目盛り設定モーダルを開く
   */
  function openScaleModal() {
    if (!scaleSettingModal) return;
    const cfg = state.scaleConfig || AppConfig.SCALE_CONFIG;
    populateScaleModalForm(cfg);
    scaleSettingModal.style.display = 'flex';
  }

  function closeScaleModal() {
    if (scaleSettingModal) scaleSettingModal.style.display = 'none';
  }

  function populateScaleModalForm(cfg) {
    const mode = (cfg && cfg.mode) ? cfg.mode : 'auto';
    const fixed = (cfg && cfg.fixedValues) ? cfg.fixedValues : {};

    if (scaleModeAuto && scaleModeFixed) {
      if (mode === 'fixed') {
        scaleModeFixed.checked = true;
      } else {
        scaleModeAuto.checked = true;
      }
    }

    setInputValue('scaleFixedDailyKwh', fixed.daily?.totalKwh ?? 30000);
    setInputValue('scaleFixedEquipKwh', fixed.annualEquipment?.totalKwh ?? 600000);

    const v = fixed.annualVariety || {};
    setInputValue('scaleFixedPowerKwh', v.powerKwh ?? 600000);
    setInputValue('scaleFixedOpMin', v.operationMin ?? 30000);
    setInputValue('scaleFixedBottles', v.productionBottles ?? 8000000);
    setInputValue('scaleFixedCostYen', v.powerCostYen ?? 15000000);
    setInputValue('scaleFixedKwhPerBottle', v.kwhPerBottle ?? 0.12);
    setInputValue('scaleFixedKwhPerMinute', v.kwhPerMinute ?? 25);
    setInputValue('scaleFixedCostPerBottle', v.costPerBottle ?? 3.0);
    setInputValue('scaleFixedCostPerMinute', v.costPerMinute ?? 600);
  }

  function setInputValue(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }

  function saveScaleModalValues() {
    const mode = document.querySelector('input[name="scaleMode"]:checked')?.value || 'auto';
    const newConfig = {
      mode: mode,
      fixedValues: {
        daily: {
          totalKwh: parseFloat(document.getElementById('scaleFixedDailyKwh')?.value) || 30000
        },
        annualEquipment: {
          totalKwh: parseFloat(document.getElementById('scaleFixedEquipKwh')?.value) || 600000
        },
        annualVariety: {
          powerKwh: parseFloat(document.getElementById('scaleFixedPowerKwh')?.value) || 600000,
          operationMin: parseFloat(document.getElementById('scaleFixedOpMin')?.value) || 30000,
          productionBottles: parseFloat(document.getElementById('scaleFixedBottles')?.value) || 8000000,
          powerCostYen: parseFloat(document.getElementById('scaleFixedCostYen')?.value) || 15000000,
          kwhPerBottle: parseFloat(document.getElementById('scaleFixedKwhPerBottle')?.value) || 0.12,
          kwhPerMinute: parseFloat(document.getElementById('scaleFixedKwhPerMinute')?.value) || 25,
          costPerBottle: parseFloat(document.getElementById('scaleFixedCostPerBottle')?.value) || 3.0,
          costPerMinute: parseFloat(document.getElementById('scaleFixedCostPerMinute')?.value) || 600
        }
      }
    };
    try {
      saveScaleConfig(newConfig);
    } finally {
      closeScaleModal();
    }
    showToast(`目盛りスケール設定を保存しました（${mode === 'auto' ? '自動最適化' : '固定値'}）`, 'success');
  }

  // 初期化関数
  function initApp() {
    state.scaleConfig = loadScaleConfig();
    cacheElements();
    setupEventListeners();

    // 実行環境の判定 (ローカル開発環境 vs GAS本番環境)
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    
    // 開発・検証用ボタンの表示制御 (ローカル開発時のみ表示)
    document.querySelectorAll('.dev-only-btn').forEach(btn => {
      btn.style.display = isLocal ? 'inline-flex' : 'none';
    });

    // URLパラメータの画面切替を反映
    const urlParams = new URLSearchParams(window.location.search);
    const viewParam = urlParams.get('view');
    if (viewParam) {
      switchMainView(viewParam);
    }

    // 燃料エネルギーの画面の初期化 (保存済みの燃料データの復元を含む)
    if (hasFuelView) {
      FuelView.init({
        getLoadedExcelFiles: () => state.loadedExcelFiles || [],
        detectExcelKind,
        getOperationMinutesByYm,
        showToast,
        formatNumber,
        setElemText,
        showLoading,
        hideLoading,
        renderMetricTable: renderAnnualTable,
        getAutoLayout,
        handleDroppedFiles: handleFuelFiles,
        getAllFilesFromDataTransfer,
        isActive: () => state.currentApp === 'fuel'
      });
      if (urlParams.get('app') === 'fuel') {
        switchApp('fuel');
      }
    }

    // スプレッドシートから蓄積集約データの自動復元
    restoreSavedDataFromSpreadsheet(isLocal);
  }

  /**
   * アプリ切り替え (電力 ⇔ 燃料エネルギー)
   * 電力は3つのビュー、燃料エネルギーは1つのビューを持つ。ヘッダーのボタンと同期状況は、表示中のアプリのものに切り替える
   */
  function switchApp(appId) {
    if (appId === 'fuel' && !hasFuelView) return;
    state.currentApp = (appId === 'fuel') ? 'fuel' : 'power';
    const isFuel = state.currentApp === 'fuel';

    document.querySelectorAll('.app-switch-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-app') === state.currentApp);
    });
    setElemText('appSubtitle', APP_SUBTITLES[state.currentApp]);

    const powerNav = document.getElementById('powerNav');
    const fuelSec = document.getElementById('fuelView');
    if (powerNav) powerNav.style.display = isFuel ? 'none' : '';
    if (fuelSec) fuelSec.style.display = isFuel ? 'block' : 'none';

    // 目盛り設定とデモ読込は電力の画面でのみ使う
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (scaleSettingBtn) scaleSettingBtn.style.display = isFuel ? 'none' : '';
    document.querySelectorAll('.dev-only-btn').forEach(btn => {
      btn.style.display = (!isFuel && isLocal) ? 'inline-flex' : 'none';
    });

    if (isFuel) {
      POWER_VIEW_IDS.forEach(id => {
        const sec = document.getElementById(id);
        if (sec) sec.style.display = 'none';
      });
      FuelView.render();
    } else {
      switchMainView(state.currentView);
    }
    updateSyncStatusUI();
  }

  /**
   * スプレッドシート反映ステータス表示の更新
   */
  function updateSyncStatusUI() {
    // 燃料エネルギーの画面を表示中は、燃料のデータの反映状況を表示する
    if (state.currentApp === 'fuel' && hasFuelView) {
      FuelView.updateSyncStatusUI();
      return;
    }

    const badge = document.getElementById('syncStatusBadge');
    const textElem = document.getElementById('syncStatusText');
    if (!badge || !textElem) return;

    const yms = Object.keys(state.monthlyDatasets);
    const totalCount = yms.length;

    if (totalCount === 0) {
      badge.style.display = 'none';
      if (syncBtn) {
        syncBtn.disabled = true;
        syncBtn.textContent = '☁️ スプレッドシートへ反映';
      }
      return;
    }

    badge.style.display = 'inline-flex';
    const syncedCount = yms.filter(ym => state.syncedYms.has(ym)).length;
    const pendingCount = totalCount - syncedCount;

    badge.classList.remove('has-pending', 'all-synced');

    if (pendingCount > 0) {
      badge.classList.add('has-pending');
      textElem.textContent = `読込済: 計 ${totalCount}ヶ月 (未反映: ${pendingCount}ヶ月 / 反映済: ${syncedCount}ヶ月)`;
      if (syncBtn) {
        syncBtn.disabled = false;
        syncBtn.textContent = `☁️ スプレッドシートへ反映 (${pendingCount}ヶ月分)`;
      }
    } else {
      badge.classList.add('all-synced');
      textElem.textContent = `読込済: 計 ${totalCount}ヶ月 (全 ${syncedCount}ヶ月 反映済み)`;
      if (syncBtn) {
        syncBtn.disabled = false;
        syncBtn.textContent = `☁️ スプレッドシートへ反映 (全月反映済)`;
      }
    }
  }

  /**
   * 起動時にスプレッドシート（日別集約シートおよびKPI評価シート）から保存済みデータを復元
   */
  function restoreSavedDataFromSpreadsheet(isLocal) {
    if (typeof google !== 'undefined' && google.script && google.script.run) {
      showLoading('⚡️ スプレッドシートから保存済みデータを読み込み中...');
      google.script.run
        .withSuccessHandler((res) => {
          hideLoading();
          if (res && res.success) {
            // GAS側の最新ConfigをフロントエンドAppConfigに同期
            if (res.config && res.config.VARIETY_MAPPING && typeof AppConfig !== 'undefined') {
              AppConfig.VARIETY_MAPPING = res.config.VARIETY_MAPPING;
            }
            if (res.config && res.config.SCALE_CONFIG && typeof AppConfig !== 'undefined') {
              AppConfig.SCALE_CONFIG = res.config.SCALE_CONFIG;
              // LocalStorageに保存がない場合のみ初期マスターを適用
              if (!localStorage.getItem(SCALE_STORAGE_KEY)) {
                state.scaleConfig = JSON.parse(JSON.stringify(res.config.SCALE_CONFIG));
              }
            }

            if (res.savedYms && res.savedYms.length > 0) {
              // 既存の monthlyDatasets とマージ
              Object.keys(res.monthlySummary).forEach(ym => {
              if (!state.monthlyDatasets[ym]) {
                state.monthlyDatasets[ym] = res.monthlySummary[ym];
              } else {
                // 既存の外部データやKPI・品種データを補完
                const existing = state.monthlyDatasets[ym];
                const fromSheet = res.monthlySummary[ym];
                if (!existing.kpiResult && fromSheet.kpiResult) existing.kpiResult = fromSheet.kpiResult;
                if (!existing.catResult && fromSheet.catResult) existing.catResult = fromSheet.catResult;
                if (!existing.varietyAgg && fromSheet.varietyAgg) existing.varietyAgg = fromSheet.varietyAgg;
                if (!existing.externalData && fromSheet.externalData) {
                  existing.externalData = fromSheet.externalData;
                } else if (existing.externalData && fromSheet.externalData) {
                  if (!existing.externalData.production || existing.externalData.production.totalBottles === 0) {
                    existing.externalData.production = fromSheet.externalData.production;
                  }
                  if (!existing.externalData.electricity) {
                    existing.externalData.electricity = fromSheet.externalData.electricity;
                  }
                }
              }
            });

            // 反映済み年月として記録
            res.savedYms.forEach(ym => state.syncedYms.add(ym));
            updateSyncStatusUI();

            // 年間集約データの構築と年度セレクターの更新
            rebuildAnnualDataFromMonthlyDatasets();

            // 単月セレクターと画面の初期表示
            const latestYm = res.savedYms[res.savedYms.length - 1];
            state.lastSelectedMonthlyYm = latestYm;
            updateMonthlySelectOptions(latestYm);
            if (state.monthlyDatasets[latestYm]) {
              renderSingleMonthData(state.monthlyDatasets[latestYm]);
            }

            showToast(`スプレッドシートから保存済みデータ（${res.savedYms.length}ヶ月分）を読み込みました`, 'info');
          }
        }
      })
        .withFailureHandler((err) => {
          hideLoading();
          console.warn('Failed to auto-restore from spreadsheet:', err);
        })
        .loadSavedSummaryFromSpreadsheet();
    } else if (isLocal) {
      // ローカル環境: デモデータの自動読込
      loadAnnualData('2025');
    }
  }

  // DOMロード状態に応じた確実な初期化実行
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }

  function cacheElements() {
    dropzone = document.getElementById('dropzone');
    fileInput = document.getElementById('fileInput');
    progressBarContainer = document.getElementById('progressBarContainer');
    progressBarFill = document.getElementById('progressBarFill');
    annualDemoBtn = document.getElementById('annualDemoBtn');
    demoBtn = document.getElementById('demoBtn');
    syncBtn = document.getElementById('syncBtn');
    exportBtn = document.getElementById('exportBtn');
    toastContainer = document.getElementById('toastContainer');
    metricSelector = document.getElementById('metricSelector');
    fiscalYearSelector = document.getElementById('fiscalYearSelector');
    monthlyYearMonthSelect = document.getElementById('monthlyYearMonthSelect');
    monthlyDataStatus = document.getElementById('monthlyDataStatus');
    scaleSettingBtn = document.getElementById('scaleSettingBtn');
    scaleSettingModal = document.getElementById('scaleSettingModal');
    closeScaleModalBtn = document.getElementById('closeScaleModalBtn');
    saveScaleModalBtn = document.getElementById('saveScaleModalBtn');
    resetScaleModalBtn = document.getElementById('resetScaleModalBtn');
    scaleModeAuto = document.getElementById('scaleModeAuto');
    scaleModeFixed = document.getElementById('scaleModeFixed');
  }

  function setupEventListeners() {
    // 0. アプリ切り替え (電力 ⇔ 燃料エネルギー)
    document.querySelectorAll('.app-switch-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        switchApp(e.currentTarget.getAttribute('data-app'));
      });
    });

    // 1. メインナビゲーション (年間 ⇔ 単月)
    document.querySelectorAll('.main-nav-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetView = e.currentTarget.getAttribute('data-view');
        switchMainView(targetView);
      });
    });

    // 2. 年間操業モード切り替えピルボタン
    const pillContainer = document.getElementById('operationModePills');
    if (pillContainer) {
      pillContainer.querySelectorAll('.pill-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          pillContainer.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
          e.currentTarget.classList.add('active');
          state.currentAnnualMode = e.currentTarget.getAttribute('data-mode');
          renderAnnualView();
        });
      });
    }

    // 3. 表示指標セレクター
    if (metricSelector) {
      metricSelector.addEventListener('change', (e) => {
        state.currentMetric = e.target.value;
        renderAnnualView();
      });
    }

    // 4. 対象年度セレクター
    if (fiscalYearSelector) {
      fiscalYearSelector.addEventListener('change', (e) => {
        const yr = e.target.value;
        if (!yr) return;
        const equipYr = document.getElementById('annualEquipmentYearSelect');
        if (equipYr) equipYr.value = yr;
        loadAnnualData(yr, true);
      });
    }

    const equipYearSelect = document.getElementById('annualEquipmentYearSelect');
    if (equipYearSelect) {
      equipYearSelect.addEventListener('change', (e) => {
        const yr = e.target.value;
        if (!yr) return;
        if (fiscalYearSelector) fiscalYearSelector.value = yr;
        loadAnnualData(yr, true);
      });
    }

    // 4-1. 設備別分析 表示モードピルボタン (ユーティリティ統合 ⇔ 設備詳細内訳)
    const equipViewPills = document.getElementById('equipViewModePills');
    if (equipViewPills) {
      equipViewPills.querySelectorAll('.pill-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          equipViewPills.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
          e.currentTarget.classList.add('active');
          state.annualEquipmentViewMode = e.currentTarget.getAttribute('data-mode');
          renderAnnualEquipmentView();
        });
      });
    }

    // 4-2. 単月表示年月セレクター
    if (monthlyYearMonthSelect) {
      monthlyYearMonthSelect.addEventListener('change', (e) => {
        const ym = e.target.value;
        if (ym && state.monthlyDatasets[ym]) {
          state.lastSelectedMonthlyYm = ym;
          renderSingleMonthData(state.monthlyDatasets[ym]);
        }
      });
    }

    // 5. ボタンアクション
    if (scaleSettingBtn) {
      scaleSettingBtn.addEventListener('click', openScaleModal);
    }
    if (closeScaleModalBtn) {
      closeScaleModalBtn.addEventListener('click', closeScaleModal);
    }
    if (saveScaleModalBtn) {
      saveScaleModalBtn.addEventListener('click', saveScaleModalValues);
    }
    if (resetScaleModalBtn) {
      resetScaleModalBtn.addEventListener('click', resetScaleConfig);
    }
    if (scaleSettingModal) {
      scaleSettingModal.addEventListener('click', (e) => {
        if (e.target === scaleSettingModal) closeScaleModal();
      });
    }

    if (annualDemoBtn) {
      annualDemoBtn.addEventListener('click', () => {
        const year = (fiscalYearSelector && fiscalYearSelector.value) ? fiscalYearSelector.value : '2025';
        loadAnnualData(year, true);
      });
    }

    if (demoBtn) {
      demoBtn.addEventListener('click', () => {
        switchMainView('monthlyView');
        loadSingleMonthDemo();
      });
    }

    if (syncBtn) {
      syncBtn.addEventListener('click', () => {
        if (state.currentApp === 'fuel' && hasFuelView) {
          FuelView.handleSync();
        } else {
          handleSyncToSpreadsheet();
        }
      });
    }

    if (exportBtn) {
      exportBtn.addEventListener('click', handleExportExcel);
    }

    // 6. 単月ファイルドラッグ＆ドロップ
    if (dropzone && fileInput) {
      ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropzone.classList.add('dragover');
        });
      });

      ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropzone.classList.remove('dragover');
        });
      });

      dropzone.addEventListener('drop', async (e) => {
        const files = await getAllFilesFromDataTransfer(e.dataTransfer);
        handleFiles(files);
      });

      dropzone.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('click', (e) => e.stopPropagation());
      fileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        e.target.value = ''; // 次回同じファイル名や追加選択時にも確実にchangeイベントを発火させる
        handleFiles(files);
      });
    }
  }

  /**
   * DataTransferからファイル・フォルダ内の全ファイルを再帰的に取得する
   */
  async function getAllFilesFromDataTransfer(dataTransfer) {
    const files = [];
    const items = dataTransfer.items;
    if (items && items.length > 0 && items[0].webkitGetAsEntry) {
      const queue = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
        if (entry) {
          queue.push(traverseFileTree(entry));
        } else if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      const results = await Promise.all(queue);
      for (const res of results) {
        files.push(...res);
      }
    } else {
      for (let i = 0; i < dataTransfer.files.length; i++) {
        files.push(dataTransfer.files[i]);
      }
    }
    return files;
  }

  function traverseFileTree(item) {
    return new Promise((resolve) => {
      if (item.isFile) {
        item.file((file) => resolve([file]), () => resolve([]));
      } else if (item.isDirectory) {
        const dirReader = item.createReader();
        const entries = [];
        const readEntries = () => {
          dirReader.readEntries(async (result) => {
            if (!result.length) {
              const subPromises = entries.map(e => traverseFileTree(e));
              const subArrays = await Promise.all(subPromises);
              resolve(subArrays.flat());
            } else {
              entries.push(...result);
              readEntries();
            }
          }, () => resolve([]));
        };
        readEntries();
      } else {
        resolve([]);
      }
    });
  }

  /**
   * メインビュー切り替え (年間推移 ⇔ 年間設備別分析 ⇔ 単月詳細)
   */
  function switchMainView(viewId) {
    state.currentView = viewId;
    document.querySelectorAll('.main-nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-view') === viewId);
    });
    // 燃料エネルギーの画面を表示中は、選択だけを覚えておく (電力に戻したときに表示する)
    if (state.currentApp === 'fuel') return;

    const annualSec = document.getElementById('annualView');
    const monthlySec = document.getElementById('monthlyView');
    const equipSec = document.getElementById('annualEquipmentView');

    if (annualSec) annualSec.style.display = (viewId === 'annualView') ? 'block' : 'none';
    if (monthlySec) monthlySec.style.display = (viewId === 'monthlyView') ? 'block' : 'none';
    if (equipSec) equipSec.style.display = (viewId === 'annualEquipmentView') ? 'block' : 'none';

    if (viewId === 'annualView') {
      if (state.annualData) renderAnnualView();
    } else if (viewId === 'annualEquipmentView') {
      if (state.annualData) renderAnnualEquipmentView();
    } else if (viewId === 'monthlyView') {
      renderCurrentMonthlyView();
    }
  }

  // =========================================================================
  // 年間データ読込＆描画ロジック
  // =========================================================================

  function updateFiscalYearOptions(availableYears, selectedYear) {
    const selectors = [
      document.getElementById('fiscalYearSelector'),
      document.getElementById('annualEquipmentYearSelect')
    ];
    selectors.forEach(sel => {
      if (!sel) return;
      sel.innerHTML = '';
      if (!availableYears || !availableYears.length) {
        sel.innerHTML = '<option value="">（データ未読込）</option>';
        return;
      }
      availableYears.forEach(yr => {
        const opt = document.createElement('option');
        opt.value = yr;
        const startYr = parseInt(yr, 10);
        opt.textContent = `${yr}年度 (${startYr}/04〜${startYr + 1}/03)`;
        if (String(yr) === String(selectedYear)) {
          opt.selected = true;
        }
        sel.appendChild(opt);
      });
    });
  }

  async function loadAnnualData(year = '2024', showNotice = false) {
    try {
      showProgress(30);

      // 1. 読み込み済みCSV/Excelから構築された年間集約データが存在する場合
      if (state.annualDatasets && state.annualDatasets[year]) {
        state.annualData = state.annualDatasets[year];
        const allYears = Object.keys(state.annualDatasets).sort().reverse();
        updateFiscalYearOptions(allYears.length > 0 ? allYears : [year], year);
        showProgress(80);

        renderAnnualView();
        renderAnnualEquipmentView();
        showProgress(100);
        setTimeout(hideProgress, 400);

        if (showNotice) {
          const avail = state.annualData.availableMonthsCount || 12;
          showToast(`${year}年度の年間集約データ（${avail}ヶ月分）を表示しました`, 'success');
        }
        return;
      }

      // 2. 存在しない場合 (ローカル開発環境でのデモJSON読込フォールバック: demo/ フォルダ優先)
      let res = await fetch(`demo/demo_annual_${year}.json?t=${Date.now()}`);
      if (!res.ok) {
        res = await fetch(`demo_annual_${year}.json?t=${Date.now()}`);
      }
      if (!res.ok) throw new Error(`${year}年度のデータ取得に失敗しました (status: ${res.status})`);
      const data = await res.json();
      state.annualData = data;
      state.annualDatasets = state.annualDatasets || {};
      state.annualDatasets[year] = data;
      const allYears = Array.from(new Set([...Object.keys(state.annualDatasets), '2025', '2024'])).sort().reverse();
      updateFiscalYearOptions(allYears, year);
      showProgress(80);

      renderAnnualView();
      renderAnnualEquipmentView();
      showProgress(100);
      setTimeout(hideProgress, 500);

      if (showNotice) {
        showToast(`${year}年度の年間集約データ（全12ヶ月・8品種）を読み込みました`, 'success');
      }
    } catch (err) {
      console.error('Annual load error:', err);
      hideProgress();
      showToast(`年間データ読込エラー: ${err.message}`, 'error');
    }
  }

  function renderAnnualView() {
    if (!state.annualData) return;

    const mode = state.currentAnnualMode; // 'combined', 'waterOnly', 'fillingOnly'
    const metricKey = state.currentMetric;
    const modeData = state.annualData.modes[mode];
    if (!modeData) return;

    const metricData = modeData[metricKey];
    if (!metricData) return;

    // 1. 指標情報の特定
    const metricConfig = AppConfig.EVALUATION_METRICS.find(m => m.key === metricKey) || {
      name: '電力量', unit: 'kWh', digits: 1
    };

    // 2. 年間KPIサマリーカード更新
    const powerMetric = modeData['powerKwh'];
    const timeMetric = modeData['operationMin'];
    const bottleMetric = modeData['productionBottles'];

    const totalKwh = powerMetric && powerMetric.annualTotal ? powerMetric.annualTotal.monthlyTotal : 0;
    const totalMin = timeMetric && timeMetric.annualTotal ? timeMetric.annualTotal.monthlyTotal : 0;
    const totalHours = (totalMin / 60).toFixed(1);
    const totalBottles = bottleMetric && bottleMetric.annualTotal ? bottleMetric.annualTotal.monthlyTotal : 0;
    const avgKpi = totalBottles > 0 ? (totalKwh / totalBottles).toFixed(4) : '---';

    setElemText('annualTotalKwh', totalKwh.toLocaleString());
    setElemText('annualTotalHours', parseFloat(totalHours).toLocaleString());
    setElemText('annualTotalBottles', totalBottles.toLocaleString());
    setElemText('annualAvgKpi', avgKpi);

    // タイトル更新
    setElemText('currentMetricLabel', `${metricConfig.name} (${metricConfig.unit})`);
    setElemText('tableMetricTitle', `${metricConfig.name} [${metricConfig.unit}]`);
    const isRateMetric = AppConfig.RATE_METRIC_KEYS.includes(metricKey);
    setElemText('annualStackedChartTitle', isRateMetric 
      ? '📊 月別電力使用量集約グラフ (8品種別 ＆ 全体平均折れ線)' 
      : '📊 月別電力使用量集約グラフ (8品種積み上げ)');

    // 3. グラフ描画
    const scaleOpts = getScaleOptions();
    const metricScale = scaleOpts.getAnnualVarietyScale(metricKey);

    ChartManager.renderAnnualStackedBarChart(
      'annualStackedChart',
      metricData,
      metricConfig,
      state.annualData.monthLabels,
      state.annualData.months,
      metricScale
    );

    ChartManager.renderAnnualTrendChart(
      'annualTrendChart',
      metricData,
      metricConfig,
      state.annualData.monthLabels,
      state.annualData.months,
      metricScale
    );

    // 4. 年間テーブル描画
    renderAnnualTable(metricData, metricConfig);
  }

  /**
   * 年間月別実績集計表の動的生成 (Excel原紙完全再現)
   */
  function renderAnnualTable(metricData, metricConfig, target) {
    const opts = target || {};
    const tbody = document.getElementById(opts.tbodyId || 'annualTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';
    const months = opts.months || state.annualData.months;
    const labels = opts.monthLabels || state.annualData.monthLabels;
    const digits = metricConfig.digits;
    // nullAsDash: 値が無い (null) 品種・年間計を 0 ではなく「---」と表示する (燃料エネルギーの表で使用)
    const nullAsDash = !!opts.nullAsDash;
    const dashHtml = '<span style="color:var(--text-light);font-weight:normal;">---</span>';
    const pickVariety = (obj, vk) => {
      const raw = obj.varieties ? obj.varieties[vk] : undefined;
      if (nullAsDash && (!obj.varieties || raw === null || raw === undefined)) return null;
      return raw || 0;
    };

    // 各月行 (4月〜3月)
    months.forEach((ym, idx) => {
      const mObj = metricData.months[ym] || { cumulativeTotal: 0, monthlyTotal: 0, varieties: {} };
      const tr = document.createElement('tr');

      const hasData = mObj.hasData !== false && mObj.monthlyTotal !== null;
      const formatVal = (v) => {
        if (v === null || v === undefined) return '<span style="color:var(--text-light);font-weight:normal;">---</span>';
        return typeof v === 'number' ? formatNumber(v, digits) : v;
      };

      // 累計値 (データが存在しない月は空欄)
      const cumVal = hasData ? mObj.cumulativeTotal : null;

      let html = `
        <td style="font-weight: 600;">${labels[idx]} (${ym})</td>
        <td style="color: var(--text-muted); font-weight: 500;">${formatVal(cumVal)}</td>
        <td style="font-weight: 700; color: var(--primary);">${formatVal(mObj.monthlyTotal)}</td>
      `;

      VARIETY_KEYS.forEach(vk => {
        const val = pickVariety(mObj, vk);
        const style = val > 0 ? 'font-weight: 500;' : 'color: var(--text-light);';
        html += `<td style="${style}">${formatVal(val)}</td>`;
      });

      tr.innerHTML = html;
      tbody.appendChild(tr);
    });

    // 年間合計行 (計)
    const totObj = metricData.annualTotal || { monthlyTotal: 0, varieties: {} };
    const trTotal = document.createElement('tr');
    trTotal.className = 'total-row';

    const formatVal = (v) => {
      if (v === null || v === undefined) return nullAsDash ? dashHtml : '0';
      return typeof v === 'number' ? formatNumber(v, digits) : v;
    };

    let totHtml = `
      <td>年間計</td>
      <td>---</td>
      <td>${formatVal(totObj.monthlyTotal)}</td>
    `;

    VARIETY_KEYS.forEach(vk => {
      const val = pickVariety(totObj, vk);
      totHtml += `<td>${formatVal(val)}</td>`;
    });

    trTotal.innerHTML = totHtml;
    tbody.appendChild(trTotal);
  }

  // =========================================================================
  // 年間推移・設備別分析 描画ロジック
  // =========================================================================

  function renderAnnualEquipmentView() {
    if (!state.annualData || !state.annualData.equipmentSummary) return;

    const eq = state.annualData.equipmentSummary;
    const cats = eq.categories || {};
    const ops = eq.operationTimes || {};

    const totalPower = cats['総電力'] ? cats['総電力'].annualTotal : 0;
    const utilPower = cats['ユーティリティ'] ? cats['ユーティリティ'].annualTotal : 0;
    const fillingHours = ops.actualFillingHours ? ops.actualFillingHours.annualTotal : 0;
    const waterHours = ops.waterHours ? ops.waterHours.annualTotal : 0;

    // 1. KPIサマリーカード
    setElemText('kpiEquipTotalKwh', formatNumber(totalPower, 1));
    setElemText('kpiEquipUtilityKwh', formatNumber(utilPower, 1));
    const utilRatio = totalPower > 0 ? ((utilPower / totalPower) * 100).toFixed(1) : '0.0';
    setElemText('kpiEquipUtilityRatio', `${utilRatio}%`);

    // 個別設備の中で最大消費設備を特定 (ユーティリティ・総電力を除く)
    const excludeKeys = ['総電力', 'ユーティリティ'];
    let topName = '---';
    let topVal = 0;
    Object.keys(cats).forEach(k => {
      if (!excludeKeys.includes(k)) {
        const val = cats[k].annualTotal || 0;
        if (val > topVal) {
          topVal = val;
          topName = k;
        }
      }
    });
    setElemText('kpiEquipTopName', topName);
    const topRatio = totalPower > 0 ? ((topVal / totalPower) * 100).toFixed(1) : '0.0';
    setElemText('kpiEquipTopKwh', formatNumber(topVal, 1));
    setElemText('kpiEquipTopRatio', `${topRatio}%`);

    setElemText('kpiEquipFillingHours', formatNumber(fillingHours, 1));
    setElemText('kpiEquipWaterHours', formatNumber(waterHours, 1));

    // 2. チャート描画
    if (window.ChartManager) {
      if (typeof ChartManager.renderAnnualEquipmentTrendChart === 'function') {
        const scaleOpts = getScaleOptions();
        ChartManager.renderAnnualEquipmentTrendChart(
          'annualEquipmentTrendChart',
          eq,
          state.annualEquipmentViewMode,
          { max: scaleOpts.annualEquipMax }
        );
      }
      if (typeof ChartManager.renderAnnualEquipmentDoughnutChart === 'function') {
        ChartManager.renderAnnualEquipmentDoughnutChart('annualEquipmentDoughnutChart', eq);
      }
    }

    // 3. テーブル描画
    const tbody = document.getElementById('annualEquipmentTableBody');
    if (!tbody) return;

    const rowsConfig = [
      { key: '総電力', label: '総消費電力', type: 'category', className: 'row-header-total' },
      { key: 'ユーティリティ', label: 'ユーティリティ計', type: 'category', className: 'row-header-utility' },
      { key: 'コンプレッサー', label: '├ コンプレッサー', type: 'category', className: 'row-sub-item' },
      { key: 'ボイラー', label: '├ ボイラー', type: 'category', className: 'row-sub-item' },
      { key: '純水装置', label: '├ 純水装置', type: 'category', className: 'row-sub-item' },
      { key: '排水処理', label: '├ 排水処理', type: 'category', className: 'row-sub-item' },
      { key: 'チラー', label: '└ チラー', type: 'category', className: 'row-sub-item' },
      { key: '調合抽出', label: '調合抽出', type: 'category' },
      { key: '供給', label: '供給', type: 'category' },
      { key: '充填', label: '充填', type: 'category' },
      { key: '包装', label: '包装', type: 'category' },
      { key: 'actualFillingHours', label: '実充填操業時間 (h)', type: 'time' },
      { key: 'waterHours', label: '水運転時間 (h)', type: 'time' }
    ];

    let html = '';
    rowsConfig.forEach(row => {
      let annualVal = 0;
      let monthlyVals = [];
      let ratioStr = '---';

      if (row.type === 'category') {
        const catData = cats[row.key];
        if (catData) {
          annualVal = catData.annualTotal || 0;
          monthlyVals = catData.monthly || [];
          const ratio = totalPower > 0 ? (annualVal / totalPower) * 100 : 0;
          ratioStr = `<span class="ratio-badge">${ratio.toFixed(1)}%</span>`;
        }
      } else if (row.type === 'time') {
        const timeData = ops[row.key];
        if (timeData) {
          annualVal = timeData.annualTotal || 0;
          monthlyVals = timeData.monthly || [];
          const totalOpHours = ops.totalHours ? ops.totalHours.annualTotal : 0;
          const ratio = totalOpHours > 0 ? (annualVal / totalOpHours) * 100 : 0;
          ratioStr = `<span class="ratio-badge" style="background:#f1f5f9;color:#475569;">${ratio.toFixed(1)}%</span>`;
        }
      }

      const trClass = row.className || '';
      const valFormatted = formatNumber(annualVal, 1);

      html += `<tr class="${trClass}">
        <td class="font-medium text-left">${row.label}</td>
        <td class="text-right font-tabular font-bold">${valFormatted}</td>
        <td class="text-center font-tabular">${ratioStr}</td>`;

      for (let i = 0; i < 12; i++) {
        const mVal = monthlyVals[i] !== undefined && monthlyVals[i] !== null ? monthlyVals[i] : null;
        const mFormatted = mVal !== null
          ? formatNumber(mVal, 1)
          : '<span style="color:var(--text-light);font-weight:normal;">---</span>';
        html += `<td class="text-right font-tabular">${mFormatted}</td>`;
      }
      html += `</tr>`;
    });
    tbody.innerHTML = html;
  }

  // =========================================================================
  // 単月詳細データ処理＆ETL連携ロジック (複数月管理・切替対応)
  // =========================================================================

  /**
   * 年月選択セレクトボックスの選択肢更新
   * @param {string} targetYmToSelect 
   */
  function updateMonthlySelectOptions(targetYmToSelect) {
    if (!monthlyYearMonthSelect) return;
    const yms = Object.keys(state.monthlyDatasets).sort();
    if (yms.length === 0) {
      monthlyYearMonthSelect.innerHTML = '<option value="">（データ未読込）</option>';
      if (monthlyDataStatus) monthlyDataStatus.textContent = '';
      return;
    }

    monthlyYearMonthSelect.innerHTML = '';
    yms.forEach(ym => {
      const opt = document.createElement('option');
      opt.value = ym;
      const y = ym.slice(0, 4);
      const m = parseInt(ym.slice(4, 6), 10);
      opt.textContent = `${y}年${m}月度 (${ym})`;
      if (ym === targetYmToSelect) {
        opt.selected = true;
      }
      monthlyYearMonthSelect.appendChild(opt);
    });

    monthlyYearMonthSelect.value = targetYmToSelect;
    if (monthlyDataStatus) {
      monthlyDataStatus.textContent = `読込済: 全${yms.length}ヶ月 (表示中: ${targetYmToSelect})`;
    }
  }

  /**
   * 指定した年月の単月集計結果をUIおよびグラフ・表に反映
   * @param {Object} monthDataset 
   */
  function renderSingleMonthData(monthDataset) {
    if (!monthDataset) return;
    state.currentAggregation = monthDataset.aggResult || null;

    const catResult = monthDataset.catResult || {};
    const dailyTotals = catResult.categoryDailyTotals || [];
    const monthlyTotals = catResult.categoryMonthlyTotals || {};

    updateSingleMonthKpiCards(catResult, monthDataset.kpiResult, monthDataset.aggResult, monthDataset.externalData);

    if (dailyTotals.length > 0) {
      const scaleOpts = getScaleOptions();
      ChartManager.renderDailyChart('dailyChart', dailyTotals, { max: scaleOpts.dailyMax });
      renderDailyTable(dailyTotals);
    }
    if (monthlyTotals && Object.keys(monthlyTotals).length > 0) {
      ChartManager.renderCategoryDoughnutChart('categoryChart', monthlyTotals);
    }

    if (syncBtn) syncBtn.disabled = false;
    if (exportBtn) exportBtn.disabled = false;
  }

  /**
   * 単月ビュー表示時の年月判定＆描画
   * ルール: 直前に表示を切り替えていた場合は直前年月、なければ読込済の中の最新月を表示
   */
  function renderCurrentMonthlyView() {
    const yms = Object.keys(state.monthlyDatasets).sort();
    if (yms.length === 0) return;

    let targetYm = state.lastSelectedMonthlyYm;
    if (!targetYm || !state.monthlyDatasets[targetYm]) {
      targetYm = yms[yms.length - 1]; // 最新月
    }
    state.lastSelectedMonthlyYm = targetYm;
    updateMonthlySelectOptions(targetYm);
    renderSingleMonthData(state.monthlyDatasets[targetYm]);
  }

  async function loadSingleMonthDemo() {
    try {
      showProgress(30);
      showToast('単月詳細デモデータを読み込み中...', 'info');

      let response = await fetch(`demo/demo_data_202503.json?t=${Date.now()}`);
      if (!response.ok) {
        response = await fetch(`demo_data_202503.json?t=${Date.now()}`);
      }
      if (!response.ok) throw new Error(`単月データの取得に失敗しました (${response.status})`);
      const aggResult202503 = await response.json();
      showProgress(60);

      // 全タグバッジを点灯
      ['tag02', 'tag04', 'tag05', 'tag06', 'tag07', 'tagEnergy', 'tagPet'].forEach(tag => {
        updateTagBadge(tag, true);
      });

      // 1. 2025年3月度 (202503) の集計データセット
      const ext202503 = {
        production: { totalBottles: 3125000 },
        electricity: { usedKwhThousand: 288.075, costThousandYen: 6176.992, unitPriceYenPerKwh: 21.4423 }
      };
      const catResult202503 = CategoryService.aggregateCategories(aggResult202503.rows, aggResult202503.monthlyColumnSums);
      const kpiResult202503 = KpiService.calculateKpi(
        catResult202503.categoryMonthlyTotals,
        catResult202503.monthlyOperationTimes,
        ext202503.production,
        ext202503.electricity
      );
      state.monthlyDatasets['202503'] = {
        ym: '202503',
        aggResult: aggResult202503,
        catResult: catResult202503,
        kpiResult: kpiResult202503,
        externalData: ext202503
      };

      // 2. 切替検証用として 2025年4月度 (202504) のデータセットも生成・保持
      const rows202504 = aggResult202503.rows.filter(r => {
        const day = parseInt(r.date.split('/')[2] || '1', 10);
        return day <= 30; // 4月は30日まで
      }).map(r => {
        const parts = r.date.split('/');
        return { ...r, date: `2025/04/${parts[2]}` };
      });
      const colSums202504 = {};
      Object.keys(aggResult202503.monthlyColumnSums).forEach(k => {
        colSums202504[k] = Math.round(aggResult202503.monthlyColumnSums[k] * 0.96 * 10) / 10;
      });
      const aggResult202504 = {
        yearMonth: '202504',
        rows: rows202504,
        monthlyColumnSums: colSums202504
      };
      const ext202504 = {
        production: { totalBottles: 3280000 },
        electricity: { usedKwhThousand: 279.366, costThousandYen: 6225.057, unitPriceYenPerKwh: 22.2828 }
      };
      const catResult202504 = CategoryService.aggregateCategories(aggResult202504.rows, aggResult202504.monthlyColumnSums);
      const kpiResult202504 = KpiService.calculateKpi(
        catResult202504.categoryMonthlyTotals,
        catResult202504.monthlyOperationTimes,
        ext202504.production,
        ext202504.electricity
      );
      state.monthlyDatasets['202504'] = {
        ym: '202504',
        aggResult: aggResult202504,
        catResult: catResult202504,
        kpiResult: kpiResult202504,
        externalData: ext202504
      };

      showProgress(90);

      // 要望仕様: 読込後は最新月（202504）を自動選択して表示
      const yms = Object.keys(state.monthlyDatasets).sort();
      const latestYm = yms[yms.length - 1];
      state.lastSelectedMonthlyYm = latestYm;

      updateMonthlySelectOptions(latestYm);
      renderSingleMonthData(state.monthlyDatasets[latestYm]);

      showProgress(100);
      showToast(`単月データ集約完了！複数月(202503, 202504)から最新月(${latestYm})を表示中`, 'success');
      setTimeout(hideProgress, 800);

    } catch (err) {
      console.error('Demo error:', err);
      hideProgress();
      showToast(`単月データ読込エラー: ${err.message}`, 'error');
    }
  }

  function updateSingleMonthKpiCards(catResult, kpiResult, aggResult, extData) {
    const totalKwh = catResult.categoryMonthlyTotals['総電力'] ? catResult.categoryMonthlyTotals['総電力'].grandTotal : 0;
    const waterMin = catResult.monthlyOperationTimes.waterTimeMin || 0;
    const fillMin = catResult.monthlyOperationTimes.actualFillingMin || 0;
    const electricity = extData ? extData.electricity : state.externalData.electricity;

    setElemText('kpiTotalKwh', Math.round(totalKwh).toLocaleString());
    setElemText('kpiWaterHours', (waterMin / 60).toFixed(1));
    setElemText('kpiFillingHours', (fillMin / 60).toFixed(1));
    const unitPrice = (electricity && electricity.unitPriceYenPerKwh) ||
                      (kpiResult && kpiResult.electricitySummary && kpiResult.electricitySummary.unitPriceYenPerKwh) ||
                      null;
    setElemText('kpiUnitPrice', unitPrice ? unitPrice.toFixed(2) : '---');
    let hoursCount = '---';
    if (aggResult && aggResult.rows && aggResult.rows.length > 0) {
      hoursCount = aggResult.rows.length.toLocaleString();
    } else if (catResult && catResult.categoryDailyTotals && catResult.categoryDailyTotals.length > 0) {
      hoursCount = (catResult.categoryDailyTotals.length * 24).toLocaleString();
    }
    setElemText('kpiHoursCount', hoursCount);
  }

  function renderDailyTable(dailyTotals) {
    const tbody = document.getElementById('dailyTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!dailyTotals || !Array.isArray(dailyTotals) || dailyTotals.length === 0) return;

    dailyTotals.forEach(d => {
      const tr = document.createElement('tr');
      const cats = d.categories || {};
      const op = d.operationTimes || {};
      tr.innerHTML = `
        <td style="font-weight: 600;">${d.date}</td>
        <td style="font-weight: 700; color: var(--primary);">${Math.round(cats['総電力'] || 0).toLocaleString()}</td>
        <td style="font-weight: 700; color: #0284c7; background: rgba(2, 132, 199, 0.05);">${Math.round(cats['ユーティリティ'] || 0).toLocaleString()}</td>
        <td>${Math.round(cats['コンプレッサー'] || 0).toLocaleString()}</td>
        <td>${Math.round(cats['ボイラー'] || 0).toLocaleString()}</td>
        <td>${Math.round(cats['純水装置'] || 0).toLocaleString()}</td>
        <td>${Math.round(cats['排水処理'] || 0).toLocaleString()}</td>
        <td>${Math.round(cats['チラー'] || 0).toLocaleString()}</td>
        <td>${Math.round(cats['調合抽出'] || 0).toLocaleString()}</td>
        <td>${Math.round(cats['供給'] || 0).toLocaleString()}</td>
        <td>${Math.round(cats['充填'] || 0).toLocaleString()}</td>
        <td>${Math.round(cats['包装'] || 0).toLocaleString()}</td>
        <td>${op.actualFillingMin || 0}</td>
        <td>${op.waterTimeMin || 0}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  async function handleFiles(files) {
    if (!files || files.length === 0) return;
    switchMainView('monthlyView');
    showProgress(5);

    const validFiles = Array.from(files).filter(f => !f.name.startsWith('.') && !f.name.startsWith('._'));
    const txtCsvFiles = [];
    const excelFiles = [];
    for (const f of validFiles) {
      const lowerName = f.name.normalize('NFC').toLowerCase();
      if (lowerName.endsWith('.txt') || lowerName.endsWith('.csv')) txtCsvFiles.push(f);
      else if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) excelFiles.push(f);
    }

    if (txtCsvFiles.length === 0 && excelFiles.length === 0) {
      showToast('TXT/CSVまたはExcelファイルが見つかりませんでした', 'error');
      hideProgress();
      return;
    }

    // 新規CSV投入時は、過去セッションの loadedFiles をリフレッシュ
    if (txtCsvFiles.length > 0) {
      state.loadedFiles = [];
      document.querySelectorAll('.tag-badge:not(.excel)').forEach(el => el.classList.remove('detected'));
    }

    // Excelファイルの読み込み
    await loadExcelFiles(excelFiles);

    // CSV/TXTファイルの読み込み（UI描画更新を挟むノンブロッキング処理）
    if (txtCsvFiles.length > 0) {
      showToast(`${txtCsvFiles.length} 件のファイルを読み込み開始...`, 'info');
      for (let i = 0; i < txtCsvFiles.length; i++) {
        const f = txtCsvFiles[i];
        const text = await readFileAsText(f);
        if (text) {
          state.loadedFiles.push({ fileName: f.name, content: text });
          const tagType = CsvParser.detectTagType(f.name, text.slice(0, 3000).split(/\r?\n/));
          if (tagType) {
            updateTagBadge(tagType, true);
          }
        }
        if (i % 25 === 0 || i === txtCsvFiles.length - 1) {
          showProgress(10 + Math.floor((i / txtCsvFiles.length) * 50));
          // UIレンダリングをブロックしないよう定期的に小休止
          await new Promise(r => setTimeout(r, 0));
        }
      }
    }

    // CSVが投入されず、Excelファイルのみが単独投入された場合の処理
    if (txtCsvFiles.length === 0 && excelFiles.length > 0) {
      hideProgress();
      if (!applyExcelToLoadedMonths()) {
        showToast('エクセルファイルを読み込みました。CSVデータを投入してください', 'info');
      }
      if (hasFuelView) FuelView.onExcelFilesChanged(false);
      if (fileInput) fileInput.value = '';
      return;
    }

    showProgress(65);
    runSingleMonthPipeline();
    if (excelFiles.length > 0 && hasFuelView) FuelView.onExcelFilesChanged(false);
    if (fileInput) fileInput.value = '';
  }

  /**
   * Excelファイルを読み込んで保持する (電力・燃料エネルギーの両方の画面で共用)
   * @param {File[]} excelFiles
   */
  async function loadExcelFiles(excelFiles) {
    state.loadedExcelFiles = state.loadedExcelFiles || [];

    for (const ef of excelFiles) {
      try {
        const buffer = await readFileAsArrayBuffer(ef);
        if (!buffer) continue;
        const normName = ef.name.normalize('NFC');
        state.loadedExcelFiles.push({ name: normName, buffer });

        const excelKind = detectExcelKind(normName);
        if (excelKind === 'energy') {
          updateTagBadge('tagEnergy', true);
          showToast(`エネルギー計算表 (${normName}) を読み込みました`, 'success');
        } else if (excelKind === 'pet') {
          updateTagBadge('tagPet', true);
          showToast(`月報PET (${normName}) を読み込みました`, 'success');
        } else {
          showToast(`Excelファイル (${normName}) を読み込みました`, 'info');
        }
      } catch (err) {
        console.warn('Excel load error:', err);
      }
    }
  }

  /**
   * 読み込み済みのExcelの内容を、電力の読込済みの月へ反映する (再計算と結果の通知)
   * @returns {boolean} 反映する月があった場合 true (電力の読込済みの月が無い場合は false)
   */
  function applyExcelToLoadedMonths() {
    const loadedCount = Object.keys(state.monthlyDatasets).length;
    if (loadedCount === 0) return false;

    const missingByYm = recalculateAllLoadedMonths();
    // 読み込まれている種類のExcelについて、実際に値を取得できた月数を通知する
    const loadedKinds = new Set((state.loadedExcelFiles || []).map(ef => detectExcelKind(ef.name)));
    const countFound = (key) => loadedCount - Object.values(missingByYm).filter(m => m[key]).length;
    const parts = [];
    if (loadedKinds.has('pet')) parts.push(`本数 ${countFound('production')}/${loadedCount} ヶ月`);
    if (loadedKinds.has('energy')) parts.push(`電力量単価 ${countFound('electricity')}/${loadedCount} ヶ月`);
    if (parts.length > 0) {
      showToast(`Excelのデータを読込済みの月へ反映しました（取得できた月: ${parts.join('、')}）`, 'success');
    }
    notifyMissingExternalData(missingByYm);
    return true;
  }

  /**
   * 燃料エネルギーの画面の投入口にファイルが投入されたときの処理
   * Excelは電力の画面と共用するため、電力の読込済みの月にも反映する
   */
  async function handleFuelFiles(files) {
    if (!files || files.length === 0) return;

    const validFiles = Array.from(files).filter(f => !f.name.startsWith('.') && !f.name.startsWith('._'));
    const isLoggerFile = (name) => name.endsWith('.txt') || name.endsWith('.csv');
    const isExcelFile = (name) => name.endsWith('.xlsx') || name.endsWith('.xls');
    const lowerNames = validFiles.map(f => f.name.normalize('NFC').toLowerCase());
    const excelFiles = validFiles.filter((f, i) => isExcelFile(lowerNames[i]));

    if (lowerNames.some(isLoggerFile)) {
      showToast('ロガーファイル（TXT/CSV）は「⚡ 電力」の「単月詳細集約」で投入してください。燃料エネルギーの画面では Excel のみ読み込みます', 'warning', 12000);
    }
    if (excelFiles.length === 0) {
      if (!lowerNames.some(isLoggerFile)) showToast('Excelファイルが見つかりませんでした', 'error');
      return;
    }

    await loadExcelFiles(excelFiles);
    applyExcelToLoadedMonths();
    FuelView.onExcelFilesChanged(true);
  }

  /**
   * 電力の読込済みの月から、品種別の操業時間 (水運転＋実充填) を取り出す。燃料エネルギーの操業時間系の指標に使う
   * @returns {Object} { [ym]: { [品種キー]: 分 } }。品種別の集計を持たない月は含めない
   */
  function getOperationMinutesByYm() {
    const result = {};
    Object.keys(state.monthlyDatasets || {}).forEach(ym => {
      const ds = state.monthlyDatasets[ym];
      if (!ds || !/^\d{6}$/.test(ym)) return;
      let varietyAgg = null;
      if (ds.aggResult && ds.aggResult.rows && ds.aggResult.rows.length > 0) {
        varietyAgg = AnnualService.aggregateMonthByVariety(ds.aggResult.rows);
      } else if (ds.varietyAgg) {
        varietyAgg = ds.varietyAgg;
      }
      if (varietyAgg && varietyAgg.combined && varietyAgg.combined.operationMin) {
        result[ym] = varietyAgg.combined.operationMin;
      }
    });
    return result;
  }

  /**
   * Excelファイル名から種別を判定する
   * @param {string} normName NFC正規化済みのファイル名
   * @returns {string|null} 'energy' (エネルギー計算表) / 'pet' (月報PET) / null (対象外)
   */
  function detectExcelKind(normName) {
    const lowerNorm = normName.toLowerCase();
    if (lowerNorm.includes('エネルギー') || lowerNorm.includes('かつらぎ') || lowerNorm.includes('energy')) return 'energy';
    if (lowerNorm.includes('月報') || lowerNorm.includes('pet')) return 'pet';
    return null;
  }

  /**
   * 読み込み済みExcelから、対象年月の外部データ（生産本数・電力量単価）を抽出する
   * - その種類のExcelが読み込まれている場合: 取得できた値を使う。取得できなければ初期値（本数0、既定の電力量単価）とし、missing に理由を入れる
   * - その種類のExcelが読み込まれていない場合: その月の既存の値（スプレッドシートから復元した値を含む）を引き継ぐ。無ければ初期値
   * @param {string} ym 'YYYYMM'
   * @param {Object} [previous] その月の既存の externalData
   * @returns {Object} { production, electricity, missing: { production, electricity } }
   *   missing の各値は null (取得できた、またはExcel未読込) / 'noSheet' (対象年度のシートが無い) / 'noData' (対象月の値が無い)
   */
  function extractExternalDataForMonth(ym, previous) {
    const defaults = {
      production: { totalBottles: 0, varieties: {} },
      electricity: { ...state.externalData.electricity }
    };
    const found = { production: null, electricity: null };
    const loaded = { production: false, electricity: false };
    const missing = { production: null, electricity: null };

    for (const ef of (state.loadedExcelFiles || [])) {
      const excelKind = detectExcelKind(ef.name);
      const key = excelKind === 'energy' ? 'electricity' : (excelKind === 'pet' ? 'production' : null);
      if (!key) continue;
      loaded[key] = true;
      try {
        if (excelKind === 'energy') {
          const { sheetFound, ...res } = ExcelReader.parseEnergyCalculationTable(ef.buffer, ym);
          if (res.unitPriceYenPerKwh) {
            found.electricity = res;
            updateTagBadge('tagEnergy', true);
          } else {
            missing.electricity = sheetFound ? 'noData' : 'noSheet';
          }
        } else {
          const { sheetFound, ...res } = ExcelReader.parsePetMonthlyReport(ef.buffer, ym);
          if (res.totalBottles > 0 || Object.keys(res.varieties).length > 0) {
            found.production = res;
            updateTagBadge('tagPet', true);
          } else {
            missing.production = sheetFound ? 'noData' : 'noSheet';
          }
        }
      } catch (err) {
        console.warn(`Excel parse error for ${ym}:`, err);
        missing[key] = missing[key] || 'noData';
      }
    }

    const prev = previous || {};
    const pick = (key) => found[key] || (loaded[key] ? defaults[key] : (prev[key] || defaults[key]));
    return {
      production: pick('production'),
      electricity: pick('electricity'),
      missing: {
        production: found.production ? null : missing.production,
        electricity: found.electricity ? null : missing.electricity
      }
    };
  }

  /**
   * スプレッドシートへ保存される外部データの値（総本数、品種別本数、電力量単価）を比較用の文字列にする
   */
  function externalDataSignature(externalData) {
    const prod = (externalData && externalData.production) || {};
    const ele = (externalData && externalData.electricity) || {};
    const varieties = VARIETY_KEYS.map(k => (prod.varieties && prod.varieties[k]) || 0);
    return JSON.stringify([prod.totalBottles || 0, varieties, Math.round((ele.unitPriceYenPerKwh || 0) * 10000) / 10000]);
  }

  /**
   * 'YYYYMM' の一覧を表示用の文字列にする（連続する月は「2023年4月〜2024年3月」、それ以外は列挙）
   */
  function formatYmList(yms) {
    const sorted = yms.slice().sort();
    const label = ym => `${ym.slice(0, 4)}年${parseInt(ym.slice(4, 6), 10)}月`;
    const serial = ym => parseInt(ym.slice(0, 4), 10) * 12 + parseInt(ym.slice(4, 6), 10);
    const isContiguous = sorted.every((ym, i) => i === 0 || serial(ym) - serial(sorted[i - 1]) === 1);
    if (sorted.length >= 3 && isContiguous) return `${label(sorted[0])}〜${label(sorted[sorted.length - 1])}`;
    if (sorted.length <= 4) return sorted.map(label).join('、');
    return `${sorted.slice(0, 3).map(label).join('、')} ほか`;
  }

  /**
   * Excelから本数・電力量単価を取得できなかった月を、まとめて警告表示する
   * @param {Object} missingByYm { [ym]: { production, electricity } } (extractExternalDataForMonth の missing)
   */
  function notifyMissingExternalData(missingByYm) {
    const messages = [];
    const ymsOf = (key, reason) => Object.keys(missingByYm).filter(ym => missingByYm[ym][key] === reason);

    // 月報PET: 対象年度のシートが無い (年度ごとにまとめる)
    const noSheetByFy = {};
    ymsOf('production', 'noSheet').forEach(ym => {
      const fy = AppConfig.getFiscalYear(parseInt(ym.slice(0, 4), 10), parseInt(ym.slice(4, 6), 10));
      (noSheetByFy[fy] = noSheetByFy[fy] || []).push(ym);
    });
    Object.keys(noSheetByFy).sort().forEach(fy => {
      const yms = noSheetByFy[fy];
      messages.push(`月報PETに ${fy}年度 のシートが無いため、${yms.length}ヶ月分（${formatYmList(yms)}）の本数を取得できませんでした。本数 0 として集計しています`);
    });

    // 月報PET: シートはあるが対象月が未入力
    const noDataYms = ymsOf('production', 'noData');
    if (noDataYms.length > 0) {
      messages.push(`月報PETに本数が入力されていないため、${noDataYms.length}ヶ月分（${formatYmList(noDataYms)}）の本数を取得できませんでした。本数 0 として集計しています`);
    }

    // エネルギー計算表: 単価を取得できない (シートなし・未入力をまとめる)
    const noPriceYms = Object.keys(missingByYm).filter(ym => missingByYm[ym].electricity);
    if (noPriceYms.length > 0) {
      const defaultPrice = state.externalData.electricity.unitPriceYenPerKwh;
      messages.push(`エネルギー計算表から電力量単価を取得できなかったため、${noPriceYms.length}ヶ月分（${formatYmList(noPriceYms)}）は既定の単価（${defaultPrice} 円/kWh）で計算しています`);
    }

    messages.forEach(msg => showToast(msg, 'warning', 12000));
  }

  /**
   * 読み込み済みの全年月データセットに対して、外部Excelデータ（生産本数・単価）を再抽出し、KPIを再計算する
   * @returns {Object} 取得できなかった月の情報 { [ym]: { production, electricity } }
   */
  function recalculateAllLoadedMonths() {
    const missingByYm = {};
    const yms = Object.keys(state.monthlyDatasets);
    if (yms.length === 0) return missingByYm;

    yms.forEach(ym => {
      const ds = state.monthlyDatasets[ym];
      if (!ds) return;

      const { production, electricity, missing } = extractExternalDataForMonth(ym, ds.externalData);
      missingByYm[ym] = missing;

      const kpiResult = KpiService.calculateKpi(
        ds.catResult.categoryMonthlyTotals,
        ds.catResult.monthlyOperationTimes,
        production,
        electricity
      );

      // 保存される値（本数・単価）が変わった月は、スプレッドシートへ未反映の状態に戻す
      if (externalDataSignature(ds.externalData) !== externalDataSignature({ production, electricity })) {
        state.syncedYms.delete(ym);
      }

      ds.kpiResult = kpiResult;
      ds.externalData = { production, electricity };
    });

    // 直前に表示中だった単月画面を再描画
    if (state.lastSelectedMonthlyYm && state.monthlyDatasets[state.lastSelectedMonthlyYm]) {
      renderSingleMonthData(state.monthlyDatasets[state.lastSelectedMonthlyYm]);
    }

    // 年間データセットの再集約とプルダウン更新
    rebuildAnnualDataFromMonthlyDatasets();
    updateSyncStatusUI();
    return missingByYm;
  }

  /**
   * 読み込み済みの月別データ群 (state.monthlyDatasets) から各年度の年間集約データを構築
   * 期中（例: 2026年度 9月まで）のデータであっても、データが存在する月のみで集約し年度選択を可能にする
   */
  function rebuildAnnualDataFromMonthlyDatasets() {
    const yms = Object.keys(state.monthlyDatasets);
    if (yms.length === 0) return;

    state.annualDatasets = state.annualDatasets || {};

    // 存在する年月から年度を判定してグループ化
    // 4月〜12月: yyyy, 1月〜3月: yyyy - 1
    const detectedYearsSet = new Set();
    yms.forEach(ym => {
      const yr = parseInt(ym.slice(0, 4), 10);
      const mo = parseInt(ym.slice(4, 6), 10);
      const fy = AppConfig.getFiscalYear(yr, mo);
      detectedYearsSet.add(String(fy));
    });

    const detectedYears = Array.from(detectedYearsSet).sort().reverse();
    if (detectedYears.length === 0) return;

    // 各年度ごとに AnnualService.buildAnnualDataset を実行
    detectedYears.forEach(fy => {
      const annualData = AnnualService.buildAnnualDataset(fy, state.monthlyDatasets);
      state.annualDatasets[fy] = annualData;
    });

    // 選択対象年度の決定 (現在選択中、または最新の年度)
    const currentSelectedYr = fiscalYearSelector ? fiscalYearSelector.value : '';
    const targetYr = detectedYears.includes(currentSelectedYr) ? currentSelectedYr : detectedYears[0];

    // 年度セレクターの更新
    updateFiscalYearOptions(detectedYears, targetYr);

    // 年間推移ビューの描画更新
    state.annualData = state.annualDatasets[targetYr];
    renderAnnualView();
    renderAnnualEquipmentView();

    // 品種別の操業時間が変わるため、燃料エネルギーの画面にも知らせる
    if (hasFuelView) FuelView.onOperationDataChanged();
  }

  function runSingleMonthPipeline() {
    try {
      showProgress(70);
      const groups = CsvParser.groupFilesByYearMonth(state.loadedFiles);
      const yms = Object.keys(groups);
      if (yms.length === 0) {
        throw new Error('読み込み対象の有効な年月データが見つかりませんでした');
      }

      yms.sort();
      const missingByYm = {};

      // 各年月のデータを個別に集約・保持
      yms.forEach((ym, idx) => {
        const targetFiles = groups[ym];
        const mergedRecords = CsvParser.mergeTagFiles(targetFiles);
        const aggResult = HourlyAggregator.aggregateHourly(mergedRecords, ym);
        const catResult = CategoryService.aggregateCategories(aggResult.rows, aggResult.monthlyColumnSums);

        // 対象年月に応じた外部Excelデータを抽出 (Excelが未読込の種類は、その月の既存の値を引き継ぐ)
        const previousDataset = state.monthlyDatasets[ym];
        const { production, electricity, missing } = extractExternalDataForMonth(ym, previousDataset && previousDataset.externalData);
        missingByYm[ym] = missing;

        const kpiResult = KpiService.calculateKpi(
          catResult.categoryMonthlyTotals,
          catResult.monthlyOperationTimes,
          production,
          electricity
        );

        state.monthlyDatasets[ym] = {
          ym,
          aggResult,
          catResult,
          kpiResult,
          externalData: { production, electricity }
        };
        // ファイルから集計し直した月は、スプレッドシートへ未反映の状態に戻す
        state.syncedYms.delete(ym);
        showProgress(70 + Math.floor(((idx + 1) / yms.length) * 25));
      });

      // 要望仕様: データを読み込んだ後は、読み込んだ月、または複数月の時は最新月を表示
      const latestYm = yms[yms.length - 1];
      state.lastSelectedMonthlyYm = latestYm;

      updateMonthlySelectOptions(latestYm);
      renderSingleMonthData(state.monthlyDatasets[latestYm]);

      // 年間データセットの自動集約・更新
      rebuildAnnualDataFromMonthlyDatasets();
      updateSyncStatusUI();

      showProgress(100);
      showToast(`${yms.length}ヶ月分のデータを集約しました（最新: ${latestYm}を表示中）`, 'success');
      notifyMissingExternalData(missingByYm);
      setTimeout(hideProgress, 800);
    } catch (err) {
      console.error(err);
      hideProgress();
      showToast(`集計エラー: ${err.message}`, 'error');
    }
  }

  async function handleSyncToSpreadsheet() {
    // 同期対象のデータセット一覧を取得 (全月または単月)
    const yms = Object.keys(state.monthlyDatasets);
    if (yms.length === 0) {
      if (!state.currentAggregation) {
        showToast('反映対象のデータがありません', 'error');
        return;
      }
    }

    const allTargetYms = yms.length > 0 ? yms.sort() : [state.lastSelectedMonthlyYm || 'unknown'];

    // 既にスプレッドシートへ反映済みの年月を除外
    const pendingYms = allTargetYms.filter(ym => !state.syncedYms.has(ym));
    let syncTargets = pendingYms;

    if (pendingYms.length === 0) {
      const doResync = confirm(`読み込み済みの全年月（計 ${allTargetYms.length} ヶ月分）は既にスプレッドシートへ反映済みです。\n全月を再反映（上書き）しますか？`);
      if (!doResync) return;
      syncTargets = allTargetYms;
    }

    if (syncBtn) syncBtn.disabled = true;

    const totalCount = syncTargets.length;
    showProgress(5);
    updateLoadingProgress(
      `☁️ スプレッドシートへ反映中 (計 ${totalCount} ヶ月分)`,
      5,
      '同期の準備中...'
    );

    try {
      for (let i = 0; i < totalCount; i++) {
        const ym = syncTargets[i];
        const ds = state.monthlyDatasets[ym];
        if (!ds) continue;

        const ymYear = ym.slice(0, 4);
        const ymMonth = parseInt(ym.slice(4, 6), 10);
        const label = `${ymYear}年${ymMonth}月度`;
        const currentPct = 5 + Math.floor((i / totalCount) * 90);

        updateLoadingProgress(
          `☁️ スプレッドシートへ反映中 (${i + 1} / ${totalCount} ヶ月)`,
          currentPct,
          `🔄 [${i + 1}/${totalCount}] ${label} を集約・保存中...`
        );

        // 品種別データの作成（月報PETの品種別本数＋実充填・水運転・合算の分離集計）
        let varietyData = null;
        let vAgg = null;
        if (typeof AnnualService !== 'undefined' && ds.aggResult && ds.aggResult.rows) {
          vAgg = AnnualService.aggregateMonthByVariety(ds.aggResult.rows);
        } else if (ds.varietyAgg) {
          vAgg = ds.varietyAgg;
        }

        const extProd = (ds.externalData && ds.externalData.production) || {};
        varietyData = {
          bottles: extProd.varieties || {},
          fillingPowerKwh: (vAgg && vAgg.fillingOnly && vAgg.fillingOnly.powerKwh) || {},
          waterPowerKwh: (vAgg && vAgg.waterOnly && vAgg.waterOnly.powerKwh) || {},
          fillingOperationMin: (vAgg && vAgg.fillingOnly && vAgg.fillingOnly.operationMin) || {},
          waterOperationMin: (vAgg && vAgg.waterOnly && vAgg.waterOnly.operationMin) || {},
          powerKwh: (vAgg && vAgg.combined && vAgg.combined.powerKwh) || {},
          operationMin: (vAgg && vAgg.combined && vAgg.combined.operationMin) || {}
        };

        const payload = {
          yearMonth: ym,
          rows: (ds.aggResult && ds.aggResult.rows) || [],
          categoryDailyTotals: (ds.catResult && ds.catResult.categoryDailyTotals) || [],
          kpi: ds.kpiResult,
          varietyData: varietyData
        };

        await sendDataToGas(payload);

        // 同期完了年月として記録
        state.syncedYms.add(ym);
        updateSyncStatusUI();

        const completedPct = 5 + Math.floor(((i + 1) / totalCount) * 90);
        showProgress(completedPct);
        updateLoadingProgress(
          `☁️ スプレッドシートへ反映中 (${i + 1} / ${totalCount} ヶ月)`,
          completedPct,
          `✅ ${label} の保存完了`,
          `✓ ${label}：同期完了`
        );
      }

      showProgress(100);
      updateLoadingProgress(
        `✅ スプレッドシートへの反映が完了しました！`,
        100,
        `全 ${totalCount} ヶ月分の集約データが正常に保存されました`
      );
      showToast(`スプレッドシートへの同期が正常に完了しました！（${totalCount} ヶ月分反映）`, 'success');
      updateSyncStatusUI();
      setTimeout(hideProgress, 1000);
      await new Promise(r => setTimeout(r, 900));
    } catch (err) {
      console.error('Sync error:', err);
      showToast(`同期エラー: ${err.message}`, 'error');
      hideProgress();
    } finally {
      hideLoading();
      if (syncBtn) syncBtn.disabled = false;
    }
  }

  /**
   * GASバックエンドにデータを送信する (Promise対応)
   */
  function sendDataToGas(payload) {
    return new Promise((resolve, reject) => {
      // 1. Google Apps Script 環境 (google.script.run)
      if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run
          .withSuccessHandler(res => {
            if (res && res.error) {
              reject(new Error(res.error));
            } else {
              resolve(res);
            }
          })
          .withFailureHandler(err => {
            reject(new Error(err.message || 'GAS呼び出しに失敗しました'));
          })
          .saveAggregatedData(payload);
      } else {
        // 2. ローカル開発環境 (モックフォールバック)
        setTimeout(() => {
          resolve({ success: true, mocked: true });
        }, 300);
      }
    });
  }

  async function handleExportExcel() {
    if (typeof XLSX === 'undefined') {
      showToast('SheetJSライブラリが読み込まれていません', 'error');
      return;
    }

    showLoading('📊 スプレッドシートから集約データを取得中...');

    try {
      let sheetsData = null;

      // 1. GAS本番環境 (google.script.run)
      if (typeof google !== 'undefined' && google.script && google.script.run) {
        sheetsData = await new Promise((resolve, reject) => {
          google.script.run
            .withSuccessHandler(res => {
              if (res && res.success) {
                resolve(res.sheets);
              } else {
                reject(new Error(res ? res.error : 'データ取得に失敗しました'));
              }
            })
            .withFailureHandler(err => {
              reject(new Error(err.message || 'GAS呼び出しに失敗しました'));
            })
            .getSheetsDataForExport();
        });
      } else {
        // 2. ローカル開発環境用フォールバック (保持データセットからスプレッドシート互換3シートを構築)
        sheetsData = buildLocalExportSheets();
        if (hasFuelView) sheetsData[FUEL_SHEET_NAME] = FuelView.buildExportRows();
      }

      if (!sheetsData || Object.keys(sheetsData).length === 0) {
        throw new Error('出力対象のシートデータが見つかりませんでした');
      }

      // 3. SheetJSでワークブックを構築
      const wb = XLSX.utils.book_new();
      const targetSheetNames = ['日別集約', 'KPI評価', '品種別集約', FUEL_SHEET_NAME];
      let exportedSheetCount = 0;
      let fuelSheetExported = false;

      targetSheetNames.forEach(sName => {
        const rows = sheetsData[sName];
        if (rows && rows.length > 0) {
          const ws = XLSX.utils.aoa_to_sheet(rows);
          XLSX.utils.book_append_sheet(wb, ws, sName);
          exportedSheetCount++;
          if (sName === FUEL_SHEET_NAME) fuelSheetExported = true;
        }
      });

      if (exportedSheetCount === 0) {
        throw new Error('スプレッドシートにデータが存在しません。先にデータを読み込んで反映してください。');
      }

      // 4. Excelファイルの書き出し・ダウンロード
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const fileName = `エネルギー集計データ_${dateStr}.xlsx`;
      XLSX.writeFile(wb, fileName);

      showToast(fuelSheetExported
        ? `スプレッドシートの4シート（日別集約・KPI評価・品種別集約・${FUEL_SHEET_NAME}）をExcel出力しました`
        : `スプレッドシートの3シート（日別集約・KPI評価・品種別集約）をExcel出力しました`, 'success');
    } catch (err) {
      console.error('Export Excel Error:', err);
      showToast(`Excelエクスポートエラー: ${err.message}`, 'error');
    } finally {
      hideLoading();
    }
  }

  /**
   * ローカル環境用フォールバック: 保持データからスプレッドシート「日別集約」「KPI評価」「品種別集約」互換配列を生成
   */
  function buildLocalExportSheets() {
    const categories = (typeof AppConfig !== 'undefined' && AppConfig.CATEGORIES) || [];
    const varietyKeys = VARIETY_KEYS;
    const yms = Object.keys(state.monthlyDatasets || {}).sort();

    // 1. 日別集約
    const dHeader = ['年月日', '日'];
    categories.forEach(c => dHeader.push(c.name + ' (kWh)'));
    dHeader.push('水運転(分)', '実充填(分)', '合計操業時間(分)');
    const dailyRows = [dHeader];

    // 2. KPI評価
    const kHeader = ['対象年月', '総電力量(kWh)', '操業時間(分)', '生産本数(本)', '時間原単位(kWh/分)', '本原単位(kWh/本)', '1本当たりコスト(円)', '電力量単価(円/kWh)'];
    const kpiRows = [kHeader];

    // 3. 品種別集約
    const vHeader = ['対象年月'];
    varietyKeys.forEach(vk => vHeader.push(vk + ' (本)'));
    varietyKeys.forEach(vk => vHeader.push(vk + ' 実充填(kWh)'));
    varietyKeys.forEach(vk => vHeader.push(vk + ' 水運転(kWh)'));
    varietyKeys.forEach(vk => vHeader.push(vk + ' 実充填(分)'));
    varietyKeys.forEach(vk => vHeader.push(vk + ' 水運転(分)'));
    const varietyRows = [vHeader];

    yms.forEach(ym => {
      const ds = state.monthlyDatasets[ym];
      if (!ds) return;

      // 日別
      const catTotals = (ds.catResult && ds.catResult.categoryDailyTotals) || ds.categoryDailyTotals;
      if (catTotals && Array.isArray(catTotals)) {
        catTotals.forEach(d => {
          const row = [d.date, d.day];
          categories.forEach(c => {
            row.push(d.categories ? (d.categories[c.name] || 0) : 0);
          });
          const op = d.operationTimes || {};
          const wMin = op.waterTimeMin || 0;
          const fMin = op.actualFillingMin || 0;
          row.push(wMin, fMin, wMin + fMin);
          dailyRows.push(row);
        });
      }

      // KPI
      const kpiObj = ds.kpiResult || ds.kpi;
      if (kpiObj && kpiObj.evaluation && kpiObj.evaluation.combined) {
        const comb = kpiObj.evaluation.combined;
        const elec = kpiObj.electricitySummary || {};
        kpiRows.push([
          ym,
          comb.totalKwh || 0,
          comb.operationTimeMin || 0,
          comb.productionBottles || 0,
          comb.kwhPerMinute || 0,
          comb.kwhPerBottle || 0,
          comb.costPerBottleYen || 0,
          elec.unitPriceYenPerKwh || 0
        ]);
      }

      // 品種別
      const extProd = (ds.externalData && ds.externalData.production) || {};
      const vBottles = extProd.varieties || {};
      let vAgg = ds.varietyAgg;
      if (!vAgg && typeof AnnualService !== 'undefined' && ds.aggResult && ds.aggResult.rows) {
        vAgg = AnnualService.aggregateMonthByVariety(ds.aggResult.rows);
      }
      const fPower = (vAgg && vAgg.fillingOnly && vAgg.fillingOnly.powerKwh) || {};
      const wPower = (vAgg && vAgg.waterOnly && vAgg.waterOnly.powerKwh) || {};
      const fMin = (vAgg && vAgg.fillingOnly && vAgg.fillingOnly.operationMin) || {};
      const wMin = (vAgg && vAgg.waterOnly && vAgg.waterOnly.operationMin) || {};

      const vRow = [ym];
      varietyKeys.forEach(vk => vRow.push(vBottles[vk] || 0));
      varietyKeys.forEach(vk => vRow.push(fPower[vk] || 0));
      varietyKeys.forEach(vk => vRow.push(wPower[vk] || 0));
      varietyKeys.forEach(vk => vRow.push(fMin[vk] || 0));
      varietyKeys.forEach(vk => vRow.push(wMin[vk] || 0));
      varietyRows.push(vRow);
    });

    return {
      '日別集約': dailyRows,
      'KPI評価': kpiRows,
      '品種別集約': varietyRows
    };
  }

  // 補助関数

  /**
   * 数値を3桁区切り・小数桁固定の文字列に整形する
   */
  function formatNumber(value, digits) {
    return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function readFileAsText(file) {
    return new Promise(resolve => {
      try {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result || '');
        reader.onerror = () => resolve('');
        reader.readAsText(file, 'utf-8');
      } catch (err) {
        resolve('');
      }
    });
  }

  function readFileAsArrayBuffer(file) {
    return new Promise(resolve => {
      try {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = () => resolve(null);
        reader.readAsArrayBuffer(file);
      } catch (err) {
        resolve(null);
      }
    });
  }

  function updateTagBadge(tagId, detected) {
    const el = document.getElementById(tagId);
    if (el && detected) el.classList.add('detected');
  }

  function showProgress(pct) {
    if (progressBarContainer && progressBarFill) {
      progressBarContainer.style.display = 'block';
      progressBarFill.style.width = `${pct}%`;
    }
  }

  function hideProgress() {
    if (progressBarContainer) {
      progressBarContainer.style.display = 'none';
      progressBarFill.style.width = '0%';
    }
  }

  function setElemText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function showToast(msg, type = 'success', durationMs = 4000) {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${type === 'success' ? '✓' : ((type === 'error' || type === 'warning') ? '⚠' : 'ℹ')}</span> <div>${msg}</div>`;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), durationMs);
  }

  // グローバル公開
  window.EnergyApp = {
    state,
    renderAnnualView,
    renderAnnualEquipmentView,
    loadAnnualData,
    switchMainView,
    switchApp
  };

})();
