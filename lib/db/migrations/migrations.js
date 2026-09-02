// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import journal from './meta/_journal.json'
import m0000 from './0000_dizzy_dagger.sql'
import m0001 from './0001_striped_prism.sql'
import m0002 from './0002_many_human_fly.sql'
import m0003 from './0003_lowly_sister_grimm.sql'
import m0004 from './0004_nice_micromacro.sql'
import m0005 from './0005_embedder_vec0.sql'
import m0006 from './0006_absent_natasha_romanoff.sql'
import m0007 from './0007_retrieval_budget_tokens.sql'
import m0008 from './0008_happenings_occurred_idx.sql'
import m0009 from './0009_blue_pet_avengers.sql'
import m0010 from './0010_entries_position_idx.sql'

export default {
  journal,
  migrations: {
    m0000,
    m0001,
    m0002,
    m0003,
    m0004,
    m0005,
    m0006,
    m0007,
    m0008,
    m0009,
    m0010,
  },
}
