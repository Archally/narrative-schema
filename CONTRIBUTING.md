# Contributing to Narrative

Describe the use case in your issue or pull request. For a format change, include a YAML example and explain how the change affects existing models.

## Sign off each commit

Use `git commit -s` to certify the [Developer Certificate of Origin 1.1](https://developercertificate.org/). This adds a `Signed-off-by` line with your name and email.

## Terms by path

| Paths | Terms |
| --- | --- |
| `schema/`, `examples/`, and `docs/` | Apache-2.0 and DCO 1.1 |
| `tools/validator/`, `tools/port/`, `tools/README.md`, and `tools/LICENSE` | Apache-2.0 and DCO 1.1 |
| All other paths designated Apache-2.0 in the [licence map](LICENSE) | Apache-2.0 and DCO 1.1 |
| Paths expressly designated in the licence map as FSL tools | FSL-1.1-ALv2, DCO 1.1, and the additional consent below |

Apache-licensed contributions are submitted under Apache-2.0 with DCO sign-off. The additional consent applies exclusively to contributions to files expressly designated as FSL tools. This release contains no such tools. For changes to licence texts, open an issue.

### Additional consent for FSL tools

For the portion of a contribution to files expressly designated as FSL tools, you grant Adam Walkowski / Archally a perpetual, worldwide, non-exclusive, royalty-free, irrevocable licence to use, reproduce, and relicense that portion under different or additional terms.

Each part of a pull request follows the terms for its own path. In a pull request that touches multiple areas, Apache-licensed changes retain the Apache-2.0 and DCO terms. If you propose moving material across licence boundaries, open an issue to establish the applicable permissions before submitting the change.
