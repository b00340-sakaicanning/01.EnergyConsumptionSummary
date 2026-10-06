/**
 * gas_app/js/services/kpiService.js
 * 原単位および電気コストKPI算出サービス
 * ブラウザ環境およびNode.js環境両対応
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const AppConfig = require('../config.js');
    module.exports = factory(AppConfig);
  } else {
    root.KpiService = factory(root.AppConfig);
  }
}(typeof self !== 'undefined' ? self : this, function (AppConfig) {

  /**
   * KPI評価指標を算出する
   * @param {Object} categoryMonthlyTotals カテゴリ月間合計
   * @param {Object} monthlyOperationTimes 稼働時間合計（分）
   * @param {Object} productionData { totalBottles, varieties }
   * @param {Object} electricityData { usedKwhThousand, costThousandYen, unitPriceYenPerKwh }
   * @returns {Object} 総合評価（水運転＋実充填、水運転のみ、実充填のみ）
   */
  function calculateKpi(categoryMonthlyTotals, monthlyOperationTimes, productionData = {}, electricityData = {}) {
    const totalKwh = categoryMonthlyTotals['総電力'] ? categoryMonthlyTotals['総電力'].grandTotal : 0.0;

    const waterTime = monthlyOperationTimes.waterTimeMin || 0;
    const fillingTime = monthlyOperationTimes.actualFillingMin || 0;
    const combinedTime = waterTime + fillingTime;

    const bottles = productionData.totalBottles || 0;
    const unitPrice = electricityData.unitPriceYenPerKwh || 0.0;

    // 稼働モードごとの電力量按分（操業時間比率で按分）
    const waterKwhRatio = combinedTime > 0 ? (waterTime / combinedTime) : 0;
    const fillingKwhRatio = combinedTime > 0 ? (fillingTime / combinedTime) : 0;

    const waterKwh = Math.round(totalKwh * waterKwhRatio * 10) / 10;
    const fillingKwh = Math.round(totalKwh * fillingKwhRatio * 10) / 10;

    // 1. 水運転＋実充填
    const combined = {
      mode: '水運転＋実充填',
      productionBottles: bottles,
      operationTimeMin: combinedTime,
      totalKwh: totalKwh,
      kwhPerMinute: combinedTime > 0 ? round(totalKwh / combinedTime, 3) : 0.0,
      kwhPerBottle: bottles > 0 ? round(totalKwh / bottles, 4) : 0.0,
      costPerBottleYen: bottles > 0 && unitPrice > 0 ? round((totalKwh / bottles) * unitPrice, 2) : 0.0
    };

    // 2. 水運転のみ
    const waterOnly = {
      mode: '水運転のみ',
      productionBottles: 0,
      operationTimeMin: waterTime,
      totalKwh: waterKwh,
      kwhPerMinute: waterTime > 0 ? round(waterKwh / waterTime, 3) : 0.0,
      kwhPerBottle: 0.0,
      costPerBottleYen: 0.0
    };

    // 3. 実充填のみ
    const fillingOnly = {
      mode: '実充填のみ',
      productionBottles: bottles,
      operationTimeMin: fillingTime,
      totalKwh: fillingKwh,
      kwhPerMinute: fillingTime > 0 ? round(fillingKwh / fillingTime, 3) : 0.0,
      kwhPerBottle: bottles > 0 ? round(fillingKwh / bottles, 4) : 0.0,
      costPerBottleYen: bottles > 0 && unitPrice > 0 ? round((fillingKwh / bottles) * unitPrice, 2) : 0.0
    };

    return {
      electricitySummary: {
        usedKwhThousand: electricityData.usedKwhThousand || 0,
        costThousandYen: electricityData.costThousandYen || 0,
        unitPriceYenPerKwh: round(unitPrice, 4)
      },
      evaluation: {
        combined,
        waterOnly,
        fillingOnly
      }
    };
  }

  function round(num, decimals = 2) {
    if (isNaN(num) || num === null) return 0;
    const factor = Math.pow(10, decimals);
    return Math.round(num * factor) / factor;
  }

  return {
    calculateKpi
  };
}));
