#!/usr/bin/env python3
"""Section E of scripts/__regression_audit.py must read CLI arguments only
from real invocations, never from a path that merely appears in a message,
a variable assignment, or a comment.

Usage: python3 tests/test_audit_cli_contract.py
"""
import os
import re
import tempfile
import types
import unittest
from pathlib import Path

ROOT: Path = Path(__file__).resolve().parent.parent
AUDIT: Path = ROOT / "scripts" / "__regression_audit.py"
SECTION_HEAD: str = "# ---------- G. CLI-contract audit ----------"
SECTION_TAIL: str = "print()\nif issues:"


def section_e_source() -> str:
    text: str = AUDIT.read_text()
    start: int = text.index(SECTION_HEAD)
    end: int = text.index(SECTION_TAIL, start)
    return text[start:end]


def run_section_e(text: str) -> tuple[list[str], int]:
    with tempfile.TemporaryDirectory() as tmp:
        probe: Path = Path(tmp) / "probe.sh"
        probe.write_text(text)
        module: types.ModuleType = types.ModuleType("audit_section_e")
        module.__dict__["os"] = os
        module.__dict__["re"] = re
        module.__dict__["scan_files"] = [str(probe)]
        module.__dict__["print"] = lambda *_a, **_k: None
        module.__dict__["issues"] = []
        module.__dict__["checks"] = 0
        module.__dict__["track"] = module.issues.append
        exec(compile(section_e_source(), str(AUDIT), "exec"), module.__dict__)
        return module.issues, module.checks


class CliContractAuditTest(unittest.TestCase):
    def assertClean(self, text: str) -> None:
        findings, _ = run_section_e(text)
        self.assertEqual(findings, [], f"unexpected E finding for {text!r}")

    def assertViolates(self, text: str, args: list[str]) -> None:
        findings, _ = run_section_e(text)
        self.assertEqual(len(findings), 1, f"expected one E finding, got {findings}")
        self.assertIn(f"args {args}", findings[0])

    def test_valid_invocations_are_clean(self) -> None:
        self.assertClean(
            "./scripts/__preflight.sh --stack all\n"
            "scripts/__preflight.sh\n"
            "bash scripts/__update_engine.sh --fresh --dry-run\n"
            "true && scripts/__preflight.sh --stack all\n"
            "scripts/__preflight.sh --stack all | tee log\n"
            "if [ -x s ]; then scripts/__preflight.sh --stack all; fi\n"
        )

    def test_invalid_invocations_are_reported(self) -> None:
        self.assertViolates("./scripts/__preflight.sh --stack\n", ["--stack"])
        self.assertViolates("sh scripts/__update_engine.sh --oops\n", ["--oops"])
        self.assertViolates("true && scripts/__preflight.sh --wat\n", ["--wat"])
        self.assertViolates("bash scripts/__update_engine.sh --bogus-flag\n",
                            ["--bogus-flag"])
        self.assertViolates("scripts/__preflight.sh --stack all && "
                            "scripts/__update_engine.sh --fresh --nope\n",
                            ["--fresh", "--nope"])

    def test_message_shapes_are_not_invocations(self) -> None:
        self.assertClean(
            'log_die "scripts/__preflight.sh not found or not executable"\n'
            'warn "scripts/__update_engine.sh is missing"\n'
            'echo "ERROR: scripts/__preflight.sh not found." >&2\n'
            'printf "%s\\n" scripts/__preflight.sh\n'
            'P="scripts/__update_engine.sh"\n'
            "Usage: scripts/__preflight.sh [options]\n"
            "# scripts/__preflight.sh --stack all is documented in the runbook\n"
            "# logs show scripts/__preflight.sh not found\n"
        )

    def test_capture_group_holds_only_the_arguments(self) -> None:
        findings, checks = run_section_e("scripts/__preflight.sh --stack\n")
        self.assertEqual(checks, 1)
        self.assertIn("__preflight.sh with args", findings[0])

    def test_checks_counter_does_not_advance_without_a_match(self) -> None:
        self.assertEqual(run_section_e('P="scripts/__preflight.sh"\n')[1], 0)


if __name__ == "__main__":
    unittest.main()
