
import Dexie, { type EntityTable } from 'dexie';

export interface Card {
  id: string;
  colors: string[];
  name: string;
  set: string;
  rarity: string;
  type: string;
}

export interface DeckCard extends Card {
  amount: number;
}

export const CardDB = new Dexie('CardDB') as Dexie & {
  cards: EntityTable<Card, 'id'>
};

CardDB.version(1).stores({
  cards: 'id, colors, name, set, rarity, type'
});
