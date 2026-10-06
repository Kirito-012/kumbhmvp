import { AbilityBuilder, createMongoAbility, type MongoAbility } from '@casl/ability'

export type AppAbility = MongoAbility<[string, string]>

/**
 * Grants are stored as "<subject>:<action>" strings on each role (e.g. "ticket:create",
 * "ticket:read:own", "settings:manage"). This turns that flat list into a CASL ability so
 * authorization checks (`ability.can('create', 'ticket')`) are the same everywhere —
 * server actions, route handlers, and Server Components.
 */
export function defineAbilityFor(grants: string[]): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility)

  for (const grant of grants) {
    const [subject, ...actionParts] = grant.split(':')
    if (!subject || actionParts.length === 0) continue
    can(actionParts.join(':'), subject)
  }

  return build()
}

/**
 * Gate for Ticket mode and the /api/insights/* feeds behind it -- every role that can read tickets,
 * Surveyors (`ticket:read:own`) included. Heatmap/Evacuation/Map-switching stay `read:all` only.
 */
export function canUseMapModes(ability: AppAbility): boolean {
  return ability.can('read:all', 'ticket') || ability.can('read:own', 'ticket')
}

/**
 * Assignee a ticket query is force-scoped to, or `undefined` for no restriction. Surveyors used to
 * be pinned to their own tickets (`ticket:read:own`); they now see every ticket, so nobody is
 * scoped. Kept as one function so call sites (lists, search, dashboard, chat, detail page) stay in
 * step if scoping ever returns.
 */
export function ticketScopeAssigneeId(): string | undefined {
  return undefined
}
