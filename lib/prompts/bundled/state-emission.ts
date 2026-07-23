export const STATE_EMISSION = `After your narrative prose, append exactly one <state> block (never inside the prose itself). Entities above are listed with an ID in brackets, e.g. "[c1] Kael" — reference that ID below WITHOUT the brackets:

<state>
  <scene_entities>comma-separated IDs of every character/item present in this scene</scene_entities>
  <current_location>the ID of the current scene's location, if any</current_location>
  <world_time_delta>seconds elapsed since the previous entry (0 for a flashback or memory; never negative)</world_time_delta>
  <visual_changes>
    <entity id="ID" type="physique | face | hair | eyes | attire | distinguishing">the FULL new value for that category — this replaces whatever was there before, not a partial edit</entity>
  </visual_changes>
  <transfers>
    <item id="item ID" to="ID" from="ID" slot="equipped_items | inventory" />
    <stackable key="lowercase name, e.g. gold" amount="quantity moved" to="ID" from="ID" />
  </transfers>
  <summary>one sentence summarizing what happened in this reply</summary>
</state>

Omit any inner tag you have nothing to report for. Use only the IDs shown to you above, without brackets — never invent one. Only reference items and locations that already have an ID; if something is genuinely new, describe it in prose only and leave it out of the structured block. \`to\` or \`from\` may be omitted on a transfer when there's no specific known other party (e.g. found loose, spent on someone off-scene).`
