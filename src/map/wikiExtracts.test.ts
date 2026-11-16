import { describe, expect, it } from 'vitest';
import { extractKey, extractsFromHtml, findWikiExtract, wikiMapPage, wikiMapUrl } from './wikiExtracts';

// Same shape as the wiki's map pages: an "Extractions" h2, then a table whose
// rows are <th>picture</th><th>name</th>…, pictures sometimes also in Notes.
const IMG = (file: string, width = 240) =>
  `<span typeof="mw:File"><a href="#"><img alt="${file}" src="https://static.wikia.nocookie.net/escapefromtarkov_gamepedia/images/8/82/${file}/revision/latest/scale-to-width-down/${width}?cb=1" width="${width}" height="135"></a></span>`;
const PAGE = `
<h2><span class="mw-headline" id="Description">Description</span></h2>
<table><tr><th>${IMG('Not_an_exit.png')}</th><th>Nope</th></tr></table>
<h2><span class="mw-headline" id="Extractions">Extractions</span></h2>
<p>To locate the extractions use the maps below the table.</p>
<table class="wikitable"><tbody>
<tr><th>Extraction</th><th>Name</th><th>Faction</th></tr>
<tr><th>${IMG('Administration_Gate.png')}</th><th style="text-align: left;">Administration Gate
</th><td>Scav</td></tr>
<tr><th>${IMG('Boiler_room_basement.png')}</th><th>Boiler Room Basement (Co-op)</th><td>All</td><td>${IMG('Boiler_room_basement2.png')}${IMG('Key_icon.png', 32)}</td></tr>
<tr><th>${IMG('Smugglers_Boat.png')}</th><th>Smugglers' Boat
Note: This extraction does currently not work.</th><td>PMC</td></tr>
</tbody></table>
<h2><span class="mw-headline" id="Transits">Transits</span></h2>
<table><tr><th>${IMG('Transit.png')}</th><th>Transit to Reserve</th></tr></table>`;

describe('extraction pictures from the wiki', () => {
  it('reads the Extractions table only, with every picture of a row', () => {
    const rows = extractsFromHtml(PAGE);
    expect(rows.map((r) => r.name)).toEqual(['Administration Gate', 'Boiler Room Basement (Co-op)', "Smugglers' Boat"]);
    expect(rows[1].images).toHaveLength(2); // the key icon is left out
    expect(rows[0].images[0].full).toBe(
      'https://static.wikia.nocookie.net/escapefromtarkov_gamepedia/images/8/82/Administration_Gate.png/revision/latest?cb=1',
    );
    expect(rows[0].images[0].thumb).toContain('scale-to-width-down/480');
  });

  it('matches the game names to the wiki rows', () => {
    const rows = extractsFromHtml(PAGE);
    expect(extractKey("Smuggler's Boat (Co-op)")).toBe('smugglers boat');
    expect(findWikiExtract(rows, ["Smuggler's Boat"])?.name).toBe("Smugglers' Boat");
    expect(findWikiExtract(rows, ['Boiler Room Basement'])?.name).toBe('Boiler Room Basement (Co-op)');
    expect(findWikiExtract(rows, ['Portão da administração', 'Administration gate'])?.name).toBe('Administration Gate');
    expect(findWikiExtract(rows, ['ZB-1011'])).toBeNull();
  });

  it('knows the map pages', () => {
    expect(wikiMapPage('5714dc692459777137212e12')).toBe('Streets_of_Tarkov');
    expect(wikiMapUrl('56f40101d2720b2a4d8b45d6')).toBe('https://escapefromtarkov.fandom.com/wiki/Customs#Extractions');
    expect(wikiMapPage('nope')).toBeNull();
  });
});
