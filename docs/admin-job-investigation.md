# Job investigation and safe diagnostics

## Scope and evidence (#87)

Read-only investigation on 2026-10-01 examined two rotated backend service logs and
15 unique event-impact audit files already retained by the deployed release.
No provider calls, jobs, database mutations, or service changes were performed.

- Twelve impact summaries ended with `consecutive_failures`; several still had
  successful articles. A nonzero pipeline result does not imply zero useful work.
- Retained impact audits recorded 122 failed validation attempts: 57 source-quote
  mismatches (34 event, 23 impact), 31 unmentioned-company targets, 10 mixed-impact
  quote-count failures, and 24 other schema failures. These are attempt counts,
  not distinct failed articles or admin runs. They establish validation failure,
  not a provider/credential outage or a defect in the validation rules.
- Warmup logs contain `unavailable` results (29 in the earlier rotation, one in the
  later rotation), alongside both zero and nonzero stage results. Existing output
  does not identify the missing evidence for each unavailable brief.
- A final warmup exit `3221225786` appears during service shutdown. This correlation
  alone does not prove the cause of every historical interrupted run.

Old child output lacks `AdminJobRun.id`; therefore runs #36, #39, and #45 cannot be
unambiguously matched to every child summary from these files. Further evidence
would require the matching run start/end timestamps and relevant retained stage
audit records. No raw output, validation feedback, article content, endpoint, or
credential is included here. No claim is made that production jobs have recovered.

## Contract

New executions emit bounded `admin_run`, stage, event, UTC timestamp, and exit-code
markers to the existing service output. Arguments and subprocess output are not
captured or returned by the API. The admin run detail endpoint uses existing admin
authorization and whitelist-only diagnostics. Unrecognized historical errors
become an unknown-cause message in API responses; stored history is unchanged.

Live stage-start activity is an execution boundary, not a child-progress heartbeat.
Actual worker progress remains unknown. Finished runs retain the existing safe
stage/exit-code error summary; successful stage history is in controlled logs.
The first nonzero pipeline result and independently continuing stages are unchanged.

## Cnyes-only source policy (#88)

The API lifespan owns `JobRuntime`, whose scheduler reads persisted
`AdminJobControl.paused` before scheduling sources. Existing LTN pause is sufficient;
no second toggle, crawler change, or configuration migration is needed. Production
deployment keeps the separate standalone jobs service stopped. This investigation
does not change that service or any persisted production control.

When the owner applies the policy through the existing authorized operations flow:

1. Read the environment and scheduler status in Admin; confirm it is the intended
   API-managed runtime. If controls are unavailable, do not bypass them with a CLI.
2. Use the existing **Pause Liberty Times schedule** control for `ltn` only.
   Pause affects future scheduled runs; it does not kill an active run or forbid
   an explicitly requested manual run/retry.
3. Read back `ltn.paused=true`, no LTN next time, and unchanged Cnyes enabled status.
   Preserve past LTN news, citations, and run history.
4. At the next naturally scheduled cycle, verify Cnyes's new run and the existing
   single coalesced analysis follow-up. After the next independently authorized
   restart, read back the persisted LTN pause again. No test triggers these events.

Offline fixtures cover durable LTN-only pause, no new scheduled LTN run, preserved
LTN failure history, enabled Cnyes, exactly one follow-up, and restart persistence.
The standalone scheduler/`--job all` pipeline does not read admin pause controls;
manual CLI runs must not be used to enact or silently bypass this source policy.
Pausing LTN does not establish data freshness or repair impact/warmup failures.

## Liveness, results, and due schedules (#89)

Service cards describe connectivity/liveness only. Each job summary queries all
retained admin history independently of either paginated table or recent-run list.
It reports the most recent success and failure in execution-record order, plus
consecutive failed terminal runs. Success or interruption breaks that streak;
queued/running records do not count as terminal results. No history is shown as
no recorded result, and absent summary data stays unavailable.

Next times remain the runtime's original planned timestamps. Due jobs show waiting
behind a currently active serial job when that snapshot provides the evidence;
otherwise the waiting cause stays unknown. Manual-only, paused, queued, running,
and no-follow-up states are explained without moving deadlines or changing locks.
All display times use Asia/Taipei. Actual data watermarks are not available in this
contract and remain unknown, even after a successful run.

## Accepted requests and run navigation (#90)

Only successful `job.run` and `job.retry` audits display **execution request
accepted**. This is distinct from the referenced run's queued/running/succeeded/
failed/interrupted result. Other operations retain their existing success/failure
labels and stored actor, target, and details.

Structured positive integer `details.run_id` links to `/admin?run=ID#run-detail`.
The same navigation is used for active/queued and latest-result references. The
authorized detail endpoint reads the exact ID independently of history pagination;
it never submits work. Missing/invalid/unreadable IDs stay unknown. UI responses
are checked against the requested ID and discarded after account/token changes.
