import json
import tempfile
import unittest
from pathlib import Path

import validate

HERE = Path(__file__).resolve().parent
GOOD_DATASET = HERE / "conversation" / "golden.jsonl"


def write_jsonl(rows):
    tmp = tempfile.NamedTemporaryFile(
        "w", suffix=".jsonl", delete=False, encoding="utf-8"
    )
    with tmp:
        for row in rows:
            tmp.write(json.dumps(row, ensure_ascii=False) + "\n")
    return Path(tmp.name)


def base_case(**overrides):
    case = {
        "id": "task-order-list",
        "datasetVersion": "2026-11-21.1",
        "source": "sim",
        "language": "zh",
        "intent": "order",
        "turns": [
            {
                "turn": 1,
                "user": "帮我查订单",
                "expect": {
                    "mustMention": [],
                    "mustNotMention": [],
                    "expectAction": "none",
                    "expectOutcome": "reply",
                },
            }
        ],
        "conversationExpect": {"finalOutcome": "reply", "maxLatencyMs": 10000},
    }
    case.update(overrides)
    return case


class DatasetValidationTest(unittest.TestCase):
    def test_migrated_golden_passes(self):
        self.assertEqual(validate.validate_dataset(GOOD_DATASET), [])

    def test_duplicate_id_rejected(self):
        path = write_jsonl([base_case(), base_case()])
        errors = validate.validate_dataset(path)
        self.assertTrue(any("duplicate case id" in e for e in errors), errors)

    def test_invalid_enum_rejected(self):
        path = write_jsonl([base_case(source="bogus")])
        errors = validate.validate_dataset(path)
        self.assertTrue(any("not in" in e for e in errors), errors)

    def test_turn_sequence_rejected(self):
        case = base_case()
        case["turns"][0]["turn"] = 2
        path = write_jsonl([case])
        errors = validate.validate_dataset(path)
        self.assertTrue(any("expected 1" in e for e in errors), errors)

    def test_mixed_dataset_versions_rejected(self):
        path = write_jsonl(
            [base_case(), base_case(id="task-order-shipping", datasetVersion="2026-11-22.1")]
        )
        errors = validate.validate_dataset(path)
        self.assertTrue(any("mixed datasetVersion" in e for e in errors), errors)

    def test_deterministic(self):
        first = validate.validate_dataset(GOOD_DATASET)
        second = validate.validate_dataset(GOOD_DATASET)
        self.assertEqual(first, second)


class FeedbackValidationTest(unittest.TestCase):
    def test_boolean_requires_zero_or_one(self):
        path = write_jsonl(
            [
                {
                    "caseId": "task-order-list",
                    "turn": 1,
                    "key": "language_match",
                    "scoreType": "boolean",
                    "score": 2,
                    "source": "CODE",
                    "evaluatorVersion": "1.0.0",
                }
            ]
        )
        errors = validate.validate_feedback(path)
        self.assertTrue(any("boolean score" in e for e in errors), errors)

    def test_categorical_requires_value(self):
        path = write_jsonl(
            [
                {
                    "caseId": "task-order-list",
                    "turn": 1,
                    "key": "correctness",
                    "scoreType": "categorical",
                    "source": "LLM",
                    "evaluatorVersion": "1.0.0",
                }
            ]
        )
        errors = validate.validate_feedback(path)
        self.assertTrue(any("requires value" in e for e in errors), errors)


class ManifestValidationTest(unittest.TestCase):
    def manifest(self, **overrides):
        data = {
            "runId": "run-1",
            "datasetVersion": "2026-11-21.1",
            "caseCount": 10,
            "repetitions": 1,
            "model": "deepseek-chat",
            "promptVersions": {"wallet": 2},
            "ragIndexVersion": "2026-11-20",
            "judgeVersion": None,
            "evaluatorVersions": {"language_match": "1.0.0"},
            "startedAt": "2026-11-21T10:00:00Z",
            "finishedAt": "2026-11-21T10:05:00Z",
        }
        data.update(overrides)
        return data

    def test_valid(self):
        tmp = tempfile.NamedTemporaryFile(
            "w", suffix=".json", delete=False, encoding="utf-8"
        )
        with tmp:
            json.dump(self.manifest(), tmp)
        self.assertEqual(validate.validate_manifest(Path(tmp.name)), [])

    def test_reversed_time_rejected(self):
        tmp = tempfile.NamedTemporaryFile(
            "w", suffix=".json", delete=False, encoding="utf-8"
        )
        with tmp:
            json.dump(
                self.manifest(finishedAt="2026-11-21T09:00:00Z"), tmp
            )
        errors = validate.validate_manifest(Path(tmp.name))
        self.assertTrue(any("earlier than startedAt" in e for e in errors), errors)


if __name__ == "__main__":
    unittest.main()
