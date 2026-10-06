#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tests/extract_reference_truth.py
リファレンスExcelから2025年3月度の正解データを抽出し、tests/truth_202503.json に保存するスクリプト。
外部ライブラリ(openpyxl等)に依存せず、Python標準ライブラリ(zipfile, xml.etree.ElementTree)で動作。
"""

import os
import json
import zipfile
import xml.etree.ElementTree as ET

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF_XLSX = os.path.join(BASE_DIR, "reference", "2024年度3月度", "月別電力使用量集約(2025年3月).xlsx")
GRAPH_XLSX = os.path.join(BASE_DIR, "reference", "月別電力使用量集約グラフ表示(総電力 2024).xlsx")
OUTPUT_JSON = os.path.join(BASE_DIR, "tests", "truth_202503.json")

NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}

def read_shared_strings(z):
    shared_strings = []
    if "xl/sharedStrings.xml" in z.namelist():
        tree = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in tree.findall(f"{{{NS['s']}}}si"):
            texts = [elem.text for elem in si.findall(f".//{{{NS['s']}}}t") if elem.text]
            shared_strings.append("".join(texts))
    return shared_strings

def get_sheet_targets(z):
    wb_tree = ET.fromstring(z.read("xl/workbook.xml"))
    rels_tree = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rel_map = {r.attrib["Id"]: r.attrib["Target"] for r in rels_tree}
    
    sheet_map = {}
    for s in wb_tree.findall(f".//{{{NS['s']}}}sheet"):
        name = s.attrib["name"]
        rId = s.attrib[f"{{{NS['r']}}}id"]
        target = rel_map[rId]
        sheet_path = "xl/" + target if not target.startswith("xl/") else target
        sheet_map[name] = sheet_path
    return sheet_map

def parse_sheet_cells(z, sheet_path, shared_strings):
    tree = ET.fromstring(z.read(sheet_path))
    cells = {}
    for row in tree.findall(f".//{{{NS['s']}}}row"):
        r_num = int(row.attrib.get("r", 0))
        for c in row.findall(f"{{{NS['s']}}}c"):
            ref = c.attrib.get("r")
            t = c.attrib.get("t")
            v = c.find(f"{{{NS['s']}}}v")
            f = c.find(f"{{{NS['s']}}}f")
            val = ""
            if v is not None and v.text:
                if t == "s":
                    idx = int(v.text)
                    val = shared_strings[idx] if idx < len(shared_strings) else v.text
                else:
                    val = v.text
            cells[ref] = {
                "val": val,
                "formula": f.text if f is not None else None
            }
    return cells

def col_letter_to_index(col_letter):
    num = 0
    for c in col_letter:
        num = num * 26 + (ord(c.upper()) - ord('A') + 1)
    return num

def index_to_col_letter(col_idx):
    letters = []
    while col_idx > 0:
        rem = (col_idx - 1) % 26
        letters.append(chr(ord('A') + rem))
        col_idx = (col_idx - 1) // 26
    return "".join(reversed(letters))

def main():
    print(f"Reading: {REF_XLSX}")
    truth_data = {
        "year_month": "202503",
        "description": "Ground Truth data for 2025 March energy aggregation",
        "hourly_summary_all": {},
        "category_totals": {},
        "kpi": {}
    }

    with zipfile.ZipFile(REF_XLSX, "r") as z:
        shared_strings = read_shared_strings(z)
        sheet_targets = get_sheet_targets(z)

        # 1. Parse '1時間集計(ALL)'
        sheet_path = sheet_targets["1時間集計(ALL)"]
        all_cells = parse_sheet_cells(z, sheet_path, shared_strings)

        # Columns in 1時間集計(ALL): Row 5 has equipment names, Row 9 has tag IDs (e.g. D9='109')
        # Row 10 to 753 (744 hours)
        columns = {}
        for col_idx in range(col_letter_to_index("D"), col_letter_to_index("CO") + 1):
            col_letter = index_to_col_letter(col_idx)
            name_r5 = all_cells.get(f"{col_letter}5", {}).get("val", "").strip()
            name_r7 = all_cells.get(f"{col_letter}7", {}).get("val", "").strip()
            tag_id = all_cells.get(f"{col_letter}9", {}).get("val", "").strip()
            label = f"{name_r5} {name_r7}".strip() or f"col_{col_letter}"
            
            # Row 4 is total SUM
            total_sum = all_cells.get(f"{col_letter}4", {}).get("val", "")
            try:
                total_sum = round(float(total_sum), 2) if total_sum else 0.0
            except ValueError:
                pass

            columns[col_letter] = {
                "col": col_letter,
                "label": label,
                "tag_id": tag_id,
                "total_sum": total_sum
            }

        # Extract 744 hourly rows
        hourly_rows = []
        for r in range(10, 754):
            hour_idx = r - 10
            # A column: relative hour (0, 1, 2... 743)
            # B column: serial date or formula
            row_data = {
                "hour_index": hour_idx,
                "row_number": r,
                "values": {}
            }
            for col_letter in columns:
                v_str = all_cells.get(f"{col_letter}{r}", {}).get("val", "")
                try:
                    val = round(float(v_str), 1) if v_str != "" else None
                except ValueError:
                    val = v_str
                row_data["values"][col_letter] = val
            hourly_rows.append(row_data)

        truth_data["hourly_summary_all"] = {
            "columns": columns,
            "row_count": len(hourly_rows),
            "rows": hourly_rows
        }

        # 2. Category totals (総電力, チラー, 調合抽出, 供給, 充填, 包装)
        category_grand_cells = {
            "総電力": "BG4",
            "チラー": "E4",
            "調合抽出": "I4",
            "供給": "H4",
            "充填": "J4",
            "包装": "M4"
        }


        category_sheets = [
            ("総電力", "1時間集計(総電力用)"),
            ("チラー", "1時間集計(チラー)"),
            ("調合抽出", "1時間集計(調合抽出)"),
            ("供給", "1時間集計(供給)"),
            ("充填", "1時間集計(充填)"),
            ("包装", "1時間集計(包装)")
        ]
        for cat_name, sheet_name in category_sheets:
            if sheet_name in sheet_targets:
                cat_cells = parse_sheet_cells(z, sheet_targets[sheet_name], shared_strings)
                if cat_name in category_grand_cells:
                    cell_ref = category_grand_cells[cat_name]
                    v_str = cat_cells.get(cell_ref, {}).get("val", "")
                    grand_total = round(float(v_str), 1) if v_str else 0.0
                elif cat_name == "総電力":
                    # Sum of D4 to AZ4 (all panel sums)
                    grand_total = 0.0
                    for ref, cell in cat_cells.items():
                        if ref.endswith("4") and ref not in ["B4", "C4"]:
                            # check if it's within columns D to AZ
                            col_letter = "".join(filter(str.isalpha, ref))
                            if len(col_letter) == 1 or (len(col_letter) == 2 and col_letter <= "AZ"):
                                try:
                                    grand_total += float(cell.get("val", 0) or 0)
                                except ValueError:
                                    pass
                    grand_total = round(grand_total, 1)

                truth_data["category_totals"][cat_name] = {
                    "grand_total": grand_total,
                    "sheet_name": sheet_name
                }



    # 3. Read Graph Excel if exists
    if os.path.exists(GRAPH_XLSX):
        print(f"Reading: {GRAPH_XLSX}")
        with zipfile.ZipFile(GRAPH_XLSX, "r") as z:
            shared_strings = read_shared_strings(z)
            sheet_targets = get_sheet_targets(z)
            
            # Read '電力量単価' sheet: Row 3 is kWh, Row 4 is cost, Row 5 is unit price
            if "電力量単価" in sheet_targets:
                unit_cells = parse_sheet_cells(z, sheet_targets["電力量単価"], shared_strings)
                # Col N is 3月 (March is column N in 2024年度: 4月=C, 5月=D, ..., 3月=N)
                col_mar = "N"
                truth_data["kpi"]["electricity"] = {
                    "used_kwh_thousand": float(unit_cells.get(f"{col_mar}3", {}).get("val", 0) or 0),
                    "cost_thousand_yen": float(unit_cells.get(f"{col_mar}4", {}).get("val", 0) or 0),
                    "unit_price_yen_per_kwh": float(unit_cells.get(f"{col_mar}5", {}).get("val", 0) or 0)
                }

    # Save to JSON
    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(truth_data, f, ensure_ascii=False, indent=2)

    print(f"Ground truth successfully extracted to: {OUTPUT_JSON}")
    print(f"  - Total Columns: {len(truth_data['hourly_summary_all']['columns'])}")
    print(f"  - Hourly Rows: {truth_data['hourly_summary_all']['row_count']}")
    print(f"  - Category Totals: {truth_data['category_totals']}")
    print(f"  - KPI Electricity: {truth_data['kpi'].get('electricity')}")

if __name__ == "__main__":
    main()
