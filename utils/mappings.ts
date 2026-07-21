import { MAP_DOTS as BASE_MAP_DOTS } from '../constants';
import { REPRESENTATIVE_MAP_DOTS } from './countryData';

export type { CountryDotMap } from './countryData';
export {
  COUNTRY_NAMES,
  MANUAL_MAPPINGS,
  REPRESENTATIVE_DOT_COUNTRIES,
  REPRESENTATIVE_MAP_DOTS,
} from './countryData';

export const MAP_DOTS = [...BASE_MAP_DOTS, ...REPRESENTATIVE_MAP_DOTS];
