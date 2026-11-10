"""Run cosmic-ray on the review logic and fail below a mutation score threshold.

Usage: python scripts/mutation.py [--min-score 70]
cosmic-ray edits source files in place while testing each mutant and restores them.
Commit or stash your work first.
"""

import argparse
import json
import re
import shlex
import subprocess
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE_CONFIG = ROOT / "mutation" / "cosmic-ray.toml"
CONFIG = ROOT / "mutation" / "generated.toml"
SESSION = ROOT / "mutation" / "session.sqlite"


def prepare_config() -> str:
    """Pin the test command to this interpreter.

    A bare "python" can resolve to another interpreter without the test dependencies; every
    mutant would then "fail" its tests and the score would read 100%.
    """
    settings = tomllib.loads(SOURCE_CONFIG.read_text(encoding="utf-8"))["cosmic-ray"]
    command = settings["test-command"].replace("python ", f'"{sys.executable}" ', 1)
    text = SOURCE_CONFIG.read_text(encoding="utf-8").replace(
        f'test-command = "{settings["test-command"]}"', f"test-command = {json.dumps(command)}"
    )
    CONFIG.write_text(text, encoding="utf-8")
    return command


def check_baseline(command: str) -> None:
    args = shlex.split(command, posix=sys.platform != "win32")
    result = subprocess.run([a.strip('"') for a in args], cwd=ROOT, capture_output=True, text=True)
    if result.returncode != 0:
        sys.stderr.write(result.stdout[-2000:] + result.stderr[-2000:])
        raise SystemExit("The unmutated test baseline fails; fix the tests before mutation testing.")


def run(*args: str) -> str:
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    if result.returncode not in (0, 1):
        sys.stderr.write(result.stdout + result.stderr)
        raise SystemExit(result.returncode)
    return result.stdout


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--min-score", type=float, default=70.0)
    args = parser.parse_args()
    SESSION.unlink(missing_ok=True)
    py = sys.executable
    check_baseline(prepare_config())
    run(py, "-m", "cosmic_ray.cli", "init", str(CONFIG), str(SESSION))
    run(py, "-m", "cosmic_ray.cli", "exec", str(CONFIG), str(SESSION))
    report = run(py, "-m", "cosmic_ray.tools.report", "--show-pending", str(SESSION))
    (ROOT / "mutation" / "report.txt").write_text(report, encoding="utf-8")
    total = int(re.search(r"total jobs: (\d+)", report)[1])
    surviving = int(re.search(r"surviving mutants: (\d+)", report)[1])
    score = 100 * (total - surviving) / total if total else 0.0
    summary = {"mutants": total, "killed": total - surviving, "survived": surviving, "score": round(score, 1)}
    (ROOT / "docs" / "mutation-score.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(f"Mutation score {score:.1f}% ({total - surviving}/{total} killed); see mutation/report.txt")
    raise SystemExit(0 if score >= args.min_score else 1)


if __name__ == "__main__":
    main()
