import { describe, expect, it } from 'vitest'
import {
  BUNDLED_GAME_ICON_SLUGS,
  getBundledGameIconUrl,
} from './game-icon-assets'

const expectedSlugs = [
  'frenetic-world',
  'gengar-idle',
  'idle-world',
  'idledex',
  'idlepoke',
  'idlepokemoon',
  'jerimbia-idle',
  'poke-hero-world',
  'poke-idle-online',
  'pokehunt',
  'pokeidle-br',
  'pokeidle-io',
  'pokepixel-idle',
]

describe('game icon assets', () => {
  it('bundles an icon for every game promoted from the site catalog', () => {
    expect([...BUNDLED_GAME_ICON_SLUGS].sort()).toEqual(expectedSlugs.sort())

    for (const slug of expectedSlugs) {
      expect(getBundledGameIconUrl(slug)).toEqual(expect.any(String))
      expect(getBundledGameIconUrl(slug)).not.toBe('')
    }
  })

  it('keeps the existing fallback for games without a bundled icon', () => {
    expect(getBundledGameIconUrl('future-game')).toBeNull()
  })
})
