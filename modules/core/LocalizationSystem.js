import { numClamp, numWrap } from '@rapid-sdk/math';

import { AbstractSystem } from './AbstractSystem.js';
import { utilDetect } from '../util/detect.js';


/**
 * `LocalizationSystem` manages language and locale parameters including translated strings
 */
export class LocalizationSystem extends AbstractSystem {

  /**
   * @constructor
   * @param  `context`   Global shared application context
   */
  constructor(context) {
    super(context);
    this.id = 'l10n';
    this.dependencies = new Set(['dataloader', 'presets', 'urlhash']);

    // These are the different language packs that can be loaded..
    this._scopes = new Set(['core', 'tagging', 'imagery', 'community']);


    // `_languages`
    // All known language codes and their local name. This is used for the language pickers.
    // {
    //   "ar": { "nativeName": "العربية" },
    //   "de": { "nativeName": "Deutsch" },
    //   "en": { "nativeName": "English" },
    //   …
    // }
    this._languages = {};

    // `_locales`
    // All supported locale codes that we can fetch translated strings for.
    // We generate this based on the data that we fetch from Transifex.
    //
    // * `rtl` - right-to-left or left-to-right text direction
    //
    // {
    //   "ar":    { "rtl": true },
    //   "ar-AA": { "rtl": true },
    //   "en":    { "rtl": false },
    //   "en-AU": { "rtl": false },
    //   "en-GB": { "rtl": false },
    //   "de":    { "rtl": false },
    //   …
    // }
    this._locales = {};

    // `_cache`
    // Where we keep all loaded string data, organized by "locale" then "scope":
    // {
    //   en: {
    //     core:    { icons: {…}, toolbar: {…}, modes: {…}, operations: {…}, … },
    //     tagging: { presets: {…}, fields: {…}, … },
    //     …
    //   },
    //   de: {
    //     core:    { icons: {…}, toolbar: {…}, modes: {…}, operations: {…}, … },
    //     tagging: { presets: {…}, fields: {…}, … },
    //     …
    //   },
    // }
    this._cache = {};

    this._initPromise = null;
    this._preferredLocaleCodes = [];
    this._currLocaleCode = 'en-US';            // The current locale
    this._currLocaleCodes = ['en-US', 'en'];   // Must contain `_currLocaleCode` first, followed by fallbacks
    this._currLanguageCode = 'en';
    this._currTextDirection = 'ltr';
    this._currIsMetric = false;
    this._languageNames = {};
    this._scriptNames = {};

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.t = this.t.bind(this);
    this.tHtml = this.tHtml.bind(this);
    this.tAppend = this.tAppend.bind(this);
  }


  // getters for the current locale parameters
  localeCode()     { return this._currLocaleCode;    }
  localeCodes()    { return this._currLocaleCodes;   }
  languageCode()   { return this._currLanguageCode;  }
  textDirection()  { return this._currTextDirection; }
  usesMetric()     { return this._currIsMetric;      }
  languageNames()  { return this._languageNames;     }
  scriptNames()    { return this._scriptNames;       }
  isRTL()          { return this._currTextDirection === 'rtl'; }

  /**
   * preferredLocaleCodes
   * Allows the user to manually set the locale, overriding the locales specified by the browser
   * If you're going to use this, you must call it before `initAsync` starts fetching data.
   * @param  {Array|string}  codes - Array or String of preferred locales
   */
  set preferredLocaleCodes(codes) {
    if (typeof codes === 'string') {
      // Be generous and accept delimited strings as input
      this._preferredLocaleCodes = codes.split(/,|;| /gi).filter(Boolean);
    } else {
      this._preferredLocaleCodes = codes || [];
    }
  }
  get preferredLocaleCodes() {
    return this._preferredLocaleCodes;
  }


  /**
   * initAsync
   * Called after all core objects have been constructed.
   * @return {Promise} Promise resolved after the files have been loaded
   */
  initAsync() {
    if (this._initPromise) return this._initPromise;

    for (const id of this.dependencies) {
      if (!this.context.systems[id]) {
        return Promise.reject(`Cannot init:  ${this.id} requires ${id}`);
      }
    }

    const dataloader = this.context.systems.dataloader;
    const urlhash = this.context.systems.urlhash;
    const prerequisites = Promise.all([
      dataloader.initAsync(),
      urlhash.initAsync()
    ]);

    return this._initPromise = prerequisites
      .then(() => {
        return Promise.all([
          dataloader.getDataAsync('languages'),
          dataloader.getDataAsync('locales')
        ]);
      })
      .then(results => {
        this._languages = results[0].languages;
        this._locales = results[1].locales;

        // Choose the preferred locales in this order:
        //   1. any locales stored in `_preferredLocaleCodes`
        //   2. any `locale` param was included in the url hash
        //   3. any locales detected by the browser
        //   4. english (always fallback)
        const urlLocale = urlhash.initialHashParams.get('locale');
        if (urlLocale) {
          this._preferredLocaleCodes = urlLocale.split(',').map(s => s.trim()).filter(Boolean);
        }

        const requestedLocales = (this._preferredLocaleCodes || [])
          .concat(utilDetect().browserLocales)   // List of locales preferred by the browser in priority order.
          .concat(['en']);   // fallback to English since it's the only guaranteed complete language

        this._currLocaleCodes = this._getSupportedLocales(requestedLocales);
        this._currLocaleCode = this._currLocaleCodes[0];   // First is highest priority locale; the rest are fallbacks

        const loadPromises = this._currLocaleCodes.map(code => this._loadStringsAsync(code));
        return Promise.all(loadPromises);
      })
      .then(() => this._updateForCurrentLocale())
      .catch(e => console.error(e));  // eslint-disable-line
  }


  /**
   * startAsync
   * Called after all core objects have been initialized.
   * @return {Promise}  Promise resolved when this component has completed startup
   */
  startAsync() {
    this._started = true;
    return Promise.resolve();
  }


  /**
   * resetAsync
   * Called after completing an edit session to reset any internal state
   * @return {Promise} Promise resolved when this component has completed resetting
   */
  resetAsync() {
    return Promise.resolve();
  }


  /**
   * _loadStringsAsync
   * Returns a Promise to load the strings for the requested locale
   * @param  {string}   locale - locale code to load
   * @return {Promise}  Promise resolved when all strings have been loaded
   */
  _loadStringsAsync(locale) {
    if (locale.toLowerCase() === 'en-us') {   // US English is the default
      locale = 'en';
    }

    const cache = this._cache;
    if (cache[locale]) { // already loaded
      return Promise.resolve();
    }

    const dataloader = this.context.systems.dataloader;
    const fileMap = dataloader.fileMap;
    const loadPromises = [];

    for (const scope of this._scopes) {
      const key = `l10n_${scope}_${locale}`;
      if (!fileMap.has(key)) {
        fileMap.set(key, `l10n/${scope}.${locale}.min.json`);
      }
      const prom = dataloader.getDataAsync(key)
        .then(data => {
          if (!cache[locale]) {
            cache[locale] = {};
          }
          cache[locale][scope] = data[locale];
        });

      loadPromises.push(prom);
    }

    return Promise.all(loadPromises);
  }


  /**
   * pluralRule
   * Returns the plural rule for the given `number` with the given `code`.
   * see: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules/select
   *
   * @param  {number}   number - number to get the plural rule
   * @param  {string?}  locale - locale to use (defaults to currentLocale)
   * @return {string}   One of: `zero`, `one`, `two`, `few`, `many`, `other`
   */
  pluralRule(number, locale = this._currLocaleCode) {
    // modern browsers have this functionality built-in
    const rules = 'Intl' in window && Intl.PluralRules && new Intl.PluralRules(locale);
    if (rules) {
      return rules.select(number);
    }
    // fallback to basic one/other, as in English
    return (number === 1) ? 'one' : 'other';
  }


  /**
   * _getString
   * Try to find a localized string matching the given `stringID`.
   * This function will recurse through all `tryLocales` until a string is found.
   * or until we run out of locales, then we will return a special "Missing translation" string.
   *
   * Note: If the `stringID` starts with an underscore, the first part is used as the "scope".
   * Otherwise, the default `core` scope will be used.
   *
   * @param  {string}   origStringID   string identifier
   * @param  {Object?}  replacements   token replacements and default string
   * @param  {Array?}   tryLocales     locales to search (defaults to currentLocales)
   * @return {Object?}  result containing the localized string and chosen locale
   */
  _getString(origStringID, replacements, tryLocales) {
    if (!Array.isArray(tryLocales)) {
      tryLocales = this._currLocaleCodes.slice(); // copy
    }

    const locale = tryLocales.shift();  // remove first one

    // US English is the default
    // Note that we don't overwrite `locale` because that `en-US` value
    // might be used later by the pluralRule or number formatter.
    let tryLocale = locale;
    if (locale.toLowerCase() === 'en-us') {
      tryLocale = 'en';
    }

    let stringID = origStringID.trim();
    let scope = 'core';

    if (stringID[0] === '_') {
      const parts = stringID.split('.');
      scope = parts[0].slice(1);
      stringID = parts.slice(1).join('.');
    }

    let path = stringID
      .split('.')
      .map(s => s.replace(/<TX_DOT>/g, '.'))
      .reverse();

    let result = this._cache[tryLocale] && this._cache[tryLocale][scope];
    while (result !== undefined && path.length) {
      result = result[path.pop()];
    }

    if (result !== undefined) {
      if (replacements) {
        if (typeof result === 'object' && Object.keys(result).length) {
          // If plural forms are provided, dig one level deeper based on the
          // first numeric token replacement provided.
          const number = Object.values(replacements).find(val => (typeof val === 'number'));
          if (number !== undefined) {
            const rule = this.pluralRule(number, locale);
            if (result[rule]) {
              result = result[rule];
            } else {
              // We're pretty sure this should be a plural but no string
              // could be found for the given rule. Just pick the first
              // string and hope it makes sense.
              result = Object.values(result)[0];
            }
          }
        }

        if (typeof result === 'string') {
          for (let key in replacements) {
            let value = replacements[key];
            if (typeof value === 'number') {
              if (value.toLocaleString) {
                // format numbers for the locale
                value = value.toLocaleString(locale, {
                  style: 'decimal',
                  useGrouping: true,
                  minimumFractionDigits: 0
                });
              } else {
                value = value.toString();
              }
            }
            const token = `{${key}}`;
            const regex = new RegExp(token, 'g');
            result = result.replace(regex, value);
          }
        }
      }

      if (typeof result === 'string') {  // found a localized string!
        return { text: result, locale: locale };
      }
    }

    // no localized string found...

    // Attempt to fallback to a lower-priority language
    if (tryLocales.length) {
      return this._getString(origStringID, replacements, tryLocales);
    }

    // Fallback to a default value if one is specified in `replacements`
    if (replacements && 'default' in replacements) {
      return { text: replacements.default, locale: null };
    }

    const missing = `Missing ${locale} translation: ${origStringID}`;
    if (typeof console !== 'undefined') console.error(missing);  // eslint-disable-line

    return { text: missing, locale: 'en' };
  }


  /**
   * hasTextForStringID
   * Returns true if the given string id will return a string
   *
   * @param  {string}   stringID      string identifier
   * @return {boolean}  true if the given string id will return a string
   */
  hasTextForStringID(stringID) {
    return !!this._getString(stringID, { default: 'nothing found' }).locale;
  }


  /**
   * t
   * Returns only the localized text, discarding the locale info
   * @param  {string}   stringID      string identifier
   * @param  {Object?}  replacements  token replacements and default string
   * @param  {string?}  locale        locale to use (defaults to currentLocale)
   * @return {string?}  the localized string
   */
  t(stringID, replacements, locale) {
    let localeParam = null;
    if (typeof locale === 'string') localeParam = [locale];
    else if (Array.isArray(locale)) localeParam = locale;

    return this._getString(stringID, replacements, localeParam).text;
  }


  /**
   * t.html
   * Returns the localized text wrapped in an HTML span element encoding the locale info
   * @param  {string}   stringID      string identifier
   * @param  {Object?}  replacements  token replacements and default string
   * @param  {string?}  locale        locale to use (defaults to currentLocale)
   * @return {string}   localized string wrapped in a HTML span, or empty string ''
   */
  tHtml(stringID, replacements, locale) {
    let localeParam = null;
    if (typeof locale === 'string') localeParam = [locale];
    else if (Array.isArray(locale)) localeParam = locale;

    const info = this._getString(stringID, replacements, localeParam);
    // text may be empty or undefined depending on `replacements.default`
    return info.text ? this.htmlForLocalizedText(info.text, info.locale) : '';
  }


  /**
   * t.append
   * Safer version of t.html that instead uses a function that appends the localized text to the given d3 selection
   * @param  {string}   stringID      string identifier
   * @param  {Object?}  replacements  token replacements and default string
   * @param  {string?}  locale        locale to use (defaults to currentLocale)
   * @return {Function} Function that accepts a d3 selection and appends the localized text
   */
  tAppend(stringID, replacements, locale) {
    let localeParam = null;
    if (typeof locale === 'string') localeParam = [locale];
    else if (Array.isArray(locale)) localeParam = locale;

    const ret = function(selection) {
      const info = this._getString(stringID, replacements, localeParam);
      return selection.append('span')
        .attr('class', 'localized-text')
        .attr('lang', info.locale || 'und')
        .text((replacements?.prefix || '') + info.text + (replacements?.suffix || ''));
    };
    ret.stringID = stringID;
    return ret;
  }


  /**
   * htmlForLocalizedText
   * Just returns the given text wrapped in an HTML span element encoding the locale
   * @param  {string}   text          the text content for the span
   * @param  {string?}  localeCode    the locale code for the span
   * @return {string}   text wrapped in a HTML span
   */
  htmlForLocalizedText(text, localeCode) {
    return `<span class="localized-text" lang="${localeCode || 'unknown'}">${text}</span>`;
  }


  /**
   * languageName
   * Returns a display-ready string for a given language code
   * @param  {string}   code          the language code (e.g. 'de')
   * @param  {Object?}  options       see below
   * @return {string}   the language string to display (e.g. "Deutsch (de)")
   */
  languageName(code, options) {
    if (this._languageNames[code]) {      // name in locale language
      // e.g. "German"
      return this._languageNames[code];
    }

    // sometimes we only want the local name
    if (options && options.localOnly) return null;

    const langInfo = this._languages[code];
    if (langInfo) {
      if (langInfo.nativeName) {  // name in native language
        // e.g. "Deutsch (de)"
        return this.t('translate.language_and_code', { language: langInfo.nativeName, code: code });

      } else if (langInfo.base && langInfo.script) {
        const base = langInfo.base;  // the code of the language this is based on

        if (this._languageNames[base]) {   // base language name in locale language
          const scriptCode = langInfo.script;
          const script = this._scriptNames[scriptCode] || scriptCode;
          // e.g. "Serbian (Cyrillic)"
          return this.t('translate.language_and_code', { language: this._languageNames[base], code: script });

        } else if (this._languages[base] && this._languages[base].nativeName) {
          // e.g. "српски (sr-Cyrl)"
          return this.t('translate.language_and_code', { language: this._languages[base].nativeName, code: code });
        }
      }
    }
    return code;  // if not found, use the code
  }


  /**
   * displayName
   * Get a localized display name for a map feature
   * @param  {Object}  tags
   * @param  {boolean} hideNetwork - If true, the `network` tag will not be used in the name to prevent
   *   it being shown twice (see PR iD#8707#discussion_r712658175)
   * @return {string}  A name string suitable for display
   */
  displayName(tags, hideNetwork) {
    const code = this._currLanguageCode.toLowerCase();

    const route = tags.route;
    let name = tags[`name:${code}`] ?? tags.name ?? '';

    // Gather the properties we may use to construct a display name
    let props = {
      name: name,
      direction: tags.direction,
      from: tags.from,
      network: hideNetwork ? undefined : (tags.cycle_network ?? tags.network),
      ref: tags.ref,
      to: tags.to,
      via: tags.via
    };

    // For routes, prefer `network+ref+name` or `ref+name` over `name`
    if (route && props.ref && props.name) {
      return props.network ?
        this.t('inspector.display_name.network_ref_name', props) :
        this.t('inspector.display_name.ref_name', props);
    }

    // If we have a name, return it
    if (name) {
      return name;
    }

    // Construct a name from other tags.
    let keyComponents = [];
    if (props.network) {
      keyComponents.push('network');
    }
    if (props.ref) {
      keyComponents.push('ref');
    }

    // Routes may need more disambiguation based on direction or destination
    if (route) {
      if (props.direction) {
        keyComponents.push('direction');
      } else if (props.from && props.to) {
        keyComponents.push('from');
        keyComponents.push('to');
        if (props.via) {
          keyComponents.push('via');
        }
      }
    }

    if (keyComponents.length) {
      return this.t('inspector.display_name.' + keyComponents.join('_'), props);
    }

    // bhousel 3/28/22 - no labels for addresses for now
    // // if there's still no name found, try addr:housename
    // if (tags['addr:housename']) {
    //   return tags['addr:housename'];
    // }
    //
    // // as a last resort, use the street address as a name
    // if (tags['addr:housenumber'] && tags['addr:street']) {
    //   return tags['addr:housenumber'] + ' ' + tags['addr:street'];
    // }

    return '';
  }


  /**
   * displayPOIName
   * This is like `displayName`, but more useful for POI display names (includes brand)
   * @param  {Object}  tags
   * @return {string}  A name string suitable for display
   */
  displayPOIName(tags) {
    const code = this._currLanguageCode.toLowerCase();
    return tags[`name:${code}`] ?? tags.name ??
      tags[`brand:${code}`] ?? tags.brand ??
      tags[`operator:${code}`] ?? tags.operator ??
      '';
  }


  /**
   * displayType
   * @param  {string}  entityID - OSM-like ID that starts with 'n', 'w', or 'r'
   * @return {string}  Localized string for 'Node', 'Way', or 'Relation'
   */
  displayType(entityID) {
    return {
      n: this.t('inspector.node'),
      w: this.t('inspector.way'),
      r: this.t('inspector.relation')
    }[entityID.charAt(0)];
  }


  /**
   * displayLabel
   * Returns a string suitable for display
   * By default returns something like name/ref, fallback to preset type, fallback to OSM type
   *   "Main Street" or "Tertiary Road"
   * If `verbose=true`, include both preset name and feature name.
   *   "Tertiary Road Main Street"
   * @param  {Entity}        entity            The entity to get the label for
   * @param  {Graph|string}  graphOrGeometry   Either a Graph or geometry
   * @return {string}  A name string suitable for display
   */
  displayLabel(entity, graphOrGeometry, verbose) {
    const displayName = this.displayName(entity.tags);
    const presetSystem = this.context.systems.presets;
    const preset = typeof graphOrGeometry === 'string' ?
      presetSystem.matchTags(entity.tags, graphOrGeometry) :
      presetSystem.match(entity, graphOrGeometry);
    const presetName = preset && (preset.suggestion ? preset.subtitle() : preset.name());

    let result;
    if (verbose) {
      result = [presetName, displayName].filter(Boolean).join(' ');
    } else {
      result = displayName || presetName;
    }

    // Fallback to the OSM type (node/way/relation)
    return result ?? this.displayType(entity.id);
  }


  /**
   * Returns a localized representation of the given length measurement.
   * @param  {Number}  meters
   * @param  {Boolean} isImperial true for U.S. customary units; false for metric
   * @return {string}  Text to display
   */
  displayLength(meters, isImperial) {
    const locale = this._currLocaleCode;
    let n = meters * (isImperial ? 3.28084 : 1);
    let unit;

    if (isImperial) {
      if (n >= 5280) {
        n /= 5280;
        unit = 'miles';
      } else {
        unit = 'feet';
      }
    } else {
      if (n >= 1000) {
        n /= 1000;
        unit = 'kilometers';
      } else {
        unit = 'meters';
      }
    }

    return this.t(`units.${unit}`, {
      quantity: n.toLocaleString(locale, { maximumSignificantDigits: 4 })
    });
  }


  /**
   * Returns a localized representation of the given area measurement.
   *
   * @param {Number}  meters2 area in square meters
   * @param {Boolean} isImperial true for U.S. customary units; false for metric
   * @return {string}  Text to display
   */
  displayArea(meters2, isImperial) {
    const locale = this._currLocaleCode;
    let n = meters2 * (isImperial ? 10.7639111056 : 1);
    let n1, n2, unit1, unit2;

    if (isImperial) {
      if (n >= 6969600) {  // > 0.25mi² show mi²
        n1 = n / 27878400;
        unit1 = 'square_miles';
      } else {
        n1 = n;
        unit1 = 'square_feet';
      }

      if (n > 4356 && n < 43560000) {  // 0.1 - 1000 acres
        n2 = n / 43560;
        unit2 = 'acres';
      }

    } else {
      if (n >= 250000) {  // > 0.25km² show km²
        n1 = n / 1000000;
        unit1 = 'square_kilometers';
      } else {
        n1 = n;
        unit1 = 'square_meters';
      }

      if (n > 1000 && n < 10000000) {   // 0.1 - 1000 hectares
        n2 = n / 10000;
        unit2 = 'hectares';
      }
    }

    const area = this.t(`units.${unit1}`, {
      quantity: n1.toLocaleString(locale, { maximumSignificantDigits: 4 })
    });

    if (unit2) {
      const area2 = this.t(`units.${unit2}`, {
        quantity: n2.toLocaleString(locale, { maximumSignificantDigits: 2 })
      });

      return this.t('units.area_pair', { area1: area, area2: area2 });
    } else {
      return area;
    }
  }


  /**
   * Returns given coordinate pair in degree-minute-second format.
   * @param {Array<Number>} coord longitude and latitude
   * @return {string}  Text to display
   */
  dmsCoordinatePair(coord) {
    return this.t('units.coordinate_pair', {
      latitude: this._displayCoordinate(numClamp(coord[1], -90, 90), 'north', 'south'),
      longitude: this._displayCoordinate(numWrap(coord[0], -180, 180), 'east', 'west')
    });
  }


  /**
   * Return some parsed values in DMS formats that @mapbox/sexagesimal can't parse, see iD#10066
   * Note that `@mapbox/sexagesimal` returns [lat,lon], so this code does too.
   * @param  {string}         q - string to attempt to parse
   * @return {Array<Number>?} The location formatted as `[lat,lon]`, or `null` it can't be parsed
   */
  dmsMatcher(q) {
    let match;

    // DD MM SS , DD MM SS  ex: 35 11 10.1 , 136 49 53.8
    const DMS_DMS = /^\s*(-?)\s*(\d+)\s+(\d+)\s+(\d+\.?\d*)\s*\,\s*(-?)\s*(\d+)\s+(\d+)\s+(\d+\.?\d*)\s*$/;
    match = q.match(DMS_DMS);
    if (match) {
      let lat = (+match[2]) + (+match[3]) / 60 + (+match[4]) / 3600;
      let lon = (+match[6]) + (+match[7]) / 60 + (+match[8]) / 3600;
      if (match[1] === '-') lat *= -1;
      if (match[5] === '-') lon *= -1;
      return [lat, lon];
    }

    // DD MM , DD MM  ex: 35 11 10.1 , 136 49 53.8
    const DM_DM = /^\s*(-?)\s*(\d+)\s+(\d+\.?\d*)\s*\,\s*(-?)\s*(\d+)\s+(\d+\.?\d*)\s*$/;
    match = q.match(DM_DM);
    if (match) {
      let lat = +match[2] + (+match[3]) / 60;
      let lon = +match[5] + (+match[6]) / 60;
      if (match[1] === '-') lat *= -1;
      if (match[4] === '-') lon *= -1;
      return [lat, lon];
    }

    return null;
  }


  /**
   * Returns the given coordinate pair in decimal format.
   * note: unlocalized to avoid comma ambiguity - see iD#4765
   * @param  {Array<Number>}   coord - longitude and latitude
   * @return {string}          Text to display
   */
  decimalCoordinatePair(coord) {
    const OSM_PRECISION = 7;
    return this.t('units.coordinate_pair', {
      latitude: numClamp(coord[1], -90, 90).toFixed(OSM_PRECISION),
      longitude: numWrap(coord[0], -180, 180).toFixed(OSM_PRECISION)
    });
  }


  /**
   * Format a degree coordinate as DMS (degree minute second)for display
   * @param  {number}  degrees - degrees to convert to DMS
   * @param  {string}  pos - string to use for positive values (either 'north' or 'east')
   * @param  (string)  neg - string to use for negative values (either 'south' or 'west')
   * @return {string}  Text to display
   */
  _displayCoordinate(deg, pos, neg) {
    const EPSILON = 0.01;
    const locale = this._currLocaleCode;
    const min = (Math.abs(deg) - Math.floor(Math.abs(deg))) * 60;
    let sec = (min - Math.floor(min)) * 60;

    // If you input 45°,90°0'0.5" , sec should be 0.5 instead 0.499999…
    // To mitigate precision errors after calculating, round again, see iD#10066
    sec = +sec.toFixed(8);   // 0.499999… => 0.5

    const displayDegrees = this.t('units.arcdegrees', {
      quantity: Math.floor(Math.abs(deg)).toLocaleString(locale)
    });

    let displayCoordinate;

    if (Math.abs(sec) > EPSILON) {
      displayCoordinate = displayDegrees +
        this.t('units.arcminutes', { quantity: Math.floor(min).toLocaleString(locale) }) +
        this.t('units.arcseconds', { quantity: Math.round(sec).toLocaleString(locale) });
    } else if (Math.abs(min) > EPSILON) {
      displayCoordinate = displayDegrees +
        this.t('units.arcminutes', { quantity: Math.round(min).toLocaleString(locale) });
    } else {
      displayCoordinate = displayDegrees;
    }

    if (deg === 0) {
      return displayCoordinate;
    } else {
      return this.t('units.coordinate', {
        coordinate: displayCoordinate,
        direction: this.t('units.' + (deg > 0 ? pos : neg))
      });
    }
  }


  /**
   * _getSupportedLocales
   * Returns the locales from `requestedLocales` that are actually supported
   * @param  {Array}  requestedLocales  Array or Set of locale codes to consider
   * @return {Array}  The locales that we can actually support
   */
  _getSupportedLocales(requestedLocales) {
    const toUse = new Set();
    for (const code of requestedLocales) {
      if (this._locales[code]) {
        toUse.add(code);
      }
      // For a locale with a culture code ('es-ES'), include fallback to the base locale ('es')
      if (code.includes('-')) {
        const base = code.split('-')[0];
        if (this._locales[base]) {
          toUse.add(base);
        }
      }
    }
    return Array.from(toUse);
  }


  /**
   * _updateForCurrentLocale
   * Called after all locale files have been fetched to finalize the current state
   */
  _updateForCurrentLocale() {
    if (!this._currLocaleCode) return;

    const [language, culture] = this._currLocaleCode.toLowerCase().split('-', 2);
    this._currLanguageCode = language;
    this._currIsMetric = (culture !== 'us');

    // If an `rtl` param was included in the url hash, use that instead..
    const urlhash = this.context.systems.urlhash;
    const urlRTL = urlhash.initialHashParams.get('rtl');

    if (urlRTL === 'true') {
      this._currTextDirection = 'rtl';
    } else if (urlRTL === 'false') {
      this._currTextDirection = 'ltr';
    } else {
      const supported = this._locales[this._currLocaleCode] || this._locales[this._currLanguageCode];
      this._currTextDirection = supported && supported.rtl ? 'rtl' : 'ltr';
    }

    // Language and Script names will appear in the local language
    let locale = this._currLocaleCode;
    if (locale.toLowerCase() === 'en-us') {
      locale = 'en';
    }
    this._languageNames = this._cache[locale].core.languageNames;
    this._scriptNames = this._cache[locale].core.scriptNames;
  }

}
