import { DatePipe, DecimalPipe, JsonPipe } from '@angular/common';
import {
  Component,
  computed,
  effect,
  model,
  OnInit,
  signal,
  WritableSignal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterOutlet } from '@angular/router';

import { groupBy, sortBy, uniqBy } from 'lodash';
import { Card, CardDB, DeckCard } from '../db';

type Sort = 'Set' | 'Color' | 'Rarity' | 'Type';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, DatePipe, FormsModule, JsonPipe, DecimalPipe],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  data = signal<Card[]>([]);
  loadingPage = signal<boolean>(false);
  loadingData = signal<boolean>(false);
  updatedAt = signal<string>('');
  totalCards = signal<number>(0);

  deckToggle = signal<boolean>(true);
  hideComplete = signal<boolean>(true);

  totalUniqueCards = signal<number>(0);
  incompleteCards = signal<number>(0);

  deckString = model<string>('');

  sort = model<Sort>('Set');

  checkList: Record<string, WritableSignal<boolean>[]> = {};

  allCards = computed(() => {
    if (!this.data()) return [];

    const cards = this.deckString();
    const validCards = (cards ?? '')
      .split('\n')
      .map((c) => this.parseCardLine(c))
      .flat()
      .filter(Boolean) as DeckCard[];

    return validCards;
  });

  unfoundCards = computed(() => {
    return this.allCards().filter((c) => c.set === 'Unfound');
  });

  cardsAndSets = computed(() => {
    const sort = this.sort();

    const cards = this.allCards();

    switch (sort) {
      case 'Type':
        return groupBy(
          uniqBy(cards, (c) => c.name),
          (c) => c.type
        );
      case 'Color':
        return groupBy(
          uniqBy(cards, (c) => c.name),
          (c) => c.colors.join('') || 'Colorless'
        );
      case 'Rarity':
        return groupBy(
          uniqBy(cards, (c) => c.name),
          (c) => c.rarity
        );
      case 'Set':
        return groupBy(cards, (c: DeckCard) => c.set);
    }
  });

  orderedSets = computed(() => {
    const cardsAndSets = this.cardsAndSets();
    if (!cardsAndSets) return;

    return sortBy(Object.keys(cardsAndSets));
  });

  shouldShowDeck = computed(() => {
    if (!this.deckString()) return true;

    return this.deckToggle();
  });

  constructor() {
    effect(
      () => {
        this.checkList = {};

        const cards = this.allCards();

        cards.forEach((c) => {
          this.checkList[c.name] = Array(c.amount)
            .fill(undefined)
            .map(() => signal(false));
        });

        const totals = Object.keys(this.checkList)
          .map((c) => this.checkList[c])
          .flat();

        this.totalUniqueCards.set(totals.length);
        this.incompleteCards.set(totals.length);
      },
      { allowSignalWrites: true }
    );
  }

  async ngOnInit() {
    this.loadingPage.set(true);

    const cards = await CardDB.cards.toArray();
    this.data.set(cards ?? []);

    this.updatedAt.set(localStorage.getItem('updated-at') ?? '');
    this.totalCards.set(+(localStorage.getItem('total-cards') ?? '0'));
    this.deckString.set(localStorage.getItem('previous-deck') ?? '');
    this.deckToggle.set(!!+(localStorage.getItem('show-deck') ?? '1'));
    this.hideComplete.set(!!+(localStorage.getItem('hide-complete') ?? '1'));
    this.sort.set((localStorage.getItem('sort') as Sort) ?? 'Set');

    this.loadingPage.set(false);
  }

  async fetchData() {
    this.loadingData.set(true);
    const bulkRes = await fetch('https://api.scryfall.com/bulk-data');
    const bulkData = await bulkRes.json();

    const cardRef = bulkData.data.find((d: any) => d.type === 'default_cards');
    if (!cardRef) return;

    const cardRes = await fetch(cardRef.download_uri);
    const cardData = await cardRes.json();

    this.updatedAt.set(cardRef.updated_at);
    this.totalCards.set(cardData.length);

    localStorage.setItem('updated-at', cardRef.updated_at);
    localStorage.setItem('total-cards', cardData.length);

    const cardsToStore = cardData.map((c: any) => ({
      id: c.id,
      colors: c.colors,
      name: c.name,
      set: c.set_name,
      rarity: c.rarity,
      type: (c.type_line ?? '').split('—')[0].trim(),
    }));

    this.data.set(cardsToStore);

    CardDB.cards.bulkPut(cardsToStore);

    this.loadingData.set(false);
  }

  parseCardLine(line: string): DeckCard[] | undefined {
    line = line.trim();

    if (!line) return undefined;
    const [amount, ...cardTextPotential] = line.split(' ');
    const cardAmount = amount.replace('x', '');

    if (!cardAmount || isNaN(+cardAmount)) return undefined;
    if (!cardTextPotential) return undefined;

    let cardName = cardTextPotential.join(' ');

    const parenIndex = cardName.indexOf('(');
    const brackIndex = cardName.indexOf('[');

    if (parenIndex !== -1) {
      cardName = cardName.slice(0, parenIndex);
    }

    if (brackIndex !== -1) {
      cardName = cardName.slice(0, brackIndex);
    }

    cardName = cardName.trim();

    if (this.isBasicLand(cardName)) {
      return [
        {
          amount: +cardAmount,
          colors: [],
          id: cardName,
          name: cardName,
          rarity: 'basicland',
          set: 'Basic Lands',
          type: 'Basic Land',
        },
      ];
    }

    const cardRefs = this.data().filter((c) => c.name === cardName);
    if (cardRefs.length === 0)
      return [
        {
          amount: +cardAmount,
          colors: [],
          id: cardName,
          name: cardName,
          rarity: 'Unfound',
          set: 'Unfound',
          type: 'Unfound',
        },
      ];

    return uniqBy(
      cardRefs.map((c) => ({
        ...c,
        amount: +cardAmount,
      })),
      (c) => c.set
    );
  }

  findSetForCard(cardName: string) {
    const cards = this.data();
    return cards.find((card: any) => card.name === cardName)?.set ?? 'Unknown';
  }

  toggleDeckBox() {
    this.deckToggle.set(!this.deckToggle());
    localStorage.setItem('show-deck', (+this.deckToggle()).toString());
  }

  toggleHideComplete() {
    this.hideComplete.set(!this.hideComplete());
    localStorage.setItem('hide-complete', (+this.hideComplete()).toString());
  }

  setSort(sort: string) {
    this.sort.set(sort as Sort);
    localStorage.setItem('sort', sort);
  }

  saveDeck(deck: string) {
    localStorage.setItem('previous-deck', deck);
  }

  isBasicLand(cardName: string) {
    return [
      'Plains',
      'Mountain',
      'Island',
      'Swamp',
      'Forest',
      'Wastes',
    ].includes(cardName);
  }

  isSetComplete(set: string) {
    return this.cardsAndSets()
      [set].map((c) => this.checkList[c.name])
      .flat()
      .every((c) => c());
  }

  toggleCollectionCard(cardName: string, index: number) {
    this.checkList[cardName][index].set(!this.checkList[cardName][index]());
    this.recalculateIncomplete();
  }

  recalculateIncomplete() {
    const incomplete = Object.keys(this.checkList)
      .map((k) => this.checkList[k])
      .flat()
      .filter((c) => !c()).length;
    this.incompleteCards.set(incomplete);
  }

  getOrderedCardsFromSet(set: string): DeckCard[] {
    return sortBy(
      this.cardsAndSets()[set],
      (card) => -this.checkList[card.name].length
    );
  }
}
