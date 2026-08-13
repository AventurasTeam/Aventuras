// wizard-group templates. The wizard isn't a pipeline run; these consume the
// full in-progress wizard working-state (definition, cast/leadEntityId,
// opening) plus a per-invocation `guidance`. All rendering variation is resolved
// here in Liquid — the UI passes state through, it does not pre-shape the prompt.
// Templates carry creative content only: the JSON output contract (field list +
// format directive) is injected at call time by lib/ai from the Zod schema the
// reply validates against, so prompt and validator cannot drift.
//
// Each prose field is a pair — generate and refine — over one shared macro. The
// macro holds everything the two have in common (the output contract, and the
// wizard state that grounds the call); only the leading directive and the
// revise block differ. Splitting it the other way would duplicate the quality
// bar, which is the half most likely to be tuned and so the half most likely to
// drift. Refine templates take `current` (the preview being revised) and
// `instruction`, and deliberately carry no `guidance`: canon defines a refine as
// current preview plus refinement instruction, and the guidance a refine could
// otherwise inherit belongs to a generate the user may never have seen.

// activeCast, not the raw cast.size gate: staged rows must not appear in
// sceneEntities/currentLocationId (canon), and gating the header on the
// unfiltered array would leave a dangling "Cast —" label when everything
// authored so far is staged (architecture.md's conditional-section-header rule).
//
// Every active kind is listed — factions ground the prose even though they are
// never scene-tagged — so the header has to say which kind belongs in which
// field. openingOutputSchema types sceneEntities as a bare string array, so the
// prompt is the model's only signal; Finish re-filters by kind regardless.
//
// The lead line also checks leadRows.first, not just leadEntityId != blank:
// this macro doesn't own how leadEntityId got set, and naming an id as the
// lead while the cast block above excludes that same id (staged, or simply
// absent from cast) would contradict the prompt in the same breath.
export const MACRO_WIZARD_OPENING_CONTEXT = `{% if definition.setting != blank %}Setting: {{ definition.setting }}
{% endif %}{% if definition.genre.promptBody != blank %}Genre: {{ definition.genre.promptBody }}
{% endif %}{% if definition.tone.promptBody != blank %}Tone: {{ definition.tone.promptBody }}
{% endif %}{% if lore.size > 0 %}World reference:
{% for row in lore %}- {{ row.title }}: {{ row.body }}
{% endfor %}{% endif %}{% assign activeCast = cast | active %}{% if activeCast.size > 0 %}Cast — sceneEntities takes only the character and item ids from this list, currentLocationId only a location id from it; factions are never scene-tagged:
{% for row in activeCast %}- {{ row.name }} ({{ row.kind }}, cast id: {{ row.id }}){% if row.description != blank %}: {{ row.description }}{% endif %}
{% endfor %}{% endif %}{% assign leadRows = activeCast | where: 'id', leadEntityId %}{% if leadEntityId != blank and leadRows.first %}The lead character's cast id is {{ leadEntityId }}.
{% endif %}`

export const WIZARD_OPENING = `Write the opening passage of this {{ definition.mode }} story.
{% include 'macro_wizard_opening_context' %}{% if guidance != blank %}Additional guidance: {{ guidance }}
{% endif %}`

export const WIZARD_OPENING_REFINE = `Revise the opening passage of this {{ definition.mode }} story below, rather than writing a new one.

Current opening:
{{ current.content }}

Revision instruction: {{ instruction }}

{% include 'macro_wizard_opening_context' %}`

export const WIZARD_LORE = `Suggest five reference entries for this story's world — things that ARE, not things that happen: magic systems, factions' histories, cosmology, terminology.
{% if definition.setting != blank %}Setting: {{ definition.setting }}
{% endif %}{% if definition.genre.promptBody != blank %}Genre: {{ definition.genre.promptBody }}
{% endif %}{% if lore.size > 0 or suggested.size > 0 %}Already written (do not repeat these):
{% for row in lore %}- {{ row.title }}
{% endfor %}{% for name in suggested %}- {{ name }}
{% endfor %}{% endif %}{% if guidance != blank %}Additional guidance: {{ guidance }}
{% endif %}`

// Raw cast, not activeCast: unlike the opening macro above, the exclusion
// list must keep staged rows too — a staged row is still "already suggested"
// and re-offering it on `Generate more` is a repeat regardless of status.
export const WIZARD_CAST = `Suggest five cast entries for this story — a mix of characters, locations, items and factions{% if guidance != blank %} — unless the guidance below directs otherwise{% endif %}.
{% if definition.setting != blank %}Setting: {{ definition.setting }}
{% endif %}{% if definition.genre.promptBody != blank %}Genre: {{ definition.genre.promptBody }}
{% endif %}{% if definition.tone.promptBody != blank %}Tone: {{ definition.tone.promptBody }}
{% endif %}{% if lore.size > 0 %}World reference:
{% for row in lore %}- {{ row.title }}: {{ row.body }}
{% endfor %}{% endif %}{% if cast.size > 0 or suggested.size > 0 %}Already in the cast (do not repeat these):
{% for row in cast %}- {{ row.name }} ({{ row.kind }})
{% endfor %}{% for name in suggested %}- {{ name }}
{% endfor %}{% endif %}A character's faction_name and a location's parent_location_name may reference a faction or location from this batch{% if cast.size > 0 %} or from the existing cast{% endif %}, by exact name.
{% if guidance != blank %}Additional guidance: {{ guidance }}
{% endif %}`

export const MACRO_WIZARD_GENRE_CONTEXT = `Return a short label naming the genre, and a promptBody of two or three paragraphs instructing a model how to write in this genre — its conventions, register, and what belongs on the page — written the way a genre preset's body reads, not an encyclopedia entry describing the genre.
{% if definition.setting != blank %}Setting: {{ definition.setting }}
{% endif %}{% if definition.tone.promptBody != blank %}Tone: {{ definition.tone.promptBody }}
{% endif %}`

export const WIZARD_GENRE = `Suggest a genre for this story. {% include 'macro_wizard_genre_context' %}{% if guidance != blank %}Additional guidance: {{ guidance }}
{% endif %}`

export const WIZARD_GENRE_REFINE = `Revise the genre below rather than writing a new one.

Current label: {{ current.label }}
Current body:
{{ current.promptBody }}

Revision instruction: {{ instruction }}

{% include 'macro_wizard_genre_context' %}`

export const MACRO_WIZARD_TONE_CONTEXT = `Return a short label naming the tone, and a promptBody of two or three paragraphs instructing a model how to write in this tone — its register, pacing, and what to emphasize or avoid — written the way a tone preset's body reads, not an explanation of the tone.
{% if definition.setting != blank %}Setting: {{ definition.setting }}
{% endif %}{% if definition.genre.promptBody != blank %}Genre: {{ definition.genre.promptBody }}
{% endif %}`

export const WIZARD_TONE = `Suggest a tone for this story. {% include 'macro_wizard_tone_context' %}{% if guidance != blank %}Additional guidance: {{ guidance }}
{% endif %}`

export const WIZARD_TONE_REFINE = `Revise the tone below rather than writing a new one.

Current label: {{ current.label }}
Current body:
{{ current.promptBody }}

Revision instruction: {{ instruction }}

{% include 'macro_wizard_tone_context' %}`

export const MACRO_WIZARD_SETTING_CONTEXT = `A setting is one or two paragraphs of freeform prose describing the world — where and when it takes place, and its defining conditions.
{% if definition.genre.promptBody != blank %}Genre: {{ definition.genre.promptBody }}
{% endif %}{% if definition.tone.promptBody != blank %}Tone: {{ definition.tone.promptBody }}
{% endif %}`

export const WIZARD_SETTING = `Suggest a setting for this story. {% include 'macro_wizard_setting_context' %}{% if guidance != blank %}Additional guidance: {{ guidance }}
{% endif %}`

export const WIZARD_SETTING_REFINE = `Revise the setting below rather than writing a new one.

Current setting:
{{ current.setting }}

Revision instruction: {{ instruction }}

{% include 'macro_wizard_setting_context' %}`

export const WIZARD_TITLE_CHIPS = `Suggest five short, evocative titles for this story.
Opening:
{{ opening.content }}
{% if guidance != blank %}Additional guidance: {{ guidance }}
{% endif %}`

export const MACRO_WIZARD_DESCRIPTION_CONTEXT = `A description is a one-sentence log line: do not write narrative prose, write a concise synopsis of the opening below.
Opening:
{{ opening.content }}
`

export const WIZARD_DESCRIPTION = `Write a description for this story. {% include 'macro_wizard_description_context' %}{% if guidance != blank %}Additional guidance: {{ guidance }}
{% endif %}`

export const WIZARD_DESCRIPTION_REFINE = `Revise the description below rather than writing a new one.

Current description:
{{ current.description }}

Revision instruction: {{ instruction }}

{% include 'macro_wizard_description_context' %}`
