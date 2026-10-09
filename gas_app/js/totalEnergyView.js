/**
 * gas_app/js/totalEnergyView.js
 * トータルエネルギー画面 (生産量・エネルギー使用量・熱量・原単位・CO2排出量) の制御
 * 読み込み済みのエネルギー計算表から月次データを作り、月別または年度推移のグラフと表を表示する。
 * 表示・保存の対象は、月報PETに年度のシートがある年度 (月報PETが未読込のときは、スプレッドシートから復元した年度) だけ。
 * 画面共通の部品 (通知、数値の整形など) は app.js から init() で受け取る
 * ブラウザ環境およびNode.js環境両対応 (Node.jsでは、DOMを使わないデータ処理の関数だけをテストから利用する)
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./config.js'), require('./services/totalEnergyService.js'), require('./etl/excelReader.js'));
  } else {
    root.TotalEnergyView = factory(root.AppConfig, root.TotalEnergyService, root.ExcelReader);
  }
}(typeof self !== 'undefined' ? self : this, function (AppConfig, TotalEnergyService, ExcelReader) {

  const SOURCES = AppConfig.TOTAL_ENERGY_SOURCES;
  const SHEET_COLUMNS = AppConfig.TOTAL_ENERGY_SHEET_COLUMNS;
  const FIELDS = SHEET_COLUMNS.map(c => c.key);
  const SHEET_NAME = 'トータルエネルギー集約';
  const SHEET_HEADER = ['対象年月'].concat(SHEET_COLUMNS.map(c => c.header));
  const formatYearRanges = AppConfig.formatFiscalYearRanges;

  // 集計表の列 (年月・年度の列に続く列)。extra は、月別では累計の原単位、年度推移では原単位の前年度比
  const MAIN_COLUMNS = [
    { key: 'productionThousandCases', digits: 1 },
    { key: 'heavyOilGj', digits: 0 },
    { key: 'lngGj', digits: 0 },
    { key: 'electricityGj', digits: 0 },
    { key: 'totalGj', digits: 0, strong: true },
    { key: 'crudeOilKl', digits: 1, strong: true },
    { key: 'intensity', digits: 4, strong: true },
    { key: 'extra', digits: 4 },
    { key: 'totalCo2', digits: 1, strong: true },
    { key: 'co2PerKl', digits: 2 },
    { key: 'co2PerThousandCases', digits: 4 }
  ];
  // 参考表 (太陽光発電 無しの想定値) の列
  const SOLAR_COLUMNS = [
    { key: 'solarKwhThousand', digits: 1 },
    { key: 'solarGj', digits: 0 },
    { key: 'noSolarTotalGj', digits: 0 },
    { key: 'noSolarCrudeOilKl', digits: 1 },
    { key: 'noSolarIntensity', digits: 4, strong: true },
    { key: 'intensity', digits: 4 },
    { key: 'noSolarTotalCo2', digits: 1 },
    { key: 'noSolarCo2PerKl', digits: 2 }
  ];

  // =========================================================================
  // データ処理 (DOMを使わない)
  // =========================================================================

  const fiscalYearOf = ym => AppConfig.getFiscalYear(parseInt(ym.slice(0, 4), 10), parseInt(ym.slice(4, 6), 10));
  const isNum = v => typeof v === 'number' && isFinite(v);

  /**
   * 月次データのうち、データのある年度を列挙する
   * (月報PETを読み込んでいないときに、スプレッドシートから復元したデータから表示対象の年度を決めるために使う)
   * @returns {number[]} 年度の昇順
   */
  function listYearsWithData(monthly) {
    const years = new Set();
    Object.keys(monthly || {}).forEach(ym => {
      if (TotalEnergyService.hasMonthData(monthly[ym])) years.add(fiscalYearOf(ym));
    });
    return Array.from(years).sort((a, b) => a - b);
  }

  /**
   * 表示・保存の対象にする年度を決める
   * - 月報PETが読み込まれている場合: 月報PETに年度のシートがある年度
   * - 読み込まれていない場合: 月次データ (復元したデータ) のある年度
   * @param {number[]|null} petFiscalYears 読み込み済みの月報PETにシートがある年度。月報PETが未読込なら null
   * @param {Object} monthly 月次データ
   * @returns {number[]} 年度の昇順
   */
  function resolveTargetYears(petFiscalYears, monthly) {
    if (petFiscalYears) return petFiscalYears.map(Number).sort((a, b) => a - b);
    return listYearsWithData(monthly);
  }

  /**
   * 読み込み済みのエネルギー計算表から、月次データを作り直す (対象年度のみ)
   * 読めた年月の値を取り直し、読めなかった年月と対象年度以外の年月は、既存の値 (スプレッドシートから復元した値を含む) のまま残す
   * @param {Object} existing { [ym]: { productionCases, litersPerCase, heavyOilGj, ... } }
   * @param {Array} energyWorkbooks エネルギー計算表のワークブック
   * @param {number[]} targetYears 対象年度 (resolveTargetYears の戻り値)
   * @returns {Object} { monthly, skippedYears }
   *   skippedYears: 対象年度のうち、シートはあるが必要な行を特定できなかった年度
   */
  function mergeMonthly(existing, energyWorkbooks, targetYears) {
    const monthly = Object.assign({}, existing || {});
    const readYears = new Set();
    const unreadableYears = new Set();
    (energyWorkbooks || []).forEach(wb => {
      (targetYears || []).map(Number).forEach(fy => {
        const res = ExcelReader.parseTotalEnergyTable(wb, fy);
        if (!res.sheetFound) return;
        if (!res.layoutFound) { unreadableYears.add(fy); return; }
        readYears.add(fy);
        Object.keys(res.months).forEach(ym => {
          if (TotalEnergyService.hasMonthData(res.months[ym])) monthly[ym] = res.months[ym];
        });
      });
    });
    return {
      monthly,
      skippedYears: Array.from(unreadableYears).filter(fy => !readYears.has(fy)).sort()
    };
  }

  /**
   * スプレッドシートへ保存する値を比較用の文字列にする (値なしと 0 は区別する)
   */
  function monthSignature(month) {
    if (!month) return '';
    return JSON.stringify(FIELDS.map(f => isNum(month[f]) ? Math.round(month[f] * 1e6) / 1e6 : null));
  }

  /**
   * スプレッドシート「トータルエネルギー集約」へ保存する1行分のデータを作る
   */
  function toSheetRow(ym, month) {
    const row = { yearMonth: ym };
    FIELDS.forEach(f => { row[f] = isNum(month[f]) ? month[f] : null; });
    return row;
  }

  /**
   * 月次データから、対象年度のうちデータのある年度ごとの年間データセットを作る
   * @returns {Object} { [fiscalYear]: dataset }
   */
  function buildAnnualDatasets(monthly, targetYears) {
    const datasets = {};
    listYearsWithData(monthly).filter(fy => !targetYears || targetYears.map(Number).includes(fy)).forEach(fy => {
      datasets[fy] = TotalEnergyService.buildAnnualDataset(fy, monthly);
    });
    return datasets;
  }

  /**
   * グラフと表に並べる点 (月別なら対象年度の各月、年度推移なら各年度の年間値) を作る
   * @param {string} mode 'monthly' | 'yearly'
   * @param {Object} annualDatasets { [fiscalYear]: dataset }
   * @param {number|string} selectedYear 対象年度 (月別のときに使う)
   * @returns {Object} { labels: グラフの横軸, rowLabels: 表の先頭列, points: [総量と比を持つ行 | null (データなし)], total: 年間計の行 | null }
   *   各点の extra は、月別では累計の原単位、年度推移では原単位の前年度比
   */
  function buildSeries(mode, annualDatasets, selectedYear) {
    if (mode === 'yearly') {
      const trend = TotalEnergyService.buildYearlyTrend(annualDatasets);
      return {
        labels: trend.labels,
        rowLabels: trend.labels,
        points: trend.years.map(fy => Object.assign({}, trend.rows[fy], { extra: trend.rows[fy].previousYearRatio.intensity })),
        total: null
      };
    }
    const ds = (annualDatasets || {})[selectedYear];
    if (!ds) return { labels: [], rowLabels: [], points: [], total: null };
    return {
      labels: ds.monthLabels,
      rowLabels: ds.months.map((ym, idx) => `${ds.monthLabels[idx]} (${ym})`),
      points: ds.months.map(ym => ds.rows[ym].hasData ? Object.assign({}, ds.rows[ym], { extra: ds.rows[ym].cumulative.intensity }) : null),
      total: ds.annual ? Object.assign({}, ds.annual, { extra: null }) : null
    };
  }

  /**
   * グラフの目盛り上限を求める。月別は全年度の月別の最大値、年度推移は年間値の最大値から決める (年度を切り替えても目盛りが変わらないようにする)
   * @param {string} mode 'monthly' | 'yearly'
   * @param {Object} annualDatasets { [fiscalYear]: dataset }
   * @param {Object} layout SCALE_CONFIG.autoLayout
   * @param {Object} chartManager getNiceMax / getAxisMaxForPeak を持つオブジェクト
   * @returns {Object} { production, crudeOil, heat, intensity, co2Bar, co2Line }
   */
  function computeScales(mode, annualDatasets, layout, chartManager) {
    const points = [];
    Object.keys(annualDatasets || {}).forEach(fy => {
      const ds = annualDatasets[fy];
      if (mode === 'yearly') {
        if (ds.annual) points.push(ds.annual);
      } else {
        ds.months.forEach(ym => { if (ds.rows[ym].hasData) points.push(ds.rows[ym]); });
      }
    });
    const maxOf = key => points.reduce((max, p) => (isNum(p[key]) && p[key] > max) ? p[key] : max, 0);
    return {
      // 生産量と原油換算量は別々の軸を持つ折れ線。重なりにくいよう、生産量を上部、原油換算量を中ほどに置く
      production: chartManager.getAxisMaxForPeak(maxOf('productionThousandCases'), layout.trendPeakRatio),
      crudeOil: chartManager.getAxisMaxForPeak(maxOf('crudeOilKl'), layout.rateBarPeakRatio),
      heat: chartManager.getNiceMax(maxOf('totalGj')),
      intensity: chartManager.getAxisMaxForPeak(maxOf('intensity'), layout.trendPeakRatio),
      // CO2 は、排出量の棒を中ほど、1klあたりの折れ線を上部に置く
      co2Bar: chartManager.getAxisMaxForPeak(maxOf('totalCo2'), layout.rateBarPeakRatio),
      co2Line: chartManager.getAxisMaxForPeak(maxOf('co2PerKl'), layout.rateLinePeakRatio)
    };
  }

  // =========================================================================
  // 画面制御
  // =========================================================================

  let deps = null;
  let els = {};
  const viewState = {
    monthly: {},          // { [ym]: 月次データ } 対象年度以外の復元データも保持する
    targetYears: [],      // 表示・保存の対象にする年度
    annualDatasets: {},   // { [fiscalYear]: dataset } 対象年度のみ
    selectedYear: null,
    mode: 'monthly',      // 'monthly' (月別) | 'yearly' (年度推移)
    savedSignatures: {}   // スプレッドシートに保存済みの値の署名 { [ym]: string }
  };

  // 表示・保存の対象になる年月 (対象年度で、データがある月)
  const dataYms = () => Object.keys(viewState.monthly)
    .filter(ym => viewState.targetYears.includes(fiscalYearOf(ym)) && TotalEnergyService.hasMonthData(viewState.monthly[ym])).sort();
  const pendingYms = () => dataYms().filter(ym => monthSignature(viewState.monthly[ym]) !== viewState.savedSignatures[ym]);
  const hasGasFunction = name => typeof google !== 'undefined' && google.script && google.script.run && typeof google.script.run[name] === 'function';
  const isGasEnvironment = () => typeof google !== 'undefined' && google.script && google.script.run;

  /**
   * 初期化。app.js の initApp から、画面共通の部品を受け取って呼ばれる
   */
  function init(dependencies) {
    deps = dependencies;
    els = {
      view: document.getElementById('totalEnergyView'),
      dropzone: document.getElementById('totalDropzone'),
      fileInput: document.getElementById('totalFileInput'),
      yearSelector: document.getElementById('totalYearSelector'),
      modePills: document.getElementById('totalModePills'),
      status: document.getElementById('totalDataStatus'),
      note: document.getElementById('totalNote'),
      tableBody: document.getElementById('totalTableBody'),
      solarCard: document.getElementById('totalSolarCard'),
      solarBody: document.getElementById('totalSolarTableBody')
    };
    if (!els.view) return;

    els.yearSelector.addEventListener('change', (e) => {
      if (!e.target.value) return;
      viewState.selectedYear = e.target.value;
      render();
    });
    els.modePills.querySelectorAll('.pill-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        viewState.mode = e.currentTarget.getAttribute('data-mode') === 'yearly' ? 'yearly' : 'monthly';
        els.modePills.querySelectorAll('.pill-btn').forEach(b => b.classList.toggle('active', b === e.currentTarget));
        render();
      });
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
   * Excelが読み込まれたときに呼ばれる。月次データを作り直して表示する
   * @param {boolean} [notify=true] 読込結果を通知するか
   */
  function onExcelFilesChanged(notify) {
    if (!deps) return;
    const wbs = deps.getLoadedWorkbooks();
    if (wbs.energy.length === 0 && wbs.pet.length === 0) return;

    const targetYears = resolveTargetYears(deps.getPetFiscalYears(), viewState.monthly);
    const merged = mergeMonthly(viewState.monthly, wbs.energy, targetYears);
    viewState.monthly = merged.monthly;
    rebuildAndRender();

    if (notify === false) return;
    const years = Object.keys(viewState.annualDatasets).sort();
    if (years.length > 0) {
      deps.showToast(`トータルエネルギーのデータを読み込みました（${formatYearRanges(years)}年度、計 ${dataYms().length} ヶ月）`, 'success');
    } else if (wbs.pet.length === 0) {
      deps.showToast('トータルエネルギーを表示するには、月報PETも投入してください（表示する年度は、月報PETにシートがある年度です）', 'info', 8000);
    } else if (wbs.energy.length === 0) {
      deps.showToast('トータルエネルギーの表示には、エネルギー計算表の読み込みが必要です', 'info', 8000);
    } else {
      deps.showToast('エネルギー計算表から、月報PETにシートがある年度のデータを読み取れませんでした', 'warning', 12000);
    }
    if (merged.skippedYears.length > 0) {
      deps.showToast(`エネルギー計算表の ${formatYearRanges(merged.skippedYears)}年度 は、必要な行を特定できないため表示できません`, 'warning', 12000);
    }
  }

  function rebuildAndRender() {
    viewState.targetYears = resolveTargetYears(deps.getPetFiscalYears(), viewState.monthly);
    viewState.annualDatasets = buildAnnualDatasets(viewState.monthly, viewState.targetYears);
    const years = Object.keys(viewState.annualDatasets).sort().reverse();
    if (!viewState.selectedYear || !viewState.annualDatasets[viewState.selectedYear]) {
      viewState.selectedYear = years.length > 0 ? years[0] : null;
    }
    updateBadges();
    if (deps.isActive()) {
      render();
      updateSyncStatusUI();
    }
  }

  function updateBadges() {
    const wbs = deps.getLoadedWorkbooks();
    const toggle = (id, on) => { const el = document.getElementById(id); if (el) el.classList.toggle('detected', on); };
    toggle('totalTagEnergy', wbs.energy.length > 0 || dataYms().length > 0);
    toggle('totalTagPet', wbs.pet.length > 0);
  }

  const DASH_HTML = '<span style="color:var(--text-light);font-weight:normal;">---</span>';
  const formatPercent = v => isNum(v) ? `${(v * 100).toFixed(1)}%` : '---';

  /**
   * トータルエネルギー画面を描画する (画面が表示されているときに呼ぶ)
   */
  function render() {
    if (!deps || !els.view) return;
    const years = Object.keys(viewState.annualDatasets).sort().reverse();

    // 年度セレクター
    els.yearSelector.innerHTML = years.length === 0
      ? '<option value="">（データ未読込）</option>'
      : years.map(y => `<option value="${y}">${y}年度 (${y}/04〜${parseInt(y, 10) + 1}/03)</option>`).join('');
    if (viewState.selectedYear) els.yearSelector.value = viewState.selectedYear;

    const ds = viewState.selectedYear ? viewState.annualDatasets[viewState.selectedYear] : null;
    if (!ds) {
      // エネルギー計算表だけが読み込まれている場合は、月報PETの投入を案内する
      const wbs = deps.getLoadedWorkbooks();
      const guide = (wbs.energy.length > 0 && wbs.pet.length === 0)
        ? '月報PETを投入すると表示されます。表示する年度は、月報PETにシートがある年度です。'
        : '';
      els.status.textContent = '';
      els.note.style.display = guide ? 'block' : 'none';
      els.note.innerHTML = guide ? `<div>${guide}</div>` : '';
      return;
    }
    els.note.style.display = 'none';

    const isYearly = viewState.mode === 'yearly';
    const fmt = (v, digits) => isNum(v) ? deps.formatNumber(v, digits) : '---';

    // KPIカード (対象年度の年間値と前年度比)
    const annual = ds.annual;
    const prevRatio = TotalEnergyService.compareWithPreviousYear(ds, viewState.annualDatasets[ds.fiscalYear - 1] || null);
    deps.setElemText('totalKpiProduction', fmt(annual.productionThousandCases, 0));
    deps.setElemText('totalKpiProductionRatio', formatPercent(prevRatio.productionCases));
    deps.setElemText('totalKpiCrudeOil', fmt(annual.crudeOilKl, 0));
    deps.setElemText('totalKpiTotalGj', fmt(annual.totalGj, 0));
    deps.setElemText('totalKpiCrudeOilRatio', formatPercent(prevRatio.crudeOilKl));
    deps.setElemText('totalKpiIntensity', fmt(annual.intensity, 4));
    deps.setElemText('totalKpiIntensityRatio', formatPercent(prevRatio.intensity));
    deps.setElemText('totalKpiCo2', fmt(annual.totalCo2, 0));
    deps.setElemText('totalKpiCo2PerKl', fmt(annual.co2PerKl, 2));
    deps.setElemText('totalKpiCo2PerKlRatio', formatPercent(prevRatio.co2PerKl));

    els.status.textContent = isYearly
      ? `年度推移: ${years.length}年度 (${formatYearRanges(years)}年度)`
      : `読込済: ${ds.availableMonthsCount}ヶ月 (${ds.fiscalYear}年度)`;

    // グラフ
    const series = buildSeries(viewState.mode, viewState.annualDatasets, viewState.selectedYear);
    const scales = computeScales(viewState.mode, viewState.annualDatasets, deps.getAutoLayout(), ChartManager);
    const valuesOf = key => series.points.map(p => (p && isNum(p[key])) ? p[key] : null);

    ChartManager.renderComboChart('totalProductionChart', {
      labels: series.labels,
      lines: [
        { label: '生産数量 (千ケース)', data: valuesOf('productionThousandCases'), color: '#2563eb', unit: '千ケース', digits: 1, axis: 'y' },
        { label: 'エネルギー使用量 (原油換算kl)', data: valuesOf('crudeOilKl'), color: '#dc2626', unit: 'kl', digits: 1, axis: 'y1' }
      ],
      axes: { y: { title: '千ケース', max: scales.production }, y1: { title: '原油換算 kl', max: scales.crudeOil } }
    });
    ChartManager.renderComboChart('totalHeatChart', {
      labels: series.labels,
      bars: SOURCES.map(s => ({ label: s.name, data: valuesOf(s.gjKey), color: s.color, unit: 'GJ', digits: 0 })),
      axes: { y: { title: '熱量 GJ', max: scales.heat } }
    });
    ChartManager.renderComboChart('totalIntensityChart', {
      labels: series.labels,
      lines: [{ label: '原単位 (kl/千ケース)', data: valuesOf('intensity'), color: '#7c3aed', unit: 'kl/千ケース', digits: 4, axis: 'y' }],
      axes: { y: { title: 'kl/千ケース', max: scales.intensity, digits: 3 } }
    });
    ChartManager.renderComboChart('totalCo2Chart', {
      labels: series.labels,
      bars: SOURCES.map(s => ({ label: s.name, data: valuesOf(s.co2Key), color: s.color, unit: 't-CO2', digits: 1 })),
      lines: [{ label: '生産液量1klあたり (kg-CO2/kl)', data: valuesOf('co2PerKl'), color: '#0f172a', unit: 'kg-CO2/kl', digits: 2, axis: 'y1' }],
      axes: { y: { title: 't-CO2', max: scales.co2Bar }, y1: { title: 'kg-CO2/kl', max: scales.co2Line, digits: 1 } }
    });

    // 集計表
    deps.setElemText('totalTableTitle', isYearly ? '年度推移集計表 (各年度の年間値)' : `月別実績集計表 (${ds.fiscalYear}年度)`);
    deps.setElemText('totalThLabel', isYearly ? '年度' : '年月');
    deps.setElemText('totalThExtra', isYearly ? '原単位 前年度比' : '原単位 累計');
    deps.setElemText('totalSolarThLabel', isYearly ? '年度' : '年月');
    const cellHtml = (point, col) => {
      const v = point ? point[col.key] : null;
      if (!isNum(v)) return `<td>${DASH_HTML}</td>`;
      const text = (col.key === 'extra' && isYearly) ? formatPercent(v) : deps.formatNumber(v, col.digits);
      return `<td${col.strong ? ' style="font-weight: 700; color: var(--primary);"' : ''}>${text}</td>`;
    };
    const tableHtml = (columns) => {
      let html = '';
      series.points.forEach((point, idx) => {
        html += `<tr><td style="font-weight: 600;">${series.rowLabels[idx]}</td>${columns.map(col => cellHtml(point, col)).join('')}</tr>`;
      });
      if (series.total) {
        html += `<tr class="total-row"><td>年間計</td>${columns.map(col => cellHtml(series.total, col)).join('')}</tr>`;
      }
      return html;
    };
    els.tableBody.innerHTML = tableHtml(MAIN_COLUMNS);

    // 参考表: 太陽光発電 無しの想定値 (太陽光のデータがある場合のみ)
    const hasSolar = series.points.some(p => p && p.hasSolar);
    els.solarCard.style.display = hasSolar ? '' : 'none';
    els.solarBody.innerHTML = hasSolar ? tableHtml(SOLAR_COLUMNS) : '';
  }

  // =========================================================================
  // スプレッドシートへの保存・復元・エクスポート
  // =========================================================================

  /**
   * ヘッダーの同期状況表示と反映ボタンを、トータルエネルギーのデータに合わせて更新する (この画面を表示中に呼ばれる)
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
      textElem.textContent = `トータル 読込済: 計 ${total}ヶ月 (未反映: ${pending}ヶ月 / 反映済: ${total - pending}ヶ月)`;
      syncBtn.textContent = `☁️ スプレッドシートへ反映 (${pending}ヶ月分)`;
    } else {
      badge.classList.add('all-synced');
      textElem.textContent = `トータル 読込済: 計 ${total}ヶ月 (全 ${total}ヶ月 反映済み)`;
      syncBtn.textContent = '☁️ スプレッドシートへ反映 (全月反映済)';
    }
  }

  /**
   * 月次データをスプレッドシートへ反映する (未反映の月のみ。全月反映済みなら確認のうえ全月)
   */
  async function handleSync() {
    const all = dataYms();
    if (all.length === 0) {
      deps.showToast('反映対象のトータルエネルギーのデータがありません', 'error');
      return;
    }
    let targets = pendingYms();
    if (targets.length === 0) {
      if (!confirm(`トータルエネルギーのデータ（計 ${all.length} ヶ月分）は既にスプレッドシートへ反映済みです。\n全月を再反映（上書き）しますか？`)) return;
      targets = all;
    }
    if (isGasEnvironment() && !hasGasFunction('saveTotalEnergyMonthlyData')) {
      deps.showToast('トータルエネルギーのデータの保存には、新しい Code.gs のデプロイが必要です', 'error');
      return;
    }

    const syncBtn = document.getElementById('syncBtn');
    if (syncBtn) syncBtn.disabled = true;
    deps.showLoading(`☁️ トータルエネルギーのデータをスプレッドシートへ反映中 (計 ${targets.length} ヶ月分)`);
    try {
      const rows = targets.map(ym => toSheetRow(ym, viewState.monthly[ym]));
      await new Promise((resolve, reject) => {
        if (isGasEnvironment()) {
          google.script.run
            .withSuccessHandler(res => (res && res.success) ? resolve(res) : reject(new Error((res && res.error) || '保存に失敗しました')))
            .withFailureHandler(err => reject(new Error(err.message || 'GAS呼び出しに失敗しました')))
            .saveTotalEnergyMonthlyData(rows);
        } else {
          // ローカル開発環境 (保存はせず、成功として扱う)
          setTimeout(() => resolve({ success: true, mocked: true }), 300);
        }
      });
      targets.forEach(ym => { viewState.savedSignatures[ym] = monthSignature(viewState.monthly[ym]); });
      deps.showToast(`トータルエネルギーのデータをスプレッドシートへ反映しました（${targets.length} ヶ月分）`, 'success');
    } catch (err) {
      console.error('Total energy sync error:', err);
      deps.showToast(`トータルエネルギーのデータの同期エラー: ${err.message}`, 'error');
    } finally {
      deps.hideLoading();
      if (deps.isActive()) updateSyncStatusUI();
    }
  }

  /**
   * 起動時に、スプレッドシートに保存済みのデータを復元する
   */
  function restoreFromSpreadsheet() {
    // 古い Code.gs (トータルエネルギーの関数が無い) と組み合わさった場合は、復元を行わない
    if (!hasGasFunction('loadSavedTotalEnergyData')) return;
    google.script.run
      .withSuccessHandler(res => {
        if (!res || !res.success || !res.months) return;
        const yms = Object.keys(res.months);
        if (yms.length === 0) return;
        yms.forEach(ym => {
          const restored = {};
          FIELDS.forEach(f => { restored[f] = isNum(res.months[ym][f]) ? res.months[ym][f] : null; });
          viewState.savedSignatures[ym] = monthSignature(restored);
          // 復元より先にExcelが読み込まれていた月は、読み込んだ値を優先する
          if (!viewState.monthly[ym]) viewState.monthly[ym] = restored;
        });
        rebuildAndRender();
      })
      .withFailureHandler(err => {
        console.warn('Failed to restore total energy data from spreadsheet:', err);
      })
      .loadSavedTotalEnergyData();
  }

  /**
   * エクスポート用に、スプレッドシート「トータルエネルギー集約」と同じ形の行データを作る (ローカル開発環境用)
   * @returns {Array<Array>} ヘッダー行を含む2次元配列。データが無い場合は空配列
   */
  function buildExportRows() {
    const yms = dataYms();
    if (yms.length === 0) return [];
    const rows = [SHEET_HEADER];
    yms.forEach(ym => {
      const m = viewState.monthly[ym];
      rows.push([ym].concat(FIELDS.map(f => (isNum(m[f]) ? m[f] : ''))));
    });
    return rows;
  }

  return {
    SHEET_NAME,
    init,
    render,
    onExcelFilesChanged,
    updateSyncStatusUI,
    handleSync,
    buildExportRows,
    // テスト用 (DOMを使わないデータ処理)
    MAIN_COLUMNS,
    SOLAR_COLUMNS,
    listYearsWithData,
    resolveTargetYears,
    mergeMonthly,
    monthSignature,
    toSheetRow,
    buildAnnualDatasets,
    buildSeries,
    computeScales
  };
}));
