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
