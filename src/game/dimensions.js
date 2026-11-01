// Dimension (biome) themes: environment lighting, terrain, props, enemy pools, bosses and ambient effects.
import { hexToRgb as H } from '../core/math.js';

export const DIMENSIONS = [
  {
    id: 'ashen',
    name: 'The Ashen Hollows',
    sub: 'Where the burnt gods sleep beneath grey snow',
    env: {
      fogCol: H('#3a2228'), skyTop: H('#07030a'), nebula: H('#5a1a1a'), moonDir: [0.35, 0.32, -1], moonCol: H('#ff7a2e'),
      sunDir: [0.45, 0.75, -0.48], sunCol: H('#8a5a48'), skyCol: H('#4a3640'), gndCol: H('#1e1012'), rimCol: H('#ff6a3a'),
      fogNear: 22, fogFar: 105, fogHeight: 0.07, stars: 0.6,
    },
    terrain: { amp: 7, freq: 0.011, ridge: 5, low: H('#3a3434'), high: H('#6d6560'), steep: H('#2a2224'), accent: H('#7a2a18'), veins: 0.35 },
    props: { deadTree: 0.9, boneSpire: 0.5, rock: 0.8, ruinPillar: 0.4, urn: 0.5, brazier: 0.18, crystal: 0.12 },
    ambient: { kind: 'embers', color: H('#ff8a3a'), color2: H('#9a9090') },
    enemies: { husk: 10, hound: 5, crawler: 3, gazer: 2, brute: 1.5, choir: 0.8, maw: 0.6 },
    boss: 'shepherd',
    blood: H('#6a0a10'), ash: H('#5a5050'),
  },
  {
    id: 'drowned',
    name: 'The Drowned Abyss',
    sub: 'A seafloor that remembers the sky',
    env: {
      fogCol: H('#0b2a33'), skyTop: H('#01070d'), nebula: H('#0f4a5a'), moonDir: [-0.4, 0.45, -1], moonCol: H('#5affd8'),
      sunDir: [-0.3, 0.85, 0.4], sunCol: H('#3a6a78'), skyCol: H('#2a5560'), gndCol: H('#06161a'), rimCol: H('#3affd0'),
      fogNear: 18, fogFar: 92, fogHeight: 0.1, stars: 0.3,
    },
    terrain: { amp: 9, freq: 0.014, ridge: 4, low: H('#1d3a3c'), high: H('#4a6d66'), steep: H('#122426'), accent: H('#1aa08a'), veins: 0.25 },
    props: { coral: 1.0, tendril: 0.6, rock: 0.7, eggSac: 0.45, crystal: 0.35, ruinPillar: 0.3, brazier: 0.06 },
    ambient: { kind: 'bubbles', color: H('#7affe6'), color2: H('#2a8a9a') },
    enemies: { husk: 6, crawler: 7, gazer: 4, hound: 3, maw: 1.4, brute: 1.2, choir: 1 },
    boss: 'leviathan',
    blood: H('#0a4a40'), ash: H('#2a4a4a'),
  },
  {
    id: 'starless',
    name: 'The Starless Veil',
    sub: 'The space between thoughts of a dreaming god',
    env: {
      fogCol: H('#1c1030'), skyTop: H('#020008'), nebula: H('#5a2a9a'), moonDir: [0.1, 0.55, -1], moonCol: H('#d08aff'),
      sunDir: [0.2, 0.9, 0.3], sunCol: H('#5a4a8a'), skyCol: H('#3a2a5a'), gndCol: H('#0e0618'), rimCol: H('#b07aff'),
      fogNear: 26, fogFar: 125, fogHeight: 0.05, stars: 2.2,
    },
    terrain: { amp: 11, freq: 0.009, ridge: 7, low: H('#2a2240'), high: H('#5a4a7a'), steep: H('#140c22'), accent: H('#8a3aff'), veins: 0.45 },
    props: { monolith: 0.6, crystal: 0.9, rock: 0.6, boneSpire: 0.3, urn: 0.35, floatRock: 0.6, brazier: 0.08 },
    ambient: { kind: 'stars', color: H('#e0c0ff'), color2: H('#6a4aff') },
    enemies: { gazer: 6, choir: 4, husk: 5, crawler: 3, hound: 4, brute: 1.5, maw: 0.8 },
    boss: 'oculus',
    blood: H('#3a0a6a'), ash: H('#4a3a6a'),
  },
  {
    id: 'flesh',
    name: 'The Flesh Cathedral',
    sub: 'It breathes. It has always been breathing.',
    env: {
      fogCol: H('#3a0c12'), skyTop: H('#0a0003'), nebula: H('#8a0a2a'), moonDir: [-0.2, 0.38, -1], moonCol: H('#ffd04a'),
      sunDir: [-0.4, 0.8, -0.3], sunCol: H('#9a4040'), skyCol: H('#5a2026'), gndCol: H('#200608'), rimCol: H('#ff3a5a'),
      fogNear: 18, fogFar: 95, fogHeight: 0.09, stars: 0.4,
    },
    terrain: { amp: 6, freq: 0.016, ridge: 3, low: H('#5a1a20'), high: H('#9a5048'), steep: H('#300a0e'), accent: H('#d02040'), veins: 0.55 },
    props: { ribcage: 0.5, tendril: 0.9, eggSac: 0.6, boneSpire: 0.6, urn: 0.3, brazier: 0.12 },
    ambient: { kind: 'spores', color: H('#ff6a6a'), color2: H('#ffd04a') },
    enemies: { husk: 6, hound: 5, crawler: 5, brute: 2.5, maw: 2, choir: 2, gazer: 2 },
    boss: 'shepherd',
    blood: H('#7a0010'), ash: H('#5a2a2a'),
  },
];

export function dimensionFor(depth) {
  return DIMENSIONS[depth % DIMENSIONS.length];
}
