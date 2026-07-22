#!/bin/zsh
# Daily manager brief: claude reads MANAGER.md (+ Gmail connector), rewrites
# tasks.json, commits, and pings you. Run manually once to approve tools.
set -e
cd "$(dirname "$0")"

# launchd ships a bare PATH — claude/node/gh live in homebrew
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

# idempotent: RunAtLoad + 8am can both fire; only build one brief per day.
# FORCE=1 ./run_brief.sh to regenerate.
TODAY=$(date +%Y-%m-%d)
if [ "${FORCE:-0}" != "1" ] && [ "$(python3 -c "import json; print(json.load(open('tasks.json'))['date'])" 2>/dev/null)" = "$TODAY" ]; then
  echo "brief for $TODAY already exists, skipping"
  exit 0
fi

git pull --rebase -q || true

CLAUDE=""
for c in /opt/homebrew/bin/claude /usr/local/bin/claude "$HOME/.local/bin/claude" "$HOME/.claude/local/claude"; do
  [ -x "$c" ] && CLAUDE="$c" && break
done
[ -z "$CLAUDE" ] && { echo "claude CLI not found"; exit 1; }

BRIEF=$(env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT "$CLAUDE" -p "$(cat MANAGER.md)

Today is $(date '+%Y-%m-%d (%A)')." \
  --allowedTools "mcp__claude_ai_Gmail")

# salvage the JSON object even if the reply has a preamble; validate before writing
echo "$BRIEF" | python3 -c "
import json, sys
raw = sys.stdin.read()
start, end = raw.find('{'), raw.rfind('}')
if start < 0 or end < start: sys.exit(1)
obj = json.loads(raw[start:end + 1])
assert obj.get('date') and obj.get('tasks'), 'missing date/tasks'
open('tasks.json', 'w').write(json.dumps(obj, indent=2) + '\n')
" || { echo "brief was not valid JSON, keeping yesterday's tasks"; exit 1; }

git add tasks.json
git commit -q -m "brief: $(date +%Y-%m-%d)" || true
git push -q || true

TOP=$(python3 -c "import json; t=[x for x in json.load(open('tasks.json'))['tasks'] if not x['done']]; print(t[0]['task'] if t else 'all clear')")
osascript -e "display notification \"$TOP\" with title \"Manager: today's #1\""
echo "brief done: $TOP"

# job-hunt brief: committed to AssiamahS/scipio briefs/ by the cloud routine ~7:38am
GH=""
for g in /opt/homebrew/bin/gh /usr/local/bin/gh; do [ -x "$g" ] && GH="$g" && break; done
if [ -n "$GH" ]; then
  JH=$("$GH" api "repos/AssiamahS/scipio/contents/briefs/$(date +%Y-%m-%d).md" -q .content 2>/dev/null | base64 -d || true)
  if [ -n "$JH" ]; then
    SUMMARY=$(echo "$JH" | python3 -c "
import sys, re
t = sys.stdin.read()
new = len(re.findall(r'^\d+\. \*\*', t, re.M))
stalled = 0 if re.search(r'## Stalled.*\n+Nothing', t) else len(re.findall(r'^- \*\*', t, re.M)) or 1
parts = []
parts.append(f'{stalled} stalled — needs your click' if stalled else 'nothing stalled')
parts.append(f'{new} new posting{\"s\" if new != 1 else \"\"}')
print(', '.join(parts))
")
    osascript -e "display notification \"$SUMMARY — details: scipio/briefs on GitHub\" with title \"Job hunt: $(date +%m/%d)\""
    echo "job-hunt: $SUMMARY"
  else
    echo "job-hunt: no brief for today (routine not run yet or failed)"
  fi
fi
