# Vendored anti-slop provenance

- Repository: https://github.com/dmmulroy/anti-slop
- Exact source commit: `13909c9e07590f5a85d93c62712259fe14a883f7`
- Installed on: 2026-11-01
- Installer: `skills/install-anti-slop/scripts/install.mjs` from that commit, fresh copy without force.
- Pristine copied directory: `skills/install-anti-slop/assets/anti-slop/` -> `tools/oxlint/anti-slop/`.
- Generic entry point: `tools/oxlint/anti-slop/index.ts`; all bundled rule/shared/vendor files retained unchanged.
- Root MIT `LICENSE` copied separately from the same source commit.
- Nested `vendor/eslint-stylistic/LICENSE` and `UPSTREAM.md` retained from the official bundle.
- Dependencies: `oxlint` and `@oxlint/plugins` exact `1.90.0`, matching current npm registry versions queried on 2026-11-01.
- Local policy: all 18 generic rules and native `oxc/no-accumulating-spread` are errors. The official `allowInTypeGuards:true` option permits runtime representation checks only inside explicit type predicates/assertion functions; other ad hoc checks remain errors.
- Effect is not directly depended on or requested, so the opt-in Effect entry point is not registered.
- No rule source modifications, diagnostic baselines, severity downgrades, or disabled generic rules.
- The package `lint` command intentionally selects the MCP/upload change scope. This is not a full legacy-repository migration; see `docs/anti-slop.md`.
