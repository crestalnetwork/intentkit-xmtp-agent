# LLM Integration Guide for IntentKit XMTP Agent

This guide provides comprehensive information for Large Language Models working with this project.

## Project Overview


## Technology Stack


## Rules

1. Always use the latest version of the new package.
2. Always use English for code comments.
3. Always use English to search.
4. Always place imports at the beginning of the file in your new code.


## Dev Guide

## Ops Guide

### Git Commit
When you generate git commit message, always start with one of feat/fix/chore/docs/test/refactor/improve. Title Format: `<type>: <subject>`, subject should start with lowercase. Only one-line needed, do not generate commit message body.

### Github Release
1. Make a `git pull` first.
2. Find the last version number using `git tag`, diff with it, summarize the release note to changelog.md for later use, don't commit this temporary file. Regardless of release or pre-release, we use the unified vX.X.X as the version number without adding a suffix. Calculate the version number of this release. Add a diff link to release note too, the from and to should be the version number.
3. And also insert the release note to the beginning of RELEASE_NOTES.md (This file contains all history release notes, don't use it in gh command)
4. Made an extra git add, commit, push for new release notes changes.
5. Construct `gh release create` command, calculate the next version number, use changelog.md as notes file in gh command.
6. Use gh to do release only, don't create branch, tag, or pull request.
