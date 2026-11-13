# X Cleaner

A Chrome extension for cleaning up your own X posts, replies, reposts, bookmarks, and likes. It detects the signed-in account from X and shows the handle before a run.

## Install

Download and extract [X Cleaner 1.4.0](./X-Cleaner-1.4.0.zip?raw=true), or download this repository and use its `extension` folder. In Chrome, open `chrome://extensions`, enable **Developer mode**, then click **Load unpacked** and select the folder containing `manifest.json`.

## Use

1. Sign in on [x.com](https://x.com) and open the extension from that tab.
2. Check the detected handle and select what to clean.
3. Click **Preview route** to scan, or **Clean selected** to remove the selected activity. Deletions are permanent.

The popup shows progress, results, and issues. Account changes, sign-in prompts, and rate limits pause the run. The cleaner only works with items X makes available in its interface. X prohibits non-API automation and can restrict accounts under its [automation rules](https://help.x.com/en/rules-and-policies/x-automation).

## Privacy

The extension reads the signed-in handle from the page. It stores the run and its results locally in Chrome. It does not collect credentials, cookies, or analytics, or send reports to a third-party service.

## Tests

From the repository root, run the tests with Node.js.

```sh
node tests/test-worker.cjs
node tests/test-content.cjs
node tests/test-popup.cjs
```

The tests use simulated X pages and Chrome extension APIs.
