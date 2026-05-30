/**
 * RPG / MMO Game UI asset registry.
 *
 * Source: craftpix.net — "RPG & MMO Game UI" (perpetual license).
 * Textures live at /ui/rpg-mmo/ in the game-forge public directory and are
 * served as static assets by both Vite dev and the production build.
 *
 * Usage:
 *   import { UI } from "@/lib/uiAssets";
 *   <img src={UI.unitFrame.avatar.border} />
 *   <div style={{ backgroundImage: `url(${UI.general.background})` }} />
 */

const B = "/ui/rpg-mmo";

// ─── General frames & backgrounds ──────────────────────────────────────
export const general = {
  background: `${B}/General/General_Background.png`,
  borderTop: `${B}/General/General_Background_Border_Top.png`,
  borderBottom: `${B}/General/General_Background_Border_Bottom.png`,
  borderLeft: `${B}/General/General_Background_Border_Left.png`,
  borderRight: `${B}/General/General_Background_Border_Right.png`,
  borderDecoration: `${B}/General/General_Border_Decoration.png`,
  brokenBorderTop: `${B}/General/General_Broken_Border_Top.png`,
  brokenBorderBottom: `${B}/General/General_Broken_Border_Bottom.png`,
  brokenBorderVertical: `${B}/General/General_Broken_Border_Vertical.png`,
  brokenBordersSquare: `${B}/General/General_Broken_Borders_Square.png`,
  cornerLines: `${B}/General/General_Corner_Lines.png`,
  arrowDown: `${B}/General/General_Arrow_Down.png`,
  arrowRight: `${B}/General/General_Arrow_Right.png`,
} as const;

// ─── Unit Frames (player & party health/mana bars) ─────────────────────
export const unitFrame = {
  avatar: {
    background: `${B}/Unit Frames/Avatar/UnitFrame_Avatar_Background.png`,
    border: `${B}/Unit Frames/Avatar/UnitFrame_Avatar_Border.png`,
    overlay: `${B}/Unit Frames/Avatar/UnitFrame_Avatar_Overlay.png`,
  },
  bars: {
    hpBackground: `${B}/Unit Frames/Bars/UnitFrame_PB_Background.png`,
    hpFill: `${B}/Unit Frames/Bars/UnitFrame_PB_Fill.png`,
    mpBackground: `${B}/Unit Frames/Bars/UnitFrame_SB_Background.png`,
    mpFill: `${B}/Unit Frames/Bars/UnitFrame_SB_Fill.png`,
    partyHpBackground: `${B}/Unit Frames/Bars/UnitFrame_Party_PB_Background.png`,
    partySbBackground: `${B}/Unit Frames/Bars/UnitFrame_Party_SB_Background.png`,
  },
  level: {
    background: `${B}/Unit Frames/Level Frame/UnitFrame_LevelFrame_Background.png`,
    border: `${B}/Unit Frames/Level Frame/UnitFrame_LevelFrame_Border.png`,
    borderThick: `${B}/Unit Frames/Level Frame/UnitFrame_LevelFrame_Border_Thick.png`,
    skull: `${B}/Unit Frames/Level Frame/UnitFrame_LevelFrame_Skull.png`,
    partyBackground: `${B}/Unit Frames/Level Frame/UnitFrame_Party_LevelFrame_Background.png`,
    partyBorder: `${B}/Unit Frames/Level Frame/UnitFrame_Party_LevelFrame_Border.png`,
  },
  role: {
    background: `${B}/Unit Frames/Role Frame/UnitFrame_RoleFrame_Background.png`,
    border: `${B}/Unit Frames/Role Frame/UnitFrame_RoleFrame_Border.png`,
    partyBackground: `${B}/Unit Frames/Role Frame/UnitFrame_Party_RoleFrame_Background.png`,
    partyBorder: `${B}/Unit Frames/Role Frame/UnitFrame_Party_RoleFrame_Border.png`,
    icons: {
      shield: `${B}/Unit Frames/Role Frame/Icons/Shield.png`,
      shieldSmall: `${B}/Unit Frames/Role Frame/Icons/Shield_Small.png`,
      spell: `${B}/Unit Frames/Role Frame/Icons/Spell.png`,
      spellSmall: `${B}/Unit Frames/Role Frame/Icons/Spell_Small.png`,
      sword: `${B}/Unit Frames/Role Frame/Icons/Sword.png`,
      swordSmall: `${B}/Unit Frames/Role Frame/Icons/Sword_Small.png`,
    },
  },
  comboPoints: {
    background: `${B}/Unit Frames/Combo Points/UnitFrame_ComboPoints_Background.png`,
    fill: `${B}/Unit Frames/Combo Points/UnitFrame_ComboPoints_Fill.png`,
  },
  buffFrame: `${B}/Unit Frames/UnitFrame_Buff_Frame.png`,
  mobile: {
    border: `${B}/Unit Frames/Mobile_UnitFrame_Border.png`,
    fillHp: `${B}/Unit Frames/Mobile_UnitFrame_Fill_HP.png`,
    fillMp: `${B}/Unit Frames/Mobile_UnitFrame_Fill_MP.png`,
    skull: `${B}/Unit Frames/Mobile_UnitFrame_Skull.png`,
  },
} as const;

// ─── Action Bar ────────────────────────────────────────────────────────
export const actionBar = {
  avatarFrame: {
    background: `${B}/Action Bar/Avatar Frame/AB_AvatarFrame_Background.png`,
    backgroundBottom: `${B}/Action Bar/Avatar Frame/AB_AvatarFrame_Background_Bottom.png`,
    backgroundTop: `${B}/Action Bar/Avatar Frame/AB_AvatarFrame_Background_Top.png`,
    border: `${B}/Action Bar/Avatar Frame/AB_AvatarFrame_Border.png`,
  },
  slots: {
    mainBackground: `${B}/Action Bar/Slots/AB_MainSlot_Background.png`,
    mainBorder: `${B}/Action Bar/Slots/AB_MainSlot_Border.png`,
    mainCooldown: `${B}/Action Bar/Slots/AB_MainSlot_Cooldown.png`,
    mainPress: `${B}/Action Bar/Slots/AB_MainSlot_Press.png`,
    extraBorder: `${B}/Action Bar/Slots/AB_ExtraSlot_Border.png`,
  },
  xpBar: {
    background: `${B}/Action Bar/XP Bar/AB_XPBar_Background.png`,
    fill: `${B}/Action Bar/XP Bar/AB_XPBar_Fill.png`,
    tooltip: {
      arrow: `${B}/Action Bar/XP Bar/Tooltip/AB_XPBar_Tooltip_Arrow.png`,
      arrowEffect: `${B}/Action Bar/XP Bar/Tooltip/AB_XPBar_Tooltip_Arrow_Effect.png`,
      background: `${B}/Action Bar/XP Bar/Tooltip/AB_XPBar_Tooltip_Background.png`,
      border: `${B}/Action Bar/XP Bar/Tooltip/AB_XPBar_Tooltip_Border.png`,
    },
  },
} as const;

// ─── Fill Bars (generic) ───────────────────────────────────────────────
export const fillBars = {
  background: `${B}/Fill Bars/AB_FillBar_Background.png`,
  fill: `${B}/Fill Bars/AB_FillBar_Fill.png`,
} as const;

// ─── Cast Bar ──────────────────────────────────────────────────────────
export const castBar = {
  background: `${B}/Cast Bar/Castbar_Background.png`,
  fill: `${B}/Cast Bar/Castbar_Fill.png`,
  iconFrame: `${B}/Cast Bar/Castbar_IconFrame.png`,
} as const;

// ─── Tooltip ───────────────────────────────────────────────────────────
export const tooltip = {
  anchor: `${B}/Tooltip/Tooltip_Anchor.png`,
  background: `${B}/Tooltip/Tooltip_Background.png`,
  border: `${B}/Tooltip/Tooltip_Border.png`,
  halfAnchorBackground: `${B}/Tooltip/Tooltip_HalfAnchor_Background.png`,
  halfAnchor: `${B}/Tooltip/Tooltip_HalfAnchor.png`,
} as const;

// ─── Nameplate ─────────────────────────────────────────────────────────
export const nameplate = {
  background: `${B}/Nameplate/Nameplate_Background.png`,
  fill: `${B}/Nameplate/Nameplate_Fill.png`,
  levelBorder: `${B}/Nameplate/Nameplate_LevelFrame_Border.png`,
  levelFrame: `${B}/Nameplate/Nameplate_LevelFrame.png`,
} as const;

// ─── Minimap ───────────────────────────────────────────────────────────
export const minimap = {
  glow: `${B}/Minimap/Minimap_Glow.png`,
  menuBorder: `${B}/Minimap/Minimap_MenuBorder.png`,
  shadow: `${B}/Minimap/Minimap_Shadow.png`,
  buttons: {
    largeBackground: `${B}/Minimap/Buttons/Minimap_BML_Background.png`,
    largeBorder: `${B}/Minimap/Buttons/Minimap_BML_Border.png`,
    smallBackground: `${B}/Minimap/Buttons/Minimap_BMS_Background.png`,
    smallBorder: `${B}/Minimap/Buttons/Minimap_BMS_Border.png`,
    icons: {
      menu: `${B}/Minimap/Buttons/Icons/Menu.png`,
      pause: `${B}/Minimap/Buttons/Icons/Pause.png`,
      profile: `${B}/Minimap/Buttons/Icons/Profile.png`,
      settings: `${B}/Minimap/Buttons/Icons/Settings.png`,
      spellbook: `${B}/Minimap/Buttons/Icons/Spellbook.png`,
      talents: `${B}/Minimap/Buttons/Icons/Talents.png`,
    },
  },
  markers: {
    bossAlive: `${B}/Minimap/Markers/Boss_Alive.png`,
    bossDead: `${B}/Minimap/Markers/Boss_Dead.png`,
    unitGreen: `${B}/Minimap/Markers/Unit_Green.png`,
    unitOrange: `${B}/Minimap/Markers/Unit_Orange.png`,
    unitPurple: `${B}/Minimap/Markers/Unit_Purple.png`,
    unitRed: `${B}/Minimap/Markers/Unit_Red.png`,
  },
} as const;

// ─── Chat ──────────────────────────────────────────────────────────────
export const chat = {
  background: `${B}/Chat/Chat_Background.png`,
  inputBackground: `${B}/Chat/Chat_Input_Background.png`,
  submit: `${B}/Chat/Chat_Submit.png`,
  sidebar: {
    background: `${B}/Chat/Sidebar/Chat_Sidebar_Background.png`,
    icons: {
      arrowBottom: `${B}/Chat/Sidebar/Icons/Arrow_Bottom.png`,
      arrowDown: `${B}/Chat/Sidebar/Icons/Arrow_Down.png`,
      arrowTop: `${B}/Chat/Sidebar/Icons/Arrow_Top.png`,
      arrowUp: `${B}/Chat/Sidebar/Icons/Arrow_Up.png`,
      lock: `${B}/Chat/Sidebar/Icons/Lock.png`,
      settings: `${B}/Chat/Sidebar/Icons/Settings.png`,
    },
  },
  tabs: {
    background: `${B}/Chat/Tabs/Chat_Tab_Background.png`,
    borderDecoration: `${B}/Chat/Tabs/Chat_Tab_Border_Decoration.png`,
    border: `${B}/Chat/Tabs/Chat_Tab_Border.png`,
  },
} as const;

// ─── Notifications ─────────────────────────────────────────────────────
export const notifications = {
  bodyShadow: `${B}/Notifications/Notification_Body_Shadow.png`,
  borderDecoration: `${B}/Notifications/Notification_Border_Decoration.png`,
  border: `${B}/Notifications/Notification_Border.png`,
  headerGlow: `${B}/Notifications/Notification_Header_Glow.png`,
} as const;

// ─── Quest Tracker ─────────────────────────────────────────────────────
export const questTracker = {
  buttonArrow: `${B}/Quest Tracker/QuestTracker_Button_Arrow.png`,
  buttonBackground: `${B}/Quest Tracker/QuestTracker_Button_Background.png`,
  checkboxComplete: `${B}/Quest Tracker/QuestTracker_Checkbox_Complete.png`,
  checkboxFailed: `${B}/Quest Tracker/QuestTracker_Checkbox_Failed.png`,
  checkbox: `${B}/Quest Tracker/QuestTracker_Checkbox.png`,
  shadow: `${B}/Quest Tracker/QuestTracker_Shadow.png`,
} as const;

// ─── Controls (buttons, inputs, sliders, toggles) ──────────────────────
export const controls = {
  buttons: {
    rectangular: {
      background: `${B}/Controls/Buttons/Rectangular/BRL_Background.png`,
      effect: `${B}/Controls/Buttons/Rectangular/BRL_Effect.png`,
      foreground: `${B}/Controls/Buttons/Rectangular/BRL_Foreground.png`,
      overlay: `${B}/Controls/Buttons/Rectangular/BRL_Overlay.png`,
      neutralBackground: `${B}/Controls/Buttons/Rectangular/BRN_Background.png`,
      wideBackground: `${B}/Controls/Buttons/Rectangular/BRW_Background.png`,
    },
    rhombus: {
      background: `${B}/Controls/Buttons/Rhombus/BRHL_Background.png`,
      borders: `${B}/Controls/Buttons/Rhombus/BRHL_Borders.png`,
      countBoxBorder: `${B}/Controls/Buttons/Rhombus/BRHL_CountBox_Border.png`,
      countBox: `${B}/Controls/Buttons/Rhombus/BRHL_CountBox.png`,
      neutralBackground: `${B}/Controls/Buttons/Rhombus/BRHN_Background.png`,
      neutralBorders: `${B}/Controls/Buttons/Rhombus/BRHN_Borders.png`,
      iconClose: `${B}/Controls/Buttons/Rhombus/Icons/Close.png`,
    },
    square: {
      background: `${B}/Controls/Buttons/Square/BSN_Background.png`,
      border: `${B}/Controls/Buttons/Square/BSN_Border.png`,
      iconBack: `${B}/Controls/Buttons/Square/Icons/Back.png`,
      iconCreate: `${B}/Controls/Buttons/Square/Icons/Create.png`,
      iconDelete: `${B}/Controls/Buttons/Square/Icons/Delete.png`,
    },
  },
  input: {
    background: `${B}/Controls/Input Field/Input_Background.png`,
  },
  scrollBar: {
    verticalHandle: `${B}/Controls/Scroll Bars/ScrollBar_Vertical_Handle.png`,
  },
  selectField: {
    arrowOverlay: `${B}/Controls/Select Fields/SelectField_Arrow_Overlay.png`,
    arrow: `${B}/Controls/Select Fields/SelectField_Arrow.png`,
    listBackground: `${B}/Controls/Select Fields/SelectField_List_Background.png`,
    listSeparator: `${B}/Controls/Select Fields/SelectField_List_Separator.png`,
  },
  slider: {
    arrow: `${B}/Controls/Sliders/Slider_Horizontal_Arrow.png`,
    fill: `${B}/Controls/Sliders/Slider_Horizontal_Fill.png`,
    handleLines: `${B}/Controls/Sliders/Slider_Horizontal_Handle_Lines.png`,
    handle: `${B}/Controls/Sliders/Slider_Horizontal_Handle.png`,
  },
  textBox: {
    important: `${B}/Controls/Text Box/TextBox_Important.png`,
    iconBlue: `${B}/Controls/Text Box/Icons/Blue.png`,
    iconRed: `${B}/Controls/Text Box/Icons/Red.png`,
    iconYellow: `${B}/Controls/Text Box/Icons/Yellow.png`,
  },
  toggles: {
    checkbox: `${B}/Controls/Toggles/Checkbox_Background.png`,
    checkboxCheckmark: `${B}/Controls/Toggles/Checkbox_Checkmark.png`,
    checkboxOverlay: `${B}/Controls/Toggles/Checkbox_Overlay.png`,
    checkbox2: `${B}/Controls/Toggles/Checkbox2_Background.png`,
    checkbox2Checkmark: `${B}/Controls/Toggles/Checkbox2_Checkmark.png`,
    checkbox2Overlay: `${B}/Controls/Toggles/Checkbox2_Overlay.png`,
    radio: `${B}/Controls/Toggles/RadioToggle_Background.png`,
    radioCheckmark: `${B}/Controls/Toggles/RadioToggle_Checkmark.png`,
    radioOverlay: `${B}/Controls/Toggles/RadioToggle_Overlay.png`,
    toggleHandle: `${B}/Controls/Toggles/Toggle_OnOff_Handle.png`,
  },
} as const;

// ─── Loading Bar ───────────────────────────────────────────────────────
export const loadingBar = {
  background: `${B}/Loading Bar/LoadingBar_Background.png`,
  fill: `${B}/Loading Bar/LoadingBar_Fill.png`,
} as const;

// ─── Spell & Item Icons ────────────────────────────────────────────────
export const spellIcons = {
  arrows: `${B}/Spell & Item Icons/Icon_Arrows_128.png`,
  book: `${B}/Spell & Item Icons/Icon_Book_128.png`,
  deathkiss: `${B}/Spell & Item Icons/Icon_Deathkiss_128.png`,
  fireball: `${B}/Spell & Item Icons/Icon_Fireball_128.png`,
  leafs: `${B}/Spell & Item Icons/Icon_Leafs_128.png`,
  pyroblast: `${B}/Spell & Item Icons/Icon_Pyroblast_128.png`,
  shield: `${B}/Spell & Item Icons/Icon_Shield_128.png`,
  sunshiny: `${B}/Spell & Item Icons/Icon_Sunshiny_128.png`,
  sword: `${B}/Spell & Item Icons/Icon_Sword_128.png`,
} as const;

// ─── Action Button Icons ───────────────────────────────────────────────
export const actionIcons = {
  arrow: `${B}/Action Buttons/Icons/Arrow.png`,
  arrows: `${B}/Action Buttons/Icons/Arrows.png`,
  bowArrow: `${B}/Action Buttons/Icons/Bow_Arrow.png`,
  bow: `${B}/Action Buttons/Icons/Bow.png`,
  drops: `${B}/Action Buttons/Icons/Drops.png`,
  fireball: `${B}/Action Buttons/Icons/Fireball.png`,
  first: `${B}/Action Buttons/Icons/First.png`,
  heart: `${B}/Action Buttons/Icons/Heart.png`,
  knifeStraight: `${B}/Action Buttons/Icons/Knife_Straight.png`,
  knife: `${B}/Action Buttons/Icons/Knife.png`,
  leafs: `${B}/Action Buttons/Icons/Leafs.png`,
  lightning: `${B}/Action Buttons/Icons/Lightning.png`,
  shield: `${B}/Action Buttons/Icons/Shield.png`,
  sword: `${B}/Action Buttons/Icons/Sword.png`,
  border: `${B}/Action Buttons/Mobile_ActionButton_Border.png`,
  cooldownFull: `${B}/Action Buttons/Mobile_ActionButton_Cooldown_Full.png`,
  cooldown: `${B}/Action Buttons/Mobile_ActionButton_Cooldown.png`,
} as const;

// ─── Consumable Buttons ────────────────────────────────────────────────
export const consumables = {
  border: `${B}/Consumable Buttons/Mobile_Consumable_Border.png`,
  glow: `${B}/Consumable Buttons/Mobile_Consumable_Glow.png`,
  potionBlue: `${B}/Consumable Buttons/Icons/Consumable_Potion_Blue.png`,
  potionGreen: `${B}/Consumable Buttons/Icons/Consumable_Potion_Green.png`,
  potionOrange: `${B}/Consumable Buttons/Icons/Consumable_Potion_Orange.png`,
} as const;

// ─── Currencies ────────────────────────────────────────────────────────
export const currencies = {
  copper: `${B}/Currencies/Currency_Copper.png`,
  gold: `${B}/Currencies/Currency_Gold.png`,
  silver: `${B}/Currencies/Currency_Silver.png`,
} as const;

// ─── Cursors ───────────────────────────────────────────────────────────
export const cursors = {
  normal: `${B}/Cursors/Cursor_Normal.png`,
} as const;

// ─── Equip Slot Icons ──────────────────────────────────────────────────
export const equipSlots = {
  back: `${B}/Windows/Character/Equip Slot/Icons/Back.png`,
  belt: `${B}/Windows/Character/Equip Slot/Icons/Belt.png`,
  boots: `${B}/Windows/Character/Equip Slot/Icons/Boots.png`,
  bracer: `${B}/Windows/Character/Equip Slot/Icons/Bracer.png`,
  chest: `${B}/Windows/Character/Equip Slot/Icons/Chest.png`,
  earring: `${B}/Windows/Character/Equip Slot/Icons/Earring.png`,
  gloves: `${B}/Windows/Character/Equip Slot/Icons/Gloves.png`,
  helmet: `${B}/Windows/Character/Equip Slot/Icons/Helmet.png`,
  legs: `${B}/Windows/Character/Equip Slot/Icons/Legs.png`,
  mainHand: `${B}/Windows/Character/Equip Slot/Icons/MainHand.png`,
  neck: `${B}/Windows/Character/Equip Slot/Icons/Neck.png`,
  offHand: `${B}/Windows/Character/Equip Slot/Icons/OffHnad.png`,
  ring: `${B}/Windows/Character/Equip Slot/Icons/Ring.png`,
  shoulder: `${B}/Windows/Character/Equip Slot/Icons/Shoulder.png`,
} as const;

// ─── Windows ───────────────────────────────────────────────────────────
export const windows = {
  headerBackground: `${B}/Windows/Window/Window_Header_Background.png`,
  headerLines: `${B}/Windows/Window/Window_Header_Lines.png`,
  iconSlotQuality: `${B}/Icon Slots/QualityBorder.png`,
} as const;

// ─── Lobby ─────────────────────────────────────────────────────────────
export const lobby = {
  glowLeft: `${B}/Lobby/Lobby_Glow_Left.png`,
  bottomBar: {
    background: `${B}/Lobby/Bottom Bar/BottomBar_Background.png`,
    effectLarge: `${B}/Lobby/Bottom Bar/BottomBar_Effect_Large.png`,
    effectSmall: `${B}/Lobby/Bottom Bar/BottomBar_Effect_Small.png`,
    gradient: `${B}/Lobby/Bottom Bar/BottomBar_Gradient.png`,
  },
  tooltip: {
    arrowEffect: `${B}/Lobby/Tooltip/Tooltip_Arrow_Effect.png`,
    background: `${B}/Lobby/Tooltip/Tooltip_Background.png`,
    horizontalArrow: `${B}/Lobby/Tooltip/Tooltip_Horizontal_Arrow_Background.png`,
    horizontalLines: `${B}/Lobby/Tooltip/Tooltip_Horizontal_Lines.png`,
    verticalArrow: `${B}/Lobby/Tooltip/Tooltip_Vertical_Arrow_Background.png`,
    verticalLines: `${B}/Lobby/Tooltip/Tooltip_Vertical_Lines.png`,
  },
} as const;

// ─── Shapes (used as masks / slots) ────────────────────────────────────
export const shapes = {
  circle: `${B}/Circle.png`,
  rhombus: `${B}/Rhombus.png`,
  square: `${B}/Square.png`,
} as const;

// ─── Fonts ─────────────────────────────────────────────────────────────
export const fonts = {
  rajdhani: {
    light: `${B}/Fonts/Rajdhani Light.ttf`,
    regular: `${B}/Fonts/Rajdhani Regular.ttf`,
    medium: `${B}/Fonts/Rajdhani Medium.ttf`,
    semiBold: `${B}/Fonts/Rajdhani SemiBold.ttf`,
    bold: `${B}/Fonts/Rajdhani Bold.ttf`,
  },
} as const;

/** Convenience barrel — import { UI } from "@/lib/uiAssets" */
export const UI = {
  general,
  unitFrame,
  actionBar,
  fillBars,
  castBar,
  tooltip,
  nameplate,
  minimap,
  chat,
  notifications,
  questTracker,
  controls,
  loadingBar,
  spellIcons,
  actionIcons,
  consumables,
  currencies,
  cursors,
  equipSlots,
  windows,
  lobby,
  shapes,
  fonts,
} as const;
