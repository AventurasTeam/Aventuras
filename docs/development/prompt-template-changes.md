# Prompt template changes

Templates live in `src/lib/services/prompts/templates/*.ts`: `content` is the System part,
`userContent` the User part. Built-in templates a user hasn't edited update on their own; edited
ones and custom or imported packs never do, so a template change needs instructions for applying
it by hand.

On startup `backfillMissingTemplates` inserts any template id a pack lacks, including the
`<id>-user` row for a User part added to an existing template, so neither needs instructions on its
own. It never overwrites, so a User part added alongside an edit to the System part (text moved
from one to the other) still needs instructions for the System edit. So does a change to what a
service passes to `ctx.add(…)` for a template: a variable added, renamed or removed, or its
contents moved into another.

A PR that needs them gets `## Updating your prompt pack` directly after `## Summary`:

- Open with who needs it: people who edited the template or use a custom or imported pack.
  Built-in templates they haven't touched update on their own.
- Name the template as the Vault shows it (e.g. **Lore Management**).
- One `###` step per edit, labelled **System** or **User** and **required**, **recommended** or
  **optional**. A required step says what breaks without it and names any setting that turns the
  new behaviour off.
- Verbatim "Find" and "Replace" fenced blocks, backticks unescaped. Find is the shortest text that
  occurs once; replace the whole block when the edit spans lines.
- If an earlier PR's edit is a prerequisite, link it and show the line with both applied.
- End with a line listing the variables newly available to the template.
- Check every snippet against the template before and after the change.

Otherwise leave the section out and don't mention it.
