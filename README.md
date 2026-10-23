# Curl to Code Batch
Live page: https://aamirtechs.github.io/curl-to-code-batch/

Convert a copied-as-cURL request to fetch, axios, Python requests, Go or PHP, with auth headers automatically pulled out into environment variables. Sellers, operators and developers currently do this by hand, one row or one request at a time, in spreadsheets and paid suites. This tool does the whole batch in the browser for free.

## Features
- Parses multi-line cURL with quotes and line continuations, including -H, -d, -F, -b, -u and --json flags.
- Generates fetch, axios, Python requests, Go net/http and PHP cURL from the same parsed request.
- Authorization, cookie and API key headers are pulled out into environment variable placeholders by default, never inlined.
- Warnings for flags with no equivalent in the target, plus a basic fetch or Python back to cURL converter.

## How it works
Paste or upload your input, set the options, and run the tool. All processing happens locally in your browser using the shared logic in `src/logic.js`, and you can download the results as files. It runs entirely in the browser.

## Privacy
Runs 100% in your browser. Your files never leave this device, nothing is uploaded,
and there is no tracking.

## Development
Core logic lives in `src/logic.js` and is shared by the page and the tests.
Run the tests with `npm test`.

## License
MIT, Copyright 2026 Amir Hussain.
