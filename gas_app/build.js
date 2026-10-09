/**
 * gas_app/build.js
 * Google Apps Scriptデプロイ用 & ローカル実行用 自己完結型 index.html ビルダー
 * 
 * CSS (css/style.css) および 全JavaScript (js/*.js) を index.template.html 内にインライン統合し、
 * GASエディタ側で index.html を貼り付けるだけで100%確実に動作する単一HTMLファイルを生成します。
 */

const fs = require('fs');
const path = require('path');

const baseDir = __dirname;

function build() {
  console.log('Building gas_app/index.html (Self-contained standalone)...');

  const templatePath = path.join(baseDir, 'index.template.html');
  if (!fs.existsSync(templatePath)) {
    console.error('Error: index.template.html not found!');
    process.exit(1);
  }

  let html = fs.readFileSync(templatePath, 'utf8');

  // 1. CSSのインライン統合
  const cssPath = path.join(baseDir, 'css', 'style.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');
  const styleTag = `<style>\n${cssContent}\n</style>`;

  // CSSリンクおよび既存のstyleタグ領域を置換
  const cssRegex = /<!-- CSSスタイル -->[\s\S]*?<\/head>/;
  const newHeadCss = `<!-- CSSスタイル (インライン統合・GAS完全互換) -->\n  ${styleTag}\n</head>`;
  html = html.replace(cssRegex, newHeadCss);

  // 2. JavaScriptのインライン統合 (依存関係順)
  const jsFiles = [
    'js/config.js',
    'js/etl/csvParser.js',
    'js/etl/hourlyAggregator.js',
    'js/etl/excelReader.js',
    'js/services/categoryService.js',
    'js/services/kpiService.js',
    'js/services/annualService.js',
    'js/services/fuelService.js',
    'js/services/totalEnergyService.js',
    'js/components/charts.js',
    'js/fuelView.js',
    'js/totalEnergyView.js',
    'js/app.js'
  ];

  let scriptsBundle = '\n  <!-- JavaScriptスクリプト (インライン統合・GAS完全互換) -->\n';
  jsFiles.forEach(relPath => {
    const fullPath = path.join(baseDir, relPath);
    if (fs.existsSync(fullPath)) {
      const code = fs.readFileSync(fullPath, 'utf8');
      scriptsBundle += `  <script>\n/* === ${relPath} === */\n${code}\n  </script>\n`;
    } else {
      console.warn(`Warning: File not found: ${relPath}`);
    }
  });

  // スクリプト読み込み領域（「スクリプト読み込み」コメントから </body> 直前まで）を置換
  const scriptRegex = /<!-- スクリプト読み込み[\s\S]*?<\/body>/;
  html = html.replace(scriptRegex, `${scriptsBundle}</body>`);

  const outputPath = path.join(baseDir, 'index.html');
  fs.writeFileSync(outputPath, html, 'utf8');

  console.log(`Success! Generated: ${outputPath} (${(html.length / 1024).toFixed(1)} KB)`);
}

build();
