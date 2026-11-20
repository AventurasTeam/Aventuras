#!/usr/bin/env sh
# After a compaction Claude Code re-attaches each invoked skill cut at 20,000 characters, path
# header and arguments included, so an aventuras- SKILL.md stays under 19,000 bytes; vendored skills
# aren't ours to cut. A pressure-scenario prompt outside a code fence can be found and obeyed
# mid-task, so none ships in any skill.

set -eu

skills_dir="${1:-.agents/skills}"
MAX_SKILL_BYTES=19000
failed=0

for skill in "$skills_dir"/aventuras-*/SKILL.md; do
  [ -f "$skill" ] || continue
  bytes=$(wc -c < "$skill" | tr -d ' ')
  if [ "$bytes" -ge "$MAX_SKILL_BYTES" ]; then
    echo "✗ ${skill#"$skills_dir"/} is $bytes bytes (limit: under $MAX_SKILL_BYTES). Move step-specific detail into references/." >&2
    failed=1
  fi
done

# CommonMark fences: a run of 3+ backticks or tildes opens one; only a bare run of the same
# character at least as long closes it. No regex intervals, which some awks lack.
scenarios=$(find "$skills_dir" -type f -name '*.md' -exec awk '
  FNR == 1 { fence = "" }
  {
    line = $0
    sub(/^ ? ? ?/, "", line)
    c = substr(line, 1, 1)
    if (c == "`" || c == "~") {
      n = 0
      while (substr(line, n + 1, 1) == c) n++
      if (n >= 3) {
        if (fence == "") { fence = c; fence_len = n; next }
        if (c == fence && n >= fence_len && substr(line, n + 1) ~ /^[ \t]*$/) { fence = ""; next }
      }
    }
    if (fence == "" && /This is a real scenario/) print FILENAME ":" FNR
  }
' {} +)

if [ -n "$scenarios" ]; then
  printf '%s\n' "$scenarios" | while IFS= read -r hit; do
    echo "✗ ${hit#"$skills_dir"/} holds a pressure-scenario prompt outside a code fence. Keep test scenarios out of skills." >&2
  done
  failed=1
fi

exit "$failed"
