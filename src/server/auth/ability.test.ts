import { describe, expect, it } from 'vitest'
import { defineAbilityFor } from './ability'

describe('defineAbilityFor', () => {
  it('grants exactly the actions listed on the role', () => {
    const ability = defineAbilityFor(['ticket:create', 'ticket:read:own'])

    expect(ability.can('create', 'ticket')).toBe(true)
    expect(ability.can('read:own', 'ticket')).toBe(true)
    expect(ability.can('delete', 'ticket')).toBe(false)
  })

  it('grants nothing for an empty grant list', () => {
    const ability = defineAbilityFor([])
    expect(ability.can('read', 'ticket')).toBe(false)
  })

  it('ignores malformed grant strings instead of throwing', () => {
    const ability = defineAbilityFor(['not-a-grant', 'ticket:update'])
    expect(ability.can('update', 'ticket')).toBe(true)
  })
})
