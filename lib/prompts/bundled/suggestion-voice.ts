// staticContent: reads only `mode`, `person` (composerWrapPov) and `lead` (a name, blank without
// one); both emission macros include it (reader-composer.md → Next-turn suggestions).
export const SUGGESTION_VOICE = `{%- if lead != blank -%}
{%- assign who = lead -%}
{%- else -%}
{%- assign who = "the user's character" -%}
{%- endif -%}
{%- if mode == 'adventure' -%}
Write each option as {{ who }}'s next turn: what {{ who }} does, says or attempts next, never how the world or anyone else responds. {% if person == 'third' and lead != blank %}Write it in the third person, calling {{ lead }} by name.{% else %}Write it in the first person, as "I".{% endif %} Draw only on what {{ who }} knows.
{%- else -%}
Write each option as a short direction for the story's next beat, in the third person, calling characters by name ("the guards catch them at the gate"), not as story prose. It may involve any character.
{%- endif -%}`
