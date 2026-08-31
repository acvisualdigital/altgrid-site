import freneticWorldIconUrl from '../docs/assets/game-icons/frenetic-world-official.png'
import gengarIdleIconUrl from '../docs/assets/game-icons/gengar-idle-official.png'
import idleWorldIconUrl from '../docs/assets/game-icons/idle-world-official.png'
import idleDexIconUrl from '../docs/assets/game-icons/idledex-official.png'
import idlePokeIconUrl from '../docs/assets/game-icons/idlepoke-official.png'
import idlePokeMoonIconUrl from '../docs/assets/game-icons/idlepokemoon-official.png'
import jerimbiaIdleIconUrl from '../docs/assets/game-icons/jerimbia-idle-official.png'
import pokeHeroWorldIconUrl from '../docs/assets/game-icons/poke-hero-world-official.png'
import pokeIdleOnlineIconUrl from '../docs/assets/game-icons/poke-idle-online.svg'
import pokeHuntIconUrl from '../docs/assets/game-icons/pokehunt-official.png'
import pokeIdleBrIconUrl from '../docs/assets/game-icons/pokeidle-br-official.png'
import pokeIdleIoIconUrl from '../docs/assets/game-icons/pokeidle-io-official.png'
import pokePixelIdleIconUrl from '../docs/assets/game-icons/pokepixel-idle-official.png'

const GAME_ICON_ASSETS: Readonly<Record<string, string>> = Object.freeze({
  'frenetic-world': freneticWorldIconUrl,
  'gengar-idle': gengarIdleIconUrl,
  'idle-world': idleWorldIconUrl,
  'idledex': idleDexIconUrl,
  'idlepoke': idlePokeIconUrl,
  'idlepokemoon': idlePokeMoonIconUrl,
  'jerimbia-idle': jerimbiaIdleIconUrl,
  'poke-hero-world': pokeHeroWorldIconUrl,
  'poke-idle-online': pokeIdleOnlineIconUrl,
  'pokehunt': pokeHuntIconUrl,
  'pokeidle-br': pokeIdleBrIconUrl,
  'pokeidle-io': pokeIdleIoIconUrl,
  'pokepixel-idle': pokePixelIdleIconUrl,
})

export function getBundledGameIconUrl(slug: string): string | null {
  return GAME_ICON_ASSETS[slug] ?? null
}

export const BUNDLED_GAME_ICON_SLUGS = Object.freeze(
  Object.keys(GAME_ICON_ASSETS),
)
