# S-6d3i overlap resolution

## Finding

Two lanes independently found the same defect in
`backend/cms-db/src/writes/statements.rs`: the original
`INSERT ... SELECT * FROM unnest(...)` emits scalar values for
`evaluations.text`, `evaluation_sandbox_paths` and
`evaluation_sandbox_digests`, while PostgreSQL stores each as `varchar[]`.
The probe failed with `42804`; wrapping each scalar in `ARRAY[...]` avoids the
type error but silently keeps only one element.

## Decision

The trunk's merged writer at `0cc770fd` is the source of truth. It binds one
PostgreSQL array literal per row in `text[]` columns and casts each back to
`varchar[]`, preserving full per-row arrays without a new dependency.

The alternate lane `rust-S6d3i-resultio` implemented the same preservation with
`jsonb_to_recordset` and a new `serde_json` edge in `cms-db`. It is **not merged**
and must not be merged. The dependency edge fails the standing no-new-runtime-
dependency requirement; the array-literal path survives.

## Handoff to S-6d3j

The active S-6d3j lane owns the object commit step. Before it lands, it must:

1. Add adversarial array-literal round-trip cases for quotes, backslashes,
   braces, commas, empty strings, newlines and Unicode.
2. Add an `ON CONFLICT (submission_id, dataset_id, testcase_id) DO UPDATE` clause
   or an equivalent duplicate-safe write, with a named live control.
3. Reuse the merged `ObjectWrite::write_evaluations` rather than adding a second
   bulk-write implementation.
4. Preserve every existing WHY comment and keep the frozen-schema live test.

Evidence: `dev/fixtures/cms_schema.sql:448-461` pins the three `varchar[]`
columns; `backend/cms-db/src/writes/shapes.rs` carries one `Vec<String>` per row;
`backend/cms-db/src/writes/batch.rs` now carries the array-literal writer.
