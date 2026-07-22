import { describe, expect, it } from 'vitest';
import {
  BASE_MAP_DOT_COUNT,
  COUNTRY_NAMES,
  MANUAL_MAPPINGS,
  MAP_DOTS,
  REPRESENTATIVE_MAP_DOTS,
  shouldRenderMapDot,
} from './mappings';
import { CONTINENT_DOT_MAP, CONTINENT_OPTIONS } from './continents';

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

const getConnectedComponents = (dotIndexes: number[], adjacencyDistance = 25) => {
  const remaining = new Set(dotIndexes);
  const components: number[][] = [];

  while (remaining.size > 0) {
    const first = remaining.values().next().value as number;
    const component: number[] = [];
    const queue = [first];
    remaining.delete(first);

    while (queue.length > 0) {
      const dotIndex = queue.shift()!;
      component.push(dotIndex);

      for (const candidateIndex of remaining) {
        const dot = MAP_DOTS[dotIndex];
        const candidate = MAP_DOTS[candidateIndex];
        if (Math.hypot(dot.x - candidate.x, dot.y - candidate.y) > adjacencyDistance) continue;
        remaining.delete(candidateIndex);
        queue.push(candidateIndex);
      }
    }

    components.push(component);
  }

  return components;
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

  it('keeps supplemental dots out of the illustration until their country is individually selected', () => {
    expect(MAP_DOTS).toHaveLength(BASE_MAP_DOT_COUNT + REPRESENTATIVE_MAP_DOTS.length);
    expect(shouldRenderMapDot(BASE_MAP_DOT_COUNT - 1, false)).toBe(true);

    REPRESENTATIVE_MAP_DOTS.forEach((_, index) => {
      const dotIndex = BASE_MAP_DOT_COUNT + index;
      expect(shouldRenderMapDot(dotIndex, false)).toBe(false);
      expect(shouldRenderMapDot(dotIndex, true)).toBe(true);
    });
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

  it('keeps India visually connected through its northeast corridor', () => {
    expect(MANUAL_MAPPINGS.India).toContain(1771);
    expect(MANUAL_MAPPINGS.Bhutan).toContain(1771);
    expect(getConnectedComponents(MANUAL_MAPPINGS.India)).toHaveLength(1);
  });

  it('keeps South Korea on the mainland side of Japan', () => {
    const southKoreaDots = MANUAL_MAPPINGS['South Korea'];
    const northKoreaDots = MANUAL_MAPPINGS['North Korea'];
    const japanDots = new Set(MANUAL_MAPPINGS.Japan);

    expect(southKoreaDots).toEqual([1653, 1658]);
    expect(southKoreaDots.some((dotIndex) => northKoreaDots.includes(dotIndex))).toBe(true);
    expect(southKoreaDots.some((dotIndex) => japanDots.has(dotIndex))).toBe(false);

    const southKoreaEast = Math.max(...southKoreaDots.map((dotIndex) => MAP_DOTS[dotIndex].x));
    const japanWest = Math.min(...MANUAL_MAPPINGS.Japan.map((dotIndex) => MAP_DOTS[dotIndex].x));
    expect(southKoreaEast).toBeLessThan(japanWest);
  });

  it('gives every visible artwork dot exactly one visual continent owner', () => {
    const ownersByDot = Array.from({ length: BASE_MAP_DOT_COUNT }, () => [] as string[]);

    CONTINENT_OPTIONS.forEach((continent) => {
      CONTINENT_DOT_MAP[continent].forEach((dotIndex) => {
        expect(dotIndex).toBeLessThan(BASE_MAP_DOT_COUNT);
        ownersByDot[dotIndex].push(continent);
      });
    });

    expect(
      ownersByDot
        .map((owners, dotIndex) => ({ dotIndex, owners }))
        .filter(({ owners }) => owners.length === 0),
    ).toEqual([]);
    expect(
      ownersByDot
        .map((owners, dotIndex) => ({ dotIndex, owners }))
        .filter(({ owners }) => owners.length > 1),
    ).toEqual([]);
  });

  it('keeps the two Baltic artwork dots out of Africa', () => {
    const africaDots = new Set(CONTINENT_DOT_MAP.Africa);
    const europeDots = new Set(CONTINENT_DOT_MAP.Europe);

    expect(africaDots.has(1017)).toBe(false);
    expect(africaDots.has(1018)).toBe(false);
    expect(europeDots.has(1017)).toBe(true);
    expect(europeDots.has(1018)).toBe(true);
    expect(Math.min(...CONTINENT_DOT_MAP.Africa.map((dotIndex) => MAP_DOTS[dotIndex].y)))
      .toBeGreaterThan(590);
  });

  it('resolves compressed visual boundaries consistently', () => {
    const expectedOwners = new Map<number, string>([
      [576, 'Europe'],
      [1153, 'Europe'],
      [1658, 'Asia'],
      [2077, 'North America'],
      [2064, 'South America'],
      [2198, 'South America'],
      [2412, 'Australia & Oceania'],
      [2453, 'Australia & Oceania'],
    ]);

    expectedOwners.forEach((expectedOwner, dotIndex) => {
      const owners = CONTINENT_OPTIONS.filter((continent) => (
        CONTINENT_DOT_MAP[continent].includes(dotIndex)
      ));
      expect(owners, `dot ${dotIndex}`).toEqual([expectedOwner]);
    });
  });
});
