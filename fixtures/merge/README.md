# Shared merge fixtures

`mergeData()` exists twice: once in TypeScript (`v3/packages/core/src/logic.ts`, used by
the web app and the server) and once in Kotlin (`android/app/.../domain/Merge.kt`). Both
decide which side of a sync wins. Each had its own tests, written against its own
expectations — so the two could drift apart and every test on both sides would still pass,
while a real sync silently dropped or resurrected a record.

These files are the shared contract. Each fixture is fed to both implementations and both
must produce the same result:

- TypeScript: `v3/packages/core/src/mergeFixtures.test.ts`
- Kotlin: `android/app/src/test/java/de/nagellacke/domain/MergeFixturesTest.kt`

## Format

```jsonc
{
  "name": "...",          // short identifier, also the test name
  "description": "...",   // what contract this pins, and why it matters
  "local": { ... },       // AppData as it would arrive from the local side
  "remote": { ... },      // AppData as it would arrive from the remote side
  "expected": { ... }     // the projection below, in merge output order
}
```

`local` and `remote` are raw sync JSON: exactly what crosses the wire, including
pre-migration shapes such as a bare-string `finish`. Each side parses them the way it
parses real sync data, so the fixtures also cover the deserialization step, which is where
Kotlin normalizes `finish` while TypeScript normalizes it inside `mergeData`.

## Why `expected` is a projection, not a full AppData

The two platforms fill in absent optional fields differently — Kotlin's data classes have
defaults (`count = 1`, `colors = ["#ff6699"]`), TypeScript leaves the key absent. Comparing
whole records would fail on that difference alone, which is not what these fixtures are
about. So each side projects its merged result down to the fields the merge actually
decides:

| collection   | fields                                     |
|--------------|--------------------------------------------|
| `polishes`   | `id`, `name`, `updatedAt`, `deletedAt`, `finish` |
| `customCats` | `id`, `label`, `updatedAt`, `deletedAt`    |
| `manicures`  | `id`, `date`, `updatedAt`, `deletedAt`     |
| `stickers`   | `id`, `name`, `updatedAt`, `deletedAt`     |

`deletedAt` is always present in the projection, `null` when the record is live, so an
absent key and an explicit null cannot be confused.

**Order is part of the contract.** Both implementations build an insertion-ordered map
(JS `Map`, Kotlin `LinkedHashMap`): local records first in their original order, then
remote-only records appended. A record that exists on both sides keeps its local position
even when the remote copy wins. The lists in `expected` are in that order.

## Adding a fixture

Drop a new `.json` file in this directory — both test files discover the directory
contents, so neither needs editing. If the two implementations disagree about it, that is
the finding: fix the implementations, do not soften the fixture.
