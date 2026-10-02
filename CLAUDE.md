# CLAUDE.md
- ASSIGNMENT.md = requirements. IMPLEMENTATION_PLAN.md = approved design. Do not change formulas, bidding rules, transaction semantics, dependencies or scope without recording it in DECISIONS.md and asking.
- Do not research or consult other candidates' submissions. Design decisions are already made.
- Business logic only in packages/domain (pure) and packages/application (transactions). API and worker stay thin.
- Money = integer cents. Ratios via BigInt. All deadline decisions use Postgres clock_timestamp() AFTER the campaign row lock.
- Implement one slice at a time, in order. Each slice ends with lint, typecheck, tests, build passing; report checks actually run and anything not done.
- Add no dependency or infra without a one-line justification in DECISIONS.md.
- Never commit secrets. Keep README claims consistent with code and tests.
