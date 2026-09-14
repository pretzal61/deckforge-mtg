# Deckforge

A local, responsive Magic: The Gathering deck-planning webpage. Open `index.html` in a modern browser.

It lets you record cards by name (using the Scryfall public card API for metadata), paste a collection list, import a copied MTG Arena deck export, choose a format and playstyle, and generate a deck constrained by your recorded card quantities. The Arena importer understands deck sections and strips Arena's set/collector-number suffixes before looking up cards. It also reports the main deck-building rules it checks: deck size, copy limits, Commander color identity, format legality returned by card lookup, and a basic mana-base diagnostic.

The page does not make claims that it has verified an entire tournament rules environment. It is deliberately clear where a judge/event-specific check is still appropriate.
