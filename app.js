/* Deckforge is intentionally local-first. Only card lookups use Scryfall's public API. */
const STORAGE_KEY = 'deckforge-collection-v1';
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
let currentDeck = null;
let selectedColors = new Set();

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const els = {
  format: $('#formatSelect'), style: $('#styleSelect'), commander: $('#commanderSelect'), collectionGrid: $('#collectionGrid'),
  collectionCount: $('#collectionCount'), uniqueCount: $('#uniqueCount'), collectionMeter: $('#collectionMeter'), collectionSearch: $('#collectionSearch'),
  importDialog: $('#importDialog'), rulesDialog: $('#rulesDialog'), importText: $('#importText'), importMessage: $('#importMessage'), singleMessage: $('#singleMessage'),
  emptyDeck: $('#emptyDeck'), deckResult: $('#deckResult'), deckTitle: $('#deckTitle'), deckSubtitle: $('#deckSubtitle'), deckTotal: $('#deckTotal'),
  deckList: $('#deckList'), deckColorDots: $('#deckColorDots'), planTitle: $('#planTitle'), planText: $('#planText'), manaCurve: $('#manaCurve'), rulesStatus: $('#rulesStatus'), fullRulesReport: $('#fullRulesReport')
};

function loadCollection() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; } }
function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(collection)); }
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

function removeCard(id) { collection = collection.filter(card => card.id !== id); persist(); renderCollection(); }
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
  renderDeck(result);
}

function validateDeck(result) {
  const { deck, format, commander, deckColors, required, landTarget } = result; const total = deckCount(deck); const items = [];
  const isCommander = format === 'commander'; const legalSize = isCommander ? total === required : total >= required;
  items.push({ type: legalSize ? 'pass' : 'fail', title: 'Deck size', text: legalSize ? `${total} cards meets the ${isCommander ? 'exactly 100' : '60-card minimum'} for ${FORMAT_LABELS[format]}.` : `${total} cards recorded; ${isCommander ? 'Commander needs exactly 100' : 'constructed formats need at least 60'}.` });
  const lands = deck.filter(entry => cardRole(entry.card).land).reduce((sum,e) => sum + e.count, 0);
  items.push({ type: lands >= Math.max(18, landTarget - 3) ? 'pass' : 'warn', title: 'Mana base', text: `${lands} lands included; the plan targets about ${landTarget}. ${lands < landTarget ? 'More owned lands would make the deck more consistent.' : 'The land count supports this plan.'}` });
  const tooMany = deck.filter(entry => entry.count > (isCommander ? 1 : 4) && !isBasicLand(entry.card));
  items.push({ type: tooMany.length ? 'fail' : 'pass', title: 'Copy limit', text: tooMany.length ? `${tooMany.map(entry => entry.card.name).join(', ')} exceeds the normal copy limit.` : isCommander ? 'Every non-basic card appears no more than once.' : 'No non-basic card exceeds four copies.' });
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

function renderDeck(result) {
  els.emptyDeck.classList.add('hidden'); els.deckResult.classList.remove('hidden');
  const total = deckCount(result.deck); const [planTitle, planText] = STYLE_COPY[result.style];
  els.deckTitle.textContent = result.commander ? `${result.commander.name} ${result.style === 'balanced' ? 'good-stuff' : result.style} deck` : `${FORMAT_LABELS[result.format]} ${result.style} deck`;
  els.deckSubtitle.textContent = `${FORMAT_LABELS[result.format]} · built only from ${result.strictOwned ? 'the quantities you recorded' : 'your recorded cards'} · ${total === result.required ? 'target size reached' : `${result.required - total} cards short`}`;
  els.deckTotal.textContent = total; els.planTitle.textContent = planTitle; els.planText.textContent = planText;
  els.deckColorDots.innerHTML = [...result.deckColors].map(color => `<i>${color}</i>`).join('') || '<i>◇</i>';
  renderDeckList(result.deck); renderManaCurve(result.deck); renderRules(result.report);
  $('#deckOutput').scrollIntoView({ behavior:'smooth', block:'start' });
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
function mergeCard(incoming, quantity) { const existing = collection.find(card => normalizeName(card.name) === normalizeName(incoming.name)); if (existing) { existing.quantity += quantity; Object.assign(existing, incoming, { quantity: existing.quantity }); } else collection.push({ ...incoming, quantity }); persist(); }
async function addNamedCard(name, quantity, messageElement) { messageElement.textContent = `Looking up ${name}…`; const card = await lookupCard(name); mergeCard(card, quantity); messageElement.textContent = `Added ${quantity}× ${card.name}.`; return card; }

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
function openImport() { els.importMessage.textContent = ''; els.singleMessage.textContent = ''; els.importDialog.showModal(); }
function copyDeck() { if (!currentDeck) return; navigator.clipboard?.writeText(decklistText()).then(() => { $('#copyDeckButton').textContent = 'Copied!'; setTimeout(() => $('#copyDeckButton').textContent = 'Copy list', 1200); }); }
function decklistText() { const lines = []; if (currentDeck.commander) lines.push(`Commander\n1 ${currentDeck.commander.name}\n`); const groups = {}; currentDeck.deck.filter(entry => entry.card.id !== currentDeck.commander?.id).forEach(entry => (groups[groupForCard(entry.card)] ||= []).push(entry)); ['Creatures','Planeswalkers','Instants','Sorceries','Artifacts','Other spells','Lands'].forEach(group => { if (groups[group]) { lines.push(group); groups[group].sort((a,b)=>a.card.name.localeCompare(b.card.name)).forEach(entry => lines.push(`${entry.count} ${entry.card.name}`)); lines.push(''); } }); return lines.join('\n').trim(); }
function exportDeck() { if (!currentDeck) return; const blob = new Blob([decklistText()], { type:'text/plain' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'deckforge-decklist.txt'; a.click(); URL.revokeObjectURL(a.href); }

function makeExampleCard(name, quantity, typeLine, cmc, identity, text, manaCost) { return { id:`sample-${name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`,name,quantity,typeLine,cmc,colorIdentity:identity,oracleText:text,manaCost,legalities:null,imageUri:'' }; }
function loadExample() {
  if (collection.length && !confirm('Replace your current collection with a demo collection?')) return;
  collection = [
    makeExampleCard('Forest',22,'Basic Land — Forest',0,['G'],'({T}: Add {G}.)',''), makeExampleCard('Llanowar Elves',4,'Creature — Elf Druid',1,['G'],'{T}: Add {G}.','{G}'), makeExampleCard('Elvish Mystic',4,'Creature — Elf Druid',1,['G'],'{T}: Add {G}.','{G}'), makeExampleCard('Wildwood Tracker',4,'Creature — Elf Warrior',1,['G'],'Whenever Wildwood Tracker attacks or blocks, if you control another non-Human creature, it gets +1/+1 until end of turn.','{G}'), makeExampleCard('Leafkin Druid',3,'Creature — Elemental Druid',2,['G'],'{T}: Add {G}.','{1}{G}'), makeExampleCard('Beast Whisperer',3,'Creature — Elf Druid',4,['G'],'Whenever you cast a creature spell, you may draw a card.','{2}{G}{G}'), makeExampleCard('Steel Leaf Champion',4,'Creature — Elf Knight',3,['G'],'Steel Leaf Champion cannot be blocked by creatures with power 2 or less.','{G}{G}{G}'), makeExampleCard('Garruks Uprising',2,'Enchantment',3,['G'],'When Garruks Uprising enters the battlefield, if you control a creature with power 4 or greater, draw a card. Creature spells you control have trample.','{2}{G}'), makeExampleCard('Questing Beast',2,'Legendary Creature — Beast',4,['G'],'Vigilance, deathtouch, haste.','{2}{G}{G}'), makeExampleCard('Overrun',2,'Sorcery',5,['G'],'Creatures you control get +3/+3 and gain trample until end of turn.','{2}{G}{G}{G}'), makeExampleCard('Return to Nature',2,'Instant',2,['G'],'Choose one — Destroy target artifact; destroy target enchantment; or exile target card from a graveyard.','{1}{G}')
  ]; persist(); renderCollection();
}

// Events
$('#openImportButton').addEventListener('click', openImport); $('#emptyImportButton').addEventListener('click', openImport); $('#collectionImportButton').addEventListener('click', openImport);
$('#importListButton').addEventListener('click', importList); $('#addSingleButton').addEventListener('click', async () => { const name = $('#singleCardName').value.trim(); const qty = Math.max(1, Number($('#singleQuantity').value || 1)); if (!name) { els.singleMessage.textContent = 'Enter a card name.'; return; } try { $('#addSingleButton').disabled = true; await addNamedCard(name, qty, els.singleMessage); persist(); renderCollection(); $('#singleCardName').value = ''; } catch (error) { els.singleMessage.textContent = error.message; } finally { $('#addSingleButton').disabled = false; } });
$$('.import-tab').forEach(tab => tab.addEventListener('click', () => { $$('.import-tab').forEach(button => button.classList.toggle('active', button === tab)); $$('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `${tab.dataset.tab}Panel`)); }));
$('#exampleButton').addEventListener('click', loadExample); $('#clearCollectionButton').addEventListener('click', () => { if (collection.length && confirm('Clear every card from this local collection?')) { collection = []; currentDeck = null; persist(); renderCollection(); els.deckResult.classList.add('hidden'); els.emptyDeck.classList.remove('hidden'); } });
els.collectionSearch.addEventListener('input', renderCollection); $$('#colorPips button').forEach(button => button.addEventListener('click', () => { const color = button.dataset.color; selectedColors.has(color) ? selectedColors.delete(color) : selectedColors.add(color); button.classList.toggle('selected', selectedColors.has(color)); }));
els.format.addEventListener('change', () => { const isCommander = els.format.value === 'commander'; $$('.commander-only').forEach(el => el.style.display = isCommander ? 'block' : 'none'); $$('.noncommander-only').forEach(el => el.style.display = isCommander ? 'none' : 'block'); });
$('#generateButton').addEventListener('click', generateDeck); $('#copyDeckButton').addEventListener('click', copyDeck); $('#exportDeckButton').addEventListener('click', exportDeck); $('#viewRulesButton').addEventListener('click', () => els.rulesDialog.showModal());

renderCollection(); els.format.dispatchEvent(new Event('change'));
