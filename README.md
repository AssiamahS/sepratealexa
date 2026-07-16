# sepratealexa — your manager

A daily manager that reads your world (Gmail, calendar, standing goals) and
tells you what to do today, like a manager would: *"yo — respond to this
person, apply to this job, reach out to one DJ."* Tasks land in `tasks.json`
(source of truth, versioned in this repo), surface on your Mac, in a CLI,
and — phase 2 — on Alexa.

## How it works

```
8:00 AM launchd (com.sly.manager)
        │  run_brief.sh
        ▼
claude -p + MANAGER.md          reads Gmail (connector MCP), applies your
        │                       standing priorities (job hunt, MedChat
        ▼                       outreach, DJ outreach, recycling Tue)
tasks.json                      committed + pushed → repo is the record
        │
        ├─ macOS notification with the top task
        ├─ `manager` CLI (today / done N / add "...")
        └─ Alexa: "ask my manager what's next"  (alexa/lambda.js, phase 2)
```

## Standing priorities (edit MANAGER.md to change)

1. **Job hunt** — every day: act on new postings (LinkedIn alerts, scipio
   queue), tailor with job-description-viewer, apply.
2. **Healthcare outreach** — every day: contact one healthcare professional
   about MedChat (Mr. Bond deliverable).
3. **DJ / business outreach** — every day: pitch one DJ or venue
   (setlist / amapiano work).
4. **Inbox hygiene** — CI noise gets filtered, real humans get replies.
5. **Recycling** — out Monday night, pickup Tuesday.

## CLI

```
manager today          # today's brief
manager done 2         # check off task 2
manager add "call X"   # add a task mid-day
```

## Daily run

`run_brief.sh` needs the `claude` CLI with your Gmail connector. First run:
execute it once manually so you can approve tool permissions; after that the
8 AM launchd run is hands-off. Each daily brief is a commit — history is
your accountability log.

## Alexa (phase 2)

`alexa/lambda.js` is a ready handler that reads
`https://raw.githubusercontent.com/AssiamahS/sepratealexa/main/tasks.json`
(same runtime-fetch pattern as flashdeck's decks.json). Wire it into a hosted
skill named "my manager" → *"Alexa, ask my manager what's next."*

## Versioning

Code changes bump `VERSION` in `bin/manager` + git tag. Daily `tasks.json`
commits are data, not releases — no tags.
