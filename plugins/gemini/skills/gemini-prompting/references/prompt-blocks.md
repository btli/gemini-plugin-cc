# Prompt Blocks

Reusable XML-wrapped blocks for structuring Gemini prompts.

## Core Wrapper

```xml
<task>
[One clear sentence describing what to do.]
</task>
```

Use for every prompt. State the job, not the reasoning.

## Output Format

```xml
<structured_output_contract>
Return:
1. [field one]
2. [field two]
...
</structured_output_contract>
```

Use when the output must follow a specific shape.

```xml
<compact_output_contract>
Return a compact [type] with:
1. [field]
2. [field]
3. [field]
</compact_output_contract>
```

Use for short, focused outputs.

## Follow-through

```xml
<default_follow_through_policy>
Keep going until [completion condition].
Only stop to ask when [exception].
</default_follow_through_policy>
```

Prevents the model from stopping too early.

```xml
<completeness_contract>
Resolve the task fully before stopping.
Do not stop after [partial milestone] without [full completion].
</completeness_contract>
```

## Grounding

```xml
<grounding_rules>
Ground every claim in [source].
If a point is an inference, label it clearly.
</grounding_rules>
```

Prevents hallucination.

```xml
<missing_context_gating>
Do not guess missing [type] facts.
If required context is absent, state exactly what remains unknown.
</missing_context_gating>
```

## Safety & Scope

```xml
<action_safety>
Keep changes tightly scoped to the stated task.
Avoid unrelated refactors or cleanup.
</action_safety>
```

```xml
<verification_loop>
Before finalizing, verify that [condition].
</verification_loop>
```

## Task-Specific

```xml
<research_mode>
Separate observed facts, reasoned inferences, and open questions.
</research_mode>
```

```xml
<dig_deeper_nudge>
Check for [specific failure modes] before finalizing.
</dig_deeper_nudge>
```
