# Research behind the review workspace

The closest matches concern change decomposition, graph navigation, and keeping summaries connected to source evidence. The prototype borrows these design ideas. It does not reproduce their algorithms or claim their measured results.

| Work | What it investigates | Application to Review Helper |
| --- | --- | --- |
| [CG-Diff: Organizing Code Changes Around Call Graphs](https://arxiv.org/abs/2609.32057), Bimal Raj Gyawali, Devamardeep Hayatpur, Nadia Polikarpova, 2026 preprint | Decomposes changed-code call graphs into navigable subgraphs. The reported user study found orientation benefits, with limitations around duplicated function nodes and changes outside functions. | Feature sections should follow relationships across files. Every changed file remains reachable in the diff view, including configuration and imports. Actual call-graph extraction is future work. |
| [Graph-based visualization of merge requests for code review](https://doi.org/10.1016/j.jss.2022.111506), Journal of Systems and Software 195, 2023 | ReviewVis represents changed classes and methods and their relationships as a graph in a GitLab review workflow. | Make the change map a navigation surface connected to diffs and discussions. This prototype maps files, not classes or methods. |
| [ClDiff: Generating Concise Linked Code Differences](https://chenbihuan.github.io/paper/ase18-huang-cldiff.pdf), ASE 2018 | Generates concise linked differences between the granularity of raw code edits and high-level summaries. Relationships between edits provide context for understanding changes. | Preserve original patches alongside section summaries. A model-generated summary cannot replace the evidence. AST-level differencing is not implemented. |
| [Untangling Fine-Grained Code Changes](https://arxiv.org/abs/1502.06757), Martín Dias, Alberto Bacchelli, Georgios Gousios, Damien Cassou, Stéphane Ducasse, 2015 | EpiceaUntangler clusters fine-grained changes into self-contained tasks using a collected change dataset and developer evaluation. | Use behavior-oriented groups and allow replacement of a proposed plan. The current fallback uses domain words in filenames, not the paper's classifier or edit history. |
| [Visual Integration of Static and Dynamic Software Analysis in Code Reviews via Software City Visualization](https://arxiv.org/abs/2408.08141), Alexander Krause-Glau, Lukas Damerau, Malte Hansen, Wilhelm Hasselbring, 2024 | Describes an in-progress web-based design combining static and dynamic analysis in ExplorViz and connecting it to Git hosting workflows. | Keep the viewer close to the review workflow. Distinguish directory topology from runtime behavior. The prototype does not collect traces or implement a software-city visualization. |

## Review order and grouping (added November 2026)

| Work | Finding | What Review Helper does with it |
| --- | --- | --- |
| [Does Order Matter?](https://arxiv.org/abs/2609.22610), Rahman, Codabux, Roy, 2026 preprint | 330,343 multi-file GitHub PRs: latent-bug rate rises modestly with file position, and each extra file lowers the odds of any review comment by about 8.7%. Recommends context-aware ordering, dependency-aware grouping and per-file coverage indicators; these are proposals, not evaluated. | Files inside a section follow a reading order (data → service → API → client state → UI → other → tests) instead of alphabetical. The guide asks models to keep sections to about ten files. |
| [Assessing the Impact of File Ordering Strategies](https://arxiv.org/abs/2306.06956), Bagirov et al. (JetBrains), 2023 | Reviewers comment more on files shown first. Sorting by diff size placed commented files slightly earlier than alphabetical order; effect sizes are small and differ by language. | Treat ordering as a modest gain. Do not claim faster reviews without measurement. |
| [Breaking the Alphabet](https://dl.acm.org/doi/10.1145/3744916.3787838), ICSE 2026 | A survey of 1,355 developers: few consider alphabetical file order optimal. Reported percentages differ between summaries, so check the paper before quoting a figure. | Same reading-order change. |
| [Atomizer](https://arxiv.org/abs/2601.01233), ICSE 2026; [ColaUntangle](https://arxiv.org/abs/2507.16395) | LLM agents untangle composite commits: a grouper proposes groups by intent, a reviewer agent checks each group shares one intent, and they iterate. Reported gains over graph-clustering baselines, largest on complex commits. | The MCP guide and skill ask the calling model to check its own sections once (split mixed intents, merge duplicates) before `propose_review_plan`. No extra agent or model key. |

[CodeRabbit Change Stack](https://www.coderabbit.ai/change-stack) (May 2026) splits a PR into a few independent cohorts. Each cohort has ordered layers anchored to line ranges, foundations first, and J/K keyboard navigation. Sequence, state and entity-relationship diagrams appear only when a layer's structure warrants one. Review Helper adopts the foundations-first order, J/K section navigation, and diagrams shown only when they have content (including a data-model view). It does not yet anchor sections to hunks or line ranges, summarise each range, or verify suggested comments.

## Fresh-context review

Dave Rensin's [Elephants, Goldfish and the New Golden Age of Software Engineering](https://research.google/pubs/elephants-goldfish-and-the-new-golden-age-of-software-engineering/) is listed by Google Research as a 2026 Medium article. It proposes a context-rich design session and a fresh session that tests whether the resulting specification stands on its own. This is a workflow essay, not evidence that context-free PR review outperforms contextual review.

The [Google Elephant-Goldfish Model repository](https://github.com/google/elephant-goldfish-model) implements fresh-context specification review. Its [review protocol](https://github.com/google/elephant-goldfish-model/blob/main/docs/designs/review.md) gives fresh reviewers the target document and referenced sources, excluding the preceding conversation. "Fresh context" therefore does not mean that reviewers receive no source material.

For a later PR-review experiment, provide one reviewer a bounded diff and explicit requirements, and another the relevant project dependencies. Compare verified findings, false positives, and missed issues. Keep each review's evidence packet and provenance visible. This remains planned; the current AI button prepares a section-scoped MCP prompt.

## Evaluation plan

Use a set of PRs with reviewer-labeled features, including cross-layer work, renames, deletions, migrations, configuration-only edits, and tangled changes within a single file. Compare file-order review, filename grouping, model-generated sections, and an eventual AST/dependency-assisted method.

Measure time to locate a change, task completion accuracy, validated defects found, duplicate findings, and grouping corrections. Track patch coverage and unassigned changes separately from reviewer speed. Token counts should be measured per completed task, including tool schemas and follow-up reads. The prototype's small initial tool result is a design choice, not a measured claim of lower total review cost.

## Product references

[CodeRabbit Change Stack](https://www.coderabbit.ai/blog/introducing-change-stack-the-first-ai-native-code-review-interface) describes change cohorts, ordered layers and diagrams anchored to diffs. It is product inspiration, not a research result. Review Helper is an independent implementation and has no affiliation with CodeRabbit.

[Apple's layout guidelines](https://developer.apple.com/design/human-interface-guidelines/layout) are a reference for a restrained hierarchy and predictable controls. This is a web prototype, not a native Apple interface or an Apple-endorsed design.
