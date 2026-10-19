// architecture.md → Entity state on the template surface. lib/retrieval/rendered-text.ts mirrors
// this exactly: the ranker measures a memory-blocks row from that mirror, and
// memory-blocks.test.ts fails when the two drift.
export const ENTITY_STATE = `{%- comment -%}
An entity's state lines from its view, each opening on its own newline, so a caller prints its
head line and includes this right after it. Every include passes all three arguments: e, the
entity; here, true where it is in scene or the current location, which leaves out Location,
Part of and Held by; ids, true where a held item's id is bracketed. A field with nothing prints
nothing, label included, and a retired reference is marked so. Names assigned here carry an es_ prefix: an include shares its
caller's scope.
{%- endcomment -%}
{%- capture es_nl %}
{% endcapture -%}
{%- assign es = e.state -%}
{%- if e.kind == 'character' -%}
{%- unless here %}{% if es.location %}{{ es_nl }}Location: {{ es.location.name }}{% if es.location.status == 'retired' %} (retired){% endif %}{% endif %}{% endunless -%}
{%- if es.visual.physique != blank %}{{ es_nl }}Physique: {{ es.visual.physique }}{% endif -%}
{%- if es.visual.face != blank %}{{ es_nl }}Face: {{ es.visual.face }}{% endif -%}
{%- if es.visual.hair != blank %}{{ es_nl }}Hair: {{ es.visual.hair }}{% endif -%}
{%- if es.visual.eyes != blank %}{{ es_nl }}Eyes: {{ es.visual.eyes }}{% endif -%}
{%- if es.visual.attire != blank %}{{ es_nl }}Attire: {{ es.visual.attire }}{% endif -%}
{%- if es.visual.distinguishing != blank %}{{ es_nl }}Distinguishing: {{ es.visual.distinguishing }}{% endif -%}
{%- if es.voice != blank %}{{ es_nl }}Voice: {{ es.voice }}{% endif -%}
{%- if es.traits.size > 0 %}{{ es_nl }}Traits: {{ es.traits | join: '; ' }}{% endif -%}
{%- if es.drives.size > 0 %}{{ es_nl }}Drives: {{ es.drives | join: '; ' }}{% endif -%}
{%- if es.faction %}{{ es_nl }}Faction: {{ es.faction.name }}{% if es.faction.status == 'retired' %} (retired){% endif %}{% endif -%}
{%- if es.holdings.size > 0 %}{{ es_nl }}Holds:{% for h in es.holdings %}{% include 'macro_item_line', item: h, condition: h.condition, ids: ids %}{% endfor %}{% endif -%}
{%- if es.stackables.size > 0 %}{{ es_nl }}Stackables: {% for s in es.stackables %}{{ s.key }} {{ s.amount }}{% unless forloop.last %}, {% endunless %}{% endfor %}{% endif -%}
{%- elsif e.kind == 'location' -%}
{%- if es.condition != blank %}{{ es_nl }}Condition: {{ es.condition }}{% endif -%}
{%- unless here %}{% if es.parent %}{{ es_nl }}Part of: {{ es.parent.name }}{% if es.parent.status == 'retired' %} (retired){% endif %}{% endif %}{% endunless -%}
{%- elsif e.kind == 'item' -%}
{%- if es.condition != blank %}{{ es_nl }}Condition: {{ es.condition }}{% endif -%}
{%- unless here %}{% if es.location %}{{ es_nl }}Location: {{ es.location.name }}{% if es.location.status == 'retired' %} (retired){% endif %}{% endif %}{% if es.holder %}{{ es_nl }}Held by: {{ es.holder.name }}{% if es.holder.status == 'retired' %} (retired){% endif %}{% endif %}{% endunless -%}
{%- elsif e.kind == 'faction' -%}
{%- if es.standing != blank %}{{ es_nl }}Standing: {{ es.standing }}{% endif -%}
{%- if es.agenda.size > 0 %}{{ es_nl }}Agenda: {{ es.agenda | join: '; ' }}{% endif -%}
{%- assign es_members = es.members | where_exp: 'm', "m.status != 'retired'" -%}
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
