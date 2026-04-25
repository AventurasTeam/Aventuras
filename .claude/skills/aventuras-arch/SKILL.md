---
name: aventuras-arch
description: Spin-up for Aventuras docs / architecture work. Reads project READMEs + followups + git state, surfaces open items, proposes a focused agenda. INVOKE ONLY when the user explicitly types /aventuras-arch — do NOT use autonomously based on doc-related context.
---

# Aventuras architecture session init

Multi-session doc + architecture work for the Aventuras project.
This skill is the deliberate spin-up — it loads just enough context
to propose a session agenda, then hands back to the user to direct.

The general docs working rules (anchor links, three-tier UI
hierarchy, followups hygiene, prettier-ignore on wireframes, etc.)
are NOT repeated here. They auto-load via
[`.claude/rules/docs.md`](../../rules/docs.md) on any read under
`docs/**` — trust the auto-load.

---

## Steps

Run reads in parallel where they're independent.

1. **Entry-point READMEs.** Read all three:
   - `docs/README.md` — top-level index + structure rules
   - `docs/ui/README.md` — UI doc layout + screen index
   - `docs/ui/patterns/README.md` — patterns directory index

2. **Open ledger.** Read:
   - `docs/followups.md` — outstanding-only followups across all
     domains (Data-model / UX / Deferred sessions)

3. **User scratchpad.** Read if it exists:
   - `docs/user-notes.local.md` — gitignored personal scratchpad.
     May be absent or empty. Whatever's there is a hint about what's
     on the user's mind.

4. **Git state.** Run in parallel:
   - `git log --oneline -10` — recent commits, especially
     doc-related
   - `git status` — anything in-progress

**Do not** read `architecture.md`, `data-model.md`,
`tech-stack.md`, `principles.md`, individual pattern files, or
per-screen docs at this stage. They load on demand once the focus
area is known. Skipping them keeps init fast and the context window
clean.

---

## Synthesis — produce a brief session-init message

After the reads, send one focused message containing:

1. **Recent activity** — one or two lines summarizing what landed
   in the last few commits. The user already knows; this confirms
   shared context.

2. **Open followups by domain** — a grouped count plus the items
   that look closest to actionable. Don't dump full text; just
   titles + a short hint per item. Example shape:

   > Data-model (5): `entities.state` shape, manual worldTime
   > correction, top-K salience long-term memory, fictional
   > calendars, non-linear narrative.
   >
   > UX (12): immutable settings, rollback confirmation, lead
   > switch on peek, ...

3. **User-notes scratchpad** — if `user-notes.local.md` had
   content, surface it verbatim (the user wrote it for themselves;
   it's the strongest hint about session intent). If empty or
   absent, say so.

4. **Proposed focus candidates** — 1-3 specific things from the
   above that look like good targets for this session, with brief
   reasoning. Lean on what's hot in user-notes + recent commits.

5. **Ask what we're tackling.** End with a question. Do not start
   work until the user confirms direction.

---

## What this skill does NOT do

- Does not start work. Synthesis ends with a question, not an
  action.
- Does not read the large content docs (architecture / data-model /
  principles / per-screen) proactively. On-demand only.
- Does not repeat the docs working rules. Trust
  `.claude/rules/docs.md` to auto-load on doc reads.
- Does not run `pnpm lint:docs`, prettier, or any other validator
  at init — those run when work happens, not when planning.
