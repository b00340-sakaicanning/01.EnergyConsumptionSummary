/**
 * gas_app/js/components/charts.js
 * Chart.js を用いたインタラクティブグラフ描画コンポーネント
 * ライトテーマ対応 ＆ 単月・年間月別・品種別集約グラフサポート
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../config.js'));
  } else {
    root.ChartManager = factory(root.AppConfig);
  }
}(typeof self !== 'undefined' ? self : this, function (AppConfig) {

  // チャートインスタンス管理
  let dailyChartInstance = null;
  let categoryChartInstance = null;
  // 品種別の年間グラフ2種は、電力と燃料エネルギーの両方の画面で使うため、canvas ごとにインスタンスを持つ
  const annualStackedChartInstances = {};
  const annualTrendChartInstances = {};
  let annualEquipTrendChartInstance = null;
  let annualEquipDoughnutChartInstance = null;

  // 品種カラーパレット (Excel原紙・月別電力使用量集約グラフ表示(総電力 2024).xlsx 準拠)
  // 色そのものは AppConfig.VARIETY_GROUPS[].color で定義し、塗りはその 85% 不透明色とする
  const VARIETY_COLORS = {};
  AppConfig.VARIETY_GROUPS.forEach(g => {
    VARIETY_COLORS[g.key] = { bg: hexToRgba(g.color, 0.85), border: g.color };
  });

  // 工程大分類5種 (color: ドーナツ内側リング・設備詳細の棒、stackColor: 工程別積み上げ棒)
  const MAIN_PROCESSES = [
    { name: 'ユーティリティ', color: '#0284c7', stackColor: 'rgba(14, 165, 233, 0.8)' },
    { name: '調合抽出', color: '#7c3aed', stackColor: 'rgba(124, 58, 237, 0.8)' },
    { name: '供給', color: '#f59e0b', stackColor: 'rgba(245, 158, 11, 0.8)' },
    { name: '充填', color: '#059669', stackColor: 'rgba(5, 150, 105, 0.8)' },
    { name: '包装', color: '#ea580c', stackColor: 'rgba(234, 88, 12, 0.8)' }
  ];

  // ユーティリティ内訳5種 (ドーナツ外側リング・設備詳細の棒)
  const UTILITY_BREAKDOWN = [
    { name: 'コンプレッサー', color: '#38bdf8' },
    { name: 'ボイラー', color: '#0284c7' },
    { name: '純水装置', color: '#0ea5e9' },
    { name: '排水処理', color: '#64748b' },
    { name: 'チラー', color: '#0891b2' }
  ];

  const GRID_COLOR = 'rgba(226, 232, 240, 0.8)';
  const TEXT_COLOR = '#64748b';

  /**
   * キリの良い上限値を算出するユーティリティ (1, 2, 2.5, 5, 10系)
   */
  function getNiceMax(val) {
    if (!val || val <= 0 || !isFinite(val)) return undefined;
    const target = val * 1.08;
    const exponent = Math.floor(Math.log10(target));
    const fraction = target / Math.pow(10, exponent);
    let niceFraction;
    if (fraction <= 1.0) niceFraction = 1.0;
    else if (fraction <= 1.2) niceFraction = 1.2;
    else if (fraction <= 1.5) niceFraction = 1.5;
    else if (fraction <= 2.0) niceFraction = 2.0;
    else if (fraction <= 2.5) niceFraction = 2.5;
    else if (fraction <= 3.0) niceFraction = 3.0;
    else if (fraction <= 4.0) niceFraction = 4.0;
    else if (fraction <= 5.0) niceFraction = 5.0;
    else if (fraction <= 6.0) niceFraction = 6.0;
    else if (fraction <= 8.0) niceFraction = 8.0;
    else niceFraction = 10.0;
    return parseFloat((niceFraction * Math.pow(10, exponent)).toPrecision(4));
  }

  // getAxisMaxForPeak の切り上げ候補 (仮数)。getNiceMax より細かく刻み、狙った高さからのずれを小さくする (隣り合う候補の比は最大1.25)
  // Chart.js の目盛り間隔 (1・2・5系で最大10区間) で割り切れる値だけを並べている。それ以外を入れると最上段の目盛りだけ間隔が詰まる
  const FINE_NICE_STEPS = [1, 1.2, 1.4, 1.6, 1.8, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8, 9, 10];

  /**
   * データの最大値が軸の高さの指定割合に来るような、キリの良い軸上限を算出する
   * @param {number} peakValue データの最大値
   * @param {number} peakRatio 最大値を置く高さ (0〜1。例: 0.6 なら軸の60%の位置)
   * @returns {number|undefined} 軸上限 (算出できない場合は undefined)
   */
  function getAxisMaxForPeak(peakValue, peakRatio) {
    if (!peakValue || peakValue <= 0 || !isFinite(peakValue)) return undefined;
    const ratio = peakRatio > 0 && peakRatio <= 1 ? peakRatio : 1;
    const target = peakValue / ratio;
    const exponent = Math.floor(Math.log10(target));
    const fraction = target / Math.pow(10, exponent);
    // 浮動小数点の誤差で、ちょうど候補に乗る値が1段上へ切り上がらないようにする
    const niceFraction = FINE_NICE_STEPS.find(step => step >= fraction - 1e-9) || 10;
    return parseFloat((niceFraction * Math.pow(10, exponent)).toPrecision(4));
  }

  /**
   * '#rrggbb' を 'rgba(r, g, b, alpha)' に変換する
   */
  function hexToRgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  /**
   * 積み上げ棒グラフの系列定義を生成する
   */
  function buildStackedBar(label, data, backgroundColor, stack) {
    return { type: 'bar', label, data, backgroundColor, borderRadius: 2, stack, order: 1 };
  }

  /**
   * 【年間】月別電力使用量集約グラフ (8品種積み上げバー ＋ 月計折れ線)
   * @param {string} canvasId 
   * @param {Object} annualMetricData { months: { '202404': { monthlyTotal, varieties: {} } }, ... }
   * @param {Object} metricInfo { name: '電力量', unit: 'kWh' }
   * @param {Array} monthLabels ['4月', '5月', ... '3月']
   * @param {Array} monthsYm ['202404', ... '202503']
   * @param {Object} [scaleOptions] { max, barMax, lineMax }
   */
  function renderAnnualStackedBarChart(canvasId, annualMetricData, metricInfo, monthLabels, monthsYm, scaleOptions) {
    if (typeof Chart === 'undefined') return;
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    if (annualStackedChartInstances[canvasId]) {
      annualStackedChartInstances[canvasId].destroy();
    }

    const varietyKeys = AppConfig.VARIETY_KEYS;

    // 原単位・平均系指標かどうかの判定 (単位本、単位時間)
    // 指標定義に isRate があればそれを使う (燃料エネルギーの指標)。無ければ電力の指標キーで判定する
    const isRateMetric = metricInfo.isRate !== undefined ? metricInfo.isRate : AppConfig.RATE_METRIC_KEYS.includes(metricInfo.key);

    // 1. 各品種のバーデータセット
    const datasets = varietyKeys.map(vk => {
      const color = VARIETY_COLORS[vk] || { bg: '#94a3b8', border: '#64748b' };
      const data = monthsYm.map(ym => {
        const mObj = annualMetricData.months[ym];
        if (!mObj || mObj.hasData === false || mObj.monthlyTotal === null) return null;
        return mObj.varieties ? (mObj.varieties[vk] || 0) : 0;
      });

      const ds = {
        type: 'bar',
        label: vk,
        data: data,
        backgroundColor: color.bg,
        borderColor: color.border,
        borderWidth: 1,
        borderRadius: 2,
        yAxisID: 'y'
      };

      // 総量指標の場合のみ積み上げスタックキーを設定
      if (!isRateMetric) {
        ds.stack = 'varietyStack';
      }

      return ds;
    });

    // 2. 月計折れ線データセット
    // 総量指標（電力量・操業時間・生産本数・電力コスト）の場合は、
    // 積み上げ合計＝月計となるため月計折れ線は非表示（除外）。
    // 原単位指標（単位本・単位時間）の場合のみ、全体平均としての折れ線グラフを右軸（y1）に表示。
    let monthlyTotalData = [];
    if (isRateMetric) {
      monthlyTotalData = monthsYm.map(ym => {
        const mObj = annualMetricData.months[ym];
        if (!mObj || mObj.hasData === false || mObj.monthlyTotal === null) return null;
        return mObj.monthlyTotal !== undefined ? mObj.monthlyTotal : null;
      });

      datasets.push({
        type: 'line',
        label: '全体平均 (月計)',
        data: monthlyTotalData,
        borderColor: '#0f172a',
        backgroundColor: '#0f172a',
        borderWidth: 2.5,
        pointRadius: 4,
        pointHoverRadius: 6,
        fill: false,
        tension: 0,
        yAxisID: 'y1',
        order: 0
      });
    }

    // スケール定義の動的構築
    let scalesConfig = {};

    if (isRateMetric) {
      // 原単位（横並び集合棒グラフ ＋ 右軸月計折れ線グラフ：重なり防止対応）
      let yMax = scaleOptions && scaleOptions.barMax > 0 ? scaleOptions.barMax : undefined;
      let y1Max = scaleOptions && scaleOptions.lineMax > 0 ? scaleOptions.lineMax : undefined;

      // オプション未指定時の自動スケール
      if (!yMax) {
        let maxBar = 0;
        datasets.forEach(ds => {
          if (ds.type === 'bar') {
            ds.data.forEach(v => {
              if (v !== null && v > maxBar) maxBar = v;
            });
          }
        });
        yMax = maxBar > 0 ? maxBar * 1.85 : undefined;
      }

      scalesConfig = {
        x: {
          stacked: false,
          grid: { display: false },
          ticks: { color: TEXT_COLOR, font: { weight: '600' } }
        },
        y: {
          position: 'left',
          stacked: false,
          beginAtZero: true,
          max: yMax,
          grid: { color: GRID_COLOR },
          ticks: {
            color: TEXT_COLOR,
            callback: function (val) {
              return val >= 10000 ? (val / 1000).toLocaleString() + 'k' : (metricInfo.digits ? val.toFixed(metricInfo.digits) : val.toLocaleString());
            }
          },
          title: {
            display: true,
            text: `[左軸] 各品種 (${metricInfo.unit})`,
            color: TEXT_COLOR,
            font: { weight: '600' }
          }
        },
        y1: {
          position: 'right',
          stacked: false,
          beginAtZero: true,
          max: y1Max,
          grid: { drawOnChartArea: false }, // 右軸のグリッド線は非表示にして見やすく
          ticks: {
            color: '#0f172a',
            callback: function (val) {
              return metricInfo.digits ? val.toFixed(metricInfo.digits) : val.toLocaleString();
            }
          },
          title: {
            display: true,
            text: `[右軸] 全体平均 (${metricInfo.unit})`,
            color: '#0f172a',
            font: { weight: '700' }
          }
        }
      };
    } else {
      // 総量指標（積み上げ棒グラフのみ）
      const totalMax = scaleOptions && scaleOptions.max > 0 ? scaleOptions.max : undefined;

      scalesConfig = {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { color: TEXT_COLOR, font: { weight: '600' } }
        },
        y: {
          stacked: true,
          max: totalMax,
          grid: { color: GRID_COLOR },
          ticks: {
            color: TEXT_COLOR,
            callback: function (val) {
              return val >= 10000 ? (val / 1000).toLocaleString() + 'k' : val.toLocaleString();
            }
          },
          title: {
            display: true,
            text: `${metricInfo.name} (${metricInfo.unit})`,
            color: TEXT_COLOR,
            font: { weight: '600' }
          }
        }
      };
    }

    annualStackedChartInstances[canvasId] = new Chart(ctx, {
      data: {
        labels: monthLabels,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              boxWidth: 12,
              font: { family: 'Outfit, sans-serif', size: 11, weight: '600' },
              color: '#334155'
            }
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            titleFont: { size: 12, weight: '700' },
            bodyFont: { size: 11 },
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: function (context) {
                const val = context.parsed.y !== null && context.parsed.y !== undefined
                  ? (metricInfo.digits ? Number(context.parsed.y).toFixed(metricInfo.digits) : context.parsed.y.toLocaleString())
                  : 0;
                return `${context.dataset.label}: ${val} ${metricInfo.unit || ''}`;
              }
            }
          }
        },
        scales: scalesConfig
      }
    });
  }

  /**
   * 【年間】月別電力推移グラフ (折れ線グラフ)
   */
  function renderAnnualTrendChart(canvasId, annualMetricData, metricInfo, monthLabels, monthsYm, scaleOptions) {
    if (typeof Chart === 'undefined') return;
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    if (annualTrendChartInstances[canvasId]) {
      annualTrendChartInstances[canvasId].destroy();
    }

    const varietyKeys = AppConfig.VARIETY_KEYS;

    const datasets = varietyKeys.map(vk => {
      const color = VARIETY_COLORS[vk] || { bg: '#94a3b8', border: '#64748b' };
      const data = monthsYm.map(ym => {
        const mObj = annualMetricData.months[ym];
        if (!mObj || mObj.hasData === false || mObj.monthlyTotal === null) return null;
        return mObj.varieties ? (mObj.varieties[vk] || 0) : 0;
      });

      return {
        label: vk,
        data: data,
        borderColor: color.border,
        backgroundColor: color.bg,
        borderWidth: 2,
        pointRadius: 3,
        fill: false,
        tension: 0,
        spanGaps: false
      };
    });

    // 品種単体の値を描くため、専用の上限 (trendMax) を優先する。無ければ集約グラフと同じ上限を使う
    const trendMax = scaleOptions && scaleOptions.trendMax > 0 ? scaleOptions.trendMax
      : (scaleOptions && scaleOptions.max > 0 ? scaleOptions.max : undefined);

    annualTrendChartInstances[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: monthLabels,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            labels: { boxWidth: 10, font: { size: 11, weight: '600' }, color: '#334155' }
          },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                const val = ctx.parsed.y !== null && ctx.parsed.y !== undefined
                  ? (metricInfo.digits ? Number(ctx.parsed.y).toFixed(metricInfo.digits) : ctx.parsed.y.toLocaleString())
                  : 0;
                return `${ctx.dataset.label}: ${val} ${metricInfo.unit || ''}`;
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: TEXT_COLOR } },
          y: {
            max: trendMax,
            grid: { color: GRID_COLOR },
            ticks: {
              color: TEXT_COLOR,
              callback: function (val) {
                return val >= 10000 ? (val / 1000).toLocaleString() + 'k' : (metricInfo.digits ? val.toFixed(metricInfo.digits) : val.toLocaleString());
              }
            }
          }
        }
      }
    });
  }

  /**
   * 【単月】日別電力推移チャート (ライトテーマ版: 案A ユーティリティ統合)
   * @param {string} canvasId 
   * @param {Array} dailyTotals 
   * @param {Object} [scaleOptions] { max }
   */
  function renderDailyChart(canvasId, dailyTotals, scaleOptions) {
    if (typeof Chart === 'undefined') return;
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    if (dailyChartInstance) dailyChartInstance.destroy();
    if (!dailyTotals || !Array.isArray(dailyTotals) || dailyTotals.length === 0) return;

    const labels = dailyTotals.map(d => `${d.day}日`);
    const totalData = dailyTotals.map(d => d.categories['総電力'] || 0);

    const dailyMax = scaleOptions && scaleOptions.max > 0 ? scaleOptions.max : undefined;

    dailyChartInstance = new Chart(ctx, {
      data: {
        labels: labels,
        datasets: [
          {
            type: 'line',
            label: '総電力 (kWh)',
            data: totalData,
            borderColor: '#0284c7',
            backgroundColor: 'rgba(2, 132, 199, 0.08)',
            borderWidth: 2.2,
            pointRadius: 3,
            pointBackgroundColor: '#0284c7',
            fill: false,
            tension: 0,
            order: 0
          },
          // 工程大分類5種の積み上げ棒
          ...MAIN_PROCESSES.map(p => buildStackedBar(
            `${p.name} (kWh)`,
            dailyTotals.map(d => d.categories[p.name] || 0),
            p.stackColor,
            'dailyStack'
          ))
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'top',
            labels: { color: '#334155', font: { weight: '600', size: 11 } }
          },
          tooltip: {
            callbacks: {
              label: function(c) {
                return ` ${c.dataset.label}: ${Math.round(c.raw || 0).toLocaleString()} kWh`;
              }
            }
          }
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: { color: TEXT_COLOR }
          },
          y: {
            stacked: true,
            max: dailyMax,
            grid: { color: GRID_COLOR },
            ticks: {
              color: TEXT_COLOR,
              callback: (v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v
            }
          }
        }
      }
    });
  }

  /**
   * 工程別電力比率の多層ドーナツチャート設定を生成する
   * 内側リング: 工程大分類5種、外側リング: ユーティリティ内訳5種 (他工程の分は透明スペーサー)
   * @param {Function} getValue カテゴリ名から電力量 (kWh) を返す関数
   * @param {string} breakdownTooltipLabel 外側リングのツールチップ見出し
   */
  function buildProcessDoughnutConfig(getValue, breakdownTooltipLabel) {
    // 1. 内側メイン工程 (ユーティリティ、調合抽出、供給、充填、包装)
    const mainKeys = MAIN_PROCESSES.map(p => p.name);
    const mainColors = MAIN_PROCESSES.map(p => p.color);
    const mainData = mainKeys.map(getValue);
    const mainTotalSum = mainData.reduce((a, b) => a + b, 0);

    // 2. 外側ユーティリティ内訳 (コンプレッサー、ボイラー、純水装置、排水処理、チラー) + 他工程透明スペーサー
    const uBreakdownKeys = UTILITY_BREAKDOWN.map(p => p.name);
    const uBreakdownColors = UTILITY_BREAKDOWN.map(p => p.color);
    const uTotal = getValue('ユーティリティ');
    const otherProcessKeys = mainKeys.filter(k => k !== 'ユーティリティ');

    // 外側リングの全データ: ユーティリティ内訳5項目 + 残り4工程分(透明)
    const outerData = [...uBreakdownKeys.map(getValue), ...otherProcessKeys.map(getValue)];
    const outerColors = [...uBreakdownColors, ...otherProcessKeys.map(() => 'transparent')];
    const outerBorderColors = [...uBreakdownKeys.map(() => '#ffffff'), ...otherProcessKeys.map(() => 'transparent')];

    return {
      type: 'doughnut',
      data: {
        datasets: [
          // datasets[0]: 外側リング (ユーティリティ内訳の円弧)
          {
            label: 'ユーティリティ内訳',
            data: outerData,
            backgroundColor: outerColors,
            borderColor: outerBorderColors,
            borderWidth: 2,
            weight: 0.9
          },
          // datasets[1]: 内側リング (メイン5工程)
          {
            label: '工程大分類',
            data: mainData,
            backgroundColor: mainColors,
            borderColor: '#ffffff',
            borderWidth: 2,
            weight: 1.2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: '#334155',
              font: { weight: '600', size: 11 },
              generateLabels: function() {
                // メイン工程5件 + ユーティリティ内訳5件の凡例
                const labels = [];
                mainKeys.forEach((name, i) => {
                  labels.push({
                    text: `${name}`,
                    fillStyle: mainColors[i],
                    strokeStyle: mainColors[i],
                    lineWidth: 1,
                    hidden: false,
                    index: i
                  });
                });
                uBreakdownKeys.forEach((name, i) => {
                  labels.push({
                    text: ` └ ${name}`,
                    fillStyle: uBreakdownColors[i],
                    strokeStyle: uBreakdownColors[i],
                    lineWidth: 1,
                    hidden: false,
                    index: 10 + i
                  });
                });
                return labels;
              }
            }
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const dsIndex = context.datasetIndex;
                const dataIndex = context.dataIndex;

                if (dsIndex === 0) {
                  // 外側リング (ユーティリティ内訳)
                  if (dataIndex < uBreakdownKeys.length) {
                    const name = uBreakdownKeys[dataIndex];
                    const val = context.raw || 0;
                    const pct = uTotal > 0 ? ((val / uTotal) * 100).toFixed(1) : '0';
                    return ` [${breakdownTooltipLabel}] ${name}: ${Math.round(val).toLocaleString()} kWh (${pct}%)`;
                  }
                  return null; // 透明部分はツールチップ非表示
                } else {
                  // 内側リング (メイン工程)
                  const name = mainKeys[dataIndex];
                  const val = context.raw || 0;
                  const pct = mainTotalSum > 0 ? ((val / mainTotalSum) * 100).toFixed(1) : '0';
                  return ` ${name}: ${Math.round(val).toLocaleString()} kWh (${pct}%)`;
                }
              }
            }
          }
        },
        cutout: '58%'
      }
    };
  }

  /**
   * 【単月】工程別電力比率多層ドーナツチャート (ユーティリティ外側円弧内訳付き)
   */
  function renderCategoryDoughnutChart(canvasId, categoryTotals) {
    if (typeof Chart === 'undefined') return;
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    if (categoryChartInstance) categoryChartInstance.destroy();
    if (!categoryTotals || typeof categoryTotals !== 'object') return;

    categoryChartInstance = new Chart(ctx, buildProcessDoughnutConfig(
      name => (categoryTotals[name] ? categoryTotals[name].grandTotal : 0),
      'ユーティリティ内訳'
    ));
  }

  /**
   * 【年間設備別】月別設備別・工程別電力推移チャート
   */
  function renderAnnualEquipmentTrendChart(canvasId, equipmentSummary, viewMode = 'utilityGroup', scaleOptions) {
    if (typeof Chart === 'undefined') return;
    const ctx = document.getElementById(canvasId);
    if (!ctx || !equipmentSummary) return;

    if (annualEquipTrendChartInstance) annualEquipTrendChartInstance.destroy();

    const monthLabels = AppConfig.FISCAL_MONTH_LABELS.slice();
    const cats = equipmentSummary.categories || {};
    const totalData = cats['総電力'] ? cats['総電力'].monthly : [];

    let datasets = [];

    // 1. 総電力 (折れ線ライン)
    datasets.push({
      type: 'line',
      label: '総電力 (kWh)',
      data: totalData,
      borderColor: '#0284c7',
      backgroundColor: 'rgba(2, 132, 199, 0.08)',
      borderWidth: 2.2,
      pointRadius: 4,
      pointBackgroundColor: '#0284c7',
      tension: 0,
      order: 0
    });

    const monthlyOf = name => (cats[name] ? cats[name].monthly : []);

    if (viewMode === 'utilityGroup') {
      // ユーティリティ統合モード (工程大分類5種)
      datasets.push(...MAIN_PROCESSES.map(p => buildStackedBar(`${p.name} (kWh)`, monthlyOf(p.name), p.stackColor, 'equipStack')));
    } else {
      // 設備詳細内訳モード (ユーティリティ内訳5種 + ユーティリティ以外の工程4種)
      const detailSeries = [...UTILITY_BREAKDOWN, ...MAIN_PROCESSES.filter(p => p.name !== 'ユーティリティ')];
      datasets.push(...detailSeries.map(p => buildStackedBar(p.name, monthlyOf(p.name), p.color, 'equipStack')));
    }

    annualEquipTrendChartInstance = new Chart(ctx, {
      data: {
        labels: monthLabels,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'top',
            labels: { color: '#334155', font: { weight: '600', size: 11 } }
          },
          tooltip: {
            callbacks: {
              label: function(c) {
                return ` ${c.dataset.label}: ${Math.round(c.raw || 0).toLocaleString()} kWh`;
              }
            }
          }
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: { color: TEXT_COLOR }
          },
          y: {
            stacked: true,
            max: scaleOptions && scaleOptions.max > 0 ? scaleOptions.max : undefined,
            grid: { color: GRID_COLOR },
            ticks: {
              color: TEXT_COLOR,
              callback: (v) => `${(v / 1000).toFixed(0)}k`
            }
          }
        }
      }
    });
  }

  /**
   * 【年間設備別】工程別・設備別年間電力比率多層ドーナツチャート
   */
  function renderAnnualEquipmentDoughnutChart(canvasId, equipmentSummary) {
    if (typeof Chart === 'undefined') return;
    const ctx = document.getElementById(canvasId);
    if (!ctx || !equipmentSummary) return;

    if (annualEquipDoughnutChartInstance) annualEquipDoughnutChartInstance.destroy();

    const cats = equipmentSummary.categories || {};
    annualEquipDoughnutChartInstance = new Chart(ctx, buildProcessDoughnutConfig(
      name => (cats[name] ? cats[name].annualTotal : 0),
      '年間内訳'
    ));
  }

  return {
    renderDailyChart,
    renderCategoryDoughnutChart,
    renderAnnualStackedBarChart,
    renderAnnualTrendChart,
    renderAnnualEquipmentTrendChart,
    renderAnnualEquipmentDoughnutChart,
    getNiceMax,
    getAxisMaxForPeak
  };

}));
