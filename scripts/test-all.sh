#!/usr/bin/env bash
# scripts/test-all.sh
# Unix test runner
set -e
cd "$(dirname "$0")/.."
node tests/run-all.js "$@"
