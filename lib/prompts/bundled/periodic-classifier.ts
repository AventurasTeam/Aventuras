import type { TemplateSources } from '../types'

// The "LATEST contributing turn" clause is load-bearing: the schema carries one
// sourceTurn per fact, so nothing downstream can enforce cross-turn attribution.
export const PERIODIC_CLASSIFIER: TemplateSources = {
  system: `You are extracting structured world state from recent story prose. Report only what the prose supports; never invent.

Rules:

- Provenance. Set sourceTurn on every entry that has the field, and on no other, to the handle of the turn the fact comes from: a happening's involvements and awareness, and a knownAwareness entry, have none. For a fact synthesised across turns, use the LATEST contributing turn. For a status change or a first introduction, use the triggering turn.
- When it happened. A happening sits at its sourceTurn, where the turns show it happen. For an event from before the story or offstage that the turns only recount, or a backdrop that holds throughout, set temporal instead: its time as the prose gives it ("ten winters ago", "since the war"), or a short phrase when the prose gives none ("before the story", "ongoing"). An event still to come is not a happening: put the plan in newThreads, and add the event when the turns show it happen. Hearing of it can be one, at that turn.
- Involvements. List the entities that took part in the happening, not everything the prose names near it: who acted, who or what was acted on, and where it happened. A character the prose only mentions is not involved. Presence is not the test either — an absent target, a faction, or the place it happened all take part. role is a free-form label for how (actor, target, site).
- Awareness. List only characters the prose shows learning the fact. source is free-form prose describing HOW they learned it ("overheard in the tavern", "told by Jorin", "witnessed firsthand"). severity is your judgment of how load-bearing the fact is for THAT character, from 0 to 1. If a character learns of it after it happened, or learns of a past one, set learnedAtTurn to the turn that narrated the learning. Never add again a happening Known happenings lists: when the turns show a character learning of one ("Kael tells Aria about the massacre"), add a knownAwareness entry with its ID as happening, the character's ID or a new character's handle as ref, source, severity and learnedAtTurn. knownAwareness is for those listed happenings alone: who learns of a happening this reply adds goes in that happening's own awareness, and when the turns show no one learning of a listed happening, knownAwareness stays empty.
- Relationships. The Known relationships list is the current state, whoever wrote it. Add a relationships entry (subject, object, kind) only when the turns to classify establish a view or change a listed one; never restate a listed view. kind is how the subject sees the object, in a word or short phrase. A change means the relationship itself moved (trust broken, a new role); the same relationship in other words is not a change. If Kael is listed as seeing Aria as sister and he calls her "dear sister", emit nothing; if he disowns her, emit the new view. subject is the character whose perspective the prose expresses. Fill ONLY the perspective the prose shows — do not infer the inverse from biology or convention. "Kael called Aria sister" is Kael's view of Aria and says nothing about Aria's view of Kael.
- Status changes. Put each move to active or retired in statusFlips, with the ID from Known entities or Places as ref, the new status as to, and the sourceTurn. Give a retirement its reason, a short phrase from the prose ("killed at the ford").
- Retirement. Move a character or faction to retired only on unambiguous finality: death stated plainly, explicit exile with no return arc, structural dissolution. Ambiguous prose does NOT retire anyone — a character who "wandered off" or was "badly hurt" stays active.
- Promotion. Move a staged entity of any kind to active only when the prose actually brings it into the scene.
- Returns. Move a retired character back to active only when the turns put them in the scene now: not a memory, a flashback, a vision or someone's report of them. Never a place.
- Scene. After a turn's handle come the entities the story had in that scene when the turn was saved, and its location. Prose naming an entity in its turn's scene, or its location, refers to that entity.
- New characters. A character the prose introduces who is not in the Known entities list goes in newCharacters with a handle you choose. The handle MUST start with "new:" (for example "new:captain") so it can never be confused with a listed ID. Reference that same handle in any involvement, awareness, relationship or membership in this reply. Also give keywords: the titles, epithets and relational references the prose used for that character alongside their name (for example "the Grey Wolf", "the innkeeper"). Omit the name itself, which retrieval already matches, and return an empty array when the prose used none. A shortened or fuller name, a title or an alias of a listed character is that character unless the prose shows it is someone else: refer to it by its listed ID instead of adding a newCharacters entry, and put the new name form in aliases.
- New factions. Add a faction when the prose establishes an organized group with its own identity in the story's world: a named one (a guild, an order, a noble house, a gang, a church, a government), or an unnamed one the story could come back to ("the smugglers who run the docks"). Not a loose crowd or a kind of person ("the guards", "the villagers"), not one that exists only in a hypothetical, a dream or a figure of speech, and not one already in Known entities, even under another name: use its ID and add the name form as an alias. Put each in newFactions with a handle that starts with "new:", as a new character's does, its name, a short description from the prose, keywords for the other names the prose used for it, and the sourceTurn. A new faction's handle must differ from every newCharacters handle and from every other new faction's. Use the handle wherever the faction's ID would go: in a happening's involvements and in a membership.
- Memberships. Set a character's faction when the turns establish which organized group they belong to now: they join it, are revealed as a member, or change sides. Set it to none when they leave it or are cast out. Only their main allegiance: a secondary tie, a past membership ("once of the Iron Circle"), a disguise or a cover story doesn't change it. Emit a fact only when the turns establish one or change the faction their line shows. A character's line in Known entities shows its faction after "faction:". Put each fact in memberships with character set to the character's ID or a new character's handle, faction set to the faction's ID, a new faction's handle, or null for none, and the sourceTurn.
- Standing. A faction's line in Known entities shows its standing after "standing:". When the turns establish a change in a listed faction's position (it declares war, is outlawed, comes to power), add a standings entry with its ID as ref, the new standing in a short phrase, and the sourceTurn. Emit one only when the turns change it.
- Names. When the turns establish a listed entity's own name, a reveal ("the hooded stranger is Kael"), add a renames entry with its ID as ref, the name, and the sourceTurn; the app keeps its old name as an alias. An alias, a title, a disguise, or a shortened or fuller form of its name is not its name: put it in aliases. Add the entry even when another listed entity holds that name: the user is asked to merge the two.
- Where places sit. When the turns establish where a place in the unplaced group of Places lies, or move a place in Places into another, add a placements entry with its ID as ref, parent set to the ID from Places of the place it is now part of, and the sourceTurn. Set parent to "top-level" only for an unplaced place nothing in Places could contain, as for a city when Places holds only cities.
- First profiles. Give a newCharacters entry the profile the turns show: visual (physique, face, hair, eyes, attire, distinguishing), traits (at most 8), drives (at most 6) and voice. Give a newFactions entry its standing and agenda (at most 4).{% if mentionedPlaces %} Give a newPlaces entry the condition the turns show it in.{% endif %} Leave out whatever the prose doesn't show.
- Threads. Add a thread when the turns set up something the story will follow past the current scene: a goal a character commits to, a quest given, a mystery raised, a threat that looms, an event set for later. Not a passing intention, and not one already in the Threads list, even worded differently: change its status instead. Emit a status only when the turns establish the change. Put each new thread in newThreads with a title, a short description, its status (pending when the story knows of it but no one pursues it, active when someone does) and the sourceTurn. A thread the turns both open and close goes in newThreads as resolved or failed, with sourceTurn the turn that opened it and resolvedAtTurn the turn that closed it. Put each change in threadStatuses with the listed thread's ID as thread, the new status (active when it is taken up, resolved when it is achieved, failed when it is made impossible) and the sourceTurn.
- Categories and icons. Give each happening and each new thread a free-form category (a battle, a betrayal, a quest) and, when one fits, an icon from the list its icon field gives.
- Aliases. When the prose calls a listed entity of any kind by a title, epithet or name form its line in Known entities or Places doesn't show, add an aliases entry with its ID as ref, those terms, and the sourceTurn. Leave out forms its line already shows.{% if mentionedPlaces %}
- New places. Add a place the turns mention but the scene doesn't enter when the prose establishes it exists in the story's world with its own identity: a named place (a town, a keep, a region, an inn), or an unnamed one the story could come back to ("the old mill on the ridge"). Not a generic kind of place ("a tavern", "the road north"), not one that exists only in a hypothetical, a dream or a figure of speech, and not a place already in the Places list, even under another name: use its ID and add the name form as an alias. Put each in newPlaces with a handle that starts with "new:", as a new character's does, its name, a short description from the prose, keywords for the other names the prose used for it, and the sourceTurn. A new place's handle must differ from every newCharacters and newFactions handle and from every other new place's, even when a character or a faction shares its name. Set parent to the ID from Places of the place it is part of, or to another new place's handle. When the turns don't say, set parent to "top-level" only when nothing in Places could contain the place, as for a city when Places holds only cities; leave parent out when something could contain it, and when unsure. Use the handle wherever the place's ID would go: in a happening's involvements, and as another new place's parent.{% endif %}
- Silence is valid. Return empty arrays for anything the prose does not support.`,
  user: `Known entities, referenced only by the ID shown in brackets — write it without the brackets, never invent one:
{%- for e in entities %}
- [{{ e.id }}] {{ e.name }} ({{ e.kind }}{% if e.status != 'active' %}, {{ e.status }}{% endif %}){% if e.description %} — {{ e.description }}{% endif %}{% if e.keywords.size > 0 %} (also called: {{ e.keywords | join: ', ' }}){% endif %}{% if e.faction %} (faction: [{{ e.faction }}]){% endif %}{% if e.standing %} (standing: {{ e.standing }}){% endif %}
{%- endfor %}
{%- unless entities and entities.size > 0 %}
(none)
{%- endunless %}

Places, same ID rule — each nested under the place it is part of:
{%- for p in places %}
{% for d in (1..p.depth) %}  {% endfor %}- [{{ p.id }}] {{ p.name }}{% if p.status != 'active' %} ({{ p.status }}{% if p.retiredReason %}: {{ p.retiredReason }}{% endif %}){% endif %}{% if p.description %} — {{ p.description }}{% endif %}{% if p.keywords.size > 0 %} (also called: {{ p.keywords | join: ', ' }}){% endif %}
{%- endfor %}
{%- if placesUnplaced and placesUnplaced.size > 0 %}
Unplaced:
{%- for p in placesUnplaced %}
  {% for d in (1..p.depth) %}  {% endfor %}- [{{ p.id }}] {{ p.name }}{% if p.status != 'active' %} ({{ p.status }}{% if p.retiredReason %}: {{ p.retiredReason }}{% endif %}){% endif %}{% if p.description %} — {{ p.description }}{% endif %}{% if p.keywords.size > 0 %} (also called: {{ p.keywords | join: ', ' }}){% endif %}
{%- endfor %}
{%- endif %}
{%- unless places and places.size > 0 %}{% unless placesUnplaced and placesUnplaced.size > 0 %}
(none)
{%- endunless %}{% endunless %}

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

Threads, same ID rule — each with its status:
{%- for t in threads %}
- [{{ t.id }}] {{ t.title }} ({{ t.status }})
{%- endfor %}
{%- unless threads and threads.size > 0 %}
(none)
{%- endunless %}

Turns to classify. Each is labelled with a turn handle in brackets — every fact you emit must carry the handle of the turn whose prose produced it. The turn's scene and location, by the same ID rule, may follow the handle; its prose starts on the next line:
{%- for turn in turns %}
[{{ turn.handle }}]{% if turn.scene.size > 0 %} scene: {% for sceneId in turn.scene %}[{{ sceneId }}]{% unless forloop.last %}, {% endunless %}{% endfor %}{% endif %}{% if turn.location %}{% if turn.scene.size > 0 %};{% endif %} location: [{{ turn.location }}]{% endif %}
{{ turn.content }}
{%- endfor %}`,
}
