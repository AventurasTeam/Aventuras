import type { TemplateSources } from '../types'

// The "LATEST contributing turn" clause is load-bearing: the schema carries one
// sourceTurn per fact, so nothing downstream can enforce cross-turn attribution.
export const PERIODIC_CLASSIFIER: TemplateSources = {
  system: `You are extracting structured world state from recent story prose. Report only what the prose supports; never invent.

Rules:

- Provenance. Set sourceTurn to the handle of the turn the fact comes from. For a fact synthesised across turns, use the LATEST contributing turn. For a status change or a first introduction, use the triggering turn.
- Involvements. List the entities that took part in the happening, not everything the prose names near it: who acted, who or what was acted on, and where it happened. A character the prose only mentions is not involved. Presence is not the test either — an absent target, a faction, or the place it happened all take part. role is a free-form label for how (actor, target, site).
- Awareness. List only characters the prose shows learning the fact. source is free-form prose describing HOW they learned it ("overheard in the tavern", "told by Jorin", "witnessed firsthand"). severity is your judgment of how load-bearing the fact is for THAT character, from 0 to 1. If a character learns of an older happening now, set learnedAtTurn to the turn that narrated the learning.
- Relationships. The Known relationships list is the current state, whoever wrote it. Emit (subject, object, kind) only when the turns to classify establish a view or change a listed one; never restate a listed view. A change means the relationship itself moved (trust broken, a new role); the same relationship in other words is not a change. If Kael is listed as seeing Aria as sister and he calls her "dear sister", emit nothing; if he disowns her, emit the new view. subject is the character whose perspective the prose expresses. Fill ONLY the perspective the prose shows — do not infer the inverse from biology or convention. "Kael called Aria sister" is Kael's view of Aria and says nothing about Aria's view of Kael.
- Retirement. Move a character or faction to retired only on unambiguous finality: death stated plainly, explicit exile with no return arc, structural dissolution. Ambiguous prose does NOT retire anyone — a character who "wandered off" or was "badly hurt" stays active.
- Promotion. Move a staged character to active only when the prose actually brings them into the scene.
- Scene. After a turn's handle come the entities the story had in that scene when the turn was saved, and its location. Prose naming an entity in its turn's scene, or its location, refers to that entity.
- New characters. A character the prose introduces who is not in the Known entities list goes in newCharacters with a handle you choose. The handle MUST start with "new:" (for example "new:captain") so it can never be confused with a listed ID. Reference that same handle in any involvement, awareness, relationship or membership in this reply. Also give keywords: the titles, epithets and relational references the prose used for that character alongside their name (for example "the Grey Wolf", "the innkeeper"). Omit the name itself, which retrieval already matches, and return an empty array when the prose used none. A shortened or fuller name, a title or an alias of a listed character is that character unless the prose shows it is someone else: refer to it by its listed ID instead of adding a newCharacters entry, and put the new name form in aliases.
- New factions. Add a faction when the prose establishes an organized group with its own identity in the story's world: a named one (a guild, an order, a noble house, a gang, a church, a government), or an unnamed one the story could come back to ("the smugglers who run the docks"). Not a loose crowd or a kind of person ("the guards", "the villagers"), not one that exists only in a hypothetical, a dream or a figure of speech, and not one already in Known entities, even under another name: use its ID and add the name form as an alias. Put each in newFactions with a handle that starts with "new:", as a new character's does, its name, a short description from the prose, keywords for the other names the prose used for it, and the sourceTurn. A new faction's handle must differ from every newCharacters handle and from every other new faction's. Use the handle wherever the faction's ID would go: in a happening's involvements and in a membership.
- Memberships. Set a character's faction when the turns establish which organized group they belong to now: they join it, are revealed as a member, or change sides. Set it to none when they leave it or are cast out. Only their main allegiance: a secondary tie, a past membership ("once of the Iron Circle"), a disguise or a cover story doesn't change it. Emit a fact only when the turns establish one or change the faction their line shows. A character's line in Known entities shows its faction after "faction:". Put each fact in memberships with character set to the character's ID or a new character's handle, faction set to the faction's ID, a new faction's handle, or null for none, and the sourceTurn.
- Aliases. When the prose calls a listed entity of any kind by a title, epithet or name form its line in Known entities or Places doesn't show, add an aliases entry with its ID as ref, those terms, and the sourceTurn. Leave out forms its line already shows.{% if mentionedPlaces %}
- New places. Add a place the turns mention but the scene doesn't enter when the prose establishes it exists in the story's world with its own identity: a named place (a town, a keep, a region, an inn), or an unnamed one the story could come back to ("the old mill on the ridge"). Not a generic kind of place ("a tavern", "the road north"), not one that exists only in a hypothetical, a dream or a figure of speech, and not a place already in the Places list, even under another name: use its ID and add the name form as an alias. Put each in newPlaces with a handle that starts with "new:", as a new character's does, its name, a short description from the prose, keywords for the other names the prose used for it, and the sourceTurn. A new place's handle must differ from every newCharacters and newFactions handle and from every other new place's, even when a character or a faction shares its name. Set parent to the ID from Places of the place it is part of, or to another new place's handle; leave parent out when the turns don't say. Use the handle wherever the place's ID would go: in a happening's involvements, and as another new place's parent.{% endif %}
- Silence is valid. Return empty arrays for anything the prose does not support.`,
  user: `Known entities, referenced only by the ID shown in brackets — write it without the brackets, never invent one:
{%- for e in entities %}
- [{{ e.id }}] {{ e.name }} ({{ e.kind }}{% if e.status != 'active' %}, {{ e.status }}{% endif %}){% if e.description %} — {{ e.description }}{% endif %}{% if e.keywords.size > 0 %} (also called: {{ e.keywords | join: ', ' }}){% endif %}{% if e.faction %} (faction: [{{ e.faction }}]){% endif %}
{%- endfor %}
{%- unless entities and entities.size > 0 %}
(none)
{%- endunless %}

Places, same ID rule — each nested under the place it is part of:
{%- for p in places %}
{% for d in (1..p.depth) %}  {% endfor %}- [{{ p.id }}] {{ p.name }}{% if p.status != 'active' %} ({{ p.status }}{% if p.retiredReason %}: {{ p.retiredReason }}{% endif %}){% endif %}{% if p.description %} — {{ p.description }}{% endif %}{% if p.keywords.size > 0 %} (also called: {{ p.keywords | join: ', ' }}){% endif %}
{%- endfor %}
{%- unless places and places.size > 0 %}
(none)
{%- endunless %}

Known relationships, same ID rule — how each character sees another:
{%- for r in relationships %}
- [{{ r.subject }}] {{ r.subjectName }} sees [{{ r.object }}] {{ r.objectName }} as: {{ r.kind }}
{%- endfor %}
{%- unless relationships and relationships.size > 0 %}
(none)
{%- endunless %}

Known happenings, same ID rule:
{%- for h in happenings %}
- [{{ h.id }}] {{ h.title }}
{%- endfor %}
{%- unless happenings and happenings.size > 0 %}
(none)
{%- endunless %}

Turns to classify. Each is labelled with a turn handle in brackets — every fact you emit must carry the handle of the turn whose prose produced it. The turn's scene and location, by the same ID rule, may follow the handle; its prose starts on the next line:
{%- for turn in turns %}
[{{ turn.handle }}]{% if turn.scene.size > 0 %} scene: {% for sceneId in turn.scene %}[{{ sceneId }}]{% unless forloop.last %}, {% endunless %}{% endfor %}{% endif %}{% if turn.location %}{% if turn.scene.size > 0 %};{% endif %} location: [{{ turn.location }}]{% endif %}
{{ turn.content }}
{%- endfor %}`,
}
