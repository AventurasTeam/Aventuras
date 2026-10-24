export const STATE_EMISSION = `After your narrative prose, append exactly one <state> block (never inside the prose itself). Entities above are listed with an ID in brackets, e.g. "[c1] Kael" — reference that ID below WITHOUT the brackets:

<state>
  <scene_entities>comma-separated IDs of every character/item present in this scene</scene_entities>
  <new_location handle="new:a-short-label" parent="the ID or handle of the place it is part of, or top" name="the place's name" condition="its condition, only when the prose shows one">a short description of the place</new_location>
  <current_location>{% if placesListed %}the ID from Places, or {% endif %}the handle of a new_location above</current_location>
  <world_time_delta>{% if worldTimeDeltaBasis == 'sinceUserAction' %}seconds elapsed since the end of the user's action{% else %}seconds elapsed since the previous entry, including any time the user's action itself took{% endif %} (0 for a flashback or memory; never negative)</world_time_delta>
  <visual_changes>
    <entity id="ID" type="physique | face | hair | eyes | attire | distinguishing">the category as it is now, restated from its current value shown above: keep what still applies, drop what no longer does, in about 60 words — it replaces the stored value whole</entity>
  </visual_changes>
  <conditions>
    <entity id="ID">the place or item as it is now: keep what still applies, drop what no longer does, in a few words, never more than about 60 — it replaces the stored condition whole</entity>
  </conditions>
  <new_item handle="new:a-short-label" name="the item's name" condition="its condition, only when the prose shows one">a short description of the item</new_item>
  <transfers>
    <item id="item ID, or the handle of a new_item above" to="ID" from="ID" slot="equipped_items | inventory" />
    <drop id="item ID" from="ID" />
    <stackable key="the key exactly as the holder's Stackables line shows it, or a new lowercase name, e.g. gold, only for something they don't hold yet" amount="quantity moved, never more than the payer holds" to="ID" from="ID" />
  </transfers>
  <summary>one sentence summarizing what happened in this reply — identify the people, places and things that mattered by name, not ID</summary>
  <retrieval_queries>
    <query>up to three short phrases naming context you want retrieved for the NEXT turn — what you would want looked up, not a recap of this one; identify the people, places and things by name, not ID</query>
  </retrieval_queries>
</state>

Give each new place or item its own <new_location> or <new_item> tag with a handle that starts with new: (e.g. new:docks), and use a new place's handle like an ID only as the <current_location> or another new place's parent, and a new item's handle only as a transfer's item id or, when it is in the scene, in <scene_entities>. Write a double quote, < or > inside a create's name or condition as &quot;, &lt; or &gt;, and a < inside its description as &lt;.

Create a place only when the scene settles somewhere with its own identity the story could come back to: a named place, a building, a room that matters, a stretch of wild land where things happen. Don't create one for passing through (a corridor, a doorway, the road between two places); keep the current location then.{% if placesListed %} Use an existing place's ID whenever the scene is somewhere already in Places, and nest a new place under the place it's part of.{% endif %}

Set a new place's parent to top only when nothing in Places could contain it, as for the story's first place or a city when Places holds only cities. Leave its parent out when something in Places could contain it and the prose doesn't say which; when unsure, leave it out.

Create an item only when a character takes, receives or is given something that matters beyond this moment: a weapon, a key, a letter, a relic. Not food eaten on the spot, not money (use a stackable), not scenery.

Give an existing place or item a condition only when the prose changes it, and only one shown above with its state: the current location, an item held in the scene or lying there, a place or item listed elsewhere in the world. Write it as it is now, the running consequence rather than the event (burned to the ground, not the fire), in a few words, never more than about 60; it replaces the stored condition whole, so never restate one unchanged. A place or item you create takes its condition where you create it.

Put an item down only when someone holding it sets it down where the scene is and it is still lying there when the turn ends, so an item picked up again isn't put down; an item put down anywhere else, thrown into a river or left in another place, stays prose.

Omit any inner tag you have nothing to report for. Apart from those handles, use only the IDs shown to you above, without brackets — never invent one. \`to\` or \`from\` may be omitted on a transfer when there's no specific known other party (e.g. found loose, spent on someone off-scene).`
