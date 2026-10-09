/**
 * gas_app/js/services/totalEnergyService.js
 * トータルエネルギー (生産数量・熱量・原油換算量・原単位・CO2排出量) の年間月別集計サービス
 * (かつらぎ工場エネルギー計算表の年度シート上部のグラフ・年間サマリー 準拠)
 * 熱量・原油換算量・CO2排出量は Excel が計算した値をそのまま使い、原単位などの比と、累計・年間計・前年度比をここで計算する
 * ブラウザ環境およびNode.js環境両対応
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../config.js'));
  } else {
    root.TotalEnergyService = factory(root.AppConfig);
  }
}(typeof self !== 'undefined' ? self : this, function (AppConfig) {

  const SOURCES = AppConfig.TOTAL_ENERGY_SOURCES;
  // 月ごとに積み上げる項目 (総量)
  const SUM_FIELDS = ['productionCases', 'heavyOilGj', 'lngGj', 'electricityGj', 'totalGj', 'crudeOilKl',
    'heavyOilCo2', 'lngCo2', 'electricityCo2', 'totalCo2', 'solarKwhThousand', 'solarGj', 'solarCo2', 'noSolarCrudeOilKl'];
  // 太陽光の項目 (太陽光の行がある年度だけ値が入る)
  const SOLAR_FIELDS = ['solarKwhThousand', 'solarGj', 'solarCo2', 'noSolarCrudeOilKl'];
  const DEFAULT_LITERS_PER_CASE = 12;

  const isNum = v => typeof v === 'number' && isFinite(v);
  const num = v => isNum(v) ? v : 0;
  // 分母が 0 以下、または分子が無い場合は null (値なし)
  const ratio = (numerator, denominator) => (isNum(numerator) && isNum(denominator) && denominator > 0) ? numerator / denominator : null;

  /**
   * 月として有効なデータがあるか (熱量の合計が 0 より大きい月)
   */
  function hasMonthData(monthInput) {
    return !!monthInput && num(monthInput.totalGj) > 0;
  }

  /**
   * 総量から、原単位・CO2 の比と、太陽光発電 無しの想定値を求める
   * - 原単位 (kl/千ケース) = 原油換算量 ÷ (生産数量 ÷ 1000)
   * - 生産液量1klあたりのCO2 (kg-CO2/kl) = CO2排出量 × 1000 ÷ 生産液量kl
   * - 生産数(千ケース)あたりのCO2 (t-CO2/千ケース) = CO2排出量 ÷ (生産数量 ÷ 1000)
   * - 太陽光発電 無しの想定値 = 太陽光の熱量・CO2 を合計に足し戻した値
   * @param {Object} totals 総量。SUM_FIELDS の各項目と、productionLiquidKl (生産液量 kl)、hasSolar を持つ
   * @returns {Object} totals に比の項目を加えたもの
   */
  function withRatios(totals) {
    const thousandCases = totals.productionCases / 1000;
    const out = Object.assign({}, totals, {
      productionThousandCases: thousandCases,
      intensity: ratio(totals.crudeOilKl, thousandCases),
      co2PerKl: ratio(totals.totalCo2 * 1000, totals.productionLiquidKl),
      co2PerThousandCases: ratio(totals.totalCo2, thousandCases)
    });
    if (totals.hasSolar) {
      out.noSolarTotalGj = totals.totalGj + totals.solarGj;
      out.noSolarTotalCo2 = totals.totalCo2 + totals.solarCo2;
      out.noSolarIntensity = ratio(totals.noSolarCrudeOilKl, thousandCases);
      out.noSolarCo2PerKl = ratio(out.noSolarTotalCo2 * 1000, totals.productionLiquidKl);
    } else {
      SOLAR_FIELDS.forEach(f => { out[f] = null; });
      out.noSolarTotalGj = null;
      out.noSolarTotalCo2 = null;
      out.noSolarIntensity = null;
      out.noSolarCo2PerKl = null;
    }
    return out;
  }

  const emptyTotals = () => {
    const t = { productionLiquidKl: 0, hasSolar: false };
    SUM_FIELDS.forEach(f => { t[f] = 0; });
    return t;
  };

  const addMonth = (totals, monthInput) => {
    SUM_FIELDS.forEach(f => { totals[f] += num(monthInput[f]); });
    const liters = num(monthInput.litersPerCase) > 0 ? monthInput.litersPerCase : DEFAULT_LITERS_PER_CASE;
    totals.productionLiquidKl += num(monthInput.productionCases) * liters / 1000;
    if (isNum(monthInput.solarKwhThousand) || isNum(monthInput.solarGj)) totals.hasSolar = true;
  };

  /**
   * 年度 (4月〜翌3月) の年間データセットを作る
   * @param {number|string} fiscalYear 年度
   * @param {Object} monthly { [ym]: parseTotalEnergyTable の months[ym] と同じ形 }
   * @returns {Object} {
   *   fiscalYear, months: ['YYYYMM' x12], monthLabels, availableMonthsCount, hasSolar,
   *   rows: { [ym]: { yearMonth, hasData, ...総量と比, cumulative: { ...年度初めからの総量と比 } } },  // データの無い月は hasData: false で値は null
   *   annual: { ...年間の総量と比 }  // データのある月が無ければ null
   * }
   */
  function buildAnnualDataset(fiscalYear, monthly) {
    const fy = parseInt(fiscalYear, 10);
    const months = AppConfig.FISCAL_MONTH_ORDER.map(m => `${m >= 4 ? fy : fy + 1}${String(m).padStart(2, '0')}`);
    const dataset = {
      fiscalYear: fy,
      months: months,
      monthLabels: AppConfig.FISCAL_MONTH_LABELS.slice(),
      availableMonthsCount: 0,
      hasSolar: false,
      rows: {},
      annual: null
    };

    const running = emptyTotals();
    months.forEach(ym => {
      const input = (monthly || {})[ym];
      if (!hasMonthData(input)) {
        dataset.rows[ym] = { yearMonth: ym, hasData: false };
        return;
      }
      const single = emptyTotals();
      addMonth(single, input);
      addMonth(running, input);
      dataset.availableMonthsCount++;
      if (single.hasSolar) dataset.hasSolar = true;
      dataset.rows[ym] = Object.assign({ yearMonth: ym, hasData: true }, withRatios(single), { cumulative: withRatios(Object.assign({}, running)) });
    });

    if (dataset.availableMonthsCount > 0) {
      dataset.annual = Object.assign(withRatios(Object.assign({}, running)), { monthsCount: dataset.availableMonthsCount });
    }
    return dataset;
  }

  /**
   * 前年度比を求める (当年度 ÷ 前年度)
   * - 原単位・1klあたりのCO2 は、期中の年度でも比べられるため常に求める
   * - 総量 (生産数量・原油換算量・CO2排出量) は、当年度・前年度とも12か月そろっている場合だけ求める
   * @param {Object|null} current 当年度の年間データセット
   * @param {Object|null} previous 前年度の年間データセット (無ければ null)
   * @returns {Object} { intensity, co2PerKl, productionCases, crudeOilKl, totalCo2 } 求められない項目は null
   */
  function compareWithPreviousYear(current, previous) {
    const result = { intensity: null, co2PerKl: null, productionCases: null, crudeOilKl: null, totalCo2: null };
    if (!current || !current.annual || !previous || !previous.annual) return result;
    result.intensity = ratio(current.annual.intensity, previous.annual.intensity);
    result.co2PerKl = ratio(current.annual.co2PerKl, previous.annual.co2PerKl);
    if (current.availableMonthsCount === 12 && previous.availableMonthsCount === 12) {
      result.productionCases = ratio(current.annual.productionCases, previous.annual.productionCases);
      result.crudeOilKl = ratio(current.annual.crudeOilKl, previous.annual.crudeOilKl);
      result.totalCo2 = ratio(current.annual.totalCo2, previous.annual.totalCo2);
    }
    return result;
  }

  /**
   * 年度推移 (各年度の年間値を並べたもの) を作る
   * @param {Object} annualDatasets { [fiscalYear]: buildAnnualDataset の戻り値 }
   * @returns {Object} { years: [年度の昇順], labels: ['2024年度', '2026年度 (6ヶ月)', ...], rows: { [fiscalYear]: { ...年間の総量と比, monthsCount, previousYearRatio } } }
   *   入力途中の年度 (12か月そろっていない年度) は、ラベルに月数を添える
   */
  function buildYearlyTrend(annualDatasets) {
    const years = Object.keys(annualDatasets || {})
      .filter(fy => annualDatasets[fy] && annualDatasets[fy].annual)
      .map(Number).sort((a, b) => a - b);
    const trend = { years: years, labels: [], rows: {} };
    years.forEach(fy => {
      const ds = annualDatasets[fy];
      trend.labels.push(ds.availableMonthsCount === 12 ? `${fy}年度` : `${fy}年度 (${ds.availableMonthsCount}ヶ月)`);
      trend.rows[fy] = Object.assign({}, ds.annual, { previousYearRatio: compareWithPreviousYear(ds, annualDatasets[fy - 1] || null) });
    });
    return trend;
  }

  return {
    SOURCES,
    hasMonthData,
    buildAnnualDataset,
    compareWithPreviousYear,
    buildYearlyTrend
  };
}));
