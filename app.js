/* Deckforge is intentionally local-first. Only card lookups use Scryfall's public API. */
const STORAGE_KEY = 'deckforge-collection-v1';
const DECK_STORAGE_KEY = 'deckforge-current-deck-v1';
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

function loadCollection() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; } }
function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(collection)); }
function loadDeck() {
  try {
    const saved = JSON.parse(localStorage.getItem(DECK_STORAGE_KEY));
    if (!saved || !Array.isArray(saved.deck)) return null;
    return { ...saved, deckColors: new Set(saved.deckColors || []), generatedAt: saved.generatedAt ? new Date(saved.generatedAt) : new Date(), report: [] };
  } catch { return null; }
}
function persistDeck() {
  try {
    if (!currentDeck) { localStorage.removeItem(DECK_STORAGE_KEY); return; }
    const { report, ...saved } = currentDeck;
    localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify({ ...saved, deckColors: [...(currentDeck.deckColors || [])] }));
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
function meetsColors(card, allowed) { return !allowed.size || !(card.colorIdentity || []).some(color => !allowed.has(color)); }
function legalInFormat(card, format) {
  if (format === 'casual' || !card.legalities) return 'unknown';
  const result = card.legalities[format];
  return result === 'legal' ? 'legal' : result || 'unknown';
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

function generateDeck() {
  if (!collection.length) { openImport(); els.importMessage.textContent = 'Add your cards first, then generate a list.'; return; }
  const format = els.format.value; const style = els.style.value; const strictOwned = $('#strictOwnedToggle').checked;
  const commander = format === 'commander' ? collection.find(card => card.id === els.commander.value) : null;
  if (format === 'commander' && !commander) { alert('Choose a legendary creature or planeswalker you own to lead this Commander deck.'); return; }
  const deckColors = determineColors(format, commander, style);
  const required = format === 'commander' ? 100 : 60;
  const maxCopies = format === 'commander' ? 1 : 4;
  const candidates = collection.filter(card => {
    const formatStatus = legalInFormat(card, format);
    return (card.id !== commander?.id) && meetsColors(card, deckColors) && formatStatus !== 'banned' && formatStatus !== 'not_legal';
  });
  const deck = [];
  if (commander) addToDeck(deck, commander, 1, 1);
  const entryLimit = (card) => {
    const available = cardCopiesAvailable(card, commander, strictOwned);
    if (isBasicLand(card)) return available;
    return Math.min(available, maxCopies);
  };

  // First reserve an appropriately sized mana base from the cards actually recorded as owned.
  const landTarget = targetLandCount(format, style);
  const lands = candidates.filter(card => cardRole(card).land).sort((a,b) => preferredLandOrder(b, deckColors) - preferredLandOrder(a, deckColors));
  let landsAdded = 0;
  for (const land of lands) {
    if (landsAdded >= landTarget) break;
    const permitted = entryLimit(land);
    const added = addToDeck(deck, land, Math.min(permitted, landTarget - landsAdded), permitted);
    landsAdded += added;
  }

  const spells = candidates.filter(card => !cardRole(card).land).sort((a,b) => styleScore(b, style, deckColors) - styleScore(a, style, deckColors));
  // Give each unique spell one chance before filling copies, so casual decks do not become four-card piles.
  for (const spell of spells) {
    if (deckCount(deck) >= required) break;
    const permitted = entryLimit(spell);
    addToDeck(deck, spell, Math.min(1, permitted, required - deckCount(deck)), maxCopies);
  }
  for (const spell of spells) {
    if (deckCount(deck) >= required) break;
    const permitted = entryLimit(spell);
    addToDeck(deck, spell, Math.min(permitted, required - deckCount(deck)), permitted);
  }
  // If the pool has spare lands but is short, include them so the user sees the real size of their possible deck.
  for (const land of lands) {
    if (deckCount(deck) >= required) break;
    const permitted = entryLimit(land);
    addToDeck(deck, land, Math.min(permitted, required - deckCount(deck)), permitted);
  }
  const result = { deck, format, style, commander, deckColors, required, landTarget, landsAdded, strictOwned, generatedAt: new Date() };
  result.report = validateDeck(result);
  currentDeck = result;
  pendingDeckEdit = null;
  previousDeck = null;
  persistDeck();
  renderDeck(result);
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
  const rulesLimit = result.format === 'commander' ? 1 : isBasicLand(card) ? 99 : 4;
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

function validateDeck(result) {
  const { deck, format, commander, deckColors, required, landTarget } = result; const total = deckCount(deck); const items = [];
  const isCommander = format === 'commander'; const legalSize = isCommander ? total === required : total >= required;
  items.push({ type: legalSize ? 'pass' : 'fail', title: 'Deck size', text: legalSize ? `${total} cards meets the ${isCommander ? 'exactly 100' : '60-card minimum'} for ${FORMAT_LABELS[format]}.` : `${total} cards recorded; ${isCommander ? 'Commander needs exactly 100' : 'constructed formats need at least 60'}.` });
  const lands = deck.filter(entry => cardRole(entry.card).land).reduce((sum,e) => sum + e.count, 0);
  items.push({ type: lands >= Math.max(18, landTarget - 3) ? 'pass' : 'warn', title: 'Mana base', text: `${lands} lands included; the plan targets about ${landTarget}. ${lands < landTarget ? 'More owned lands would make the deck more consistent.' : 'The land count supports this plan.'}` });
  const tooMany = deck.filter(entry => entry.count > (isCommander ? 1 : 4) && !isBasicLand(entry.card));
  items.push({ type: tooMany.length ? 'fail' : 'pass', title: 'Copy limit', text: tooMany.length ? `${tooMany.map(entry => entry.card.name).join(', ')} exceeds the normal copy limit.` : isCommander ? 'Every non-basic card appears no more than once.' : 'No non-basic card exceeds four copies.' });
  if (result.strictOwned) {
    const unavailable = deck.filter(entry => {
      const owned = collection.find(card => sameCard(card, entry.card));
      return !owned || entry.count > Number(owned.quantity || 0);
    });
    items.push({ type: unavailable.length ? 'fail' : 'pass', title: 'Owned quantities', text: unavailable.length ? unavailable.map(entry => entry.card.name).join(', ') + ' exceeds the quantities currently recorded in your collection.' : 'Every card count stays within the quantities you recorded.' });
  }
  if (isCommander) {
    const identityIssue = deck.filter(entry => !meetsColors(entry.card, deckColors));
    items.push({ type: identityIssue.length || !isCommanderCandidate(commander) ? 'fail' : 'pass', title: 'Commander identity', text: identityIssue.length ? `${identityIssue.map(entry => entry.card.name).join(', ')} sits outside ${commander.name}'s color identity.` : `${commander.name} leads a color-identity compliant list.` });
  }
  if (format !== 'casual') {
    const problems = deck.filter(entry => ['banned','not_legal'].includes(legalInFormat(entry.card, format)));
    const unknown = deck.filter(entry => legalInFormat(entry.card, format) === 'unknown');
    items.push({ type: problems.length ? 'fail' : unknown.length ? 'warn' : 'pass', title: 'Format legality', text: problems.length ? `${problems.map(entry => entry.card.name).join(', ')} is not legal in this format.` : unknown.length ? `${unknown.length} card${unknown.length === 1 ? '' : 's'} need a fresh Scryfall lookup before event play.` : `All looked-up cards are listed as legal in ${FORMAT_LABELS[format]}.` });
  }
  const sourceCounts = Object.fromEntries([...deckColors].map(c => [c, 0]));
  deck.filter(entry => cardRole(entry.card).land).forEach(entry => (entry.card.colorIdentity || []).forEach(c => { if (c in sourceCounts) sourceCounts[c] += entry.count; }));
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
  const data = await response.json(); const face = data.card_faces?.[0] || data;
  return { id: data.id || `manual-${normalizeName(data.name)}`, name: data.name, quantity: 0, manaCost: data.mana_cost || face.mana_cost || '', cmc: data.cmc || 0, colorIdentity: data.color_identity || [], typeLine: data.type_line || face.type_line || '', oracleText: data.oracle_text || data.card_faces?.map(f => f.oracle_text || '').join(' // ') || '', legalities: data.legalities || null, imageUri: data.image_uris?.small || face.image_uris?.small || '', rarity: data.rarity || '' };
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
  // A companion is commonly repeated in Sideboard. For a collection, a deck requires the largest zone count—not a sum across zones.
  return { cards: [...cards.values()].map(item => ({ ...item, quantity: Math.max(...Object.values(item.quantities)) })), sections, ignored };
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

function makeExampleCard(name, quantity, typeLine, cmc, identity, text, manaCost) { return { id:`sample-${name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`,name,quantity,typeLine,cmc,colorIdentity:identity,oracleText:text,manaCost,legalities:null,imageUri:'' }; }
function makeExampleCollection() {
  // The demo collection is intentionally Commander-ready: a five-color leader,
  // enough singleton spells to show a real deck, and basics in every color.
  const basics = [
    ['Plains',16,'Basic Land — Plains',0,['W'],'({T}: Add {W}.)',''],
    ['Island',16,'Basic Land — Island',0,['U'],'({T}: Add {U}.)',''],
    ['Swamp',16,'Basic Land — Swamp',0,['B'],'({T}: Add {B}.)',''],
    ['Mountain',16,'Basic Land — Mountain',0,['R'],'({T}: Add {R}.)',''],
    ['Forest',16,'Basic Land — Forest',0,['G'],'({T}: Add {G}.)','']
  ];
  const utilityLands = [
    ['Command Tower',1,'Land',0,[],'{T}: Add one mana of any color in your commander’s color identity.',''],
    ['Exotic Orchard',1,'Land',0,[],'{T}: Add one mana of any color that a land an opponent controls could produce.',''],
    ['Path of Ancestry',1,'Land',0,[],'{T}: Add one mana of any color in your commander’s color identity.',''],
    ['Terramorphic Expanse',1,'Land',0,[],'{T}, Sacrifice Terramorphic Expanse: Search your library for a basic land card.',''],
    ['Evolving Wilds',1,'Land',0,[],'{T}, Sacrifice Evolving Wilds: Search your library for a basic land card.','']
  ];
  const cards = [
    ['Kenrith, the Returned King',1,'Legendary Creature — Human Noble',5,['W','U','B','R','G'],'{R}: All creatures gain trample and haste until end of turn. {G}: Put a +1/+1 counter on target creature. {W}: Target player gains 5 life. {U}: Target player draws a card. {B}: Put target creature card from a graveyard onto the battlefield under its owner’s control.','{4}{W}'],
    ['Arcane Signet',1,'Artifact',2,[],'{T}: Add one mana of any color in your commander’s color identity.','{2}'],
    ['Sol Ring',1,'Artifact',1,[],'{T}: Add {C}{C}.','{1}'],
    ['Commanders Sphere',1,'Artifact',3,[],'{T}: Add one mana of any color in your commander’s color identity. Sacrifice Commanders Sphere: Draw a card.','{3}'],
    ['Swiftfoot Boots',1,'Artifact — Equipment',2,[],'Equipped creature has hexproof and haste. Equip {1}.','{2}'],
    ['Skullclamp',1,'Artifact — Equipment',1,[],'Equipped creature gets +1/-1. When equipped creature dies, draw two cards. Equip {1}.','{1}'],
    ['Llanowar Elves',1,'Creature — Elf Druid',1,['G'],'{T}: Add {G}.','{G}'],
    ['Birds of Paradise',1,'Creature — Bird',1,['G'],'Flying. {T}: Add one mana of any color.','{G}'],
    ['Sakura-Tribe Elder',1,'Creature — Snake Shaman',2,['G'],'Sacrifice Sakura-Tribe Elder: Search your library for a basic land card and put it onto the battlefield tapped.','{1}{G}'],
    ['Cultivate',1,'Sorcery',3,['G'],'Search your library for up to two basic land cards. Put one onto the battlefield tapped and the other into your hand.','{2}{G}'],
    ['Kodamas Reach',1,'Sorcery',3,['G'],'Search your library for up to two basic land cards. Put one onto the battlefield tapped and the other into your hand.','{2}{G}'],
    ['Farseek',1,'Sorcery',2,['G'],'Search your library for a Plains, Island, Swamp, or Mountain card and put it onto the battlefield tapped.','{1}{G}'],
    ['Tireless Provisioner',1,'Creature — Elf Scout',3,['G'],'Whenever a land enters the battlefield under your control, create a Food or Treasure token.','{2}{G}'],
    ['Beast Within',1,'Instant',3,['G'],'Destroy target permanent. Its controller creates a 3/3 green Beast creature token.','{2}{G}'],
    ['Heroic Intervention',1,'Instant',2,['G'],'Permanents you control gain hexproof and indestructible until end of turn.','{1}{G}'],
    ['Eternal Witness',1,'Creature — Human Shaman',3,['G'],'When Eternal Witness enters the battlefield, you may return target card from your graveyard to your hand.','{1}{1}{G}'],
    ['Swords to Plowshares',1,'Instant',1,['W'],'Exile target creature. Its controller gains life equal to its power.','{W}'],
    ['Generous Gift',1,'Instant',3,['W'],'Destroy target permanent. Its controller creates a 3/3 green Elephant creature token.','{2}{W}'],
    ['Farewell',1,'Sorcery',6,['W'],'Choose one or more — Exile all artifacts, all creatures, all enchantments, and/or all graveyards.','{4}{W}{W}'],
    ['Soul Warden',1,'Creature — Human Cleric',1,['W'],'Whenever another creature enters the battlefield, you gain 1 life.','{W}'],
    ['Counterspell',1,'Instant',2,['U'],'Counter target spell.','{U}{U}'],
    ['Ponder',1,'Sorcery',1,['U'],'Look at the top three cards of your library, then put them back in any order. You may shuffle. Draw a card.','{U}'],
    ['Mulldrifter',1,'Creature — Elemental',5,['U'],'Flying. When Mulldrifter enters the battlefield, draw two cards.','{4}{U}'],
    ['Baleful Strix',1,'Artifact Creature — Bird',2,['U','B'],'Flying, deathtouch. When Baleful Strix enters the battlefield, draw a card.','{U}{B}'],
    ['Fact or Fiction',1,'Instant',4,['U'],'Reveal the top five cards of your library. An opponent separates them into two piles. Put one pile into your hand and the other into your graveyard.','{3}{U}'],
    ['Read the Bones',1,'Sorcery',3,['B'],'Scry 2, then draw two cards. You lose 2 life.','{2}{B}'],
    ['Go for the Throat',1,'Instant',2,['B'],'Destroy target nonartifact creature.','{1}{B}'],
    ['Crux of Fate',1,'Sorcery',5,['B'],'Choose one — Destroy all Dragon creatures, or destroy all non-Dragon creatures.','{3}{B}{B}'],
    ['Terminate',1,'Instant',2,['B','R'],'Destroy target creature. It can’t be regenerated.','{B}{R}'],
    ['Chaos Warp',1,'Instant',3,['R'],'The owner of target permanent shuffles it into their library, then reveals the top card. If it is a permanent card, they put it onto the battlefield.','{2}{R}'],
    ['Lightning Bolt',1,'Instant',1,['R'],'Lightning Bolt deals 3 damage to any target.','{R}'],
    ['Blasphemous Act',1,'Sorcery',9,['R'],'Blasphemous Act costs {1} less to cast for each creature on the battlefield. It deals 13 damage to each creature.','{8}{R}'],
    ['Austere Command',1,'Sorcery',6,['W'],'Choose two — Destroy all artifacts; destroy all enchantments; destroy all creatures with mana value 3 or less; or destroy all creatures with mana value 4 or greater.','{4}{W}{W}'],
    ['Solemn Simulacrum',1,'Artifact Creature — Golem',4,[],'When Solemn Simulacrum enters the battlefield, you may search your library for a basic land card and put it onto the battlefield tapped. When it dies, you may draw a card.','{4}'],
    ['Talisman of Dominance',1,'Artifact',2,[],'{T}: Add {C}. {T}: Add {U} or {B}. Talisman of Dominance deals 1 damage to you when tapped for colored mana.','{2}'],
    ['Talisman of Impulse',1,'Artifact',2,[],'{T}: Add {C}. {T}: Add {R} or {G}. Talisman of Impulse deals 1 damage to you when tapped for colored mana.','{2}'],
    ['Beast Whisperer',1,'Creature — Elf Druid',4,['G'],'Whenever you cast a creature spell, draw a card.','{2}{G}{G}'],
    ['Sun Titan',1,'Creature — Giant',6,['W'],'Whenever Sun Titan enters the battlefield or attacks, return target permanent card with mana value 3 or less from your graveyard to the battlefield.','{4}{W}{W}'],
    ['Putrefy',1,'Instant',3,['B','G'],'Destroy target artifact or creature. It can’t be regenerated.','{1}{B}{G}'],
    ['Merciless Eviction',1,'Sorcery',6,['W','B'],'Choose one — Exile all artifacts, all creatures, all enchantments, or all planeswalkers.','{4}{W}{B}'],
    ['Deepglow Skate',1,'Creature — Fish',4,['U'],'When Deepglow Skate enters the battlefield, double the number of each kind of counter on any number of target permanents.','{3}{U}'],
    ['Vandalblast',1,'Sorcery',1,['R'],'Destroy target artifact you don’t control. Overload {4}{R}.','{R}'],
    ['Krosan Grip',1,'Instant',3,['G'],'Split second. Destroy target artifact or enchantment.','{2}{G}'],
    ['Mortify',1,'Instant',3,['W','B'],'Destroy target creature or enchantment.','{1}{W}{B}'],
    ['Sphinx Revelation',1,'Instant',3,['W','U'],'You gain X life and draw X cards.','{X}{W}{U}'],
    ['Anguished Unmaking',1,'Instant',3,['W','B'],'Exile target nonland permanent. You lose 3 life.','{1}{W}{B}']
  ];
  return [...basics, ...utilityLands, ...cards].map(spec => makeExampleCard(...spec));
}
function loadExample() {
  if (collection.length && !confirm('Replace your current collection with a demo collection?')) return;
  collection = makeExampleCollection(); currentDeck = null; previousDeck = null; clearDeckEditPreview(); persist(); persistDeck(); renderCollection();
}

// Events
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
