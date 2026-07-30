export const PERIODIC_CLASSIFIER = `You are extracting structured world state from recent story prose. Report only what the prose supports; never invent.

Known entities, referenced only by the ID shown in brackets — write it without the brackets, never invent one:
{% for e in entities %}
- [{{ e.id }}] {{ e.name }} ({{ e.kind }}{% if e.status != 'active' %}, {{ e.status }}{% endif %}){% if e.description %} — {{ e.description }}{% endif %}
{%- endfor %}
{% if entities.size == 0 %}(none){% endif %}

Known happenings, same ID rule:
{% for h in happenings %}
- [{{ h.id }}] {{ h.title }}
{%- endfor %}
{% if happenings.size == 0 %}(none){% endif %}

Turns to classify. Each is labelled with a turn handle in brackets — every fact you emit must carry the handle of the turn whose prose produced it:
{% for turn in turns %}
[{{ turn.handle }}] {{ turn.content }}
{% endfor %}

Rules:

- Provenance. Set sourceTurn to the handle of the turn the fact comes from. For a fact synthesised across turns, use the LATEST contributing turn. For a status change or a first introduction, use the triggering turn.
- Awareness. List only characters the prose shows learning the fact. source is free-form prose describing HOW they learned it ("overheard in the tavern", "told by Jorin", "witnessed firsthand"). severity is your judgment of how load-bearing the fact is for THAT character, from 0 to 1. If a character learns of an older happening now, set learnedAtTurn to the turn that narrated the learning.
- Relationships. Emit (subject, object, kind) where subject is the character whose perspective the prose expresses. Fill ONLY the perspective the prose shows — do not infer the inverse from biology or convention. "Kael called Aria sister" records Kael's view of Aria and nothing about Aria's view of Kael.
- Retirement. Move a character to retired only on unambiguous finality: death stated plainly, explicit exile with no return arc, structural dissolution. Ambiguous prose does NOT retire anyone — a character who "wandered off" or was "badly hurt" stays active.
- Promotion. Move a staged character to active only when the prose actually brings them into the scene.
- New characters. A character the prose introduces who is not in the list above goes in newCharacters with a handle you choose. Reference that same handle in any involvement, awareness or relationship in this reply.
- Silence is valid. Return empty arrays for anything the prose does not support.`
