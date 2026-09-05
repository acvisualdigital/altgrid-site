import { describe, expect, it, vi } from 'vitest'

import type { AdminSessionResponse } from '../types/admin-api'
import { UNLIMITED_ACCOUNT_LIMIT, type ResolvedEntitlements } from '../types/backend-api'
import { OwnerToolsService, type OwnerTool } from './owner-tools-service'

const owner = { id: 'owner-id', email: 'yacaciio@gmail.com' }
const member = { id: 'member-id', email: 'member@example.com' }
const admin: AdminSessionResponse = { admin: { user_id: owner.id, role: 'admin' } }
const tools: OwnerTool[] = ['creator-tag', 'founder-benefits']
const free: ResolvedEntitlements = {
  account_limit: 2,
  expires_at: null,
  features: { basic_grids: true, advanced_grids: false, account_proxy: false },
  founder_number: null,
  lifetime: false,
  plan: 'FREE',
}
const pro: ResolvedEntitlements = {
  account_limit: 6,
  expires_at: '2027-01-01T00:00:00.000Z',
  features: { basic_grids: true, eco_mode: true, account_proxy: false },
  founder_number: null,
  lifetime: false,
  plan: 'PRO',
}

function preferences(email?: string) {
  const values = new Map<string, string>()
  if (email) {
    for (const tool of tools) {
      values.set(`altgrid.${tool}.email`, email)
      values.set(`altgrid.${tool}.enabled`, 'true')
    }
  }
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

describe('OwnerToolsService authorization', () => {
  it('removes legacy test flags saved for another email without touching other preferences', () => {
    const storage = preferences(member.email)
    storage.setItem('altgrid.preference.restore-session', 'true')
    const service = new OwnerToolsService(storage)

    expect(storage.values).toEqual(new Map([['altgrid.preference.restore-session', 'true']]))
    for (const tool of tools) {
      expect(service.isEnabled(member, tool)).toBe(false)
      expect(service.setEnabled(member, tool, true)).toBe(false)
    }
    expect(service.resolveEntitlements(member, free)).toBe(free)
  })

  it('does not trust preseeded owner preferences before backend authorization', () => {
    const storage = preferences(owner.email)
    const service = new OwnerToolsService(storage)

    expect(service.isAuthorized(owner)).toBe(false)
    for (const tool of tools) {
      expect(service.isEnabled(owner, tool)).toBe(false)
      expect(service.setEnabled(owner, tool, true)).toBe(false)
    }
    expect(service.resolveEntitlements(owner, free)).toBe(free)
  })

  it.each([
    ['missing current user', null, owner, admin],
    ['missing network identity', owner, null, admin],
    ['missing network administrator response', owner, owner, null],
    ['wrong administrator role', owner, owner, { admin: { user_id: owner.id, role: 'member' } }],
    ['wrong administrator identity', owner, owner, { admin: { user_id: member.id, role: 'admin' } }],
    ['wrong network identity', owner, { ...owner, id: member.id }, admin],
    ['wrong current email', { ...owner, email: member.email }, owner, admin],
    ['wrong network email', owner, { ...owner, email: member.email }, admin],
    ['missing network email', owner, { id: owner.id }, admin],
    ['empty identity', { ...owner, id: '' }, { ...owner, id: '' }, { admin: { user_id: '', role: 'admin' } }],
    ['different administrator', member, member, { admin: { user_id: member.id, role: 'admin' } }],
  ])('denies %s even when local storage names the owner', (_name, current, server, response) => {
    const service = new OwnerToolsService(preferences(owner.email))
    service.authorize(
      current as typeof owner | null,
      server as typeof owner | null,
      response as AdminSessionResponse | null,
    )

    expect(service.isAuthorized(owner)).toBe(false)
    expect(service.resolveEntitlements(owner, free)).toBe(free)
    for (const tool of tools) expect(service.setEnabled(owner, tool, true)).toBe(false)
  })

  it('accepts only the verified owner and normalizes email spelling', () => {
    const service = new OwnerToolsService(preferences())
    const mixedCaseOwner = { ...owner, email: ' YACACIIO@GMAIL.COM ' }
    service.authorize(mixedCaseOwner, owner, admin)

    expect(service.isAuthorized(owner)).toBe(true)
    expect(service.isAuthorized(member)).toBe(false)
    for (const tool of tools) {
      expect(service.setEnabled(mixedCaseOwner, tool, true)).toBe(true)
      expect(service.isEnabled(owner, tool)).toBe(true)
    }
  })

  it.each([free, pro])('restores the exact $plan license when Founder testing is turned off', (base) => {
    const untouched = structuredClone(base)
    const service = new OwnerToolsService(preferences())
    service.authorize(owner, owner, admin)
    expect(service.setEnabled(owner, 'founder-benefits', true)).toBe(true)

    const preview = service.resolveEntitlements(owner, base)
    expect(preview.plan).toBe('FOUNDER')
    expect(preview.account_limit).toBe(UNLIMITED_ACCOUNT_LIMIT)
    expect(preview.features.account_proxy).toBe(true)
    expect(preview.founder_number).toBeNull()
    expect(base).toEqual(untouched)

    expect(service.setEnabled(owner, 'founder-benefits', false)).toBe(true)
    expect(service.resolveEntitlements(owner, base)).toBe(base)
    expect(service.resolveEntitlements(owner, base)).toEqual(untouched)
  })

  it('keeps a genuine Founder license and Founder number after revocation', () => {
    const founder: ResolvedEntitlements = {
      ...pro,
      plan: 'FOUNDER',
      account_limit: UNLIMITED_ACCOUNT_LIMIT,
      founder_number: 23,
      lifetime: true,
      expires_at: null,
    }
    const service = new OwnerToolsService(preferences(owner.email))
    service.authorize(owner, owner, admin)

    expect(service.resolveEntitlements(owner, founder).founder_number).toBe(23)
    service.revoke()
    expect(service.resolveEntitlements(owner, founder)).toBe(founder)
    expect(service.resolveEntitlements(member, founder)).toBe(founder)
  })

  it('does not let the creator visual switch grant Founder benefits', () => {
    const service = new OwnerToolsService(preferences())
    service.authorize(owner, owner, admin)
    service.setEnabled(owner, 'creator-tag', true)

    expect(service.isEnabled(owner, 'creator-tag')).toBe(true)
    expect(service.resolveEntitlements(owner, free)).toBe(free)
  })

  it('revokes active previews when revalidation fails or the authenticated account changes', () => {
    const service = new OwnerToolsService(preferences(owner.email))
    service.authorize(owner, owner, admin)
    expect(service.resolveEntitlements(owner, free).plan).toBe('FOUNDER')
    expect(service.resolveEntitlements(member, free)).toBe(free)
    expect(service.isAuthorized({ ...owner, email: member.email })).toBe(false)

    service.authorize(owner, null, admin)
    expect(service.isAuthorized(owner)).toBe(false)
    expect(service.resolveEntitlements(owner, free)).toBe(free)

    service.authorize(owner, owner, admin)
    service.authorize(member, member, { admin: { user_id: member.id, role: 'admin' } })
    expect(service.isAuthorized(owner)).toBe(false)
    expect(service.isAuthorized(member)).toBe(false)
    expect(service.resolveEntitlements(member, free)).toBe(free)
  })

  it('requires new backend authorization after explicit revocation', () => {
    const service = new OwnerToolsService(preferences(owner.email))
    service.authorize(owner, owner, admin)
    service.revoke()

    for (const tool of tools) {
      expect(service.isEnabled(owner, tool)).toBe(false)
      expect(service.setEnabled(owner, tool, true)).toBe(false)
    }
    expect(service.resolveEntitlements(owner, pro)).toBe(pro)
    service.authorize(owner, owner, admin)
    expect(service.isEnabled(owner, 'founder-benefits')).toBe(true)
  })

  it('fails closed when browser preferences cannot be read or written', () => {
    const blocked = vi.fn(() => { throw new Error('Storage blocked') })
    const service = new OwnerToolsService({ getItem: blocked, setItem: blocked, removeItem: blocked })
    service.authorize(owner, owner, admin)

    for (const tool of tools) {
      expect(service.isEnabled(owner, tool)).toBe(false)
      expect(service.setEnabled(owner, tool, true)).toBe(false)
    }
    expect(service.resolveEntitlements(owner, pro)).toBe(pro)
  })

  it('fails closed when storage does not exist', () => {
    const service = new OwnerToolsService(null)
    service.authorize(owner, owner, admin)

    expect(service.setEnabled(owner, 'founder-benefits', true)).toBe(false)
    expect(service.isEnabled(owner, 'founder-benefits')).toBe(false)
    expect(service.resolveEntitlements(owner, free)).toBe(free)
  })
})
