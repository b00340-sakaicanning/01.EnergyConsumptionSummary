/**
 * gas_app/js/etl/excelReader.js
 * 外部Excel (月報PET, かつらぎ工場エネルギー計算表) 解析モジュール
 * ブラウザ環境 (SheetJS / XLSX) および Node.js 環境両対応
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    let XLSX;
    try { XLSX = require('xlsx'); } catch(e) {}
    module.exports = factory(XLSX);
  } else {
    root.ExcelReader = factory(root.XLSX);
  }
}(typeof self !== 'undefined' ? self : this, function (XLSXLib) {

  /**
   * かつらぎ工場エネルギー計算表から特定年月の電気料金データを抽出する
   * @param {ArrayBuffer|Uint8Array|Workbook} workbookData
   * @param {string} yearMonth 'YYYYMM' (例: '202404', '202503')
   * @returns {Object} { usedKwhThousand, costThousandYen, unitPriceYenPerKwh }
   */
  function parseEnergyCalculationTable(workbookData, yearMonth) {
    const XLSX = XLSXLib || (typeof window !== 'undefined' ? window.XLSX : (typeof global !== 'undefined' ? global.XLSX : null));
    if (!XLSX) {
      throw new Error('SheetJS (XLSX) library is not loaded');
    }

    const wb = typeof workbookData.Sheets === 'object' ? workbookData : XLSX.read(workbookData, { type: 'array' });
    const targetMonth = parseInt(yearMonth.slice(4, 6), 10); // 1〜12
    const targetYear = parseInt(yearMonth.slice(0, 4), 10);
    const nendo = targetMonth >= 4 ? targetYear : targetYear - 1; // 2024年度

    let usedKwh = null;
    let costThousand = null;

    // 1. 対象年度シートの優先探索 (例: '2024' を最優先)
    let targetSheetName = wb.SheetNames.find(name => name.trim() === String(nendo));
    if (!targetSheetName) {
      targetSheetName = wb.SheetNames.find(name => name.includes(String(nendo)));
    }
    if (!targetSheetName) {
      targetSheetName = wb.SheetNames.find(name => name.includes('年度推移') || name.includes('電力量'));
    }
    if (!targetSheetName && wb.SheetNames.length > 0) {
      targetSheetName = wb.SheetNames[0];
    }

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
      unitPriceYenPerKwh: unitPrice
    };
  }

  /**
   * 月報PETから特定年月の品種別生産本数を抽出する
   * @param {ArrayBuffer|Uint8Array|Workbook} workbookData
   * @param {string} yearMonth 'YYYYMM'
   * @returns {Object} { totalBottles, varieties: { '101': count, ... } }
   */
  function parsePetMonthlyReport(workbookData, yearMonth) {
    const XLSX = XLSXLib || (typeof window !== 'undefined' ? window.XLSX : (typeof global !== 'undefined' ? global.XLSX : null));
    if (!XLSX) {
      throw new Error('SheetJS (XLSX) library is not loaded');
    }

    const wb = typeof workbookData.Sheets === 'object' ? workbookData : XLSX.read(workbookData, { type: 'array' });
    const targetMonth = parseInt(yearMonth.slice(4, 6), 10);
    const targetYear = parseInt(yearMonth.slice(0, 4), 10);
    const nendo = targetMonth >= 4 ? targetYear : targetYear - 1;

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
    let targetSheetName = wb.SheetNames.find(name => name.includes(String(nendo)));
    if (!targetSheetName) {
      targetSheetName = wb.SheetNames.find(name => name.includes(String(targetYear)));
    }
    if (!targetSheetName && wb.SheetNames.length > 0) {
      targetSheetName = wb.SheetNames[0];
    }

    if (targetSheetName) {
      const ws = wb.Sheets[targetSheetName];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });

      // パターンA: 12列横並びブロック帳票 (4月=Col B(1), 5月=Col N(13), 6月=Col Z(25) ...)
      const order = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
      const mIdx = order.indexOf(targetMonth);
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

        // 2. 品種合算マッピング設定の取得 (Config.gs / AppConfig 準拠)
        const varietyMapping = (typeof AppConfig !== 'undefined' && AppConfig.VARIETY_MAPPING) ||
          (typeof CONFIG !== 'undefined' && CONFIG.VARIETY_MAPPING) || {
            '2.0L': ['2.0L', '2L'],
            '1.5L': ['1.5L'],
            '1.0L': ['1.0L長角', '1.0L正角', '1.0L', '1L'],
            '600mL丸': ['600mL丸', '600ml丸'],
            '500mL丸': ['500mL丸', '500ml丸', '550mL丸', '550ml丸'],
            '500mL角': ['500mL角', '500ml角'],
            '350mL': ['350mL', '350ml'],
            '280mL': ['280mL', '280ml']
          };

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

      // パターンB: 従来のフォールバック走査
      if (totalBottles === 0) {
        const monthColIdx = getFiscalMonthColIndex(targetMonth);
        for (let r = 0; r < data.length; r++) {
          const row = data[r] || [];
          const nameCell = String(row[0] || row[1] || '');
          if (nameCell.includes('本数') || nameCell.includes('実績（本') || nameCell.includes('長角') || nameCell.includes('丸')) {
            const val = parseFloat(row[monthColIdx]);
            if (!isNaN(val) && val > 0) {
              totalBottles += val;
            }
          }
        }
      }
    }

    return {
      yearMonth,
      totalBottles,
      varieties
    };
  }

  /**
   * 4月始まりの年度月インデックス（4月=2, 5月=3 ... 3月=13 等の目安）
   */
  function getFiscalMonthColIndex(calendarMonth) {
    // 4月: 0, 5月: 1, ..., 12月: 8, 1月: 9, 2月: 10, 3月: 11 (オフセット調整用)
    const order = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
    const idx = order.indexOf(calendarMonth);
    return idx >= 0 ? idx + 2 : 2; // ヘッダー列等を考慮して通常+2列目以降
  }

  return {
    parseEnergyCalculationTable,
    parsePetMonthlyReport
  };
}));
