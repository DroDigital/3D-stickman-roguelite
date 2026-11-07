// PBR material layers (indices into the texture arrays built from assets/textures, see tools/fetch-assets.mjs).
// MAT.NONE (-1) draws an untextured surface: the instance colour with a fixed roughness.
export const MAT = {
  NONE: -1,
  ASH_GROUND: 0, ASH_ROCK: 1, SEA_GROUND: 2, SEA_ROCK: 3, VOID_GROUND: 4, VOID_ROCK: 5, FLESH_GROUND: 6, FLESH_ROCK: 7,
  BARK: 8, RUIN: 9, STEEL: 10, IRON: 11, CLOTH: 12, LEATHER: 13, BONE: 14, CORAL: 15, OBSIDIAN: 16, FLESH: 17,
  // special shading models (no texture)
  CRYSTAL: 100, SKIN: 101, GLASS: 102,
};

/** Per-realm terrain material pair and the rock used for boulders. */
export const REALM_MATS = {
  ashen: { ground: MAT.ASH_GROUND, rock: MAT.ASH_ROCK },
  drowned: { ground: MAT.SEA_GROUND, rock: MAT.SEA_ROCK },
  starless: { ground: MAT.VOID_GROUND, rock: MAT.VOID_ROCK },
  flesh: { ground: MAT.FLESH_GROUND, rock: MAT.FLESH_ROCK },
};
