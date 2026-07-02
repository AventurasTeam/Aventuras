// wizard-group templates. The wizard isn't a pipeline run; these build prompts
// from the in-progress story `definition` and the minimal `lead` character.
export const WIZARD_OPENING = `Write the opening passage of a {{ definition.mode }} story.
{% if definition.setting != blank %}Setting: {{ definition.setting }}
{% endif %}{% if definition.genre.promptBody != blank %}Genre: {{ definition.genre.promptBody }}
{% endif %}{% if definition.tone.promptBody != blank %}Tone: {{ definition.tone.promptBody }}
{% endif %}The lead character is {{ lead.name }}.
{% include 'macro_output_format_narrative' %}`

export const WIZARD_TITLE_CHIPS = `Suggest five short, evocative titles for this story.
Opening:
{{ opening }}
{% include 'macro_output_format_json' %}`

export const WIZARD_DESCRIPTION = `Write a one-sentence description for this story, based on its opening.
Opening:
{{ opening }}
{% include 'macro_output_format_narrative' %}`
