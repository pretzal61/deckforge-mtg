const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/app.js', 'utf8');
const formats = ['casual','standard','pioneer','modern','legacy','vintage','commander'];
const styles = ['balanced','aggro','midrange','control','ramp','tokens','combo'];
const legalities = Object.fromEntries(formats.map(f => [f,'legal']));
function card(name, quantity = 1, colors = ['G'], typeLine = 'Creature', cmc = 2) {
  return {id:name,name,quantity,colorIdentity:colors,typeLine,cmc,manaCost:colors.map(c=>'{'+c+'}').join(''),oracleText:'',legalities:{...legalities}};
}
const basics = ['Plains','Island','Swamp','Mountain','Forest'].map((n,i)=>card(n,90,[['W','U','B','R','G'][i]],'Basic Land — '+n,0));
function harness(storage = new Map(), boot = false) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) {
      const events = {};
      nodes.set(id,{value:'',checked:true,disabled:false,textContent:'',innerHTML:'',style:{},dataset:{},
        classList:{add(){},remove(){},toggle(){}},after(){},append(){},setAttribute(){},scrollIntoView(){},
        addEventListener(event,fn){(events[event] ||= []).push(fn);},dispatchEvent(event){for(const fn of events[event.type] || [])fn(event);},
        content:{cloneNode(){return {querySelector:node};}}
      });
    }
    return nodes.get(id);
  };
  node('#formatSelect').value = 'casual'; node('#styleSelect').value = 'balanced';
  const state = {fail:false,confirm:true};
  const context = vm.createContext({console,setTimeout,clearTimeout,AbortController,URLSearchParams,Event,
    confirm:()=>state.confirm, alert:message=>{throw Error(message);},
    document:{querySelector:node,querySelectorAll:()=>[],createElement:()=>node('#exampleStatus')},
    localStorage:{getItem:k=>storage.get(k)||null,setItem(k,v){if(state.fail)throw Error('QuotaExceededError');storage.set(k,v);}},
    fetch:()=>{throw Error('Unexpected network request');}
  });
  vm.runInContext(boot ? source : source.split('// Events')[0],context);
  const run = code => vm.runInContext(code,context);
  function build(cards,format='casual',colors=['G'],strict=true,commander=null,style='balanced') {
    context.input = {cards,format,colors,strict,commander,style};
    return run('collection=input.cards; currentDeck=buildDeck(collection,input.format,input.style,input.commander,input.strict,new Set(input.colors)); currentDeck');
  }
  return {context,node,state,storage,run,build};
}
function goodDeck(h,result) {
  assert.equal(result.report.filter(r=>r.type==='fail').length,0);
  assert.equal(h.run('deckCount(currentDeck.deck)'),result.required);
  for(const entry of result.deck) {
    if(result.strictOwned)assert(entry.count<=entry.card.quantity);
    if(!entry.card.typeLine.includes('Basic Land'))assert(entry.count<=(result.format==='commander'||entry.card.legalities[result.format]==='restricted'?1:4));
    assert(entry.card.colorIdentity.every(c=>result.deckColors.has(c)));
  }
}
test('mana selection supplies both colors and respects owned land shortages',()=>{
  const h=harness();
  const spells=Array.from({length:12},(_,i)=>card('Spell '+i,4,[i%2?'G':'W']));
  const result=h.build([basics[4],basics[0],...spells],'standard',['G','W']);goodDeck(h,result);
  const counts=result.deck.filter(e=>e.card.typeLine.includes('Land')).map(e=>e.count);
  assert.equal(counts.length,2);assert(counts.every(n=>n===12));
  const scarce=h.build([{...basics[4],quantity:4},{...basics[0],quantity:90},...spells],'standard',['G','W']);goodDeck(h,scarce);
  assert.equal(scarce.deck.find(e=>e.card.name==='Forest').count,4);
});
test('mana allocation follows unequal spell demand and understands multicolor lands',()=>{
  const h=harness();const spells=Array.from({length:12},(_,i)=>card('Spell '+i,4,[i<9?'G':'W']));
  const r=h.build([basics[0],basics[4],...spells],'standard',['G','W']);goodDeck(h,r);
  assert(r.deck.find(e=>e.card.name==='Forest').count>r.deck.find(e=>e.card.name==='Plains').count);
  const dual={...card('Dual',4,[],'Land',0),producedMana:['G','W']};
  const d=h.build([dual,basics[0],basics[4],...spells],'standard',['G','W']);goodDeck(h,d);
  assert.equal(d.deck.find(e=>e.card.name==='Dual').count,4);
});
test('colorless Commander rejects colored cards in generation, editing, and validation',()=>{
  const h=harness(),leader=card('Colorless leader',1,[],'Legendary Creature');
  const r=h.build([leader,card('Wastes',90,[],'Basic Land — Wastes',0),...Array.from({length:70},(_,i)=>card('Artifact '+i,1,[],'Artifact')),card('Green spell',4)],'commander',[],true,leader);goodDeck(h,r);
  assert(!r.deck.some(e=>e.card.name==='Green spell'));
  assert.equal(h.run('canAddToEditedDeck(collection.at(-1),currentDeck)'),false);
  h.run('currentDeck.deck[1]={card:collection.at(-1),count:1}');
  assert.equal(h.run("validateDeck(currentDeck).find(r=>r.title==='Commander identity').type"),'fail');
});
test('Vintage restricted cards are capped at one and excess copies fail validation',()=>{
  for(const strict of [true,false]) {
    const h=harness(),restricted=card('Restricted',4,['U'],'Instant',1);restricted.legalities.vintage='restricted';
    const r=h.build([basics[1],restricted,...Array.from({length:12},(_,i)=>card('Blue spell '+i,4,['U']))],'vintage',['U'],strict);goodDeck(h,r);
    assert.equal(r.deck.find(e=>e.card.name==='Restricted').count,1);
    assert.equal(h.run('canAddToEditedDeck(collection[1],currentDeck)'),false);
    h.run("currentDeck.deck.find(e=>e.card.name==='Restricted').count=4");
    assert.equal(h.run("validateDeck(currentDeck).find(r=>r.title==='Copy limit').type"),'fail');
    assert.equal(h.run("validateDeck(currentDeck).find(r=>r.title==='Format legality').type"),'fail');
  }
});
test('Commander assistant adds basic lands and preserves deck size and undo',()=>{
  const h=harness(),leader=card('Leader',1,['G'],'Legendary Creature');
  h.build([leader,basics[4],...Array.from({length:70},(_,i)=>card('Spell '+i))],'commander',['G'],true,leader);
  const plan=h.run("planDeckEdit('add 2 more lands')");
  assert.equal(plan.draft.deck.filter(e=>e.card.typeLine.includes('Land')).reduce((n,e)=>n+e.count,0),40);
  h.context.plan=plan;h.run('pendingDeckEdit=plan;applyDeckEdit()');goodDeck(h,h.run('currentDeck'));
  h.run('undoDeckEdit()');assert.equal(h.run('countDeckLands(currentDeck.deck)'),38);
});
test('negative land requests do not also add lands; mixed commands retain both directions',()=>{
  const h=harness();h.build([basics[4],...Array.from({length:20},(_,i)=>card('Spell '+i,4))]);
  for(const command of ['remove 2 lands','cut two lands','reduce 2 lands','fewer lands']) {
    const plan=h.run('planDeckEdit('+JSON.stringify(command)+')');
    assert.equal(plan.draft.deck.filter(e=>e.card.typeLine.includes('Land')).reduce((n,e)=>n+e.count,0),22);
    assert(![...plan.changes.added.values()].some(e=>e.card.typeLine.includes('Land')));
  }
  assert.equal(h.run("amountFor('remove 2 lands and add 3 lands','lands?',2)"),3);
});
test('Arena counts main plus sideboard, deduplicates companion only, preserves maximum-import mode',()=>{
  const h=harness();
  const parse=t=>{h.context.text=t;return h.run('parseArenaDeck(text).cards[0].quantity');};
  assert.equal(parse('Deck\n2 Example (SET) 1\nSideboard\n2 Example (SET) 1'),4);
  assert.equal(parse('Companion\n1 Example\nDeck\n2 Example\nSideboard\n1 Example'),3);
  assert.equal(parse('Companion\n1 Example\nSideboard\n1 Example'),1);
  assert.equal(parse('Companion\n1 Example'),1);
  h.context.incoming=card('Example',0);h.run("collection=[];mergeCard(incoming,4,'maximum');mergeCard(incoming,4,'maximum')");
  assert.equal(h.run('totalOwned()'),4);
  h.run("mergeCard(incoming,4,'add')");assert.equal(h.run('totalOwned()'),8);
});
test('all 49 example combinations generate valid decks under both quantity settings',()=>{
  const h=harness();
  for(const format of formats)for(const style of styles) {
    const colors=h.run('EXAMPLE_PLANS['+JSON.stringify(style)+'].colors');
    const leader=format==='commander'?card('Demo leader',1,colors,'Legendary Creature'):null;
    const pool=Array.from({length:95},(_,i)=>({...card('Example '+i,4,[colors[i%colors.length]],i%3?'Creature':'Instant',i%7+1),oracleText:['Create a creature token.','Draw a card.','Counter target spell.','Search your library for a basic land card.'][i%4]}));
    h.context.fixture={format,style,leader,pool,basics};
    const example=h.run('assembleExample(fixture.format,fixture.style,fixture.leader,fixture.pool,fixture.basics)');
    for(const strict of [true,false]) {
      const r=h.build(example.cards,format,colors,strict,leader,style);goodDeck(h,r);
      assert.equal(h.run('countDeckLands(currentDeck.deck)'),h.run('targetLandCount(input.format,input.style)'));
    }
  }
});
test('example storage failure preserves memory, previews, and existing saved data; success reloads together',async()=>{
  const h=harness();h.build([basics[4],...Array.from({length:12},(_,i)=>card('Old '+i,4))]);h.run('persist()');
  const before=h.run('JSON.stringify({collection,currentDeck})'),saved=[...h.storage];
  h.context.demo={cards:[{...basics[4],quantity:24},...Array.from({length:9},(_,i)=>card('New '+i,4))],colors:['G'],commander:null};
  h.run('makeExampleCollection=async()=>demo;pendingDeckEdit={sentinel:true}');h.state.fail=true;
  await h.run('loadExample()');
  assert.equal(h.run('JSON.stringify({collection,currentDeck})'),before);assert.deepEqual([...h.storage],saved);
  assert.equal(h.run('pendingDeckEdit.sentinel'),true);assert.match(h.node('#exampleStatus').textContent,/were not replaced/);
  h.state.fail=false;await h.run('loadExample()');
  assert.match(h.node('#exampleStatus').textContent,/Example ready/);goodDeck(h,h.run('currentDeck'));
  const reload=harness(h.storage,true);assert.equal(reload.run('deckCount(currentDeck.deck)'),60);
  assert.equal(reload.run('collection.some(c=>c.name.startsWith("Old"))'),false);
  assert.match(reload.node('#deckList').innerHTML,/New /);
});
test('legacy saves migrate without deletion and a failed migration remains recoverable',()=>{
  const h=harness();const cards=[basics[4],...Array.from({length:12},(_,i)=>card('Legacy '+i,4))];const r=h.build(cards);
  const storage=new Map([['deckforge-collection-v1',JSON.stringify(cards)],['deckforge-current-deck-v1',JSON.stringify({...r,deckColors:[...r.deckColors]})]]);
  const old=[...storage];const migration=harness(storage);migration.state.fail=true;
  assert.throws(()=>migration.run('persist()'),/Quota/);assert.deepEqual([...storage],old);
  migration.state.fail=false;migration.run('persist()');assert(storage.has('deckforge-state-v2'));
  const reload=harness(storage,true);assert.equal(reload.run('totalOwned()'),138);assert.equal(reload.node('#deckTotal').textContent,60);
  reload.run('collection=[];currentDeck=null;persist()');const empty=harness(storage,true);assert.equal(empty.run('collection.length'),0);
});
test('cancelled, failed, and stale example requests preserve existing collection',async()=>{
  const h=harness();h.build([basics[4],...Array.from({length:12},(_,i)=>card('Old '+i,4))]);const before=h.run('JSON.stringify({collection,currentDeck})');
  h.run('makeExampleCollection=async()=>{throw Error("Offline")}');await h.run('loadExample()');assert.equal(h.run('JSON.stringify({collection,currentDeck})'),before);
  h.state.confirm=false;h.run('makeExampleCollection=async()=>{throw Error("Should not run")}');await h.run('loadExample()');assert.equal(h.run('JSON.stringify({collection,currentDeck})'),before);
  h.state.confirm=true;h.run("makeExampleCollection=async()=>{els.style.value='aggro';return {cards:[],colors:['G'],commander:null}}");await h.run('loadExample()');assert.match(h.node('#exampleStatus').textContent,/Nothing was replaced/);
  assert.equal(h.node('#exampleButton').disabled,false);
});
test('mobile rule keeps example container visible and asset URLs are refreshed',()=>{
  const css=fs.readFileSync(__dirname+'/styles.css','utf8'),html=fs.readFileSync(__dirname+'/index.html','utf8');
  assert.match(css,/@media\s*\(max-width:760px\)\s*\{\s*\.sidebar \.sidebar-foot\s*\{\s*display:block/);
  assert.match(html,/styles.css\?v=20260918-1/);assert.match(html,/app.js\?v=20260918-1/);
});
