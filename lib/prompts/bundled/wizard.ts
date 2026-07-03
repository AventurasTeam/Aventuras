// wizard-group templates. The wizard isn't a pipeline run; these build prompts
// from the in-progress story `definition` and the minimal `lead` character.
export const WIZARD_OPENING = `Write the opening passage of a {{ definition.mode }} story.
{% if definition.setting != blank %}Setting: {{ definition.setting }}
{% endif %}{% if definition.genre.promptBody != blank %}Genre: {{ definition.genre.promptBody }}
{% endif %}{% if definition.tone.promptBody != blank %}Tone: {{ definition.tone.promptBody }}
{% endif %}{% if lead %}The lead character is {{ lead.name }} (cast id: {{ lead.id }}).
{% endif %}Return a JSON object with these fields:
- "prose": the opening passage as a string.
- "sceneEntities": array of cast ids present in the scene (use the exact cast id(s) provided above; [] if none).
- "currentLocationId": the location id where the scene opens, or null.
- "worldTime": 0.
{% include 'macro_output_format_json' %}`

export const WIZARD_TITLE_CHIPS = `Suggest five short, evocative titles for this story.
Opening:
{{ opening }}
Return a JSON object: { "titles": ["...", "...", ...] }.
{% include 'macro_output_format_json' %}`

export const WIZARD_DESCRIPTION = `Write a one-sentence description (a log line) for this story, based on its opening. Do not write narrative prose; write a concise synopsis.
Opening:
{{ opening }}
Return a JSON object: { "description": "..." }.
{% include 'macro_output_format_json' %}`
