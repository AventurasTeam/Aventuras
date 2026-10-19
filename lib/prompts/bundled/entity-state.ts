// architecture.md → Entity state on the template surface. lib/retrieval/rendered-text.ts mirrors
// this exactly: the ranker measures a memory-blocks row from that mirror, and
// memory-blocks.test.ts fails when the two drift.
export const ENTITY_STATE = `{%- comment -%}
An entity's state lines from its view, each opening on its own newline, so a caller prints its
head line and includes this right after it. Every include passes all three arguments: e, the
entity; here, true where it is in scene or the current location, which leaves out Location,
Part of and Held by; ids, true where a held item's id is bracketed. A field with nothing prints
nothing, label included; a value's line breaks fold into spaces, so it keeps to its labelled
line; and a retired reference is marked so. Names assigned here carry an es_ prefix: an include
shares its caller's scope.
{%- endcomment -%}
{%- capture es_nl %}
{% endcapture -%}
{%- assign es_state = e.state -%}
{%- if e.kind == 'character' -%}
{%- unless here %}{% if es_state.location %}{{ es_nl }}Location: {{ es_state.location.name }}{% if es_state.location.status == 'retired' %} (retired){% endif %}{% endif %}{% endunless -%}
{%- if es_state.visual.physique != blank %}{{ es_nl }}Physique: {{ es_state.visual.physique | one_line }}{% endif -%}
{%- if es_state.visual.face != blank %}{{ es_nl }}Face: {{ es_state.visual.face | one_line }}{% endif -%}
{%- if es_state.visual.hair != blank %}{{ es_nl }}Hair: {{ es_state.visual.hair | one_line }}{% endif -%}
{%- if es_state.visual.eyes != blank %}{{ es_nl }}Eyes: {{ es_state.visual.eyes | one_line }}{% endif -%}
{%- if es_state.visual.attire != blank %}{{ es_nl }}Attire: {{ es_state.visual.attire | one_line }}{% endif -%}
{%- if es_state.visual.distinguishing != blank %}{{ es_nl }}Distinguishing: {{ es_state.visual.distinguishing | one_line }}{% endif -%}
{%- if es_state.voice != blank %}{{ es_nl }}Voice: {{ es_state.voice | one_line }}{% endif -%}
{%- if es_state.traits.size > 0 %}{{ es_nl }}Traits: {% for t in es_state.traits %}{{ t | one_line }}{% unless forloop.last %}; {% endunless %}{% endfor %}{% endif -%}
{%- if es_state.drives.size > 0 %}{{ es_nl }}Drives: {% for d in es_state.drives %}{{ d | one_line }}{% unless forloop.last %}; {% endunless %}{% endfor %}{% endif -%}
{%- if es_state.faction %}{{ es_nl }}Faction: {{ es_state.faction.name }}{% if es_state.faction.status == 'retired' %} (retired){% endif %}{% endif -%}
{%- if es_state.holdings.size > 0 %}{{ es_nl }}Holds:{% for h in es_state.holdings %}{% include 'macro_item_line', item: h, condition: h.condition, ids: ids %}{% endfor %}{% endif -%}
{%- if es_state.stackables.size > 0 %}{{ es_nl }}Stackables: {% for s in es_state.stackables %}{{ s.key | one_line }} {{ s.amount }}{% unless forloop.last %}, {% endunless %}{% endfor %}{% endif -%}
{%- elsif e.kind == 'location' -%}
{%- if es_state.condition != blank %}{{ es_nl }}Condition: {{ es_state.condition | one_line }}{% endif -%}
{%- unless here %}{% if es_state.parent %}{{ es_nl }}Part of: {{ es_state.parent.name }}{% if es_state.parent.status == 'retired' %} (retired){% endif %}{% endif %}{% endunless -%}
{%- elsif e.kind == 'item' -%}
{%- if es_state.condition != blank %}{{ es_nl }}Condition: {{ es_state.condition | one_line }}{% endif -%}
{%- unless here %}{% if es_state.location %}{{ es_nl }}Location: {{ es_state.location.name }}{% if es_state.location.status == 'retired' %} (retired){% endif %}{% endif %}{% if es_state.holder %}{{ es_nl }}Held by: {{ es_state.holder.name }}{% if es_state.holder.status == 'retired' %} (retired){% endif %}{% endif %}{% endunless -%}
{%- elsif e.kind == 'faction' -%}
{%- if es_state.standing != blank %}{{ es_nl }}Standing: {{ es_state.standing | one_line }}{% endif -%}
{%- if es_state.agenda.size > 0 %}{{ es_nl }}Agenda: {% for a in es_state.agenda %}{{ a | one_line }}{% unless forloop.last %}; {% endunless %}{% endfor %}{% endif -%}
{%- assign es_members = es_state.members | where_exp: 'm', "m.status != 'retired'" -%}
{%- if es_members.size > 0 %}{{ es_nl }}Members: {{ es_members | map: 'name' | join: ', ' }}{% endif -%}
{%- endif -%}`

// lib/retrieval/rendered-text.ts → itemLine mirrors this, under the same pin test.
export const ITEM_LINE = `{%- comment -%}
One Holds or Here line, opening on its own newline: piggyback.md → What the writer sees. Every
include passes all three arguments: item, with its id, name, description and, held, equipped;
condition; ids, true where the id is bracketed. Description and condition are folded onto the
line, and a condition after a description already ending a sentence takes no second stop.
Names assigned here carry an il_ prefix.
{%- endcomment -%}
{%- capture il_nl %}
{% endcapture -%}
{%- assign il_d = item.description | one_line -%}
{%- assign il_c = condition | one_line -%}
{{ il_nl }}- {% if ids %}[{{ item.id }}] {% endif %}{{ item.name }}{% if item.equipped %} (equipped){% endif %}{% if il_d != blank %}: {{ il_d }}{% endif %}{% if il_c != blank %}{% assign il_last = il_d | slice: -1 %}{% if il_last == '.' or il_last == '!' or il_last == '?' %} {% else %}. {% endif %}Condition: {{ il_c }}{% endif -%}`
