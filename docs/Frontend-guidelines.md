# Frontend Guidelines – StashJar

## Principles

- **Server is source of truth.**
- No tier-string checks in UI.
- Use `config.actions` + `funding.ui` only.
- **Rail-driven funding.**
- Never infer mode. Follow `preferredFundingRail`.
- Never assume context. Use server context.
- Miniapp behavior gated by rail.
- Daily limits must use shared countdown component.
- All deep links must be relative paths.
- Service worker rejects cross-origin.
- No hardcoded dice/envelope options. Render from bounds in config.
- Refetch home only when necessary. Avoid limit burn. SETTLED-only refetch.
