import { DatePipe, DecimalPipe, JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Component, computed, effect, model, OnInit, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { groupBy, sortBy, uniqBy } from 'lodash';
import { Card, CardDB, DeckCard } from '../db';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, DatePipe, FormsModule, JsonPipe, DecimalPipe],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
  data = signal<Card[]>([]);
  loading = signal<boolean>(false);
  updatedAt = signal<string>('');
  totalCards = signal<number>(0);
  deckToggle = signal<boolean>(true);

  deckString = model<string>('');

  checkList = signal<Record<string, boolean[]>>({});

  allCards = computed(() => {
    if(!this.data()) return [];

    const cards = this.deckString();
    const validCards = cards.split('\n').map(c => this.parseCardLine(c)).flat().filter(Boolean) as DeckCard[];

    return validCards;
  })

  cardsAndSets = computed(() => {
    const cards = this.allCards();

    return groupBy(cards, (c: DeckCard) => c.set);
  });

  orderedSets = computed(() => {
    const cardsAndSets = this.cardsAndSets();
    if(!cardsAndSets) return;

    return sortBy(Object.keys(cardsAndSets));
  });

  shouldShowDeck = computed(() => {
    if(!this.deckString()) return true;

    return this.deckToggle();
  });

  totalUniqueCards = computed(() => {
    const checklist = this.checkList();

    return Object.keys(checklist).length;
  });

  incompleteCards = computed(() => {
    const checklist = this.checkList();

    return Object.keys(checklist).map(c => checklist[c].every(Boolean)).length;
  });

  constructor() {
    effect(() =>  {
      const cards = this.allCards();
      cards.forEach(c => {
        this.setCheckboxesForCardName(c.name, c.amount);
      });
    })
  }

  async ngOnInit() {
    this.updatedAt.set(localStorage.getItem('updated-at') ?? '');
    this.totalCards.set(+(localStorage.getItem('total-cards') ?? '0'));
    this.deckString.set(localStorage.getItem('previous-deck') ?? '');
    this.deckToggle.set(!!(+(localStorage.getItem('show-deck') ?? '1')));

    const cards = await CardDB.cards.toArray();
    this.data.set(cards ?? []);
  }

  async fetchData() {
    this.loading.set(true);
    const bulkRes = await fetch('https://api.scryfall.com/bulk-data');
    const bulkData = await bulkRes.json();

    const cardRef = bulkData.data.find((d: any) => d.type === 'default_cards');
    if(!cardRef) return;

    const cardRes = await fetch(cardRef.download_uri);
    const cardData = await cardRes.json();

    this.data.set(cardData);
    this.updatedAt.set(cardRef.updated_at);
    this.totalCards.set(cardData.length);

    localStorage.setItem('updated-at', cardRef.updated_at);
    localStorage.setItem('total-cards', cardData.length);

    const cardsToStore = cardData.map((c: any) => ({
      id: c.id,
      colors: c.colors,
      name: c.name,
      set: c.set_name,
      rarity: c.rarity
    }));

    CardDB.cards.bulkPut(cardsToStore);

    this.loading.set(false);
  }

  parseCardLine(line: string): DeckCard[] | undefined {
    line = line.trim();

    if(!line) return undefined;
    const [amount, ...cardTextPotential] = line.split(' ');
    const cardAmount = amount.replace('x', '');

    if(!cardAmount || isNaN(+cardAmount)) return undefined;
    if(!cardTextPotential) return undefined;

    let cardName = cardTextPotential.join(' ');

    const parenIndex = cardName.indexOf('(');
    const brackIndex = cardName.indexOf('[');

    if(parenIndex !== -1) {
      cardName = cardName.slice(0, parenIndex);
    }

    if(brackIndex !== -1) {
      cardName = cardName.slice(0, brackIndex);
    }

    cardName = cardName.trim();

    if(this.isBasicLand(cardName)) {
      return [{
        amount: +cardAmount,
        colors: [],
        id: cardName,
        name: cardName,
        rarity: 'land',
        set: 'Lands'
      }]
    }

    const cardRefs = this.data().filter(c => c.name === cardName);
    if(cardRefs.length === 0) return undefined;

    return uniqBy(cardRefs.map(c => ({
      ...c,
      amount: +cardAmount
    })), c => c.set);
  }

  findSetForCard(cardName: string) {
    const cards = this.data();
    return cards.find((card: any) => card.name === cardName)?.set ?? 'Unknown';
  }

  toggleDeckBox() {
    this.deckToggle.set(!this.deckToggle());
    localStorage.setItem('show-deck', (+this.deckToggle()).toString());
  }

  saveDeck(deck: string) {
    localStorage.setItem('previous-deck', deck);
  }

  isBasicLand(cardName: string) {
    return ['Plains', 'Mountain', 'Island', 'Swamp', 'Forest', 'Wastes'].includes(cardName);
  }

  setCheckboxesForCardName(cardName: string, amount = 1) {
    const checklist = this.checkList();
    checklist[cardName] = Array(amount).fill(false);

    this.checkList.set(checklist);
  }

  toggleCollectionCard(cardName: string, index: number) {
    const checklist = this.checkList();
    checklist[cardName][index] = !checklist[cardName][index];

    this.checkList.set(checklist);
  }
}
