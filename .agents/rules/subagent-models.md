---
trigger: always_on
---

# Subagent Model Selection

When invoking a subagent via `invoke_subagent`, select the `Model` parameter to match the complexity of the task rather than defaulting blindly to `inherit`:

- **`flash_lite`**: Trivial, mechanical, or high-volume tasks (e.g., narrow file/symbol lookups, simple text extraction).
- **`flash`**: Codebase exploration, read-only research, broad search/grep surveys, summarization, and straightforward verification tasks.
- **`pro`**: Complex reasoning tasks (e.g., multi-file implementation, architectural design, deep debugging, thorough code or spec review).
- **`inherit`**: Reserve for tasks that specifically require the parent session's active model, or when matching the parent model's exact capabilities is necessary.
