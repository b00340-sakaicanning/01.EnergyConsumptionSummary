/**
 * tests/test_etl_runner.js
 * 実際の2025年3月度生データ(reference/読込用データ/CSVデータ/2024年度/202503/)を読み込み、
 * csvParser と hourlyAggregator を実行して出力を検証するテストスクリプト。
 */

const fs = require('fs');
const path = require('path');
const CsvParser = require('../gas_app/js/etl/csvParser.js');
const HourlyAggregator = require('../gas_app/js/etl/hourlyAggregator.js');

const BASE_DIR = path.resolve(__dirname, '..');
const INPUT_DIR = path.join(BASE_DIR, 'reference', '読込用データ', 'CSVデータ', '2024年度', '202503');
const OUTPUT_TEST_JSON = path.join(BASE_DIR, 'tests', 'test_output_202503.json');

console.log('=== Running ETL Runner Test ===');
console.log(`Input Directory: ${INPUT_DIR}`);

// 1. 日別ロガーファイル (AQyyyymmdd_00N.TXT / tag02, 04, 05, 06, 07) を読み込み
const targetFiles = fs.existsSync(INPUT_DIR)
  ? fs.readdirSync(INPUT_DIR).filter(fname => /^AQ\d{8}_\d{3}\.TXT$/i.test(fname)).sort()
  : [];

// 入力が無い状態で実行すると全ゼロの出力で上書きしてしまうため、ここで中断する
if (targetFiles.length === 0) {
  console.error(`Error: 入力ファイルが見つかりません: ${INPUT_DIR}`);
  process.exit(1);
}

const loadedFiles = [];
for (const fname of targetFiles) {
  const content = fs.readFileSync(path.join(INPUT_DIR, fname), 'utf8');
  loadedFiles.push({ fileName: fname, content });
}
console.log(`Loaded ${loadedFiles.length} files.`);

console.log(`\nParsing and Merging ${loadedFiles.length} files...`);
const startTime = Date.now();
const mergedRecords = CsvParser.mergeTagFiles(loadedFiles);
const mergeDuration = ((Date.now() - startTime) / 1000).toFixed(2);
console.log(`Merged ${mergedRecords.size.toLocaleString()} 1-minute records in ${mergeDuration}s.`);

// 2. 1時間集約と2段階欠損補正を実行
console.log('\nAggregating to 1-hour intervals with 2-step imputation...');
const aggStartTime = Date.now();
const aggResult = HourlyAggregator.aggregateHourly(mergedRecords, '202503');
const aggDuration = ((Date.now() - aggStartTime) / 1000).toFixed(2);
console.log(`Aggregated to ${aggResult.rows.length} hourly rows in ${aggDuration}s.`);

// 3. カテゴリ集約 (Phase 3: Task 3.1)
console.log('\nAggregating categories (total, chiller, mixing, supply, filling, packaging)...');
const CategoryService = require('../gas_app/js/services/categoryService.js');
const catResult = CategoryService.aggregateCategories(aggResult.rows, aggResult.monthlyColumnSums);

const categoryTotalsMap = {};
for (const [name, info] of Object.entries(catResult.categoryMonthlyTotals)) {
  categoryTotalsMap[name] = info.grandTotal;
  console.log(`  - ${name}: ${info.grandTotal.toLocaleString()} kWh`);
}

// 4. KPI計算 (Phase 3: Task 3.2)
console.log('\nCalculating KPI (production & electricity unit metrics)...');
const KpiService = require('../gas_app/js/services/kpiService.js');
const kpiResult = KpiService.calculateKpi(
  catResult.categoryMonthlyTotals,
  catResult.monthlyOperationTimes,
  { totalBottles: 0 },
  { usedKwhThousand: 288.075, costThousandYen: 6176.992, unitPriceYenPerKwh: 21.4423 }
);

const finalOutput = {
  yearMonth: aggResult.yearMonth,
  totalHours: aggResult.totalHours,
  rows: aggResult.rows,
  monthlyColumnSums: aggResult.monthlyColumnSums,
  category_totals: categoryTotalsMap,
  categoryDailyTotals: catResult.categoryDailyTotals,
  kpi: kpiResult
};

// 5. テスト用JSONとして書き出し
fs.writeFileSync(OUTPUT_TEST_JSON, JSON.stringify(finalOutput, null, 2), 'utf8');
console.log(`\nTest output saved to: ${OUTPUT_TEST_JSON}`);

console.log('ETL & Service Runner finished successfully.');

