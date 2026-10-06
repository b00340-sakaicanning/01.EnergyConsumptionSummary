/**
 * gas_app/js/components/charts.js
 * Chart.js を用いたインタラクティブグラフ描画コンポーネント
 * ライトテーマ対応 ＆ 単月・年間月別・品種別集約グラフサポート
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ChartManager = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  // チャートインスタンス管理
  let dailyChartInstance = null;
  let categoryChartInstance = null;
  let annualStackedChartInstance = null;
  let annualTrendChartInstance = null;
  let annualEquipTrendChartInstance = null;
  let annualEquipDoughnutChartInstance = null;

  // 品種カラーパレット (Excel原紙・月別電力使用量集約グラフ表示(総電力 2024).xlsx 準拠)
  const VARIETY_COLORS = {
    '2.0L': { bg: 'rgba(37, 99, 235, 0.85)', border: '#2563eb' },
    '1.5L': { bg: 'rgba(8, 145, 178, 0.85)', border: '#0891b2' },
    '1.0L': { bg: 'rgba(5, 150, 105, 0.85)', border: '#059669' },
    '600mL丸': { bg: 'rgba(101, 163, 13, 0.85)', border: '#65a30d' },
    '500mL丸': { bg: 'rgba(217, 119, 6, 0.85)', border: '#d97706' },
    '500mL角': { bg: 'rgba(234, 88, 12, 0.85)', border: '#ea580c' },
    '350mL': { bg: 'rgba(124, 58, 237, 0.85)', border: '#7c3aed' },
    '280mL': { bg: 'rgba(219, 39, 119, 0.85)', border: '#db2777' },
    '月計': { bg: 'rgba(15, 23, 42, 0.9)', border: '#0f172a' }
  };

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

    if (annualStackedChartInstance) {
      annualStackedChartInstance.destroy();
    }

    const varietyKeys = ['2.0L', '1.5L', '1.0L', '600mL丸', '500mL丸', '500mL角', '350mL', '280mL'];

    // 原単位・平均系指標かどうかの判定 (単位本、単位時間)
    const isRateMetric = ['kwhPerBottle', 'costPerBottle', 'kwhPerMinute', 'costPerMinute'].includes(metricInfo.key);

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

    annualStackedChartInstance = new Chart(ctx, {
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

    if (annualTrendChartInstance) {
      annualTrendChartInstance.destroy();
    }

    const varietyKeys = ['2.0L', '1.5L', '1.0L', '600mL丸', '500mL丸', '500mL角', '350mL', '280mL'];

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

    const trendMax = scaleOptions && scaleOptions.trendMax > 0 ? scaleOptions.trendMax : (scaleOptions && scaleOptions.max > 0 ? scaleOptions.max : undefined);

    annualTrendChartInstance = new Chart(ctx, {
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
    const utilityData = dailyTotals.map(d => d.categories['ユーティリティ'] || 0);
    const mixingData = dailyTotals.map(d => d.categories['調合抽出'] || 0);
    const supplyData = dailyTotals.map(d => d.categories['供給'] || 0);
    const fillingData = dailyTotals.map(d => d.categories['充填'] || 0);
    const packagingData = dailyTotals.map(d => d.categories['包装'] || 0);

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
          {
            type: 'bar',
            label: 'ユーティリティ (kWh)',
            data: utilityData,
            backgroundColor: 'rgba(14, 165, 233, 0.8)',
            borderRadius: 2,
            stack: 'dailyStack',
            order: 1
          },
          {
            type: 'bar',
            label: '調合抽出 (kWh)',
            data: mixingData,
            backgroundColor: 'rgba(124, 58, 237, 0.8)',
            borderRadius: 2,
            stack: 'dailyStack',
            order: 1
          },
          {
            type: 'bar',
            label: '供給 (kWh)',
            data: supplyData,
            backgroundColor: 'rgba(245, 158, 11, 0.8)',
            borderRadius: 2,
            stack: 'dailyStack',
            order: 1
          },
          {
            type: 'bar',
            label: '充填 (kWh)',
            data: fillingData,
            backgroundColor: 'rgba(5, 150, 105, 0.8)',
            borderRadius: 2,
            stack: 'dailyStack',
            order: 1
          },
          {
            type: 'bar',
            label: '包装 (kWh)',
            data: packagingData,
            backgroundColor: 'rgba(234, 88, 12, 0.8)',
            borderRadius: 2,
            stack: 'dailyStack',
            order: 1
          }
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
   * 【単月】工程別電力比率多層ドーナツチャート (ユーティリティ外側円弧内訳付き)
   */
  function renderCategoryDoughnutChart(canvasId, categoryTotals) {
    if (typeof Chart === 'undefined') return;
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    if (categoryChartInstance) categoryChartInstance.destroy();
    if (!categoryTotals || typeof categoryTotals !== 'object') return;

    // 1. 内側メイン工程 (ユーティリティ、調合抽出、供給、充填、包装)
    const mainKeys = ['ユーティリティ', '調合抽出', '供給', '充填', '包装'];
    const mainColors = ['#0284c7', '#7c3aed', '#f59e0b', '#059669', '#ea580c'];
    const mainData = mainKeys.map(k => (categoryTotals[k] ? categoryTotals[k].grandTotal : 0));
    const mainTotalSum = mainData.reduce((a, b) => a + b, 0);

    // 2. 外側ユーティリティ内訳 (コンプレッサー、ボイラー、純水装置、排水処理、チラー) + 他工程透明スペーサー
    const uBreakdownKeys = ['コンプレッサー', 'ボイラー', '純水装置', '排水処理', 'チラー'];
    const uBreakdownColors = ['#38bdf8', '#0284c7', '#0ea5e9', '#64748b', '#0891b2'];
    const uBreakdownData = uBreakdownKeys.map(k => (categoryTotals[k] ? categoryTotals[k].grandTotal : 0));
    const uTotal = categoryTotals['ユーティリティ'] ? categoryTotals['ユーティリティ'].grandTotal : 0;

    // 外側リングの全データ: ユーティリティ内訳5項目 + 残り4工程分(透明)
    const outerData = [
      ...uBreakdownData,
      categoryTotals['調合抽出'] ? categoryTotals['調合抽出'].grandTotal : 0,
      categoryTotals['供給'] ? categoryTotals['供給'].grandTotal : 0,
      categoryTotals['充填'] ? categoryTotals['充填'].grandTotal : 0,
      categoryTotals['包装'] ? categoryTotals['包装'].grandTotal : 0
    ];

    const outerColors = [
      ...uBreakdownColors,
      'transparent',
      'transparent',
      'transparent',
      'transparent'
    ];

    const outerBorderColors = [
      '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff',
      'transparent', 'transparent', 'transparent', 'transparent'
    ];

    categoryChartInstance = new Chart(ctx, {
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
                // メイン
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
                // 内訳
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
                    return ` [ユーティリティ内訳] ${name}: ${Math.round(val).toLocaleString()} kWh (${pct}%)`;
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
    });
  }

  /**
   * 【年間設備別】月別設備別・工程別電力推移チャート
   */
  function renderAnnualEquipmentTrendChart(canvasId, equipmentSummary, viewMode = 'utilityGroup', scaleOptions) {
    if (typeof Chart === 'undefined') return;
    const ctx = document.getElementById(canvasId);
    if (!ctx || !equipmentSummary) return;

    if (annualEquipTrendChartInstance) annualEquipTrendChartInstance.destroy();

    const monthLabels = ['4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月', '1月', '2月', '3月'];
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

    if (viewMode === 'utilityGroup') {
      // ユーティリティ統合モード
      datasets.push(
        {
          type: 'bar',
          label: 'ユーティリティ (kWh)',
          data: cats['ユーティリティ'] ? cats['ユーティリティ'].monthly : [],
          backgroundColor: 'rgba(14, 165, 233, 0.8)',
          borderRadius: 2,
          stack: 'equipStack',
          order: 1
        },
        {
          type: 'bar',
          label: '調合抽出 (kWh)',
          data: cats['調合抽出'] ? cats['調合抽出'].monthly : [],
          backgroundColor: 'rgba(124, 58, 237, 0.8)',
          borderRadius: 2,
          stack: 'equipStack',
          order: 1
        },
        {
          type: 'bar',
          label: '供給 (kWh)',
          data: cats['供給'] ? cats['供給'].monthly : [],
          backgroundColor: 'rgba(245, 158, 11, 0.8)',
          borderRadius: 2,
          stack: 'equipStack',
          order: 1
        },
        {
          type: 'bar',
          label: '充填 (kWh)',
          data: cats['充填'] ? cats['充填'].monthly : [],
          backgroundColor: 'rgba(5, 150, 105, 0.8)',
          borderRadius: 2,
          stack: 'equipStack',
          order: 1
        },
        {
          type: 'bar',
          label: '包装 (kWh)',
          data: cats['包装'] ? cats['包装'].monthly : [],
          backgroundColor: 'rgba(234, 88, 12, 0.8)',
          borderRadius: 2,
          stack: 'equipStack',
          order: 1
        }
      );
    } else {
      // 設備詳細内訳モード
      datasets.push(
        {
          type: 'bar',
          label: 'コンプレッサー',
          data: cats['コンプレッサー'] ? cats['コンプレッサー'].monthly : [],
          backgroundColor: '#38bdf8',
          borderRadius: 2,
          stack: 'equipStack',
          order: 1
        },
        {
          type: 'bar',
          label: 'ボイラー',
          data: cats['ボイラー'] ? cats['ボイラー'].monthly : [],
          backgroundColor: '#0284c7',
          borderRadius: 2,
          stack: 'equipStack',
          order: 1
        },
        {
          type: 'bar',
          label: '純水装置',
          data: cats['純水装置'] ? cats['純水装置'].monthly : [],
          backgroundColor: '#0ea5e9',
          borderRadius: 2,
          stack: 'equipStack',
          order: 1
        },
        {
          type: 'bar',
          label: '排水処理',
          data: cats['排水処理'] ? cats['排水処理'].monthly : [],
          backgroundColor: '#64748b',
          borderRadius: 2,
          stack: 'equipStack',
          order: 1
        },
        {
          type: 'bar',
          label: 'チラー',
          data: cats['チラー'] ? cats['チラー'].monthly : [],
          backgroundColor: '#0891b2',
          borderRadius: 2,
          stack: 'equipStack',
          order: 1
        },
        {
          type: 'bar',
          label: '調合抽出',
          data: cats['調合抽出'] ? cats['調合抽出'].monthly : [],
          backgroundColor: '#7c3aed',
          borderRadius: 2,
          stack: 'equipStack',
          order: 1
        },
        {
          type: 'bar',
          label: '供給',
          data: cats['供給'] ? cats['供給'].monthly : [],
          backgroundColor: '#f59e0b',
          borderRadius: 2,
          stack: 'equipStack',
          order: 1
        },
        {
          type: 'bar',
          label: '充填',
          data: cats['充填'] ? cats['充填'].monthly : [],
          backgroundColor: '#059669',
          borderRadius: 2,
          stack: 'equipStack',
          order: 1
        },
        {
          type: 'bar',
          label: '包装',
          data: cats['包装'] ? cats['包装'].monthly : [],
          backgroundColor: '#ea580c',
          borderRadius: 2,
          stack: 'equipStack',
          order: 1
        }
      );
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

    // 1. 内側メイン工程 (ユーティリティ、調合抽出、供給、充填、包装)
    const mainKeys = ['ユーティリティ', '調合抽出', '供給', '充填', '包装'];
    const mainColors = ['#0284c7', '#7c3aed', '#f59e0b', '#059669', '#ea580c'];
    const mainData = mainKeys.map(k => (cats[k] ? cats[k].annualTotal : 0));
    const mainTotalSum = mainData.reduce((a, b) => a + b, 0);

    // 2. 外側ユーティリティ内訳 (コンプレッサー、ボイラー、純水装置、排水処理、チラー) + 他工程透明
    const uBreakdownKeys = ['コンプレッサー', 'ボイラー', '純水装置', '排水処理', 'チラー'];
    const uBreakdownColors = ['#38bdf8', '#0284c7', '#0ea5e9', '#64748b', '#0891b2'];
    const uBreakdownData = uBreakdownKeys.map(k => (cats[k] ? cats[k].annualTotal : 0));
    const uTotal = cats['ユーティリティ'] ? cats['ユーティリティ'].annualTotal : 0;

    const outerData = [
      ...uBreakdownData,
      cats['調合抽出'] ? cats['調合抽出'].annualTotal : 0,
      cats['供給'] ? cats['供給'].annualTotal : 0,
      cats['充填'] ? cats['充填'].annualTotal : 0,
      cats['包装'] ? cats['包装'].annualTotal : 0
    ];

    const outerColors = [
      ...uBreakdownColors,
      'transparent', 'transparent', 'transparent', 'transparent'
    ];

    const outerBorderColors = [
      '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff',
      'transparent', 'transparent', 'transparent', 'transparent'
    ];

    annualEquipDoughnutChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        datasets: [
          {
            label: 'ユーティリティ内訳',
            data: outerData,
            backgroundColor: outerColors,
            borderColor: outerBorderColors,
            borderWidth: 2,
            weight: 0.9
          },
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
                  if (dataIndex < uBreakdownKeys.length) {
                    const name = uBreakdownKeys[dataIndex];
                    const val = context.raw || 0;
                    const pct = uTotal > 0 ? ((val / uTotal) * 100).toFixed(1) : '0';
                    return ` [年間内訳] ${name}: ${Math.round(val).toLocaleString()} kWh (${pct}%)`;
                  }
                  return null;
                } else {
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
    });
  }

  return {
    renderDailyChart,
    renderCategoryDoughnutChart,
    renderAnnualStackedBarChart,
    renderAnnualTrendChart,
    renderAnnualEquipmentTrendChart,
    renderAnnualEquipmentDoughnutChart,
    getNiceMax
  };

}));
