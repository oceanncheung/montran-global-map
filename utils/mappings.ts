import { MAP_DOTS as BASE_MAP_DOTS } from '../constants';
import { REPRESENTATIVE_MAP_DOTS } from './countryData';

export type { CountryDotMap } from './countryData';
export {
  COUNTRY_NAMES,
  MANUAL_MAPPINGS,
  REPRESENTATIVE_DOT_COUNTRIES,
  REPRESENTATIVE_MAP_DOTS,
} from './countryData';

export { BASE_MAP_DOTS };
export const BASE_MAP_DOT_COUNT = BASE_MAP_DOTS.length;
export const MAP_DOTS = [...BASE_MAP_DOTS, ...REPRESENTATIVE_MAP_DOTS];

export const shouldRenderMapDot = (dotIndex: number, isIndividuallySelected: boolean) => (
  dotIndex < BASE_MAP_DOT_COUNT || isIndividuallySelected
);
