// wizard-group templates. The wizard isn't a pipeline run; these consume the
// full in-progress wizard working-state (definition, leadName/leadEntityId,
// opening) plus a per-invocation `guidance`. All rendering variation is resolved
// here in Liquid — the UI passes state through, it does not pre-shape the prompt.
// Templates carry creative content only: the JSON output contract (field list +
// format directive) is injected at call time by lib/ai from the Zod schema the
// reply validates against, so prompt and validator cannot drift.
export const WIZARD_OPENING = `Write the opening passage of a {{ definition.mode }} story.
{% if definition.setting != blank %}Setting: {{ definition.setting }}
{% endif %}{% if definition.genre.promptBody != blank %}Genre: {{ definition.genre.promptBody }}
{% endif %}{% if definition.tone.promptBody != blank %}Tone: {{ definition.tone.promptBody }}
{% endif %}{% if lore.size > 0 %}World reference:
{% for row in lore %}- {{ row.title }}: {{ row.body }}
{% endfor %}{% endif %}{% if leadEntityId != blank %}The lead character is {{ leadName }} (cast id: {{ leadEntityId }}).
{% endif %}{% if guidance != blank %}Additional guidance: {{ guidance }}
{% endif %}`

export const WIZARD_LORE = `Suggest five reference entries for this story's world — things that ARE, not things that happen: magic systems, factions' histories, cosmology, terminology.
{% if definition.setting != blank %}Setting: {{ definition.setting }}
{% endif %}{% if definition.genre.promptBody != blank %}Genre: {{ definition.genre.promptBody }}
{% endif %}{% if lore.size > 0 or suggested.size > 0 %}Already written (do not repeat these):
{% for row in lore %}- {{ row.title }}
{% endfor %}{% for name in suggested %}- {{ name }}
{% endfor %}{% endif %}{% if guidance != blank %}Additional guidance: {{ guidance }}
{% endif %}`

export const WIZARD_GENRE = `Suggest a genre for this story. Return a short label naming the genre, and a promptBody of two or three paragraphs instructing a model how to write in this genre — its conventions, register, and what belongs on the page — written the way a genre preset's body reads, not an encyclopedia entry describing the genre.
{% if definition.setting != blank %}Setting: {{ definition.setting }}
{% endif %}{% if definition.tone.promptBody != blank %}Tone: {{ definition.tone.promptBody }}
{% endif %}{% if guidance != blank %}Additional guidance: {{ guidance }}
{% endif %}`

export const WIZARD_TONE = `Suggest a tone for this story. Return a short label naming the tone, and a promptBody of two or three paragraphs instructing a model how to write in this tone — its register, pacing, and what to emphasize or avoid — written the way a tone preset's body reads, not an explanation of the tone.
{% if definition.setting != blank %}Setting: {{ definition.setting }}
{% endif %}{% if definition.genre.promptBody != blank %}Genre: {{ definition.genre.promptBody }}
{% endif %}{% if guidance != blank %}Additional guidance: {{ guidance }}
{% endif %}`

export const WIZARD_SETTING = `Suggest a setting for this story: one or two paragraphs of freeform prose describing the world — where and when it takes place, and its defining conditions.
{% if definition.genre.promptBody != blank %}Genre: {{ definition.genre.promptBody }}
{% endif %}{% if definition.tone.promptBody != blank %}Tone: {{ definition.tone.promptBody }}
{% endif %}{% if guidance != blank %}Additional guidance: {{ guidance }}
{% endif %}`

export const WIZARD_TITLE_CHIPS = `Suggest five short, evocative titles for this story.
Opening:
{{ opening.content }}
{% if guidance != blank %}Additional guidance: {{ guidance }}
{% endif %}`

export const WIZARD_DESCRIPTION = `Write a one-sentence description (a log line) for this story, based on its opening. Do not write narrative prose; write a concise synopsis.
Opening:
{{ opening.content }}
{% if guidance != blank %}Additional guidance: {{ guidance }}
{% endif %}`
