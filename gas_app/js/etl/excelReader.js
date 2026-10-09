/**
 * gas_app/js/etl/excelReader.js
 * 外部Excel (月報PET, かつらぎ工場エネルギー計算表) 解析モジュール
 * ブラウザ環境 (SheetJS / XLSX) および Node.js 環境両対応
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    let XLSX;
    try { XLSX = require('xlsx'); } catch(e) {}
    module.exports = factory(XLSX, require('../config.js'));
  } else {
    root.ExcelReader = factory(root.XLSX, root.AppConfig);
  }
}(typeof self !== 'undefined' ? self : this, function (XLSXLib, AppConfig) {

  /**
   * 対象年度のシート名を探す
   * シート名が年度と完全一致するものを優先し、無ければ年度の数字を含むもの (例: '月報PET(2024）') を返す。
   * 見つからない場合に他のシートで代用すると、別の年度の値を取り込んでしまうため、代用はしない
   * @param {Array<string>} sheetNames
   * @param {number} fiscalYear 年度 (例: 2024)
   * @returns {string|undefined} 見つからない場合は undefined
   */
  function findFiscalYearSheet(sheetNames, fiscalYear) {
    const fy = String(fiscalYear);
    const exact = sheetNames.find(name => name.trim() === fy);
    if (exact) return exact;
    // 他の数字の一部として含まれる場合 (例: '20245') は対象にしない
    const pattern = new RegExp(`(^|\\D)${fy}(\\D|$)`);
    return sheetNames.find(name => pattern.test(name));
  }

  /**
   * ワークブックに年度のシートがある年度を列挙する (シート名に含まれる4桁の年度。例: '2024'、'月報PET(2024）')
   * @param {Workbook} workbook
   * @returns {number[]} 年度の昇順
   */
  function listSheetFiscalYears(workbook) {
    const years = new Set();
    ((workbook && workbook.SheetNames) || []).forEach(name => {
      const m = String(name).match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
      if (m) years.add(parseInt(m[1], 10));
    });
    return Array.from(years).sort((a, b) => a - b);
  }

  /**
   * かつらぎ工場エネルギー計算表から特定年月の電気料金データを抽出する
   * @param {ArrayBuffer|Uint8Array|Workbook} workbookData
   * @param {string} yearMonth 'YYYYMM' (例: '202404', '202503')
   * @returns {Object} { usedKwhThousand, costThousandYen, unitPriceYenPerKwh, sheetFound }
   *   対象年度のシートが無い場合は sheetFound が false で、各値は null
   */
  function parseEnergyCalculationTable(workbookData, yearMonth) {
    const XLSX = XLSXLib || (typeof window !== 'undefined' ? window.XLSX : (typeof global !== 'undefined' ? global.XLSX : null));
    if (!XLSX) {
      throw new Error('SheetJS (XLSX) library is not loaded');
    }

    const wb = typeof workbookData.Sheets === 'object' ? workbookData : XLSX.read(workbookData, { type: 'array' });
    const targetMonth = parseInt(yearMonth.slice(4, 6), 10); // 1〜12
    const targetYear = parseInt(yearMonth.slice(0, 4), 10);
    const nendo = AppConfig.getFiscalYear(targetYear, targetMonth); // 2024年度

    let usedKwh = null;
    let costThousand = null;

    // 1. 対象年度シートの探索 (例: '2024')
    const targetSheetName = findFiscalYearSheet(wb.SheetNames, nendo);

    if (targetSheetName) {
      const ws = wb.Sheets[targetSheetName];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
      const monthColIdx = getFiscalMonthColIndex(targetMonth);

      for (let r = 0; r < data.length; r++) {
        const row = data[r] || [];
        const colA = String(row[0] || '').trim();
        const colB = String(row[1] || '').trim();
        const text = row.map(c => String(c || '')).join(' ');

        // 使用電力（昼間・夜間等の内訳行を除外して正味の月間使用電力を取得）
        if ((colA.includes('使用電力') || colB.includes('使用電力') || text.includes('使用電力')) &&
            !colA.includes('昼間') && !colA.includes('夜間') && !text.includes('昼間') && !text.includes('夜間')) {
          if (row[monthColIdx] !== undefined) {
            const val = parseFloat(row[monthColIdx]);
            if (!isNaN(val) && val > 0) usedKwh = val;
          }
        }

        // 使用量（千円）（請求金額）
        if (colB.includes('使用量（千円）') || (colA.includes('※税込み') && colB.includes('使用量')) || text.includes('使用量（千円）') || text.includes('請求金額')) {
          if (row[monthColIdx] !== undefined) {
            const val = parseFloat(row[monthColIdx]);
            if (!isNaN(val) && val > 0) costThousand = val;
          }
        }
      }
    }

    const unitPrice = (usedKwh && costThousand && usedKwh > 0) ? (costThousand / usedKwh) : null;

    return {
      yearMonth,
      usedKwhThousand: usedKwh,
      costThousandYen: costThousand,
      unitPriceYenPerKwh: unitPrice,
      sheetFound: !!targetSheetName
    };
  }

  /**
   * 月報PETから特定年月の品種別生産本数を抽出する
   * @param {ArrayBuffer|Uint8Array|Workbook} workbookData
   * @param {string} yearMonth 'YYYYMM'
   * @returns {Object} { totalBottles, varieties: { '2.0L': count, ... }, sheetFound }
   *   対象年度のシートが無い場合は sheetFound が false、対象月が未入力の場合は totalBottles が 0
   */
  function parsePetMonthlyReport(workbookData, yearMonth) {
    const XLSX = XLSXLib || (typeof window !== 'undefined' ? window.XLSX : (typeof global !== 'undefined' ? global.XLSX : null));
    if (!XLSX) {
      throw new Error('SheetJS (XLSX) library is not loaded');
    }

    const wb = typeof workbookData.Sheets === 'object' ? workbookData : XLSX.read(workbookData, { type: 'array' });
    const targetMonth = parseInt(yearMonth.slice(4, 6), 10);
    const targetYear = parseInt(yearMonth.slice(0, 4), 10);
    const nendo = AppConfig.getFiscalYear(targetYear, targetMonth);

    const varieties = {};
    let totalBottles = 0;

    function normalizeString(str) {
      if (!str) return '';
      return String(str)
        .normalize('NFKC')
        .replace(/[\s\u3000]/g, '');
    }

    function matchVarietyGroup(cellText, mapping) {
      const norm = normalizeString(cellText);
      if (!norm) return null;
      for (const [groupKey, patterns] of Object.entries(mapping)) {
        for (const p of patterns) {
          const pNorm = normalizeString(p);
          if (pNorm && norm.includes(pNorm)) {
            return groupKey;
          }
        }
      }
      return null;
    }

    // 1. 年度シートの探索 (例: '月報PET(2024）', 'PET(2024 4-3)', '2024')
    const targetSheetName = findFiscalYearSheet(wb.SheetNames, nendo);

    if (targetSheetName) {
      const ws = wb.Sheets[targetSheetName];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });

      // 12列横並びブロック帳票 (4月=Col B(1), 5月=Col N(13), 6月=Col Z(25) ...)
      // 対象月のブロック内に値が無い場合は 0 のままとする (ブロックの外を探すと、無関係なセルの値を拾ってしまう)
      const mIdx = AppConfig.FISCAL_MONTH_ORDER.indexOf(targetMonth);
      if (mIdx >= 0) {
        const baseCol = mIdx * 12 + 1; // 各月ブロック開始列 (B=1, N=13, Z=25...)

        // 1. 合計本数の特定 (Row 4-6 の「実績（本）」セル、通常 baseCol + 1 列)
        for (let r = 0; r < Math.min(data.length, 10); r++) {
          const row = data[r] || [];
          const label = normalizeString(row[baseCol]);
          if (label.includes('実績(本') || label.includes('実績（本') || label.includes('本数')) {
            const val = parseFloat(row[baseCol + 1]);
            if (!isNaN(val) && val > 0) {
              totalBottles = val;
              break;
            }
          }
        }
        if (totalBottles === 0 && data[4]) {
          const val4 = parseFloat(data[4][baseCol + 1]);
          if (!isNaN(val4) && val4 > 0) {
            totalBottles = val4;
          }
        }

        // 2. 品種合算マッピング設定の取得 (起動時にGAS側 Config.gs の値で上書きされるため、呼び出しの都度参照する)
        const varietyMapping = AppConfig.VARIETY_MAPPING;

        let vSum = 0;
        let r = 10;
        while (r < Math.min(data.length, 110)) {
          const row = data[r] || [];
          // 品種名の検出 (baseCol + 2 列[D列等] を主とし、近傍列も確認)
          const cellVName = row[baseCol + 2] || row[baseCol + 1] || row[baseCol] || '';
          const matchedGroup = matchVarietyGroup(cellVName, varietyMapping);

          if (matchedGroup) {
            let currIri = 0;
            let currCs = 0;
            let currFill = 0;

            // 品種見出し直下のブロック内（1〜7行）を走査
            for (let offset = 1; offset <= 7; offset++) {
              const subR = r + offset;
              if (subR >= data.length) break;
              const subRow = data[subR] || [];

              // 左側ブロック (baseCol: ラベル, baseCol + 1: 数値)
              const lblLeft = normalizeString(subRow[baseCol] || '');
              const valLeft = parseFloat(subRow[baseCol + 1]);
              if (lblLeft.includes('入数') && !isNaN(valLeft)) {
                currIri = valLeft;
              }
              if ((lblLeft.includes('実績(C/S') || lblLeft.includes('実績(CS')) && !isNaN(valLeft)) {
                currCs = valLeft;
              }

              // 右側ブロック (充填本数: baseCol + 8 見出し, baseCol + 9 数値)
              let valRight = NaN;
              const lblRight = normalizeString(subRow[baseCol + 8] || '');
              if (lblRight.includes('充填本数')) {
                valRight = parseFloat(subRow[baseCol + 9]);
              } else {
                // 各月ブロック内を行走査して「充填本数」を検索
                for (let c = baseCol; c < Math.min(subRow.length, baseCol + 12); c++) {
                  if (normalizeString(subRow[c]).includes('充填本数')) {
                    valRight = parseFloat(subRow[c + 1]);
                    break;
                  }
                }
              }
              if (!isNaN(valRight) && valRight > 0) {
                currFill = valRight;
              }
            }

            // 本数の決定:
            // 1) 充填本数セルに正の数値がある場合はそれを採用
            // 2) 空欄または0の場合は、入数 × 実績(C/S) で算出してフォールバック
            let bottleCount = 0;
            if (currFill > 0) {
              bottleCount = currFill;
            } else if (currIri > 0 && currCs > 0) {
              bottleCount = Math.round(currIri * currCs);
            }

            if (bottleCount > 0) {
              varieties[matchedGroup] = (varieties[matchedGroup] || 0) + bottleCount;
              vSum += bottleCount;
            }

            r += 6; // 次の品種ブロックへ進める
          } else {
            r++;
          }
        }

        if (totalBottles === 0 && vSum > 0) {
          totalBottles = vSum;
        }
      }
    }

    return {
      yearMonth,
      totalBottles,
      varieties,
      sheetFound: !!targetSheetName
    };
  }

  // ラベルの比較用: 全角・半角を揃え、空白を除く
  const normalizeLabel = v => (v === undefined || v === null) ? '' : String(v).normalize('NFKC').replace(/[\s　]/g, '');
  // セルの値を数値にする (空欄や文字列は null)
  const cellToNumber = v => {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim() !== '' && !isNaN(parseFloat(v))) return parseFloat(v);
    return null;
  };

  /**
   * エネルギー計算表の年度シートを開き、月見出し行と、A列のラベルによる区間 (A重油 → LNG → 使用電力) を特定する
   * (燃料・トータルエネルギーの読み取りの共通処理。行番号は年度によって変わるため、ラベルで探す)
   * @param {ArrayBuffer|Uint8Array|Workbook} workbookData
   * @param {number|string} fiscalYear 年度 (例: 2024 → 2024年4月〜2025年3月)
   * @returns {Object} { fiscalYear, sheetFound, sectionsFound, data, monthCols, headerRowIdx, oilStart, lngStart, powerStart, findRow, valueAt }
   *   sheetFound: 対象年度のシートがあるか / sectionsFound: 月見出し行と3つの区間を特定できたか
   *   monthCols: [{ ym, col }] (4月〜翌3月) / findRow(from, to, predicate): 条件に合う最初の行 (無ければ -1) / valueAt(rowIdx, col): 数値または null
   */
  function openEnergyYearSheet(workbookData, fiscalYear) {
    const XLSX = XLSXLib || (typeof window !== 'undefined' ? window.XLSX : (typeof global !== 'undefined' ? global.XLSX : null));
    if (!XLSX) {
      throw new Error('SheetJS (XLSX) library is not loaded');
    }

    const wb = typeof workbookData.Sheets === 'object' ? workbookData : XLSX.read(workbookData, { type: 'array' });
    const fy = parseInt(fiscalYear, 10);
    const sheet = { fiscalYear: fy, sheetFound: false, sectionsFound: false };

    const targetSheetName = findFiscalYearSheet(wb.SheetNames, fy);
    if (!targetSheetName) return sheet;
    sheet.sheetFound = true;

    const data = XLSX.utils.sheet_to_json(wb.Sheets[targetSheetName], { header: 1, raw: true });
    sheet.data = data;
    sheet.findRow = (from, to, predicate) => {
      for (let r = Math.max(from, 0); r < Math.min(to, data.length); r++) {
        if (predicate(data[r] || [])) return r;
      }
      return -1;
    };
    sheet.valueAt = (rowIdx, col) => rowIdx < 0 ? null : cellToNumber((data[rowIdx] || [])[col]);

    // 対象年度の年月 (4月〜翌3月) と、その列位置
    sheet.monthCols = AppConfig.FISCAL_MONTH_ORDER.map(m => ({
      ym: `${m >= 4 ? fy : fy + 1}${String(m).padStart(2, '0')}`,
      col: getFiscalMonthColIndex(m)
    }));

    // 1. 月見出し行: 12か月分の列に、対象年度の各月の日付 (Excelのシリアル値) が並ぶ行
    const serialToYm = serial => {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
      return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    };
    sheet.headerRowIdx = sheet.findRow(0, 60, row => sheet.monthCols.every(mc => typeof row[mc.col] === 'number' && serialToYm(row[mc.col]) === mc.ym));
    if (sheet.headerRowIdx < 0) return sheet;

    // 2. A列のラベルで区間を特定 (A重油 → LNG → 使用電力 の順に並ぶ)
    sheet.oilStart = sheet.findRow(sheet.headerRowIdx + 1, data.length, row => normalizeLabel(row[0]) === 'A重油');
    sheet.lngStart = sheet.oilStart < 0 ? -1 : sheet.findRow(sheet.oilStart + 1, data.length, row => normalizeLabel(row[0]) === 'LNG');
    sheet.powerStart = sheet.lngStart < 0 ? -1 : sheet.findRow(sheet.lngStart + 1, data.length, row => normalizeLabel(row[0]).indexOf('使用電力') === 0);
    sheet.sectionsFound = sheet.oilStart >= 0 && sheet.lngStart >= 0 && sheet.powerStart >= 0;
    return sheet;
  }

  const isHeatRow = row => normalizeLabel(row[1]) === '熱量GJ';
  const isCo2Row = row => normalizeLabel(row[1]) === 't-CO2';

  /**
   * かつらぎ工場エネルギー計算表から、対象年度の燃料 (A重油・LNG) の月別データを抽出する
   *
   * 年度シートの月見出し行より下を、A列の「A重油」「LNG」「使用電力」で区間に分け、
   * 各区間の中で B列が「熱量GJ」の行と「購入費用（千円）」で始まる行を読む。
   * 行番号は年度によって変わるため固定しない。「A重油(本社）」の費用や、電気・太陽光の熱量GJは区間・ラベルの条件で対象外になる
   *
   * @param {ArrayBuffer|Uint8Array|Workbook} workbookData
   * @param {number|string} fiscalYear 年度 (例: 2024 → 2024年4月〜2025年3月)
   * @returns {Object} { fiscalYear, sheetFound, layoutFound, months: { [ym]: { heavyOilGj, lngGj, heavyOilCostThousandYen, lngCostThousandYen } } }
   *   sheetFound: 対象年度のシートがあるか / layoutFound: 必要な行をすべて特定できたか (false の場合 months は空)
   *   各値は数値。セルが空欄の場合は null
   */
  function parseFuelEnergyTable(workbookData, fiscalYear) {
    const sheet = openEnergyYearSheet(workbookData, fiscalYear);
    const result = { fiscalYear: sheet.fiscalYear, sheetFound: sheet.sheetFound, layoutFound: false, months: {} };
    if (!sheet.sectionsFound) return result;
    const { monthCols, oilStart, lngStart, powerStart, findRow, valueAt } = sheet;

    // 各区間の中で、熱量と購入費用の行を特定
    const isCostRow = row => normalizeLabel(row[1]).indexOf('購入費用(千円)') === 0;
    const oilHeatRow = findRow(oilStart, lngStart, isHeatRow);
    const oilCostRow = findRow(oilStart, lngStart, isCostRow);
    const lngHeatRow = findRow(lngStart, powerStart, isHeatRow);
    const lngCostRow = findRow(lngStart, powerStart, isCostRow);
    if (oilHeatRow < 0 || oilCostRow < 0 || lngHeatRow < 0) return result;

    // LNGの購入費用の行が無い年度は、LNGを使っていない (熱量がすべて0) 場合に限り読み取り可とする
    if (lngCostRow < 0 && monthCols.some(mc => (valueAt(lngHeatRow, mc.col) || 0) > 0)) return result;

    result.layoutFound = true;
    monthCols.forEach(mc => {
      result.months[mc.ym] = {
        heavyOilGj: valueAt(oilHeatRow, mc.col),
        lngGj: valueAt(lngHeatRow, mc.col),
        heavyOilCostThousandYen: valueAt(oilCostRow, mc.col),
        lngCostThousandYen: valueAt(lngCostRow, mc.col)
      };
    });
    return result;
  }

  /**
   * かつらぎ工場エネルギー計算表から、対象年度のトータルエネルギー (生産数量・熱量・原油換算量・CO2) の月別データを抽出する
   *
   * 熱量・CO2・原油換算量の係数は年度によって違うため、再計算せず、シート上で計算済みの行の値を読む。
   * 行は次のラベルで探す (行番号は年度によって変わるため固定しない)。
   * - A重油・LNG・使用電力の各区間の、B列が「熱量GJ」「t-CO2」の行 (電気は「熱量GJ（昼間）」などを除く合計の行)
   * - A列が「合計GJ」「合計t-CO2」「合計GJ原油換算量」の行 (それぞれ最初に現れる行。2023年度以降は「太陽光発電 無しの想定値」の同名の行が後に続く)
   * - A列が「生産数量」で B列が「ケース」の行、A列が「PET生産量」の行の B列 (1ケースあたりの容量 L)
   * - A列が「太陽光発電量」の区間 (2023年度以降のみ) の発電量・熱量GJ・t-CO2
   *
   * @param {ArrayBuffer|Uint8Array|Workbook} workbookData
   * @param {number|string} fiscalYear 年度
   * @returns {Object} { fiscalYear, sheetFound, layoutFound, hasSolar, months: { [ym]: {...} } }
   *   months[ym]: { productionCases, litersPerCase, heavyOilGj, lngGj, electricityGj, totalGj, crudeOilKl,
   *                 heavyOilCo2, lngCo2, electricityCo2, totalCo2, solarKwhThousand, solarGj, solarCo2, noSolarCrudeOilKl }
   *   各値は数値。セルが空欄、または行が無い場合は null (太陽光の項目は、太陽光の行が無い年度では null)
   */
  function parseTotalEnergyTable(workbookData, fiscalYear) {
    const sheet = openEnergyYearSheet(workbookData, fiscalYear);
    const result = { fiscalYear: sheet.fiscalYear, sheetFound: sheet.sheetFound, layoutFound: false, hasSolar: false, months: {} };
    if (!sheet.sectionsFound) return result;
    const { data, monthCols, oilStart, lngStart, powerStart, findRow, valueAt } = sheet;
    const labelA = row => normalizeLabel(row[0]);

    // 合計の3行 (使用電力の区間より下で、最初に現れるもの)
    const totalGjRow = findRow(powerStart + 1, data.length, row => labelA(row) === '合計GJ');
    const totalCo2Row = totalGjRow < 0 ? -1 : findRow(totalGjRow + 1, totalGjRow + 8, row => labelA(row) === '合計t-CO2');
    const crudeOilRow = totalGjRow < 0 ? -1 : findRow(totalGjRow + 1, totalGjRow + 8, row => labelA(row) === '合計GJ原油換算量');
    if (totalGjRow < 0 || totalCo2Row < 0 || crudeOilRow < 0) return result;

    // 使用電力の区間 (太陽光発電量の行があれば、その手前まで)
    const solarStart = findRow(powerStart + 1, totalGjRow, row => labelA(row).indexOf('太陽光発電量') === 0);
    const powerEnd = solarStart >= 0 ? solarStart : totalGjRow;

    const oilHeatRow = findRow(oilStart, lngStart, isHeatRow);
    const lngHeatRow = findRow(lngStart, powerStart, isHeatRow);
    const powerHeatRow = findRow(powerStart, powerEnd, isHeatRow);
    const productionRow = findRow(crudeOilRow + 1, data.length, row => labelA(row) === '生産数量' && normalizeLabel(row[1]) === 'ケース');
    if (oilHeatRow < 0 || lngHeatRow < 0 || powerHeatRow < 0 || productionRow < 0) return result;

    const oilCo2Row = findRow(oilStart, lngStart, isCo2Row);
    const lngCo2Row = findRow(lngStart, powerStart, isCo2Row);
    const powerCo2Row = findRow(powerStart, powerEnd, isCo2Row);
    const solarHeatRow = solarStart < 0 ? -1 : findRow(solarStart, totalGjRow, isHeatRow);
    const solarCo2Row = solarStart < 0 ? -1 : findRow(solarStart, totalGjRow, isCo2Row);

    // 太陽光発電 無しの想定値の原油換算量 (合計の3行のすぐ下にある、同名の行)
    const noSolarLabelRow = solarStart < 0 ? -1 : findRow(crudeOilRow + 1, crudeOilRow + 4, row => labelA(row).indexOf('太陽光発電無しの想定値') === 0);
    const noSolarCrudeOilRow = noSolarLabelRow < 0 ? -1 : findRow(noSolarLabelRow + 1, noSolarLabelRow + 6, row => labelA(row) === '合計GJ原油換算量');

    // 1ケースあたりの容量 (L)。「PET生産量」の行の B列。読めない場合は 12L
    const petRow = findRow(crudeOilRow + 1, productionRow + 1, row => labelA(row) === 'PET生産量');
    const litersPerCase = (petRow >= 0 && cellToNumber((data[petRow] || [])[1]) > 0) ? cellToNumber(data[petRow][1]) : 12;

    result.layoutFound = true;
    result.hasSolar = solarStart >= 0;
    monthCols.forEach(mc => {
      result.months[mc.ym] = {
        productionCases: valueAt(productionRow, mc.col),
        litersPerCase: litersPerCase,
        heavyOilGj: valueAt(oilHeatRow, mc.col),
        lngGj: valueAt(lngHeatRow, mc.col),
        electricityGj: valueAt(powerHeatRow, mc.col),
        totalGj: valueAt(totalGjRow, mc.col),
        crudeOilKl: valueAt(crudeOilRow, mc.col),
        heavyOilCo2: valueAt(oilCo2Row, mc.col),
        lngCo2: valueAt(lngCo2Row, mc.col),
        electricityCo2: valueAt(powerCo2Row, mc.col),
        totalCo2: valueAt(totalCo2Row, mc.col),
        solarKwhThousand: valueAt(solarStart, mc.col),
        solarGj: valueAt(solarHeatRow, mc.col),
        solarCo2: valueAt(solarCo2Row, mc.col),
        noSolarCrudeOilKl: valueAt(noSolarCrudeOilRow, mc.col)
      };
    });
    return result;
  }

  /**
   * 4月始まりの年度月インデックス（4月=2, 5月=3 ... 3月=13 等の目安）
   */
  function getFiscalMonthColIndex(calendarMonth) {
    // 4月: 0, 5月: 1, ..., 12月: 8, 1月: 9, 2月: 10, 3月: 11 (オフセット調整用)
    const idx = AppConfig.FISCAL_MONTH_ORDER.indexOf(calendarMonth);
    return idx >= 0 ? idx + 2 : 2; // ヘッダー列等を考慮して通常+2列目以降
  }

  return {
    listSheetFiscalYears,
    parseEnergyCalculationTable,
    parsePetMonthlyReport,
    parseFuelEnergyTable,
    parseTotalEnergyTable
  };
}));
