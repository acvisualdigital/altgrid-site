(function exposeStonerHuntCatalog(globalScope) {
  "use strict";

  // Snapshot do catálogo público do Stonegy usado pelo stonegy-party-rpa.
  // Linha: id, nome, nível recomendado, nível mínimo, premium, lure mínimo,
  // lure máximo, desbloqueada por padrão.
  const rows = [
    [1, "Sewers", 1, null, false, 1, 2, true],
    [2, "Forest", 2, 2, false, 1, 2, true],
    [5, "Darashia Minotaurs Surface", 6, 8, false, 1, 3, true],
    [6, "Amazon Camp Venore", 12, 8, false, 1, 2, true],
    [7, "Cyclops Mistrock Surface", 35, 15, false, 1, 4, true],
    [8, "Daramian Minotaur Pyramid", 30, 12, false, 3, 5, true],
    [9, "Venore Rotworms", 10, 8, false, 1, 2, true],
    [10, "Tiquanda Tarantula Cave", 20, 14, false, 1, 3, true],
    [11, "Tomb Floor I", 5, 4, false, 1, 2, true],
    [12, "Tomb Floor II", 19, 15, false, 1, 3, true],
    [13, "Tomb Floor III", 35, 18, true, 3, 7, true],
    [17, "Wasp Tower", 7, 8, false, 1, 2, true],
    [18, "Dragon Lair", 40, 30, false, 1, 2, true],
    [19, "Elf Quarter", 17, 13, true, 1, 2, true],
    [20, "Shadowthorn", 25, 12, false, 3, 3, true],
    [21, "Exotic Cave", 130, 90, true, 1, 6, true],
    [22, "Stonerefiner Cave", 45, 20, true, 1, 1, true],
    [23, "Dragon Valley", 90, 40, true, 1, 2, true],
    [24, "Hydras", 90, 50, true, 1, 5, true],
    [25, "Cyclopolis", 45, 25, false, 3, 5, true],
    [26, "Warlocks", 70, 55, false, 1, 1, true],
    [27, "Giant Spider Cave", 80, 40, false, 1, 3, true],
    [28, "Demons", 150, 90, true, 1, 3, true],
    [29, "Wyrms", 80, 45, true, 1, 5, true],
    [30, "Elder Wyrms II", 120, 80, false, 1, 7, true],
    [32, "Hero Fortress", 35, 25, false, 1, 4, true],
    [33, "Hero Fortress II", 55, 45, true, 1, 7, true],
    [35, "Necromancers", 50, 30, true, 1, 2, true],
    [36, "Bog Raiders", 45, 30, true, 1, 4, true],
    [37, "Feyrist Surface", 60, 30, true, 3, 4, true],
    [38, "Mutated Rats", 30, 18, true, 1, 3, true],
    [39, "Mutated II", 35, 20, true, 1, 4, true],
    [41, "Oramond Minos", 80, 50, false, 1, 5, true],
    [42, "Glooth Bandits", 140, 80, false, 3, 5, true],
    [43, "Lava Lurker", 100, 100, true, 4, 7, true],
    [44, "Gazer Spectre", 300, 100, true, 4, 7, true],
    [45, "Burster Spectre", 300, 100, true, 4, 7, true],
    [46, "Ripper Spectre", 300, 100, false, 4, 7, true],
    [48, "Gnomegate Magma Dungeon", 160, 130, true, 3, 7, true],
    [51, "Grimvale", 120, 75, true, 4, 7, true],
    [53, "Lizard Chosens", 100, 80, true, 1, 5, true],
    [54, "Draken Walls", 250, 150, false, 5, 7, true],
    [55, "Ghastly Dragons", 200, 100, true, 1, 1, true],
    [56, "Draken Abominations", 200, 150, true, 1, 2, true],
    [57, "Asura Palace", 230, 120, true, 4, 7, true],
    [58, "Lower Roshamuul", 150, 100, true, 3, 7, true],
    [59, "Lower Roshamuul Surface", 300, 180, true, 3, 7, true],
    [60, "Summer Court", 300, 150, false, 3, 8, true],
    [61, "Winter Court", 300, 150, false, 3, 8, true],
    [62, "Asura Vaults (True Asuras)", 350, 250, false, 3, 8, true],
    [63, "Nightmare Isles", 200, 130, false, 5, 8, true],
    [64, "Gnomegate Crystal Dungeon", 250, 130, true, 5, 8, true],
    [65, "Secret Library (Ice Section)", 450, 350, true, 4, 8, true],
    [66, "Ankrahmun Nomads", 15, 8, true, 1, 1, true],
    [67, "Hell Hub", 300, 200, true, 4, 8, true],
    [68, "Orc Fortress", 40, 30, false, 4, 6, true],
    [69, "Medusa Tower", 250, 150, true, 3, 7, true],
    [70, "Larva Cave", 8, 8, false, 2, 3, true],
    [71, "Scarab", 15, 8, true, 2, 3, true],
    [72, "Secret Library (Fire Section)", 450, 350, true, 4, 8, true],
    [73, "The Void", 200, 120, false, 5, 8, true],
    [74, "Ingol", 350, 250, true, 5, 8, true],
    [75, "Zombies", 30, 15, true, 1, 2, true],
    [76, "Roaring Lions", 70, 40, true, 2, 3, true],
    [77, "Crystal Caves", 250, 120, true, 5, 6, true],
    [79, "Crocodiles", 25, 20, false, 1, 2, true],
    [80, "Ape City", 35, 25, true, 5, 6, true],
    [81, "Terramites", 25, 15, true, 1, 1, true],
    [82, "Mother of Scarabs lair", 80, 55, true, 5, 7, true],
    [83, "Killer Caiman", 75, 50, true, 1, 2, true],
    [84, "Zao Plantations", 200, 130, true, 4, 7, true],
    [85, "Hellspawns", 120, 70, true, 1, 3, true],
    [86, "Ruins Of Krailos", 110, 65, true, 3, 5, true],
    [87, "Behemoths", 130, 80, true, 1, 3, true],
    [88, "Sea Serpents", 130, 90, true, 2, 4, true],
    [89, "Crystal Spiders", 55, 45, false, 1, 2, true],
    [90, "Stone Golems", 35, 25, false, 2, 3, true],
    [91, "Gargoyle Sanctuary", 30, 23, true, 2, 4, true],
    [92, "Lizard City", 130, 90, true, 5, 7, true],
    [93, "Nightmares", 120, 70, true, 2, 3, true],
    [94, "Coryms", 30, 15, false, 2, 4, true],
    [95, "Carniphila", 35, 28, true, 2, 3, true],
    [96, "Gnomegate Fungus Dungeon", 200, 100, true, 2, 7, true],
    [97, "Yielothax", 90, 75, true, 3, 1, true],
    [98, "Grim Reapers", 180, 130, true, 1, 3, true],
    [99, "Werehyaenas", 200, 140, true, 3, 7, true],
    [100, "Werelions", 350, 250, true, 7, 4, true],
    [101, "Cults", 35, 25, false, 1, 2, true],
    [102, "Goanna", 400, 300, true, 6, 7, true],
    [103, "Killmaresh Catacombs", 400, 300, true, 4, 7, true],
    [104, "Pirates", 50, 25, true, 5, 7, true],
    [105, "Hive", 130, 90, true, 4, 7, true],
    [106, "Gloom Wolfs", 30, 15, false, 2, 3, true],
    [107, "Swamp Trolls", 8, 8, false, 1, 3, true],
    [108, "Rorcs", 25, 13, false, 1, 2, true],
    [109, "Ghostlands", 60, 35, false, 2, 4, true],
    [110, "Putrid Mummy", 90, 60, true, 2, 5, true],
    [111, "Marsh Stalkers", 8, 8, false, 2, 4, true],
    [112, "Formorgar Mines", 250, 150, true, 5, 3, true],
    [113, "Quaras", 130, 80, true, 5, 7, true],
    [114, "The Void", 300, 180, true, 5, 7, true],
    [115, "Mino Mountain Hideout", 200, 100, true, 5, 7, true],
    [116, "Krailos Steppe", 80, 45, true, 3, 4, true],
    [117, "Frost Troll", 8, 8, false, 1, 3, true],
    [118, "Mammoth", 12, 11, false, 1, 3, true],
    [119, "Barbarian Camp", 35, 18, false, 3, 5, false],
    [120, "Frost Giants", 40, 25, false, 1, 2, false],
    [121, "Drefia Vampires", 70, 35, true, 2, 4, true],
    [122, "Weakened Frazzlemaw", 130, 80, true, 2, 4, true],
    [123, "Deeplings", 220, 150, true, 2, 3, true],
    [124, "Wyverns", 45, 30, false, 1, 1, true],
    [125, "Seacrest Serpents", 130, 100, true, 2, 3, true],
    [126, "Forest Fury", 50, 30, true, 3, 6, true],
    [127, "Crabs", 20, 15, false, 1, 2, true],
    [128, "Catacombs", 250, 200, true, 4, 7, true],
    [129, "Bashmu", 350, 300, true, 4, 7, true],
    [130, "Wardragons", 800, 500, true, 4, 7, false],
    [131, "Lost Souls", 600, 400, true, 5, 7, true],
  ];

  const LURE_LEVELS = Object.freeze(
    Array.from({ length: 7 }, (_unused, index) =>
      Object.freeze({
        id: index + 1,
        minCreatures: index + 1,
        maxCreatures: index + 2,
      }),
    ),
  );
  const HUNTS = Object.freeze(
    rows.map(
      ([
        id,
        title,
        recommendedLevel,
        levelMin,
        premium,
        minLureId,
        maxLureId,
        unlockedByDefault,
      ]) =>
        Object.freeze({
          id,
          title,
          recommendedLevel,
          levelMin,
          premium,
          minLureId,
          maxLureId,
          unlockedByDefault,
        }),
    ),
  );
  const huntsById = new Map(HUNTS.map((hunt) => [hunt.id, hunt]));

  function getById(id) {
    return huntsById.get(Number(id)) ?? null;
  }

  function findByTitle(title) {
    const expected = String(title ?? "")
      .trim()
      .toLocaleLowerCase("pt-BR");
    return (
      [...HUNTS]
        .sort(
          (left, right) =>
            left.recommendedLevel - right.recommendedLevel ||
            left.id - right.id,
        )
        .find(
          (hunt) => hunt.title.toLocaleLowerCase("pt-BR") === expected,
        ) ?? null
    );
  }

  function lureLevelsForHunt(huntOrId) {
    const hunt =
      typeof huntOrId === "object" ? huntOrId : getById(huntOrId);
    if (!hunt) return [];
    const minimum = Math.min(
      7,
      Math.max(1, Number(hunt.minLureId) || 1),
    );
    const maximum = Math.min(
      7,
      Math.max(1, Number(hunt.maxLureId) || minimum),
    );
    if (maximum < minimum) return [LURE_LEVELS[minimum - 1]];
    return LURE_LEVELS.filter(
      (lure) => lure.id >= minimum && lure.id <= maximum,
    );
  }

  function creatureOptions(huntOrId) {
    return lureLevelsForHunt(huntOrId).map(
      (lure) => lure.maxCreatures,
    );
  }

  function resolveCreatureLimit(huntOrId, requestedLimit) {
    const options = creatureOptions(huntOrId);
    const requested = Number(requestedLimit);
    return options.includes(requested)
      ? requested
      : (options.at(-1) ?? null);
  }

  const api = {
    HUNTS,
    LURE_LEVELS,
    creatureOptions,
    findByTitle,
    getById,
    lureLevelsForHunt,
    resolveCreatureLimit,
  };

  globalScope.StonerHuntCatalog = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis === "undefined" ? window : globalThis);
