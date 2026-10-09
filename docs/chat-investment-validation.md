# Investment arrangement validation

## Scope and evidence

The original account-arrangement question is supported without a query whitelist
or a required rewrite. Work started from `origin/main` at `be18920e` in a separate
checkout of the existing `main` branch, preserving the dirty `wei` checkout.

The production `chat_validation_runs` table was verified through read-only SQL.
Two completed historical runs of the original question ended in fallback; a third
was interrupted before an answer attempt. Both complete runs included 52 source
snapshots, initial and repair drafts, finish reasons, token counts and timings.
Their durations were 51,765 ms and 45,789 ms, with 198,116 and 196,007 total input
tokens respectively. The snapshots were not clipped.

Observed failures were not interchangeable:

- A neutral compound heading was treated as an uncited claim.
- The numeric parser did not understand an adjacent postposed company in a
  comparison, or qualifiers such as “high as”. Explicit company ownership must
  still carry into a conjunction after a semicolon: fixing the first parse error
  exposed a real attribution error in the historical repair.
- One historical repair ended with `finish_reason=length`; withholding it was
  correct.
- Live verification exposed an uncited list introduction, an action prefixed by
  a plan label, exact JSON field aliases embedded in account prose, and confusion
  between the UTC date and the Taipei snapshot date.
- Correct volatility numbers accompanied an unsupported “most stable” ranking.
  A successful numeric check alone was insufficient.
- A rationale for a risk-control action was mistaken for a claim about the cause
  of a market move.

Historical and live drafts are not blanket positive examples. They also contained
unverified risk descriptions, overlapping allocations, and statements confusing
unqueried stocks with unavailable data. Complete private evidence and local live
diagnostics remain in the operator's ignored `.state` directory; they are not
committed or exported into public fixtures.

## Changes

- Recognize neutral compound and numbered headings without exempting factual
  headings. A constrained colon introduction and its first adjacent list item
  form one validation unit; every claim is checked against that item's citations.
  Later list items cannot lend their citations backward.
- Recognize supported metric qualifiers, immediately adjacent postposed company
  names, exact matching account-field aliases, and local plan labels. None of
  these changes resets the cumulative cash or inventory checks.
- Include the Taipei representation of the original account snapshot instant in
  personal evidence and source publication time.
- Check explicit extrema against the complete locally cited comparison universe
  and common period. Undefined stability superlatives require repair; conditional
  investment preferences remain allowed.
- Distinguish an explicitly conditional entry followed by a metric-based reason
  for setting a stop from an explanation of an observed price move. Numeric and
  comparison checks still run on the original text; other market causes in the
  same sentence retain their grounding requirements.
- Focus account answers on the snapshot, coverage, allocation issues, and one
  funded plan with adoption conditions. Other directions are expressed as
  conditions, not independent uses of the same money.
- Synchronize the existing slow-audit test with writer entry after asserting the
  response deadline; a 10 ms timeout does not guarantee a Windows thread has
  already started. The queue and bounded response assertions remain intact.

The model, framework, source identity, one-repair maximum, repair token limit and
whole-turn timeout are unchanged. Production verification uses read-only account
queries and local diagnostic persistence, not account mutations.

## Fixed-data coverage

Regression fixtures cover the original question with cash and favorites, holdings,
and pending buy/sell orders. They exercise synchronous and streaming publication,
real SQLite audit persistence, and administrator list/detail reads. Separate
preparation tests use the original question through personal scope detection,
source selection, retrieval arguments and coverage disclosure.

Negative cases retain rejection or one safe repair for wrong account amounts,
invented inventory, unsupported market causes, wrong rankings, cash over-allocation,
sales exceeding inventory after reservations, wrong dates, and truncated drafts.
Missing-price and mismatched-date examples explicitly state their limitations.
The generated test responses are controlled fixtures, not claims of live-model
reliability.

With explicit approval, the original question was also sent through the existing
Google model and production read-only evidence flow. Successive runs exposed
additional reproducible parser errors and a bad ranking; they were not treated as
successful merely because they returned text. The last initial draft completed in
31,108 ms with `finish_reason=stop`, 80,237 input tokens, and 942 output tokens.
It was originally rejected for the risk-control rationale, and its repair hit the
60-second whole-turn deadline. After the local parsing fixes, that **same complete
initial text and all 22 original sources** pass validation without modifying the
text or generating another sample. This is a frozen real-output replay, not a
claim that the earlier timeout became a successful live request.

A synthetic example is: an account with 40,000 available cash, 10,000 reserved for
an existing buy order, and 100 shares with 40 reserved for a sale may discuss
investing 10,000 and retaining 30,000. It may sell at most 60 additional shares.
The answer must identify the snapshot and price dates, the stocks actually
examined, the missing evidence, and the conditions for using that plan.

## Verification and limits

After the final code change, **1,164 chat, administrator review, architecture,
system and streaming tests passed**. The frontend `test:chat` suite also passed.

A broader suite exposed unrelated failures, reproduced from the pristine
`be18920e` archive: nine failures and two setup errors in environment isolation,
the schema table allowlist, an unavailable Firebase dependency, backtest catalog
fixtures, and unavailable legacy-contract code. Those tests and their production
paths were not changed to conceal failures.

The validators recognize bounded wording and structured evidence; they are not
general semantic entailment. Missing or changing upstream data, provider latency,
and generation truncation can still prevent a substantive answer within the
existing deadline. No new request loop or model sampling until success is added.
Input size was observed to be large, but it is not established as the cause of a
particular truncation or timeout. That diagnosis remains unverified.
