/**
 * Weapon Catalog — typed registry of all available weapon models
 * with bone attachment slots, animation pack mapping, and class restrictions.
 *
 * Based on the Fantasy Weapons Pack (59 FBX models) + Grudge Warlords
 * weapon type system (17 weapon types × 6 tiers).
 *
 * Bone attachment follows the Grudge character rig convention:
 *   - R_hand_container → primary weapon (swords, axes, maces, wands)
 *   - L_hand_container → off-hand weapon (daggers, orbs, shields)
 *   - L_shield_container → shields (buckler, wooden, tower)
 *   - Back_container → 2H weapons when sheathed
 *
 * Animation packs map weapon types to the correct locomotion/combat
 * animation set so the character plays the right swing/draw/cast.
 */

// ── Weapon Types ─────────────────────────────────────────────────────

export type WeaponType =
  | "sword" | "shortSword" | "broadSword" | "twoHandedSword"
  | "axe" | "smallAxe" | "doubleAxe" | "handAxe"
  | "mace" | "hammer" | "smallHammer" | "bigHammer" | "morningStar"
  | "dagger"
  | "staff" | "battleStaff" | "wand"
  | "polearm" | "pike" | "trident" | "javelin"
  | "scythe"
  | "cleaver" | "machete"
  | "club"
  | "shield" | "buckler" | "woodenShield"
  | "orb"
  | "bow" | "crossbow" | "longbow";

export type WeaponSlot = "mainHand" | "offHand" | "twoHand" | "shield";
export type BoneTarget = "R_hand_container" | "L_hand_container" | "L_shield_container" | "Back_container";

export type AnimationPack =
  | "1h-sword-shield"
  | "2h-melee"
  | "longbow"
  | "magic-staff"
  | "rifle-crossbow"
  | "dual-wield"
  | "unarmed";

// ── Weapon Entry ─────────────────────────────────────────────────────

export interface WeaponEntry {
  /** Unique key for the weapon. */
  key: string;
  /** Display name. */
  name: string;
  /** Category for grouping. */
  type: WeaponType;
  /** Which hand slot this weapon occupies. */
  slot: WeaponSlot;
  /** Which bone to attach to on the character rig. */
  bone: BoneTarget;
  /** Which animation pack to use when this weapon is equipped. */
  animPack: AnimationPack;
  /** Source file in the Fantasy Weapons Pack (FBX). */
  sourceFile: string;
  /** Variants (e.g. Sword_B, Sword_Stylized). */
  variants?: string[];
  /** Base damage at tier 1 (scales with tier). */
  baseDamage: number;
  /** Attack speed in swings per second. */
  attackSpeed: number;
  /** Classes that can equip this weapon type. */
  classes: Array<"warrior" | "mage" | "ranger" | "worge">;
}

// ── Catalog ──────────────────────────────────────────────────────────

export const WEAPON_CATALOG: WeaponEntry[] = [
  // ── Swords (1H) ──
  { key: "sword", name: "Sword", type: "sword", slot: "mainHand", bone: "R_hand_container", animPack: "1h-sword-shield", sourceFile: "Sword.fbx", variants: ["Sword_B.fbx"], baseDamage: 8, attackSpeed: 1.2, classes: ["warrior", "ranger"] },
  { key: "short-sword", name: "Short Sword", type: "shortSword", slot: "mainHand", bone: "R_hand_container", animPack: "1h-sword-shield", sourceFile: "ShortSword.fbx", baseDamage: 6, attackSpeed: 1.5, classes: ["warrior", "ranger"] },
  { key: "broad-sword", name: "Broad Sword", type: "broadSword", slot: "mainHand", bone: "R_hand_container", animPack: "1h-sword-shield", sourceFile: "BroadSword.fbx", variants: ["BroadSword_B.fbx", "BroadSword_Stylized.fbx"], baseDamage: 10, attackSpeed: 1.0, classes: ["warrior"] },
  { key: "two-handed-sword", name: "Two-Handed Sword", type: "twoHandedSword", slot: "twoHand", bone: "R_hand_container", animPack: "2h-melee", sourceFile: "TwoHandedSword.fbx", variants: ["TwoHandedSword_B.fbx", "TwoHandedSword_Stylized.fbx"], baseDamage: 14, attackSpeed: 0.8, classes: ["warrior"] },

  // ── Axes ──
  { key: "axe", name: "Axe", type: "axe", slot: "mainHand", bone: "R_hand_container", animPack: "1h-sword-shield", sourceFile: "Axe.fbx", baseDamage: 9, attackSpeed: 1.1, classes: ["warrior", "worge"] },
  { key: "small-axe", name: "Small Axe", type: "smallAxe", slot: "mainHand", bone: "R_hand_container", animPack: "1h-sword-shield", sourceFile: "SmallAxe.fbx", baseDamage: 6, attackSpeed: 1.4, classes: ["warrior", "ranger"] },
  { key: "double-axe", name: "Double Axe", type: "doubleAxe", slot: "twoHand", bone: "R_hand_container", animPack: "2h-melee", sourceFile: "DoubleAxe.fbx", baseDamage: 13, attackSpeed: 0.9, classes: ["warrior"] },
  { key: "hand-axe", name: "Hand Axe", type: "handAxe", slot: "mainHand", bone: "R_hand_container", animPack: "1h-sword-shield", sourceFile: "HandAxe.fbx", baseDamage: 7, attackSpeed: 1.3, classes: ["warrior", "ranger"] },

  // ── Maces / Hammers ──
  { key: "mace", name: "Mace", type: "mace", slot: "mainHand", bone: "R_hand_container", animPack: "1h-sword-shield", sourceFile: "Mace.fbx", baseDamage: 9, attackSpeed: 1.0, classes: ["warrior", "worge"] },
  { key: "hammer", name: "Hammer", type: "hammer", slot: "mainHand", bone: "R_hand_container", animPack: "1h-sword-shield", sourceFile: "Hammer.fbx", baseDamage: 10, attackSpeed: 0.9, classes: ["warrior", "worge"] },
  { key: "small-hammer", name: "Small Hammer", type: "smallHammer", slot: "mainHand", bone: "R_hand_container", animPack: "1h-sword-shield", sourceFile: "SmallHammer.fbx", baseDamage: 7, attackSpeed: 1.2, classes: ["warrior"] },
  { key: "big-hammer", name: "Big Hammer", type: "bigHammer", slot: "twoHand", bone: "R_hand_container", animPack: "2h-melee", sourceFile: "BigHammer.fbx", baseDamage: 16, attackSpeed: 0.7, classes: ["warrior"] },
  { key: "morning-star", name: "Morning Star", type: "morningStar", slot: "mainHand", bone: "R_hand_container", animPack: "1h-sword-shield", sourceFile: "MorningStar.fbx", baseDamage: 11, attackSpeed: 0.9, classes: ["warrior"] },

  // ── Daggers ──
  { key: "dagger", name: "Dagger", type: "dagger", slot: "mainHand", bone: "R_hand_container", animPack: "dual-wield", sourceFile: "Dagger.fbx", variants: ["Dagger_B.fbx", "Dagger_C.fbx", "Dagger_D.fbx"], baseDamage: 5, attackSpeed: 2.0, classes: ["ranger", "worge"] },

  // ── Staves / Wands ──
  { key: "staff", name: "Staff", type: "staff", slot: "twoHand", bone: "R_hand_container", animPack: "magic-staff", sourceFile: "Staff.fbx", variants: ["Staff_B.fbx", "Staff_C.fbx"], baseDamage: 7, attackSpeed: 1.0, classes: ["mage", "worge"] },
  { key: "battle-staff", name: "Battle Staff", type: "battleStaff", slot: "twoHand", bone: "R_hand_container", animPack: "2h-melee", sourceFile: "BattleStaff.fbx", baseDamage: 12, attackSpeed: 0.85, classes: ["mage", "worge"] },
  { key: "wand", name: "Wand", type: "wand", slot: "mainHand", bone: "R_hand_container", animPack: "magic-staff", sourceFile: "Wand.fbx", variants: ["Wand_B.fbx"], baseDamage: 6, attackSpeed: 1.3, classes: ["mage"] },

  // ── Polearms ──
  { key: "polearm", name: "Polearm", type: "polearm", slot: "twoHand", bone: "R_hand_container", animPack: "2h-melee", sourceFile: "PoleArm.fbx", variants: ["PoleArm_B.fbx", "PoleArm_C.fbx"], baseDamage: 12, attackSpeed: 0.85, classes: ["warrior", "ranger"] },
  { key: "pike", name: "Pike", type: "pike", slot: "twoHand", bone: "R_hand_container", animPack: "2h-melee", sourceFile: "Pike.fbx", baseDamage: 11, attackSpeed: 0.9, classes: ["warrior"] },
  { key: "trident", name: "Trident", type: "trident", slot: "twoHand", bone: "R_hand_container", animPack: "2h-melee", sourceFile: "Trident.fbx", baseDamage: 13, attackSpeed: 0.85, classes: ["warrior", "ranger"] },
  { key: "javelin", name: "Javelin", type: "javelin", slot: "mainHand", bone: "R_hand_container", animPack: "1h-sword-shield", sourceFile: "Javelin.fbx", baseDamage: 8, attackSpeed: 1.1, classes: ["ranger", "warrior"] },

  // ── Scythes ──
  { key: "scythe", name: "Scythe", type: "scythe", slot: "twoHand", bone: "R_hand_container", animPack: "2h-melee", sourceFile: "Sythe.fbx", variants: ["Sythe_B.fbx", "Sythe_C.fbx"], baseDamage: 14, attackSpeed: 0.8, classes: ["worge", "warrior"] },
  { key: "small-scythe", name: "Small Scythe", type: "scythe", slot: "mainHand", bone: "R_hand_container", animPack: "1h-sword-shield", sourceFile: "SmallSythe.fbx", variants: ["SmallSythe_B.fbx"], baseDamage: 9, attackSpeed: 1.1, classes: ["worge", "ranger"] },

  // ── Cleavers / Machetes ──
  { key: "cleaver", name: "Cleaver", type: "cleaver", slot: "mainHand", bone: "R_hand_container", animPack: "1h-sword-shield", sourceFile: "ButcherCleaver.fbx", variants: ["ButcherCleaver_B.fbx", "SmallButcherCleaver.fbx", "SmallCleaver.fbx", "LongCleaver.fbx"], baseDamage: 8, attackSpeed: 1.2, classes: ["warrior", "ranger"] },
  { key: "machete", name: "Machete", type: "machete", slot: "mainHand", bone: "R_hand_container", animPack: "1h-sword-shield", sourceFile: "Machete.fbx", variants: ["SmallMachete.fbx"], baseDamage: 7, attackSpeed: 1.3, classes: ["ranger", "warrior"] },

  // ── Clubs ──
  { key: "club", name: "Club", type: "club", slot: "mainHand", bone: "R_hand_container", animPack: "1h-sword-shield", sourceFile: "Club.fbx", variants: ["Club_B.fbx", "Club_C.fbx"], baseDamage: 7, attackSpeed: 1.0, classes: ["warrior", "worge"] },

  // ── Shields ──
  { key: "shield", name: "Shield", type: "shield", slot: "shield", bone: "L_shield_container", animPack: "1h-sword-shield", sourceFile: "Shield.fbx", baseDamage: 0, attackSpeed: 0, classes: ["warrior"] },
  { key: "buckler", name: "Buckler", type: "buckler", slot: "shield", bone: "L_shield_container", animPack: "1h-sword-shield", sourceFile: "Shield.Buckler.fbx", baseDamage: 0, attackSpeed: 0, classes: ["warrior", "ranger"] },
  { key: "wooden-shield", name: "Wooden Shield", type: "woodenShield", slot: "shield", bone: "L_shield_container", animPack: "1h-sword-shield", sourceFile: "WoodenShield.fbx", variants: ["WoodenShield_B.fbx"], baseDamage: 0, attackSpeed: 0, classes: ["warrior"] },

  // ── Off-hand ──
  { key: "orb", name: "Orb", type: "orb", slot: "offHand", bone: "L_hand_container", animPack: "magic-staff", sourceFile: "Orb.fbx", variants: ["Orb_B.fbx"], baseDamage: 0, attackSpeed: 0, classes: ["mage"] },
];

// ── Animation pack mapping ───────────────────────────────────────────

export interface AnimPackInfo {
  id: AnimationPack;
  label: string;
  /** Source zip in GrudgeSystems. */
  sourceZip: string;
  clips: string[];
}

export const ANIMATION_PACKS: AnimPackInfo[] = [
  {
    id: "1h-sword-shield",
    label: "1H Sword + Shield",
    sourceZip: "Pro Sword and Shield Pack (1).zip",
    clips: ["idle", "walk", "run", "attack-1", "attack-2", "attack-3", "block", "block-hit", "dodge", "death"],
  },
  {
    id: "2h-melee",
    label: "2H Melee",
    sourceZip: "Pro Melee Axe Pack.zip",
    clips: ["idle", "walk", "run", "attack-overhead", "attack-swing", "attack-thrust", "dodge", "death"],
  },
  {
    id: "longbow",
    label: "Longbow / Bow",
    sourceZip: "Pro Longbow Pack (1).zip",
    clips: ["idle", "walk", "run", "draw", "aim", "release", "dodge", "death"],
  },
  {
    id: "magic-staff",
    label: "Magic Staff / Wand",
    sourceZip: "magicstaffs.zip",
    clips: ["idle", "walk", "run", "cast-1", "cast-2", "channel", "dodge", "death"],
  },
  {
    id: "rifle-crossbow",
    label: "Rifle / Crossbow",
    sourceZip: "CROSSSBOW.zip",
    clips: ["idle", "walk", "run", "aim", "fire", "reload", "dodge", "death"],
  },
  {
    id: "dual-wield",
    label: "Dual Wield (Daggers)",
    sourceZip: "Male Locomotion Pack (1).zip",
    clips: ["idle", "walk", "run", "attack-left", "attack-right", "attack-combo", "dodge", "death"],
  },
  {
    id: "unarmed",
    label: "Unarmed / Fists",
    sourceZip: "Male Locomotion Pack (1).zip",
    clips: ["idle", "walk", "run", "punch-left", "punch-right", "kick", "dodge", "death"],
  },
];

// ── Helpers ──────────────────────────────────────────────────────────

export function findWeapon(key: string): WeaponEntry | undefined {
  return WEAPON_CATALOG.find((w) => w.key === key);
}

export function weaponsByType(type: WeaponType): WeaponEntry[] {
  return WEAPON_CATALOG.filter((w) => w.type === type);
}

export function weaponsByClass(cls: string): WeaponEntry[] {
  return WEAPON_CATALOG.filter((w) => w.classes.includes(cls as WeaponEntry["classes"][number]));
}

export function weaponsBySlot(slot: WeaponSlot): WeaponEntry[] {
  return WEAPON_CATALOG.filter((w) => w.slot === slot);
}

export function getAnimPack(id: AnimationPack): AnimPackInfo | undefined {
  return ANIMATION_PACKS.find((p) => p.id === id);
}

/** Get all weapon keys (for AI tool enum). */
export function allWeaponKeys(): string[] {
  return WEAPON_CATALOG.map((w) => w.key);
}
