# ADR-010: Diagrams and code highlighting run under the unchanged Content-Security-Policy

**Status:** Accepted
**Date:** 2026-10-11
**Feature:** tessera-v1 (M2-11)
**Author:** 10x-Team (Architect + Staff Engineer + Security Engineer)

## Context

ADR-005 chose Shiki for code highlighting and Mermaid for diagrams, both loaded lazily in the browser, and left one question open as a verification item for M2: whether they run under the policy without relaxing it. The policy is `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`.

Card text comes from an LLM or the internet, so it is untrusted. A code fence or a diagram is the part of that text most likely to be handed to a large library, so it needs the most care.

Facts found while building this:

- Shiki's default engine needs WebAssembly, which would need `'wasm-unsafe-eval'` in `script-src`. Its JavaScript regular expression engine does not.
- Mermaid builds SVG, inserts it into the page, and writes styles. Its own sanitizing is the main defence, and a diagram can carry its own styling (`classDef`, `style`) and click handlers.
- `img-src` already allows `data:` URIs. An SVG shown through an `img` element cannot run script, load other resources, or reach the page's styles, whatever it contains.

## Decision

**No change to the policy.** Verified in a real browser: no violation events, no console policy errors, no request to any other host, for diagrams and for highlighted code (`tests/e2e/diagrams-and-code.spec.ts`). A test also fails if `script-src` ever gains `unsafe-eval`, `wasm-unsafe-eval`, or any other `unsafe` keyword.

**Code highlighting (Shiki 4.5.0).**
- Core build with the JavaScript regular expression engine, so no WebAssembly. Twenty-three grammars load one at a time, only when a card uses them. Two GitHub high-contrast themes, one for each colour scheme.
- The highlighted code is built from DOM nodes with `textContent`. No HTML string is parsed, so code that looks like markup (`<script>`, `<img onerror>`) can only be text. Token colours are accepted only if they are plain hex colours, and are set as custom properties, picked by `light-dark()` in CSS.
- Light theme comment grey and a few rare scopes that expect their own background (a carriage return, git status marks in a diff) fail the 4.5 to 1 contrast minimum on the code background, so they are replaced, per theme. A unit test checks every colour of both themes against the real background colours.
- Unknown languages, more than 20,000 characters, or more than 600 lines are left as plain code. A grammar that cannot load leaves the plain code in place.

**Diagrams (Mermaid 12.1.0).**
- Strict security level, HTML labels off, at most 8,000 characters and 200 edges, one drawing at a time, 8 second timeout.
- The SVG is sanitized again (DOMPurify SVG profile, with scripts, `foreignObject`, links, `use`, and `href` and `src` attributes removed), given the size from its `viewBox`, and shown as an image through a `data:` URI. Nothing a diagram says can become part of the page.
- The theme follows the colour scheme and the diagram is redrawn when it changes.
- A diagram that fails, is too large, or takes too long shows its source with the note "This diagram could not be drawn. Showing its source." The source is also under "Diagram source" for a diagram that drew, for reading, copying, and screen readers. The image has alternative text that points to it.
- Verified for flowchart, sequence, state, class, entity relationship, pie, Gantt, and mind map diagrams.

**Dependencies.** Both are development dependencies, because they are compiled into the browser bundle and the server never loads them. They are not in the runtime image and not in the production licence check. Both are MIT.

## Alternatives Considered

| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| Relax the policy (`'wasm-unsafe-eval'` for Shiki's default engine) | Fuller grammar support | Weakens the directive that matters most for XSS | The JavaScript engine works without it |
| Put the SVG into the page (inline) | Selectable text, page fonts, themes by CSS | A diagram could style or script the page if any sanitizing step misses something | An image is isolated by the browser itself, which does not depend on getting every sanitizer rule right |
| Sandboxed iframe with `srcdoc` | Also isolated | Heavier, and needs frame rules in the policy | The image gives the same isolation with no policy change |
| Render on the server | No browser load | Needs a DOM on the server (ADR-005 decided against), and Mermaid needs a real layout engine | Rejected in ADR-005 |
| Load every grammar | Simpler | Large download | Grammars load one at a time instead |

## Consequences

### Positive
- The policy is as strict as before. The riskiest content is isolated by construction (text nodes, image) and not only by sanitizing.
- A page without code or diagrams pays nothing: measured on a fresh browser, a plain card downloads 194 KB of script (65 KB on the wire), a code card about 370 KB more (64 KB on the wire), and a flowchart about 2.1 MB more (about 494 KB on the wire). A test fails if a plain card starts to download the diagram library.

### Negative
- Diagram text is part of an image: not selectable, a fixed system font, no click actions. The source under the diagram covers copying.
- The JavaScript regular expression engine can differ from the reference engine on unusual grammars. Those blocks stay plain. The 23 shipped grammars are common ones.
- Cisco IOS and similar configuration languages have no grammar, so they show as plain code.
- Colours for the two themes are fixed to the GitHub high-contrast pair.

### Risks
- A hostile diagram cannot be cancelled once Mermaid starts laying it out (the page stops waiting after 8 seconds, but the work continues). The size and edge limits bound it. A 200 edge diagram draws in well under a second here. A deliberately slow layout inside those limits has not been searched for.
- `npm audit` reports a low severity advisory for `katex` (prototype pollution that can bypass its trust restrictions), reached through Mermaid's math support. It is not in the production audit (`npm run audit:prod` finds 0). The diagram is shown as an image and the trust option is not enabled. The other development advisory, `esbuild` through `drizzle-kit`, predates this change. Both should be re-checked when the dependencies are next updated.
- Mermaid and Shiki are large and release often. Dependabot will open pull requests, and the browser tests are the check that an update still works under the policy.

## Dependencies
- Depends on ADR-005 (policy, untrusted content, Markdown sanitizing).
- Constrains any future change to `img-src` (it must keep allowing `data:` for diagrams, or diagrams must be drawn another way) and any future relaxation of `script-src`.
