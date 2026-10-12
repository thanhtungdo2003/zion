export const TUTORIAL_IDS = ['intro', 'npc_farmer', 'npc_chef', 'npc_colonel', 'npc_other', 'merchant', 'nurse', 'stash', 'chest', 'zombie', 'map', 'plant', 'cooking', 'pvp'] as const;
export type TutorialId = typeof TUTORIAL_IDS[number];
export interface TutorialProgress { seen: TutorialId[]; firstZombie: boolean }
export interface TutorialStateMessage extends TutorialProgress { t: 'tutorialState' }
