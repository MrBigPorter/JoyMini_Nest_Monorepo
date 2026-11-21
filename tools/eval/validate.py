#!/usr/bin/env python3
"""AI 客服评测契约校验器（Phase 0）。

用法：
  python3 tools/eval/validate.py --dataset tools/eval/conversation/golden.jsonl
  python3 tools/eval/validate.py --feedback <file.jsonl>
  python3 tools/eval/validate.py --manifest <manifest.json>

校验规则来自 tools/eval/schema/*.json；本脚本只实现该规范用到的
JSON Schema 子集（type/required/properties/enum/pattern/items/...），
不引入第三方依赖。schema 与校验器同版本提交，避免“文档一套、代码一套”。
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

SCHEMA_DIR = Path(__file__).resolve().parent / "schema"
CASE_SCHEMA = SCHEMA_DIR / "case.schema.json"
SELECTION_SCHEMA = SCHEMA_DIR / "selection.schema.json"
FEEDBACK_SCHEMA = SCHEMA_DIR / "feedback.schema.json"
MANIFEST_SCHEMA = SCHEMA_DIR / "manifest.schema.json"


class ValidationError(Exception):
    pass


def _type_ok(value: Any, expected: str) -> bool:
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "null":
        return value is None
    raise ValidationError(f"unsupported schema type: {expected}")


def validate_node(value: Any, schema: dict, path: str) -> list[str]:
    errors: list[str] = []

    expected_type = schema.get("type")
    if expected_type is not None:
        types = expected_type if isinstance(expected_type, list) else [expected_type]
        if not any(_type_ok(value, t) for t in types):
            return [f"{path}: expected {'/'.join(types)}, got {type(value).__name__}"]

    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}: {value!r} not in {schema['enum']}")

    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            errors.append(f"{path}: length < {schema['minLength']}")
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            errors.append(f"{path}: length > {schema['maxLength']}")
        if "pattern" in schema:
            import re

            if re.search(schema["pattern"], value) is None:
                errors.append(f"{path}: {value!r} does not match {schema['pattern']}")

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append(f"{path}: {value} < {schema['minimum']}")
        if "maximum" in schema and value > schema["maximum"]:
            errors.append(f"{path}: {value} > {schema['maximum']}")

    if isinstance(value, dict):
        required = schema.get("required", [])
        for key in required:
            if key not in value:
                errors.append(f"{path}: missing required field {key!r}")
        props = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            for key in value:
                if key not in props:
                    errors.append(f"{path}: unexpected field {key!r}")
        for key, child in props.items():
            if key in value:
                errors.extend(validate_node(value[key], child, f"{path}.{key}"))
        extra = schema.get("additionalProperties")
        if isinstance(extra, dict):
            for key, child_value in value.items():
                if key not in props:
                    errors.extend(validate_node(child_value, extra, f"{path}.{key}"))

    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            errors.append(f"{path}: fewer than {schema['minItems']} items")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            errors.append(f"{path}: more than {schema['maxItems']} items")
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for index, item in enumerate(value):
                errors.extend(validate_node(item, item_schema, f"{path}[{index}]"))

    return errors


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValidationError(f"{path}: invalid JSON: {exc}") from exc


def load_jsonl(path: Path) -> list[tuple[int, dict]]:
    rows: list[tuple[int, dict]] = []
    for lineno, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValidationError(f"{path}:{lineno}: invalid JSON: {exc}") from exc
        if not isinstance(item, dict):
            raise ValidationError(f"{path}:{lineno}: expected a JSON object")
        rows.append((lineno, item))
    return rows


def validate_dataset(path: Path) -> list[str]:
    schema = load_json(CASE_SCHEMA)
    errors: list[str] = []
    seen_ids: set[str] = set()
    versions: set[str] = set()
    rows = load_jsonl(path)

    for lineno, case in rows:
        prefix = f"{path}:{lineno}"
        node_errors = validate_node(case, schema, prefix)
        errors.extend(node_errors)
        if node_errors:
            continue

        case_id = case["id"]
        if case_id in seen_ids:
            errors.append(f"{prefix}: duplicate case id {case_id!r}")
        seen_ids.add(case_id)
        versions.add(case["datasetVersion"])

        turns = case["turns"]
        for index, turn in enumerate(turns, 1):
            if turn["turn"] != index:
                errors.append(
                    f"{prefix}: turns[{index - 1}].turn expected {index}, got {turn['turn']}"
                )

    if len(versions) > 1:
        errors.append(f"{path}: mixed datasetVersion values: {sorted(versions)}")

    return errors


def validate_selection(path: Path) -> list[str]:
    schema = load_json(SELECTION_SCHEMA)
    errors: list[str] = []
    seen_ids: set[str] = set()
    seen_conversations: set[str] = set()
    versions: set[str] = set()

    for lineno, row in load_jsonl(path):
        prefix = f"{path}:{lineno}"
        node_errors = validate_node(row, schema, prefix)
        errors.extend(node_errors)
        if node_errors:
            continue

        if row["id"] in seen_ids:
            errors.append(f"{prefix}: duplicate selection id {row['id']!r}")
        seen_ids.add(row["id"])
        if row["conversationId"] in seen_conversations:
            errors.append(
                f"{prefix}: duplicate conversationId {row['conversationId']!r}"
            )
        seen_conversations.add(row["conversationId"])
        versions.add(row["datasetVersion"])

    if len(versions) > 1:
        errors.append(f"{path}: mixed datasetVersion values: {sorted(versions)}")

    return errors


def validate_feedback(path: Path) -> list[str]:
    schema = load_json(FEEDBACK_SCHEMA)
    errors: list[str] = []

    for lineno, row in load_jsonl(path):
        prefix = f"{path}:{lineno}"
        node_errors = validate_node(row, schema, prefix)
        errors.extend(node_errors)
        if node_errors:
            continue

        score_type = row["scoreType"]
        if score_type == "boolean":
            if row.get("value") == "unknown":
                continue
            if row.get("score") not in (0, 1):
                errors.append(f"{prefix}: boolean score must be 0 or 1")
        elif score_type == "categorical":
            if not row.get("value"):
                errors.append(f"{prefix}: categorical feedback requires value")
        elif score_type == "continuous":
            if "score" not in row:
                errors.append(f"{prefix}: continuous feedback requires score")

    return errors


def validate_manifest(path: Path) -> list[str]:
    schema = load_json(MANIFEST_SCHEMA)
    manifest = load_json(path)
    errors = validate_node(manifest, schema, str(path))
    if errors:
        return errors

    try:
        started = datetime.fromisoformat(manifest["startedAt"].replace("Z", "+00:00"))
        finished = datetime.fromisoformat(manifest["finishedAt"].replace("Z", "+00:00"))
    except ValueError as exc:
        return [f"{path}: invalid ISO timestamp: {exc}"]

    if finished < started:
        errors.append(f"{path}: finishedAt earlier than startedAt")
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate eval contracts")
    parser.add_argument("--dataset", type=Path, help="case JSONL to validate")
    parser.add_argument("--selection", type=Path, help="selection JSONL to validate")
    parser.add_argument("--feedback", type=Path, help="feedback JSONL to validate")
    parser.add_argument("--manifest", type=Path, help="manifest JSON to validate")
    args = parser.parse_args(argv)

    if not any([args.dataset, args.selection, args.feedback, args.manifest]):
        parser.print_help()
        return 2

    all_errors: list[str] = []
    if args.dataset:
        all_errors.extend(validate_dataset(args.dataset))
    if args.selection:
        all_errors.extend(validate_selection(args.selection))
    if args.feedback:
        all_errors.extend(validate_feedback(args.feedback))
    if args.manifest:
        all_errors.extend(validate_manifest(args.manifest))

    if all_errors:
        for error in all_errors:
            print(f"ERROR {error}", file=sys.stderr)
        print(f"FAILED: {len(all_errors)} error(s)", file=sys.stderr)
        return 1

    if args.dataset:
        rows = load_jsonl(args.dataset)
        versions = sorted({row["datasetVersion"] for _, row in rows})
        print(f"OK dataset: {len(rows)} case(s), datasetVersion={versions[0]}")
    if args.selection:
        rows = load_jsonl(args.selection)
        versions = sorted({row["datasetVersion"] for _, row in rows})
        print(f"OK selection: {len(rows)} conversation(s), datasetVersion={versions[0]}")
    if args.feedback:
        print(f"OK feedback: {len(load_jsonl(args.feedback))} row(s)")
    if args.manifest:
        print("OK manifest")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ValidationError as exc:
        print(f"ERROR {exc}", file=sys.stderr)
        raise SystemExit(1)
