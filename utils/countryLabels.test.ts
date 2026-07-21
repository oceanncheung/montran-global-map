import { describe, expect, it } from 'vitest';
import { MapPoint } from '../types';
import { COUNTRY_NAMES, MANUAL_MAPPINGS, MAP_DOTS } from './mappings';
import {
  COUNTRY_LABEL_LEADER_CLEARANCE,
  COUNTRY_LABEL_MIN_PILL_APPROACH,
  COUNTRY_LABEL_ROUTE_SEPARATION,
  MAP_DOT_RADIUS,
  CountryLabelCompositionOptions,
  CountryLabelLayout,
  CountryLabelRect,
  countryLabelRectsOverlap,
  createCountryLabelComposition,
  createRoundedOrthogonalPath,
  estimateCountryLabelWidth,
} from './countryLabels';

const EXACT_COUNTRIES = [
  'Fiji',
  'India',
  'Maldives',
  'Mongolia',
  'Nepal',
  'Papua New Guinea',
  'Philippines',
  'Sri Lanka',
  'Samoa',
  'Solomon Islands',
  'Timor-Leste',
  'Vanuatu',
  'Bangladesh',
];

const PACIFIC_COUNTRIES = [
  'Australia',
  'New Zealand',
  'Papua New Guinea',
  'Samoa',
  'Cook Islands',
  'Federated States of Micronesia',
  'Fiji',
  'Kiribati',
  'Marshall Islands',
  'Nauru',
  'Niue',
  'Palau',
  'Solomon Islands',
  'Tonga',
  'Tuvalu',
  'Vanuatu',
];

const MAP_CONTENT_BOUNDS = MAP_DOTS.reduce(
  (bounds, dot) => ({
    left: Math.min(bounds.left, dot.x),
    right: Math.max(bounds.right, dot.x),
    top: Math.min(bounds.top, dot.y),
    bottom: Math.max(bounds.bottom, dot.y),
  }),
  { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity },
);
const MAP_CONTENT_CENTER_X = (MAP_CONTENT_BOUNDS.left + MAP_CONTENT_BOUNDS.right) / 2;
const MAP_CONTENT_CENTER_Y = (MAP_CONTENT_BOUNDS.top + MAP_CONTENT_BOUNDS.bottom) / 2;
const MAP_FIT_WIDTH = MAP_CONTENT_BOUNDS.right - MAP_CONTENT_BOUNDS.left + 160;
const MAP_FIT_HEIGHT = MAP_CONTENT_BOUNDS.bottom - MAP_CONTENT_BOUNDS.top + 160;

const getOptions = (
  width = 1440,
  height = 900,
  sidebarOpen = true,
): CountryLabelCompositionOptions => {
  const hasDockedSidebar = sidebarOpen && width >= 728;
  const frame = hasDockedSidebar
    ? { left: 408, right: 120, top: 120, bottom: 72 }
    : { left: 120, right: 120, top: 120, bottom: 72 };
  const availableWidth = Math.max(width - frame.left - frame.right, 240);
  const availableHeight = Math.max(height - frame.top - frame.bottom, 240);
  const placementScale = Math.min(
    availableWidth / MAP_FIT_WIDTH,
    availableHeight / MAP_FIT_HEIGHT,
  );
  const tx = frame.left + availableWidth / 2 - MAP_CONTENT_CENTER_X * placementScale;
  const ty = frame.top + availableHeight / 2 - MAP_CONTENT_CENTER_Y * placementScale;
  const screenLeft = hasDockedSidebar ? 396 : 16;

  return {
    placementScale,
    viewportHeight: height,
    placementBounds: {
      left: screenLeft - tx,
      right: width - 16 - tx,
      top: 112 - ty,
      bottom: height - 88 - ty,
    },
  };
};

const expectNoPillOverlaps = (labels: CountryLabelLayout[]) => {
  for (let first = 0; first < labels.length; first += 1) {
    for (let second = first + 1; second < labels.length; second += 1) {
      expect(
        countryLabelRectsOverlap(labels[first].rect, labels[second].rect),
        `${labels[first].name} overlaps ${labels[second].name}`,
      ).toBe(false);
    }
  }
};

const expectAxisAlignedRoutes = (labels: CountryLabelLayout[]) => {
  labels.forEach((label) => {
    if (!label.leaderPoints) return;
    for (let index = 1; index < label.leaderPoints.length; index += 1) {
      const previous = label.leaderPoints[index - 1];
      const current = label.leaderPoints[index];
      expect(
        Math.abs(previous.x - current.x) < 0.001 ||
        Math.abs(previous.y - current.y) < 0.001,
        `${label.name} has a diagonal route segment`,
      ).toBe(true);
    }
  });
};

const segmentIntersectsRect = (start: MapPoint, end: MapPoint, rect: CountryLabelRect) => {
  if (Math.abs(start.y - end.y) < 0.001) {
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    return start.y > rect.top && start.y < rect.bottom && maxX > rect.left && minX < rect.right;
  }

  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  return start.x > rect.left && start.x < rect.right && maxY > rect.top && minY < rect.bottom;
};

const getAbsoluteLeaderPoints = (label: CountryLabelLayout, scale: number) => (
  (label.leaderPoints ?? []).map((point) => ({
    x: label.anchor.x * scale + point.x,
    y: label.anchor.y * scale + point.y,
  }))
);

const expectLeadersAvoidPills = (labels: CountryLabelLayout[], scale: number) => {
  labels.forEach((label) => {
    const points = getAbsoluteLeaderPoints(label, scale);
    for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
      labels.forEach((otherLabel) => {
        if (otherLabel.name === label.name) return;
        const rect = {
          left: otherLabel.rect.left - COUNTRY_LABEL_LEADER_CLEARANCE,
          right: otherLabel.rect.right + COUNTRY_LABEL_LEADER_CLEARANCE,
          top: otherLabel.rect.top - COUNTRY_LABEL_LEADER_CLEARANCE,
          bottom: otherLabel.rect.bottom + COUNTRY_LABEL_LEADER_CLEARANCE,
        };
        expect(
          segmentIntersectsRect(points[pointIndex - 1], points[pointIndex], rect),
          `${label.name} leader crosses ${otherLabel.name}`,
        ).toBe(false);
      });
    }
  });
};

const segmentsOverlap = (
  firstStart: MapPoint,
  firstEnd: MapPoint,
  secondStart: MapPoint,
  secondEnd: MapPoint,
) => {
  const firstHorizontal = Math.abs(firstStart.y - firstEnd.y) < 0.001;
  const secondHorizontal = Math.abs(secondStart.y - secondEnd.y) < 0.001;
  if (firstHorizontal !== secondHorizontal) return false;
  if (firstHorizontal) {
    if (Math.abs(firstStart.y - secondStart.y) > COUNTRY_LABEL_ROUTE_SEPARATION) return false;
    return Math.min(
      Math.max(firstStart.x, firstEnd.x),
      Math.max(secondStart.x, secondEnd.x),
    ) - Math.max(
      Math.min(firstStart.x, firstEnd.x),
      Math.min(secondStart.x, secondEnd.x),
    ) > 0.5;
  }
  if (Math.abs(firstStart.x - secondStart.x) > COUNTRY_LABEL_ROUTE_SEPARATION) return false;
  return Math.min(
    Math.max(firstStart.y, firstEnd.y),
    Math.max(secondStart.y, secondEnd.y),
  ) - Math.max(
    Math.min(firstStart.y, firstEnd.y),
    Math.min(secondStart.y, secondEnd.y),
  ) > 0.5;
};

const expectNoLeaderOverlaps = (labels: CountryLabelLayout[], scale: number) => {
  const leaders = labels
    .filter((label) => label.leaderPoints)
    .map((label) => ({ label, points: getAbsoluteLeaderPoints(label, scale) }));

  for (let first = 0; first < leaders.length; first += 1) {
    for (let second = first + 1; second < leaders.length; second += 1) {
      for (let firstSegment = 1; firstSegment < leaders[first].points.length; firstSegment += 1) {
        for (let secondSegment = 1; secondSegment < leaders[second].points.length; secondSegment += 1) {
          expect(
            segmentsOverlap(
              leaders[first].points[firstSegment - 1],
              leaders[first].points[firstSegment],
              leaders[second].points[secondSegment - 1],
              leaders[second].points[secondSegment],
            ),
            `${leaders[first].label.name} leader overlaps ${leaders[second].label.name}`,
          ).toBe(false);
        }
      }
    }
  }
};

const distanceFromPointToSegment = (point: MapPoint, start: MapPoint, end: MapPoint) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0.000001) return Math.hypot(point.x - start.x, point.y - start.y);
  const progress = Math.max(0, Math.min(
    1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
  ));
  return Math.hypot(point.x - (start.x + progress * dx), point.y - (start.y + progress * dy));
};

const expectLeadersAvoidSelectedDots = (
  labels: CountryLabelLayout[],
  selectedDotIndexes: number[],
  scale: number,
) => {
  const clearanceRadius = MAP_DOT_RADIUS * scale + 1.4;

  labels.forEach((label) => {
    const points = getAbsoluteLeaderPoints(label, scale);
    if (points.length < 2) return;
    const anchorCenter = { x: label.anchor.x * scale, y: label.anchor.y * scale };
    expect(points[0].y, `${label.name} leader does not begin on its anchor row`).toBeCloseTo(
      anchorCenter.y,
      3,
    );
    expect(
      Math.abs(points[0].x - anchorCenter.x),
      `${label.name} leader does not begin at the edge of its anchor dot`,
    ).toBeGreaterThanOrEqual(MAP_DOT_RADIUS * scale);
    expect(Math.abs(points[0].x - anchorCenter.x)).toBeLessThan(
      MAP_DOT_RADIUS * scale + 2,
    );

    for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
      selectedDotIndexes.forEach((dotIndex) => {
        if (dotIndex === label.anchorDotIndex) return;
        const dot = MAP_DOTS[dotIndex];
        if (!dot) return;
        expect(
          distanceFromPointToSegment(
            { x: dot.x * scale, y: dot.y * scale },
            points[pointIndex - 1],
            points[pointIndex],
          ),
          `${label.name} leader crosses selected dot ${dotIndex}`,
        ).toBeGreaterThanOrEqual(clearanceRadius);
      });
    }
  });
};

const expectBentRoutesHaveClearApproaches = (labels: CountryLabelLayout[], scale: number) => {
  labels.forEach((label) => {
    const points = getAbsoluteLeaderPoints(label, scale).filter((point, index, route) => (
      index === 0 || Math.hypot(point.x - route[index - 1].x, point.y - route[index - 1].y) > 0.001
    ));
    if (points.length < 4) return;
    const last = points[points.length - 1];
    const beforeLast = points[points.length - 2];
    expect(
      Math.abs(last.x - beforeLast.x),
      `${label.name} does not have enough horizontal space before its pill`,
    ).toBeGreaterThanOrEqual(COUNTRY_LABEL_MIN_PILL_APPROACH - 0.001);
  });
};

const expectLabelsWithinBounds = (
  labels: CountryLabelLayout[],
  options: CountryLabelCompositionOptions,
  verticalShift = 0,
) => {
  const bounds = options.placementBounds;
  expect(bounds).toBeTruthy();
  if (!bounds) return;

  labels.forEach((label) => {
    expect(label.rect.left, `${label.name} is clipped on the left`).toBeGreaterThanOrEqual(bounds.left);
    expect(label.rect.right, `${label.name} is clipped on the right`).toBeLessThanOrEqual(bounds.right);
    expect(label.rect.top, `${label.name} is clipped at the top`).toBeGreaterThanOrEqual(bounds.top - verticalShift);
    expect(label.rect.bottom, `${label.name} is clipped at the bottom`).toBeLessThanOrEqual(bounds.bottom + verticalShift);
  });
};

const expectExportContainsLabels = (
  labels: CountryLabelLayout[],
  scale: number,
  viewBox: { x: number; y: number; width: number; height: number },
) => {
  const right = viewBox.x + viewBox.width;
  const bottom = viewBox.y + viewBox.height;

  labels.forEach((label) => {
    expect(label.rect.left / scale, `${label.name} export is clipped on the left`).toBeGreaterThanOrEqual(viewBox.x);
    expect(label.rect.right / scale, `${label.name} export is clipped on the right`).toBeLessThanOrEqual(right);
    expect(label.rect.top / scale, `${label.name} export is clipped at the top`).toBeGreaterThanOrEqual(viewBox.y);
    expect(label.rect.bottom / scale, `${label.name} export is clipped at the bottom`).toBeLessThanOrEqual(bottom);

    getAbsoluteLeaderPoints(label, scale).forEach((point) => {
      expect(point.x / scale, `${label.name} leader export is clipped horizontally`).toBeGreaterThanOrEqual(viewBox.x);
      expect(point.x / scale, `${label.name} leader export is clipped horizontally`).toBeLessThanOrEqual(right);
      expect(point.y / scale, `${label.name} leader export is clipped vertically`).toBeGreaterThanOrEqual(viewBox.y);
      expect(point.y / scale, `${label.name} leader export is clipped vertically`).toBeLessThanOrEqual(bottom);
    });
  });
};

describe('country label composition', () => {
  it('returns the base artboard for an empty selection', () => {
    const composition = createCountryLabelComposition([], MANUAL_MAPPINGS, MAP_DOTS, getOptions());
    expect(composition.labels).toEqual([]);
    expect(composition.artboardHeight).toBe(900);
    expect(composition.exportViewBox).toEqual({ x: 30, y: 20, width: 2690, height: 1460 });
  });

  it('floats a single small country beside its mapped dot', () => {
    const composition = createCountryLabelComposition(['Fiji'], MANUAL_MAPPINGS, MAP_DOTS, getOptions());
    expect(composition.labels).toHaveLength(1);
    expect(composition.labels[0].placement).toBe('floating');
    expect(composition.labels[0].leaderPoints?.length).toBeGreaterThanOrEqual(2);
    expectAxisAlignedRoutes(composition.labels);
  });

  it('uses exact font metrics instead of accumulating width-estimate padding', () => {
    const name = 'Federated States of Micronesia';
    const composition = createCountryLabelComposition(
      [name],
      MANUAL_MAPPINGS,
      MAP_DOTS,
      {
        ...getOptions(),
        measureLabelText: () => 205.98,
      },
    );

    expect(estimateCountryLabelWidth(name)).toBe(260);
    expect(composition.labels[0].width).toBe(246);
  });

  it('places two nearby small countries without overlapping their pills', () => {
    const options = getOptions();
    const composition = createCountryLabelComposition(
      ['Fiji', 'Vanuatu'],
      MANUAL_MAPPINGS,
      MAP_DOTS,
      options,
    );
    expect(composition.labels).toHaveLength(2);
    expectNoPillOverlaps(composition.labels);
    expectLeadersAvoidPills(composition.labels, options.placementScale);
    expectNoLeaderOverlaps(composition.labels, options.placementScale);
  });

  it('keeps a sufficiently spacious country label inside its footprint', () => {
    const composition = createCountryLabelComposition(
      ['China'],
      MANUAL_MAPPINGS,
      MAP_DOTS,
      getOptions(),
    );
    expect(composition.labels).toHaveLength(1);
    expect(composition.labels[0].placement).toBe('inside');
    expect(composition.labels[0].leaderPoints).toBeUndefined();
  });

  it('lays out the supplied 13-country set without collisions', () => {
    const options = getOptions();
    const composition = createCountryLabelComposition(
      EXACT_COUNTRIES,
      MANUAL_MAPPINGS,
      MAP_DOTS,
      options,
    );

    expect(composition.labels.map((label) => label.name).sort()).toEqual([...EXACT_COUNTRIES].sort());
    expect(composition.artboardHeight).toBe(900);
    expect(composition.labels.filter((label) => label.placement === 'floating').length).toBeGreaterThan(
      composition.labels.filter((label) => label.placement === 'rail').length,
    );
    expect(composition.labels.some((label) => label.placement === 'rail')).toBe(true);
    expectNoPillOverlaps(composition.labels);
    expectAxisAlignedRoutes(composition.labels);
    expectLeadersAvoidPills(composition.labels, options.placementScale);
    expectNoLeaderOverlaps(composition.labels, options.placementScale);
    expectBentRoutesHaveClearApproaches(composition.labels, options.placementScale);
    expect(composition.exportViewBox.width).toBeGreaterThan(2690);
    expect(composition.exportViewBox.x + composition.exportViewBox.width / 2).toBe(1375);
    expectExportContainsLabels(
      composition.labels,
      options.placementScale,
      composition.exportViewBox,
    );

    const nepal = composition.labels.find((label) => label.name === 'Nepal');
    expect(nepal).toBeTruthy();
    expect(getAbsoluteLeaderPoints(nepal!, options.placementScale).length).toBeLessThanOrEqual(5);
  });

  it('is independent of country selection order', () => {
    const options = getOptions();
    const forward = createCountryLabelComposition(
      EXACT_COUNTRIES,
      MANUAL_MAPPINGS,
      MAP_DOTS,
      options,
    );
    const reverse = createCountryLabelComposition(
      [...EXACT_COUNTRIES].reverse(),
      MANUAL_MAPPINGS,
      MAP_DOTS,
      options,
    );
    expect(reverse).toEqual(forward);
  });

  it.each([
    [1440, 900, true],
    [1440, 900, false],
    [1280, 720, true],
    [1280, 720, false],
    [390, 844, true],
    [390, 844, false],
  ] as const)('keeps the supplied set valid at %ix%i with sidebar=%s', (width, height, sidebarOpen) => {
    const options = getOptions(width, height, sidebarOpen);
    const composition = createCountryLabelComposition(
      EXACT_COUNTRIES,
      MANUAL_MAPPINGS,
      MAP_DOTS,
      options,
    );

    expect(composition.labels).toHaveLength(EXACT_COUNTRIES.length);
    expect(composition.exportViewBox.width).toBeGreaterThanOrEqual(2690);
    expect(composition.exportViewBox.height).toBeGreaterThanOrEqual(1460);
    expect(composition.exportViewBox.x + composition.exportViewBox.width / 2).toBe(1375);
    expect(composition.exportViewBox.y + composition.exportViewBox.height / 2).toBe(750);
    expectNoPillOverlaps(composition.labels);
    expectAxisAlignedRoutes(composition.labels);
    expectLeadersAvoidPills(composition.labels, options.placementScale);
    expectNoLeaderOverlaps(composition.labels, options.placementScale);
    expectBentRoutesHaveClearApproaches(composition.labels, options.placementScale);
    expectLabelsWithinBounds(composition.labels, options, composition.verticalShift);
    expectExportContainsLabels(
      composition.labels,
      options.placementScale,
      composition.exportViewBox,
    );
  });

  it('separates countries whose anchors are nearly coincident', () => {
    const dots = [
      { x: 100, y: 100 },
      { x: 104, y: 101 },
      { x: 108, y: 102 },
      { x: 112, y: 103 },
    ];
    const mappings = { Alpha: [0], Beta: [1], Gamma: [2], Delta: [3] };
    const composition = createCountryLabelComposition(
      Object.keys(mappings),
      mappings,
      dots,
      {
        placementScale: 1,
        viewportHeight: 280,
        placementBounds: { left: 0, right: 400, top: 20, bottom: 260 },
      },
    );
    expectNoPillOverlaps(composition.labels);
    expectAxisAlignedRoutes(composition.labels);
  });

  it('keeps Pacific leaders attached to their anchors and clear of selected dots', () => {
    const selectedDotIndexes = Array.from(new Set(PACIFIC_COUNTRIES.flatMap((country) => (
      MANUAL_MAPPINGS[country] ?? []
    )))).sort((a, b) => a - b);
    const options = {
      ...getOptions(),
      obstacleDotIndexes: selectedDotIndexes,
    };
    const composition = createCountryLabelComposition(
      PACIFIC_COUNTRIES,
      MANUAL_MAPPINGS,
      MAP_DOTS,
      options,
    );

    expect(composition.labels).toHaveLength(PACIFIC_COUNTRIES.length);
    expectNoPillOverlaps(composition.labels);
    expectNoLeaderOverlaps(composition.labels, options.placementScale);
    expectLeadersAvoidSelectedDots(
      composition.labels,
      selectedDotIndexes,
      options.placementScale,
    );
  });

  it('extends the artboard instead of shrinking dense labels', () => {
    const denseCountries = COUNTRY_NAMES
      .filter((name) => (MANUAL_MAPPINGS[name]?.length ?? 0) > 0)
      .slice(0, 80);
    const options = getOptions();
    const composition = createCountryLabelComposition(
      denseCountries,
      MANUAL_MAPPINGS,
      MAP_DOTS,
      options,
    );

    expect(composition.labels).toHaveLength(denseCountries.length);
    expect(composition.artboardHeight).toBeGreaterThan(options.viewportHeight);
    expect(composition.exportViewBox.height).toBeGreaterThan(1460);
    expectNoPillOverlaps(composition.labels);
    expectAxisAlignedRoutes(composition.labels);
    expectBentRoutesHaveClearApproaches(composition.labels, options.placementScale);
    expectLabelsWithinBounds(composition.labels, options, composition.verticalShift);
    expectExportContainsLabels(
      composition.labels,
      options.placementScale,
      composition.exportViewBox,
    );
  });

  it('rounds orthogonal corners without introducing diagonal segments', () => {
    const path = createRoundedOrthogonalPath([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 30 },
      { x: 80, y: 30 },
    ]);
    expect(path).toContain('H');
    expect(path).toContain('V');
    expect(path.match(/ Q /g)).toHaveLength(2);
  });
});
