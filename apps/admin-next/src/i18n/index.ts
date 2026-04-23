// Aggregator for per-language JSON files. Keeps same export names as before.
import en from './en.json';
import zh from './zh.json';
import ja from './ja.json';
import ko from './ko.json';
import fr from './fr.json';
import de from './de.json';

import type { Locale } from '@lucky/shared';

type LocaleFile = {
  translations: Record<string, string>;
  blogCard?: Record<string, string>;
};

const enJson = en as unknown as LocaleFile;
const zhJson = zh as unknown as LocaleFile;
const jaJson = ja as unknown as LocaleFile;
const koJson = ko as unknown as LocaleFile;
const frJson = fr as unknown as LocaleFile;
const deJson = de as unknown as LocaleFile;

export const TRANSLATIONS: Record<Locale, Record<string, string>> = {
  en: enJson.translations,
  zh: zhJson.translations,
  ja: jaJson.translations,
  ko: koJson.translations,
  fr: frJson.translations,
  de: deJson.translations,
};

export const BLOG_TRANSLATION_CARD_TRANSLATIONS: Record<
  Locale,
  Record<string, string>
> = {
  en: enJson.blogCard || {},
  zh: zhJson.blogCard || {},
  ja: jaJson.blogCard || {},
  ko: koJson.blogCard || {},
  fr: frJson.blogCard || {},
  de: deJson.blogCard || {},
};

/**
 * Server-friendly synchronous getter for a single locale's translations.
 * Use this from Server Components (layout/page) to avoid shipping all locales to client.
 */
export function getTranslations(lang: Locale) {
  return TRANSLATIONS[lang] || TRANSLATIONS['en'];
}

/**
 * Client-side dynamic loader for a locale file. Returns the translations map.
 * Uses dynamic import so bundler can split locale files.
 */
export async function loadLocale(lang: Locale) {
  try {
    // Map Locale to file name used in this folder (en.json, zh.json, ...)
    const mod = await import(/* @vite-ignore */ `./${lang}.json`);
    const json = mod as unknown as LocaleFile;
    return json.translations || {};
  } catch (err) {
    // Fallback to built-in TRANSLATIONS to be resilient
    return getTranslations('en');
  }
}

export default TRANSLATIONS;
