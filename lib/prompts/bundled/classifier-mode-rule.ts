// staticContent: reads only `mode`. Both classifiers read a user's turn by the story's mode
// (classifier.md → What the classifier reads), so the rule lives once.
export const CLASSIFIER_MODE_RULE = `{%- if mode == 'adventure' -%}
A turn marked as the user's is what the lead does, says or attempts. Where the narration after it shows how an attempt turned out, the narration decides what happened, and what the lead says stands unless the narration contradicts it. A user's turn that plainly speaks to the narrator rather than playing the lead ("skip to the next morning") is a direction: it states nothing that happened, so take the facts from the narration.
{%- else -%}
A turn marked as the user's is a direction or prose. One that reads as a direction ("the guards catch them at the gate") states nothing that happened: take the facts from the narration that carries it out. One that reads as prose is part of the story: classify it like the narration.
{%- endif -%}`
