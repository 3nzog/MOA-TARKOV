// What each kind of loot container is worth to the route, by goal. The game
// does not publish container loot tables per spawn, so these are estimates:
// relative weights, not promises.
//
//   money     typical value of one search, in roubles
//   hideout   0–1: how often it holds hideout materials (tools, electronics,
//             building materials, medical supplies…)
//   guns / parts / ammo
//             0–1: how often it holds whole guns, weapon parts (sights,
//             scopes, mounts, handguards, magazines…) or ammunition
//
// Kinds are tarkov.dev's container normalizedName (data/snapshot/loot.json).
//
// Checked against community descriptions of what each container holds (weapon
// boxes: guns and parts; wooden crates: military loot; technical supply crates
// and toolboxes: industrial and electronic barter items; duffle bags can hold
// tools too) and of the money runs players make (Customs dorms, Interchange's
// tech stores, Reserve's base buildings, Streets' dealership, Lighthouse's
// water treatment plant), which the loot areas computed from these weights
// and the loose-loot prices match. Sources, consulted 2026-11:
//   https://escapefromtarkov.gamepedia.com/File:Jackets.png (container list)
//   https://primagames.com/tips/best-places-to-get-technical-loot-in-escape-from-tarkov
//   https://timesaver.gg/blog/tarkov-best-loot-runs
//   https://timesaver.gg/blog/tarkov-streets-money-guide
//   https://diamondlobby.com/escape-from-tarkov/where-to-find-scavs-customs-eft/

export interface ContainerIntel {
  money: number;
  hideout: number;
  guns: number;
  parts: number;
  ammo: number;
}

const NONE: ContainerIntel = { money: 5_000, hideout: 0.1, guns: 0, parts: 0, ammo: 0 };

export const CONTAINER_INTEL: Record<string, ContainerIntel> = {
  'safe': { money: 60_000, hideout: 0.2, guns: 0, parts: 0, ammo: 0 },
  'bank-safe': { money: 120_000, hideout: 0.2, guns: 0, parts: 0, ammo: 0 },
  'shturmans-stash': { money: 150_000, hideout: 0.3, guns: 0.5, parts: 0.5, ammo: 0.5 },
  'buried-barrel-cache': { money: 80_000, hideout: 0.3, guns: 0.6, parts: 0.6, ammo: 0.6 },
  'ground-cache': { money: 60_000, hideout: 0.4, guns: 0.3, parts: 0.5, ammo: 0.6 },
  'plastic-suitcase': { money: 45_000, hideout: 0.3, guns: 0.2, parts: 0.5, ammo: 0.2 },
  'pc-block': { money: 35_000, hideout: 0.9, guns: 0, parts: 0, ammo: 0 },
  'technical-supply-crate': { money: 40_000, hideout: 1, guns: 0, parts: 0.1, ammo: 0 },
  'toolbox': { money: 20_000, hideout: 1, guns: 0, parts: 0.1, ammo: 0 },
  'weapon-box': { money: 45_000, hideout: 0, guns: 1, parts: 0.8, ammo: 0.3 },
  'wooden-ammo-box': { money: 15_000, hideout: 0, guns: 0, parts: 0, ammo: 1 },
  'grenade-box': { money: 12_000, hideout: 0, guns: 0, parts: 0, ammo: 0.5 },
  'wooden-crate': { money: 12_000, hideout: 0.3, guns: 0.1, parts: 0.6, ammo: 0.4 },
  'medcase': { money: 30_000, hideout: 0.4, guns: 0, parts: 0, ammo: 0 },
  'medbag': { money: 10_000, hideout: 0.2, guns: 0, parts: 0, ammo: 0 },
  'medical-supply-crate': { money: 25_000, hideout: 0.5, guns: 0, parts: 0, ammo: 0 },
  'ration-supply-crate': { money: 15_000, hideout: 0.4, guns: 0, parts: 0, ammo: 0 },
  'jacket': { money: 12_000, hideout: 0.2, guns: 0, parts: 0, ammo: 0.2 },
  'duffle-bag': { money: 18_000, hideout: 0.4, guns: 0.1, parts: 0.3, ammo: 0.4 },
  'drawer': { money: 10_000, hideout: 0.5, guns: 0, parts: 0.1, ammo: 0.2 },
  'cash-register': { money: 8_000, hideout: 0.1, guns: 0, parts: 0, ammo: 0 },
  'bank-cash-register': { money: 20_000, hideout: 0.1, guns: 0, parts: 0, ammo: 0 },
  'dead-scav': { money: 15_000, hideout: 0.2, guns: 0.3, parts: 0.2, ammo: 0.4 },
  'scav-body': { money: 12_000, hideout: 0.2, guns: 0.2, parts: 0.2, ammo: 0.3 },
  'pmc-body': { money: 25_000, hideout: 0.2, guns: 0.3, parts: 0.3, ammo: 0.3 },
  'civilian-body': { money: 8_000, hideout: 0.2, guns: 0, parts: 0, ammo: 0 },
  'lab-technician-body': { money: 30_000, hideout: 0.4, guns: 0, parts: 0, ammo: 0 },
};

export function containerIntel(kind: string): ContainerIntel {
  return CONTAINER_INTEL[kind] ?? NONE;
}
