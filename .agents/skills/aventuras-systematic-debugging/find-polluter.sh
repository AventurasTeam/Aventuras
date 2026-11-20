#!/usr/bin/env bash
# Bisection script to find which test creates unwanted files/state
# Run from the repo root, by path:
#   .agents/skills/aventuras-systematic-debugging/find-polluter.sh <file_or_dir_to_check> <test_pattern>
# Example:
#   .agents/skills/aventuras-systematic-debugging/find-polluter.sh 'lib/db/stray.db' 'lib/**/*.test.ts'

set -eo pipefail

if [ $# -ne 2 ]; then
  echo "Usage: $0 <file_to_check> <test_pattern>"
  echo "Example: $0 'lib/db/stray.db' 'lib/**/*.test.ts'"
  exit 1
fi

POLLUTION_CHECK="$1"
TEST_PATTERN="$2"

echo "🔍 Searching for test that creates: $POLLUTION_CHECK"
echo "Test pattern: $TEST_PATTERN"
echo ""

if [ -e "$POLLUTION_CHECK" ]; then
  echo "❌ $POLLUTION_CHECK already exists before any test ran."
  echo "   Remove it (or pick a path no test run starts with) and rerun."
  exit 2
fi

# Get list of test files (find . emits ./-prefixed paths, so accept the
# pattern written with or without a leading ./)
TEST_PATTERN="${TEST_PATTERN#./}"
# find -path can't match '**/' against zero directory levels, so a pattern
# like lib/**/*.test.ts would skip lib/top.test.ts; also try the pattern
# with '**/' collapsed to cover files directly under the base directory.
TEST_FILES=$(find . \( -path "./$TEST_PATTERN" -o -path "./${TEST_PATTERN//\*\*\//}" \) -not -path './node_modules/*' | sort -u)
if [ -z "$TEST_FILES" ]; then
  echo "❌ No test files match $TEST_PATTERN from $(pwd)."
  echo "   Run this from the repo root, with a pattern relative to it."
  exit 2
fi
TOTAL=$(printf '%s\n' "$TEST_FILES" | wc -l | tr -d ' ')

echo "Found $TOTAL test files"
echo ""

COUNT=0
for TEST_FILE in $TEST_FILES; do
  COUNT=$((COUNT + 1))

  echo "[$COUNT/$TOTAL] Testing: $TEST_FILE"

  # Stories run only in the storybook project; everything else in unit.
  case "$TEST_FILE" in
    *.stories.*) PROJECT=storybook ;;
    *) PROJECT=unit ;;
  esac
  pnpm exec vitest run --project "$PROJECT" "${TEST_FILE#./}" > /dev/null 2>&1 || true

  # Check if pollution appeared
  if [ -e "$POLLUTION_CHECK" ]; then
    echo ""
    echo "🎯 FOUND POLLUTER!"
    echo "   Test: $TEST_FILE"
    echo "   Created: $POLLUTION_CHECK"
    echo ""
    echo "Pollution details:"
    ls -la "$POLLUTION_CHECK"
    echo ""
    echo "To investigate:"
    echo "  pnpm exec vitest run --project $PROJECT ${TEST_FILE#./}    # Run just this test"
    echo "  cat $TEST_FILE         # Review test code"
    exit 1
  fi
done

echo ""
echo "✅ No polluter found - all tests clean!"
exit 0
