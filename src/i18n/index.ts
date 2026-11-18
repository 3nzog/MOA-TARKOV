import i18n, { type Resource } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';

// English is built in (it is the fallback for any missing text); every other
// language is loaded on its own, only when chosen, so the app (and the phone
// page over Wi-Fi) does not carry all six on every start.
import en from './locales/en.json';

export const SUPPORTED_LANGS = ['en', 'pt', 'ru', 'ja', 'zh', 'es'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

type Texts = Record<string, unknown>;
const LOADERS: Record<Exclude<Lang, 'en'>, () => Promise<{ default: Texts }>> = {
  pt: () => import('./locales/pt.json'),
  ru: () => import('./locales/ru.json'),
  ja: () => import('./locales/ja.json'),
  zh: () => import('./locales/zh.json'),
  es: () => import('./locales/es.json'),
};

/** A language's texts (null when they could not load: English stands in). */
export async function loadTexts(lang: Lang): Promise<Texts | null> {
  if (lang === 'en') return en;
  try {
    return (await LOADERS[lang]()).default;
  } catch {
    return null;
  }
}

// Endonyms — each language named in itself, which is the expected convention
// for a language picker.
export const LANG_LABELS: Record<Lang, string> = {
  en: 'English',
  pt: 'Português (Brasil)',
  ru: 'Русский',
  ja: '日本語',
  zh: '中文',
  es: 'Español',
};

export const LANG_STORAGE_KEY = 'tc_lang_v1';

/**
 * Normalize any incoming code to one of our supported locales, or null if
 * unsupported. Handles:
 *  - navigator.language tags ("pt-BR", "zh-CN") → take the primary subtag
 *  - EFT's non-standard Game.ini codes (jp/ch/po) → map to ja/zh/pt
 */
export function normalizeLang(raw: string | null | undefined): Lang | null {
  if (!raw) return null;
  const c = raw.toLowerCase().split(/[-_]/)[0];
  switch (c) {
    case 'en':
      return 'en';
    case 'pt':
    case 'po': // EFT uses "po" for Portuguese
      return 'pt';
    case 'ru':
      return 'ru';
    case 'ja':
    case 'jp': // EFT uses "jp"
      return 'ja';
    case 'zh':
    case 'ch': // EFT uses "ch"
    case 'cn':
      return 'zh';
    case 'es':
      return 'es';
    default:
      return null;
  }
}

export async function detectGameLang(): Promise<Lang | null> {
  try {
    const raw = await invoke<string | null>('get_game_language');
    return normalizeLang(raw);
  } catch {
    return null; // outside Tauri, or the command/file was unavailable
  }
}

/**
 * Resolution order (first hit wins):
 *   1. explicit user choice (localStorage)
 *   2. EFT in-game language (Game.ini via Rust)
 *   3. system / browser language
 *   4. English
 */
export async function resolveInitialLang(): Promise<Lang> {
  const stored = normalizeLang(localStorage.getItem(LANG_STORAGE_KEY));
  if (stored) return stored;

  const game = await detectGameLang();
  if (game) return game;

  const sys = normalizeLang(typeof navigator !== 'undefined' ? navigator.language : null);
  if (sys) return sys;

  return 'en';
}

export async function setupI18n(): Promise<void> {
  const lng = await resolveInitialLang();
  // The chosen language's texts are in before the first render (no flash of English).
  const resources: Resource = { en: { translation: en } };
  const texts = lng === 'en' ? null : await loadTexts(lng);
  if (texts) resources[lng] = { translation: texts };
  await i18n.use(initReactI18next).init({
    resources,
    partialBundledLanguages: true,
    lng,
    fallbackLng: 'en',
    interpolation: { escapeValue: false }, // React already escapes
    returnNull: false,
  });
}

/** Persist + apply a user-chosen language (its texts loaded first, once). */
export async function changeLang(lang: Lang): Promise<void> {
  localStorage.setItem(LANG_STORAGE_KEY, lang);
  if (!i18n.hasResourceBundle(lang, 'translation')) {
    const texts = await loadTexts(lang);
    if (texts) i18n.addResourceBundle(lang, 'translation', texts, true, true);
  }
  await i18n.changeLanguage(lang);
}

export { i18n };
