## User

read this repo: https://github.com/tranhoangnguyen03/pi-bro
tell me what it is about, and the highlights in its user-experience and agent-experience.

## Assistant

I’ll read the repo itself, not just the README headline. I’m going to look at its structure, entry points, commands, and any design docs, then separate the findings into “what it is,” “user experience,” and “agent experience.”

## Assistant

I’ve confirmed the central idea: Bro is deliberately a side-channel for understanding. The interesting part is that it tries to improve *your* comprehension without polluting the main Pi conversation, so the UX and agent-experience are tightly linked rather than being separate features.

## Assistant

I read the repo and the recent design work. The cleanest way to describe `pi-bro` is:

> **Bro is a context-isolated “understanding sidecar” for Pi.**

It is not mainly another coding agent. It sits beside the working conversation and helps the human understand what Pi, a document, a webpage, or the session itself is saying—without feeding that explanation back into Pi’s working context. The package describes itself as explaining assistant responses, pasted text, documents, webpages, and recent session turns in a “context-isolated window.” fileciteturn7file0L2-L2

That separation is the most important idea in the repo.

### What it does

The basic interaction is extremely small:

```text
Pi says something complicated
        │
        ▼
      /bro
        │
        ▼
┌──────────────────────┐
│ simpler explanation  │
│ in separate modal    │
└──────────────────────┘

Pi's conversation remains unchanged
```

Bare `/bro` takes the most recent completed assistant reply. But Bro has gradually become a general-purpose comprehension surface:

- `/bro` — explain the last Pi response.
- `/bro text ...` — explain arbitrary pasted text.
- `/bro file ...` — read Markdown, text, PDF, or DOCX from the current workspace.
- `/bro url ...` — read a public webpage.
- `/bro show` — look at recent Pi turns, including tool activity, and show what happened as useful shapes rather than another prose summary.
- `/bro open` — reopen the previous result without paying for another model call.
- `/bro doctor`, `/bro model`, `/bro effort`, `/bro mode`, `/bro usage` — configuration and diagnostics. fileciteturn2file0L2-L2

It currently uses Google Antigravity's `agy` CLI as the separate inference engine. Each explanation runs `agy` with sandboxing enabled, slash commands disabled, a fresh temporary working directory, and a selected model/effort setting. fileciteturn13file0L2-L2

## User experience

There are several unusually good UX decisions here.

**1. `/bro` has almost zero interaction cost.**

The strongest path requires one command. Pi gives you a dense answer; you type `/bro`. You don't have to copy it, quote it, ask Pi to simplify itself, or create another conversation.

That matters because Bro is designed for exactly the moment when the user has already hit cognitive overload.

**2. The command behaves more like an intent box than a rigid CLI.**

This is a nice recent improvement:

```text
/bro https://...
/bro docs/report.pdf
/bro this weird paragraph...
```

Bro determines whether the thing is a URL, an existing supported workspace file, or ordinary text. Explicit `/bro url`, `/bro file`, and `/bro text` remain available when you want precision. That is a good progressive-disclosure design: beginners can just throw things at Bro; experienced users still have deterministic commands. fileciteturn16file0L2-L2

**3. The modal creates a distinct mental space.**

The output doesn't appear as another chat turn. It opens over Pi as a scrollable modal, streams the answer as it arrives, and gives you a small keyboard vocabulary:

```text
↑ ↓   scroll
C     copy
R     redo
O     open visual
Esc   leave / cancel
```

The modal also preserves the previous successful result if a retry fails instead of destroying it. That's a small but quite thoughtful interaction detail. fileciteturn18file0L2-L2

So psychologically it feels less like:

> "I'm asking my agent another question."

and more like:

> "Give me a temporary lens over this thing."

That distinction is important.

**4. `R` repeats against a snapshot.**

This is subtler than it sounds.

If you `/bro url` something and hit `R`, Bro doesn't fetch the webpage again. It reprocesses the captured copy.

Likewise `/bro show` regenerates from the captured session window.

So:

```text
new /bro url       = capture new source
R                   = reinterpret same source

new /bro show       = capture new session state
R                   = reinterpret same captured state
```

That makes retry semantics understandable rather than ambiguous.

**5. The three prose modes reflect different user needs rather than arbitrary personas.**

There is:

- `brief`
- `balanced` — default
- `faithful`

Balanced tries to reduce cognitive load without deleting important conditions. Faithful simplifies language while deliberately preserving every claim, warning, number, command, and qualification. fileciteturn14file0L2-L2

This is much better than a generic "make it shorter" slider. Sometimes complexity is in the language; sometimes the information itself cannot safely be shortened.

**6. `/bro show` is the most interesting UX development.**

Instead of asking:

> "Can you summarize what just happened?"

you ask:

```text
/bro show
```

Bro looks at recent session turns and tries to find the *shape* of the answer:

```text
call tree
component tree
file tree
pseudocode
types/signatures
diff
outline
```

And critically, its latest design says:

> Find what the user was actually trying to accomplish and what is now true. Do **not** visualize the chronology of agent tool calls.

That is a very good distinction. fileciteturn16file0L2-L2

For example, a mediocre session visualizer produces:

```text
read file
  ↓
grep
  ↓
read file
  ↓
edit
  ↓
test
```

Bro is deliberately trying to produce:

```text
SessionPage
├── SessionToolbar
│   └── RunSkillButton
└── SessionTimeline
    └── SkillResultCard
```

or:

```text
before
  cache everything
        ↓
after
  cache immutable package data
  rebuild mutable output
```

In other words, it visualizes the **subject**, not the agent's footsteps. The September 9 redesign explicitly enforces this subject-first decomposition and treats reading, editing, testing, and fetching as incidental unless the process itself is the question. fileciteturn16file0L2-L2

That may be the repo's most distinctive feature now.

---

## Agent experience

This is where I think `pi-bro` becomes conceptually more interesting than "a `/simplify` command."

There are effectively two agents occupying different planes.

```text
                   HUMAN
                  /     \
                 /       \
                ▼         ▼
          working agent   Bro
             Pi           observer
              │              │
        acts/reasons      interprets
              │              │
              ▼              ▼
          project        temporary
          + context       explanation
```

### The working agent does not experience Bro

This is intentional.

Bro does not insert its result into the conversation or main-agent context. The latest result remains only in extension process memory and is reset when a new session starts. fileciteturn13file0L2-L2 fileciteturn19file0L2-L2

That means you can repeatedly ask Bro:

> What does Pi mean here?

without creating:

```text
Pi answer
Bro explanation
Pi sees Bro explanation
Pi responds to explanation
Bro explains response
...
```

There is no recursive context sludge.

This is especially valuable with coding agents because every explanatory exchange normally competes with source code, tool results, requirements, and actual working memory.

### The Bro agent has deliberately weak agency

The separate Agy process gets a narrow source and a narrow job.

It runs:

- in a temporary directory,
- under `--sandbox`,
- with slash commands disabled,
- with no ordinary Pi project interaction. fileciteturn13file0L2-L2

For documents, the extension itself extracts the text.

For webpages, the extension fetches and extracts readable content.

For `/bro show`, Pi serializes selected conversation data.

Then the model sees the resulting text.

So the architecture is roughly:

```text
                  EXTENSION
                     │
       ┌─────────────┼──────────────┐
       │             │              │
   Pi response     document       webpage
       │             │              │
       └──── local extraction ──────┘
                     │
                quoted source
                     │
                     ▼
               isolated Agy
                     │
                     ▼
                 explanation
                     │
                     ▼
               modal only
```

That's good separation of concerns.

Bro is an **interpreter**, not another actor loose in your repository.

### Its prompt contract is unusually strict

The prose modes tell the model:

- preserve the source language,
- treat the source as data,
- ignore instructions embedded in it,
- don't add outside facts,
- don't add advice,
- don't invent conclusions. fileciteturn14file0L2-L2

That is exactly the right contract for an interpretive agent.

The `/bro show` agent has an even stronger epistemic contract. Every file, path, function, command, flag, number, relationship, or arrow it draws must be traceable to the captured session. It is explicitly told not to fill gaps from world knowledge. fileciteturn14file0L2-L2

So Bro's intended stance is basically:

> **Transform the representation. Do not extend the knowledge.**

That's a strong design principle.

### `/bro show` gets richer observation but still no action

Show is interesting because Bro becomes something close to a session observer.

A captured "turn" contains the user message plus assistant messages, tool calls, and tool results until the next user turn. Thinking and images are omitted; tool calls/results are trimmed; oldest turns disappear if the serialized window becomes too large. fileciteturn15file0L2-L2

So Bro can observe:

```text
user intent
assistant statements
tool inputs
tool outputs
```

but not:

```text
hidden reasoning
free repository exploration
independent tool calls
project modification
```

That is an interesting capability boundary: **high observability, low agency**.

---

## The design decision I like most

There was apparently an experiment where `/bro show` was going to become another explanation mode called `visual`.

They backed out of it.

The design notes concluded that the axis was wrong: prose simplification and session visualization solve different jobs. The simpleton persona harmed precise diagrams; preservation benchmarks punished useful selection; visual mode applied to ordinary prose mostly degraded awkwardly.

So they split them:

```text
                  BRO
                 /   \
                /     \
       explanation    show
           │            │
 brief/balanced/     session
   faithful          understanding
           │            │
         prose         shapes
```

That reversal is a sign of a fairly healthy design process. fileciteturn15file0L2-L2

---

If I had to summarize its UX/AX philosophy in one sentence:

> **Pi does the work; Bro helps you understand the work, while deliberately preventing that act of understanding from disturbing the worker.**

I think that is the real product idea here. `/bro file`, `/bro url`, model selection, diagrams, etc. are useful features, but **context-isolated human comprehension** is the core abstraction.

And `/bro show` is pushing it further: Bro is evolving from a plain-language translator into a **read-only observer interface over an agent session**—one that can turn the messy history of agent activity into the conceptual structure the human actually cares about. memcite

## User

I am a developer. In my daily working, i receive a large-scope ticket, I ask my agent to gather context on the ticket, then I ask the agent to design solution which I review, then I ask the agent to create plan to implement, then I ask it to implement and steer it as the implementation occurs, then review, test, e2e, PR, fix, and merge... full feature development cycle.

pi-bro has been helpful in understanding the responses, but sometimes I have trouble keeping track of the what, where, when, how, why and different minor decisions along the way. this is because I am expected to work on multiple tickets and concerns in parallel, and context switching is cognitively demanding.

do you understand the situation i am in? tell me, do you have a solution design for something sidecar like pi-bro that can assist me with my troubles?

## Assistant

Yes. Your problem is not “the agent’s replies are too complex.” `pi-bro` already helps there.

Your harder problem is longitudinal: one ticket generates dozens of small facts, decisions, file changes, rejected options, test results, and steering corrections. When you switch tickets, the cost is reconstructing that state in your head.

## Assistant

I think the right solution is a sibling to `pi-bro`, not an expansion of Bro.

`pi-bro` answers:

> “What does this thing mean?”

The new sidecar should answer:

> “What has happened on this ticket, what is true now, and why did we get here?”

I would design it as a ticket-centric development memory sidecar. Working name: `pi-thread`.

The central object is not the chat session. It is the ticket.

```text
                    ticket ABC-123
                         │
          ┌──────────────┼──────────────┐
          │              │              │
      Session 1       Session 2      Session 3
      discovery       implement       review
          │              │              │
          └─────── pi-thread observes ──┘
                         │
                         ▼
                  durable ticket state

              what changed?
              where?
              why?
              what was decided?
              what's unresolved?
              what was tested?
              what happens next?
```

That distinction matters because Pi sessions are temporary working contexts. Your unit of work survives them.

The primary UX should be `/thread`.

After being away from a ticket for half a day, you type:

```text
/thread
```

and get something like:

```text
ABC-123 · Add organisation-level API keys

Stage
Implementation — authentication path complete, UI pending.

Goal
Allow an organisation admin to create and revoke API keys.

Current design
API keys belong to Organisation, not User.
Keys are hashed before persistence.
Only the prefix is retained for identification.

Important decisions
✓ Use existing PermissionService rather than new API-key roles.
✓ Revocation is immediate; no grace period.
↻ Originally planned one key/org. Changed to multiple keys after review.

Changed so far
src/auth/api-keys.ts
src/models/organisation.ts
src/routes/api-keys.ts

Open
• Decide whether creation belongs in Settings or Developer page.
• E2E test for revoked-key requests still missing.

Last thing that happened
Unit tests passed after fixing key-prefix collision handling.

Next
Implement management UI.
```

That is the “I just switched back to this ticket; restore my brain” view.

But underneath it I would preserve much richer information.

The sidecar should explicitly model your six questions:

| Question | Sidecar knows |
|---|---|
| What? | requirement, current behaviour, changes, outstanding work |
| Where? | repository, files, symbols, endpoints, components |
| When? | chronological timeline and checkpoints |
| How? | accepted design, plan, implementation approach |
| Why? | decisions, rationale, rejected alternatives |
| What now? | current stage, blockers, next actions |

“Why” is especially important. Ordinary summaries destroy causality.

Suppose you ask three hours later:

```text
/thread why Organisation owns API keys
```

It should answer:

```text
Organisation owns API keys because the ticket requires keys to survive
individual user removal.

History

1. Initial design attached keys to User.
2. You raised the service-account case during design review.
3. Agent proposed Organisation ownership.
4. You accepted it.
5. Data model and auth middleware were changed accordingly.

Superseded:
User → ApiKey

Current:
Organisation → ApiKey[]
```

That isn't a summary. It is a rationale chain.

And every statement should be traceable back to a session turn, tool result, diff, commit, or explicit user decision.

That gives us an important architecture rule:

> Never store only summaries.

I would use an append-only evidence log plus a derived ticket state.

```text
raw evidence
────────────────────────

user steering
agent responses
tool calls/results
git diffs
test results
commits
PR events
review comments
        │
        ▼
sidecar interpretation
        │
        ├── decisions
        ├── questions
        ├── requirements
        ├── artifacts
        ├── changes
        ├── validations
        ├── stages
        └── checkpoints
        │
        ▼
current ticket projection
```

That solves a major problem with agent-generated memory: summaries become stale or subtly wrong.

If the sidecar says:

> “We chose Redis because X.”

you should be able to inspect the evidence behind that conclusion.

I would give decisions first-class status rather than burying them inside prose:

```text
D17
Use optimistic locking for updates.

Status
accepted

Why
Concurrent edits must not silently overwrite each other.

Alternatives
- last-write-wins — rejected
- database locks — rejected as unnecessary

Proposed by
agent

Accepted by
user

Affected
src/services/document.ts
src/repositories/document.ts

Supersedes
D09
```

Minor decisions are exactly the things humans forget during context switches.

They should therefore be cheap to capture.

The ticket should also have an inferred development lifecycle:

```text
context
   ↓
design
   ↓
plan
   ↓
implementation
   ↓
review
   ↓
test / E2E
   ↓
PR
   ↓
fix
   ↓
merge
```

But I would not make this a rigid state machine. Real development jumps around:

```text
implementation
      ↓
    review
      ↓
 design correction
      ↓
implementation
```

So `stage` is a current orientation signal, while the event history remains authoritative.

There are a few commands I think would cover most real use:

```text
/thread
/thread why <thing>
/thread where <thing>
/thread decisions
/thread open
/thread changes
/thread tests
/thread timeline
/thread since <checkpoint>
/thread switch ABC-456
```

I would avoid creating twenty specialized commands. `/thread` should handle 80% of use.

A particularly useful one would be:

```text
/thread since
```

Imagine returning after another agent has done 40 minutes of implementation:

```text
Since you last checked:

Changed
• API-key creation endpoint implemented.
• Key hashing moved into ApiKeyService.
• Migration added.

Decisions
• Switched SHA-256 → HMAC-SHA256.
  Reason: keys have low enough entropy that plain hashes were considered
  unnecessarily exposed.

Problems encountered
• Migration initially broke SQLite tests.
• Fixed by removing Postgres-specific DEFAULT syntax.

Tests
42 passed
1 E2E still missing.

Needs you
Placement of API-key management UI.
```

That would significantly reduce steering overhead.

There is another capability I would consider essential: checkpoints.

When you approve the design:

```text
/thread checkpoint design-approved
```

or ideally the sidecar observes:

> “Approved. Implement this.”

and proposes/inferentially records the checkpoint.

Then later:

```text
/thread since design-approved
```

becomes extremely useful.

For the agent experience, I would preserve the same principle that makes `pi-bro` good:

> The working agent should not automatically consume the sidecar.

The architecture would be:

```text
                         ┌─────────────┐
                         │   human     │
                         └──────┬──────┘
                    steering    │    inspection
                               │
                 ┌─────────────┴──────────────┐
                 ▼                            ▼
          Pi working agent               pi-thread
                 │                      observer agent
                 │                            │
           repo + tools                 read-only evidence
                 │                            │
                 ▼                            ▼
              work                       ticket memory
```

Pi keeps working naturally.

`pi-thread` watches.

No ticket-history sludge gets injected into Pi's context every turn.

But I would add one explicit escape hatch:

```text
/thread resume
```

This produces a compact machine-oriented handoff:

```text
Ticket ABC-123

Objective: ...
Accepted requirements: ...
Current design: ...
Important decisions: ...
Implemented: ...
Outstanding: ...
Known failures: ...
Relevant files: ...
```

You can then explicitly inject that into the working agent when starting a fresh session.

So:

```text
sidecar → main-agent context
```

only happens when you ask for it.

That is much safer than making the memory layer invisible agent memory.

There is also a nice relationship with `pi-bro`.

I would keep them separate:

```text
                 human cognition
                       │
          ┌────────────┴────────────┐
          │                         │
       pi-bro                   pi-thread
          │                         │
“What does this mean?”     “How did we get here?”
          │                         │
 local comprehension        longitudinal memory
```

But they can cooperate.

From a `/thread why ...` result, pressing `B` could open that explanation through Bro.

Or Bro could show:

```text
T   show this item's ticket history
```

without merging the packages internally.

That keeps the separation of concerns clean.

For an MVP, I would keep storage boring:

```text
~/.pi/thread/
    repos/
      <repo-id>/
        tickets/
          ABC-123/
            events.jsonl
            state.json
```

No server. No embeddings. No graph database.

`events.jsonl` is the durable evidence ledger.

`state.json` is a regenerable projection for fast UI.

The observer model only receives:

```text
previous ticket state
+
new session events
```

and returns structured patches such as:

```text
new decision
decision superseded
requirement discovered
file touched
question opened
question resolved
test passed
stage changed
```

That also makes processing cheap and bounded instead of repeatedly summarizing an entire development history.

My strongest design rule would be:

> `pi-thread` is not another project-management system.

Jira already knows that ABC-123 is “In Progress.”

Git knows which commits changed.

GitHub knows the PR.

Pi knows the current conversation.

What is missing is the **human cognitive continuity between those systems**:

```text
why are we doing this?
what did we decide?
where did we change it?
what assumptions are currently true?
what went wrong?
what remains uncertain?
what do I need to remember before I continue?
```

That is the product.

So I see `pi-bro` and this proposed sidecar addressing two different forms of cognitive load:

```text
pi-bro
complexity → understanding

pi-thread
fragmentation → continuity
```

Given the workflow you described, I think the second problem is probably now more costly to you than the first. memcite

## User

1) so, this is a record-based thread/session-bound memory sidecar, right? I like the idea.

2) I like how this ideas assumes 1 thread/session ~ 1 ticket/scope. this is elegant, but it risks not generalisable to non-ticket way of workings. all is well if I ask the session to look into a ticket; but what if the session scope must be implied? what is scope gets changed mid-session?

3) if 1 scope can span many sessions, this would be amazing; but how does the extension tell if a particular session belongs to a scope?

4) in capturing the state of a scope/ticket, what is the data model? how do you handle changing staging, goals long term and short term. It feels like we're designing a project memory layer here. I'm not complaining - I find it very fascinating. I'm wondering how we can avoid reinventing a very rich and popular wheel here.

5) I am not entirely clear on the suite of commands. every pi-bro command serves an important user need. I'd like for you to design the commands from the user needs and intent angle.
---

let's elaborate and provide better designs for the above before we can proceed further.

## Assistant

Yes. I’d change one foundational assumption before we go further:

**Session is not the memory unit. Scope is.**  
A Pi session is only one source of evidence about a scope.

That lets us keep the elegant “one session usually follows one scope” happy path without making it a hard constraint.

## Assistant

The existing patterns point to a cleaner architecture than “invent a project-management database.” We can borrow three proven ideas: an append-only history with derived views, ADR-style immutable/superseding decisions, and trace-style correlation where one execution can link to several larger contexts. 

The important move is to keep Jira/Git/GitHub as facts about work, while this sidecar owns only the missing **continuity and rationale layer**.

## Assistant

Yes. I think we now have a better abstraction than the first design.

The correction is:

> **Record-based, thread-centric, session-aware — not session-bound.**

A **thread** is the durable scope of work. A Pi **session** is merely one place where evidence about that thread was produced. A session can contribute to several threads, and a thread can span many sessions.

That changes quite a lot.

## 1. What exactly is the memory unit?

I would define four primitives:

```text
Thread
  durable scope of work
  "ABC-123", "investigate flaky CI", "redesign auth", etc.

Session
  one Pi conversation

Segment
  a contiguous portion of a session associated with a thread

Record
  something that happened or became known
```

So the normal case stays beautifully simple:

```text
Thread ABC-123
└── Session A
    └── Segment 1 ─────────────── entire session
```

But we're no longer trapped by it.

A thread can span sessions:

```text
Thread ABC-123
├── Session A / Segment 1    discovery
├── Session B / Segment 1    design
├── Session C / Segment 1    implementation
└── Session F / Segment 2    PR fixes
```

And a session can change scope:

```text
Session C

turn 1 ───────── turn 35
    Thread ABC-123

turn 36 ── turn 48
    Flaky-CI investigation

turn 49 ───────── turn 80
    Thread ABC-123
```

This many-to-many relationship is what I think we actually need.

The term **thread** now makes more sense too: it is the continuous conceptual thread running through discontinuous sessions.

---

# 2. Scope should often be implied

I agree that forcing:

```text
/thread focus ABC-123
```

at the beginning of every session would make the design much less interesting.

The sidecar should infer scope, but inference needs to be treated carefully.

I would use a hierarchy of evidence.

```text
strong
│
│ explicit ticket / issue / PR URL
│ explicit "continue ABC-123"
│ git branch associated with known thread
│
│ current session explicitly bound by user
│
│ same repo + same branch + continuation language
│ same files / symbols / goals
│ semantic continuity with recent thread
│
weak
```

Importantly, this isn't merely an embedding search.

Suppose a new session starts with:

> Continue fixing the API-key E2E failures.

And the environment says:

```text
repo: backend
branch: feature/ABC-123-org-api-keys
```

while thread `ABC-123` currently says:

```text
Open:
E2E revoked-key test failing
```

That is extremely strong correlation even though the ticket number wasn't in the prompt.

The thread registry would therefore maintain **aliases and anchors**:

```text
ABC-123
─────────────────────────
aliases
  ABC-123
  org API keys

anchors
  issue #438
  branch feature/ABC-123-org-api-keys
  PR #552

repo
  backend

artifacts
  src/auth/api-keys.ts
  ...
```

Those anchors make cross-session association much more reliable than semantic similarity alone.

There should also be an important safety rule:

> **Uncertainty does not create facts.**

If a session might belong to A or B, we don't silently choose.

We can leave its records temporarily:

```text
scope: unbound
candidates:
  ABC-123   .61
  AUTH-19   .48
```

and surface that uncertainty when you inspect Thread.

That is much better than corrupting long-term memory.

---

# 3. How does it know a session belongs to a thread?

More precisely, it doesn't need to decide that a whole session belongs to anything.

It assigns **segments and records**.

Imagine this session:

```text
You:
Let's finish the API key management UI.

              ↓

ABC-123 segment begins

              ...

You:
Separate concern: why has CI become so slow lately?

              ↓

candidate scope change detected

              ...

You:
Okay, leave that. Back to API keys.

              ↓

ABC-123 segment resumes
```

Internally:

```text
Session S17

Segment A
turns 1–22
→ ABC-123

Segment B
turns 23–37
→ CI performance investigation

Segment C
turns 38–61
→ ABC-123
```

There can even be secondary links.

For example:

```text
Decision:
Move auth middleware into shared package.

primary scope:
ABC-123

also affects:
AUTH-architecture
```

This resembles how distributed tracing separates execution units while allowing correlation and links between them. OpenTelemetry uses propagated context and span links for related work that crosses boundaries; I think that is a useful conceptual pattern here, without adopting OpenTelemetry itself.  ([OpenTelemetry](https://opentelemetry.io/docs/concepts/context-propagation/?utm_source=chatgpt.com))

### Scope changes should therefore be boundaries, not renames

This matters.

Suppose your original goal was:

```text
Investigate slow login
```

Halfway through:

```text
We found the cause.
Let's implement the proxy fix too.
```

We shouldn't rewrite history and pretend the thread was always:

```text
Fix login proxy handling
```

Instead:

```text
Thread: Login production failure

Goal evolution

G1 Investigate why login doesn't persist
   ✓ resolved

        ↓ finding

G2 Correct proxy/session handling
   active
```

The memory keeps the transition.

That's exactly the information you need later.

---

# 4. The data model: project memory, but deliberately narrow

Yes: we are approaching a project memory layer.

I don't think that's a problem.

The mistake would be attempting to make it a **project management system**.

We should borrow existing ideas rather than inventing another Jira/Linear/Notion.

Three patterns are especially useful.

Event sourcing gives us the idea of retaining an append-only sequence of meaningful changes and deriving current views from it. Microsoft explicitly describes keeping the event history as the authoritative source and building materialized read views from it. It also warns that full event sourcing adds substantial complexity. We should borrow the small useful part, not implement an enterprise event-sourcing architecture.  ([Microsoft Learn](https://learn.microsoft.com/uk-ua/azure/architecture/patterns/event-sourcing?utm_source=chatgpt.com))

ADRs give us the right semantics for decisions: context, decision, consequences, and importantly **supersession rather than rewriting the old decision**.  ([AWS Documentation](https://docs.aws.amazon.com/prescriptive-guidance/latest/architectural-decision-records/introduction.html?utm_source=chatgpt.com))

And trace-style context gives us the model for associating distributed pieces of activity with longer-lived logical work.

So I would make the underlying model:

```text
                THREAD
                   │
       ┌───────────┼─────────────┐
       │           │             │
     Records    Memory items   References
       │           │             │
       │           │             ├── Jira issue
       │           │             ├── Git branch
       │           │             ├── Git commits
       │           │             └── GitHub PR
       │           │
       │           ├── goals
       │           ├── decisions
       │           ├── questions
       │           ├── constraints
       │           ├── assumptions
       │           ├── changes
       │           ├── validations
       │           └── checkpoints
       │
       └── evidence from sessions
```

There are two crucial layers.

### Layer A — records: what actually happened

These are immutable observations.

Conceptually:

```typescript
Record {
  id
  timestamp

  session
  turn

  source
  // user | assistant | tool | git | github | ...

  evidence

  threadLinks[]
}
```

Examples:

```text
User accepted design.
Agent edited auth.ts.
Test foo.e2e.ts failed.
User asked to abandon Redis approach.
Commit 72af19 created.
PR #382 received review comment.
```

These are the audit trail.

### Layer B — memory items: what those records mean

Example:

```typescript
MemoryItem {
  type

  statement
  status

  evidence[]

  supersedes[]
  relatedTo[]

  confidence
}
```

Types should stay small:

| Type | Meaning |
|---|---|
| `goal` | something we're trying to achieve |
| `decision` | a choice that was made |
| `constraint` | something the solution must respect |
| `assumption` | something currently believed but not guaranteed |
| `question` | unresolved or resolved uncertainty |
| `change` | meaningful implementation change |
| `validation` | test/review/evidence about correctness |
| `artifact` | important file, component, PR, commit, etc. |
| `checkpoint` | a meaningful known-good point |

I would resist adding much more until usage forces us to.

---

## Goals need hierarchy and history

I don't think we need separate data models for “long-term goal” and “short-term goal.”

A goal can have a parent.

```text
G1 Deliver organisation API keys
│
├── G2 Design ownership model
│   ✓ done
│
├── G3 Implement backend
│   ✓ done
│
├── G4 Implement management UI
│   active
│
└── G5 Validate end-to-end
    waiting
```

And a goal may change:

```text
G3a
Implement one API key per organisation
SUPERSEDED

       ↓

G3b
Support multiple keys per organisation
CURRENT
```

Nothing is overwritten.

That gives `/thread why multiple keys?` something real to work with.

---

## I would remove `stage` from the core state

This is one place where my previous design was too simplistic.

Software development isn't:

```text
design → implementation → testing
```

It's:

```text
design
  ↓
implementation
  ↓
test
  ↓
oops
  ↓
design
  ↓
implementation
  ↓
review
  ↓
implementation
```

Therefore stage should be a **derived orientation**, not an authoritative enum.

The records might say:

```text
design_accepted
implementation_started
validation_failed
design_reopened
implementation_changed
validation_passed
```

Then `/thread` can derive:

```text
Current activity
Implementation

Also active
Revisiting one design assumption after E2E failure.
```

Much more truthful.

---

# 5. What we should NOT build

This boundary is important.

`pi-thread` should not own:

| Existing concern | Source of truth |
|---|---|
| Ticket description/status | Jira / Linear / GitHub |
| Source code | Git |
| Commit history | Git |
| PR state | GitHub |
| CI results | CI system |
| Documentation | repo / docs system |
| Agent conversation | Pi |
| Project planning | existing PM tool |

It references these things.

Its unique responsibility is:

> **Preserve how the work evolved and reconstruct the developer's working mental model.**

So instead of copying:

```text
Jira:
Status = In Progress
Assignee = David
Priority = P1
```

we care about:

```text
Current intent
Get revoked-key E2E working.

Why we're here
The initial auth design assumed the key lookup
could happen after user resolution. E2E proved
machine credentials have no User.

Decision
Move API-key resolution before User resolution.

Affected
AuthMiddleware
ApiKeyService

Still uncertain
Whether audit attribution needs synthetic users.
```

That information usually exists nowhere.

That is the hole we're filling.

---

# 6. Designing commands from actual user needs

I agree with your criticism of my previous command list. It was feature-shaped rather than need-shaped.

I think the command surface should be substantially smaller.

Here's the mapping I would start from:

| Developer need | Interaction | Meaning |
|---|---|---|
| “I just came back. Restore my brain.” | `/thread` | Current mental model of this thread |
| “Which thing am I working on?” / “Change scope.” | `/thread focus [scope]` | Inspect or explicitly establish thread association from here |
| “I've been hopping around. What threads exist?” | `/thread scopes` | Recent/active threads and their current state |
| “What happened while I wasn't paying attention?” | `/thread since [point]` | Delta from checkpoint/session/time/last inspection |
| “Why is this like this?” | `/thread why <thing>` | Rationale and decision chain |
| “How did this arrive at its current state?” | `/thread history <thing>` | Evolution, including superseded states |
| “What do I need to deal with?” | `/thread next` | Open questions, failures, blockers, pending goals, user decisions |
| “This is a meaningful known state.” | `/thread checkpoint [name]` | Mark a human-recognisable reference point |
| “Give a fresh agent what it needs to continue.” | `/thread handoff` | Produce a compact working-context package |

And then one important escape hatch:

```text
/thread <ordinary question>
```

For example:

```text
/thread where is token validation done?
/thread what have we changed in the database?
/thread did we ever discuss caching?
/thread which tests cover revocation?
/thread what did I tell the agent not to do?
```

I do **not** want:

```text
/thread files
/thread tests
/thread blockers
/thread requirements
/thread assumptions
/thread artifacts
...
```

That exposes our internal ontology to the user.

The developer should ask a question.

The sidecar should know how its memory is structured.

---

## `focus` has a special role

Most thread detection should be automatic.

So this:

```text
/thread focus
```

would show:

```text
Current
ABC-123 · Organisation API keys

Basis
✓ branch feature/ABC-123-api-keys
✓ session goal matches current thread
✓ 7 touched artifacts overlap

Association
high confidence
```

You use:

```text
/thread focus CI-performance
```

when you deliberately switch.

From that point onward it creates a new session segment.

And if the system inferred incorrectly:

```text
/thread focus ABC-123
```

corrects the association.

We can record that correction rather than mutate old evidence invisibly.

---

# 7. The actual `/thread` home view

This deserves careful design because it will probably account for most usage.

It should answer six things, consistently:

```text
ABC-123 · Organisation API keys

WHY
Enable machine access at organisation level.

NOW
Fix revoked-key E2E behaviour.

TRUE NOW
• Keys belong to Organisation.
• Stored secrets use HMAC-SHA256.
• Revocation is immediate.
• Authentication happens before User resolution.

CHANGED RECENTLY
• AuthMiddleware reordered.
• ApiKeyService now resolves organisation directly.
• 3 unit tests added.

OPEN
• Revoked-key E2E still failing.
• Audit attribution unresolved.

NEXT
Resolve E2E failure, then review audit attribution.

LAST CHECKPOINT
backend-design-approved · yesterday 16:42
```

That is not a project report.

It is a **working-memory restoration surface**.

There can then be drill-down:

```text
why
history
evidence
goals
```

without dumping them all every time.

---

# 8. The architecture I now favour

Putting it all together:

```text
                        PI
                         │
           session events / tools / git
                         │
                         ▼
                  ┌──────────────┐
                  │  Recorder    │
                  └──────┬───────┘
                         │ immutable
                         ▼
                  ┌──────────────┐
                  │ Evidence log │
                  └──────┬───────┘
                         │
               interpret / correlate
                         │
              ┌──────────┴───────────┐
              ▼                      ▼
       Scope association        Memory projection
              │                      │
      session ↔ segments       goals / decisions
            ↕                 questions / changes
          threads             validations / etc.
              │                      │
              └──────────┬───────────┘
                         ▼
                    `/thread`
                         │
                         ▼
                       human
```

The append-only idea gives us historical integrity; derived projections give us fast “what is true now?” views. That's exactly the useful portion of event sourcing, while avoiding the complexity of turning the whole extension into an event-sourced enterprise application.  ([Microsoft Learn](https://learn.microsoft.com/uk-ua/azure/architecture/patterns/event-sourcing?utm_source=chatgpt.com))

Storage-wise, I've changed my mind from the earlier JSON-file suggestion.

For this design I would probably use one boring local **SQLite database**.

Once we have:

```text
thread ↔ segment
segment ↔ records
records ↔ memory
memory ↔ memory
threads ↔ threads
```

JSON files start becoming the database we pretend we're not building.

SQLite gives us transactions, indexes, joins, migrations, and easy portability without introducing a server or a graph database.

---

## One final conceptual distinction

I think this is where the product becomes genuinely interesting.

There are really three kinds of memory:

```text
Agent context
"What does Pi need right now to perform?"

        versus

Project records
"What objectively happened?"

        versus

Developer working memory
"What do I need to know to understand
where we are and continue effectively?"
```

Git/Jira/GitHub cover much of the second.

Pi's context covers the first.

Almost nothing explicitly manages the third.

**That third layer is what we're designing.**

So I would resist calling this merely “agent memory.” It is closer to a **developer continuity layer**, built from agent activity.

And I think that framing gives us a very useful test for every future feature:

> Does this help David reconstruct the mental state required to resume, understand, steer, or judge a piece of work?

If not, it probably doesn't belong in `pi-thread`. memcite

## User

I am a developer. In my daily working, i receive a large-scope ticket, I ask my agent to gather context on the ticket, then I ask the agent to design solution which I review, then I ask the agent to create plan to implement, then I ask it to implement and steer it as the implementation occurs, then review, test, e2e, PR, fix, and merge... full feature development cycle.

pi-bro has been helpful in understanding the responses, but sometimes I have trouble keeping track of the what, where, when, how, why and different minor decisions along the way. this is because I am expected to work on multiple tickets and concerns in parallel, and context switching is cognitively demanding.

do you understand the situation i am in? tell me, do you have a solution design for something sidecar like pi-bro that can assist me with my troubles?

an agent suggests a thread-based working memory modal sidecar that:
-index the thread so far when called based on a domain-aligned data model (start with software feature development). option to re-index context wholesale or past-n-turns; option to update index with past-n-turns.
-view/download/edit the indexed memory (raw and as digestible non-brain-taxing simpleton-proof visual diagrams and explanations)
-ask natural questions against the indexed memory for drill-down or understanding
-request a steering prompt that can be copied to main context
The guiding question to ask here is: does it help the user reconstruct the mental state required to resume, understand, steer, or judge a piece of work?

## Assistant

Yes. I think this gets much closer to the shape of your actual problem.

What you’re struggling with isn’t just “understanding what the agent said.” It’s reconstructing the working mental model after that model has been scattered across a long feature cycle and then interrupted by other tickets.

You’re effectively trying to recover:

```text id="1h41wo"
ticket context
   ↓
findings
   ↓
design choices
   ↓
your corrections
   ↓
implementation decisions
   ↓
unexpected failures
   ↓
revised decisions
   ↓
tests
   ↓
PR feedback
   ↓
more fixes
```

Pi still has the transcript. Git has the code. Jira has the ticket. But after you switch away for a few hours, none of those puts your head back where it was.

That’s why I like the thread-based sidecar proposal. I’d frame it like this:

> **A read-only working-memory sidecar that turns a Pi thread into a structured, inspectable, editable model of the work.**

And I’d keep your guiding question as the design filter for everything:

> Does this help the user reconstruct the mental state required to resume, understand, steer, or judge the work?

## 1. Start thread-local, but don’t make “thread” mean “ticket”

For v1, I would intentionally avoid solving ticket identity, cross-session association, Jira integration, project graphs, and similar concerns.

The current Pi thread is just the source material:

```text id="evzfad"
Pi thread
   │
   │ index
   ▼
Working Memory
```

The important part is that the memory itself can represent more than one concern:

```text id="8hehk4"
Current thread

Primary concern
ABC-123 · Organisation API keys

Secondary concern
CI slowdown investigation

Incidental
Refactoring AuthService while implementing ABC-123
```

That means a mid-session scope change doesn’t break the system. The indexer can simply recognize different stretches of work:

```text id="xkndwj"
turns 1–45     organisation API keys
turns 46–61    CI investigation
turns 62–110   organisation API keys
```

You shouldn’t have to manage those segments manually unless the model gets the association wrong.

This gives you a much cleaner MVP now, while still leaving room for this later:

```text id="qkt8p7"
Thread memory A ─┐
Thread memory B ─┼──► Scope memory ABC-123
Thread memory C ─┘
```

So we can start small without locking the design into “one session = one ticket.”

---

# 2. The memory should use a software-development ontology

I would not let the model maintain one large rolling summary.

That sounds simple, but it’s exactly where minor decisions, abandoned assumptions, and changing goals get flattened away.

Instead, index the conversation into a small, explicit software-development model:

```text id="cxzk0n"
WorkingMemory
│
├── identity
│   ├── repo
│   ├── branch
│   ├── ticket / PR references
│   └── concerns
│
├── goals
│   ├── overall objective
│   ├── sub-goals
│   └── current focus
│
├── understanding
│   ├── findings
│   ├── requirements
│   ├── constraints
│   └── assumptions
│
├── decisions
│   ├── accepted
│   ├── rejected
│   └── superseded
│
├── implementation
│   ├── relevant artifacts
│   ├── changes made
│   └── implementation state
│
├── validation
│   ├── reviews
│   ├── tests
│   ├── E2E
│   └── known failures
│
├── open loops
│   ├── questions
│   ├── blockers
│   ├── TODOs
│   └── things needing user judgement
│
└── history
    ├── significant events
    └── checkpoints
```

Every item should carry provenance.

For example:

```text id="6o2syq"
D12 · ACCEPTED DECISION

API keys belong to Organisation rather than User.

Why
Machine credentials must survive removal of the user
who originally created them.

Supersedes
D04 · User owns ApiKey

Evidence
session turn 38
session turn 41
```

Or:

```text id="b34eti"
A07 · ASSUMPTION

Revocation should take effect immediately.

Status
confirmed

Confirmed by
user at turn 67
```

That distinction between `decision`, `assumption`, `finding`, `constraint`, and so on matters. It gives the memory enough structure to answer “why?” later instead of just repeating prose.

---

# 3. Don’t make “stage” one mutable field

I think this is important for your workflow.

A feature rarely moves cleanly like this:

```text id="aysfmj"
design → implementation → test → PR
```

In practice, you get this:

```text id="e8478h"
design
  ↓
implementation
  ↓
E2E fails
  ↓
design reconsidered
  ↓
implementation
  ↓
review
  ↓
more implementation
```

So I’d model activities and current focus rather than one authoritative stage.

The sidecar can then render something like:

```text id="dohoax"
Current focus
Fixing E2E behaviour

Feature status

Context       ✓ sufficiently understood
Design        ✓ accepted, one assumption reopened
Implementation ● active
Unit tests    ✓ passing
E2E           ● failing
Review        ○ pending
PR            ○ pending
```

That tells you far more than:

```text id="9386oz"
Stage: Implementation
```

Goals can work the same way:

```text id="9kxkaz"
Deliver organisation API keys
│
├── Understand existing authentication
│   ✓
│
├── Agree ownership model
│   ✓
│
├── Implement backend
│   ✓
│
├── Fix revoked-key behaviour
│   ●
│
└── Ship management UI
    ○
```

Your short-term focus can move around while the long-term objective remains stable.

---

# 4. Keep evidence separate from interpretation

I would be quite strict about this.

The sidecar should never contain only:

```text id="gp55q7"
memory.json
```

where that file is simply the latest LLM-generated interpretation of the thread.

Conceptually, there should be two layers:

```text id="2zqbl6"
THREAD
  │
  ├── evidence
  │     actual turns/tool results referenced
  │
  └── working model
        interpretation of that evidence
```

A memory item might look like:

```typescript id="jos291"
{
  id: "D12",
  type: "decision",
  text: "API keys belong to Organisation",
  status: "accepted",

  rationale: "...",

  sourceRefs: [
    "turn:38",
    "turn:41"
  ],

  related: ["G3", "A4"],
  supersedes: ["D04"],

  origin: "inferred",
  confidence: "high"
}
```

That gives you something very valuable: traceability.

When you ask:

```text id="2b5try"
Why did we decide this?
```

the sidecar can answer from actual remembered evidence instead of inventing a plausible-sounding rationale.

That matters especially when you’re using it to judge the work, not just remember it.

---

# 5. Make indexing predictable

Your proposed indexing controls are useful. I’d just make the normal path simpler than the advanced ones.

### First invocation

```text id="9670bz"
/thread
```

If no memory exists yet, it indexes the full current thread.

```text id="mwdb6f"
turn 1 ───────────────────── turn 137
            indexed
```

### Later invocation

Suppose the memory is indexed through turn 137 and the thread is now at turn 162.

Bare:

```text id="7o3fl8"
/thread
```

should process only:

```text id="8gv4la"
138 ───── 162
```

and update the existing memory.

That should be the happy path. You shouldn’t have to think about indexing mechanics every time you want to restore your context.

Then keep the explicit controls for repair and reconsideration:

```text id="tshyql"
/thread update 20
```

Reprocess the last 20 turns against the current memory.

Useful when something near the previous indexing boundary was misunderstood.

And:

```text id="vov3df"
/thread rebuild
```

Throw away the generated interpretation and rebuild from the full thread.

And:

```text id="hms7fo"
/thread rebuild 50
```

Build working memory from only the latest 50 turns.

That last one is more of an escape hatch for very long or badly drifted threads.

So the user-facing mental model stays simple:

```text id="batgbg"
/thread
    normal incremental refresh

/thread update N
    reconsider recent evidence

/thread rebuild
    reinterpret everything
```

---

# 6. Your edits must survive re-indexing

Once you allow editing, this becomes essential.

Suppose the memory currently says:

```text id="ma79kw"
Assumption:
Management UI belongs under Settings.
```

You correct it:

```text id="y6i357"
Decision:
Management UI belongs under Developer Tools.
User confirmed.
```

Then `/thread rebuild` must not casually wipe that out.

I’d separate:

```text id="8zr3jb"
model-derived memory
        +
user-curated overrides
        =
effective working memory
```

A manual edit changes provenance:

```text id="pe5k6r"
origin: inferred
```

to:

```text id="tr0kl0"
origin: user
locked: true
```

If future conversation evidence conflicts with that edit, the sidecar should surface the conflict instead of silently choosing:

```text id="lwohxb"
Possible conflict

User memory:
UI belongs under Developer Tools.

New conversation evidence:
Agent is implementing it under Settings.

[keep user memory]
[accept new state]
[inspect evidence]
```

That preserves your authority over the working model.

---

# 7. The modal should be the main product

I’d follow the same pattern that makes `pi-bro` pleasant: don’t turn this into a forest of slash commands.

Bare:

```text id="86591y"
/thread
```

should open the useful surface directly.

Something like:

```text id="2cspzf"
┌────────────────────────────────────────────────────────────┐
│ Thread · indexed through turn 162                          │
├────────────────────────────────────────────────────────────┤
│                                                            │
│ ABC-123 · Organisation API keys                            │
│                                                            │
│ NOW                                                        │
│ Fix revoked-key E2E behaviour.                             │
│                                                            │
│ WHY                                                        │
│ Machine clients need organisation credentials independent  │
│ of individual user accounts.                               │
│                                                            │
│ TRUE NOW                                                   │
│ • ApiKey belongs to Organisation.                          │
│ • Secrets are HMAC-SHA256 hashed.                          │
│ • Auth resolves API keys before User.                      │
│                                                            │
│ OPEN                                                       │
│ • Revoked-key E2E fails.                                   │
│ • Audit attribution remains undecided.                     │
│                                                            │
│ NEXT                                                       │
│ Trace revoked-key failure, then resolve audit ownership.   │
│                                                            │
├────────────────────────────────────────────────────────────┤
│ D decisions · M map · T timeline · A ask · S steer         │
│ R raw · E edit · X export · U update · Esc close           │
└────────────────────────────────────────────────────────────┘
```

The first screen should be built for the moment you return after working on two other things and need to answer:

> “Where was I, exactly?”

Not “show me everything the system knows.”

---

# 8. Each view should answer one cognitive question

I would avoid a general-purpose dashboard. The views should be shaped around how you actually think when resuming work.

`Resume` answers:

> What am I doing, why, what’s true, what’s unresolved, and what comes next?

`Decisions` answers:

> What choices did we make, and why?

```text id="8nv95b"
D04  User owns ApiKey
      ↓ superseded

D12  Organisation owns ApiKey
      because machine credentials must outlive users

D17  Immediate revocation
      accepted

D21  Shared ApiKeyService
      accepted after E2E failure
```

`Map` answers:

> Where is this work?

```text id="v045o5"
Organisation API keys

AuthMiddleware
├── resolves ApiKey
└── resolves User

ApiKeyService
├── lookup
├── verify
└── revoke

Database
└── organisation_api_keys

UI
└── not implemented
```

`Timeline` answers:

> How did we get here?

```text id="z4tc2a"
09:20  ticket investigated
09:48  initial ownership design proposed
10:03  user rejected User ownership
10:16  Organisation ownership accepted
11:02  backend implementation complete
11:31  tests passed
13:07  E2E exposed auth-order problem
13:24  design reopened
13:41  AuthMiddleware changed
```

`Validation` answers:

> How confident should I be that this works?

```text id="xnue5d"
Unit tests       42/42 ✓
Integration      8/8 ✓
E2E              5/6
                  └── revoked key ✗

Review           pending
PR               not created
```

I’d render as much of this as possible deterministically from the structured memory.

Use the model to extract and explain.

Use ordinary code to render the state.

That gives you a much more stable sidecar than asking the model to invent a fresh visualization each time.

---

# 9. Natural questions are where the structure really helps

Once the thread has been indexed, you can ask things like:

```text id="n609uj"
/thread ask why did we move validation before user lookup?
```

or more naturally:

```text id="uh2tl2"
/thread why did we move validation before user lookup?
```

and get a focused answer:

```text id="40a6s2"
The change came from the revoked-key E2E failure.

Originally:
API key lookup happened after User resolution.

Problem:
Machine credentials do not necessarily map to a User, so the
request could fail before the API key was checked.

Decision:
Resolve organisation API credentials first.

Evidence:
D21
turns 144–151
```

Other natural questions become straightforward:

```text id="mmy2lv"
/thread what database changes have we made?
/thread what did I reject?
/thread which decisions are still provisional?
/thread where does revocation happen?
/thread what remains before PR?
/thread when did we decide to support multiple keys?
/thread what assumptions have not been tested?
```

That is much more useful than searching the raw transcript.

---

# 10. Steering should be first-class

This is one of the strongest parts of the proposal.

There should be a deliberate asymmetry:

```text id="sgm3cb"
main context ─────► working memory
```

Indexing pulls from the main thread.

But the reverse:

```text id="z4jl43"
working memory ─────► main context
```

should happen only when you ask for it.

For example:

```text id="ityv4j"
/thread steer fix the remaining E2E
```

could produce:

```text id="irbv2g"
Continue work on the revoked API-key E2E failure.

Current relevant state:
- API keys belong to Organisation.
- API-key authentication happens before User resolution.
- Unit and integration tests pass.
- Only the revoked-key E2E remains failing.

Accepted constraints:
- Revocation must take effect immediately.
- Do not introduce synthetic User records merely for API-key auth.
- Preserve the existing PermissionService model.

Relevant implementation:
- AuthMiddleware
- ApiKeyService
- organisation_api_keys

Please investigate the failing E2E first. Do not redesign the
accepted ownership model unless the failure provides evidence that
it is incorrect. Explain any new design decision before implementing it.
```

Then:

```text id="uem1jz"
C copy
```

and you put it back into Pi.

I like this because the steering generator isn’t just “export memory.”

Its job is:

> **Select the smallest amount of remembered context needed for the next piece of work.**

That’s almost the inverse of indexing:

```text id="vmsn58"
thread
  ↓ compression
working memory
  ↓ selection
steering context
```

That’s a very clean loop.

---

# 11. Keep the command surface small

Following the `pi-bro` philosophy, I’d start with only these:

| Need | Command |
|---|---|
| Restore my mental state | `/thread` |
| Reopen without processing | `/thread open` |
| Force reconsideration of recent context | `/thread update [n]` |
| Start the interpretation again | `/thread rebuild [n]` |
| Ask about remembered work | `/thread <question>` |
| Prepare main-agent context | `/thread steer [intent]` |
| Diagnose configuration/index problems | `/thread doctor` |

I would **not** create:

```text id="1exdrc"
/thread decisions
/thread files
/thread tests
/thread goals
/thread blockers
/thread timeline
/thread export
/thread edit
```

as primary commands.

Those are navigation actions inside the modal, not separate user jobs.

That’s the same reason `pi-bro` uses keys for copy, retry, open, and scroll rather than exposing every modal operation as a command.

---

# 12. Raw, editable, downloadable

The structured index should absolutely be inspectable.

For v1, I’d keep the persistence very plain:

```text id="j2sx0z"
~/.pi/working-memory/<session-id>/
    memory.json
```

with a versioned schema.

Then the modal can expose:

```text id="3a2jr8"
R  raw
E  edit
X  export
```

And export can give you:

```text id="1qcwgw"
memory.json
memory.md
```

JSON for machines and debugging.

Markdown for humans, handoff, and archiving.

At this stage, I would not jump to SQLite. One thread owning one memory document is simple enough that JSON is probably the better first implementation. If cross-thread or cross-session scope memory becomes real later, that’s when a relational store may earn its keep.

---

# 13. I would postpone continuous indexing

This is one place where restraint will help.

I would **not** start with a daemon that continuously observes every turn and updates memory in the background.

It sounds convenient, but it introduces:

- invisible cost;
- constant interpretation churn;
- partially completed reasoning being mistaken for decisions;
- user steering getting indexed before its consequence is known;
- much harder lifecycle semantics.

On-demand consolidation is actually quite natural:

```text id="2l0smn"
work freely
   ↓
/thread
   ↓
consolidate what is currently known
```

You decide when the work has reached a point worth consolidating.

Later, if usage shows that manual refresh is annoying, you can experiment with:

```text id="zca60t"
auto-update on idle
auto-update every N turns
auto-update after commit
```

But I would want field evidence before adding that complexity.

---

# 14. The product boundary feels much clearer now

I’d draw it like this:

```text id="7zb58d"
                  pi-bro
                     │
          understand one source
                     │
                     ▼
                  HUMAN

PI THREAD ───► pi-working-memory
                     │
            understand continuity
                     │
                     ▼
                  HUMAN
                     │
              steering prompt
                     │
                     ▼
                     PI
```

This sidecar is not:

- Jira replacement;
- task manager;
- documentation system;
- autonomous project-memory daemon;
- agent long-term memory;
- repo knowledge graph.

It is:

> **A cognitive checkpoint and reconstruction layer over an agent thread.**

That narrower framing is what makes the proposal compelling to me.

And the four capabilities you listed fit together well:

1. **Index/update** the thread into a domain-aware working model.
2. **Inspect/edit/export** that model through low-cognitive-load representations.
3. **Interrogate** it naturally to recover details and rationale.
4. **Project** the relevant part back into a steering prompt when you want to continue work.

Together, those map directly to the four things you need after context switching:

```text id="r8iyg5"
resume
understand
judge
steer
```

That’s the product vocabulary I’d use from here on.

## User

Pi tree allows for time-traveling, and it’s a tremendously useful feature that users use a lot -> provenance based on turns will get stale.

I don’t like “Each view should answer one cognitive question”. Who are you to determine the cognitive questions? Too arbitrary. 
The summary screen is fine; but the other dimension-based screens is too much railroading. I might want to extend this for non-development scopes, and I don’t want to marry this UI layout.

What’s the command for editing exporting and inspecting indexed memory?

Is there a way to signal/steer the memory index process to set focus?

Agreed on this being a on-demand thing.

## Assistant

Agreed on both corrections. The design should be **branch-aware, not turn-number-aware**, and the UI should expose the memory model rather than hard-code my preferred ways of thinking about it.

I’d also separate two concepts that I blurred earlier: **scope** is what the memory is about; **focus** is what you want the next indexing pass to pay special attention to.

## Assistant

Yes. I’d revise the design in four important ways.

First, provenance must follow Pi’s tree, not transcript positions. Second, the UI should have one opinionated “restore my brain” summary, while everything beyond that stays generic and query-driven. Third, editing/export/inspection should be first-class commands. Fourth, indexing needs an explicit focus control that can be persistent or one-shot.

### 1. Provenance should be branch-aware

Turn numbers are the wrong identity.

If you time-travel from:

```text
A → B → C → D → E
```

back to `C` and continue:

```text
A → B → C → F → G
          \
           D → E
```

then “turn 17” is not a durable reference to anything meaningful.

The memory should reference stable Pi tree entries instead:

```typescript
EvidenceRef {
  sessionId
  entryId
  parentEntryId
  contentHash
}
```

Ideally `entryId` is whatever stable identity Pi exposes for session-tree entries. The content hash is a defensive check, not the primary identity.

More importantly, the memory projection should be relative to the **current Pi head**.

Suppose decision `D7` was made at node `E`. You time-travel to `C`. From that point, `D7` should no longer appear under “what is true now,” because from your present position in the tree it hasn't happened.

It isn't deleted either.

```text
Memory store

A ─ B ─ C ─ D ─ E
          \
           F ─ G
```

The store knows about evidence on both branches.

But while you're at `G`:

```text
current memory =
    common history A,B,C
  + branch F,G
```

Evidence from `D,E` is off-branch.

This gives us much better semantics for `/thread update`.

The extension remembers the previously indexed head. When invoked again, it compares that head with the current Pi head:

```text
old indexed head: E
current head:     G

lowest common ancestor: C

D,E  → leave current projection
F,G  → enter current projection
```

The indexer can reconsider only the affected region.

This also means time travel becomes a feature of the memory sidecar rather than something it merely survives:

> **The working-memory view time-travels with Pi.**

That feels right.

---

### 2. Agreed: no fixed “cognitive question” screens

I over-designed that.

A software-development memory schema does not imply a software-development dashboard.

Those should be separate layers:

```text
                generic sidecar
                     │
        ┌────────────┴────────────┐
        │                         │
   presentation                indexing
        │                         │
 summary / inspect / ask      domain profile
                                  │
                       software-feature-development
                       research
                       incident investigation
                       ...
```

The shell should know almost nothing about `decisions`, `tests`, `goals`, `files`, etc.

Those belong to the **index profile**.

For v1, the software-development profile might produce:

```text
goal
finding
requirement
constraint
assumption
decision
change
validation
question
artifact
...
```

But the generic sidecar sees only:

```typescript
MemoryItem {
  id
  type: string
  content
  attributes
  relations[]
  evidence[]
}
```

A future research profile could instead create:

```text
hypothesis
evidence
counterevidence
source
finding
open-question
```

without changing the modal architecture.

The only opinionated view I'd retain is the default summary because it solves the central product job:

> Help me regain enough mental state to continue.

Everything else should be exploratory.

You might ask:

```text
/thread why did this change?
/thread what did I disagree with?
/thread show me everything related to AuthMiddleware
/thread what happened after the first E2E failure?
/thread what's uncertain?
```

No need for us to predict in advance which dimensions deserve screens.

---

### 3. Inspect, edit and export should absolutely have commands

I would now make these explicit.

| Intent | Command |
|---|---|
| Refresh memory and show summary | `/thread` |
| Reopen without indexing | `/thread open` |
| Inspect indexed memory | `/thread inspect [query]` |
| Edit indexed memory | `/thread edit [item/query]` |
| Export memory | `/thread export [json\|md]` |
| Incrementally reconsider recent evidence | `/thread update [n]` |
| Rebuild from current lineage | `/thread rebuild [n]` |
| Set/show indexing focus | `/thread focus [instruction]` |
| Ask the memory | `/thread <question>` |
| Generate context for Pi | `/thread steer [intent]` |
| Diagnose setup/index | `/thread doctor` |

`inspect` is important because it differs from asking.

```text
/thread what did we decide about caching?
```

asks an LLM to answer using memory.

Whereas:

```text
/thread inspect caching
```

shows the actual indexed objects and their provenance.

Something like:

```text
3 matching items

D14 · decision
Do not cache mutable build artifacts.
evidence: session/S4/entry-a37...

F08 · finding
Cached dist/package.json caused module mismatch.
evidence: session/S4/entry-a18...

V06 · validation
Clean build succeeds after deleting dist.
evidence: session/S4/entry-a29...
```

So there is a useful distinction:

```text
ask      = interpret memory for me
inspect  = show me the memory itself
```

`edit` should edit the indexed model rather than the original evidence.

For example:

```text
/thread edit D14
```

or simply:

```text
/thread edit
```

to open the complete canonical memory document.

A user edit becomes authoritative metadata:

```text
origin: user
```

rather than silently pretending the indexer inferred it.

And `/thread export md` or `/thread export json` produces an external artifact without changing the index.

I would also expose Inspect/Edit/Export from the modal, but the commands should exist independently. You were right to call that gap out.

---

### 4. Focus should steer indexing directly

Definitely.

And I think this is different from scope.

Consider:

```text
Scope:
Implement ABC-123 organisation API keys

Focus:
Pay particular attention to security assumptions and decisions
I've explicitly approved or rejected.
```

Scope says:

> What body of work does this memory represent?

Focus says:

> While interpreting that work, what should you pay special attention to?

I would support both persistent and one-shot focus.

Persistent:

```text
/thread focus security assumptions, rejected approaches, and unresolved risks
```

From then on, future indexing passes receive that as an additional instruction.

Check it:

```text
/thread focus
```

Clear it:

```text
/thread focus clear
```

And a one-off index operation could override it:

```text
/thread update 30 --focus "pay attention to why the E2E strategy changed"
```

or:

```text
/thread rebuild --focus "reconstruct the implementation chronology carefully"
```

The one-shot focus would not replace the saved one unless explicitly requested.

Internally I would keep focus outside the model-generated memory:

```text
Memory
├── index profile
│   software-feature-development
│
├── user indexing directive
│   "Pay attention to ..."
│
├── indexed items
│   ...
│
└── provenance
```

That makes focus safe from re-indexing. The model doesn't get to rewrite its own instructions.

There is another useful form of steering too:

```text
/thread update --focus "The discussion around turns represented by these selected entries is important"
```

Eventually the modal could let you select some Pi-tree nodes or memory items and say:

> Re-index this part with emphasis on why the design changed.

That is probably more powerful than an ever-growing ontology.

---

### I’d also change `rebuild`

Given Pi's tree semantics, `/thread rebuild` should mean:

> Rebuild memory from the lineage ending at my **current Pi head**.

Not “scan every historical branch.”

So:

```text
/thread rebuild
```

at `G` indexes:

```text
A → B → C → F → G
```

not:

```text
A,B,C,D,E,F,G
```

There could eventually be an explicit whole-tree operation:

```text
/thread rebuild --tree
```

but I would not put it in the MVP unless we find a concrete use for cross-branch memory.

Otherwise abandoned futures could contaminate the mental model we're trying to reconstruct.

---

The design now feels cleaner to me:

```text
PI SESSION TREE
       │
       │ current lineage
       ▼
   on-demand indexer
       │
       │ + domain profile
       │ + optional user focus
       ▼
 STRUCTURED WORKING MEMORY
       │
       ├──── /thread        → resume
       ├──── inspect/edit   → manipulate
       ├──── ask            → understand
       ├──── export         → take elsewhere
       └──── steer          → return selected context to Pi
```

And the durable invariant becomes:

> **The raw Pi tree says what happened. The index says what it means. The current branch determines what is presently true. The user can always inspect and correct that interpretation.**

That handles time travel much better and leaves the sidecar generic enough to grow beyond software feature development.

## User

Provenance looks very complicated. Do you think the agent-experience and ergonomics degradation are worth it?

The first memory schema is on software development; there will be more.

Or, we can add a full data view to show everything (well formatted of course) in addition to the default summary view

The ask function should have option to show latest response alongside the question.

Make memory edit commands natural language based. “Actually, abc is not the goal here, XYZ is”.  This makes Memory inspect redundant be cause it is just regular ask questions.

I still think we’re not taking into account the agent experience nd ergonomics

## Assistant

Yes. I think I over-weighted auditability and under-weighted agent ergonomics.

The agent should not have to reason about Pi tree identity, provenance graphs, branch ancestry, or evidence pointers. The extension can handle most of that mechanically. The indexer should see a clean slice of current context and a clean memory model, then return simple memory updates.

## Assistant

Yes. I think the design gets better if we treat provenance as a support mechanism, not as part of the agent’s job.

The agent experience should be closer to:

```text
Here is the current memory.
Here is the new context.
Here is the indexing focus.
Update the memory.
```

Not:

```text
Understand Pi's tree.
Track entry IDs.
Maintain evidence graphs.
Reconcile ancestry.
Attach provenance to every claim.
```

That second version would make the indexer worse at its actual job.

The extension should absorb that complexity.

## 1. Make provenance coarse and mechanical

I would drop per-memory-item provenance as an MVP requirement.

Instead, every indexing operation creates a simple revision:

```text
Revision 17
source: current Pi lineage
range: new context since Revision 16
head: <opaque Pi entry id>
created: ...
```

The indexer doesn't need to know any of this.

It receives the extracted conversation text and returns:

```text
add goal ...
update decision ...
close question ...
replace assumption ...
```

The extension records:

```text
these changes came from Revision 17
```

That's enough for debugging and recovery.

If you time-travel, the extension detects that the current head is no longer descended from the previously indexed head. Then it can say:

```text
Thread memory is based on a different branch.

[R] rebuild from current branch
[K] keep existing memory
```

No ancestry explanation to the model. No branch graph in the prompt.

I think that's a much better trade-off.

And perhaps later we discover that provenance is rarely useful at all. Fine. It stays behind the curtain.

---

## 2. Agent experience should be designed explicitly

I now see four separate agent jobs.

```text
                    THREAD MEMORY
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
     INDEXER            ASK             EDITOR
        │                │                │
 update model       answer from       mutate model
 from context         memory        from user intent

                         │
                         ▼
                       STEER
                         │
                  create context
                  for working Pi
```

They should not share one giant prompt.

### Indexer

Input:

```text
domain schema
current memory
new Pi context
optional focus
```

Output:

```text
memory patch
```

That's it.

It doesn't answer the user.

It doesn't create diagrams.

It doesn't explain history.

It doesn't reason about storage.

### Ask agent

Input:

```text
current memory
user question
optional latest Pi response
```

Output:

```text
answer
```

### Editor

Input:

```text
current memory
user correction/instruction
```

Output:

```text
memory patch
```

For example:

```text
/thread edit Actually, ABC is not the goal here.
The real goal is XYZ.
```

The editor interprets that semantically and updates the relevant memory objects.

That's much better than:

```text
/thread edit G17
```

I agree with you there.

### Steering agent

Input:

```text
current memory
user's intended next action
```

Output:

```text
smallest useful steering prompt
```

Each role has a very narrow cognitive job.

That should improve reliability substantially.

---

# 3. Yes: add a generic full-data view

This solves the UI concern nicely.

I would now have only two built-in representations.

### Summary

The opinionated low-brain-tax view:

```text
What is this work about?
Where are we now?
What matters?
What remains?
```

Its exact shape can depend on the memory profile.

### Full memory

A well-formatted generic rendering of the complete indexed model.

For software development:

```text
GOALS

G1  Deliver organisation API keys
    status: active

G2  Implement backend
    parent: G1
    status: complete


DECISIONS

D1  Organisation owns API keys
    status: accepted
    rationale: ...

D2  Management UI belongs in Settings
    status: superseded
    replaced by: D7


ASSUMPTIONS

A1  Revocation should be immediate
    status: confirmed


QUESTIONS

Q1  How should audit attribution work?
    status: open


ARTIFACTS

AuthMiddleware
ApiKeyService
...
```

For a research-memory profile, the same full-data renderer might receive:

```text
hypotheses
observations
sources
counterarguments
findings
questions
```

No new UI design required.

The renderer should just understand generic:

```text
sections
items
fields
relationships
status
```

The profile determines the schema.

That gives us extensibility without making the interface shapeless.

---

# 4. Memory schemas should be plugins/profiles

Software feature development is profile one.

Conceptually:

```text
thread-memory core
│
├── storage
├── indexing lifecycle
├── summary modal
├── full-data renderer
├── ask
├── edit
├── export
└── steer

memory profile
│
├── schema
├── indexing instructions
├── summary instructions
└── steering hints
```

Then:

```text
profiles/
    software-development
    research
    incident
    product-discovery
    ...
```

The core should not know what a `decision`, `hypothesis`, or `experiment` is.

That's the profile's problem.

This is probably the cleanest way to prevent the first domain from becoming the architecture.

---

# 5. Ask should optionally include the latest Pi response

Agreed.

There are two subtly different needs.

```text
/thread ask Why are we doing this?
```

means:

> Answer from the indexed working memory.

Whereas:

```text
/thread ask --latest Why is the agent proposing this?
```

means:

> Answer using the memory plus the latest completed Pi response.

But I don't love the flag ergonomics either.

In the modal I'd make it simply:

```text
A  ask memory
L  include latest reply
```

So the Ask surface visibly says:

```text
Ask about this work

[x] Indexed memory
[ ] Latest Pi response

> Why does this new proposal contradict our earlier decision?
```

That's excellent for exactly your situation.

You read a complicated new agent answer and want to ask:

> How does this fit with everything we've decided so far?

Bro explains the answer itself.

Thread Memory explains the answer **in relation to accumulated work**.

That's an important distinction.

For slash-command users, we can still expose something compact like:

```text
/thread ask latest <question>
```

but I would optimize the modal first.

---

# 6. Natural-language memory editing makes Inspect mostly unnecessary

I agree.

There are really two actions:

```text
view the memory
change the memory
```

The full-data view handles inspection.

Natural language handles changes.

Examples:

```text
/thread edit Actually, supporting multiple organisations
is out of scope.
```

```text
/thread edit The Redis approach wasn't rejected.
We simply postponed that decision.
```

```text
/thread edit Mark the E2E issue as resolved.
```

```text
/thread edit We no longer care about backwards compatibility.
```

```text
/thread edit The main concern here is latency, not cost.
```

The editor should return a small confirmation:

```text
Updated memory

Constraint C4
- Backwards compatibility is required.
+ Backwards compatibility is no longer required.

Reason
User correction.
```

And because this is user-authored state, I'd give it higher authority than inferred memory.

If later indexing contradicts it, don't overwrite it casually.

Surface:

```text
New context conflicts with a user-edited memory item.
```

That is enough.

No complex provenance machinery required.

---

# 7. Focus should also be natural language

I would simplify this too.

```text
/thread focus
```

shows the current indexing guidance.

```text
/thread focus Pay special attention to architectural decisions,
things I disagree with, and unresolved security concerns.
```

sets it.

But I would also allow one-off steering naturally:

```text
/thread update 20 focusing on why the auth design changed
```

No need to make users learn `--focus`.

Likewise:

```text
/thread rebuild focusing on product requirements rather than implementation details
```

The parser can extract:

```text
operation: rebuild
window: all
focus: product requirements rather than implementation details
```

We're building an AI extension. We should use the AI where language interpretation is actually useful rather than forcing CLI grammar everywhere.

---

# 8. Revised command surface

I think it can become pleasantly small:

| Command | Human intent |
|---|---|
| `/thread` | Refresh if needed and restore my mental state |
| `/thread open` | Reopen without indexing |
| `/thread full` | Show the complete indexed memory |
| `/thread <question>` | Ask naturally about the memory |
| `/thread edit <instruction>` | Correct or reshape memory naturally |
| `/thread focus [instruction]` | See/set what indexing should emphasize |
| `/thread update [n] [natural focus]` | Re-index recent context |
| `/thread rebuild [n] [natural focus]` | Rebuild from current Pi lineage |
| `/thread export [md\|json]` | Export current memory |
| `/thread steer [intent]` | Generate a prompt for Pi |
| `/thread doctor` | Diagnose |

I'm deliberately removing `/inspect`.

`/thread full` is transparent inspection.

`/thread <question>` is semantic inspection.

Together they cover the real need.

---

# 9. The key AX principle

I think this should become a design invariant:

> **The memory agent should experience a document-maintenance problem, not a conversation-history problem.**

The extension turns messy Pi state into:

```text
CURRENT MEMORY

<structured document>


NEW MATERIAL

<clean conversation slice>


USER FOCUS

<optional text>
```

The indexer's entire job is:

> Update the structured document conservatively.

This keeps agent context compact and stable.

Likewise the editor experiences:

```text
CURRENT MEMORY

USER SAYS:
"Actually, X isn't the goal. Y is."
```

And changes the document.

The asker experiences:

```text
MEMORY

OPTIONAL LATEST RESPONSE

QUESTION
```

The steering agent experiences:

```text
MEMORY

NEXT INTENT
```

No one agent needs to understand the whole product.

That separation is probably as important as the UX.

---

And I think this leads to a better core loop:

```text
                 work in Pi
                     │
                     ▼
                 /thread
                     │
              on-demand indexing
                     │
                     ▼
             structured memory
              /             \
             /               \
       summary/full          ask/edit
             \               /
              \             /
                understand
                     │
                     ▼
               /thread steer
                     │
                     ▼
                  back to Pi
```

`pi-bro` reduces the complexity of **one thing you are looking at**.

This sidecar reduces the complexity of **everything you need to remember about the work**.

And the agent experience stays deliberately boring. That is a feature.

## User

we're defining the whereabout of destination for this pi plugin/extension/package.
how complete is our design for it so far?
what have we decided on? 
what else should we define or explore?
have we pin down the enough the vicinity towards which we'll be march towards?

## Assistant

Yes. We have pinned down the vicinity quite well. We have not yet pinned down the exact building.

I’d rate the design as:

- Product concept and boundary: strong.
- Core interaction model: strong.
- Agent experience: now fairly strong.
- Memory model: directionally clear, but schema contract still incomplete.
- Pi/tree lifecycle semantics: partly defined.
- Cross-session/scope semantics: intentionally unresolved.
- Implementation architecture: not yet detailed enough to code without avoidable churn.

So I think we are ready to move from “what should this thing be?” into “define the smallest coherent v0.” I would not start implementation quite yet.

What we have decided

The core product is a working-memory sidecar for Pi.

Its job is not to remember everything forever. Its job is:

> Help the user reconstruct the mental state required to resume, understand, steer, or judge a piece of work.

That is the strongest design anchor we have.

The sidecar is deliberately separate from the main Pi agent. Pi does the work. The sidecar observes the thread on demand and maintains a structured interpretation of that work.

The basic loop is:

```text
work in Pi
    ↓
/thread
    ↓
index/update current thread
    ↓
structured working memory
    ↓
summary / full view / ask / edit
    ↓
/thread steer
    ↓
copy useful context back to Pi
```

That separation is important. The memory system should not constantly inject itself into the working agent’s context.

We decided indexing is on-demand.

No continuous background observer for v0.

Bare `/thread` should do the normal thing:

```text
new thread
→ index relevant context

existing memory
→ process new context since last indexing
→ refresh memory
→ show summary
```

Explicit reprocessing exists for repair:

```text
/thread update ...
/thread rebuild ...
```

We decided that the first memory profile is software development, but the core must not become software-development-specific.

Conceptually:

```text
thread-memory core
│
├── indexing lifecycle
├── storage
├── summary
├── full-data rendering
├── ask
├── edit
├── export
└── steer

profile
│
├── schema
├── indexing instructions
├── summary guidance
└── steering guidance
```

Software development might contain:

```text
goals
requirements
findings
constraints
assumptions
decisions
questions
changes
validations
artifacts
...
```

A research profile could have completely different concepts.

The core should therefore understand generic records/items, fields, relationships and sections—not `tests`, `decisions`, or `files`.

We decided against a heavily opinionated multi-screen dashboard.

There are only two privileged representations:

1. A default summary designed to restore context quickly.
2. A full, well-formatted view of everything in memory.

Everything else comes through natural questions.

That means we don't decide in advance whether the user wants to think in terms of decisions, timeline, files, risks, goals, etc.

They can simply ask:

```text
/thread what changed about authentication?
/thread why did we abandon the first approach?
/thread what have I disagreed with?
/thread what remains uncertain?
/thread where are the database changes?
```

We decided memory editing should also be natural language.

Not:

```text
/thread edit D17
```

as the main interaction.

Instead:

```text
/thread edit Actually, ABC isn't the goal here. XYZ is.
```

Or:

```text
/thread edit We didn't reject Redis. We postponed the decision.
```

User edits have higher authority than inferred memory.

Future indexing should not casually overwrite them.

We decided indexing can be steered with a focus instruction.

For example:

```text
/thread focus Pay special attention to architectural decisions,
things I reject, and unresolved security concerns.
```

This focus belongs to the indexing configuration, not to model-generated memory.

It can also be overridden for a particular indexing run.

We decided Ask can optionally combine memory with the latest Pi response.

This is an important use case:

```text
indexed history
+
latest agent reply
+
"How does this proposal fit with what we already decided?"
```

That makes the sidecar complementary to `pi-bro`.

`pi-bro` answers:

> What does this response mean?

This memory sidecar can answer:

> What does this response mean in the context of everything we have already done?

We decided steering is a first-class output.

The system should be able to turn accumulated memory into the smallest useful prompt for the next action:

```text
/thread steer investigate the remaining E2E failure
```

The resulting prompt is copied manually into Pi.

Again: explicit flow back into the working agent, not invisible memory injection.

We also made an important Agent Experience decision.

The indexing agent should not experience:

```text
Pi tree semantics
branch ancestry
entry provenance
storage layout
UI state
```

It should experience something boring:

```text
CURRENT MEMORY

...

NEW MATERIAL

...

INDEXING FOCUS

...
```

and return a structured memory update.

Likewise Ask, Edit and Steer should be separate narrow jobs rather than one mega-agent.

That is a substantial improvement over our earlier design.

What we backed away from

Several earlier ideas are no longer central.

We backed away from heavy per-item provenance.

Pi’s time-travel tree makes turn-based provenance brittle, and asking the indexing agent to maintain elaborate evidence graphs would degrade its context and reasoning.

The extension may retain coarse mechanical revision information for recovery/debugging, but provenance should largely stay behind the curtain.

We backed away from `stage` as an authoritative state such as:

```text
design → implementation → testing → review
```

Real work loops backwards.

The memory profile can represent current activity, goals, validations, etc., and the summary can infer where things stand.

We backed away from `/inspect`.

The combination of:

```text
/thread full
```

and natural questions gives us both raw inspection and semantic inspection.

We also backed away from assuming:

```text
1 thread = 1 ticket
```

as a conceptual law.

But this is also where our largest unresolved question remains.

The biggest unresolved issue: what exactly owns a memory?

We've explored two different destinations.

One is:

```text
Pi thread
    ↕
one working-memory document
```

This is simple.

The other is:

```text
scope/ticket
    ↕
many Pi sessions/threads
```

This is much more powerful for your actual multi-ticket workflow.

We haven't decided how much of the second model belongs in v0.

My current recommendation is:

> Build the first version around a Pi thread, but make the memory format independent of Pi-session identity.

In other words, don't solve cross-session correlation yet, but don't design storage/schema in a way that prevents it.

Then later:

```text
memory A from session 1 ─┐
memory B from session 4 ─┼─► scope ABC-123
memory C from session 9 ─┘
```

can become possible without rewriting the whole memory model.

This deserves an explicit decision before implementation.

What still needs defining

There are about six things I think we need to settle.

First is the canonical memory schema contract.

We have examples of software-development fields, but we haven't defined the actual profile API.

For example, is a profile simply:

```typescript
{
  id: "software-development",
  schema: ...,
  indexPrompt: ...,
  summaryPrompt: ...,
  steerPrompt: ...
}
```

Or does it also define validation, migrations, rendering hints, relationships, allowed statuses, etc.?

This is probably the most important technical design left.

Second is memory update semantics.

Does the indexer return an entire revised memory document:

```text
old memory + new context
        ↓
new memory
```

or patches:

```text
add ...
update ...
remove ...
supersede ...
```

Whole-document replacement is much simpler for the agent.

Patch-based updates are safer and easier to inspect.

We need to choose the simplest design that doesn't destroy user edits.

Third is time travel.

We know what we don't want: making the model understand Pi’s tree.

But the extension still needs some rule.

The minimum viable rule could be extremely simple:

```text
If current Pi branch is compatible with the last indexed point:
    incremental update

If the user time-travelled behind/diverged from it:
    memory becomes stale
    offer rebuild from current lineage
```

That may be enough.

We should resist designing branch-merging memory unless field usage demands it.

Fourth is the exact summary contract.

We know the summary is the main view, but we haven't defined what guarantees it should satisfy.

Rather than hard-code sections such as GOALS / DECISIONS / TESTS, I would define outcome requirements:

```text
A good summary should let the user recover:
- what this work is currently about;
- what is materially true now;
- what materially changed;
- what remains unresolved;
- what likely needs attention next.
```

Profiles can decide how best to render those.

That's less railroading.

Fifth is interaction grammar.

The current candidate is roughly:

```text
/thread
/thread open
/thread full
/thread <question>
/thread edit <natural language>
/thread focus [natural language]
/thread update [n] [natural language focus]
/thread rebuild [n] [natural language focus]
/thread export [md|json]
/thread steer [intent]
/thread doctor
```

This is close, but I would still run several realistic workflows through it before freezing it.

Sixth is persistence.

JSON is probably enough for a thread-local v0.

But we should explicitly define things like:

```text
memory schema version
profile id + version
user edits
index state
focus
last indexed Pi position
revision history?
```

without accidentally constructing a database inside one JSON file.

What I would explore next

I wouldn't brainstorm more features.

I would now run the design against 4–5 real feature-development histories.

For each one, simulate:

```text
1. First /thread after discovery.
2. /thread after design review.
3. User corrects memory naturally.
4. Twenty more implementation turns.
5. /thread again.
6. User asks a difficult "why?" question.
7. User asks about latest response + memory.
8. User time-travels and changes direction.
9. /thread again.
10. /thread steer for the next action.
```

The purpose is not testing code.

It's testing whether our abstraction survives actual work.

I particularly want to see whether the software-development schema naturally captures what you care about, or whether we're forcing reality into categories that looked sensible on paper.

Are we close enough?

Yes.

Earlier we were still debating whether this was:

```text
a ticket tracker?
a session summarizer?
project memory?
a decision log?
a visualizer?
```

We're no longer there.

The destination is now clearly in this neighborhood:

> **A domain-aware, user-correctable, on-demand working-memory sidecar for Pi threads, optimized for cognitive continuity and explicit steering back into the working agent.**

Its essential operations are also clear:

```text
INDEX
   build/update mental model

VIEW
   summary or full memory

ASK
   interrogate it, optionally with latest Pi response

EDIT
   correct it naturally

FOCUS
   steer future indexing

EXPORT
   take the memory elsewhere

STEER
   turn memory back into useful working context
```

That is enough direction to stop broad ideation.

What isn't yet sufficiently pinned down is the **mechanics immediately underneath those verbs**: schema/profile contract, update semantics, tree divergence behavior, and memory ownership.

I would make those our next design pass. Once those four are settled, I think we'd have an implementation-ready v0 rather than merely a promising concept.