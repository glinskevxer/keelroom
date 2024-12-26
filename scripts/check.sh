#!/usr/bin/env bash
# everything ci runs, in the order that fails cheapest first
set -euo pipefail
cd "$(dirname "$0")/.."
npm run typecheck
npm run lint
npm run format:check
npm test
