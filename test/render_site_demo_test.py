"""Check renderer path safety without Pillow, FFmpeg or real media."""

from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest


RENDERER = Path(__file__).resolve().parents[1] / "scripts" / "render-site-demo.py"
PREFLIGHT = runpy.run_path(str(RENDERER))["preflight_paths"]


class RenderPathsTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.sentinel = self.root / "keep.txt"
        self.sentinel.write_bytes(b"preserve this existing file\n")
        self.ffmpeg = self.root / "ffmpeg-sentinel"
        self.ffmpeg.write_text(
            "#!/usr/bin/env python3\n"
            "from pathlib import Path\n"
            "Path(__file__).with_suffix('.invoked').write_text('unexpected invocation')\n"
            "raise SystemExit(99)\n"
        )
        self.ffmpeg.chmod(0o700)

    def paths(self):
        return {
            "output": self.root / "new-video" / "demo.mp4",
            "captions": self.root / "new-captions" / "demo.vtt",
            "poster": self.root / "new-poster" / "poster.jpg",
            "scratch": self.root / "new-scratch",
        }

    def snapshot(self):
        result = {}
        for path in self.root.rglob("*"):
            key = str(path.relative_to(self.root))
            if path.is_symlink():
                result[key] = ("symlink", str(path.readlink()))
            elif path.is_dir():
                result[key] = ("directory", None)
            else:
                result[key] = ("file", path.read_bytes())
        return result

    def assert_cli_rejects(self, paths, message):
        before = self.snapshot()
        command = [sys.executable, "-B", "-S", str(RENDERER),
                   "--manifest", str(self.root / "unused-manifest.json"),
                   "--ffmpeg", str(self.ffmpeg), "--ffprobe", str(self.ffmpeg)]
        for name, path in paths.items():
            command.extend([f"--{name}", str(path)])
        result = subprocess.run(command, capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(message, result.stderr)
        self.assertNotIn("ModuleNotFoundError", result.stderr)
        self.assertEqual(self.snapshot(), before)
        self.assertFalse(self.ffmpeg.with_suffix(".invoked").exists())

    def test_separate_paths_pass_without_directory_creation(self):
        paths = self.paths()
        before = self.snapshot()
        resolved = PREFLIGHT(**paths)
        self.assertEqual(resolved, tuple(path.resolve() for path in paths.values()))
        self.assertEqual(self.snapshot(), before)

    def test_each_pair_of_final_paths_must_be_distinct(self):
        for first, second in [("output", "captions"), ("output", "poster"), ("captions", "poster")]:
            with self.subTest(first=first, second=second):
                paths = self.paths()
                paths[second] = paths[first]
                self.assert_cli_rejects(paths, "paths must be distinct")

    def test_case_equivalent_final_paths_are_rejected(self):
        for first, second in [("output", "captions"), ("output", "poster"), ("captions", "poster")]:
            with self.subTest(first=first, second=second):
                paths = self.paths()
                paths[first] = self.root / "new-final" / "demo.mp4"
                paths[second] = self.root / "new-final" / "DEMO.MP4"
                self.assert_cli_rejects(paths, "paths must be distinct")

    def test_unicode_equivalent_final_paths_are_rejected(self):
        paths = self.paths()
        paths["output"] = self.root / "new-final" / "démó.mp4"
        paths["captions"] = self.root / "new-final" / "de\u0301mo\u0301.mp4"
        self.assert_cli_rejects(paths, "paths must be distinct")

    def test_case_equivalent_scratch_overlap_is_rejected(self):
        paths = self.paths()
        paths["poster"] = self.root / "NEW-SCRATCH" / "receipt.json"
        self.assert_cli_rejects(paths, "scratch must not overlap")

    def test_unicode_equivalent_scratch_overlap_is_rejected(self):
        paths = self.paths()
        paths["scratch"] = self.root / "démó"
        paths["poster"] = self.root / "de\u0301mo\u0301" / "receipt.json"
        self.assert_cli_rejects(paths, "scratch must not overlap")

    def test_case_equivalent_final_ancestor_is_rejected(self):
        paths = self.paths()
        paths["output"] = self.root / "new-output"
        paths["captions"] = self.root / "NEW-OUTPUT" / "captions.vtt"
        self.assert_cli_rejects(paths, "must not contain one another")

    def test_unicode_equivalent_final_ancestor_is_rejected(self):
        paths = self.paths()
        paths["output"] = self.root / "démó"
        paths["captions"] = self.root / "de\u0301mo\u0301" / "captions.vtt"
        self.assert_cli_rejects(paths, "must not contain one another")

    def test_no_final_output_can_be_the_scratch_receipt(self):
        for name in ("output", "captions", "poster"):
            with self.subTest(output=name):
                paths = self.paths()
                paths[name] = paths["scratch"] / "receipt.json"
                self.assert_cli_rejects(paths, "scratch must not overlap")

    def test_final_output_cannot_equal_scratch(self):
        paths = self.paths()
        paths["output"] = paths["scratch"]
        self.assert_cli_rejects(paths, "scratch must not overlap")

    def test_scratch_cannot_be_below_a_final_output(self):
        paths = self.paths()
        paths["scratch"] = paths["output"] / "scratch"
        self.assert_cli_rejects(paths, "scratch must not overlap")

    def test_final_outputs_cannot_contain_one_another(self):
        paths = self.paths()
        paths["captions"] = paths["output"] / "captions.vtt"
        self.assert_cli_rejects(paths, "must not contain one another")

    def test_symlinked_file_alias_is_rejected(self):
        paths = self.paths()
        target = self.root / "new-video.mp4"
        alias = self.root / "alias.vtt"
        alias.symlink_to(target)
        paths.update(output=target, captions=alias)
        self.assert_cli_rejects(paths, "paths must be distinct")

    def test_symlinked_parent_alias_is_rejected(self):
        paths = self.paths()
        target = self.root / "new-parent"
        alias = self.root / "alias-parent"
        alias.symlink_to(target, target_is_directory=True)
        paths.update(output=target / "demo.mp4", captions=alias / "demo.mp4")
        self.assert_cli_rejects(paths, "paths must be distinct")

    def test_symlinked_scratch_alias_is_rejected(self):
        paths = self.paths()
        alias = self.root / "alias-scratch"
        alias.symlink_to(paths["scratch"], target_is_directory=True)
        paths["poster"] = alias / "receipt.json"
        self.assert_cli_rejects(paths, "scratch must not overlap")

    def test_existing_output_is_preserved_without_new_directories(self):
        paths = self.paths()
        paths["poster"] = self.sentinel
        self.assert_cli_rejects(paths, "Output already exists")

    def test_existing_symlink_alias_keeps_its_target(self):
        paths = self.paths()
        alias = self.root / "existing-alias.vtt"
        alias.symlink_to(self.sentinel)
        paths.update(output=self.sentinel, captions=alias)
        self.assert_cli_rejects(paths, "paths must be distinct")

    def test_nonempty_scratch_is_preserved_without_new_directories(self):
        paths = self.paths()
        paths["scratch"] = self.root / "existing-scratch"
        paths["scratch"].mkdir()
        (paths["scratch"] / "keep.txt").write_bytes(b"preserve scratch\n")
        self.assert_cli_rejects(paths, "preserve prior work")


if __name__ == "__main__":
    unittest.main()
