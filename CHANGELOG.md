# Changelog

## 1.0.0 - 2026-10-23

- Parses multi-line cURL with quotes and line continuations, including -H, -d, -F, -b, -u and --json flags.
- Generates fetch, axios, Python requests, Go net/http and PHP cURL from the same parsed request.
- Authorization, cookie and API key headers are pulled out into environment variable placeholders by default, never inlined.
- Warnings for flags with no equivalent in the target, plus a basic fetch or Python back to cURL converter.
