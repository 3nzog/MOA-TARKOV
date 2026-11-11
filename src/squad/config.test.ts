import { afterEach, describe, expect, it } from 'vitest';
import { getRelayUrl, normalizeRelayInput, RELAY_URL, setRelayOverride } from './config';

describe('squad relay address', () => {
  afterEach(() => setRelayOverride(null));

  it('turns what a player types into a ws URL on the relay port', () => {
    expect(normalizeRelayInput('26.10.20.30')).toBe('ws://26.10.20.30:8787');
    expect(normalizeRelayInput(' 26.10.20.30:9000 ')).toBe('ws://26.10.20.30:9000');
    expect(normalizeRelayInput('ws://amigo-pc:8787')).toBe('ws://amigo-pc:8787');
    expect(normalizeRelayInput('wss://relay.example.com')).toBe('wss://relay.example.com');
  });

  it('rejects anything that is not just an address', () => {
    expect(normalizeRelayInput('')).toBeNull();
    expect(normalizeRelayInput('http://26.10.20.30')).toBeNull();
    expect(normalizeRelayInput('ws://user:pass@host')).toBeNull();
    expect(normalizeRelayInput('ws://host/path')).toBeNull();
    expect(normalizeRelayInput('ws://host?x=1')).toBeNull();
    expect(normalizeRelayInput('not an address')).toBeNull();
  });

  it('uses the saved relay, else the default', () => {
    expect(getRelayUrl()).toBe(RELAY_URL);
    setRelayOverride('ws://26.10.20.30:8787');
    expect(getRelayUrl()).toBe('ws://26.10.20.30:8787');
  });
});
