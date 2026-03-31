# ADR: Context Graph Architecture for Decision Traces

```
    ╔══════════════════════════════════════════════╗
    ║    CONTEXT GRAPH ARCHITECTURE ADR            ║
    ║                                              ║
    ║    From Events → To Knowledge Graph          ║
    ║                                              ║
    ║    Events capture WHAT                       ║
    ║    Context Graphs explain WHY                ║
    ╚══════════════════════════════════════════════╝
```

## Status

**Proposed** - Awaiting implementation

## Executive Summary

This ADR proposes extending swarm-mail's event sourcing architecture with **Decision Trace** capabilities - capturing not just WHAT happened during swarm coordination, but WHY decisions were made, WHAT alternatives were considered, and HOW precedent influenced outcomes.

**Key Insight:** Systems of record capture state changes. Context graphs capture decision-time context. Our event store already captures "worker_spawned" - but not "why THIS decomposition strategy", "what precedent justified this file assignment", or "which alternatives were rejected and why."

**Structural Advantage:** Swarm coordinators sit in the execution path. They see inputs gathered, policies evaluated, exceptions granted. We're ALREADY in position to capture decision traces - we just need to persist them as queryable precedent.

## Context: The Problem We're Solving

### What We Have (Event Sourcing)

swarm-mail currently captures outcomes as isolated events:

```typescript
// Current: WHAT happened
{
  type: "subtask_outcome",
  epic_id: "mj123",
  bead_id: "mj123-1",
  success: true,
  duration_ms: 45000,
  error_count: 0
}
```

This tells us the task succeeded. It doesn't tell us:

- **WHY** this decomposition strategy was chosen
- **WHAT** precedent influenced file assignments
- **HOW** conflicts were resolved
- **WHICH** alternatives were considered and rejected

### What We're Missing (Decision Context)

When a coordinator spawns workers, it makes decisions:

- "Use file-based strategy because feature-based failed on similar tasks 3 times"
- "Assign auth.ts to Worker A based on past success rate with auth code"
- "Grant exception to merge src/auth/** into one subtask despite overlap guideline"
- "Reference similar epic mj100 which solved OAuth refresh the same way"

**None of this reasoning is captured.** The knowledge exists at decision-time, then evaporates.

### The Precedent Problem

Semantic memory stores learnings AFTER the fact:

```
"OAuth refresh needs 5min buffer to avoid race conditions"
```

But it doesn't capture:

- **WHEN** was this pattern discovered? (which epic, which subtask)
- **WHO** decided to apply this pattern? (which coordinator, which worker)
- **WHAT** alternatives were tried first? (immediate refresh, 1min buffer)
- **HOW** did we verify it worked? (tests, production validation)

**Result:** Patterns are de-contextualized. We can't answer "show me all decisions that applied the OAuth buffer pattern" or "what was the decision context when this pattern was first discovered?"

## Decision: Add Decision Trace Layer

We propose adding a **Decision Trace** layer on top of the existing event store. This layer:

1. **Captures decision-time context** as structured data
2. **Links entities across time** (this epic → similar past epics → their outcomes)
3. **Makes precedent queryable** as first-class data
4. **Preserves alternatives** that were considered but rejected

### Architecture: Three-Layer Model

```
┌─────────────────────────────────────────────────────────┐
│  LAYER 3: Decision Traces (New)                         │
│  ─────────────────────────────────────────────          │
│  Structured decision context with entity links          │
│  - Why this strategy?                                   │
│  - What precedent applied?                              │
│  - Which alternatives rejected?                         │
│  - How conflicts resolved?                              │
└─────────────────────────────────────────────────────────┘
              ▲
              │ Enriches via projection
              │
┌─────────────────────────────────────────────────────────┐
│  LAYER 2: Events (Current)                              │
│  ──────────────────────────────────────                 │
│  Append-only event log                                  │
│  - worker_spawned, task_completed, etc.                 │
│  - Immutable audit trail                                │
│  - Source of truth for WHAT happened                    │
└─────────────────────────────────────────────────────────┘
              ▲
              │ Writes to
              │
┌─────────────────────────────────────────────────────────┐
│  LAYER 1: Database (libSQL)                             │
│  ───────────────────────────────────────                │
│  - Events table (append-only)                           │
│  - Projections (agents, messages, reservations)         │
│  - Decision traces (new table)                          │
│  - Entity links (new table)                             │
└─────────────────────────────────────────────────────────┘
```

### Why This Works for Swarm Coordination

1. **Coordinators already synthesize context** - they query CASS, semantic memory, past outcomes
2. **Decisions are already made** - strategy selection, file assignment, exception granting
3. **We control the execution path** - swarm_decompose, swarm_spawn_subtask, swarm_review
4. **Event store provides ordering** - decisions are naturally sequenced with outcomes

## Schema Design

### DecisionTrace Table

```typescript
/**
 * Decision Traces - Structured decision context
 *
 * Captures WHY decisions were made, not just WHAT happened.
 * Links to events, entities, and precedent.
 */
export const decisionTracesTable = sqliteTable("decision_traces", {
  id: text("id").primaryKey(), // dt-{nanoid}

  // What decision was made
  decision_type: text("decision_type").notNull(),
  // 'decomposition_strategy', 'file_assignment', 'exception_granted',
  // 'review_approval', 'conflict_resolution'

  // Context
  epic_id: text("epic_id"),
  bead_id: text("bead_id"),
  agent_name: text("agent_name").notNull(),
  project_key: text("project_key").notNull(),

  // The decision
  decision: text("decision").notNull(), // JSON: actual decision made

  // Why this decision
  rationale: text("rationale"), // Human-readable explanation

  // Inputs considered
  inputs_gathered: text("inputs_gathered"), // JSON: what data was examined
  // { cass_queries: [...], semantic_memory: [...], past_outcomes: [...] }

  // Policy evaluated
  policy_evaluated: text("policy_evaluated"), // JSON: what rules applied
  // { guideline: "avoid file overlap", exception: "similar epic precedent" }

  // Alternatives considered
  alternatives: text("alternatives"), // JSON: what else was considered
  // [{ option: "feature-based", rejected_because: "70% failure rate" }]

  // Precedent referenced
  precedent_cited: text("precedent_cited"), // JSON: specific precedent
  // [{ epic_id: "mj100", reason: "solved OAuth refresh same way" }]

  // Outcome link
  outcome_event_id: integer("outcome_event_id"), // FK to events.id

  // Metadata
  timestamp: integer("timestamp").notNull(),
  created_at: text("created_at").default("(datetime('now'))"),
}, (table) => ({
  epicIdx: index("idx_decision_traces_epic").on(table.epic_id),
  typeIdx: index("idx_decision_traces_type").on(table.decision_type),
  agentIdx: index("idx_decision_traces_agent").on(table.agent_name),
  timestampIdx: index("idx_decision_traces_timestamp").on(table.timestamp),
}));

export type DecisionTrace = typeof decisionTracesTable.$inferSelect;
export type NewDecisionTrace = typeof decisionTracesTable.$inferInsert;
```

### EntityLinks Table

```typescript
/**
 * Entity Links - Connects decisions across time
 *
 * Enables queries like:
 * - "Show all decisions that cited epic mj100"
 * - "What precedent influenced this file assignment?"
 * - "Which decisions applied the OAuth buffer pattern?"
 */
export const entityLinksTable = sqliteTable("entity_links", {
  id: text("id").primaryKey(),

  // Source decision
  source_decision_id: text("source_decision_id")
    .notNull()
    .references(() => decisionTracesTable.id, { onDelete: "cascade" }),

  // Target entity (epic, pattern, file, agent)
  target_entity_type: text("target_entity_type").notNull(),
  // 'epic', 'pattern', 'file', 'agent', 'memory'
  target_entity_id: text("target_entity_id").notNull(),

  // Relationship type
  link_type: text("link_type").notNull(),
  // 'cites_precedent', 'applies_pattern', 'similar_to',
  // 'resolves_conflict_from', 'learned_from'

  // Link strength (for ranking/filtering)
  strength: real("strength").default(1.0), // 0-1

  // Context
  context: text("context"), // Why this link matters

  // Metadata
  created_at: text("created_at").default("(datetime('now'))"),
}, (table) => ({
  sourceIdx: index("idx_entity_links_source").on(table.source_decision_id),
  targetIdx: index("idx_entity_links_target")
    .on(table.target_entity_type, table.target_entity_id),
  linkTypeIdx: index("idx_entity_links_type").on(table.link_type),
}));

export type EntityLink = typeof entityLinksTable.$inferSelect;
export type NewEntityLink = typeof entityLinksTable.$inferInsert;
```

## Code Examples

### Capturing Decision Traces

**At decomposition time (swarm_decompose):**

```typescript
import { createDecisionTrace, linkEntityToPrecedent } from "swarm-mail";

// After strategy selection
async function captureDecompositionDecision(
  swarmMail: SwarmMailAdapter,
  context: {
    epicId: string;
    agentName: string;
    projectKey: string;
    selectedStrategy: string;
    cassResults: any[];
    semanticMemoryResults: any[];
    alternatives: Array<{ strategy: string; rejectedBecause: string }>;
    precedentCited: Array<{ epicId: string; reason: string }>;
  }
) {
  const trace = await createDecisionTrace(swarmMail, {
    decision_type: "decomposition_strategy",
    epic_id: context.epicId,
    agent_name: context.agentName,
    project_key: context.projectKey,

    decision: JSON.stringify({
      strategy: context.selectedStrategy,
    }),

    rationale: `Selected ${context.selectedStrategy} based on ${context.cassResults.length} CASS precedents and ${context.semanticMemoryResults.length} semantic memory patterns`,

    inputs_gathered: JSON.stringify({
      cass_queries: context.cassResults.map(r => ({
        query: r.query,
        relevance: r.score,
        result: r.summary,
      })),
      semantic_memory: context.semanticMemoryResults.map(r => ({
        id: r.id,
        content: r.content,
        decay: r.decay_factor,
      })),
    }),

    alternatives: JSON.stringify(context.alternatives),

    precedent_cited: JSON.stringify(context.precedentCited),
  });

  // Link to cited precedent epics
  for (const precedent of context.precedentCited) {
    await linkEntityToPrecedent(swarmMail, {
      source_decision_id: trace.id,
      target_entity_type: "epic",
      target_entity_id: precedent.epicId,
      link_type: "cites_precedent",
      context: precedent.reason,
      strength: 1.0,
    });
  }

  return trace;
}
```

**At file assignment time (swarm_spawn_subtask):**

```typescript
async function captureFileAssignmentDecision(
  swarmMail: SwarmMailAdapter,
  context: {
    epicId: string;
    beadId: string;
    agentName: string;
    files: string[];
    rationale: string;
    fileInsights: Array<{ file: string; failureCount: number; gotchas: string[] }>;
  }
) {
  const trace = await createDecisionTrace(swarmMail, {
    decision_type: "file_assignment",
    epic_id: context.epicId,
    bead_id: context.beadId,
    agent_name: context.agentName,
    project_key: context.projectKey,

    decision: JSON.stringify({
      files: context.files,
      assigned_to: context.agentName,
    }),

    rationale: context.rationale,

    inputs_gathered: JSON.stringify({
      file_insights: context.fileInsights,
    }),

    policy_evaluated: JSON.stringify({
      guideline: "assign files with low failure counts",
      applied: context.fileInsights.every(f => f.failureCount < 3),
    }),
  });

  // Link to files
  for (const file of context.files) {
    await linkEntityToPrecedent(swarmMail, {
      source_decision_id: trace.id,
      target_entity_type: "file",
      target_entity_id: file,
      link_type: "assigns_file",
      strength: 1.0,
    });
  }

  return trace;
}
```

**At review approval time (swarm_review_feedback):**

```typescript
async function captureReviewDecision(
  swarmMail: SwarmMailAdapter,
  context: {
    epicId: string;
    beadId: string;
    reviewerAgent: string;
    status: "approved" | "needs_changes";
    issues: Array<{ file: string; line: number; issue: string }>;
    policyViolations: string[];
  }
) {
  const trace = await createDecisionTrace(swarmMail, {
    decision_type: "review_approval",
    epic_id: context.epicId,
    bead_id: context.beadId,
    agent_name: context.reviewerAgent,
    project_key: context.projectKey,

    decision: JSON.stringify({
      status: context.status,
      issues: context.issues,
    }),

    rationale: context.status === "approved"
      ? "Work fulfills subtask requirements and serves epic goal"
      : `Found ${context.issues.length} issues requiring changes`,

    policy_evaluated: JSON.stringify({
      guidelines: [
        "type safety",
        "no obvious bugs",
        "fulfills requirements",
        "serves epic goal",
      ],
      violations: context.policyViolations,
    }),
  });

  return trace;
}
```

### Querying Decision Traces

**Find all decisions that cited a specific epic as precedent:**

```typescript
async function findDecisionsByCitedPrecedent(
  swarmMail: SwarmMailAdapter,
  epicId: string
): Promise<DecisionTrace[]> {
  const db = await swarmMail.getDatabase();

  const query = `
    SELECT dt.*
    FROM decision_traces dt
    JOIN entity_links el ON el.source_decision_id = dt.id
    WHERE el.target_entity_type = 'epic'
      AND el.target_entity_id = ?
      AND el.link_type = 'cites_precedent'
    ORDER BY dt.timestamp DESC
  `;

  const result = await db.query(query, [epicId]);
  return result.rows as DecisionTrace[];
}
```

**Find all decisions that applied a specific pattern:**

```typescript
async function findDecisionsByPattern(
  swarmMail: SwarmMailAdapter,
  patternId: string // from semantic memory
): Promise<DecisionTrace[]> {
  const db = await swarmMail.getDatabase();

  const query = `
    SELECT dt.*
    FROM decision_traces dt
    JOIN entity_links el ON el.source_decision_id = dt.id
    WHERE el.target_entity_type = 'memory'
      AND el.target_entity_id = ?
      AND el.link_type = 'applies_pattern'
    ORDER BY dt.timestamp DESC
  `;

  const result = await db.query(query, [patternId]);
  return result.rows as DecisionTrace[];
}
```

**Find all file assignment decisions for a specific file:**

```typescript
async function findFileAssignmentHistory(
  swarmMail: SwarmMailAdapter,
  filePath: string
): Promise<Array<DecisionTrace & { outcome?: any }>> {
  const db = await swarmMail.getDatabase();

  const query = `
    SELECT
      dt.*,
      e.data as outcome_data
    FROM decision_traces dt
    JOIN entity_links el ON el.source_decision_id = dt.id
    LEFT JOIN events e ON e.id = dt.outcome_event_id
    WHERE dt.decision_type = 'file_assignment'
      AND el.target_entity_type = 'file'
      AND el.target_entity_id = ?
    ORDER BY dt.timestamp DESC
  `;

  const result = await db.query(query, [filePath]);
  return result.rows.map(row => ({
    ...row,
    outcome: row.outcome_data ? JSON.parse(row.outcome_data) : null,
  }));
}
```

**Get decision trace with full context for a specific decision:**

```typescript
async function getDecisionTraceWithContext(
  swarmMail: SwarmMailAdapter,
  decisionId: string
): Promise<{
  trace: DecisionTrace;
  links: Array<{
    entityType: string;
    entityId: string;
    linkType: string;
    context: string | null;
  }>;
  outcome: any | null;
}> {
  const db = await swarmMail.getDatabase();

  // Get decision trace
  const traceResult = await db.query(
    `SELECT * FROM decision_traces WHERE id = ?`,
    [decisionId]
  );
  const trace = traceResult.rows[0] as DecisionTrace;

  // Get entity links
  const linksResult = await db.query(
    `SELECT * FROM entity_links WHERE source_decision_id = ?`,
    [decisionId]
  );
  const links = linksResult.rows as Array<{
    target_entity_type: string;
    target_entity_id: string;
    link_type: string;
    context: string | null;
  }>;

  // Get outcome event if linked
  let outcome = null;
  if (trace.outcome_event_id) {
    const outcomeResult = await db.query(
      `SELECT * FROM events WHERE id = ?`,
      [trace.outcome_event_id]
    );
    if (outcomeResult.rows[0]) {
      outcome = JSON.parse(outcomeResult.rows[0].data);
    }
  }

  return {
    trace,
    links: links.map(l => ({
      entityType: l.target_entity_type,
      entityId: l.target_entity_id,
      linkType: l.link_type,
      context: l.context,
    })),
    outcome,
  };
}
```

### Integration with Existing Tools

**swarm_decompose enhancement:**

```typescript
// Before (current)
export async function swarmDecompose(task: string, context?: string) {
  const cassResults = await cassSearch(task);
  const memoryResults = await semanticMemoryFind(task);

  const strategy = selectStrategy(cassResults, memoryResults);

  // Generate decomposition...
}

// After (with decision traces)
export async function swarmDecompose(
  swarmMail: SwarmMailAdapter,
  task: string,
  context?: string
) {
  const cassResults = await cassSearch(task);
  const memoryResults = await semanticMemoryFind(task);

  const strategySelection = selectStrategy(cassResults, memoryResults);

  // Capture decision trace
  await captureDecompositionDecision(swarmMail, {
    epicId: generateEpicId(),
    agentName: "coordinator",
    projectKey: process.cwd(),
    selectedStrategy: strategySelection.strategy,
    cassResults,
    semanticMemoryResults: memoryResults,
    alternatives: strategySelection.alternatives,
    precedentCited: strategySelection.precedent,
  });

  // Generate decomposition...
}
```

**swarm query CLI enhancement:**

```bash
# Current
swarm query --preset failed_decompositions

# New: query decision traces
swarm query --preset decision_traces_by_precedent --epic mj100
swarm query --preset file_assignment_history --file src/auth.ts
swarm query --preset review_decisions_rejected
```

## Implementation Plan

### Phase 1: Schema & Infrastructure (Week 1)

**Goal:** Add decision_traces and entity_links tables to libSQL schema

- [ ] Add `decision_traces` table to `packages/swarm-mail/src/db/schema/streams.ts`
- [ ] Add `entity_links` table to schema
- [ ] Create migration script for existing databases
- [ ] Add TypeScript types for `DecisionTrace` and `EntityLink`
- [ ] Write unit tests for schema validation

**Success Criteria:**

- Tables created successfully
- Foreign keys working (decision → event)
- Indexes perform efficiently (<10ms for typical queries)

### Phase 2: Capture Layer (Week 2)

**Goal:** Capture decision traces at key decision points

- [ ] Implement `createDecisionTrace()` in `packages/swarm-mail/src/streams/`
- [ ] Implement `linkEntityToPrecedent()`
- [ ] Add decision capture to `swarm_decompose` (strategy selection)
- [ ] Add decision capture to `swarm_spawn_subtask` (file assignment)
- [ ] Add decision capture to `swarm_review_feedback` (approval/rejection)
- [ ] Write integration tests for capture flow

**Success Criteria:**

- Decision traces captured for decomposition, assignment, review
- Entity links created for precedent citations
- No performance degradation (capture async, non-blocking)

### Phase 3: Query Layer (Week 3)

**Goal:** Make decision traces queryable and useful

- [ ] Implement query helpers in `packages/swarm-mail/src/streams/`
  - `findDecisionsByCitedPrecedent()`
  - `findDecisionsByPattern()`
  - `findFileAssignmentHistory()`
  - `getDecisionTraceWithContext()`
- [ ] Add CLI commands to `swarm query`
  - `--preset decision_traces_by_precedent`
  - `--preset file_assignment_history`
  - `--preset review_decisions`
- [ ] Enhance dashboard to show decision context
- [ ] Write query performance tests

**Success Criteria:**

- Queries return results <100ms for typical datasets
- CLI commands working and documented
- Dashboard shows decision rationale inline with events

### Phase 4: Learning Integration (Week 4)

**Goal:** Feed decision traces back into strategy selection

- [ ] Enhance `swarm_select_strategy` to query decision traces
- [ ] Show "similar decisions" when coordinator makes choices
- [ ] Link semantic memory patterns to decisions that applied them
- [ ] Track decision → outcome → learning feedback loop
- [ ] Add eval scorers for decision quality

**Success Criteria:**

- Strategy selection cites relevant past decisions
- Semantic memory patterns show "used in N decisions"
- Learning feedback loop measurable (decision quality improves over time)

## Success Metrics

### Capture Completeness

- **100%** of decomposition decisions have traces
- **100%** of file assignments have traces
- **100%** of review decisions have traces
- **>90%** of traces have at least one entity link

### Query Performance

- **<100ms** for precedent queries (10 results)
- **<50ms** for file assignment history (single file)
- **<200ms** for decision trace with full context

### Learning Impact

- **>30%** of strategy selections cite specific precedent (vs generic heuristics)
- **>50%** of file assignments reference file-specific insights
- **<5%** of decisions cite non-existent or outdated precedent

### Developer Experience

- **CLI commands documented** with examples in AGENTS.md
- **Dashboard shows decision context** inline with events
- **Semantic memory patterns** link back to decisions that used them

## Consequences

### Benefits

**1. Queryable Precedent**

- "Show me all decisions that applied the OAuth buffer pattern"
- "What was the context when we decided to use file-based strategy for auth?"
- "Which epics cited mj100 as precedent?"

**2. Transparent Decision-Making**

- Coordinators explain WHY they chose a strategy
- Reviewers document WHY work was approved/rejected
- Exceptions have documented rationale

**3. Better Learning**

- Semantic memory patterns linked to actual decisions
- Strategy selection cites specific past outcomes
- Failed patterns show WHERE and WHY they failed

**4. Debugging Coordination**

- "Why did coordinator choose this file split?"
- "What precedent influenced this exception?"
- "Which alternatives were considered?"

### Tradeoffs

**1. Storage Overhead**

- Decision traces add ~500 bytes per decision
- Entity links add ~200 bytes per link
- Typical epic: 5-10 decisions, 10-20 links = ~10KB total
- **Mitigation:** Compress JSON fields, archive old traces

**2. Capture Complexity**

- Coordinators must explicitly capture decision context
- Risk of incomplete/inconsistent traces
- **Mitigation:** Helper functions with sane defaults, validation

**3. Query Complexity**

- Joins across decision_traces, entity_links, events
- Risk of slow queries on large datasets
- **Mitigation:** Strategic indexes, query result caching

**4. Schema Evolution**

- Decision types may change over time
- Entity link types may need new categories
- **Mitigation:** JSON fields flexible, add new types incrementally

## Alternatives Considered

### Alternative 1: Extend Event Payloads

**Idea:** Add `rationale` and `precedent_cited` fields to existing events

**Rejected Because:**

- Event payloads already large (some >1KB)
- Entity linking requires separate table for efficient queries
- Precedent queries would require full table scans
- Violates separation of concerns (events = WHAT, traces = WHY)

### Alternative 2: Store Decision Traces in Semantic Memory

**Idea:** Store decision context as memories with special tags

**Rejected Because:**

- Semantic memory is for learnings, not operational data
- Vector search not optimized for entity linking queries
- No structured schema for decision types
- Mixing operational data with knowledge creates confusion

### Alternative 3: External Knowledge Graph Database

**Idea:** Use Neo4j or similar graph database for decision traces

**Rejected Because:**

- Adds deployment dependency (another service to run)
- swarm-mail already has libSQL with good JSON/query support
- Entity links can be modeled relationally with indexes
- Graph queries can be implemented with recursive CTEs if needed

## References

**External:**

- [a16z Context Graph Thesis](https://a16z.com/context-graphs/) - Core inspiration
- [Event Sourcing in Practice](https://martinfowler.com/eaaDev/EventSourcing.html) - Fowler
- [Decision Records](https://adr.github.io/) - ADR pattern we're extending

**Internal:**

- `packages/swarm-mail/src/streams/events.ts` - Current event types
- `packages/swarm-mail/src/db/schema/streams.ts` - Database schema
- `packages/swarm-mail/src/memory/` - Semantic memory implementation
- `packages/opencode-swarm-plugin/src/swarm-insights.ts` - Learning system

## Quote from the Craft

> "The best way to predict the future is to look at the past. But to understand the past, you need to know not just what happened, but why it happened. That's the difference between data and knowledge."
> — *Designing Data-Intensive Applications*, Martin Kleppmann

*(Retrieved via pdf-brain_search: "event sourcing context knowledge")*

---

**Status:** Proposed
**Deciders:** Imamuzzaki Abu Salam, swarm coordinators
**Date:** 2025-12-27
**Tags:** #architecture #event-sourcing #context-graph #decision-traces
