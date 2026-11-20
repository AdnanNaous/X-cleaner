X Cleaner

INSTALL ON CHROME
1. Extract X-Cleaner-1.7.3.zip.
2. In Chrome, enter chrome://extensions in the address bar.
3. Turn on Developer mode and choose Load unpacked.
4. Select the entire extracted X-Cleaner-1.7.3 folder.
5. Pin X Cleaner from Chrome's Extensions menu if you want it on the toolbar.

RUN
Sign in to x.com, then open X Cleaner from that tab. Check the account
shown in the popup. Choose one or more categories. The route runs in this
order: Posts, Reposts, Replies, Bookmarks, Likes. It skips unchecked categories.
Click Clean everything or Clean selected once to start. The extension creates a
dedicated X tab, visits the selected sections, and rechecks them. The popup
shows the route, the current section, and sections that need review. If X
sends the tab to Home, X Cleaner reopens the intended section up to twice.
Replies can also use X Search. Reposts can fall back to your own profile
and act only on active Undo repost controls. Bookmarks and Likes can use History. Leave that
tab open and use another tab while it runs. Stop is available in the extension
popup and in the progress panel on the cleanup tab. If X has already received
the current request, it may still finish. Continue cleanup resumes the
interrupted section when the selected categories match.

RESULTS
Deleted covers posts, replies and quote posts authored by the detected account. Reposts
are undone using the original post's X control. Bookmarks and likes are
removed from your account. Cards ignored counts out-of-scope cards encountered per scan,
such as other people's posts shown above a reply. Action errors count attempts the extension could not verify. The
popup lists sections that need review. The achievement appears when all
selected sections finish their verification scan without unresolved items.

COVERAGE AND ACCOUNT
Deletion is permanent. The extension can only process items X exposes in
the selected timelines. Older or unavailable items may not be discoverable
in those timelines. Automatic is the default speed. It starts at 10 seconds,
then uses 4 or 3 seconds after quick confirmations. An error or slow response
raises the wait to 15 seconds. Custom delay accepts 0 to 3600 seconds.
Every action is verified before the next one.
After six actions in a section, X Cleaner waits at least 45 seconds and
continues on the same page. A loading failure can trigger a recovery reload. Items that fail twice are listed for review
while the rest of the route continues. If X exposes its built-in Clear all
Bookmarks command, X Cleaner checks for the empty list before reporting All.
Eligible items that could not be processed are rechecked after a short
break without reloading the current page. A recovery reload keeps the route,
totals, and cooldown. If X shows a rate
limit or account restriction, the run stops and displays elapsed pause time.
Select OK to acknowledge the persistent alert. Resume manually when X is ready.
X prohibits scripting its website and can restrict accounts. No pace can
guarantee against enforcement. See https://help.x.com/en/rules-and-policies/x-automation

The extension uses your existing X session. It does not request passwords,
tokens, or cookies. Status and totals are stored locally in Chrome.

TAB HEALTH
The running cleanup tab is protected from Chrome automatic memory discard.
A scheduled health check can reactivate a frozen tab or reload an unresponsive
page. Stop and completion restore its original discard setting. Keep Chrome
open. Device sleep and browser shutdown can interrupt cleanup.

LOAD RECOVERY
Ordinary timeline-loading failures receive paced retries and an alternate
route where available. A section that remains unreadable is listed for review
while other selected sections continue. Explicit rate-limit and account
restriction notices keep the run paused until acknowledged and resumed.

Repeated unreadable routes remain listed for review during the current run.
Retry cleanup starts a fresh attempt after you acknowledge the report.
