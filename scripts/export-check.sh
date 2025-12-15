#!/usr/bin/env bash
# What git would ship, checked against what the package expects.
#
# It exports HEAD into a temporary directory and builds there, because the
# working tree carries files git does not, and a build that only works with an
# untracked file present is a build nobody else can reproduce.
set -euo pipefail
cd "$(dirname "$0")/.."

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

git archive --format=tar HEAD | tar -x -C "$WORK"

for wanted in package.json tsconfig.json tsconfig.build.json src/cli/main.ts README.md docs/commands.md; do
  if [ ! -f "$WORK/$wanted" ]; then
    echo "export check: $wanted is not tracked by git"
    exit 1
  fi
done

for unwanted in node_modules dist coverage district.sqlite audit.json; do
  if [ -e "$WORK/$unwanted" ]; then
    echo "export check: $unwanted is tracked and should not be"
    exit 1
  fi
done

COUNT=$(find "$WORK/src" -name '*.ts' | wc -l)
if [ "$COUNT" -lt 40 ]; then
  echo "export check: only $COUNT source files were exported, that cannot be right"
  exit 1
fi

if grep -rn "console\.log" "$WORK/src" --include='*.ts' | grep -v "cli/output.ts" >/dev/null; then
  echo "export check: something outside cli/output.ts writes to the console"
  grep -rn "console\.log" "$WORK/src" --include='*.ts' | grep -v "cli/output.ts"
  exit 1
fi

echo "export check: the tracked tree carries $COUNT source files and nothing it should not"
