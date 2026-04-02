---
name: create-issue
description: Create GitHub issues for this project. Use this skill whenever the user wants to file a bug, report a performance problem, request a feature, suggest a UX improvement, or report a developer experience issue. Triggers on phrases like "create issue", "file a bug", "open an issue", "feature request", "performance issue", "ux improvement", "dx issue", or when the user describes a problem and wants to track it.
allowed-tools: Bash(gh issue:*), AskUserQuestion
---

# Create GitHub Issue

Create issues using the repo's issue form templates. The skill extracts as much as possible from the current conversation context, then asks for anything missing.

## Issue Types

| Type | Template | Label |
|------|----------|-------|
| Bug Report | bug-report.yml | `bug` |
| Feature Request | feature-request.yml | `enhancement` |
| Performance | performance.yml | `performance` |
| UX Improvement | ux-improvement.yml | `ux` |
| Developer Experience | developer-experience.yml | `dx` |

## Workflow

### Step 1: Determine Issue Type

Look at the conversation context for clues:
- Error reports, broken behavior → Bug
- "Slow", "laggy", "high CPU/memory" → Performance
- "Would be nice if", "I wish", new capability → Feature Request
- "Awkward", "clunky", workflow friction on existing features → UX Improvement
- Build/CI/testing/setup friction → Developer Experience

If ambiguous, ask the user with AskUserQuestion (show all 5 types).

### Step 2: Extract Fields from Context

Scan the conversation for information that maps to the template fields. Each type has different required fields:

**Bug Report** (required: area, description, steps, app version, macOS version):
- Look for error messages, stack traces, reproduction steps mentioned in chat
- Check if version info was discussed

**Feature Request** (required: area, problem/motivation, proposed solution):
- Look for pain points the user described
- Look for solutions they suggested

**Performance** (required: area, description, steps, expected perf, actual perf, app version, macOS version):
- Look for timing info, resource usage mentioned

**UX Improvement** (required: area, current behavior, proposed improvement, why it matters):
- Look for workflow descriptions and frustrations

**Developer Experience** (required: area, description, proposed solution):
- Look for build/CI/setup issues discussed

### Step 3: Ask for Missing Fields

Use AskUserQuestion to collect anything not found in context. Always ask for:
- **Area** — present as a dropdown with the relevant options for the issue type
- **Title** — suggest one based on context, let the user confirm or change it

For fields you extracted from context, present them for confirmation: "I found these details in our conversation — look right?"

### Step 4: Create the Issue

Format the body using `### Field Name` headers that match the template's field labels exactly. This is important because GitHub issue forms expect this format when created via the API.

Example body for a bug report:
```
### Affected Area

Terminal (ghostty-web / PTY)

### Description

The terminal flickers when resizing the split pane.

### Steps to Reproduce

1. Open two terminals in a split pane
2. Drag the divider to resize
3. Observe flickering in the right pane

### App Version

1.0.0

### macOS Version

15.4 (Sequoia)

### Relevant Logs

_No response_

### Screenshots

_No response_
```

For optional fields the user didn't provide, use `_No response_`.

Use a HEREDOC for the body to preserve formatting:
```bash
gh issue create \
  --label "<label>" \
  --title "<title>" \
  --body "$(cat <<'ISSUE_BODY'
<body content here>
ISSUE_BODY
)"
```

### Step 5: Report Back

Display the issue URL returned by `gh`. Done.
