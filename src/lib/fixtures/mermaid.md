# Diagram reading fixture

Ordinary Markdown, **emphasis**, and `inline code` stay intact.

```js
console.log('not a diagram')
```

```mermaid
flowchart TD
  Question[Ask a question] --> Explanation[Read explanation]
  Explanation --> Recall[Try to recall]
  Recall --> Gap[Find a gap]
  Recall --> Understanding[Understanding]
  Gap --> Question
```

A second diagram has independent content and a separate larger view.

```mermaid
sequenceDiagram
  participant Learner
  participant Tutor
  Learner->>Tutor: Ask about spaced repetition
  Tutor-->>Learner: Explain retrieval practice
  Learner->>Learner: Recall after a delay
```

A dense diagram should be inspectable without enlarging the card.

```mermaid
flowchart LR
  Start[Start learning] --> A[Read an explanation]
  Start --> B[Explore examples]
  Start --> C[Try a problem]
  A --> A1[Explain in your own words]
  A --> A2[Connect to prior knowledge]
  B --> B1[Compare similar examples]
  B --> B2[Find a counterexample]
  C --> C1[Check assumptions]
  C --> C2[Inspect mistakes]
  A1 --> Recall[Delayed recall]
  A2 --> Recall
  B1 --> Recall
  B2 --> Recall
  C1 --> Recall
  C2 --> Recall
  Recall --> Review[Review gaps]
  Review --> Start
```

A malformed block must not prevent later blocks from rendering.

```mermaid
flowchart TD
  A[Unclosed node
```

```mermaid
flowchart LR
  Still[Still works] --> After[After a parse failure]
```
