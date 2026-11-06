# Frontend Assistant Guide

These conventions apply to all code under `frontend/`. They extend — and never override — the rules in [`/CLAUDE.md`](../CLAUDE.md), which covers monorepo-wide architecture, Sorbet typing, MCP tooling, test commands (`pnpm --dir ./frontend test`), and other cross-cutting standards. Read that first; this file picks up where it leaves off.

The architectural principle behind these rules is captured in [ADR-016: Enforce SOLID Frontend Pattern for All Frontend Feature Code](https://justvanilla.atlassian.net/wiki/spaces/VanillaEng/pages/1634992245/ADR-016+Enforce+SOLID+Frontend+Pattern+for+All+Frontend+Feature+Code). The short version: page/feature components are thin orchestrators that wire data and callbacks; business logic, state transitions, and side effects live in custom hooks. Mirrors the backend layering — Use Case ↔ Hook, DTO ↔ TS type, Gateway ↔ GraphQL/REST call, Presenter ↔ Component.

---

## Generated Types & Codegen

The frontend supports two type generation sources — prefer REST but don't abandon GraphQL where it's already in use.

- **REST (preferred)** — types are generated from the OpenAPI spec into `@http/internalApi/types`. Use these directly for any new backend interactions. Run with `pnpm openapi:generate` (regenerates the swagger and the TS types) or `pnpm openapi:types` (TS types only) after API spec changes.
- **GraphQL (legacy, supported)** — types are generated into `src/gql/`. Still valid and actively used. Run with `pnpm graphql:codegen` after schema changes. Never edit either generated directory manually. Always import from `@gql/__generated__/schema_with_hooks` — `schema.ts` is deprecated and must not be used.

When building something new, reach for the REST types. When working in an existing area that uses GraphQL, stay consistent with the surrounding code.

## Folder Structure & Code Organization

### Key directories

| Directory | Purpose |
|---|---|
| `src/features/` | Feature-specific modules. Each feature is self-contained with its own components, hooks, utils, and types. |
| `src/components/` | Reusable components used across more than one feature. Anything here is an Aether candidate. |
| `src/utils/` | Shared utility functions used across features. If a util is only used in one place, co-locate it with that feature. |
| `src/hooks/` | Shared custom hooks used across features. Feature-specific hooks live inside the feature folder. |
| `src/pages/` | Route-level page components. Folder names use kebab-case to match URL routes. |

### Folder naming

- `features/`, `components/`, `hooks/`: PascalCase — e.g. `ReportBuilder/`, `ActionBar/`
- `pages/`: kebab-case to match the URL — e.g. `legacy-planning/`, `app-feature-flag/`
- Page file structure must mirror the URL path. `/estate/legacy-planning/diagram` → `pages/estate/legacy-planning/diagram/index.tsx`

### File naming

- The entry point for any component or feature is `index.tsx` (or `index.ts`)
- Supporting files are named by their role: `types.ts`, `constants.ts`, `utils.ts`, `styles.ts`
- Substantial features should include a `CLAUDE.md` capturing context (responsibilities, key invariants, gotchas) that isn't obvious from the code

### Tests

Every component and feature file should have a co-located test file (e.g. `index.test.tsx` alongside `index.tsx`). See the [Testing](#testing) section below for the full philosophy.

## Using the Design System

The Aether Design System (`@justvanilla/aether-design-system`) is the source of truth for UI primitives. Always reach for it before writing a local component. Use the `mcp__aether-ds__*` MCP tools (documented in the root [CLAUDE.md](../CLAUDE.md#mcp-tools)) to look up available components and their props before implementing anything UI-related.

### Always use Aether for

- **Typography** — never use raw `<h1>`–`<h6>`, `<p>`, or `<span>` for text. Use the Aether type components (`HeadlineSans3XL`, `BodySansBase`, `BodySansSmall`, etc.)
- **Icons** — always use `Icons.*` from Aether. Never add custom SVGs or third-party icon libraries.
- **Modals, dialogs, and slideouts** — always use Aether's `Dialog`, `FullScreenOverlay`, or equivalent. Never build custom overlay/modal/backdrop components.

### Rules

- Do not wrap Aether components in `styled()` — it breaks the design system's CSS cascade.
- For typography components, use `additionalClasses` for Tailwind overrides.
- Never use inline `style` props. All styling must use Tailwind classes.
- Do not re-implement anything Aether already provides. If a UI primitive is missing from Aether, it belongs in `src/components/` (if reusable across features) or co-located with the feature (if single-use) — never as a one-off inline implementation.

## Writing Components

### Single responsibility

Every component, hook, and utility should do exactly one thing. This is the guiding principle for all frontend code.

- **Display components stay dumb** — a component's only job is to describe what the UI looks like given its props. No data fetching, no transformation, no derived state, no conditional logic beyond rendering. If it's doing more than rendering, split it.
- **Hooks own complexity** — async operations, data fetching, state transitions, and any logic that would clutter a component belong in a custom hook.
- **Split early** — aim to keep files under **200 lines**, and treat **100 lines** as the signal to start considering a split. These are guidelines, not lint rules — the more important question is whether a file has a single responsibility. If a component is handling both data and rendering, that's the split point regardless of line count.

### Styling

- All styling uses Tailwind classes. Never use inline `style` props.
- We are actively migrating off styled-system (`styles.ts` files). Do not introduce new styled-system usage. When touching a component that uses it, migrate to Tailwind if it is within scope of the change.

### TypeScript

- **Never use `any`** — not in source code, not as a quick fix. Use `unknown` and narrow the type, or derive from existing types.
- **Avoid casting types** — `as SomeType` and `as unknown as SomeType` are a strong code smell and should be a last resort. If you feel the urge to cast, the type is usually wrong upstream and should be fixed there. When a cast is genuinely the right call (e.g. narrowing at a boundary the type system can't see through), leave a brief comment explaining why.
- Prefer generated and imported types over manually defining them. The OpenAPI-generated types in `@http/internalApi/types` are the source of truth for backend shapes — use them directly rather than re-declaring equivalent types by hand.
- Re-exporting a type under a new alias (`export type { Foo as Bar }`) is not a pattern we use.

### Imports

Always use path aliases over relative imports — `@features/...`, `@components/...`, `@http/...`, etc. Never use `./` or `../`.

## Testing

Because every component and hook does exactly one thing, it should be straightforward to test every possibility of that one thing. Single responsibility and high test coverage go hand in hand — a component that's hard to test fully is usually a signal it's doing too much.

### Tooling

Tests use **Vitest** as the test runner and **`@testing-library/react`** for component rendering and interaction. Use `vi.fn()`, `vi.mock()`, and `vi.spyOn()` — not Jest equivalents. Run with `pnpm --dir ./frontend test` (see root [CLAUDE.md](../CLAUDE.md#frontend-tests) for more commands).

### Testing philosophy

RTL encourages testing the way software is actually used. Prefer semantic queries (`getByRole`, `getByLabelText`, `getByText`) over `getByTestId`. This naturally covers accessibility, focus management, and keyboard interactions — which Aether components handle internally, so your tests should verify the correct component is used in the correct context, not re-test Aether's internals.

### What to mock

Mock things that are external or non-deterministic — not everything. If a dependency is external to the system (network, timers, third-party services) or its behaviour is unpredictable in a test environment, mock it. If it's internal and deterministic, let it run. Don't mock things just because they're dependencies.

### Provider test wrappers

Don't wrap providers manually in every test. Use shared test wrappers for `QueryClientProvider`, `ApolloProvider`, and any other required context. Keep them in a central `src/test-utils/` location so tests stay clean.

### Goals

- Co-locate a test file with every component, hook, and util (`index.test.tsx` alongside `index.tsx`, `utils.test.ts` alongside `utils.ts`, etc.)
- Aim for full unit coverage — every code path, prop variation, and conditional render. Treat untested branches as a smell worth questioning, not necessarily a hard blocker.
- Test through the public interface — props, rendered output, and callback invocations. Never test implementation details.
- A reviewer is on the hook for approving untested code, so flag gaps explicitly when they exist.

## Pre-PR Checklist

Before opening or updating a PR, verify the following on every changed file:

- **Flag condition consistency** — when a feature is gated by a combination of conditions (LD flags, org settings, role checks), every reference to that feature must use the same full set of conditions. This includes the callback that triggers the behavior, any UI element that implies the behavior (button label, visual indicator), and render guards. A mismatch between any two is a bug.
- **Async effect cancellation** — every `useEffect` containing `await` must check a `cancelled` flag after each await before updating state or establishing connections. Cleanup sets `cancelled = true`.
- **State ownership** — when introducing a context as a single source of truth, audit all existing consumers to ensure none hold a duplicate local copy of the same state.
- **No logic duplication** — if the same logic appears twice in a file, extract it. Two copies will drift.
- **Effect responsibilities don't overlap** — multiple `useEffect` hooks that reference the same piece of state should have distinct, non-overlapping responsibilities. If two effects both consume and clear the same value, collapse them into one.
- **Names follow semantics** — when the condition behind a prop, variable, or callback changes, rename it. A name that described the old condition will mislead the next reader.
- **Trace the full user experience** — when replacing or adding a user-facing feedback mechanism (toast, panel, redirect), trace the complete experience from action to confirmation, including loading and error states. Don't leave a silent gap.
- **Read your own diff** — before staging files for commit, run `git diff` (or `git diff --staged`) and read the output as a reviewer. This catches duplication, naming drift, and UX gaps that are invisible while writing but obvious when reading.
