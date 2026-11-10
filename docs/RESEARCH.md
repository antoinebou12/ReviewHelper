# Research behind the review workspace

The closest matches concern change decomposition, graph navigation, and keeping summaries connected to source evidence. The prototype borrows these design ideas. It does not reproduce their algorithms or claim their measured results.

| Work | What it investigates | Application to Review Helper |
| --- | --- | --- |
| [CG-Diff: Organizing Code Changes Around Call Graphs](https://arxiv.org/abs/2609.32057), Bimal Raj Gyawali, Devamardeep Hayatpur, Nadia Polikarpova, 2026 preprint | Decomposes changed-code call graphs into navigable subgraphs. The reported user study found orientation benefits, with limitations around duplicated function nodes and changes outside functions. | Feature sections should follow relationships across files. Every changed file remains reachable in the diff view, including configuration and imports. Actual call-graph extraction is future work. |
| [Graph-based visualization of merge requests for code review](https://doi.org/10.1016/j.jss.2022.111506), Journal of Systems and Software 195, 2023 | ReviewVis represents changed classes and methods and their relationships as a graph in a GitLab review workflow. | Make the change map a navigation surface connected to diffs and discussions. This prototype maps files, not classes or methods. |
| [ClDiff: Generating Concise Linked Code Differences](https://chenbihuan.github.io/paper/ase18-huang-cldiff.pdf), ASE 2018 | Generates concise linked differences between the granularity of raw code edits and high-level summaries. Relationships between edits provide context for understanding changes. | Preserve original patches alongside section summaries. A model-generated summary cannot replace the evidence. AST-level differencing is not implemented. |
| [Untangling Fine-Grained Code Changes](https://arxiv.org/abs/1502.06757), Martín Dias, Alberto Bacchelli, Georgios Gousios, Damien Cassou, Stéphane Ducasse, 2015 | EpiceaUntangler clusters fine-grained changes into self-contained tasks using a collected change dataset and developer evaluation. | Use behavior-oriented groups and allow replacement of a proposed plan. The current fallback uses domain words in filenames, not the paper's classifier or edit history. |
| [Visual Integration of Static and Dynamic Software Analysis in Code Reviews via Software City Visualization](https://arxiv.org/abs/2408.08141), Alexander Krause-Glau, Lukas Damerau, Malte Hansen, Wilhelm Hasselbring, 2024 | Describes an in-progress web-based design combining static and dynamic analysis in ExplorViz and connecting it to Git hosting workflows. | Keep the viewer close to the review workflow. Distinguish directory topology from runtime behavior. The prototype does not collect traces or implement a software-city visualization. |

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
