---
name: tackle-issue
description: "Tackle a GitHub issue end-to-end: fetch it, analyze it, create a branch, plan the implementation, and execute. Use this skill whenever the user wants to work on a GitHub issue, fix a bug from an issue, implement a feature from an issue, or mentions an issue number/URL. Also triggers on phrases like 'tackle issue', 'work on issue', 'pick up issue', 'start issue', 'grab an issue', or 'what issues do I have'."
---

# Tackle Issue

Take a GitHub issue from selection to implementation — fetch, analyze, branch, plan, execute.

## Arguments

- `args` (optional): GitHub issue URL or number (e.g., `42`, `#42`, `https://github.com/owner/repo/issues/42`)

## Flow

```
args provided? ──yes──▶ Fetch issue
      │
      no
      ▼
Fetch open issues (my assignments first)
      ▼
Present paginated list → user picks one
      ▼
Fetch full issue
      ▼
Analyze issue + codebase context
      ▼
Assign me if not already assigned
      ▼
git fetch origin → create worktree (wt CLI or fallback)
      ▼
Ask user: "Ready to plan the implementation?"
      ▼
Enter plan mode with issue context
      ▼
Execute plan
      ▼
Link PR to issue (Development field)
```

## Step 1: Resolve the Issue

### If args provided

Extract the issue number from the argument. Accept these formats:
- `42` or `#42` → issue number directly
- `https://github.com/nept/superagent/issues/42` → parse the number from the URL
- `nept/superagent#42` → parse number

Fetch the issue:
```bash
gh issue view <number> --json number,title,body,labels,assignees,state,comments,milestone
```

### If no args provided

Fetch open issues in two groups — assigned to me first, then the rest:

```bash
# Get current GitHub username
GH_USER=$(gh api user --jq '.login')

# Fetch my assigned issues (most recent first)
gh issue list --assignee "$GH_USER" --state open --limit 50 --json number,title,labels,assignees,createdAt

# Fetch unassigned/other issues
gh issue list --state open --limit 50 --json number,title,labels,assignees,createdAt
```

Present a paginated list (10 per page). Format:

```
Assigned to you:
  1. #42  feat: dark mode support                    [enhancement]
  2. #38  fix: sidebar crash on 40+ workspaces       [bug]

Other open issues:
  3. #45  chore: update dependencies                 [chore]
  4. #41  feat: keyboard shortcuts config             [enhancement]
  ...

Page 1/3 — Enter a number to select, 'n' for next page, or 'f' to filter by label.
```

If the user asks to filter by label, re-fetch with `--label <label>`.

Use AskUserQuestion to let the user pick an issue. Then fetch full details with `gh issue view`.

## Step 2: Analyze the Issue

Read the issue title, body, labels, and comments. Summarize:
- **What**: one-line summary of what needs to happen
- **Why**: motivation or context from the issue
- **Scope**: affected areas (files, modules, layers — frontend/backend/both)
- **Labels**: list them
- **Acceptance criteria**: extract from the issue body if present, or infer from the description

If the issue references files, components, or modules — read them to understand the current state.

Read CLAUDE.md, BACKEND.md, and FRONTEND.md as needed to understand project conventions.

## Step 3: Assign Myself

Check if I'm already assigned. If not, assign me:

```bash
gh issue edit <number> --add-assignee "@me"
```

## Step 4: Create a Worktree

Create an isolated worktree for this issue. Determine the branch name first:

**Branch naming:** `<type>/<issue-number>-<short-slug>`
- Type from labels: `bug` → `fix`, `enhancement`/`feature` → `feat`, otherwise → `chore`
- Slug: lowercase, hyphens, max 50 chars, no trailing hyphens

Examples:
- Issue #42 "Add dark mode support" with label `enhancement` → `feat/42-add-dark-mode-support`
- Issue #38 "Sidebar crash on 40+ workspaces" with label `bug` → `fix/38-sidebar-crash-on-40-workspaces`
- Issue #45 "Update dependencies" → `chore/45-update-dependencies`

### Path A: `wt` CLI available

Check with `command -v wt`. If available, use it — it handles worktree directory, hooks, and setup automatically:

```bash
git fetch origin
wt switch --create <type>/<number>-<slug> --base origin/main --no-cd -y
```

Then `cd` into the worktree path reported by `wt`.

### Path B: Fallback (no `wt`)

1. **Detect directory** — priority: `.worktrees/` > `worktrees/` > CLAUDE.md preference > ask user
2. **Safety check** — `git check-ignore -q <dir>` for project-local dirs; add to `.gitignore` + commit if not ignored
3. **Create worktree:**
   ```bash
   git fetch origin
   git worktree add <dir>/<slug> -b <type>/<number>-<slug> origin/main
   ```
4. **cd into worktree**
5. **Run project setup** — auto-detect from project files (`bun install`, `cargo build`, etc.)
6. **Baseline tests** — run tests; report failures if any, ask whether to proceed

All subsequent work (planning, implementation) happens inside the worktree.

## Step 5: Enter Plan Mode

Ask the user: "Ready to plan the implementation for #<number>?" — then enter plan mode with the issue context pre-loaded.

Structure the plan around the issue. Keep it concise — sacrifice grammar for brevity:

```markdown
# <type>: <issue title> (#<number>)

> **Issue:** <link>

## Context
<1-2 lines from the issue analysis>

## Changes
1. <file/module> — <what to change and why>
2. ...

## Verification
- `<command>` — <what it checks>

## Questions
- <if any>
```

## Step 6: Execute

After the plan is approved, execute it following the plan phases. After completing all phases:

1. Run every command from the Verification section
2. Fix any failures and re-verify
3. Only report completion after all verification passes

## Step 7: Link PR to Issue

After verification passes, check if a PR already exists on the current branch:

```bash
gh pr view --json url --jq '.url' 2>/dev/null
```

- **PR exists:** Link it to the issue's Development field:
  ```bash
  gh issue develop <number> --name <branch-name>
  ```
  Report: "Linked PR <url> to #<number>."

- **No PR yet:** Tell the user:
  > "No PR found on this branch yet. When you create one, I'll link it — or you can run:
  > `gh issue develop <number> --name <branch-name>`"

## Notes

- Follow project conventions: conventional commits (`feat:`, `fix:`, `chore:` with optional scope), Tailwind-first styling, React ARIA components, etc.
- If the issue is unclear or missing information, surface that in the plan's Questions section rather than guessing
- For large issues, suggest breaking them into sub-issues before planning
