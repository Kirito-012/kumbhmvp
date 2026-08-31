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
