/* Deckforge is intentionally local-first. Only card lookups use Scryfall's public API. */
const STORAGE_KEY = 'deckforge-collection-v1';
const DECK_STORAGE_KEY = 'deckforge-current-deck-v1';
const STATE_STORAGE_KEY = 'deckforge-state-v2';
const COLORS = ['W', 'U', 'B', 'R', 'G'];
const FORMAT_LABELS = { casual: 'Casual', standard: 'Standard', pioneer: 'Pioneer', modern: 'Modern', legacy: 'Legacy', vintage: 'Vintage', commander: 'Commander' };
const STYLE_COPY = {
  balanced: ['Flexible midrange', 'A balanced list that values efficient creatures, removal, card advantage, and a dependable mana base.'],
  aggro: ['Fast pressure', 'Low-cost threats take the lead, with combat tricks and removal clearing the way before the opponent can stabilize.'],
  midrange: ['Value & pressure', 'Trade efficiently in the early turns, then use durable threats and value cards to take over the middle game.'],
  control: ['Answers first', 'Protect your life total with interaction and card selection; reserve your most impactful spells to close the game.'],
  ramp: ['Mana into might', 'Prioritize extra mana early, then turn it into high-impact creatures and spells that outscale the table.'],
  tokens: ['Go wide', 'Create a board of small bodies, then turn their numbers into pressure with token payoffs and protection.'],
  combo: ['Pieces with a purpose', 'Keep interaction and card selection around a focused set of synergies; no combo is claimed unless the pieces are present.']
};

let collection = loadCollection();
let currentDeck = loadDeck();
let selectedColors = new Set();
let pendingDeckEdit = null;
let previousDeck = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const els = {
  format: $('#formatSelect'), style: $('#styleSelect'), commander: $('#commanderSelect'), collectionGrid: $('#collectionGrid'),
  collectionCount: $('#collectionCount'), uniqueCount: $('#uniqueCount'), collectionMeter: $('#collectionMeter'), collectionSearch: $('#collectionSearch'),
  importDialog: $('#importDialog'), rulesDialog: $('#rulesDialog'), importText: $('#importText'), importMessage: $('#importMessage'), arenaImportText: $('#arenaImportText'), arenaImportMessage: $('#arenaImportMessage'), singleMessage: $('#singleMessage'),
  emptyDeck: $('#emptyDeck'), deckResult: $('#deckResult'), deckTitle: $('#deckTitle'), deckSubtitle: $('#deckSubtitle'), deckTotal: $('#deckTotal'),
  deckList: $('#deckList'), deckColorDots: $('#deckColorDots'), planTitle: $('#planTitle'), planText: $('#planText'), manaCurve: $('#manaCurve'), rulesStatus: $('#rulesStatus'), fullRulesReport: $('#fullRulesReport'),
  assistantInput: $('#deckAssistantInput'), assistantMessage: $('#deckAssistantMessage'), assistantPreview: $('#deckAssistantPreview'), assistantPreviewText: $('#deckAssistantPreviewText'), reviewDeckEditButton: $('#reviewDeckEditButton'), applyDeckEditButton: $('#applyDeckEditButton'), discardDeckEditButton: $('#discardDeckEditButton'), undoDeckEditButton: $('#undoDeckEditButton')
};

function loadCollection() {
  try {
    const state = JSON.parse(localStorage.getItem(STATE_STORAGE_KEY));
    const cards = state ? state.collection : JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(cards) ? cards : [];
  } catch { return []; }
}
// One atomic storage write keeps the collection and deck together. Existing v1
// saves are read until the first successful v2 save; a failed write leaves them intact.
function saveState(cards, deck) {
  const saved = deck ? { ...deck, report: undefined, deckColors: [...(deck.deckColors || [])] } : null;
  localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify({ collection: cards, deck: saved }));
}
function persist() { saveState(collection, currentDeck); }
function loadDeck() {
  try {
    const state = JSON.parse(localStorage.getItem(STATE_STORAGE_KEY));
    const saved = state ? state.deck : JSON.parse(localStorage.getItem(DECK_STORAGE_KEY));
    if (!saved || !Array.isArray(saved.deck)) return null;
    return { ...saved, deckColors: new Set(saved.deckColors || []), generatedAt: saved.generatedAt ? new Date(saved.generatedAt) : new Date(), report: [] };
  } catch { return null; }
}
function persistDeck() {
  try {
    saveState(collection, currentDeck);
  } catch { /* Local deck storage is a convenience; the current page can still work without it. */ }
}
function totalOwned() { return collection.reduce((total, card) => total + card.quantity, 0); }
function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;' })[char]); }
function normalizeName(name) { return name.trim().toLowerCase(); }
function cardImage(card) { return card.imageUri ? `background-image:url('${card.imageUri.replace(/'/g, '%27')}')` : ''; }

function renderCollection() {
  const query = els.collectionSearch.value.trim().toLowerCase();
  const visibleCards = collection.filter(card => card.name.toLowerCase().includes(query)).sort((a,b) => a.name.localeCompare(b.name));
  els.collectionCount.textContent = `${totalOwned()} card${totalOwned() === 1 ? '' : 's'}`;
  els.uniqueCount.textContent = collection.length;
  els.collectionMeter.style.width = `${Math.min(100, totalOwned() / 2)}%`;
  els.collectionGrid.innerHTML = '';
  if (!visibleCards.length) {
    els.collectionGrid.innerHTML = `<div class="collection-empty">${collection.length ? 'No matching cards in your collection.' : 'No cards yet. Import a list or add cards one at a time.'}</div>`;
  } else {
    const template = $('#collectionCardTemplate');
    visibleCards.forEach(card => {
      const fragment = template.content.cloneNode(true);
      const article = fragment.querySelector('article');
      fragment.querySelector('.collection-image').style.cssText = cardImage(card);
      fragment.querySelector('strong').textContent = card.name;
      fragment.querySelector('.collection-card-info span').textContent = card.typeLine || 'Card details pending';
      fragment.querySelector('.card-quantity').textContent = `×${card.quantity}`;
      fragment.querySelector('.remove-card').addEventListener('click', () => removeCard(card.id));
      els.collectionGrid.append(fragment);
    });
  }
  refreshCommanderChoices();
}

function removeCard(id) {
  collection = collection.filter(card => card.id !== id); persist(); renderCollection();
  if (currentDeck) {
    clearDeckEditPreview(); currentDeck.report = validateDeck(currentDeck); persistDeck();
    renderDeck(currentDeck, { scroll: false });
  }
}
function refreshCommanderChoices() {
  const selected = els.commander.value;
  const candidates = collection.filter(card => isCommanderCandidate(card)).sort((a,b) => a.name.localeCompare(b.name));
  els.commander.innerHTML = '<option value="">Choose from your legendary creatures</option>' + candidates.map(card => `<option value="${escapeHtml(card.id)}">${escapeHtml(card.name)}${card.colorIdentity?.length ? ` (${card.colorIdentity.join('')})` : ''}</option>`).join('');
  if (candidates.some(card => card.id === selected)) els.commander.value = selected;
}
function isCommanderCandidate(card) { return /legendary/i.test(card.typeLine || '') && /(creature|planeswalker)/i.test(card.typeLine || ''); }
function isBasicLand(card) { return /Basic Land/i.test(card.typeLine || '') || /basic land/i.test(card.name); }
function cardRole(card) {
  const type = (card.typeLine || '').toLowerCase(); const text = (card.oracleText || '').toLowerCase(); const name = card.name.toLowerCase();
  const role = { land: /land/.test(type), creature: /creature/.test(type), artifact: /artifact/.test(type), instant: /instant/.test(type), sorcery: /sorcery/.test(type), planeswalker: /planeswalker/.test(type), cmc: Number(card.cmc || 0) };
  role.ramp = /add \{|search your library for (a |up to .* )?basic land|treasure token|mana of any color/.test(text) || /sol ring|arcane signet|llanowar elves|elvish mystic/.test(name);
  role.removal = /destroy target|exile target|deals? \d+ damage to (any target|target creature)|target creature.*-\d+\/-\d+/.test(text);
  role.draw = /draw (a|two|three|\d+) cards?|investigate/.test(text);
  role.counter = /counter target spell/.test(text);
  role.sweeper = /destroy all|exile all|deals? \d+ damage to each/.test(text);
  role.token = /create .* token|populate/.test(text);
  role.payoff = /creatures you control|get \+\d+\/\+\d+|whenever .* token|for each creature/.test(text);
  role.combo = /search your library|copy target|additional turn|infinite/.test(text);
  return role;
}
function meetsColors(card, allowed) { return !(card.colorIdentity || []).some(color => !allowed.has(color)); }
function legalInFormat(card, format) {
  if (format === 'casual' || !card.legalities) return 'unknown';
  const result = card.legalities[format];
  return result === 'legal' ? 'legal' : result || 'unknown';
}
function rulesCopyLimit(card, format) {
  if (legalInFormat(card, format) === 'restricted') return 1;
  if (isBasicLand(card)) return Infinity;
  return format === 'commander' ? 1 : 4;
}

function styleScore(card, style, deckColors) {
  const role = cardRole(card); let score = 0;
  if (role.creature) score += 7; if (role.planeswalker) score += 8; if (role.instant || role.sorcery) score += 3;
  if (role.removal) score += 9; if (role.draw) score += 8; if (role.ramp) score += 9; if (role.counter) score += 8; if (role.sweeper) score += 7; if (role.token) score += 7; if (role.payoff) score += 5;
  const cmc = role.cmc;
  const curve = { aggro: cmc <= 2 ? 12 : cmc <= 3 ? 6 : cmc >= 6 ? -8 : 0, midrange: cmc >= 2 && cmc <= 5 ? 8 : cmc >= 7 ? -5 : 0, control: (role.instant || role.sorcery) ? 8 : 0, ramp: cmc >= 5 ? 11 : role.ramp ? 7 : 0, tokens: role.token ? 14 : role.payoff ? 11 : 0, combo: role.combo ? 12 : role.draw ? 7 : 0, balanced: cmc >= 2 && cmc <= 4 ? 4 : 0 };
  score += curve[style] || 0;
  if (style === 'aggro' && role.creature) score += 12;
  if (style === 'midrange' && (role.creature || role.planeswalker)) score += 8;
  if (style === 'control' && (role.removal || role.counter || role.draw || role.sweeper)) score += 12;
  if (style === 'ramp' && (role.ramp || role.creature && cmc >= 5)) score += 12;
  if (style === 'tokens' && (role.token || role.payoff)) score += 12;
  if (style === 'combo' && (role.combo || role.draw || role.ramp)) score += 10;
  if (deckColors.size > 1 && (card.colorIdentity || []).length > 1) score += 2;
  return score;
}
function cardCopiesAvailable(card, commander, strictOwned) {
  if (!strictOwned) return isBasicLand(card) ? 99 : 4;
  return Math.max(0, card.quantity - (commander?.id === card.id ? 1 : 0));
}
function targetLandCount(format, style) { if (format === 'commander') return style === 'control' ? 39 : style === 'aggro' ? 36 : 38; return style === 'aggro' ? 22 : style === 'control' ? 26 : style === 'ramp' ? 25 : 24; }

function determineColors(format, commander, style) {
  if (format === 'commander' && commander) return new Set(commander.colorIdentity || []);
  if (selectedColors.size) return new Set(selectedColors);
  const scores = Object.fromEntries(COLORS.map(color => [color, 0]));
  collection.forEach(card => (card.colorIdentity || []).forEach(color => scores[color] += styleScore(card, style, new Set())));
  const top = Object.entries(scores).filter(([,score]) => score > 0).sort((a,b) => b[1] - a[1]).slice(0, 2).map(([color]) => color);
  return new Set(top);
}

function addToDeck(deck, card, count, limit) {
  if (!count) return 0;
  const existing = deck.find(entry => entry.card.id === card.id);
  const available = Math.min(count, limit - (existing?.count || 0));
  if (available <= 0) return 0;
  if (existing) existing.count += available; else deck.push({ card, count: available });
  return available;
}
function deckCount(deck) { return deck.reduce((sum, entry) => sum + entry.count, 0); }
function preferredLandOrder(card, colors) {
  const identity = card.colorIdentity || []; const text = (card.oracleText || '').toLowerCase(); let score = 0;
  if (isBasicLand(card)) score += 3; if (identity.length > 1) score += 12; if (/any color|choose a color/.test(text)) score += 15; if (identity.some(c => colors.has(c))) score += 4; return score;
}
function landColors(card, colors) {
  if (Array.isArray(card.producedMana)) return card.producedMana.filter(color => colors.has(color));
  if (/any color/i.test(card.oracleText || '')) return [...colors];
  return (card.colorIdentity || []).filter(color => colors.has(color));
}
function addBalancedLands(deck, lands, count, entryLimit, colors) {
  const weights = Object.fromEntries([...colors].map(color => [color, 1]));
  for (const { card, count: copies } of deck) {
    if (cardRole(card).land) continue;
    for (const symbol of (card.manaCost || '').match(/\{[^}]+\}/g) || []) {
      for (const color of colors) if (symbol.includes(color)) weights[color] += copies;
    }
  }
  const sources = Object.fromEntries([...colors].map(color => [color, 0]));
  for (const entry of deck.filter(entry => cardRole(entry.card).land)) {
    for (const color of landColors(entry.card, colors)) sources[color] += entry.count;
  }
  let added = 0;
  while (added < count) {
    const eligible = lands.filter(card => deckEntryCount(deck, card) < entryLimit(card));
    if (!eligible.length) break;
    const score = card => landColors(card, colors).reduce((sum, color) => sum + weights[color] / (sources[color] + 1), 0);
    eligible.sort((a,b) => score(b) - score(a) || preferredLandOrder(b, colors) - preferredLandOrder(a, colors) || a.name.localeCompare(b.name));
    const land = eligible[0];
    if (!addToDeck(deck, land, 1, entryLimit(land))) break;
    for (const color of landColors(land, colors)) sources[color]++;
    added++;
  }
  return added;
}

function generateDeck() {
  if (!collection.length) { openImport(); els.importMessage.textContent = 'Add your cards first, then generate a list.'; return; }
  const format = els.format.value; const style = els.style.value; const strictOwned = $('#strictOwnedToggle').checked;
  const commander = format === 'commander' ? collection.find(card => card.id === els.commander.value) : null;
  if (format === 'commander' && !commander) { alert('Choose a legendary creature or planeswalker you own to lead this Commander deck.'); return; }
  const deckColors = determineColors(format, commander, style);
  currentDeck = buildDeck(collection, format, style, commander, strictOwned, deckColors);
  pendingDeckEdit = null; previousDeck = null;
  persistDeck(); renderDeck(currentDeck);
}
function buildDeck(cards, format, style, commander, strictOwned, deckColors) {
  const required = format === 'commander' ? 100 : 60;
  const candidates = cards.filter(card => {
    const formatStatus = legalInFormat(card, format);
    return (card.id !== commander?.id) && meetsColors(card, deckColors) && formatStatus !== 'banned' && formatStatus !== 'not_legal';
  });
  const deck = [];
  if (commander) addToDeck(deck, commander, 1, 1);
  const entryLimit = (card) => {
    const available = cardCopiesAvailable(card, commander, strictOwned);
    return Math.min(available, rulesCopyLimit(card, format));
  };

  // Reserve land slots, then use the chosen spells' mana costs to allocate lands.
  const landTarget = targetLandCount(format, style);
  const lands = candidates.filter(card => cardRole(card).land);
  const reservedLands = Math.min(landTarget, lands.reduce((sum, card) => sum + entryLimit(card), 0));
  const spellTarget = required - reservedLands;

  const spells = candidates.filter(card => !cardRole(card).land).sort((a,b) => styleScore(b, style, deckColors) - styleScore(a, style, deckColors));
  // Give each unique spell one chance before filling copies, so casual decks do not become four-card piles.
  for (const spell of spells) {
    if (deckCount(deck) >= spellTarget) break;
    const permitted = entryLimit(spell);
    addToDeck(deck, spell, Math.min(1, permitted, spellTarget - deckCount(deck)), permitted);
  }
  for (const spell of spells) {
    if (deckCount(deck) >= spellTarget) break;
    const permitted = entryLimit(spell);
    addToDeck(deck, spell, Math.min(permitted, spellTarget - deckCount(deck)), permitted);
  }
  // If the pool has spare lands but is short, include them so the user sees the real size of their possible deck.
  const landsAdded = addBalancedLands(deck, lands, required - deckCount(deck), entryLimit, deckColors);
  const result = { deck, format, style, commander, deckColors, required, landTarget, landsAdded, strictOwned, generatedAt: new Date() };
  result.report = validateDeck(result, cards);
  return result;
}

function cloneDeckResult(result) {
  return {
    ...result,
    deck: result.deck.map(entry => ({ card: entry.card, count: entry.count })),
    deckColors: new Set(result.deckColors || []),
    report: (result.report || []).map(item => ({ ...item }))
  };
}
function sameCard(first, second) { return Boolean(first && second && ((first.id && second.id && first.id === second.id) || normalizeName(first.name) === normalizeName(second.name))); }
function deckEntryFor(deck, card) { return deck.find(entry => sameCard(entry.card, card)); }
function deckEntryCount(deck, card) { return deckEntryFor(deck, card)?.count || 0; }
function removeFromDeck(deck, card, quantity) {
  const index = deck.findIndex(entry => sameCard(entry.card, card));
  if (index < 0 || quantity <= 0) return 0;
  const entry = deck[index]; const removed = Math.min(entry.count, quantity);
  entry.count -= removed;
  if (!entry.count) deck.splice(index, 1);
  return removed;
}
function editorCopyLimit(card, result) {
  if (sameCard(card, result.commander)) return 1;
  const rulesLimit = rulesCopyLimit(card, result.format);
  return result.strictOwned ? Math.min(rulesLimit, Number(card.quantity || 0)) : rulesLimit;
}
function canAddToEditedDeck(card, result) {
  if (sameCard(card, result.commander) || !meetsColors(card, result.deckColors)) return false;
  const formatStatus = legalInFormat(card, result.format);
  return !['banned', 'not_legal'].includes(formatStatus) && deckEntryCount(result.deck, card) < editorCopyLimit(card, result);
}
function editorCandidates(result, predicate = () => true) { return collection.filter(card => canAddToEditedDeck(card, result) && predicate(card)); }
function recordDeckChange(bucket, card, quantity = 1) {
  const key = card.id || normalizeName(card.name); const current = bucket.get(key) || { card, count: 0 };
  current.count += quantity; bucket.set(key, current);
}
function changeText(bucket) { return [...bucket.values()].map(item => item.count + '× ' + escapeHtml(item.card.name)).join(', '); }
function countDeckLands(deck) { return deck.filter(entry => cardRole(entry.card).land).reduce((total, entry) => total + entry.count, 0); }
function genericRemovalScore(card, result) {
  const role = cardRole(card);
  return (role.land ? -80 : 0) + role.cmc * 4 - styleScore(card, result.style, result.deckColors);
}
function chooseOutgoing(result, incoming, filter = () => true, score = genericRemovalScore) {
  return result.deck
    .filter(entry => entry.count && !sameCard(entry.card, result.commander) && !sameCard(entry.card, incoming) && filter(entry.card))
    .sort((a, b) => score(b.card, result) - score(a.card, result))[0] || null;
}
function swapOneCard(result, outgoing, incoming, changes) {
  const removed = removeFromDeck(result.deck, outgoing.card, 1);
  const added = addToDeck(result.deck, incoming, 1, editorCopyLimit(incoming, result));
  if (!added) {
    addToDeck(result.deck, outgoing.card, removed, editorCopyLimit(outgoing.card, result));
    return false;
  }
  recordDeckChange(changes.removed, outgoing.card, removed);
  recordDeckChange(changes.added, incoming, added);
  return true;
}
function addSpecificCard(result, card, amount, changes) {
  const targetSize = Math.max(result.required, deckCount(result.deck)); let changed = 0;
  for (let index = 0; index < amount; index++) {
    if (!canAddToEditedDeck(card, result)) break;
    if (deckCount(result.deck) < targetSize) {
      const added = addToDeck(result.deck, card, 1, editorCopyLimit(card, result));
      if (!added) break;
      recordDeckChange(changes.added, card, added); changed += added; continue;
    }
    const outgoing = chooseOutgoing(result, card, candidate => !cardRole(candidate).land);
    if (!outgoing || !swapOneCard(result, outgoing, card, changes)) break;
    changed++;
  }
  if (changed < amount) changes.notes.push('Could only add ' + changed + ' of ' + amount + ' requested ' + card.name + ' copies.');
  return changed;
}
function tuneDeck(result, options, changes) {
  const targetSize = Math.max(result.required, deckCount(result.deck)); let changed = 0;
  for (let index = 0; index < options.amount; index++) {
    const candidates = editorCandidates(result, options.incoming).sort((a, b) => options.incomingScore(b, result) - options.incomingScore(a, result));
    if (!candidates.length) break;
    if (deckCount(result.deck) < targetSize) {
      const added = addToDeck(result.deck, candidates[0], 1, editorCopyLimit(candidates[0], result));
      if (!added) break;
      recordDeckChange(changes.added, candidates[0], added); changed += added; continue;
    }
    let choice = null;
    for (const incoming of candidates) {
      const outgoing = chooseOutgoing(result, incoming, options.outgoing, options.outgoingScore);
      if (outgoing && (!options.canSwap || options.canSwap(outgoing.card, incoming))) { choice = { outgoing, incoming }; break; }
    }
    if (!choice || !swapOneCard(result, choice.outgoing, choice.incoming, changes)) break;
    changed++;
  }
  if (changed < options.amount) changes.notes.push('Could only make ' + changed + ' of ' + options.amount + ' ' + options.label.toLowerCase() + ' adjustments with the eligible cards in this collection.');
  return changed;
}
function fillDeck(result, changes) {
  let added = 0;
  while (deckCount(result.deck) < result.required) {
    const needsLand = countDeckLands(result.deck) < result.landTarget;
    let candidates = editorCandidates(result, card => needsLand ? cardRole(card).land : !cardRole(card).land)
      .sort((a, b) => (needsLand ? preferredLandOrder(b, result.deckColors) - preferredLandOrder(a, result.deckColors) : styleScore(b, result.style, result.deckColors) - styleScore(a, result.style, result.deckColors)));
    if (!candidates.length && needsLand) candidates = editorCandidates(result, card => !cardRole(card).land).sort((a, b) => styleScore(b, result.style, result.deckColors) - styleScore(a, result.style, result.deckColors));
    const card = candidates[0]; if (!card) break;
    const quantity = addToDeck(result.deck, card, 1, editorCopyLimit(card, result));
    if (!quantity) break;
    recordDeckChange(changes.added, card, quantity); added += quantity;
  }
  if (deckCount(result.deck) < result.required) changes.notes.push('The deck is still ' + (result.required - deckCount(result.deck)) + ' cards short because no more eligible cards were available.');
  return added;
}
const ASSISTANT_NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
function assistantCount(value, fallback = 1) {
  const token = String(value || '').toLowerCase();
  if (token === 'all') return 99;
  return Math.max(1, Number(token) || ASSISTANT_NUMBER_WORDS[token] || fallback);
}
function escapeRegExp(value) { return String(value).replace(/[.*+?^$\{}()|[\]\\]/g, '\\$&'); }
function amountFor(text, term, fallback) {
  const count = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten)';
  // A removal quantity must not also be interpreted as an addition.
  text = text.replace(new RegExp('\\b(?:remove|cut|reduce)\\s+(?:' + count + '|all)\\s+(?:more\\s+)?' + term + '\\b', 'gi'), '');
  const explicit = new RegExp('\\b' + count + '\\s+(?:more\\s+)?' + term + '\\b', 'i').exec(text);
  if (explicit) return Math.min(12, assistantCount(explicit[1], fallback));
  return new RegExp('\\b(?:more|add|increase|extra|need)\\s+' + term + '\\b', 'i').test(text) ? fallback : 0;
}
function decreaseAmountFor(text, term, fallback) {
  const count = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|all)';
  const explicit = new RegExp('\\b(?:remove|cut|reduce)\\s+' + count + '\\s+(?:more\\s+)?' + term + '\\b', 'i').exec(text);
  if (explicit) return assistantCount(explicit[1], fallback);
  return new RegExp('\\b(?:fewer|less)\\s+' + term + '\\b', 'i').test(text) ? fallback : 0;
}
function namedCardCommands(text, action) {
  const verbs = action === 'add' ? '(?:add|include|put\\s+in)' : '(?:remove|cut|drop|take\\s+out)';
  const count = '(all|\\d+|one|two|three|four|five|six|seven|eight|nine|ten)';
  const boundary = '(?=$|[,.!;]|\\s+(?:and|then|please)\\b)';
  return collection
    .slice().sort((a, b) => b.name.length - a.name.length)
    .map(card => {
      const pattern = '\\b' + verbs + '\\s+(?:' + count + '\\s*(?:copies?\\s+of\\s+|copies?\\s+|of\\s+)?)?' + escapeRegExp(card.name) + boundary;
      const match = new RegExp(pattern, 'i').exec(text);
      return match ? { card, amount: assistantCount(match[1], 1) } : null;
    }).filter(Boolean);
}
function setDeckStyle(result, style, changes) {
  if (result.style === style) return;
  changes.style = STYLE_COPY[style][0]; result.style = style; result.landTarget = targetLandCount(result.format, style);
}
function planDeckEdit(text) {
  const draft = cloneDeckResult(currentDeck);
  const changes = { added: new Map(), removed: new Map(), notes: [], style: '' };
  const lower = text.toLowerCase(); let recognized = false;
  const wantsFast = /\b(?:faster|aggressive|aggro|lower (?:the )?(?:mana )?curve|cheaper)\b/.test(lower);
  const wantsControl = /\b(?:control|controlling)\b/.test(lower);
  const wantsTokens = /\b(?:tokens?|go wide)\b/.test(lower);
  const wantsCombo = /\bcombo\b/.test(lower);
  if (wantsFast) { setDeckStyle(draft, 'aggro', changes); recognized = true; }
  else if (wantsControl) { setDeckStyle(draft, 'control', changes); recognized = true; }
  else if (wantsTokens) { setDeckStyle(draft, 'tokens', changes); recognized = true; }
  else if (wantsCombo) { setDeckStyle(draft, 'combo', changes); recognized = true; }

  namedCardCommands(text, 'remove').forEach(command => {
    recognized = true;
    if (sameCard(command.card, draft.commander)) { changes.notes.push('The commander stays in the deck; choose a different commander by generating a new Commander list.'); return; }
    const removed = removeFromDeck(draft.deck, command.card, command.amount);
    if (removed) recordDeckChange(changes.removed, command.card, removed);
    else changes.notes.push(command.card.name + ' is not in the current deck.');
  });
  namedCardCommands(text, 'add').forEach(command => {
    recognized = true;
    if (!canAddToEditedDeck(command.card, draft)) { changes.notes.push(command.card.name + ' cannot be added: it is unavailable, outside this deck’s colors, over a limit, or not legal for this format.'); return; }
    addSpecificCard(draft, command.card, command.amount, changes);
  });

  const moreLands = amountFor(lower, 'lands?', 2);
  const fewerLands = decreaseAmountFor(lower, 'lands?', 2);
  const moreRemoval = amountFor(lower, '(?:removal|answers?|interaction)', 2);
  const moreCreatures = amountFor(lower, 'creatures?', 2);
  const moreDraw = amountFor(lower, '(?:card draw|draw)', 2);
  const moreRamp = amountFor(lower, 'ramp', 2);
  if (moreLands) {
    recognized = true;
    tuneDeck(draft, { amount: moreLands, label: 'mana-base', incoming: card => cardRole(card).land, incomingScore: card => preferredLandOrder(card, draft.deckColors), outgoing: card => !cardRole(card).land, outgoingScore: genericRemovalScore }, changes);
  }
  if (fewerLands) {
    recognized = true;
    tuneDeck(draft, { amount: fewerLands, label: 'fewer-land', incoming: card => !cardRole(card).land, incomingScore: card => styleScore(card, draft.style, draft.deckColors), outgoing: card => cardRole(card).land, outgoingScore: card => 20 - preferredLandOrder(card, draft.deckColors) }, changes);
  }
  if (wantsFast) {
    tuneDeck(draft, { amount: 4, label: 'faster', incoming: card => !cardRole(card).land && cardRole(card).cmc <= 3, incomingScore: card => styleScore(card, 'aggro', draft.deckColors) - cardRole(card).cmc * 3, outgoing: card => !cardRole(card).land, outgoingScore: card => cardRole(card).cmc * 10 - styleScore(card, 'aggro', draft.deckColors), canSwap: (outgoing, incoming) => cardRole(outgoing).cmc > cardRole(incoming).cmc }, changes);
  }
  if (moreRemoval) {
    recognized = true;
    tuneDeck(draft, { amount: moreRemoval, label: 'removal', incoming: card => cardRole(card).removal, incomingScore: card => styleScore(card, draft.style, draft.deckColors), outgoing: card => !cardRole(card).land && !cardRole(card).removal, outgoingScore: genericRemovalScore }, changes);
  }
  if (moreCreatures) {
    recognized = true;
    tuneDeck(draft, { amount: moreCreatures, label: 'creature', incoming: card => cardRole(card).creature, incomingScore: card => styleScore(card, draft.style, draft.deckColors), outgoing: card => !cardRole(card).land && !cardRole(card).creature, outgoingScore: genericRemovalScore }, changes);
  }
  if (moreDraw) {
    recognized = true;
    tuneDeck(draft, { amount: moreDraw, label: 'card-draw', incoming: card => cardRole(card).draw, incomingScore: card => styleScore(card, draft.style, draft.deckColors), outgoing: card => !cardRole(card).land && !cardRole(card).draw, outgoingScore: genericRemovalScore }, changes);
  }
  if (moreRamp) {
    recognized = true;
    tuneDeck(draft, { amount: moreRamp, label: 'ramp', incoming: card => cardRole(card).ramp, incomingScore: card => styleScore(card, 'ramp', draft.deckColors), outgoing: card => !cardRole(card).land && !cardRole(card).ramp, outgoingScore: genericRemovalScore }, changes);
  }
  if (wantsControl) {
    tuneDeck(draft, { amount: 3, label: 'control', incoming: card => { const role = cardRole(card); return role.removal || role.counter || role.draw || role.sweeper; }, incomingScore: card => styleScore(card, 'control', draft.deckColors), outgoing: card => { const role = cardRole(card); return !role.land && !(role.removal || role.counter || role.draw || role.sweeper); }, outgoingScore: genericRemovalScore }, changes);
  }
  if (wantsTokens) {
    tuneDeck(draft, { amount: 3, label: 'token', incoming: card => { const role = cardRole(card); return role.token || role.payoff; }, incomingScore: card => styleScore(card, 'tokens', draft.deckColors), outgoing: card => { const role = cardRole(card); return !role.land && !(role.token || role.payoff); }, outgoingScore: genericRemovalScore }, changes);
  }
  if (wantsCombo) {
    tuneDeck(draft, { amount: 3, label: 'combo', incoming: card => { const role = cardRole(card); return role.combo || role.draw || role.ramp; }, incomingScore: card => styleScore(card, 'combo', draft.deckColors), outgoing: card => { const role = cardRole(card); return !role.land && !(role.combo || role.draw || role.ramp); }, outgoingScore: genericRemovalScore }, changes);
  }
  if (/\b(?:fill|complete)\b.*\b(?:deck|list)\b|\b(?:make|keep)\b.*\b(?:60|100|legal)\b/.test(lower)) { recognized = true; fillDeck(draft, changes); }

  draft.landsAdded = countDeckLands(draft.deck);
  draft.landTarget = targetLandCount(draft.format, draft.style);
  draft.report = validateDeck(draft);
  return { recognized, draft, changes };
}
function hasPlannedChanges(changes) { return Boolean(changes.style || changes.added.size || changes.removed.size); }
function clearDeckEditPreview() {
  pendingDeckEdit = null; els.assistantPreview.classList.add('hidden'); els.assistantPreviewText.innerHTML = ''; els.applyDeckEditButton.disabled = true;
}
function renderDeckEditPreview(plan) {
  const rows = [];
  if (plan.changes.style) rows.push('<li><b>Plan:</b><span>Shift the deck toward <em>' + escapeHtml(plan.changes.style) + '</em>.</span></li>');
  if (plan.changes.added.size) rows.push('<li><b>Adding:</b><span><em>' + changeText(plan.changes.added) + '</em></span></li>');
  if (plan.changes.removed.size) rows.push('<li><b>Removing:</b><span class="preview-cut">' + changeText(plan.changes.removed) + '</span></li>');
  plan.changes.notes.forEach(note => rows.push('<li><b>Note:</b><span class="preview-note">' + escapeHtml(note) + '</span></li>'));
  const failures = plan.draft.report.filter(item => item.type === 'fail').map(item => item.title);
  const status = failures.length ? 'Rules check will flag: ' + failures.join(', ') + '.' : 'All current hard rules checks remain clear.';
  rows.push('<li><b>After:</b><span>' + deckCount(plan.draft.deck) + ' cards · ' + countDeckLands(plan.draft.deck) + ' lands · ' + escapeHtml(status) + '</span></li>');
  els.assistantPreviewText.innerHTML = '<ul class="assistant-preview-list">' + rows.join('') + '</ul>';
  els.assistantPreview.classList.remove('hidden'); els.applyDeckEditButton.disabled = false;
}
function reviewDeckEdit() {
  if (!currentDeck) { els.assistantMessage.textContent = 'Generate a deck first, then ask Deckforge to tune it.'; return; }
  const request = els.assistantInput.value.trim();
  if (!request) { els.assistantMessage.textContent = 'Describe a change first—try “make it faster” or “add more removal.”'; return; }
  const plan = planDeckEdit(request);
  if (!plan.recognized) {
    clearDeckEditPreview();
    els.assistantMessage.textContent = 'I can help with a faster or controlling plan, more lands/removal/creatures/draw/ramp, filling the deck, or “add/remove 2 Card Name.”';
    return;
  }
  if (!hasPlannedChanges(plan.changes)) {
    clearDeckEditPreview();
    els.assistantMessage.textContent = plan.changes.notes[0] || 'No eligible change was available from the cards you recorded.';
    return;
  }
  pendingDeckEdit = plan; renderDeckEditPreview(plan);
  els.assistantMessage.textContent = 'Review the exact changes below, then apply them when they look right.';
}
function applyDeckEdit() {
  if (!pendingDeckEdit || !currentDeck) return;
  previousDeck = cloneDeckResult(currentDeck);
  currentDeck = pendingDeckEdit.draft; clearDeckEditPreview(); persistDeck();
  renderDeck(currentDeck, { scroll: false });
  els.assistantInput.value = '';
  els.assistantMessage.textContent = 'Deck updated. The list, mana curve, rules check, copy, and download now use this edited deck.';
  els.undoDeckEditButton.classList.remove('hidden');
}
function undoDeckEdit() {
  if (!previousDeck) return;
  currentDeck = cloneDeckResult(previousDeck); previousDeck = null; clearDeckEditPreview(); persistDeck();
  renderDeck(currentDeck, { scroll: false });
  els.assistantMessage.textContent = 'Last deck edit undone.';
  els.undoDeckEditButton.classList.add('hidden');
}

function validateDeck(result, ownedCollection = collection) {
  const { deck, format, commander, deckColors, required, landTarget } = result; const total = deckCount(deck); const items = [];
  const isCommander = format === 'commander'; const legalSize = isCommander ? total === required : total >= required;
  items.push({ type: legalSize ? 'pass' : 'fail', title: 'Deck size', text: legalSize ? `${total} cards meets the ${isCommander ? 'exactly 100' : '60-card minimum'} for ${FORMAT_LABELS[format]}.` : `${total} cards recorded; ${isCommander ? 'Commander needs exactly 100' : 'constructed formats need at least 60'}.` });
  const lands = deck.filter(entry => cardRole(entry.card).land).reduce((sum,e) => sum + e.count, 0);
  items.push({ type: lands >= Math.max(18, landTarget - 3) ? 'pass' : 'warn', title: 'Mana base', text: `${lands} lands included; the plan targets about ${landTarget}. ${lands < landTarget ? 'More owned lands would make the deck more consistent.' : 'The land count supports this plan.'}` });
  const tooMany = deck.filter(entry => entry.count > rulesCopyLimit(entry.card, format));
  items.push({ type: tooMany.length ? 'fail' : 'pass', title: 'Copy limit', text: tooMany.length ? `${tooMany.map(entry => entry.card.name).join(', ')} exceeds its copy limit (restricted cards allow one).` : isCommander ? 'Every non-basic card appears no more than once.' : 'All cards meet their copy limits, including restricted cards.' });
  if (result.strictOwned) {
    const unavailable = deck.filter(entry => {
      const owned = ownedCollection.find(card => sameCard(card, entry.card));
      return !owned || entry.count > Number(owned.quantity || 0);
    });
    items.push({ type: unavailable.length ? 'fail' : 'pass', title: 'Owned quantities', text: unavailable.length ? unavailable.map(entry => entry.card.name).join(', ') + ' exceeds the quantities currently recorded in your collection.' : 'Every card count stays within the quantities you recorded.' });
  }
  if (isCommander) {
    const identityIssue = deck.filter(entry => !meetsColors(entry.card, deckColors));
    items.push({ type: identityIssue.length || !isCommanderCandidate(commander) ? 'fail' : 'pass', title: 'Commander identity', text: identityIssue.length ? `${identityIssue.map(entry => entry.card.name).join(', ')} sits outside ${commander.name}'s color identity.` : `${commander.name} leads a color-identity compliant list.` });
  }
  if (format !== 'casual') {
    const problems = deck.filter(entry => ['banned','not_legal'].includes(legalInFormat(entry.card, format)) || (legalInFormat(entry.card, format) === 'restricted' && entry.count > 1));
    const unknown = deck.filter(entry => legalInFormat(entry.card, format) === 'unknown');
    items.push({ type: problems.length ? 'fail' : unknown.length ? 'warn' : 'pass', title: 'Format legality', text: problems.length ? `${problems.map(entry => entry.card.name).join(', ')} is not legal in this format.` : unknown.length ? `${unknown.length} card${unknown.length === 1 ? '' : 's'} need a fresh Scryfall lookup before event play.` : `All looked-up cards are listed as legal in ${FORMAT_LABELS[format]}.` });
  }
  const sourceCounts = Object.fromEntries([...deckColors].map(c => [c, 0]));
  deck.filter(entry => cardRole(entry.card).land).forEach(entry => landColors(entry.card, deckColors).forEach(c => { sourceCounts[c] += entry.count; }));
  if (deckColors.size > 1) items.push({ type: Object.values(sourceCounts).some(n => n < 5) ? 'warn' : 'pass', title: 'Color sources', text: Object.entries(sourceCounts).map(([c,n]) => `${c}: ${n}`).join(' · ') + '. Count lands with appropriate basic land types and mana abilities before serious play.' });
  return items;
}

function renderDeck(result, { scroll = true } = {}) {
  els.emptyDeck.classList.add('hidden'); els.deckResult.classList.remove('hidden');
  const total = deckCount(result.deck); const [planTitle, planText] = STYLE_COPY[result.style];
  els.deckTitle.textContent = result.commander ? `${result.commander.name} ${result.style === 'balanced' ? 'good-stuff' : result.style} deck` : `${FORMAT_LABELS[result.format]} ${result.style} deck`;
  els.deckSubtitle.textContent = `${FORMAT_LABELS[result.format]} · built only from ${result.strictOwned ? 'the quantities you recorded' : 'your recorded cards'} · ${total === result.required ? 'target size reached' : `${result.required - total} cards short`}`;
  els.deckTotal.textContent = total; els.planTitle.textContent = planTitle; els.planText.textContent = planText;
  els.deckColorDots.innerHTML = [...result.deckColors].map(color => `<i>${color}</i>`).join('') || '<i>◇</i>';
  renderDeckList(result.deck); renderManaCurve(result.deck); renderRules(result.report);
  els.format.value = result.format; els.style.value = result.style;
  els.undoDeckEditButton.classList.toggle('hidden', !previousDeck);
  if (scroll) $('#deckOutput').scrollIntoView({ behavior:'smooth', block:'start' });
}
function groupForCard(card) { const role = cardRole(card); if (role.land) return 'Lands'; if (role.creature) return 'Creatures'; if (role.planeswalker) return 'Planeswalkers'; if (role.instant) return 'Instants'; if (role.sorcery) return 'Sorceries'; if (role.artifact) return 'Artifacts'; return 'Other spells'; }
function renderDeckList(deck) {
  const order = ['Commander','Creatures','Planeswalkers','Instants','Sorceries','Artifacts','Other spells','Lands']; const groups = {};
  deck.forEach(entry => { const group = currentDeck.commander?.id === entry.card.id ? 'Commander' : groupForCard(entry.card); (groups[group] ||= []).push(entry); });
  els.deckList.innerHTML = order.filter(group => groups[group]?.length).map(group => `<section class="deck-group"><h5>${group}</h5>${groups[group].sort((a,b)=>a.card.name.localeCompare(b.card.name)).map(entry => `<div class="deck-row" title="${escapeHtml(entry.card.typeLine || '')}"><span class="qty">${entry.count}×</span><span class="name">${escapeHtml(entry.card.name)}</span><span class="cost">${escapeHtml(entry.card.manaCost || '')}</span></div>`).join('')}</section>`).join('');
}
function renderManaCurve(deck) { const buckets = [0,0,0,0,0]; deck.forEach(({card,count}) => { if (cardRole(card).land) return; const cmc = Number(card.cmc || 0); buckets[Math.min(4,Math.max(0,Math.ceil(cmc) - 1))] += count; }); const max = Math.max(...buckets,1); els.manaCurve.innerHTML = buckets.map(number => `<i style="height:${Math.max(3, Math.round(number / max * 76))}px" title="${number} spells"></i>`).join(''); }
function renderRules(report) { els.rulesStatus.innerHTML = report.slice(0,4).map(item => `<div class="status-line"><i class="status-icon ${item.type}">${item.type === 'pass' ? '✓' : item.type === 'warn' ? '!' : '×'}</i><span><b>${escapeHtml(item.title)}:</b> ${escapeHtml(item.text)}</span></div>`).join(''); els.fullRulesReport.innerHTML = report.map(item => `<div class="report-row"><i class="status-icon ${item.type}">${item.type === 'pass' ? '✓' : item.type === 'warn' ? '!' : '×'}</i><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.text)}</p></div></div>`).join(''); }

async function lookupCard(name) {
  const response = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`);
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.details || `Could not find “${name}”.`); }
  return cardFromScryfall(await response.json());
}
function cardFromScryfall(data) {
  const face = data.card_faces?.[0] || data;
  return { id: data.id || `manual-${normalizeName(data.name)}`, name: data.name, quantity: 0, manaCost: data.mana_cost || face.mana_cost || '', cmc: data.cmc || 0, colorIdentity: data.color_identity || [], producedMana: data.produced_mana, typeLine: data.type_line || face.type_line || '', oracleText: data.oracle_text || data.card_faces?.map(f => f.oracle_text || '').join(' // ') || '', legalities: data.legalities || null, imageUri: data.image_uris?.small || face.image_uris?.small || '', rarity: data.rarity || '' };
}
function mergeCard(incoming, quantity, mode = 'add') {
  const existing = collection.find(card => normalizeName(card.name) === normalizeName(incoming.name));
  if (existing) {
    const nextQuantity = mode === 'maximum' ? Math.max(existing.quantity, quantity) : existing.quantity + quantity;
    Object.assign(existing, incoming, { quantity: nextQuantity });
  } else collection.push({ ...incoming, quantity });
  persist();
}
async function addNamedCard(name, quantity, messageElement, mode = 'add') { messageElement.textContent = `Looking up ${name}…`; const card = await lookupCard(name); mergeCard(card, quantity, mode); messageElement.textContent = `Added ${quantity}× ${card.name}.`; return card; }

async function importList() {
  const lines = els.importText.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean); if (!lines.length) { els.importMessage.textContent = 'Paste at least one card name.'; return; }
  const parsed = lines.map(line => { const match = line.match(/^(\d+)\s*[xX]?\s+(.+)$/); return { name: match ? match[2] : line, quantity: match ? Number(match[1]) : 1 }; });
  let added = 0; const misses = [];
  $('#importListButton').disabled = true;
  for (const item of parsed) { try { await addNamedCard(item.name, item.quantity, els.importMessage); added++; } catch (error) { misses.push(item.name); } }
  $('#importListButton').disabled = false; persist(); renderCollection();
  els.importMessage.textContent = `Added ${added} card${added === 1 ? '' : ' names'}${misses.length ? ` · couldn’t find: ${misses.join(', ')}` : ''}`;
  if (!misses.length) setTimeout(() => els.importDialog.close(), 600);
}

function parseArenaDeck(text) {
  const sections = { deck: 0, commander: 0, companion: 0, sideboard: 0, other: 0 };
  const cards = new Map(); let currentSection = 'deck'; let ignored = 0;
  const headingMap = { deck: 'deck', commander: 'commander', companion: 'companion', sideboard: 'sideboard' };
  text.replace(/^\uFEFF/, '').split(/\r?\n/).forEach(rawLine => {
    const line = rawLine.trim(); if (!line) return;
    const heading = line.toLowerCase().replace(/:$/, '');
    if (headingMap[heading]) { currentSection = headingMap[heading]; return; }
    // Arena may place About and Name metadata ahead of the deck's card lines.
    if (heading === 'about' || /^name\s+/i.test(line)) return;
    const quantityMatch = line.match(/^(\d+)\s*(?:x\s*)?(.+?)\s*$/i);
    if (!quantityMatch) { ignored++; return; }
    const quantity = Number(quantityMatch[1]); let name = quantityMatch[2].trim();
    // Arena includes a printing suffix such as "(DMU) 272". Scryfall's named lookup wants only the card name.
    const printingSuffix = name.match(/^(.*?)\s+\([^)]+\)\s+(\S+)$/);
    if (printingSuffix) name = printingSuffix[1].trim();
    if (!name || !Number.isFinite(quantity) || quantity < 1) { ignored++; return; }
    const key = normalizeName(name); const item = cards.get(key) || { name, quantities: {}, sections: new Set() };
    item.quantities[currentSection] = (item.quantities[currentSection] || 0) + quantity;
    item.sections.add(currentSection); cards.set(key, item); sections[currentSection] += quantity;
  });
  // Main-deck and sideboard copies are distinct. Only a companion's duplicate
  // listing in the sideboard should be counted once.
  return { cards: [...cards.values()].map(item => {
    const q = item.quantities;
    return { ...item, quantity: (q.deck || 0) + (q.commander || 0) + (q.other || 0) + Math.max(q.sideboard || 0, q.companion || 0) };
  }), sections, ignored };
}

async function importArenaDeck() {
  const parsed = parseArenaDeck(els.arenaImportText.value);
  if (!parsed.cards.length) { els.arenaImportMessage.textContent = 'No Arena card lines found. Use Arena’s Export button, then paste the copied deck here.'; return; }
  const keepHighest = $('#arenaMaxToggle').checked; let added = 0; const misses = [];
  $('#arenaImportButton').disabled = true;
  for (const item of parsed.cards) {
    try { await addNamedCard(item.name, item.quantity, els.arenaImportMessage, keepHighest ? 'maximum' : 'add'); added++; }
    catch (error) { misses.push(item.name); }
  }
  $('#arenaImportButton').disabled = false; persist(); renderCollection();
  const count = Object.values(parsed.sections).reduce((sum, number) => sum + number, 0);
  const sectionSummary = Object.entries(parsed.sections).filter(([, number]) => number).map(([section, number]) => `${section === 'deck' ? 'main deck' : section} ${number}`).join(' · ');
  els.arenaImportMessage.textContent = `Imported ${added} card${added === 1 ? '' : ' names'} / ${count} deck cards (${sectionSummary})${misses.length ? ` · couldn’t find: ${misses.join(', ')}` : ''}`;
  if (!misses.length) setTimeout(() => els.importDialog.close(), 850);
}
function openImport() { els.importMessage.textContent = ''; els.arenaImportMessage.textContent = ''; els.singleMessage.textContent = ''; els.importDialog.showModal(); }
function copyDeck() { if (!currentDeck) return; navigator.clipboard?.writeText(decklistText()).then(() => { $('#copyDeckButton').textContent = 'Copied!'; setTimeout(() => $('#copyDeckButton').textContent = 'Copy list', 1200); }); }
function decklistText() { const lines = []; if (currentDeck.commander) lines.push(`Commander\n1 ${currentDeck.commander.name}\n`); const groups = {}; currentDeck.deck.filter(entry => entry.card.id !== currentDeck.commander?.id).forEach(entry => (groups[groupForCard(entry.card)] ||= []).push(entry)); ['Creatures','Planeswalkers','Instants','Sorceries','Artifacts','Other spells','Lands'].forEach(group => { if (groups[group]) { lines.push(group); groups[group].sort((a,b)=>a.card.name.localeCompare(b.card.name)).forEach(entry => lines.push(`${entry.count} ${entry.card.name}`)); lines.push(''); } }); return lines.join('\n').trim(); }
function exportDeck() { if (!currentDeck) return; const blob = new Blob([decklistText()], { type:'text/plain' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'deckforge-decklist.txt'; a.click(); URL.revokeObjectURL(a.href); }

// Examples use fresh metadata instead of a Commander-only, unverified card list.
const EXAMPLE_PLANS = {
  balanced: { colors: ['G','W'], commander: 'Shalai, Voice of Plenty', query: '(t:creature mv>=2 mv<=5)' },
  aggro: { colors: ['R'], commander: 'Krenko, Tin Street Kingpin', query: '(t:creature mv<=3)' },
  midrange: { colors: ['B','G'], commander: 'Meren of Clan Nel Toth', query: '(t:creature mv>=3 mv<=5)' },
  control: { colors: ['U','B'], commander: 'Talrand, Sky Summoner', query: '(o:"counter target" or o:"destroy target" or o:"draw")' },
  ramp: { colors: ['G'], commander: 'Goreclaw, Terror of Qal Sisma', query: '(o:"add {" or o:"search your library" or (t:creature mv>=5))' },
  tokens: { colors: ['G','W'], commander: 'Rhys the Redeemed', query: '(o:"create" o:"token")' },
  combo: { colors: ['U','R'], commander: 'Veyran, Voice of Duality', query: '(o:"copy" or o:"draw" or o:"whenever you cast")' }
};
let exampleLoading = false;
function updateExampleButton() {
  const button = $('#exampleButton');
  button.textContent = exampleLoading ? 'Building example…' : 'Build ' + FORMAT_LABELS[els.format.value] + ' ' + els.style.value + ' example';
  button.disabled = exampleLoading;
}
function exampleMessage(message) {
  let status = $('#exampleStatus');
  if (!status) {
    status = document.createElement('p');
    status.id = 'exampleStatus';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.style.cssText = 'font-size:0.8rem;line-height:1.5;margin-top:0.75rem';
    $('#exampleButton').after(status);
  }
  status.textContent = message;
}
async function exampleRequest(path, allowEmpty = false) {
  // Keep requests sequential and below Scryfall's rate limit.
  await new Promise(resolve => setTimeout(resolve, 125));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('https://api.scryfall.com/cards/' + path, { signal: controller.signal });
    if (allowEmpty && response.status === 404) return { data: [] };
    if (!response.ok) throw new Error('Card lookup failed (' + response.status + '). Please try again.');
    return await response.json();
  } finally { clearTimeout(timeout); }
}
async function exampleSearch(query) {
  const result = await exampleRequest('search?' + new URLSearchParams({ q: query, unique: 'cards', order: 'edhrec' }), true);
  if (!Array.isArray(result.data)) throw new Error('The card service returned an incomplete result.');
  return result.data.map(cardFromScryfall);
}
function exampleSpellScore(card, style, colors) {
  const role = cardRole(card);
  let score = styleScore(card, style, colors);
  // Avoid filling an example with expensive cards or narrow text-only matches.
  if (style !== 'ramp' && role.cmc > 5) score -= (role.cmc - 5) * 8;
  if (role.cmc === 0) score -= 8;
  if (style === 'aggro' && role.creature && role.cmc <= 3) score += 30;
  if (style === 'tokens' && role.token) score += 30;
  return score;
}
function assembleExample(format, style, commander, pool, basics) {
  const colors = new Set(commander ? commander.colorIdentity : EXAMPLE_PLANS[style].colors);
  const legalityFormat = format === 'casual' ? 'modern' : format;
  const eligible = card => card.legalities?.[legalityFormat] === 'legal' && meetsColors(card, colors);
  const unique = new Map();
  for (const card of pool) {
    if (eligible(card) && !cardRole(card).land && !sameCard(card, commander)) unique.set(normalizeName(card.name), card);
  }
  const spells = [...unique.values()].sort((a,b) => exampleSpellScore(b, style, colors) - exampleSpellScore(a, style, colors) || a.name.localeCompare(b.name));
  const landCount = targetLandCount(format, style);
  let remaining = (format === 'commander' ? 99 : 60) - landCount;
  const cards = commander ? [{ ...commander, quantity: 1 }] : [];
  for (const card of spells) {
    if (!remaining) break;
    const quantity = Math.min(remaining, format === 'commander' ? 1 : 4);
    cards.push({ ...card, quantity });
    remaining -= quantity;
  }
  if (remaining) throw new Error('Not enough matching legal cards were found. Your current collection was kept.');
  // Reserve a balanced set of basics, weighted by the spells' colored mana costs.
  const neededColors = [...colors];
  const weights = neededColors.map(color => cards.reduce((sum, card) => sum + card.quantity * (card.manaCost.match(new RegExp(color, 'g')) || []).length, 0) + 1);
  const quantities = neededColors.map(() => Math.min(5, Math.floor(landCount / neededColors.length)));
  while (quantities.reduce((sum, n) => sum + n, 0) < landCount) {
    let best = 0;
    for (let i = 1; i < weights.length; i++) if (weights[i] / (quantities[i] + 1) > weights[best] / (quantities[best] + 1)) best = i;
    quantities[best]++;
  }
  neededColors.forEach((color, index) => {
    const names = { W:'Plains', U:'Island', B:'Swamp', R:'Mountain', G:'Forest' };
    const basic = basics.find(card => card.name === names[color] && eligible(card) && isBasicLand(card));
    if (!basic) throw new Error('Could not verify the example mana base. Please try again.');
    cards.push({ ...basic, quantity: quantities[index] });
  });
  return { cards, commander, colors };
}
async function makeExampleCollection(format, style) {
  const plan = EXAMPLE_PLANS[style];
  const legalityFormat = format === 'casual' ? 'modern' : format;
  let commander = null;
  if (format === 'commander') {
    commander = cardFromScryfall(await exampleRequest('named?exact=' + encodeURIComponent(plan.commander)));
    if (!isCommanderCandidate(commander) || commander.legalities?.commander !== 'legal') throw new Error('The example commander is not currently legal.');
  }
  const colors = commander ? commander.colorIdentity : plan.colors;
  const base = 'game:paper legal:' + legalityFormat + ' id<=' + colors.join('').toLowerCase();
  const themed = await exampleSearch(base + ' -t:land ' + plan.query);
  const support = await exampleSearch(base + ' -t:land');
  const basics = await exampleSearch('game:paper legal:' + legalityFormat + ' t:basic (name:Plains or name:Island or name:Swamp or name:Mountain or name:Forest)');
  return assembleExample(format, style, commander, [...themed, ...support], basics);
}
async function loadExample() {
  if (exampleLoading) return;
  const format = els.format.value, style = els.style.value;
  if (collection.length && !confirm('Replace your collection and current deck with a ' + FORMAT_LABELS[format] + ' ' + style + ' example? Export anything you want to keep first.')) return;
  const beforeCollection = JSON.stringify(collection), beforeDeck = JSON.stringify(currentDeck);
  exampleLoading = true; updateExampleButton();
  exampleMessage('Finding legal cards for your format and playstyle… Internet access is required.');
  let exampleSaved = false;
  try {
    const example = await makeExampleCollection(format, style);
    if (format !== els.format.value || style !== els.style.value || beforeCollection !== JSON.stringify(collection) || beforeDeck !== JSON.stringify(currentDeck)) {
      exampleMessage('Your settings or cards changed while loading. Nothing was replaced; click the example button again.');
      return;
    }
    const result = buildDeck(example.cards, format, style, example.commander, true, new Set(example.colors));
    if (result.report.some(item => item.type === 'fail')) throw new Error('The example did not pass its rules checks.');
    // Prepare and validate without mutating current state. setItem is atomic:
    // quota or permission failures preserve both the old collection and old deck.
    saveState(example.cards, result);
    exampleSaved = true;
    collection = example.cards; currentDeck = result; previousDeck = null;
    selectedColors = new Set(example.colors);
    $$('#colorPips button').forEach(button => button.classList.toggle('selected', selectedColors.has(button.dataset.color)));
    $('#strictOwnedToggle').checked = true;
    clearDeckEditPreview(); renderCollection();
    els.commander.value = example.commander?.id || '';
    renderDeck(result);
    exampleMessage('Example ready: ' + FORMAT_LABELS[format] + ' · ' + style + '. These are demo cards, not your owned collection.' + (style === 'combo' ? ' This is a synergy-focused starting list, not a verified infinite combo.' : ''));
  } catch (error) {
    exampleMessage(exampleSaved ? 'The example was saved, but could not be displayed. Reload the page to restore it.' : 'Could not build the example. ' + (error.name === 'AbortError' ? 'Card lookup timed out.' : error.message) + ' Your existing collection and deck were not replaced.');
  } finally { exampleLoading = false; updateExampleButton(); }
}

// Events
els.format.addEventListener('change', updateExampleButton);
els.style.addEventListener('change', updateExampleButton);
updateExampleButton();
$('#openImportButton').addEventListener('click', openImport); $('#emptyImportButton').addEventListener('click', openImport); $('#collectionImportButton').addEventListener('click', openImport);
$('#importListButton').addEventListener('click', importList); $('#arenaImportButton').addEventListener('click', importArenaDeck); $('#addSingleButton').addEventListener('click', async () => { const name = $('#singleCardName').value.trim(); const qty = Math.max(1, Number($('#singleQuantity').value || 1)); if (!name) { els.singleMessage.textContent = 'Enter a card name.'; return; } try { $('#addSingleButton').disabled = true; await addNamedCard(name, qty, els.singleMessage); persist(); renderCollection(); $('#singleCardName').value = ''; } catch (error) { els.singleMessage.textContent = error.message; } finally { $('#addSingleButton').disabled = false; } });
$$('.import-tab').forEach(tab => tab.addEventListener('click', () => { $$('.import-tab').forEach(button => button.classList.toggle('active', button === tab)); $$('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `${tab.dataset.tab}Panel`)); }));
$('#exampleButton').addEventListener('click', loadExample); $('#clearCollectionButton').addEventListener('click', () => { if (collection.length && confirm('Clear every card from this local collection?')) { collection = []; currentDeck = null; previousDeck = null; clearDeckEditPreview(); persist(); persistDeck(); renderCollection(); els.deckResult.classList.add('hidden'); els.emptyDeck.classList.remove('hidden'); } });
els.collectionSearch.addEventListener('input', renderCollection); $$('#colorPips button').forEach(button => button.addEventListener('click', () => { const color = button.dataset.color; selectedColors.has(color) ? selectedColors.delete(color) : selectedColors.add(color); button.classList.toggle('selected', selectedColors.has(color)); }));
els.format.addEventListener('change', () => { const isCommander = els.format.value === 'commander'; $$('.commander-only').forEach(el => el.style.display = isCommander ? 'block' : 'none'); $$('.noncommander-only').forEach(el => el.style.display = isCommander ? 'none' : 'block'); });
$('#generateButton').addEventListener('click', generateDeck); $('#copyDeckButton').addEventListener('click', copyDeck); $('#exportDeckButton').addEventListener('click', exportDeck); $('#viewRulesButton').addEventListener('click', () => els.rulesDialog.showModal());
els.reviewDeckEditButton.addEventListener('click', reviewDeckEdit); els.applyDeckEditButton.addEventListener('click', applyDeckEdit); els.discardDeckEditButton.addEventListener('click', () => { clearDeckEditPreview(); els.assistantMessage.textContent = 'No changes were made.'; }); els.undoDeckEditButton.addEventListener('click', undoDeckEdit);
els.assistantInput.addEventListener('input', () => { if (pendingDeckEdit) { clearDeckEditPreview(); els.assistantMessage.textContent = 'Your request changed—review the new version before applying it.'; } });
els.assistantInput.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') reviewDeckEdit(); });
$$('[data-assistant-prompt]').forEach(button => button.addEventListener('click', () => { els.assistantInput.value = button.dataset.assistantPrompt; els.assistantInput.focus(); }));

renderCollection();
if (currentDeck?.deck?.length) {
  currentDeck.format = FORMAT_LABELS[currentDeck.format] ? currentDeck.format : 'casual';
  currentDeck.style = STYLE_COPY[currentDeck.style] ? currentDeck.style : 'balanced';
  currentDeck.required = currentDeck.format === 'commander' ? 100 : 60;
  currentDeck.deckColors = new Set(currentDeck.deckColors || []);
  currentDeck.landTarget = targetLandCount(currentDeck.format, currentDeck.style);
  currentDeck.landsAdded = countDeckLands(currentDeck.deck);
  els.format.value = currentDeck.format; els.style.value = currentDeck.style;
  els.format.dispatchEvent(new Event('change'));
  if (currentDeck.commander) els.commander.value = currentDeck.commander.id;
  currentDeck.report = validateDeck(currentDeck); persistDeck();
  renderDeck(currentDeck, { scroll: false });
} else {
  currentDeck = null; persistDeck(); els.format.dispatchEvent(new Event('change'));
}
