// wizard.md → Step 3 (Genre / Tone). Copied by value into
// definition.genre / definition.tone at pick time — fire-and-forget, no preset
// id is stored on the story, so edits here never reach existing stories.
export type WizardPreset = {
  /** Stable kebab-case handle. Local to this catalog; never persisted. */
  id: string
  /** Copied into `label`. */
  displayName: string
  /** One line, shown on the picker row. Not copied into the story. */
  tagline: string
  /** Copied into `promptBody` — substantial prose injected into generation context. */
  promptBody: string
}

export const GENRE_PRESETS: readonly WizardPreset[] = [
  {
    id: 'hard-sci-fi',
    displayName: 'Hard sci-fi',
    tagline: 'Rigorous futures where physics does not bend for the plot.',
    promptBody: `This is hard science fiction. Technology is extrapolated from real physics, and its limits matter more than its capabilities: delta-v is budgeted, signals travel at light speed, heat has to go somewhere, and biology does not get waived for convenience. When a character solves a problem, the solution comes from understanding a constraint rather than from an unexplained device.

Prefer concrete engineering detail over gee-whiz spectacle. Name the systems, the tolerances, the failure modes. Characters who work with the technology know it the way practitioners do: they use its jargon without stopping to explain it, and they respect what it can do to them.

Avoid faster-than-light travel, artificial gravity without a stated mechanism, and any technology whose only justification is that the story needs it. If something exceptional is true of this world, establish its rules early and hold to them.`,
  },
  {
    id: 'space-opera',
    displayName: 'Space opera',
    tagline: 'Empires, fleets, and destinies argued across the stars.',
    promptBody: `This is space opera. The canvas is vast — star systems, factions, dynasties, and ancient conflicts — and the plot moves at the scale of empires as readily as it moves at the scale of a single crew. Technology (faster-than-light travel, energy weapons, alien polities) is treated as a given, not a puzzle; spend narrative attention on what these forces mean for power and loyalty, not on how they work.

Let allegiance and lineage carry weight. Characters answer to houses, fleets, orders, or causes bigger than themselves, and their choices ripple outward into politics and war. Scenes can jump between an intimate cabin conversation and a battle involving thousands of ships without feeling like a change of genre.

Keep the moral lines legible even when the politics are tangled — a reader should be able to tell who a character is loyal to and what that loyalty costs them. Grandeur is a feature: throne rooms, boarding actions, and declarations made in front of crowds all belong here.`,
  },
  {
    id: 'cozy-fantasy',
    displayName: 'Cozy fantasy',
    tagline: 'Small stakes, warm rooms, magic that helps more than it hurts.',
    promptBody: `This is cozy fantasy. Magic is real, ordinary, and largely benign — it makes bread rise, keeps a shop's kettle warm, and settles quarrels between neighbours more often than it levels towers. The world has trouble in it, but the trouble is human-scaled: a failing business, a strained friendship, a season that will not turn.

Keep the camera close and the stakes personal. Scenes favour interiors, meals, crafts, and conversation. Let competence be quiet and kindness be the resolving force; a character who listens well should get further than one who draws a weapon.

Violence, if it appears at all, is brief, off-page, and never the point. Resolve conflicts through understanding, negotiation, or patient work rather than through defeat of an enemy. Threats that cannot be talked down are rare here, and the world does not reward escalation.`,
  },
  {
    id: 'epic-fantasy',
    displayName: 'Epic fantasy',
    tagline: 'Kingdoms, prophecy, and a world large enough to get lost in.',
    promptBody: `This is epic fantasy. The setting is a secondary world with its own geography, history, and factions, and the plot concerns something that threatens or reshapes that world — a war between kingdoms, a return of an old power, a throne worth dying for. Magic, where present, follows systems old enough that scholars argue about them and costly enough that using it means something.

Build outward from the immediate scene to the larger stakes: a skirmish implies an army, a betrayal implies a court, a ruin implies an empire that fell. Give factions their own reasoned self-interest rather than uncomplicated villainy — the reader should be able to see why the other side believes it is right.

Let the world carry texture — invented customs, oaths, titles, and geography referenced as lived-in fact rather than explained as exposition. The scale is long: this is a story that expects to unfold over a great many turns.`,
  },
  {
    id: 'noir',
    displayName: 'Noir',
    tagline: 'Rain-slicked streets, bad bargains, and nobody clean.',
    promptBody: `This is noir. The setting is urban, shadowed, and corrupt — the story lives in back rooms, all-night diners, and offices with the blinds drawn, where institutions (police, money, power) cannot be trusted to do what they claim to do. Every character is compromised by something: a debt, a secret, a favour owed to the wrong person.

Plots turn on investigation and consequence rather than spectacle — a lead followed, a lie caught, a door that should not have been unlocked. Let the protagonist's judgment be fallible; being right too easily undercuts the genre. Moral victories, when they come, are partial and cost something.

Keep the world's dangers grounded in human venality — greed, jealousy, ambition — rather than the fantastic or the futuristic. The city itself should feel like a character that is indifferent to whether anyone in it survives.`,
  },
  {
    id: 'cosmic-horror',
    displayName: 'Cosmic horror',
    tagline: 'Truths too large for the human mind to survive knowing.',
    promptBody: `This is cosmic horror. The universe is vast, ancient, and indifferent to human concerns, and the central horror is one of scale and incomprehension: forces, entities, or truths that predate humanity and do not notice it except by accident. Knowledge itself is dangerous — understanding too much of what is really out there costs sanity, safety, or both.

Favor dread built from implication over explicit threat. A character piecing together a pattern from fragments — journals, symbols, half-remembered dreams — is more central to this genre than a monster in plain view. When the incomprehensible does appear, its wrongness should resist being fully described.

Human institutions (science, religion, government) should be shown as inadequate to the scale of what is actually happening, however competently the characters within them behave. Victory, if any is possible, tends to mean survival or ignorance regained — not mastery over what was found.`,
  },
  {
    id: 'post-apocalyptic',
    displayName: 'Post-apocalyptic',
    tagline: 'What survives after everything familiar has ended.',
    promptBody: `This is post-apocalyptic fiction. Civilization as it was has already collapsed — by war, plague, climate, or something stranger — and the story lives in what people rebuild, scavenge, or fight over in what is left. Scarcity is structural: water, fuel, medicine, and safety are all finite and worth killing for, and the story should treat them that way.

Ground the world in the physical work of survival — travel, shelter, repair, ration — rather than treating the setting as empty scenery. Let the old world intrude as ruin and artifact: a working radio, an intact library, a road sign for a city that no longer exists, each carrying weight precisely because it is rare.

Communities matter as much as individuals — who trusts whom, who has power, what a group will do to protect its own. The tone can range from bleak to hopeful, but the practical constraints of survival should never be waived for plot convenience.`,
  },
  {
    id: 'urban-fantasy',
    displayName: 'Urban fantasy',
    tagline: 'The supernatural, hiding in plain sight on modern streets.',
    promptBody: `This is urban fantasy. The setting is a recognizably modern city, and magic, monsters, or hidden societies exist layered underneath or alongside ordinary life — usually concealed from the general public by some mix of secrecy, disbelief, or deliberate cover. The friction between the mundane world (jobs, traffic, phones) and the hidden one is a core source of story texture.

Treat the supernatural as having its own internal logic, factions, and politics — covens, packs, courts, agencies — that a character can learn to navigate the way one learns a city's neighbourhoods. Let ordinary settings (a subway platform, a diner, a rooftop) host extraordinary events.

Secrecy has stakes: exposure, for a character who knows about the hidden world, is usually dangerous rather than merely embarrassing. Balance genuinely strange elements against enough mundane detail that the city still feels real underneath the magic.`,
  },
  {
    id: 'historical-adventure',
    displayName: 'Historical adventure',
    tagline: 'Real eras, real stakes, and a protagonist in the thick of it.',
    promptBody: `This is historical adventure. The setting is a real historical period, rendered with enough specific, load-bearing detail — dress, trade, travel, the texture of daily life, the politics of the day — that the era feels lived-in rather than costumed. Events can be invented, but they should be plausible within what the period would actually allow.

Favor plots built from journeys, expeditions, intrigue, and physical risk — travel by ship or horse, a smuggled letter, a duel, a border crossed without papers. Let period-appropriate constraints (communication delay, social rank, the law of the place) genuinely limit what characters can do, rather than being window dressing around modern behavior.

Avoid anachronism in technology, attitude, and vocabulary unless the story has deliberately signalled that it plays loose with history. The past should feel foreign in its assumptions even when the protagonist's courage or wit feels timeless.`,
  },
  {
    id: 'mystery',
    displayName: 'Mystery',
    tagline: 'A puzzle with a hidden shape, solved clue by clue.',
    promptBody: `This is mystery fiction. At the center is a question that can genuinely be solved — who did it, how, or why — and the story's engine is the gathering and interpretation of evidence rather than open-ended adventure. Every scene should either supply a clue, a red herring, or a reason to suspect someone, even when it is also doing other work.

Play fair with the reader: information the detective uses to reach a conclusion should have been available on the page, even if its significance was not obvious at the time. Let suspects have real, defensible motives and alibis rather than existing only to be eliminated.

Pace revelation deliberately — a mystery loses tension if too much is explained too soon, and loses coherence if the solution depends on facts introduced only at the end. The satisfaction of the genre comes from a reader being able to look back and see the shape they missed.`,
  },
]

export const TONE_PRESETS: readonly WizardPreset[] = [
  {
    id: 'grim',
    displayName: 'Grim and unsparing',
    tagline: 'No easy outs, no soft landings.',
    promptBody: `Write in a grim, unsparing register. Consequences land and stay landed — injuries do not conveniently heal off-page, losses are not undone by the next scene, and characters do not get to have things both ways. Let the prose sit in discomfort rather than resolving it quickly.

Keep sentences plain and weighty rather than ornate; let hard facts do the emotional work instead of commentary on how a character feels about them. Dialogue can be sparse and clipped where feeling would otherwise soften a moment that should not be softened.

This does not mean gratuitous — cruelty for its own sake is not the goal. It means the narrative refuses to flinch away from the real cost of what happens, and does not reach for comfort the situation has not earned.`,
  },
  {
    id: 'wry',
    displayName: 'Wry and irreverent',
    tagline: 'Dry wit, deflating self-importance, never precious.',
    promptBody: `Write with wry, irreverent humor running underneath the prose. Characters notice absurdity and say so, often in an aside or a deadpan observation rather than a full joke; let the narration itself carry a raised eyebrow even in serious moments. Nothing in this world is too sacred to be gently punctured.

Favor understatement over exclamation — a dry one-liner lands harder than an escalating bit. Let characters deflect discomfort with humor rather than melodrama, and let banter do double duty as characterization.

This is not slapstick and it is not mockery of the stakes themselves — the humor sits alongside real tension rather than replacing it. The wit should feel like a character's survival strategy, not a tonal costume the prose puts on.`,
  },
  {
    id: 'hopeful',
    displayName: 'Warm and hopeful',
    tagline: 'Trouble is real, but so is the good that answers it.',
    promptBody: `Write in a warm, hopeful register. Difficulty and conflict are real and are not minimized, but the narrative trusts that effort, kindness, and connection matter and tends to reward them — even a loss can be framed as something a character grows from rather than something purely bleak.

Let small gestures land with real weight: a kept promise, a hand offered, a problem solved together rather than alone. Give characters generosity toward each other by default, reserving real antagonism for where the story specifically needs it.

Avoid saccharine easiness — earn the warmth by having characters work for it rather than having good outcomes arrive unearned. The tone should leave a reader feeling that trying was worthwhile, not that nothing was ever actually at risk.`,
  },
  {
    id: 'paranoid',
    displayName: 'Tense and paranoid',
    tagline: 'Nobody is safe to trust, least of all the obvious answer.',
    promptBody: `Write in a tense, paranoid register. Let ordinary details carry a faint charge of threat — a held glance, a too-convenient coincidence, silence where there should be noise — so the reader (and the characters) are never quite able to relax. Trust between characters should feel provisional even when it is sincere.

Keep sentences taut; short, clipped exchanges and clipped observation build pressure better than long, settled description. Let a character's internal suspicion color how they read a scene, so the same room can feel different depending on who is afraid and why.

Withhold certainty where possible — let the reader suspect without being told outright whether the suspicion is justified. The tone should make safety feel temporary even in scenes where nothing overtly bad happens.`,
  },
  {
    id: 'melancholic',
    displayName: 'Melancholic',
    tagline: 'A quiet ache under everything, even the good moments.',
    promptBody: `Write in a melancholic register. Let a quiet sense of loss or longing color scenes even when nothing overtly sad is happening — a character notices what has changed, what cannot be recovered, what almost was. Joy, when it appears, is tinged with the awareness that it will pass.

Favor slower, reflective pacing and imagery over event; a character lingering on a detail (a worn object, an empty chair, a season turning) does real work here. Let silence and understatement carry feeling rather than having characters state their sadness outright.

This is not despair — there should be tenderness in it, and beauty noticed precisely because it is fleeting. The tone aims for an ache the reader can sit inside comfortably, not a wound the story is actively bleeding from.`,
  },
  {
    id: 'pulpy',
    displayName: 'Pulpy and kinetic',
    tagline: 'Fast, loud, and constantly moving forward.',
    promptBody: `Write in a pulpy, kinetic register. Keep momentum high — short paragraphs, active verbs, scenes that open already in motion and cut away right after the payoff rather than lingering. Let action beats be vivid and immediate, sketched in quick, punchy strokes rather than dwelt on.

Lean into bold, larger-than-life description: play up the thrill of danger, and let a character's competence or daring read as showy for the sake of the moment landing. Cliffhangers, close calls, and sudden reversals are welcome tools, used often.

Dialogue should crackle — quips under pressure, declarations, dares. This tone prizes propulsion and fun over restraint; a reader should feel like the scene is always accelerating toward the next turn.`,
  },
  {
    id: 'lyrical',
    displayName: 'Lyrical and dreamlike',
    tagline: 'Prose that lingers, drifts, and trusts image over event.',
    promptBody: `Write in a lyrical, dreamlike register. Let imagery, rhythm, and sensory detail carry as much weight as plot event — a scene can be built around a single striking image or sensation rather than a sequence of actions. Time and transition can blur slightly, the way memory or dream does, without the prose stopping to orient the reader mechanically.

Favor sentences with movement and cadence over strict economy; a longer, flowing sentence that builds an image is welcome where it would be cut in a tauter register. Metaphor and synesthetic detail (sound described as color, feeling as weather) belong here.

Keep this from tipping into vagueness — the dreamlike quality should still leave the reader with a clear emotional throughline, even when literal specifics are soft-focused. Clarity of feeling matters more than clarity of mechanism.`,
  },
  {
    id: 'procedural',
    displayName: 'Dry and procedural',
    tagline: 'Competence, method, and facts stated plainly.',
    promptBody: `Write in a dry, procedural register. Prefer plain, exact statements of what happens and how — steps taken, decisions made, results observed — over emotional editorializing. Let competence show through correct method rather than through the narration telling the reader a character is skilled.

Keep sentence structure clean and unadorned; avoid figurative language where a literal description will do. Dialogue should sound like people doing a job — terse, informative, focused on the task rather than on feelings about the task.

This does not mean flat or lifeless — precision itself can be satisfying, and understated detail can carry real tension without the prose announcing it. The tone trusts the reader to supply the emotional reaction rather than supplying it for them.`,
  },
  {
    id: 'yearning',
    displayName: 'Romantic and yearning',
    tagline: 'Every scene aware of what a character wants and cannot yet have.',
    promptBody: `Write in a romantic, yearning register. Let characters be acutely aware of each other — a glance held a beat too long, the distance between two hands, what is said versus what is meant — so that even unrelated scenes carry an undercurrent of wanting. Delay and near-miss are tools to be used generously, not rushed past.

Favor close attention to small physical and emotional detail: the specific way someone says a name, the weight of an unfinished sentence. Let interiority linger on what a character feels but does not say, rather than resolving the tension quickly through direct declaration.

Keep the yearning grounded in character rather than abstraction — it should be clear what, specifically, is wanted and why it is not simple to have. The tone rewards patience: satisfaction deferred is more valuable here than satisfaction immediate.`,
  },
  {
    id: 'mythic',
    displayName: 'Mythic and formal',
    tagline: 'Prose that speaks like legend, already being retold.',
    promptBody: `Write in a mythic, formal register, as though events are already being retold as legend even as they happen. Favor elevated, measured diction and a slight remove from moment-to-moment interiority — the prose observes and pronounces more than it chats. Repetition, triads, and ceremonial phrasing (oaths, names, epithets) are welcome tools.

Let characters speak with a certain gravity, even in ordinary exchanges; small talk sits uneasily in this register, so trim it or elevate it. Actions can be described with a sense of inevitability, as though fate is being fulfilled rather than merely happening.

This is not stiffness for its own sake — the formality should carry genuine weight and awe, not just archaic vocabulary. The tone should make the reader feel they are hearing something old being spoken aloud, not just reading an account of it.`,
  },
]
