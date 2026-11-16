import { describe, expect, it } from 'vitest';
import { guideImagesFromHtml, resizeWikiImage, wikiPageOf } from './wikiGuide';

const IMG = (name: string, alt: string, width = 300) =>
  `<figure><a href="#"><img alt="${alt}" src="data:image/gif;base64,R0lGOD" data-src="https://static.wikia.nocookie.net/escapefromtarkov_gamepedia/images/a/a1/${name}/revision/latest/scale-to-width-down/${width}?cb=1" width="${width}"></a><figcaption>${alt}</figcaption></figure>`;

const PAGE = `
<h2><span class="mw-headline" id="Objectives">Objectives</span></h2>
${IMG('Not_this.png', 'Before the guide')}
<h2><span class="mw-headline" id="Guide">Guide</span></h2>
${IMG('Key_icon.png', 'Office key icon', 64)}
${IMG('Desk.png', 'The wanted desk')}
${IMG('Desk.png', 'The wanted desk')}
${IMG('Door.png', 'Door on the second floor', 450)}
<h2><span class="mw-headline" id="Trivia">Trivia</span></h2>
${IMG('After.png', 'After the guide')}
`;

describe('quest location screenshots from the wiki', () => {
  it('takes only the Guide pictures, without icons or repeats, with their captions', () => {
    const imgs = guideImagesFromHtml(PAGE);
    expect(imgs.map((i) => i.caption)).toEqual(['The wanted desk', 'Door on the second floor']);
    expect(imgs[0].full).toBe('https://static.wikia.nocookie.net/escapefromtarkov_gamepedia/images/a/a1/Desk.png/revision/latest?cb=1');
    expect(imgs[0].thumb).toContain('/revision/latest/scale-to-width-down/360');
  });

  it('a page without a Guide gives nothing', () => {
    expect(guideImagesFromHtml('<h2><span class="mw-headline" id="Rewards">Rewards</span></h2>' + IMG('X.png', 'x'))).toEqual([]);
  });

  it('only wiki quest links count', () => {
    expect(wikiPageOf('https://escapefromtarkov.fandom.com/wiki/Health_Care_Privacy_-_Part_2')).toBe('Health_Care_Privacy_-_Part_2');
    expect(wikiPageOf('https://evil.example/wiki/X')).toBeNull();
    expect(wikiPageOf(undefined)).toBeNull();
    expect(resizeWikiImage('https://s/x.png/revision/latest/scale-to-width-down/311?cb=2', 0)).toBe('https://s/x.png/revision/latest?cb=2');
  });
});
