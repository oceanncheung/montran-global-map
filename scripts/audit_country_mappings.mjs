import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as d3 from 'd3-geo';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const BASE_DOTS_PATH = path.join(projectRoot, 'constants.tsx');
const COUNTRY_DATA_PATH = path.join(projectRoot, 'utils', 'countryData.ts');
const GEOJSON_PATH = path.join(projectRoot, 'data', 'countries.geojson');

const GEO_CONSTANTS = {
  xScale: 7.26,
  yScale: 9.1,
  xOffset: 1310,
  yOffset: 930,
};
const EXPECTED_UNMAPPED_COUNTRIES = new Set(['Antarctica']);
const MAX_COUNTRY_DRIFT = 70;
const MAX_SHARED_REPRESENTATIVE_DISTANCE = 44;
const COUNTRY_NAME_ALIASES = {
  'East Timor': 'Timor-Leste',
};

const parseBaseDots = (source) => {
  const match = source.match(/export const MAP_DOTS: MapPoint\[\]\s*=\s*\[(.*?)\];/s);
  if (!match) throw new Error('Could not find MAP_DOTS in constants.tsx');

  const dotPattern = /\{\s*x\s*:\s*([\d.-]+)\s*,\s*y\s*:\s*([\d.-]+)\s*\}/g;
  const dots = [];
  let dotMatch;

  while ((dotMatch = dotPattern.exec(match[1])) !== null) {
    dots.push({
      x: Number.parseFloat(dotMatch[1]),
      y: Number.parseFloat(dotMatch[2]),
    });
  }

  return dots;
};

const parseJsonExport = (source, exportName, openingToken, closingToken) => {
  const escapedOpening = openingToken === '[' ? '\\[' : '\\{';
  const escapedClosing = closingToken === ']' ? '\\]' : '\\}';
  const pattern = new RegExp(
    `export const ${exportName}[^=]*= (${escapedOpening}[\\s\\S]*?${escapedClosing});`,
  );
  const match = source.match(pattern);
  if (!match) throw new Error(`Could not find ${exportName} in countryData.ts`);
  return JSON.parse(match[1]);
};

const getCountryName = (feature) => {
  const sourceName = feature?.properties?.ADMIN
    || feature?.properties?.name
    || feature?.properties?.NAME
    || null;
  return COUNTRY_NAME_ALIASES[sourceName] ?? sourceName;
};

const getLargestPartFeature = (feature) => {
  if (feature?.geometry?.type !== 'MultiPolygon') return feature;

  let largestPart = null;
  let largestArea = -1;

  for (const coordinates of feature.geometry.coordinates) {
    const polygon = {
      type: 'Feature',
      properties: feature.properties,
      geometry: { type: 'Polygon', coordinates },
    };
    const area = d3.geoArea(polygon);
    if (area > largestArea) {
      largestArea = area;
      largestPart = polygon;
    }
  }

  return largestPart ?? feature;
};

const getRepresentativePixels = (feature) => {
  const points = [
    d3.geoCentroid(getLargestPartFeature(feature)),
    d3.geoCentroid(feature),
  ];
  const pixels = [];

  for (const [lng, lat] of points) {
    for (const longitudeOffset of [-360, 0, 360]) {
      pixels.push({
        x: (lng + longitudeOffset) * GEO_CONSTANTS.xScale + GEO_CONSTANTS.xOffset,
        y: -lat * GEO_CONSTANTS.yScale + GEO_CONSTANTS.yOffset,
      });
    }
  }

  return pixels;
};

const getCountryDrift = (dotIndexes, dots, representativePixels) => (
  Math.min(...dotIndexes.flatMap((dotIndex) => (
    representativePixels.map((pixel) => (
      Math.hypot(dots[dotIndex].x - pixel.x, dots[dotIndex].y - pixel.y)
    ))
  )))
);

const getRepresentativeDistance = (firstPixels, secondPixels) => (
  Math.min(...firstPixels.flatMap((first) => (
    secondPixels.map((second) => Math.hypot(first.x - second.x, first.y - second.y))
  )))
);

const formatRows = (rows) => rows.map((row) => ({
  country: row.name,
  kind: row.representative ? 'representative' : 'footprint',
  dots: row.dotIndexes.length,
  drift: Number(row.drift.toFixed(1)),
}));

const runAudit = () => {
  const baseDotsSource = fs.readFileSync(BASE_DOTS_PATH, 'utf8');
  const countryDataSource = fs.readFileSync(COUNTRY_DATA_PATH, 'utf8');
  const geoData = JSON.parse(fs.readFileSync(GEOJSON_PATH, 'utf8'));

  const baseDots = parseBaseDots(baseDotsSource);
  const representativeDots = parseJsonExport(
    countryDataSource,
    'REPRESENTATIVE_MAP_DOTS',
    '[',
    ']',
  );
  const representativeCountries = new Set(parseJsonExport(
    countryDataSource,
    'REPRESENTATIVE_DOT_COUNTRIES',
    '[',
    ']',
  ));
  const mapping = parseJsonExport(countryDataSource, 'MANUAL_MAPPINGS', '{', '}');
  const dots = [...baseDots, ...representativeDots];
  const featureByName = new Map();

  for (const feature of geoData.features) {
    const name = getCountryName(feature);
    if (name) featureByName.set(name, feature);
  }

  const failures = [];
  const rows = [];
  const representativePixelsByCountry = new Map();

  for (const [name, feature] of featureByName) {
    const dotIndexes = mapping[name] ?? [];
    if (dotIndexes.length === 0) {
      if (!EXPECTED_UNMAPPED_COUNTRIES.has(name)) {
        failures.push(`${name} has no mapped dot`);
      }
      continue;
    }

    const invalidIndexes = dotIndexes.filter((dotIndex) => !dots[dotIndex]);
    if (invalidIndexes.length > 0) {
      failures.push(`${name} has invalid dot indexes: ${invalidIndexes.join(', ')}`);
      continue;
    }

    const representativePixels = getRepresentativePixels(feature);
    const drift = getCountryDrift(dotIndexes, dots, representativePixels);
    representativePixelsByCountry.set(name, representativePixels);
    rows.push({
      name,
      dotIndexes,
      representative: representativeCountries.has(name),
      drift,
    });

    if (drift > MAX_COUNTRY_DRIFT) {
      failures.push(`${name} is ${drift.toFixed(1)}px from its geographic representative point`);
    }
  }

  const ownersByDot = new Map();
  for (const [countryName, dotIndexes] of Object.entries(mapping)) {
    for (const dotIndex of dotIndexes) {
      if (!ownersByDot.has(dotIndex)) ownersByDot.set(dotIndex, []);
      ownersByDot.get(dotIndex).push(countryName);
    }
  }

  for (const [dotIndex, owners] of ownersByDot) {
    const representativeOwners = owners.filter((name) => (
      representativeCountries.has(name)
      && (mapping[name]?.length ?? 0) === 1
      && representativePixelsByCountry.has(name)
    ));

    for (let first = 0; first < representativeOwners.length; first += 1) {
      for (let second = first + 1; second < representativeOwners.length; second += 1) {
        const firstName = representativeOwners[first];
        const secondName = representativeOwners[second];
        const distance = getRepresentativeDistance(
          representativePixelsByCountry.get(firstName),
          representativePixelsByCountry.get(secondName),
        );
        if (distance > MAX_SHARED_REPRESENTATIVE_DISTANCE) {
          failures.push(
            `${firstName} and ${secondName} share dot ${dotIndex} despite being ${distance.toFixed(1)}px apart`,
          );
        }
      }
    }
  }

  if (mapping.Fiji?.some((dotIndex) => mapping.Samoa?.includes(dotIndex))) {
    failures.push('Fiji and Samoa must not share a representative dot');
  }

  const sortedRows = [...rows].sort((a, b) => b.drift - a.drift);
  const mappedCount = rows.length;
  const expectedExcludedCount = [...EXPECTED_UNMAPPED_COUNTRIES]
    .filter((name) => featureByName.has(name) && !(mapping[name]?.length)).length;
  const sharedDotCount = [...ownersByDot.values()].filter((owners) => owners.length > 1).length;

  console.log(`Mapped ${mappedCount}/${featureByName.size} countries and territories.`);
  console.log(`Intentionally excluded ${expectedExcludedCount}: ${[...EXPECTED_UNMAPPED_COUNTRIES].join(', ')}.`);
  console.log(`Rendered ${baseDots.length} artwork dots plus ${representativeDots.length} geographic dots.`);
  console.log(`Used representative mappings for ${representativeCountries.size} small or compressed places.`);
  console.log(`Shared ${sharedDotCount} dots only where the grid cannot resolve separate positions.`);
  console.log('\nLargest geographic drifts:');
  console.table(formatRows(sortedRows.slice(0, 15)));

  if (failures.length > 0) {
    console.error('\nAudit failures:');
    failures.forEach((failure) => console.error(`- ${failure}`));
    if (process.argv.includes('--check')) process.exitCode = 1;
  } else {
    console.log('\nCountry mapping audit passed.');
  }
};

runAudit();
