"""Regression checks for file-backed batching and native-object fidelity."""
import importlib.util
import io
import os
from pathlib import Path
import re
import tempfile
import unittest
from unittest import mock
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("ppt_batch_bridge", ROOT / "plugins/scientific-illustrator/scripts/powerpoint-mac-bridge.py")
BRIDGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BRIDGE)


def rectangle(name, left=10):
    return {"type": "add_shape", "slide_index": 1, "name": name, "shape": "rectangle", "left": left, "top": 10, "width": 40, "height": 20, "fill_color": "AABBCC"}


class BatchTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        state_dir = Path(self.temporary.name)
        self.enterContext(mock.patch.object(BRIDGE, "STATE_DIR", state_dir))
        self.enterContext(mock.patch.object(BRIDGE, "STATE_PATH", state_dir / "session.json"))
        self.enterContext(mock.patch.dict(os.environ, {"SCIENTIFIC_ILLUSTRATOR_POWERPOINT_SYNC": "0", "SCIENTIFIC_ILLUSTRATOR_DEFER_REFRESH": "1"}))
        self.addCleanup(self.temporary.cleanup)
        self.new_deck("initial")

    def new_deck(self, label):
        path = Path(self.temporary.name) / f"{label}.pptx"
        BRIDGE._new_presentation(path)
        BRIDGE._write_state({"path": str(path), "read_only": False, "host_application": "wps", "metadata": {}})
        return path

    def test_native_parts_match_the_per_operation_path(self):
        operations = [
            rectangle("source"), rectangle("target", 200),
            {"type": "add_connector", "slide_index": 1, "name": "attached", "source_name": "source", "target_name": "target", "line_color": "334455", "end_arrow": "triangle"},
            {"type": "add_textbox", "slide_index": 1, "name": "label", "text": "中文 β & <editable>", "left": 10, "top": 60, "width": 220, "height": 30, "font_size": 18},
            {"type": "add_line", "slide_index": 1, "name": "arrow", "begin_x": 20, "begin_y": 100, "end_x": 240, "end_y": 120, "end_arrow": "triangle", "line_width": 1.5},
            {"type": "add_table", "slide_index": 1, "name": "table", "rows": 2, "columns": 2, "left": 10, "top": 150, "width": 120, "height": 50, "data": [["A", "B"], [1, 2]]},
            {"type": "update_table_cell", "slide_index": 1, "shape_name": "table", "row": 2, "column": 1, "text": "3"},
            {"type": "add_chart", "slide_index": 1, "name": "native-chart", "chart_type": "column_clustered", "categories": ["A", "B"], "series": [{"name": "Series", "values": [1, 3]}], "left": 350, "top": 130, "width": 240, "height": 160},
            {"type": "duplicate_shape", "slide_index": 1, "shape_name": "source", "new_name": "copy", "top": 230},
            {"type": "group_shapes", "slide_index": 1, "shape_names": ["copy", "label"], "name": "group"},
            {"type": "update_shape", "slide_index": 1, "shape_name": "target", "new_name": "target-renamed", "left": 260},
            {"type": "add_slide", "name": "second-slide"},
            {"type": "add_textbox", "slide_index": 2, "name": "other-slide-label", "text": "second", "left": 10, "top": 20, "width": 100, "height": 30},
        ]
        sequential_path = self.new_deck("sequential")
        for operation in operations:
            BRIDGE.ACTIONS[operation["type"]](operation)
        sequential_metadata = BRIDGE._state()["metadata"]
        batch_path = self.new_deck("batched")
        result = BRIDGE.action_draw_batch({"operations": operations})
        self.assertIsNone(result["failure"])
        self.assertEqual(result["operations_applied"], len(operations))
        self.assertEqual(result["presentation_load_count"], 1)
        self.assertEqual(result["presentation_save_count"], 1)
        self.assertEqual(BRIDGE._state()["metadata"], sequential_metadata)
        with ZipFile(sequential_path) as expected, ZipFile(batch_path) as actual:
            self.assertEqual(set(expected.namelist()), set(actual.namelist()))
            for name in expected.namelist():
                if name.endswith(".xlsx"):
                    # Embedded workbooks carry independent creation timestamps;
                    # compare every part after excluding those timestamps only.
                    with ZipFile(io.BytesIO(expected.read(name))) as expected_book, ZipFile(io.BytesIO(actual.read(name))) as actual_book:
                        self.assertEqual(set(expected_book.namelist()), set(actual_book.namelist()))
                        for part in expected_book.namelist():
                            normalize = lambda value: re.sub(rb"(<dcterms:(?:created|modified)[^>]*>)[^<]*", rb"\1", value) if part == "docProps/core.xml" else value
                            self.assertEqual(normalize(actual_book.read(part)), normalize(expected_book.read(part)), f"{name}/{part}")
                else:
                    self.assertEqual(actual.read(name), expected.read(name), name)

    def test_read_only_deck_remains_unchanged(self):
        state = BRIDGE._state()
        state["read_only"] = True
        BRIDGE._write_state(state)
        before = Path(state["path"]).read_bytes()
        with self.assertRaises(PermissionError):
            BRIDGE.action_draw_batch({"operations": [rectangle("blocked")]})
        self.assertEqual(Path(state["path"]).read_bytes(), before)
        self.assertIsNone(BRIDGE._BATCH_CONTEXT)

    def test_failed_first_operation_does_not_leak_into_next_batch_or_deck(self):
        failure = BRIDGE.action_draw_batch({"operations": [{**rectangle("failed"), "fill_color": "invalid"}]})
        self.assertEqual(failure["operations_applied"], 0)
        self.assertEqual(failure["presentation_save_count"], 0)
        self.assertEqual(failure["failure"]["index"], 0)
        self.assertIsNone(BRIDGE._BATCH_CONTEXT)
        state, path, prs = BRIDGE._load()
        self.assertEqual(len(prs.slides[0].shapes), 0)
        self.new_deck("next")
        BRIDGE.action_draw_batch({"operations": [rectangle("next-object")]})
        _, _, prs = BRIDGE._load()
        self.assertEqual([s.name for s in prs.slides[0].shapes], ["next-object"])

    def test_lifecycle_and_nested_operations_rejected_before_any_edit(self):
        for kind in ("new_presentation", "save", "delete_shape", "activate_slide", "draw_batch"):
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                BRIDGE.action_draw_batch({"operations": [rectangle("must-not-appear"), {"type": kind}]})
        _, _, prs = BRIDGE._load()
        self.assertEqual(len(prs.slides[0].shapes), 0)


if __name__ == "__main__":
    unittest.main()
