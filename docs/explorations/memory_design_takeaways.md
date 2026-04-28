# Memory & Retrieval Design — Key Takeaways

## 1. The Context Budget (per turn)

- **Working memory:** Recent entries (up to 48k tokens) are always fully injected – the storyteller sees the entire unclosed chapter verbatim.
- **Structurally required:** Active in-scene entities + current location are hard‑injected (no cost, no retrieval).
- **Dynamic retrieval:** Fills the remaining context window budget with:
  - Deterministic name‑based pulls (if user mentions “Aria” → inject her entity).
  - Chapter memory digests (keyword‑matched against recent user text).
  - Character‑aware knowledge (salience‑decayed `happening_awareness` rows).

## 2. Chapter Memory Digest (the cheap long‑term memory pillar)

- **Where:** A new `memory_digest` column on the `chapters` table (nullable, 600–1000 tokens).
- **Content:** Dense, factual recap of the chapter’s events, character state changes, revealed secrets, unresolved threads – _not_ an artistic summary, but a retrieval‑grade fact list.
- **Generation:** Once per chapter at close time, by the same agent that writes the public summary (lore‑mgmt / memory‑compaction). Zero per‑turn LLM cost.
- **Runtime lookup:** Simple keyword match against the digest column of all closed chapters → top 1–2 injected as “Narrator’s memory of past events”.

## 3. Taming Keyword Injection (noise prevention)

- **No full‑text search on entity/lore/happening bodies** – they are too broad and can flood the context.
- **Deterministic injection** for explicit name mentions (entities, threads, happenings) – no ranking, no threshold.
- **All other retrieval** funnelled through chapter digests – scaling with number of chapters, not thousands of lore rows.

## 4. Salience & Character Awareness (who knows what)

- **Exponential salience decay** (`salience × exp(-λ × time)`) applied per turn, no LLM.
- **Manual safeguards:**
  - Initial salience values assigned by classifier (10 – critical, 5 – significant, 2 – notable, 1 – ambient). Trivial memories fade fast; important ones persist.
  - A `sticky` boolean on `happening_awareness` – if true, salience never decays (permanent memory).
- **Common knowledge** (`common_knowledge=1`) injects once for all, bypassing per‑character links.

## 5. Retrieval Agent = Optional, Off by Default

- The `retrieval` model slot exists but is **disabled per story** by default.
- If enabled, it replaces keyword retrieval with a two‑stage cascade (keyword → LLM re‑rank), at an extra per‑turn LLM cost.
- A manual “Recall” button can invoke it on‑demand, giving users control.

## 6. Amortise All Expensive Work to Chapter Close

- **Lore‑management agent** → updates lore/entities based on the chapter.
- **Memory compaction** → consolidates low‑salience awareness rows into summary happenings.
- **Digest generation** → creates the retrieval‑grade memory snapshot.
- All these are delta‑logged, reversible, and never run mid‑turn.

## 7. Why This Works With Your Existing Schema

- `injection_mode` (always | keyword_llm | disabled) aligns perfectly with deterministic + keyword retrieval.
- `happening_awareness` already encodes per‑character knowledge.
- Chapters already have summaries, keywords, and fork‑safety – the digest fits right in.
- The massive recent‑entry buffer means the LLM has a perfect working memory; retrieval only needs to fill the “long‑term” gap.

## 8. The Overall Philosophy

> **“Chapter‑close is the only place we spend LLM dollars on memory. Every turn, we query pre‑digested facts with simple SQL and keyword matches.”**

This keeps per‑turn latency and cost near zero while giving the storyteller enough contextual depth to maintain character coherence, callbacks, and world consistency across a full campaign.
