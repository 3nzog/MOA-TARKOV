import { describe, expect, it } from 'vitest';
import { exitReqs } from './extractReqs';
import { extractsFromHtml } from './wikiExtracts';

const tags = (requirements: string, extra: { always?: boolean; singleUse?: boolean } = {}) =>
  exitReqs({ requirements, ...extra })?.tags.map((t) => (t.arg ? `${t.tag}:${t.arg}` : t.tag)) ?? null;

describe("what an exit asks for (the wiki's words, as tags)", () => {
  it('reads the climbing exits, the flares, the notes and the rest', () => {
    expect(tags('Red Rebel ice pick\nParacord\nNo armor vest equipped')).toEqual(['paracord', 'redRebel', 'noArmor']);
    expect(tags('No backpack equipped')).toEqual(['noBackpack']);
    expect(tags('Green flare = Open')).toEqual(['greenFlare']);
    expect(tags("Shoot a green flare into the sky while inside the signal flare area. If the flare doesn't reach a certain height")).toEqual(['flareZone']);
    expect(tags('Note with code word Voron')).toEqual(['codeNote:Voron']);
    expect(tags('Minefield map (Woods)')).toEqual(['minefieldMap']);
    expect(tags('Scav + PMC')).toEqual(['coop']);
    expect(tags('per player\nMaximum of 4 players')).toEqual(['pay']);
    expect(tags('Activate lever in warehouse #4 at the crane yard.')).toEqual(['lever']);
    expect(tags('1.Turn on power at the power station 2.Flush urinal 3.Swipe Object #11SR keycard')).toEqual(['power', 'lever', 'keyItem']);
    expect(tags('Something new')).toEqual(['other']);
  });

  it('nothing asked: nothing shown, unless it is not always open or works once', () => {
    expect(tags('-')).toBeNull();
    expect(tags('')).toBeNull();
    expect(tags('-', { always: false, singleUse: true })).toEqual(['notAlways', 'singleUse']);
  });

  it("reads the wiki table's requirement and availability columns by their headers", () => {
    const html = `<h2><span class="mw-headline" id="Extractions">Extractions</span></h2>
      <table>
        <tr><th>Extraction</th><th>Name</th><th>Faction</th><th>Always available</th><th>Single-Use</th><th>Requirements</th><th>Notes</th></tr>
        <tr><td></td><td>Cliff Descent</td><td>PMC</td><td>✔</td><td>✘</td><td>Red Rebel ice pick<br>Paracord</td><td></td></tr>
        <tr><td></td><td>Dorms V-Ex</td><td>PMC</td><td>✘</td><td>✔</td><td>per player</td><td></td></tr>
      </table>`;
    const rows = extractsFromHtml(html);
    expect(rows.map((r) => [r.name, r.requirements, r.always, r.singleUse])).toEqual([
      ['Cliff Descent', 'Red Rebel ice pick\nParacord', true, false],
      ['Dorms V-Ex', 'per player', false, true],
    ]);
  });
});
