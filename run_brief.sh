#!/bin/zsh
# Daily manager brief: claude reads MANAGER.md (+ Gmail connector), rewrites
# tasks.json, commits, and pings you. Run manually once to approve tools.
set -e
cd "$(dirname "$0")"

git pull --rebase -q || true

CLAUDE=""
for c in /opt/homebrew/bin/claude /usr/local/bin/claude "$HOME/.local/bin/claude" "$HOME/.claude/local/claude"; do
  [ -x "$c" ] && CLAUDE="$c" && break
done
[ -z "$CLAUDE" ] && { echo "claude CLI not found"; exit 1; }

BRIEF=$(env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT "$CLAUDE" -p "$(cat MANAGER.md)

Today is $(date +%Y-%m-%d).")

# accept only valid JSON so a chatty reply can't corrupt the task file
echo "$BRIEF" | python3 -c "import json,sys; json.load(sys.stdin)" \
  && echo "$BRIEF" > tasks.json \
  || { echo "brief was not valid JSON, keeping yesterday's tasks"; exit 1; }

git add tasks.json
git commit -q -m "brief: $(date +%Y-%m-%d)" || true
git push -q || true

TOP=$(python3 -c "import json; t=[x for x in json.load(open('tasks.json'))['tasks'] if not x['done']]; print(t[0]['task'] if t else 'all clear')")
osascript -e "display notification \"$TOP\" with title \"Manager: today's #1\""
echo "brief done: $TOP"
