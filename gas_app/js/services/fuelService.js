/**
 * gas_app/js/services/fuelService.js
 * 燃料エネルギー (A重油 + LNG) の年間月別・品種別集計サービス
 * (月別燃料エネルギー使用量集約グラフ表示(2024).xlsx 準拠)
 * ブラウザ環境およびNode.js環境両対応
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../config.js'));
  } else {
    root.FuelService = factory(root.AppConfig);
  }
}(typeof self !== 'undefined' ? self : this, function (AppConfig) {

  const VARIETY_KEYS = AppConfig.VARIETY_KEYS;
  const CAPACITY_L = {};
  AppConfig.VARIETY_GROUPS.forEach(g => { CAPACITY_L[g.key] = g.capacityL; });

  const num = v => (typeof v === 'number' && isFinite(v)) ? v : 0;
  const sumOf = obj => VARIETY_KEYS.reduce((acc, k) => acc + num(obj && obj[k]), 0);
  // 分母が0の場合は0とする (Excel原紙の IF(ISERROR(...),0,...) と同じ扱い)
  const ratio = (numerator, denominator) => denominator > 0 ? numerator / denominator : 0;

  /**
   * 1ヶ月分の燃料の合計値と、月として有効なデータがあるかを求める
   * @param {Object} monthInput { heavyOilGj, lngGj, heavyOilCostThousandYen, lngCostThousandYen }
   * @returns {Object} { hasData, totalGj, totalMj, totalCostThousandYen, totalCostYen, unitPriceYenPerMj }
   */
  function summarizeFuelMonth(monthInput) {
    const m = monthInput || {};
    const totalGj = num(m.heavyOilGj) + num(m.lngGj);
    const totalCostThousandYen = num(m.heavyOilCostThousandYen) + num(m.lngCostThousandYen);
    return {
      // 熱量が0の月は、未入力の月として扱う (計算表の未入力月は数式が0を返すため、空欄では判定できない)
      hasData: totalGj > 0,
      totalGj,
      totalMj: totalGj * 1000,
      totalCostThousandYen,
      totalCostYen: totalCostThousandYen * 1000,
      // 千円 ÷ GJ はそのまま 円/MJ になる
      unitPriceYenPerMj: ratio(totalCostThousandYen, totalGj)
    };
  }

  /**
   * 月の燃料エネルギー量を、品種別の生産液量 (本数 × 容量) の比で按分する
   * @param {number} totalMj 月の燃料エネルギー量 (MJ)
   * @param {Object} bottles 品種別の本数 { [品種キー]: 本数 }
   * @returns {Object|null} 品種別のMJ。液量の合計が0の場合は null
   */
  function allocateByLiquidVolume(totalMj, bottles) {
    const liters = {};
    let totalLiters = 0;
    VARIETY_KEYS.forEach(k => {
      liters[k] = num(bottles && bottles[k]) * CAPACITY_L[k];
      totalLiters += liters[k];
    });
    if (!(totalLiters > 0)) return null;
    const allocated = {};
    VARIETY_KEYS.forEach(k => { allocated[k] = totalMj * liters[k] / totalLiters; });
    return allocated;
  }

  /**
   * 年度 (4月〜翌3月) の燃料エネルギー集約データを構築する
   * @param {number|string} fiscalYear 年度
   * @param {Object} fuelMonthly { [ym]: { heavyOilGj, lngGj, heavyOilCostThousandYen, lngCostThousandYen, bottles } }
   *   bottles は品種別の本数。月報PETから取得できていない月は null または未定義
   * @param {Object} [operationMinByYm] { [ym]: { [品種キー]: 水運転+実充填の分数 } }。電力側のデータが無い月は未定義
   * @returns {Object} { fiscalYear, months, monthLabels, availableMonthsCount, metrics, breakdown, breakdownTotal }
   *   metrics[指標キー] は電力の年間データと同じ形 { months: { [ym]: { yearMonth, hasData, monthlyTotal, cumulativeTotal, varieties } }, annualTotal: { monthlyTotal, varieties } }
   */
  function buildFuelAnnualDataset(fiscalYear, fuelMonthly, operationMinByYm) {
    const fy = parseInt(fiscalYear, 10);
    const months = AppConfig.FISCAL_MONTH_ORDER.map(m => `${m >= 4 ? fy : fy + 1}${String(m).padStart(2, '0')}`);
    const opByYm = operationMinByYm || {};
    const emptyVarieties = () => { const o = {}; VARIETY_KEYS.forEach(k => { o[k] = null; }); return o; };

    const metrics = {};
    AppConfig.FUEL_METRICS.forEach(metric => {
      metrics[metric.key] = { months: {}, annualTotal: { monthlyTotal: null, varieties: emptyVarieties() } };
    });
    const breakdown = {};

    // 累計・年間計用の積み上げ (原単位系は、分子・分母ともその指標のデータがある月だけを積み上げる)
    const acc = {
      bottles: 0, minutes: 0, mj: 0, cost: 0,
      mjForBottles: 0, costForBottles: 0, mjForMinutes: 0, costForMinutes: 0, minutesForRate: 0,
      breakdown: { heavyOilGj: 0, lngGj: 0, totalGj: 0, heavyOilCostThousandYen: 0, lngCostThousandYen: 0, totalCostThousandYen: 0 },
      v: {}
    };
    VARIETY_KEYS.forEach(k => { acc.v[k] = { bottles: 0, minutes: 0, mj: 0, cost: 0, mjForBottles: 0, costForBottles: 0, mjForMinutes: 0, costForMinutes: 0, minutesForRate: 0 }; });

    let availableMonthsCount = 0;
    const setMonth = (key, ym, hasData, monthlyTotal, cumulativeTotal, varieties) => {
      metrics[key].months[ym] = {
        yearMonth: ym,
        hasData,
        monthlyTotal: hasData ? monthlyTotal : null,
        cumulativeTotal: hasData ? cumulativeTotal : null,
        varieties: (hasData && varieties) ? varieties : emptyVarieties()
      };
    };

    months.forEach(ym => {
      const input = fuelMonthly ? fuelMonthly[ym] : null;
      const s = summarizeFuelMonth(input);
      breakdown[ym] = {
        hasData: s.hasData,
        heavyOilGj: s.hasData ? num(input.heavyOilGj) : null,
        lngGj: s.hasData ? num(input.lngGj) : null,
        totalGj: s.hasData ? s.totalGj : null,
        heavyOilCostThousandYen: s.hasData ? num(input.heavyOilCostThousandYen) : null,
        lngCostThousandYen: s.hasData ? num(input.lngCostThousandYen) : null,
        totalCostThousandYen: s.hasData ? s.totalCostThousandYen : null,
        unitPriceYenPerMj: s.hasData ? s.unitPriceYenPerMj : null
      };

      if (!s.hasData) {
        AppConfig.FUEL_METRICS.forEach(metric => setMonth(metric.key, ym, false, null, null, null));
        return;
      }
      availableMonthsCount++;
      ['heavyOilGj', 'lngGj', 'totalGj', 'heavyOilCostThousandYen', 'lngCostThousandYen', 'totalCostThousandYen'].forEach(f => { acc.breakdown[f] += breakdown[ym][f]; });

      // 品種別の本数 (月報PET) と操業時間 (電力側のロガー集計) は、無い月がある
      const bottles = input.bottles || null;
      const totalBottles = sumOf(bottles);
      const hasBottles = !!bottles && totalBottles > 0;
      const opMin = opByYm[ym] || null;
      const totalMinutes = sumOf(opMin);
      const hasMinutes = !!opMin && totalMinutes > 0;

      const vMj = hasBottles ? allocateByLiquidVolume(s.totalMj, bottles) : null;
      const vCost = vMj ? {} : null;
      if (vMj) VARIETY_KEYS.forEach(k => { vCost[k] = s.unitPriceYenPerMj * vMj[k]; });

      // --- 総量系 ---
      acc.mj += s.totalMj;
      acc.cost += s.totalCostYen;
      if (vMj) VARIETY_KEYS.forEach(k => { acc.v[k].mj += vMj[k]; acc.v[k].cost += vCost[k]; });
      setMonth('fuelMj', ym, true, s.totalMj, acc.mj, vMj);
      setMonth('fuelCostYen', ym, true, s.totalCostYen, acc.cost, vCost);

      if (hasBottles) {
        acc.bottles += totalBottles;
        const vBottles = {};
        VARIETY_KEYS.forEach(k => { vBottles[k] = num(bottles[k]); acc.v[k].bottles += vBottles[k]; });
        setMonth('productionBottles', ym, true, totalBottles, acc.bottles, vBottles);
      } else {
        setMonth('productionBottles', ym, false, null, null, null);
      }

      if (hasMinutes) {
        acc.minutes += totalMinutes;
        const vMinutes = {};
        VARIETY_KEYS.forEach(k => { vMinutes[k] = num(opMin[k]); acc.v[k].minutes += vMinutes[k]; });
        setMonth('operationMin', ym, true, totalMinutes, acc.minutes, vMinutes);
      } else {
        setMonth('operationMin', ym, false, null, null, null);
      }

      // --- 単位本あたり (本数のある月だけ) ---
      if (hasBottles) {
        acc.mjForBottles += s.totalMj;
        acc.costForBottles += s.totalCostYen;
        const vMjPerBottle = {}, vCostPerBottle = {};
        VARIETY_KEYS.forEach(k => {
          vMjPerBottle[k] = ratio(vMj[k], num(bottles[k]));
          vCostPerBottle[k] = ratio(vCost[k], num(bottles[k]));
          acc.v[k].mjForBottles += vMj[k];
          acc.v[k].costForBottles += vCost[k];
        });
        setMonth('mjPerBottle', ym, true, ratio(s.totalMj, totalBottles), ratio(acc.mjForBottles, acc.bottles), vMjPerBottle);
        setMonth('costPerBottle', ym, true, ratio(s.totalCostYen, totalBottles), ratio(acc.costForBottles, acc.bottles), vCostPerBottle);
      } else {
        setMonth('mjPerBottle', ym, false, null, null, null);
        setMonth('costPerBottle', ym, false, null, null, null);
      }

      // --- 単位時間あたり (操業時間のある月だけ。品種別は本数による按分値も必要) ---
      if (hasMinutes) {
        acc.mjForMinutes += s.totalMj;
        acc.costForMinutes += s.totalCostYen;
        acc.minutesForRate += totalMinutes;
        let vMjPerMinute = null, vCostPerMinute = null;
        if (vMj) {
          vMjPerMinute = {};
          vCostPerMinute = {};
          VARIETY_KEYS.forEach(k => {
            vMjPerMinute[k] = ratio(vMj[k], num(opMin[k]));
            vCostPerMinute[k] = ratio(vCost[k], num(opMin[k]));
            acc.v[k].mjForMinutes += vMj[k];
            acc.v[k].costForMinutes += vCost[k];
            acc.v[k].minutesForRate += num(opMin[k]);
          });
        }
        setMonth('mjPerMinute', ym, true, ratio(s.totalMj, totalMinutes), ratio(acc.mjForMinutes, acc.minutesForRate), vMjPerMinute);
        setMonth('costPerMinute', ym, true, ratio(s.totalCostYen, totalMinutes), ratio(acc.costForMinutes, acc.minutesForRate), vCostPerMinute);
      } else {
        setMonth('mjPerMinute', ym, false, null, null, null);
        setMonth('costPerMinute', ym, false, null, null, null);
      }
    });

    // 年間計: 総量系は合計、原単位系は年間計どうしの比 (月の値の平均ではない)
    const hasAny = key => months.some(ym => metrics[key].months[ym].hasData);
    const setAnnual = (key, total, perVariety) => {
      if (!hasAny(key)) return;
      metrics[key].annualTotal.monthlyTotal = total;
      VARIETY_KEYS.forEach(k => { metrics[key].annualTotal.varieties[k] = perVariety(k); });
    };
    const hasVarietyMj = months.some(ym => { const m = metrics.fuelMj.months[ym]; return m.hasData && m.varieties[VARIETY_KEYS[0]] !== null; });
    setAnnual('fuelMj', acc.mj, k => hasVarietyMj ? acc.v[k].mj : null);
    setAnnual('fuelCostYen', acc.cost, k => hasVarietyMj ? acc.v[k].cost : null);
    setAnnual('productionBottles', acc.bottles, k => acc.v[k].bottles);
    setAnnual('operationMin', acc.minutes, k => acc.v[k].minutes);
    setAnnual('mjPerBottle', ratio(acc.mjForBottles, acc.bottles), k => ratio(acc.v[k].mjForBottles, acc.v[k].bottles));
    setAnnual('costPerBottle', ratio(acc.costForBottles, acc.bottles), k => ratio(acc.v[k].costForBottles, acc.v[k].bottles));
    setAnnual('mjPerMinute', ratio(acc.mjForMinutes, acc.minutesForRate), k => hasVarietyMj ? ratio(acc.v[k].mjForMinutes, acc.v[k].minutesForRate) : null);
    setAnnual('costPerMinute', ratio(acc.costForMinutes, acc.minutesForRate), k => hasVarietyMj ? ratio(acc.v[k].costForMinutes, acc.v[k].minutesForRate) : null);

    return {
      fiscalYear: fy,
      months,
      monthLabels: AppConfig.FISCAL_MONTH_LABELS.slice(),
      availableMonthsCount,
      metrics,
      breakdown,
      breakdownTotal: availableMonthsCount > 0
        ? Object.assign({}, acc.breakdown, { unitPriceYenPerMj: ratio(acc.breakdown.totalCostThousandYen, acc.breakdown.totalGj) })
        : null
    };
  }

  return {
    summarizeFuelMonth,
    allocateByLiquidVolume,
    buildFuelAnnualDataset
  };
}));
