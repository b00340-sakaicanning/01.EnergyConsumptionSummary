/**
 * gas_app/js/fuelView.js
 * 燃料エネルギー画面 (年間推移・品種別分析) の制御
 * 読み込み済みのExcel (エネルギー計算表・月報PET) と、電力側の操業時間から燃料の集計を作り、画面に表示する。
 * 画面共通の部品 (通知、数値の整形、集計表の描画など) は app.js から init() で受け取る
 * ブラウザ環境およびNode.js環境両対応 (Node.jsでは、DOMを使わないデータ処理の関数だけをテストから利用する)
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./config.js'), require('./services/fuelService.js'), require('./etl/excelReader.js'));
  } else {
    root.FuelView = factory(root.AppConfig, root.FuelService, root.ExcelReader);
  }
}(typeof self !== 'undefined' ? self : this, function (AppConfig, FuelService, ExcelReader) {

  const VARIETY_KEYS = AppConfig.VARIETY_KEYS;
  const FUEL_FIELDS = ['heavyOilGj', 'lngGj', 'heavyOilCostThousandYen', 'lngCostThousandYen'];

  // =========================================================================
  // データ処理 (DOMを使わない)
  // =========================================================================

  const fiscalYearOf = ym => AppConfig.getFiscalYear(parseInt(ym.slice(0, 4), 10), parseInt(ym.slice(4, 6), 10));

  /**
   * シート名に含まれる年度の候補 (4桁の数字) を取り出す
   */
  function listFiscalYears(sheetNames) {
    const years = new Set();
    (sheetNames || []).forEach(name => {
      const m = String(name).match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
      if (m) years.add(parseInt(m[1], 10));
    });
    return Array.from(years).sort();
  }

  /**
   * 年度の一覧を、連続する年度をまとめた文字列にする (例: [2013, 2014, 2015, 2018] → '2013〜2015、2018')
   */
  function formatYearRanges(years) {
    const sorted = Array.from(new Set((years || []).map(Number))).sort((a, b) => a - b);
    const parts = [];
    let start = null;
    let prev = null;
    sorted.forEach(y => {
      if (start === null) {
        start = y;
      } else if (y !== prev + 1) {
        parts.push(start === prev ? String(start) : `${start}〜${prev}`);
        start = y;
      }
      prev = y;
    });
    if (start !== null) parts.push(start === prev ? String(start) : `${start}〜${prev}`);
    return parts.join('、');
  }

  /**
   * 品種別本数を、8品種すべてのキーを持つ形に揃える
   */
  function normalizeBottles(bottles) {
    const out = {};
    VARIETY_KEYS.forEach(k => { out[k] = (bottles && typeof bottles[k] === 'number') ? bottles[k] : 0; });
    return out;
  }

  /**
   * 読み込み済みのワークブックから、燃料の月次データを作り直す
   * - エネルギー計算表が読み込まれていれば、読めた年月の燃料4値を取り直す (読めなかった年月の既存値は残す)
   * - 月報PETが読み込まれていれば、全年月の品種別本数を取り直す (対象年度のシートが無い、または未入力の月は null)
   * - 読み込まれていない種類の値は、既存の値 (スプレッドシートから復元した値を含む) を引き継ぐ
   * @param {Object} existing { [ym]: { heavyOilGj, lngGj, heavyOilCostThousandYen, lngCostThousandYen, bottles } }
   * @param {Array} energyWorkbooks エネルギー計算表のワークブック
   * @param {Array} petWorkbooks 月報PETのワークブック
   * @returns {Object} { monthly, skippedYears, noPetYears }
   *   skippedYears: シートはあるが燃料の行を特定できなかった年度 / noPetYears: 月報PETに年度のシートが無い年度
   */
  function mergeFuelMonthly(existing, energyWorkbooks, petWorkbooks) {
    const monthly = {};
    Object.keys(existing || {}).forEach(ym => {
      monthly[ym] = Object.assign({}, existing[ym], { bottles: existing[ym].bottles ? normalizeBottles(existing[ym].bottles) : null });
    });

    const readYears = new Set();
    const unreadableYears = new Set();
    (energyWorkbooks || []).forEach(wb => {
      listFiscalYears(wb.SheetNames).forEach(fy => {
        const res = ExcelReader.parseFuelEnergyTable(wb, fy);
        if (!res.sheetFound) return;
        if (!res.layoutFound) { unreadableYears.add(fy); return; }
        readYears.add(fy);
        Object.keys(res.months).forEach(ym => {
          if (!FuelService.summarizeFuelMonth(res.months[ym]).hasData) return;
          const prev = monthly[ym] || { bottles: null };
          monthly[ym] = Object.assign({}, prev, res.months[ym]);
        });
      });
    });

    const noPetYears = new Set();
    if (petWorkbooks && petWorkbooks.length > 0) {
      Object.keys(monthly).forEach(ym => {
        let bottles = null;
        let sheetFound = false;
        petWorkbooks.forEach(wb => {
          const res = ExcelReader.parsePetMonthlyReport(wb, ym);
          if (res.sheetFound) sheetFound = true;
          if (Object.keys(res.varieties).length > 0) bottles = res.varieties;
        });
        monthly[ym].bottles = bottles ? normalizeBottles(bottles) : null;
        if (!sheetFound) noPetYears.add(fiscalYearOf(ym));
      });
    }

    return {
      monthly,
      skippedYears: Array.from(unreadableYears).filter(fy => !readYears.has(fy)).sort(),
      noPetYears: Array.from(noPetYears).sort()
    };
  }

  /**
   * スプレッドシートへ保存する値 (燃料4値と品種別本数) を比較用の文字列にする
   */
  function monthSignature(month) {
    if (!month) return '';
    const round = v => (typeof v === 'number' && isFinite(v)) ? Math.round(v * 1e6) / 1e6 : 0;
    return JSON.stringify([
      FUEL_FIELDS.map(f => round(month[f])),
      month.bottles ? VARIETY_KEYS.map(k => month.bottles[k] || 0) : null
    ]);
  }

  /**
   * スプレッドシート「燃料集約」へ保存する1行分のデータを作る
   */
  function toSheetRow(ym, month) {
    return {
      yearMonth: ym,
      heavyOilGj: month.heavyOilGj,
      lngGj: month.lngGj,
      heavyOilCostThousandYen: month.heavyOilCostThousandYen,
      lngCostThousandYen: month.lngCostThousandYen,
      bottles: month.bottles ? normalizeBottles(month.bottles) : null
    };
  }

  /**
   * 月次データから、データのある年度ごとの年間データセットを作る
   * @returns {Object} { [fiscalYear]: dataset }
   */
  function buildAnnualDatasets(monthly, operationMinByYm) {
    const years = new Set();
    Object.keys(monthly || {}).forEach(ym => {
      if (FuelService.summarizeFuelMonth(monthly[ym]).hasData) years.add(fiscalYearOf(ym));
    });
    const datasets = {};
    Array.from(years).forEach(fy => {
      datasets[fy] = FuelService.buildFuelAnnualDataset(fy, monthly, operationMinByYm);
    });
    return datasets;
  }

  /**
   * グラフの目盛り上限を、全年度の最大値から求める (年度を切り替えても目盛りが変わらないようにする)
   * @param {Object} annualDatasets { [fiscalYear]: dataset }
   * @param {Object} metric 評価項目の定義 (FUEL_METRICS の1件)
   * @param {Object} layout SCALE_CONFIG.autoLayout
   * @param {Object} chartManager getNiceMax / getAxisMaxForPeak を持つオブジェクト
   * @returns {Object} 総量系: { max, trendMax } / 原単位系: { barMax, lineMax }
   */
  function computeScale(annualDatasets, metric, layout, chartManager) {
    let maxMonthTotal = 0;
    let maxVarietyVal = 0;
    Object.keys(annualDatasets || {}).forEach(fy => {
      const months = annualDatasets[fy].metrics[metric.key].months;
      Object.keys(months).forEach(ym => {
        const m = months[ym];
        if (!m.hasData) return;
        if (m.monthlyTotal > maxMonthTotal) maxMonthTotal = m.monthlyTotal;
        VARIETY_KEYS.forEach(k => { if (m.varieties[k] > maxVarietyVal) maxVarietyVal = m.varieties[k]; });
      });
    });
    if (metric.isRate) {
      return {
        barMax: chartManager.getAxisMaxForPeak(maxVarietyVal, layout.rateBarPeakRatio),
        lineMax: chartManager.getAxisMaxForPeak(maxMonthTotal, layout.rateLinePeakRatio)
      };
    }
    return {
      max: chartManager.getNiceMax(maxMonthTotal),
      trendMax: chartManager.getAxisMaxForPeak(maxVarietyVal, layout.trendPeakRatio)
    };
  }

  /**
   * 品種別の内訳が無い月 (品種別本数が無い月) の月計を、グラフ用の配列にする
   * 総量系の指標で、月計はあるが品種別に按分できない月だけ値が入る。該当する月が無ければ null を返す
   * @returns {Array<number|null>|null}
   */
  function buildTotalOnlySeries(metricData, months) {
    const data = (months || []).map(ym => {
      const m = metricData.months[ym];
      if (!m || !m.hasData || m.monthlyTotal === null || m.monthlyTotal === undefined) return null;
      const hasBreakdown = VARIETY_KEYS.some(k => m.varieties && m.varieties[k] !== null && m.varieties[k] !== undefined);
      return hasBreakdown ? null : m.monthlyTotal;
    });
    return data.some(v => v !== null) ? data : null;
  }

  // =========================================================================
  // 画面制御
  // =========================================================================

  const SHEET_HEADER = ['対象年月', 'A重油 熱量(GJ)', 'LNG 熱量(GJ)', 'A重油 購入費用(千円)', 'LNG 購入費用(千円)']
    .concat(VARIETY_KEYS.map(k => `${k} (本)`));

  let deps = null;
  let els = {};
  const workbookCache = new WeakMap(); // 読み込み済みExcelの解析結果 (ファイルごとに1回だけ解析する)
  const fuelState = {
    monthly: {},          // { [ym]: { heavyOilGj, lngGj, heavyOilCostThousandYen, lngCostThousandYen, bottles } }
    annualDatasets: {},   // { [fiscalYear]: dataset }
    selectedYear: null,
    metricKey: AppConfig.FUEL_METRICS[0].key,
    savedSignatures: {},  // スプレッドシートに保存済みの値の署名 { [ym]: string }
    noPetYears: []
  };

  const dataYms = () => Object.keys(fuelState.monthly).filter(ym => FuelService.summarizeFuelMonth(fuelState.monthly[ym]).hasData).sort();
  const pendingYms = () => dataYms().filter(ym => monthSignature(fuelState.monthly[ym]) !== fuelState.savedSignatures[ym]);
  const hasGasFunction = name => typeof google !== 'undefined' && google.script && google.script.run && typeof google.script.run[name] === 'function';
  const isGasEnvironment = () => typeof google !== 'undefined' && google.script && google.script.run;

  /**
   * 初期化。app.js の initApp から、画面共通の部品を受け取って呼ばれる
   */
  function init(dependencies) {
    deps = dependencies;
    els = {
      view: document.getElementById('fuelView'),
      dropzone: document.getElementById('fuelDropzone'),
      fileInput: document.getElementById('fuelFileInput'),
      yearSelector: document.getElementById('fuelYearSelector'),
      metricSelector: document.getElementById('fuelMetricSelector'),
      status: document.getElementById('fuelDataStatus'),
      note: document.getElementById('fuelChartNote'),
      breakdownBody: document.getElementById('fuelBreakdownTableBody')
    };
    if (!els.view) return;

    els.metricSelector.innerHTML = AppConfig.FUEL_METRICS
      .map(m => `<option value="${m.key}">${m.name} (${m.unit})</option>`).join('');
    els.metricSelector.value = fuelState.metricKey;
    els.metricSelector.addEventListener('change', (e) => {
      fuelState.metricKey = e.target.value;
      render();
    });
    els.yearSelector.addEventListener('change', (e) => {
      if (!e.target.value) return;
      fuelState.selectedYear = e.target.value;
      render();
    });

    ['dragenter', 'dragover'].forEach(eventName => {
      els.dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        els.dropzone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(eventName => {
      els.dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        els.dropzone.classList.remove('dragover');
      });
    });
    els.dropzone.addEventListener('drop', async (e) => {
      const files = await deps.getAllFilesFromDataTransfer(e.dataTransfer);
      deps.handleDroppedFiles(files);
    });
    els.dropzone.addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('click', (e) => e.stopPropagation());
    els.fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      e.target.value = '';
      deps.handleDroppedFiles(files);
    });

    restoreFromSpreadsheet();
  }

  /**
   * 読み込み済みExcelを種別ごとのワークブックに分ける
   */
  function loadedWorkbooks() {
    const result = { energy: [], pet: [] };
    (deps.getLoadedExcelFiles() || []).forEach(ef => {
      const kind = deps.detectExcelKind(ef.name);
      if (kind !== 'energy' && kind !== 'pet') return;
      try {
        if (!workbookCache.has(ef)) workbookCache.set(ef, XLSX.read(ef.buffer, { type: 'array' }));
        result[kind].push(workbookCache.get(ef));
      } catch (err) {
        console.warn('Excel parse error (fuel):', err);
      }
    });
    return result;
  }

  /**
   * Excelが読み込まれたときに呼ばれる。燃料の月次データを作り直して表示する
   * @param {boolean} [notify=true] 読込結果を通知するか
   */
  function onExcelFilesChanged(notify) {
    if (!deps) return;
    const wbs = loadedWorkbooks();
    if (wbs.energy.length === 0 && wbs.pet.length === 0) return;

    const before = dataYms().length;
    const merged = mergeFuelMonthly(fuelState.monthly, wbs.energy, wbs.pet);
    fuelState.monthly = merged.monthly;
    fuelState.noPetYears = merged.noPetYears;
    rebuildAndRender();

    if (notify === false) return;
    const years = Object.keys(fuelState.annualDatasets).sort();
    if (wbs.energy.length > 0) {
      if (years.length > 0) {
        const range = years.length > 1 ? `${years[0]}〜${years[years.length - 1]}年度` : `${years[0]}年度`;
        deps.showToast(`燃料エネルギーのデータを読み込みました（${range}、計 ${dataYms().length} ヶ月）`, 'success');
      } else {
        deps.showToast('エネルギー計算表から燃料（A重油・LNG）のデータを読み取れませんでした', 'warning', 12000);
      }
      if (merged.skippedYears.length > 0) {
        deps.showToast(`エネルギー計算表の ${formatYearRanges(merged.skippedYears)}年度 は、燃料の費用の行を特定できないため対象外にしました`, 'warning', 12000);
      }
    } else if (before === 0 && dataYms().length === 0) {
      deps.showToast('燃料エネルギーの表示には、エネルギー計算表の読み込みが必要です', 'info');
    }
    if (wbs.pet.length > 0 && merged.noPetYears.length > 0 && years.length > 0) {
      deps.showToast(`月報PETにシートが無い年度（${formatYearRanges(merged.noPetYears)}年度）は、品種別の値と本数あたりの指標を表示できません`, 'warning', 12000);
    }
  }

  /**
   * 電力側のデータ (品種別の操業時間) が変わったときに呼ばれる
   */
  function onOperationDataChanged() {
    if (!deps || dataYms().length === 0) return;
    rebuildAndRender();
  }

  function rebuildAndRender() {
    fuelState.annualDatasets = buildAnnualDatasets(fuelState.monthly, deps.getOperationMinutesByYm());
    const years = Object.keys(fuelState.annualDatasets).sort().reverse();
    if (!fuelState.selectedYear || !fuelState.annualDatasets[fuelState.selectedYear]) {
      fuelState.selectedYear = years.length > 0 ? years[0] : null;
    }
    updateBadges();
    if (deps.isActive()) {
      render();
      updateSyncStatusUI();
    }
  }

  function updateBadges() {
    const yms = dataYms();
    const ops = deps.getOperationMinutesByYm();
    const toggle = (id, on) => { const el = document.getElementById(id); if (el) el.classList.toggle('detected', on); };
    toggle('fuelTagEnergy', yms.length > 0);
    toggle('fuelTagPet', yms.some(ym => !!fuelState.monthly[ym].bottles));
    toggle('fuelTagOperation', yms.some(ym => !!ops[ym]));
  }

  /**
   * 燃料エネルギー画面を描画する (画面が表示されているときに呼ぶ)
   */
  function render() {
    if (!deps || !els.view) return;
    const years = Object.keys(fuelState.annualDatasets).sort().reverse();

    // 年度セレクター
    els.yearSelector.innerHTML = years.length === 0
      ? '<option value="">（データ未読込）</option>'
      : years.map(y => `<option value="${y}">${y}年度 (${y}/04〜${parseInt(y, 10) + 1}/03)</option>`).join('');
    if (fuelState.selectedYear) els.yearSelector.value = fuelState.selectedYear;

    const ds = fuelState.selectedYear ? fuelState.annualDatasets[fuelState.selectedYear] : null;
    if (!ds) {
      els.status.textContent = '';
      els.note.style.display = 'none';
      return;
    }

    const metric = AppConfig.FUEL_METRICS.find(m => m.key === fuelState.metricKey) || AppConfig.FUEL_METRICS[0];
    const metricData = ds.metrics[metric.key];
    const fmt = (v, digits) => (v === null || v === undefined) ? '---' : deps.formatNumber(v, digits);

    // KPIカード
    deps.setElemText('fuelKpiTotalMj', fmt(ds.metrics.fuelMj.annualTotal.monthlyTotal, 0));
    deps.setElemText('fuelKpiTotalCost', fmt(ds.metrics.fuelCostYen.annualTotal.monthlyTotal, 0));
    deps.setElemText('fuelKpiUnitPrice', fmt(ds.breakdownTotal ? ds.breakdownTotal.unitPriceYenPerMj : null, 4));
    deps.setElemText('fuelKpiTotalBottles', fmt(ds.metrics.productionBottles.annualTotal.monthlyTotal, 0));
    deps.setElemText('fuelKpiAvgIntensity', fmt(ds.metrics.mjPerBottle.annualTotal.monthlyTotal, 4));

    // タイトルと状況表示
    deps.setElemText('fuelMetricLabel', `${metric.name} (${metric.unit})`);
    deps.setElemText('fuelTableMetricTitle', `${metric.name} [${metric.unit}]`);
    deps.setElemText('fuelStackedChartTitle', metric.isRate
      ? '📊 月別燃料エネルギー使用量集約グラフ (8品種別 ＆ 全体平均折れ線)'
      : '📊 月別燃料エネルギー使用量集約グラフ (8品種積み上げ)');
    els.status.textContent = `読込済: ${ds.availableMonthsCount}ヶ月 (${ds.fiscalYear}年度)`;

    // 表示できない項目がある場合の案内
    const dataMonths = ds.months.filter(ym => ds.breakdown[ym].hasData);
    const noBottleMonths = dataMonths.filter(ym => !ds.metrics.productionBottles.months[ym].hasData);
    const noMinuteMonths = dataMonths.filter(ym => !ds.metrics.operationMin.months[ym].hasData);
    const notes = [];
    if (noBottleMonths.length > 0) {
      notes.push(`品種別の本数が無い月が ${noBottleMonths.length} ヶ月あります（月報PETに該当年度のシートが無い、または未入力）。その月は月計のみ表示し、品種別の値と本数あたりの指標は表示できません。`);
    }
    if (noMinuteMonths.length > 0 && ['operationMin', 'mjPerMinute', 'costPerMinute'].includes(metric.key)) {
      notes.push(`操業時間が無い月が ${noMinuteMonths.length} ヶ月あります。操業時間は電力の画面で読み込んだロガーデータ（またはスプレッドシートに保存済みのデータ）から取得するため、その月は「---」と表示します。`);
    }
    els.note.style.display = notes.length > 0 ? 'block' : 'none';
    els.note.innerHTML = notes.map(n => `<div>${n}</div>`).join('');

    // グラフ
    const scale = computeScale(fuelState.annualDatasets, metric, deps.getAutoLayout(), ChartManager);
    ChartManager.renderAnnualStackedBarChart('fuelStackedChart', metricData, metric, ds.monthLabels, ds.months, scale);
    if (!metric.isRate) addTotalOnlyBars('fuelStackedChart', metricData, ds.months);
    ChartManager.renderAnnualTrendChart('fuelTrendChart', metricData, metric, ds.monthLabels, ds.months, scale);

    // 集計表
    deps.renderMetricTable(metricData, metric, { tbodyId: 'fuelTableBody', months: ds.months, monthLabels: ds.monthLabels, nullAsDash: true });
    renderBreakdownTable(ds);
  }

  /**
   * 品種別の内訳が無い月の月計を、灰色の棒として積み上げグラフに加える (グラフが空になるのを避ける)
   */
  function addTotalOnlyBars(canvasId, metricData, months) {
    if (typeof Chart === 'undefined' || !Chart.getChart) return;
    const chart = Chart.getChart(canvasId);
    const data = buildTotalOnlySeries(metricData, months);
    if (!chart || !data) return;
    chart.data.datasets.push({
      type: 'bar',
      label: '月計 (品種内訳なし)',
      data: data,
      backgroundColor: '#cbd5e1',
      borderColor: '#94a3b8',
      borderWidth: 1,
      borderRadius: 2,
      yAxisID: 'y',
      stack: 'varietyStack'
    });
    chart.update();
  }

  /**
   * 燃料別の熱量・費用の表を描画する
   */
  function renderBreakdownTable(ds) {
    if (!els.breakdownBody) return;
    const dash = '<span style="color:var(--text-light);font-weight:normal;">---</span>';
    const cell = (v, digits) => (v === null || v === undefined) ? dash : deps.formatNumber(v, digits);
    const rowHtml = (b) => `
        <td>${cell(b.heavyOilGj, 1)}</td>
        <td>${cell(b.lngGj, 1)}</td>
        <td style="font-weight: 700; color: var(--primary);">${cell(b.totalGj, 1)}</td>
        <td>${cell(b.heavyOilCostThousandYen, 1)}</td>
        <td>${cell(b.lngCostThousandYen, 1)}</td>
        <td style="font-weight: 700; color: var(--primary);">${cell(b.totalCostThousandYen, 1)}</td>
        <td>${cell(b.unitPriceYenPerMj, 4)}</td>`;
    let html = '';
    ds.months.forEach((ym, idx) => {
      html += `<tr><td style="font-weight: 600;">${ds.monthLabels[idx]} (${ym})</td>${rowHtml(ds.breakdown[ym])}</tr>`;
    });
    if (ds.breakdownTotal) {
      html += `<tr class="total-row"><td>年間計</td>${rowHtml(ds.breakdownTotal)}</tr>`;
    }
    els.breakdownBody.innerHTML = html;
  }

  // =========================================================================
  // スプレッドシートへの保存・復元・エクスポート
  // =========================================================================

  /**
   * ヘッダーの同期状況表示と反映ボタンを、燃料のデータに合わせて更新する (燃料の画面を表示中に呼ばれる)
   */
  function updateSyncStatusUI() {
    const badge = document.getElementById('syncStatusBadge');
    const textElem = document.getElementById('syncStatusText');
    const syncBtn = document.getElementById('syncBtn');
    if (!badge || !textElem || !syncBtn) return;

    const total = dataYms().length;
    if (total === 0) {
      badge.style.display = 'none';
      syncBtn.disabled = true;
      syncBtn.textContent = '☁️ スプレッドシートへ反映';
      return;
    }
    const pending = pendingYms().length;
    badge.style.display = 'inline-flex';
    badge.classList.remove('has-pending', 'all-synced');
    syncBtn.disabled = false;
    if (pending > 0) {
      badge.classList.add('has-pending');
      textElem.textContent = `燃料 読込済: 計 ${total}ヶ月 (未反映: ${pending}ヶ月 / 反映済: ${total - pending}ヶ月)`;
      syncBtn.textContent = `☁️ スプレッドシートへ反映 (${pending}ヶ月分)`;
    } else {
      badge.classList.add('all-synced');
      textElem.textContent = `燃料 読込済: 計 ${total}ヶ月 (全 ${total}ヶ月 反映済み)`;
      syncBtn.textContent = '☁️ スプレッドシートへ反映 (全月反映済)';
    }
  }

  /**
   * 燃料の月次データをスプレッドシートへ反映する (未反映の月のみ。全月反映済みなら確認のうえ全月)
   */
  async function handleSync() {
    const all = dataYms();
    if (all.length === 0) {
      deps.showToast('反映対象の燃料データがありません', 'error');
      return;
    }
    let targets = pendingYms();
    if (targets.length === 0) {
      if (!confirm(`燃料データ（計 ${all.length} ヶ月分）は既にスプレッドシートへ反映済みです。\n全月を再反映（上書き）しますか？`)) return;
      targets = all;
    }
    if (isGasEnvironment() && !hasGasFunction('saveFuelMonthlyData')) {
      deps.showToast('燃料データの保存には、新しい Code.gs のデプロイが必要です', 'error');
      return;
    }

    const syncBtn = document.getElementById('syncBtn');
    if (syncBtn) syncBtn.disabled = true;
    deps.showLoading(`☁️ 燃料データをスプレッドシートへ反映中 (計 ${targets.length} ヶ月分)`);
    try {
      const rows = targets.map(ym => toSheetRow(ym, fuelState.monthly[ym]));
      await new Promise((resolve, reject) => {
        if (isGasEnvironment()) {
          google.script.run
            .withSuccessHandler(res => (res && res.success) ? resolve(res) : reject(new Error((res && res.error) || '保存に失敗しました')))
            .withFailureHandler(err => reject(new Error(err.message || 'GAS呼び出しに失敗しました')))
            .saveFuelMonthlyData(rows);
        } else {
          // ローカル開発環境 (保存はせず、成功として扱う)
          setTimeout(() => resolve({ success: true, mocked: true }), 300);
        }
      });
      targets.forEach(ym => { fuelState.savedSignatures[ym] = monthSignature(fuelState.monthly[ym]); });
      deps.showToast(`燃料データをスプレッドシートへ反映しました（${targets.length} ヶ月分）`, 'success');
    } catch (err) {
      console.error('Fuel sync error:', err);
      deps.showToast(`燃料データの同期エラー: ${err.message}`, 'error');
    } finally {
      deps.hideLoading();
      if (deps.isActive()) updateSyncStatusUI();
    }
  }

  /**
   * 起動時に、スプレッドシートに保存済みの燃料データを復元する
   */
  function restoreFromSpreadsheet() {
    // 古い Code.gs (燃料の関数が無い) と組み合わさった場合は、復元を行わない
    if (!hasGasFunction('loadSavedFuelData')) return;
    google.script.run
      .withSuccessHandler(res => {
        if (!res || !res.success || !res.months) return;
        const yms = Object.keys(res.months);
        if (yms.length === 0) return;
        yms.forEach(ym => {
          // 復元より先にExcelが読み込まれていた月は、読み込んだ値を優先する
          if (fuelState.monthly[ym]) return;
          const m = res.months[ym];
          fuelState.monthly[ym] = {
            heavyOilGj: m.heavyOilGj, lngGj: m.lngGj,
            heavyOilCostThousandYen: m.heavyOilCostThousandYen, lngCostThousandYen: m.lngCostThousandYen,
            bottles: m.bottles ? normalizeBottles(m.bottles) : null
          };
        });
        yms.forEach(ym => { fuelState.savedSignatures[ym] = monthSignature(res.months[ym].bottles ? Object.assign({}, res.months[ym], { bottles: normalizeBottles(res.months[ym].bottles) }) : res.months[ym]); });
        rebuildAndRender();
      })
      .withFailureHandler(err => {
        console.warn('Failed to restore fuel data from spreadsheet:', err);
      })
      .loadSavedFuelData();
  }

  /**
   * エクスポート用に、スプレッドシート「燃料集約」と同じ形の行データを作る (ローカル開発環境用)
   * @returns {Array<Array>} ヘッダー行を含む2次元配列。データが無い場合は空配列
   */
  function buildExportRows() {
    const yms = dataYms();
    if (yms.length === 0) return [];
    const rows = [SHEET_HEADER];
    yms.forEach(ym => {
      const m = fuelState.monthly[ym];
      rows.push([ym].concat(FUEL_FIELDS.map(f => (typeof m[f] === 'number' ? m[f] : '')))
        .concat(VARIETY_KEYS.map(k => (m.bottles ? (m.bottles[k] || 0) : ''))));
    });
    return rows;
  }

  return {
    init,
    render,
    onExcelFilesChanged,
    onOperationDataChanged,
    updateSyncStatusUI,
    handleSync,
    buildExportRows,
    // テスト用 (DOMを使わないデータ処理)
    listFiscalYears,
    formatYearRanges,
    mergeFuelMonthly,
    monthSignature,
    buildAnnualDatasets,
    buildTotalOnlySeries,
    computeScale
  };
}));
