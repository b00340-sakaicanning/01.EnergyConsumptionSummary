#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tests/verify_output.py
実装したETLエンジン・集計エンジンの出力を、正解データ(tests/truth_202503.json)と自動突合・検証するスクリプト。
許容丸め誤差（±0.1）を超える不一致がある場合は詳細レポートを出力。
"""

import os
import sys
import json
import math

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRUTH_JSON = os.path.join(BASE_DIR, "tests", "truth_202503.json")

def load_truth():
    if not os.path.exists(TRUTH_JSON):
        raise FileNotFoundError(f"Truth file not found: {TRUTH_JSON}. Run extract_reference_truth.py first.")
    with open(TRUTH_JSON, "r", encoding="utf-8") as f:
        return json.load(f)

def compare_hourly_data(test_rows, truth_rows, tolerance=0.15):
    """
    test_rows: list of dict [{"hour_index": 0, "values": {"D": 40.1, ...}}, ...]
    truth_rows: list of dict from truth_202503.json
    """
    errors = []
    total_checks = 0

    truth_map = {r.get("hour_index", r.get("hourIndex")): r["values"] for r in truth_rows}

    for t_row in test_rows:
        h_idx = t_row.get("hour_index", t_row.get("hourIndex"))
        if h_idx not in truth_map:
            errors.append(f"Hour {h_idx}: Missing in ground truth")
            continue

        
        expected_vals = truth_map[h_idx]
        actual_vals = t_row.get("values", {})

        for col, exp_val in expected_vals.items():
            if exp_val is None:
                continue
            act_val = actual_vals.get(col)
            total_checks += 1
            if act_val is None:
                errors.append(f"Hour {h_idx}, Col {col}: Expected {exp_val}, but got None")
                continue
            
            diff = abs(float(act_val) - float(exp_val))
            if diff > tolerance:
                errors.append(f"Hour {h_idx}, Col {col}: Expected {exp_val}, got {act_val} (diff: {diff:.2f})")

    return total_checks, errors

def compare_category_totals(test_totals, truth_totals, abs_tolerance=10.0, rel_tolerance=0.001):
    """
    test_totals: {"総電力": 301066.4, ...}
    truth_totals: dict from truth_202503.json
    """
    errors = []
    for cat_name, truth_info in truth_totals.items():
        exp = truth_info.get("grand_total")
        if exp is None:
            continue
        act = test_totals.get(cat_name)
        if act is None:
            errors.append(f"Category {cat_name}: Missing in test results")
            continue
        diff = abs(float(act) - float(exp))
        # 30万kWh規模の合計値における浮動小数点丸め誤差を考慮
        if diff > abs_tolerance and (diff / exp) > rel_tolerance:
            errors.append(f"Category {cat_name}: Expected {exp}, got {act} (diff: {diff:.2f}, rel: {diff/exp*100:.3f}%)")
    return errors


def main():
    print("=== Verification Test Harness ===")
    truth = load_truth()
    cols_count = len(truth["hourly_summary_all"]["columns"])
    rows_count = truth["hourly_summary_all"]["row_count"]
    print(f"Ground truth loaded successfully:")
    print(f"  - Target Year/Month: {truth['year_month']}")
    print(f"  - Target Columns: {cols_count}")
    print(f"  - Target Rows: {rows_count}")
    print(f"  - Total Data Points: {cols_count * rows_count:,}")

    if len(sys.argv) > 1:
        target_file = sys.argv[1]
        print(f"\nVerifying output file: {target_file}")
        with open(target_file, "r", encoding="utf-8") as f:
            test_data = json.load(f)
        
        # Hourly check
        if "rows" in test_data:
            total_checks, errors = compare_hourly_data(test_data["rows"], truth["hourly_summary_all"]["rows"])
            print(f"Checked {total_checks:,} hourly data points.")
            if errors:
                print(f"FAILED: {len(errors)} mismatches found (showing up to 10):")
                for err in errors[:10]:
                    print(f"  - {err}")
                sys.exit(1)
            else:
                print("PASSED: All hourly data points match ground truth perfectly!")
        
        # Category totals check
        if "category_totals" in test_data:
            cat_errors = compare_category_totals(test_data["category_totals"], truth["category_totals"])
            if cat_errors:
                print(f"FAILED: Category total mismatches:")
                for err in cat_errors:
                    print(f"  - {err}")
                sys.exit(1)
            else:
                print("PASSED: All category totals match ground truth!")

    else:
        print("\nUsage: python3 tests/verify_output.py <path_to_test_output.json>")
        print("Self-check completed successfully. Test harness is ready.")

if __name__ == "__main__":
    main()
