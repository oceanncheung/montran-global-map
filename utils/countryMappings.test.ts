import { describe, expect, it } from 'vitest';
import {
  COUNTRY_NAMES,
  MANUAL_MAPPINGS,
  MAP_DOTS,
  REPRESENTATIVE_MAP_DOTS,
} from './mappings';

const PACIFIC_SOVEREIGN_COUNTRIES = [
  'Cook Islands',
  'Federated States of Micronesia',
  'Fiji',
  'Kiribati',
  'Marshall Islands',
  'Nauru',
  'Niue',
  'Palau',
  'Samoa',
  'Solomon Islands',
  'Tonga',
  'Tuvalu',
  'Vanuatu',
];

const getCountryPoint = (countryName: string) => {
  const dotIndex = MANUAL_MAPPINGS[countryName]?.[0];
  return dotIndex === undefined ? undefined : MAP_DOTS[dotIndex];
};

describe('country dot mappings', () => {
  it('maps every listed place except the intentionally cropped Antarctica', () => {
    const unmapped = COUNTRY_NAMES.filter((name) => (MANUAL_MAPPINGS[name]?.length ?? 0) === 0);
    expect(unmapped).toEqual(['Antarctica']);
  });

  it('only references dots that exist in the combined artwork', () => {
    Object.entries(MANUAL_MAPPINGS).forEach(([countryName, dotIndexes]) => {
      dotIndexes.forEach((dotIndex) => {
        expect(MAP_DOTS[dotIndex], `${countryName} references missing dot ${dotIndex}`).toBeTruthy();
      });
    });
    expect(REPRESENTATIVE_MAP_DOTS.length).toBeGreaterThan(0);
  });

  it('gives separately selectable Pacific countries distinct dots', () => {
    const dotIndexes = PACIFIC_SOVEREIGN_COUNTRIES.map((name) => MANUAL_MAPPINGS[name][0]);
    expect(new Set(dotIndexes).size).toBe(PACIFIC_SOVEREIGN_COUNTRIES.length);
  });

  it('places Samoa near Fiji, north-east of it, without merging them', () => {
    const fiji = getCountryPoint('Fiji');
    const samoa = getCountryPoint('Samoa');
    expect(fiji).toBeTruthy();
    expect(samoa).toBeTruthy();

    const distance = Math.hypot(samoa!.x - fiji!.x, samoa!.y - fiji!.y);
    expect(distance).toBeGreaterThan(55);
    expect(distance).toBeLessThan(125);
    expect(samoa!.x).toBeGreaterThan(fiji!.x);
    expect(samoa!.y).toBeLessThan(fiji!.y);
  });

  it('preserves the recognizable north-to-south order of the Pacific cluster', () => {
    const samoa = getCountryPoint('Samoa');
    const fiji = getCountryPoint('Fiji');
    const tonga = getCountryPoint('Tonga');
    expect(samoa!.y).toBeLessThan(fiji!.y);
    expect(fiji!.y).toBeLessThan(tonga!.y);
  });
});
