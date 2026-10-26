<!-- id: curiosity | parent: autonomy | level: 3 | order: 15 | tags: curiosity, schmidhuber, learning progress, CURIOSITY.md, wake-up -->
# Curiosity engine

Settings → World → Curiosity. Off by default. Range (default 45–180 minutes, 08:00–22:00), a daily cap (5), which activities are allowed, and how far her tools reach during a wake (`notes`, `web`, `all`; default `web`).

## What she can choose

`explore`, `reflect`, `connect`, `practice`, `anticipate`, `ask`, `rest`. A wake is a normal agent turn in the "✦ Curiosity" chat with a prompt containing the menu (scores and suggestion), your `CURIOSITY.md` and rules (never delete; mark requests as done with the date). She can accept the suggestion or override it with her own choice (recorded).

## How the suggestion is scored

Following Schmidhuber's curiosity as *compression/learning progress*: each activity has a small forecaster of "how rewarding will this be" (its own average blended with the time-of-day average). After each wake the forecast error is measured. **Learning progress = slow error average minus fast error average, clamped at 0**, so an activity whose results stay random keeps a high but flat error and earns no curiosity bonus (the "noisy TV" trap), while one she is getting better at predicting scores until it is understood.

`score = 1.5·progress + 1.0·prior + 0.25·novelty·(0.4+avg reward) + 0.4/√(1+tries) − repeat penalty − cost (+ wish boost)`; a softmax with a temperature that falls as history grows picks the suggestion. `rest` is a fixed baseline (0.1).

## Reward is measured, not claimed

The harness diffs the vault: new notes, changed notes, links in new notes, new memories → reward in 0..1. Her self-score counts for a quarter and can never exceed the measured value by more than 0.2. State: `ls 'curiosity'`, next wake `cuNext`, today's count `cuToday`.

## Steering with CURIOSITY.md

`/Jade/CURIOSITY.md` (created on first use) has sections you fill: topics she should look into (un-done items boost `explore` and `anticipate`), things to avoid, standing rules. Comments are stripped; empty sections are dropped; she is told when the file changed since the last wake. `curiosity` tool: `status`, `history`, `menu`, `choose`, `report` (choose/report only during a wake).

## Safety

During a wake her tools are filtered (notes only, or notes+web, or all if you widen it). She never gets Sentry rules, calls or texts through this filter unless you choose `all`.
