# Deckforge

A local, responsive Magic: The Gathering deck-planning webpage. Open `index.html` in a modern browser.

It lets you record cards by name (using the Scryfall public card API for metadata), paste a collection list, import a copied MTG Arena deck export, choose a format and playstyle, and generate a deck constrained by your recorded card quantities. The Arena importer understands deck sections and strips Arena's set/collector-number suffixes before looking up cards.

After generating a deck, the local Deck Assistant can preview and apply in-place changes such as “make it faster,” “add more removal,” “add 2 more lands,” or “add/remove 2 Card Name.” It only selects eligible cards from the recorded collection, preserves copy, color, ownership, and format constraints where known, shows the exact proposed changes before applying them, and provides one-step undo. The generated and edited deck is saved in the browser on that device so it remains available after a refresh.

It also reports the main deck-building rules it checks: deck size, copy limits, recorded quantities when that option is enabled, Commander color identity, format legality returned by card lookup, and a basic mana-base diagnostic.

The page does not make claims that it has verified an entire tournament rules environment. It is deliberately clear where a judge/event-specific check is still appropriate.
