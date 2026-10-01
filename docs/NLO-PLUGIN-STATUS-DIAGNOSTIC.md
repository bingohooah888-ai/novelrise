# NLO ChatGPT Plugin Bootstrap Status

The existing `autorecovery_install` action now waits for the ChatGPT plugin autoregistration helper for a bounded period and reports only non-secret status fields.

Reported fields:
- whether autoregistration started
- whether the bounded wait timed out
- plugin status
- plugin id when available
- installed flag
- browser profile source
- failure reason/error when available

The tunnel id value itself is never printed.
