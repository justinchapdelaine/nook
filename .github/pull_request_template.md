<!--
Aim for 150 to 300 words. A large PR can go longer.
Write for a reviewer who wasn't in the conversation: plain words, no
internal shorthand, and no plan or audit numbers unless explained.
Leave out file-by-file lists and commit hashes; the diff and commits
show those. Delete these comments and any optional section you don't use.
-->

## Why

<!-- 1 to 3 sentences: the problem, and the decision behind the change
(link the doc or owner decision). A docs-only or test-only PR says so here. -->

## What changes

<!-- 2 to 5 bullets about behaviour, not files: what someone using the
extension, or code calling into it, will now see differently. Name a
function, message or setting only when the reviewer needs it. -->

## Risk and review focus

<!-- What could go wrong in the browser after this ships, and the 1 to 3
places where a mistake would matter most, with what to check in each.
Cover whichever apply:
- Permissions: any added or widened permission or host access, and why
  it is needed.
- Pages or tabs that could break: sites where in-page changes could
  break layout or scripts, and tab actions that could lose tabs or
  groups, and how undo or restore covers them.
- Model download size and GPU memory: any change to what is downloaded,
  or how much memory is used.
- Web Store policy: remote code, data use, or anything a reviewer would
  question.
If the PR removes or loosens a safeguard, say what still protects
against that case. For a docs-only or test-only PR: "None: no shipped
files change." -->

## Testing

<!-- What ran and the result: tests, a manual run, a review. For a manual
run, name the browser and version, and say whether it ran in Helium.
Then anything not tested that matters. For a docs-only PR, one line is
enough. -->

<!-- Optional sections:

## Screenshots

For UI changes.

## Follow-ups

Known gaps left on purpose, with where they're tracked.
-->
