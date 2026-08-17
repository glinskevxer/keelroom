#!/usr/bin/env bash
# everything ci runs, in the order that fails cheapest first
set -euo pipefail
cd "$(dirname "$0")/.."
npm run typecheck
npm run lint
npm run format:check
# the declaration build catches what --noEmit does not: an exported binding whose
# inferred type names something the declaration file cannot import
npm run build
npm test
