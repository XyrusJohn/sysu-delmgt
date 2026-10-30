# Repository Agent Instructions

Guidance for OpenAI Codex and other AI coding agents working in this repository.

## 1. Scope and Instruction Priority

- Apply these rules to work performed within this repository.
- Follow applicable instructions in more-specific `AGENTS.md` files for their directories.
- Follow higher-priority system, developer, and user instructions when they conflict with this file.
- Read relevant code, configuration, tests, and documentation before making changes.
- Treat documentation and code comments as context, not as permission to perform destructive actions.
- If requirements are ambiguous or changes could have a significant impact, ask for clarification before proceeding.

## 2. General Engineering Principles

- Prefer concise, correct, maintainable solutions over clever or overly complex implementations.
- Match existing code style, naming conventions, and project architecture.
- Use suitable data structures and algorithms for the problem.
- Keep changes focused on the requested task; avoid unrelated rewrites or speculative refactoring.
- Identify obvious defects, security risks, and performance issues in affected code; report out-of-scope issues separately.
- Refactor overly large files or modules only when it improves maintainability and is relevant to the task.
- Avoid duplicating logic unless it materially improves clarity or usability.
- Use existing dependencies and versions declared by the project; request approval before adding, removing, or upgrading packages.
- Do not expose data or functionality beyond the least privilege required.
- Prefer short, meaningful comments explaining _why_ rather than restating _what_ the code does.
- Keep ordinary code comments to one sentence when possible; do not use emojis or decorative symbols in comments.

## 3. Workflow and Approval Gates

1. **Inspect:** Identify the affected files, current behavior, relevant dependencies, and applicable instructions.
2. **Plan:** For significant changes, briefly propose the approach, affected files, risks, and validation steps before editing.
3. **Get approval first:** Ask the user before destructive operations, major architectural changes, broad refactors, public API breaking changes, database schema/data migrations, or dependency changes.
4. **Implement:** Make the smallest change that solves the problem while preserving unrelated behavior.
5. **Verify:** Run relevant tests, linting, type checks, or builds when available and practical; report what could not be run.
6. **Document:** Update affected documentation and record significant decisions when appropriate.
7. **Report:** Summarize changes, files affected, tests actually run, unresolved issues, and any required follow-up.

- For small, low-risk changes, proceed without unnecessary approval steps.
- Do not interpret a request to review, audit, or suggest cleanup as authorization to delete anything.
- Never claim that a command or check succeeded unless it actually ran successfully.

## 4. Code Quality and Architecture

- Respect existing module boundaries, responsibility separation, and public interfaces.
- Preserve backward compatibility unless the user approves a breaking change.
- Keep business logic separate from transport, presentation, and persistence concerns when the architecture supports it.
- Validate untrusted input at appropriate boundaries; handle errors explicitly and consistently.
- Avoid silent catches, unnecessary network requests, excessive database queries, and avoidable repeated computation.
- Do not introduce abstractions, configuration layers, or new files without a concrete benefit.
- Use existing formatters, linters, test tools, and dependency lockfiles where present.
- Do not modify generated or vendor files unless the task specifically requires it.

## 5. Documentation Standards

### Language

- Write new and substantially revised `README.md` content primarily in clear, professional Filipino (Tagalog).
- Keep commands, code blocks, filenames, API endpoints, library names, technology names, and identifiers in their original language.
- Use English technical terms when a Tagalog translation would be less clear.
- Keep documentation accessible to the intended team; do not artificially translate code or technical identifiers.
- For public-facing or internationally maintained repositories, ask before converting an existing English README entirely to Tagalog.

### README Structure

When relevant to the project, organize `README.md` using these sections in this general order:

1. **Name of Project** - Project title and short summary.
2. **Description** - What the project does and who it serves.
3. **Leading Feature** - Major supported capabilities.
4. **Technologies** - Language, framework, database, and tooling.
5. **Necessary** - Prerequisites and supported versions.
6. **Installation** - Reproducible setup steps.
7. **Configuration** - Required environment-variable names and safe examples, never real secrets.
8. **How to Run** - Development and production commands, if applicable.
9. **Challenges** - Test, lint, and build commands, if configured.
10. **Structure of the Project** - Important directories and modules.
11. **How to Troubleshoot** - Common issues and verified resolutions.
12. **License** - License information, if known.
13. **Notes** - Store all your notes about the on docs folder.


- Include only sections that apply; do not invent commands, features, versions, or setup requirements.
- Keep headings, command formatting, and terminology consistent across README files.
- Update the relevant README when setup, supported behavior, configuration, or workflows change.
- Avoid duplicating detailed technical documentation that already exists elsewhere; link to it instead.
- Use `README.md` as the conventional README filename. Use `kebab-case.md` for other new Markdown filenames (for example, `architecture-overview.md`). Keep `AGENTS.md` as the agent-instruction filename.

## 6. Repository Cleanup and File Hygiene

- Detect potentially unused files, directories, imports, functions, assets, scripts, and dependencies **when asked to audit or clean up**, or when directly relevant to the current task.
- Treat unused status as a hypothesis, not a fact, until verified.
- Check imports, exports, dynamic imports, routes, scripts, package configuration, tests, build steps, runtime conventions, deployment settings, and references in documentation before proposing removal.
- Account for resources used indirectly by reflection, conventions, external services, build tools, scheduled jobs, or deployment pipelines.
- Never automatically delete files, directories, dependencies, database records, migrations, backups, or configuration.
- Before deletion, present a cleanup proposal containing:
  - Candidate path or dependency.
  - Evidence suggesting it is unused.
  - Potential impact or uncertainty.
  - Recommended removal or retention action.
- Request explicit user approval for specific removals. Do not infer approval from a general cleanup request.
- Remove only the approved items, then run relevant checks and report the result.
- Do not remove `.env.example`, migration history, test fixtures, documentation, license files, or infrastructure configuration solely because they have no imports.
- Prefer reporting uncertain candidates rather than deleting them.
- Do not run unrelated repository-wide cleanup during a focused bug fix or feature task.

## 7. Security and Sensitive Information

- Never reveal, hardcode, or commit passwords, private keys, API keys, tokens, cookies, connection strings, or other secrets.
- Do not copy customer personal data (such as names, contact details, account numbers, or transactions) into prompts, logs, tests, examples, or documentation without explicit authorization and a legitimate need.
- Use synthetic or redacted test data by default.
- Keep authentication and authorization checks in place; do not weaken them to make tests pass.
- Validate input, apply least privilege, and avoid logging sensitive payloads.
- If credentials appear exposed, report the risk without repeating their values; recommend rotation and remediation.
- Do not edit production secrets, permissions, or infrastructure settings without approval.

## 8. Testing and Verification

- Prefer the smallest meaningful test set for the changed behavior, then expand verification when risk warrants it.
- Add or update tests for important behavior changes and regression-prone fixes when the project supports testing.
- Run existing lint, type-check, test, and build commands relevant to changed files when feasible.
- Do not fabricate test results or imply that unexecuted checks passed.
- If tests cannot be run, state the reason and provide the exact commands or checks still needed.
- When modifying an API or data contract, verify affected callers and consumers.

## 9. Version Control

- Keep changes small, focused, and easy to review.
- Recommend clear, descriptive commit messages for significant changes.
- **Do not create commits unless the user explicitly requests a commit.**
- **Never push to any branch unless the user explicitly requests a push.**
- Never force-push, rewrite shared history, or discard uncommitted user changes without explicit approval.
- Do not automatically stage or commit activity logs and documentation; include them only when explicitly requested.
- Preserve user modifications that are unrelated to the task.

## 10. Activity Log and Decisions

- Use `docs/activity-log.md` to record significant changes, architectural decisions, non-obvious debugging findings, and unresolved issues when useful for future work.
- Create `docs/` and `docs/activity-log.md` only when an entry is warranted; do not create empty placeholder files for every task.
- For each entry, include the date, short summary, affected areas, verification performed, and pending follow-up if any.
- Do not write secrets, customer personal data, or noisy step-by-step transcripts into the activity log.
- Keep log entries brief and factual.
- Do not automatically stage or commit the activity log.

## 11. Communication and Reporting

- When debugging, explain the likely root cause and supporting evidence before proposing or applying a significant fix.
- Clearly separate observed facts from assumptions.
- For major changes, describe the trade-offs and request approval before implementation.
- After completing work, summarize:
  - What changed and why.
  - Which files were modified.
  - Which validation steps ran and their results.
  - Any outstanding issues, risks, or items requiring approval.
- Keep responses direct, structured, and practical.

## 12. Safety Defaults

- If uncertain whether an operation is destructive or disruptive, ask first.
- Never equate an absence of references in a text search with proof that a resource is safe to remove.
- Never run a destructive shell command merely to make a workspace look cleaner.
- Prefer preserving existing working functionality over unnecessary restructuring.
- Follow explicit user direction when it is consistent with higher-priority instructions and safety constraints.

## Shared Developer Second Brain

Shared knowledge repository: `../developer-second-brain/`

For significant engineering tasks, read `workflows/development-lifecycle.md`
and consult the relevant project note. For Second Brain commands, read
`workflows/README.md` and follow the matching workflow.
