"""Calculate per-function CRAP from Radon complexity and actual line coverage.

CRAP = complexity² × (1 − covered_fraction)³ + complexity.
Line coverage is used, not branch coverage. This is a prioritization signal.
"""

import json
from pathlib import Path

from radon.complexity import cc_visit


def main():
    coverage = json.loads(Path("coverage.json").read_text())
    by_path = {Path(path).as_posix().replace("\\", "/"): info for path, info in coverage["files"].items()}
    rows = []
    seen = set()
    for path in Path("review_helper").glob("*.py"):
        info = by_path.get(path.as_posix(), {})
        executed = set(info.get("executed_lines", []))
        missed = set(info.get("missing_lines", []))
        for block in cc_visit(path.read_text(encoding="utf-8")):
            blocks = block.methods if hasattr(block, "methods") else [block]
            for fn in blocks:
                key = (str(path), fn.lineno, fn.name)
                if key in seen:
                    continue
                seen.add(key)
                lines = set(range(fn.lineno, fn.endline + 1))
                statements = (executed | missed) & lines
                covered = len(executed & statements) / len(statements) if statements else 1.0
                crap = fn.complexity**2 * (1 - covered) ** 3 + fn.complexity
                rows.append(
                    {
                        "file": str(path),
                        "function": fn.name,
                        "line": fn.lineno,
                        "complexity": fn.complexity,
                        "line_coverage": round(covered, 4),
                        "crap": round(crap, 2),
                    }
                )
    rows.sort(key=lambda row: row["crap"], reverse=True)
    Path("docs/quality-metrics.json").write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
    for row in rows[:10]:
        print(
            f"{row['file']}:{row['line']} {row['function']}: complexity={row['complexity']}, "
            f"coverage={row['line_coverage']:.1%}, CRAP={row['crap']}"
        )


if __name__ == "__main__":
    main()
