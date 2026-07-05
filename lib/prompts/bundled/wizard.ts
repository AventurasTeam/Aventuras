// wizard-group templates. The wizard isn't a pipeline run; these consume the
// full in-progress wizard working-state (definition, leadName/leadEntityId,
// opening) plus a per-invocation `guidance`. All rendering variation is resolved
// here in Liquid — the UI passes state through, it does not pre-shape the prompt.
export const WIZARD_OPENING = `Write the opening passage of a {{ definition.mode }} story.
{% if definition.setting != blank %}Setting: {{ definition.setting }}
{% endif %}{% if definition.genre.promptBody != blank %}Genre: {{ definition.genre.promptBody }}
{% endif %}{% if definition.tone.promptBody != blank %}Tone: {{ definition.tone.promptBody }}
{% endif %}{% if leadEntityId != blank %}The lead character is {{ leadName }} (cast id: {{ leadEntityId }}).
{% endif %}{% if guidance != blank %}Additional guidance: {{ guidance }}
{% endif %}Return a JSON object with these fields:
- "prose": the opening passage as a string.
- "sceneEntities": array of cast ids present in the scene (use the exact cast id(s) provided above; [] if none).
- "currentLocationId": the location id where the scene opens, or null.
- "worldTime": 0.
{% include 'macro_output_format_json' %}`

export const WIZARD_TITLE_CHIPS = `Suggest five short, evocative titles for this story.
Opening:
{{ opening.content }}
{% if guidance != blank %}Additional guidance: {{ guidance }}
{% endif %}Return a JSON object: { "titles": ["...", "...", ...] }.
{% include 'macro_output_format_json' %}`

export const WIZARD_DESCRIPTION = `Write a one-sentence description (a log line) for this story, based on its opening. Do not write narrative prose; write a concise synopsis.
Opening:
{{ opening.content }}
{% if guidance != blank %}Additional guidance: {{ guidance }}
{% endif %}Return a JSON object: { "description": "..." }.
{% include 'macro_output_format_json' %}`
