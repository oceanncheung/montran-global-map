import { MapPoint } from '../types';

export const COUNTRY_LABEL_HEIGHT = 32;
export const COUNTRY_LABEL_FONT_SIZE = 16;
export const COUNTRY_LABEL_ROW_GAP = 8;
export const COUNTRY_LABEL_ROW_PITCH = COUNTRY_LABEL_HEIGHT + COUNTRY_LABEL_ROW_GAP;
export const COUNTRY_LABEL_CORNER_RADIUS = 6;
export const COUNTRY_LABEL_MIN_PILL_APPROACH = 18;
export const COUNTRY_LABEL_LEADER_CLEARANCE = 5;
export const COUNTRY_LABEL_ROUTE_SEPARATION = 2;

export type CountryLabelPlacement = 'inside' | 'floating' | 'rail';
export type CountryLabelSide = 'left' | 'right';

export interface CountryLabelRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface CountryLabelPlacementBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface CountryLabelExportViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CountryLabelLayout {
  name: string;
  anchor: MapPoint;
  offset: MapPoint;
  width: number;
  height: number;
  rect: CountryLabelRect;
  placement: CountryLabelPlacement;
  side?: CountryLabelSide;
  railIndex?: number;
  leaderPoints?: MapPoint[];
}

export interface CountryLabelComposition {
  labels: CountryLabelLayout[];
  artboardHeight: number;
  verticalShift: number;
  exportViewBox: CountryLabelExportViewBox;
}

export interface CountryLabelCompositionOptions {
  placementScale: number;
  placementBounds?: CountryLabelPlacementBounds | null;
  viewportHeight: number;
}

interface CountryFootprint {
  name: string;
  dots: Array<MapPoint & { index: number }>;
  center: MapPoint;
  interiorAnchor: MapPoint;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  labelWidth: number;
}

interface FloatingCandidate {
  layout: CountryLabelLayout;
  score: number;
}

interface RailResult {
  layouts: CountryLabelLayout[];
  score: number;
}

const CONNECTED_DOT_DISTANCE = 34;
const MIN_INSIDE_DOT_COUNT = 14;
const INSIDE_PADDING = 30;
const LABEL_COLLISION_PADDING = 8;
const FLOATING_GAP = 20;
const BENT_FLOATING_GAP = 40;
const FLOATING_CLUSTER_WIDTH = 180;
const FLOATING_CLUSTER_HEIGHT = 136;
const MAX_FLOATING_PER_CLUSTER = 7;
const DENSE_SELECTION_THRESHOLD = 28;
const COMPACT_RAIL_SCALE_THRESHOLD = 0.15;
const COMPACT_RAIL_LABEL_THRESHOLD = 8;
const DOT_LEADER_GAP = 8;
const RAIL_GUTTER = 88;
const ROUTING_LANE_GAP = 8;
const ROUTING_VERTICAL_CLEARANCE = 4;
const ROUTING_PORT_MIN_SEPARATION = COUNTRY_LABEL_ROUTE_SEPARATION + 1;
const MIN_DOT_DEPARTURE = 12;
const STRAIGHT_ALIGNMENT_TOLERANCE = 0.5;
const BENT_ROUTE_PENALTY = 64;

const BASE_EXPORT_VIEWBOX: CountryLabelExportViewBox = {
  x: 30,
  y: 20,
  width: 2690,
  height: 1460,
};

const getCharacterWidth = (character: string) => {
  if (character === ' ') return 4.3;
  if ('ijlI1'.includes(character)) return 4;
  if ('mwMW@'.includes(character)) return 11.4;
  if (character === character.toUpperCase() && /[A-Z]/.test(character)) return 8.9;
  return 7.7;
};

export const estimateCountryLabelWidth = (name: string) => (
  Math.ceil(Array.from(name).reduce((width, character) => width + getCharacterWidth(character), 0) + 40)
);

const distanceBetween = (a: MapPoint, b: MapPoint) => Math.hypot(a.x - b.x, a.y - b.y);

const getLargestConnectedComponent = (indexes: number[], mapDots: MapPoint[]) => {
  const remaining = new Set(indexes.filter((index) => mapDots[index]));
  const components: number[][] = [];

  while (remaining.size > 0) {
    const first = remaining.values().next().value as number;
    const component: number[] = [];
    const queue = [first];
    remaining.delete(first);

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      component.push(current);

      for (const candidate of Array.from(remaining)) {
        if (distanceBetween(mapDots[current], mapDots[candidate]) <= CONNECTED_DOT_DISTANCE) {
          remaining.delete(candidate);
          queue.push(candidate);
        }
      }
    }

    components.push(component);
  }

  return components.sort((a, b) => b.length - a.length)[0] ?? [];
};

const getInteriorAnchor = (
  dots: Array<MapPoint & { index: number }>,
  center: MapPoint,
) => dots
  .map((dot) => ({
    dot,
    score: dots.filter((candidate) => distanceBetween(dot, candidate) <= 70).length * 20 -
      distanceBetween(dot, center),
  }))
  .sort((a, b) => b.score - a.score)[0]?.dot ?? center;

const getCountryFootprint = (
  name: string,
  indexes: number[],
  mapDots: MapPoint[],
): CountryFootprint | null => {
  const componentIndexes = getLargestConnectedComponent(indexes, mapDots);
  if (componentIndexes.length === 0) return null;

  const dots = componentIndexes.map((index) => ({ ...mapDots[index], index }));
  const minX = Math.min(...dots.map((dot) => dot.x));
  const maxX = Math.max(...dots.map((dot) => dot.x));
  const minY = Math.min(...dots.map((dot) => dot.y));
  const maxY = Math.max(...dots.map((dot) => dot.y));
  const center = {
    x: dots.reduce((sum, dot) => sum + dot.x, 0) / dots.length,
    y: dots.reduce((sum, dot) => sum + dot.y, 0) / dots.length,
  };

  return {
    name,
    dots,
    center,
    interiorAnchor: getInteriorAnchor(dots, center),
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    labelWidth: estimateCountryLabelWidth(name),
  };
};

const getRect = (centerX: number, centerY: number, width: number): CountryLabelRect => ({
  left: centerX - width / 2,
  right: centerX + width / 2,
  top: centerY - COUNTRY_LABEL_HEIGHT / 2,
  bottom: centerY + COUNTRY_LABEL_HEIGHT / 2,
});

export const countryLabelRectsOverlap = (
  a: CountryLabelRect,
  b: CountryLabelRect,
  padding = LABEL_COLLISION_PADDING,
) => !(
  a.right + padding <= b.left ||
  a.left >= b.right + padding ||
  a.bottom + padding <= b.top ||
  a.top >= b.bottom + padding
);

const rectSitsWithinBounds = (
  rect: CountryLabelRect,
  bounds: CountryLabelPlacementBounds,
) => (
  rect.left >= bounds.left &&
  rect.right <= bounds.right &&
  rect.top >= bounds.top &&
  rect.bottom <= bounds.bottom
);

const getMapBounds = (mapDots: MapPoint[], scale: number): CountryLabelPlacementBounds => ({
  left: Math.min(...mapDots.map((dot) => dot.x)) * scale,
  right: Math.max(...mapDots.map((dot) => dot.x)) * scale,
  top: Math.min(...mapDots.map((dot) => dot.y)) * scale,
  bottom: Math.max(...mapDots.map((dot) => dot.y)) * scale,
});

const getFootprintScreenBounds = (
  footprints: CountryFootprint[],
  scale: number,
): CountryLabelPlacementBounds => ({
  left: Math.min(...footprints.map((footprint) => footprint.minX * scale)),
  right: Math.max(...footprints.map((footprint) => footprint.maxX * scale)),
  top: Math.min(...footprints.map((footprint) => footprint.minY * scale)),
  bottom: Math.max(...footprints.map((footprint) => footprint.maxY * scale)),
});

const segmentIntersectsRect = (
  start: MapPoint,
  end: MapPoint,
  rect: CountryLabelRect,
) => {
  if (Math.abs(start.y - end.y) < 0.001) {
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    return start.y > rect.top && start.y < rect.bottom && maxX > rect.left && minX < rect.right;
  }

  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  return start.x > rect.left && start.x < rect.right && maxY > rect.top && minY < rect.bottom;
};

const expandRect = (rect: CountryLabelRect, padding: number): CountryLabelRect => ({
  left: rect.left - padding,
  right: rect.right + padding,
  top: rect.top - padding,
  bottom: rect.bottom + padding,
});

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

const getAbsoluteLeaderPoints = (label: CountryLabelLayout, scale: number) => (
  (label.leaderPoints ?? []).map((point) => ({
    x: label.anchor.x * scale + point.x,
    y: label.anchor.y * scale + point.y,
  }))
);

const routeIntersectsRect = (points: MapPoint[], rect: CountryLabelRect, padding = 0) => (
  points.slice(1).some((point, index) => (
    segmentIntersectsRect(points[index], point, padding > 0 ? expandRect(rect, padding) : rect)
  ))
);

const routesOverlap = (first: MapPoint[], second: MapPoint[]) => {
  for (let firstIndex = 1; firstIndex < first.length; firstIndex += 1) {
    for (let secondIndex = 1; secondIndex < second.length; secondIndex += 1) {
      if (segmentsOverlap(
        first[firstIndex - 1],
        first[firstIndex],
        second[secondIndex - 1],
        second[secondIndex],
      )) return true;
    }
  }
  return false;
};

const getNearestDot = (
  footprint: CountryFootprint,
  target: MapPoint,
  scale: number,
) => [...footprint.dots]
  .sort((a, b) => (
    distanceBetween({ x: a.x * scale, y: a.y * scale }, target) -
    distanceBetween({ x: b.x * scale, y: b.y * scale }, target) ||
    a.index - b.index
  ))[0];

const getSideAnchor = (footprint: CountryFootprint, side: CountryLabelSide) => {
  const direction = side === 'left' ? -1 : 1;
  return [...footprint.dots]
    .sort((a, b) => (
      direction * (b.x - a.x) ||
      Math.abs(a.y - footprint.center.y) - Math.abs(b.y - footprint.center.y) ||
      a.index - b.index
    ))[0];
};

const createLeaderPoints = (
  anchor: MapPoint,
  center: MapPoint,
  width: number,
  scale: number,
  forcedSide?: CountryLabelSide,
) => {
  const anchorScreen = { x: anchor.x * scale, y: anchor.y * scale };
  const side = forcedSide ?? (center.x < anchorScreen.x ? 'left' : 'right');
  const direction = side === 'left' ? -1 : 1;
  const start = {
    x: anchorScreen.x + direction * DOT_LEADER_GAP,
    y: anchorScreen.y,
  };
  const end = {
    x: center.x - direction * width / 2,
    y: center.y,
  };

  if (Math.abs(start.y - end.y) <= STRAIGHT_ALIGNMENT_TOLERANCE) {
    end.y = start.y;
    return {
      side,
      points: [start, end].map((point) => ({
        x: point.x - anchorScreen.x,
        y: point.y - anchorScreen.y,
      })),
    };
  }

  const availableHorizontal = direction * (end.x - start.x);
  if (availableHorizontal < MIN_DOT_DEPARTURE + COUNTRY_LABEL_MIN_PILL_APPROACH) return null;

  const laneX = end.x - direction * COUNTRY_LABEL_MIN_PILL_APPROACH;
  const points = [
    start,
    { x: laneX, y: start.y },
    { x: laneX, y: end.y },
    end,
  ];

  return {
    side,
    points: points.map((point) => ({
      x: point.x - anchorScreen.x,
      y: point.y - anchorScreen.y,
    })),
  };
};

const coversSelectedDot = (
  rect: CountryLabelRect,
  footprints: CountryFootprint[],
  scale: number,
) => footprints.some((footprint) => footprint.dots.some((dot) => (
  dot.x * scale > rect.left - 4 &&
  dot.x * scale < rect.right + 4 &&
  dot.y * scale > rect.top - 4 &&
  dot.y * scale < rect.bottom + 4
)));

const layoutConflicts = (
  layout: CountryLabelLayout,
  occupied: CountryLabelLayout[],
  scale: number,
) => {
  if (occupied.some((other) => countryLabelRectsOverlap(layout.rect, other.rect))) return true;

  const points = getAbsoluteLeaderPoints(layout, scale);
  if (occupied.some((other) => (
    routeIntersectsRect(points, other.rect, COUNTRY_LABEL_LEADER_CLEARANCE)
  ))) {
    return true;
  }

  return occupied.some((other) => {
    const otherPoints = getAbsoluteLeaderPoints(other, scale);
    return (
      otherPoints.length > 1 &&
      (
        routeIntersectsRect(otherPoints, layout.rect, COUNTRY_LABEL_LEADER_CLEARANCE) ||
        routesOverlap(points, otherPoints)
      )
    );
  });
};

const createFloatingCandidates = (
  footprint: CountryFootprint,
  allFootprints: CountryFootprint[],
  occupied: CountryLabelLayout[],
  visibleBounds: CountryLabelPlacementBounds,
  mapCenterX: number,
  scale: number,
) => {
  const left = footprint.minX * scale;
  const right = footprint.maxX * scale;
  const top = footprint.minY * scale;
  const bottom = footprint.maxY * scale;
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const halfWidth = footprint.labelWidth / 2;
  const halfHeight = COUNTRY_LABEL_HEIGHT / 2;
  const bentHorizontalX = {
    left: left - BENT_FLOATING_GAP - halfWidth,
    right: right + BENT_FLOATING_GAP + halfWidth,
  };
  const verticalY = {
    top: top - FLOATING_GAP - halfHeight,
    bottom: bottom + FLOATING_GAP + halfHeight,
  };
  const sideAnchors = {
    left: getSideAnchor(footprint, 'left'),
    right: getSideAnchor(footprint, 'right'),
  };
  const straightPositions = [FLOATING_GAP, 40, 80, 120].flatMap((gap, gapIndex) => ([
    {
      id: `right-${gap}`,
      x: right + gap + halfWidth,
      y: sideAnchors.right.y * scale,
      penalty: gapIndex * 8,
      side: 'right' as const,
    },
    {
      id: `left-${gap}`,
      x: left - gap - halfWidth,
      y: sideAnchors.left.y * scale,
      penalty: gapIndex * 8,
      side: 'left' as const,
    },
  ]));

  const positions: Array<{
    id: string;
    x: number;
    y: number;
    penalty: number;
    side?: CountryLabelSide;
  }> = [
    ...straightPositions,
    { id: 'top', x: centerX + 10, y: verticalY.top, penalty: 6 },
    { id: 'bottom', x: centerX - 10, y: verticalY.bottom, penalty: 6 },
    { id: 'top-right', x: bentHorizontalX.right, y: verticalY.top, penalty: 12, side: 'right' },
    { id: 'top-left', x: bentHorizontalX.left, y: verticalY.top, penalty: 12, side: 'left' },
    { id: 'bottom-right', x: bentHorizontalX.right, y: verticalY.bottom, penalty: 12, side: 'right' },
    { id: 'bottom-left', x: bentHorizontalX.left, y: verticalY.bottom, penalty: 12, side: 'left' },
    {
      id: 'right-high',
      x: bentHorizontalX.right,
      y: centerY - COUNTRY_LABEL_ROW_PITCH,
      penalty: 18,
      side: 'right',
    },
    {
      id: 'right-low',
      x: bentHorizontalX.right,
      y: centerY + COUNTRY_LABEL_ROW_PITCH,
      penalty: 18,
      side: 'right',
    },
    {
      id: 'left-high',
      x: bentHorizontalX.left,
      y: centerY - COUNTRY_LABEL_ROW_PITCH,
      penalty: 18,
      side: 'left',
    },
    {
      id: 'left-low',
      x: bentHorizontalX.left,
      y: centerY + COUNTRY_LABEL_ROW_PITCH,
      penalty: 18,
      side: 'left',
    },
  ];

  const seen = new Set<string>();
  const candidates: FloatingCandidate[] = [];

  positions.forEach((position, positionIndex) => {
    const key = `${position.x.toFixed(2)}:${position.y.toFixed(2)}`;
    if (seen.has(key)) return;
    seen.add(key);

    const center = { x: position.x, y: position.y };
    const rect = getRect(center.x, center.y, footprint.labelWidth);
    if (!rectSitsWithinBounds(rect, visibleBounds)) return;
    if (coversSelectedDot(rect, allFootprints, scale)) return;

    const anchor = position.side ? sideAnchors[position.side] : getNearestDot(footprint, center, scale);
    const leader = createLeaderPoints(anchor, center, footprint.labelWidth, scale, position.side);
    if (!leader) return;
    const layout: CountryLabelLayout = {
      name: footprint.name,
      anchor,
      offset: {
        x: center.x - anchor.x * scale,
        y: center.y - anchor.y * scale,
      },
      width: footprint.labelWidth,
      height: COUNTRY_LABEL_HEIGHT,
      rect,
      placement: 'floating',
      side: leader.side,
      leaderPoints: leader.points,
    };
    if (layoutConflicts(layout, occupied, scale)) return;

    const anchorScreen = { x: anchor.x * scale, y: anchor.y * scale };
    const absolutePoints = getAbsoluteLeaderPoints(layout, scale);
    const routeLength = absolutePoints.slice(1).reduce(
      (total, point, index) => total + distanceBetween(absolutePoints[index], point),
      0,
    );
    const movesOutward = Math.abs(center.x - mapCenterX) >= Math.abs(centerX - mapCenterX);
    const verticalDistance = Math.abs(center.y - anchorScreen.y);

    candidates.push({
      layout,
      score: routeLength + verticalDistance * 0.18 + position.penalty +
        (leader.points.length > 2 ? BENT_ROUTE_PENALTY : 0) +
        (movesOutward ? 0 : 14) + positionIndex * 0.001,
    });
  });

  return candidates.sort((a, b) => a.score - b.score || a.layout.name.localeCompare(b.layout.name));
};

const getClusterBounds = (cluster: CountryFootprint[], scale: number) => ({
  left: Math.min(...cluster.map((footprint) => footprint.center.x * scale)),
  right: Math.max(...cluster.map((footprint) => footprint.center.x * scale)),
  top: Math.min(...cluster.map((footprint) => footprint.center.y * scale)),
  bottom: Math.max(...cluster.map((footprint) => footprint.center.y * scale)),
});

const createSpatialClusters = (
  footprints: CountryFootprint[],
  scale: number,
) => {
  let clusters = [...footprints]
    .sort((a, b) => a.center.y - b.center.y || a.center.x - b.center.x || a.name.localeCompare(b.name))
    .map((footprint) => [footprint]);

  while (true) {
    let bestPair: { first: number; second: number; score: number } | null = null;

    for (let first = 0; first < clusters.length; first += 1) {
      for (let second = first + 1; second < clusters.length; second += 1) {
        const combined = [...clusters[first], ...clusters[second]];
        const bounds = getClusterBounds(combined, scale);
        if (
          bounds.right - bounds.left > FLOATING_CLUSTER_WIDTH ||
          bounds.bottom - bounds.top > FLOATING_CLUSTER_HEIGHT
        ) continue;

        const firstCenter = {
          x: clusters[first].reduce((sum, footprint) => sum + footprint.center.x * scale, 0) /
            clusters[first].length,
          y: clusters[first].reduce((sum, footprint) => sum + footprint.center.y * scale, 0) /
            clusters[first].length,
        };
        const secondCenter = {
          x: clusters[second].reduce((sum, footprint) => sum + footprint.center.x * scale, 0) /
            clusters[second].length,
          y: clusters[second].reduce((sum, footprint) => sum + footprint.center.y * scale, 0) /
            clusters[second].length,
        };
        const score = distanceBetween(firstCenter, secondCenter);

        if (
          !bestPair ||
          score < bestPair.score ||
          (Math.abs(score - bestPair.score) < 0.001 && first < bestPair.first)
        ) bestPair = { first, second, score };
      }
    }

    if (!bestPair) break;
    const merged = [...clusters[bestPair.first], ...clusters[bestPair.second]]
      .sort((a, b) => a.name.localeCompare(b.name));
    clusters = clusters.filter((_, index) => index !== bestPair.first && index !== bestPair.second);
    clusters.push(merged);
  }

  return clusters.sort((a, b) => {
    const aBounds = getClusterBounds(a, scale);
    const bBounds = getClusterBounds(b, scale);
    return aBounds.left - bBounds.left || aBounds.top - bBounds.top || a[0].name.localeCompare(b[0].name);
  });
};

const sortClusterForFloating = (cluster: CountryFootprint[], scale: number) => {
  const bounds = getClusterBounds(cluster, scale);
  const center = { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 };

  return [...cluster].sort((a, b) => {
    const aPoint = { x: a.center.x * scale, y: a.center.y * scale };
    const bPoint = { x: b.center.x * scale, y: b.center.y * scale };
    const aNeighbors = cluster.filter((other) => (
      other !== a && distanceBetween(aPoint, { x: other.center.x * scale, y: other.center.y * scale }) < 92
    )).length;
    const bNeighbors = cluster.filter((other) => (
      other !== b && distanceBetween(bPoint, { x: other.center.x * scale, y: other.center.y * scale }) < 92
    )).length;

    return (
      aNeighbors - bNeighbors ||
      a.labelWidth - b.labelWidth ||
      distanceBetween(bPoint, center) - distanceBetween(aPoint, center) ||
      a.name.localeCompare(b.name)
    );
  });
};

const buildRowGrid = (
  bounds: CountryLabelPlacementBounds,
  preferredRows: number[] = [],
) => {
  const minY = bounds.top + COUNTRY_LABEL_HEIGHT / 2;
  const maxY = bounds.bottom - COUNTRY_LABEL_HEIGHT / 2;
  const rows: number[] = [];
  for (let y = minY; y <= maxY + 0.001; y += COUNTRY_LABEL_ROW_GAP) rows.push(y);
  if (rows.length === 0 || Math.abs(rows[rows.length - 1] - maxY) > 0.001) rows.push(maxY);
  preferredRows.forEach((rowY) => {
    if (rowY >= minY && rowY <= maxY) rows.push(rowY);
  });
  return rows
    .sort((a, b) => a - b)
    .filter((rowY, index, sortedRows) => index === 0 || Math.abs(rowY - sortedRows[index - 1]) > 0.001);
};

const allocateRailRows = (
  footprints: CountryFootprint[],
  centerXFor: (footprint: CountryFootprint) => number,
  bounds: CountryLabelPlacementBounds,
  occupied: CountryLabelLayout[],
  allFootprints: CountryFootprint[],
  scale: number,
  getRowPenalty?: (footprint: CountryFootprint, rowY: number, index: number) => number,
  targetYFor: (footprint: CountryFootprint) => number = (footprint) => footprint.center.y * scale,
) => {
  const sorted = [...footprints].sort((a, b) => (
    targetYFor(a) - targetYFor(b) || a.center.x - b.center.x || a.name.localeCompare(b.name)
  ));
  const rows = buildRowGrid(bounds, sorted.map(targetYFor));
  const costs = sorted.map(() => rows.map(() => Number.POSITIVE_INFINITY));
  const previousRows = sorted.map(() => rows.map(() => -1));

  sorted.forEach((footprint, footprintIndex) => {
    rows.forEach((rowY, rowIndex) => {
      const rect = getRect(centerXFor(footprint), rowY, footprint.labelWidth);
      if (occupied.some((label) => countryLabelRectsOverlap(rect, label.rect))) return;
      if (coversSelectedDot(rect, allFootprints, scale)) return;
      const localCost = Math.abs(rowY - targetYFor(footprint)) +
        (getRowPenalty?.(footprint, rowY, footprintIndex) ?? 0);

      if (footprintIndex === 0) {
        costs[footprintIndex][rowIndex] = localCost;
        return;
      }

      let bestPrevious = -1;
      let bestCost = Number.POSITIVE_INFINITY;
      for (let candidateIndex = 0; candidateIndex < rowIndex; candidateIndex += 1) {
        if (rowY - rows[candidateIndex] < COUNTRY_LABEL_ROW_PITCH - 0.001) continue;
        if (costs[footprintIndex - 1][candidateIndex] < bestCost) {
          bestCost = costs[footprintIndex - 1][candidateIndex];
          bestPrevious = candidateIndex;
        }
      }

      if (bestPrevious >= 0) {
        costs[footprintIndex][rowIndex] = bestCost + localCost;
        previousRows[footprintIndex][rowIndex] = bestPrevious;
      }
    });
  });

  const lastCosts = costs[costs.length - 1] ?? [];
  let rowIndex = lastCosts.reduce(
    (best, cost, index) => (cost < (lastCosts[best] ?? Number.POSITIVE_INFINITY) ? index : best),
    0,
  );

  if (!Number.isFinite(lastCosts[rowIndex])) {
    const minimum = bounds.top + COUNTRY_LABEL_HEIGHT / 2;
    const maximum = bounds.bottom - COUNTRY_LABEL_HEIGHT / 2;
    const start = Math.max(
      minimum,
      Math.min(maximum - (sorted.length - 1) * COUNTRY_LABEL_ROW_PITCH, targetYFor(sorted[0])),
    );
    return {
      sorted,
      rows: sorted.map((_, index) => start + index * COUNTRY_LABEL_ROW_PITCH),
    };
  }

  const allocatedRows = Array(sorted.length).fill(0) as number[];
  for (let footprintIndex = sorted.length - 1; footprintIndex >= 0; footprintIndex -= 1) {
    allocatedRows[footprintIndex] = rows[rowIndex];
    rowIndex = previousRows[footprintIndex][rowIndex];
  }

  return { sorted, rows: allocatedRows };
};

const assignRailLanes = (
  footprints: CountryFootprint[],
  rows: number[],
  side: CountryLabelSide,
  scale: number,
  portOffsets: Map<string, number>,
  alignedEdge: number,
  occupied: CountryLabelLayout[],
) => {
  const assignments = new Map<string, number>();
  const intervals = footprints
    .map((footprint, index) => {
      const anchorY = getSideAnchor(footprint, side).y * scale +
        (portOffsets.get(footprint.name) ?? 0);
      return {
        footprint,
        rowY: rows[index],
        name: footprint.name,
        top: Math.min(anchorY, rows[index]),
        bottom: Math.max(anchorY, rows[index]),
        isStraight: Math.abs(anchorY - rows[index]) <= STRAIGHT_ALIGNMENT_TOLERANCE,
      };
    })
    .filter((interval) => !interval.isStraight)
    .sort((a, b) => a.top - b.top || a.bottom - b.bottom || a.name.localeCompare(b.name));
  const laneIntervals: Array<Array<{ top: number; bottom: number }>> = [];
  const direction = side === 'left' ? -1 : 1;

  intervals.forEach((interval) => {
    const anchor = getSideAnchor(interval.footprint, side);
    const anchorScreen = { x: anchor.x * scale, y: anchor.y * scale };
    const start = {
      x: anchorScreen.x + direction * DOT_LEADER_GAP,
      y: anchorScreen.y + (portOffsets.get(interval.name) ?? 0),
    };
    let bestLane = 0;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let laneIndex = 0; laneIndex < footprints.length + 24; laneIndex += 1) {
      const laneIsAvailable = (laneIntervals[laneIndex] ?? []).every((assigned) => (
        assigned.bottom + ROUTING_VERTICAL_CLEARANCE <= interval.top ||
        interval.bottom + ROUTING_VERTICAL_CLEARANCE <= assigned.top
      ));
      if (!laneIsAvailable) continue;

      const laneDepth = COUNTRY_LABEL_MIN_PILL_APPROACH + laneIndex * ROUTING_LANE_GAP;
      const laneX = alignedEdge - direction * laneDepth;
      const points = [
        start,
        { x: laneX, y: start.y },
        { x: laneX, y: interval.rowY },
        { x: alignedEdge, y: interval.rowY },
      ];
      if (Math.abs(laneX - start.x) < MIN_DOT_DEPARTURE) continue;
      let score = laneIndex;
      occupied.forEach((label) => {
        if (routeIntersectsRect(points, label.rect, COUNTRY_LABEL_LEADER_CLEARANCE)) {
          score += 1_000_000;
        }
        const otherPoints = getAbsoluteLeaderPoints(label, scale);
        if (otherPoints.length > 1 && routesOverlap(points, otherPoints)) {
          score += 1_000_000_000;
        }
      });
      if (score < bestScore) {
        bestScore = score;
        bestLane = laneIndex;
      }
    }

    laneIntervals[bestLane] = [
      ...(laneIntervals[bestLane] ?? []),
      { top: interval.top, bottom: interval.bottom },
    ];
    assignments.set(interval.name, bestLane);
  });

  return assignments;
};

const assignRailPortOffsets = (
  footprints: CountryFootprint[],
  rows: number[],
  side: CountryLabelSide,
  scale: number,
) => {
  const items = footprints.map((footprint, index) => ({
    footprint,
    index,
    anchorY: getSideAnchor(footprint, side).y * scale,
  })).sort((a, b) => a.anchorY - b.anchorY || a.footprint.name.localeCompare(b.footprint.name));
  const offsets = new Map<string, number>();
  const reservedStarts: number[] = [];

  items.forEach((item) => {
    const ownRow = rows[item.index];
    const candidates = [0];
    for (let step = 1; step < footprints.length + 8; step += 1) {
      candidates.push(-step * ROUTING_PORT_MIN_SEPARATION, step * ROUTING_PORT_MIN_SEPARATION);
    }
    if (Math.abs(item.anchorY - ownRow) < ROUTING_PORT_MIN_SEPARATION) {
      candidates.unshift(ownRow - item.anchorY);
    }

    const offset = candidates.find((candidateOffset) => {
      const candidateY = item.anchorY + candidateOffset;
      const clearsStarts = reservedStarts.every((reservedY) => (
        Math.abs(candidateY - reservedY) >= ROUTING_PORT_MIN_SEPARATION
      ));
      const clearsRows = rows.every((rowY, rowIndex) => (
        rowIndex === item.index ||
        Math.abs(candidateY - rowY) >= ROUTING_PORT_MIN_SEPARATION
      ));
      return clearsStarts && clearsRows;
    }) ?? 0;
    offsets.set(item.footprint.name, offset);
    reservedStarts.push(item.anchorY + offset);
  });

  return offsets;
};

const getRailRoute = (
  footprint: CountryFootprint,
  side: CountryLabelSide,
  rowY: number,
  alignedEdge: number,
  laneIndex: number,
  scale: number,
  portOffset = 0,
) => {
  const anchor = getSideAnchor(footprint, side);
  const anchorScreen = { x: anchor.x * scale, y: anchor.y * scale };
  const direction = side === 'left' ? -1 : 1;
  const start = {
    x: anchorScreen.x + direction * DOT_LEADER_GAP,
    y: anchorScreen.y + portOffset,
  };
  if (Math.abs(start.y - rowY) <= STRAIGHT_ALIGNMENT_TOLERANCE) {
    return {
      anchor,
      anchorScreen,
      points: [start, { x: alignedEdge, y: start.y }],
    };
  }

  const laneDepth = COUNTRY_LABEL_MIN_PILL_APPROACH +
    Math.max(0, laneIndex) * ROUTING_LANE_GAP;
  const laneX = alignedEdge - direction * laneDepth;

  return {
    anchor,
    anchorScreen,
    points: [
      start,
      { x: laneX, y: start.y },
      { x: laneX, y: rowY },
      { x: alignedEdge, y: rowY },
    ],
  };
};

const getRailScore = (
  layouts: CountryLabelLayout[],
  occupied: CountryLabelLayout[],
  scale: number,
) => {
  let score = 0;
  const allLayouts = [...occupied, ...layouts];

  layouts.forEach((layout) => {
    const points = getAbsoluteLeaderPoints(layout, scale);
    if (points.length > 2) score += BENT_ROUTE_PENALTY;
    points.slice(1).forEach((point, index) => {
      score += distanceBetween(points[index], point);
      allLayouts.forEach((other) => {
        if (
          other.name !== layout.name &&
          segmentIntersectsRect(
            points[index],
            point,
            expandRect(other.rect, COUNTRY_LABEL_LEADER_CLEARANCE),
          )
        ) {
          score += 1_000_000;
        }
      });
    });
  });

  for (let first = 0; first < allLayouts.length; first += 1) {
    for (let second = first + 1; second < allLayouts.length; second += 1) {
      if (countryLabelRectsOverlap(allLayouts[first].rect, allLayouts[second].rect)) score += 10_000_000;
      const firstPoints = getAbsoluteLeaderPoints(allLayouts[first], scale);
      const secondPoints = getAbsoluteLeaderPoints(allLayouts[second], scale);
      if (firstPoints.length > 1 && secondPoints.length > 1 && routesOverlap(firstPoints, secondPoints)) {
        score += 1_000_000_000;
      }
    }
  }

  return score;
};

const createRailForSide = (
  footprints: CountryFootprint[],
  side: CountryLabelSide,
  regionBounds: CountryLabelPlacementBounds,
  visibleBounds: CountryLabelPlacementBounds,
  occupied: CountryLabelLayout[],
  allFootprints: CountryFootprint[],
  scale: number,
): RailResult => {
  if (footprints.length === 0) return { layouts: [], score: 0 };

  const maxWidth = Math.max(...footprints.map((footprint) => footprint.labelWidth));
  const baseAlignedEdge = side === 'left'
    ? Math.max(visibleBounds.left + maxWidth, regionBounds.left - RAIL_GUTTER)
    : Math.min(visibleBounds.right - maxWidth, regionBounds.right + RAIL_GUTTER);
  const targetYFor = (footprint: CountryFootprint) => getSideAnchor(footprint, side).y * scale;
  let alignedEdge = baseAlignedEdge;
  const centerXFor = (footprint: CountryFootprint) => side === 'left'
    ? alignedEdge - footprint.labelWidth / 2
    : alignedEdge + footprint.labelWidth / 2;
  const getRowPenalty = (footprint: CountryFootprint, rowY: number) => {
    const rect = getRect(centerXFor(footprint), rowY, footprint.labelWidth);
    let rectPenalty = 0;
    occupied.forEach((label) => {
      const otherPoints = getAbsoluteLeaderPoints(label, scale);
      if (otherPoints.length > 1) {
        if (routeIntersectsRect(otherPoints, rect, COUNTRY_LABEL_LEADER_CLEARANCE)) {
          rectPenalty += 1_000_000;
        }
      }
    });
    const isStraight = Math.abs(targetYFor(footprint) - rowY) <= STRAIGHT_ALIGNMENT_TOLERANCE;
    const laneCount = isStraight ? 1 : footprints.length + 24;
    let routePenalty = Number.POSITIVE_INFINITY;

    for (let laneIndex = 0; laneIndex < laneCount; laneIndex += 1) {
      const points = getRailRoute(footprint, side, rowY, alignedEdge, laneIndex, scale).points;
      if (
        points.length > 2 &&
        Math.abs(points[1].x - points[0].x) < MIN_DOT_DEPARTURE
      ) continue;
      let candidatePenalty = laneIndex;
      occupied.forEach((label) => {
        if (routeIntersectsRect(points, label.rect, COUNTRY_LABEL_LEADER_CLEARANCE)) {
          candidatePenalty += 1_000_000;
        }
        const otherPoints = getAbsoluteLeaderPoints(label, scale);
        if (otherPoints.length > 1 && routesOverlap(points, otherPoints)) {
          candidatePenalty += 1_000_000_000;
        }
      });
      routePenalty = Math.min(routePenalty, candidatePenalty);
    }

    return rectPenalty + routePenalty;
  };
  const allocateAtCurrentEdge = () => allocateRailRows(
    footprints,
    centerXFor,
    visibleBounds,
    occupied,
    allFootprints,
    scale,
    getRowPenalty,
    targetYFor,
  );
  let allocated = allocateAtCurrentEdge();
  let portOffsets = assignRailPortOffsets(allocated.sorted, allocated.rows, side, scale);
  let laneAssignments = assignRailLanes(
    allocated.sorted,
    allocated.rows,
    side,
    scale,
    portOffsets,
    alignedEdge,
    occupied,
  );

  for (let iteration = 0; iteration < 5; iteration += 1) {
    const requiredEdge = allocated.sorted.reduce((edge, footprint, index) => {
      const anchor = getSideAnchor(footprint, side);
      const startX = anchor.x * scale + (side === 'left' ? -1 : 1) * DOT_LEADER_GAP;
      const isStraight = Math.abs(targetYFor(footprint) - allocated.rows[index]) <=
        STRAIGHT_ALIGNMENT_TOLERANCE;
      if (!isStraight) return edge;
      const candidate = side === 'left'
        ? startX - MIN_DOT_DEPARTURE
        : startX + MIN_DOT_DEPARTURE;
      return side === 'left' ? Math.min(edge, candidate) : Math.max(edge, candidate);
    }, baseAlignedEdge);
    const obstacleEdge = allocated.sorted.reduce((edge, footprint, index) => {
      const laneIndex = laneAssignments.get(footprint.name);
      if (laneIndex === undefined) return edge;
      const route = getRailRoute(
        footprint,
        side,
        allocated.rows[index],
        alignedEdge,
        laneIndex,
        scale,
        portOffsets.get(footprint.name) ?? 0,
      );
      if (route.points.length < 4) return edge;
      const laneDepth = COUNTRY_LABEL_MIN_PILL_APPROACH + laneIndex * ROUTING_LANE_GAP;
      return occupied.reduce((nextEdge, label) => {
        const paddedRect = expandRect(label.rect, COUNTRY_LABEL_LEADER_CLEARANCE);
        if (!segmentIntersectsRect(route.points[1], route.points[2], paddedRect)) return nextEdge;
        const candidate = side === 'left'
          ? paddedRect.left - laneDepth
          : paddedRect.right + laneDepth;
        return side === 'left'
          ? Math.min(nextEdge, candidate)
          : Math.max(nextEdge, candidate);
      }, edge);
    }, alignedEdge);
    const outwardEdge = side === 'left'
      ? Math.min(alignedEdge, requiredEdge, obstacleEdge)
      : Math.max(alignedEdge, requiredEdge, obstacleEdge);
    const nextAlignedEdge = side === 'left'
      ? Math.max(visibleBounds.left + maxWidth, outwardEdge)
      : Math.min(visibleBounds.right - maxWidth, outwardEdge);
    if (Math.abs(nextAlignedEdge - alignedEdge) <= 0.001) break;
    alignedEdge = nextAlignedEdge;
    allocated = allocateAtCurrentEdge();
    portOffsets = assignRailPortOffsets(allocated.sorted, allocated.rows, side, scale);
    laneAssignments = assignRailLanes(
      allocated.sorted,
      allocated.rows,
      side,
      scale,
      portOffsets,
      alignedEdge,
      occupied,
    );
  }

  const layouts = allocated.sorted.map((footprint, index) => {
    const center = { x: centerXFor(footprint), y: allocated.rows[index] };
    const route = getRailRoute(
      footprint,
      side,
      center.y,
      alignedEdge,
      laneAssignments.get(footprint.name) ?? 0,
      scale,
      portOffsets.get(footprint.name) ?? 0,
    );
    const { anchor, anchorScreen } = route;

    return {
      name: footprint.name,
      anchor,
      offset: {
        x: center.x - anchorScreen.x,
        y: center.y - anchorScreen.y,
      },
      width: footprint.labelWidth,
      height: COUNTRY_LABEL_HEIGHT,
      rect: getRect(center.x, center.y, footprint.labelWidth),
      placement: 'rail' as const,
      side,
      railIndex: index,
      leaderPoints: route.points.map((point) => ({
        x: point.x - anchorScreen.x,
        y: point.y - anchorScreen.y,
      })),
    };
  });

  return { layouts, score: getRailScore(layouts, occupied, scale) };
};

const getRequiredExtraHeight = (
  labelCount: number,
  bounds: CountryLabelPlacementBounds,
) => {
  if (labelCount <= 0) return 0;
  const requiredHeight = labelCount * COUNTRY_LABEL_HEIGHT +
    Math.max(0, labelCount - 1) * COUNTRY_LABEL_ROW_GAP;
  return Math.max(0, Math.ceil((requiredHeight - (bounds.bottom - bounds.top)) / COUNTRY_LABEL_ROW_PITCH) *
    COUNTRY_LABEL_ROW_PITCH);
};

const expandBoundsVertically = (
  bounds: CountryLabelPlacementBounds,
  extraHeight: number,
): CountryLabelPlacementBounds => ({
  ...bounds,
  top: bounds.top - extraHeight / 2,
  bottom: bounds.bottom + extraHeight / 2,
});

const createDenseRails = (
  footprints: CountryFootprint[],
  insideLayouts: CountryLabelLayout[],
  visibleBounds: CountryLabelPlacementBounds,
  scale: number,
) => {
  const sorted = [...footprints].sort((a, b) => (
    a.center.x - b.center.x || a.center.y - b.center.y || a.name.localeCompare(b.name)
  ));
  const splitIndex = Math.ceil(sorted.length / 2);
  const left = sorted.slice(0, splitIndex);
  const right = sorted.slice(splitIndex);
  const extraHeight = Math.max(
    getRequiredExtraHeight(left.length, visibleBounds),
    getRequiredExtraHeight(right.length, visibleBounds),
  );
  const effectiveBounds = expandBoundsVertically(visibleBounds, extraHeight);
  const regionBounds = getFootprintScreenBounds(footprints, scale);
  const leftResult = createRailForSide(
    left,
    'left',
    regionBounds,
    effectiveBounds,
    insideLayouts,
    footprints,
    scale,
  );
  const rightResult = createRailForSide(
    right,
    'right',
    regionBounds,
    effectiveBounds,
    [...insideLayouts, ...leftResult.layouts],
    footprints,
    scale,
  );

  return {
    layouts: [...leftResult.layouts, ...rightResult.layouts],
    extraHeight,
  };
};

const createCompactRail = (
  footprints: CountryFootprint[],
  visibleBounds: CountryLabelPlacementBounds,
  scale: number,
) => {
  const extraHeight = getRequiredExtraHeight(footprints.length, visibleBounds);
  const effectiveBounds = expandBoundsVertically(visibleBounds, extraHeight);
  const regionBounds = getFootprintScreenBounds(footprints, scale);
  const left = createRailForSide(
    footprints,
    'left',
    regionBounds,
    effectiveBounds,
    [],
    footprints,
    scale,
  );
  const right = createRailForSide(
    footprints,
    'right',
    regionBounds,
    effectiveBounds,
    [],
    footprints,
    scale,
  );
  const leftEdge = left.layouts[0]?.rect.right ?? Number.POSITIVE_INFINITY;
  const rightEdge = right.layouts[0]?.rect.left ?? Number.NEGATIVE_INFINITY;
  const leftIsOutside = leftEdge < regionBounds.left;
  const rightIsOutside = rightEdge > regionBounds.right;
  const layouts = leftIsOutside !== rightIsOutside
    ? (leftIsOutside ? left.layouts : right.layouts)
    : (left.score <= right.score ? left.layouts : right.layouts);

  return {
    layouts,
    extraHeight,
  };
};

const settleFloatingLayouts = (
  initialLayouts: CountryLabelLayout[],
  footprints: CountryFootprint[],
  visibleBounds: CountryLabelPlacementBounds,
  mapCenterX: number,
  scale: number,
) => {
  let layouts = [...initialLayouts];
  const footprintByName = new Map(footprints.map((footprint) => [footprint.name, footprint]));

  for (let iteration = 0; iteration < initialLayouts.length * 2; iteration += 1) {
    let floatingName: string | null = null;

    for (const label of layouts) {
      const points = getAbsoluteLeaderPoints(label, scale);
      if (points.length < 2) continue;

      for (const other of layouts) {
        if (other.name === label.name) continue;
        const otherPoints = getAbsoluteLeaderPoints(other, scale);
        const hasConflict = routeIntersectsRect(
          points,
          other.rect,
          COUNTRY_LABEL_LEADER_CLEARANCE,
        ) || (otherPoints.length > 1 && routesOverlap(points, otherPoints));
        if (!hasConflict) continue;
        if (other.placement === 'floating') {
          floatingName = other.name;
          break;
        }
        if (label.placement === 'floating') {
          floatingName = label.name;
          break;
        }
      }
      if (floatingName) break;
    }

    if (!floatingName) break;
    const footprint = footprintByName.get(floatingName);
    if (!footprint) break;

    const withoutFloating = layouts.filter((layout) => layout.name !== floatingName);
    const replacement = createFloatingCandidates(
      footprint,
      footprints,
      withoutFloating,
      visibleBounds,
      mapCenterX,
      scale,
    )[0];
    if (!replacement) break;
    layouts = [...withoutFloating, replacement.layout];
  }

  return layouts;
};

const createBestRailLayout = (
  footprints: CountryFootprint[],
  regionBounds: CountryLabelPlacementBounds,
  visibleBounds: CountryLabelPlacementBounds,
  occupied: CountryLabelLayout[],
  allFootprints: CountryFootprint[],
  scale: number,
): RailResult => {
  if (footprints.length === 0) return { layouts: [], score: 0 };

  const sorted = [...footprints].sort((a, b) => (
    a.center.y - b.center.y || a.center.x - b.center.x || a.name.localeCompare(b.name)
  ));
  const partitions: Array<{ left: CountryFootprint[]; right: CountryFootprint[] }> = [];
  const seen = new Set<string>();
  const addPartition = (left: CountryFootprint[], right: CountryFootprint[]) => {
    const key = `${left.map((item) => item.name).sort().join('|')}::${right
      .map((item) => item.name).sort().join('|')}`;
    if (seen.has(key)) return;
    seen.add(key);
    partitions.push({ left, right });
  };

  if (sorted.length <= 8) {
    for (let mask = 0; mask < 2 ** sorted.length; mask += 1) {
      addPartition(
        sorted.filter((_, index) => (mask & (1 << index)) === 0),
        sorted.filter((_, index) => (mask & (1 << index)) !== 0),
      );
    }
  } else {
    addPartition(sorted, []);
    addPartition([], sorted);
    addPartition(
      sorted.filter((_, index) => index % 2 === 0),
      sorted.filter((_, index) => index % 2 === 1),
    );
    addPartition(
      sorted.filter((_, index) => index % 2 === 1),
      sorted.filter((_, index) => index % 2 === 0),
    );
    const centerX = sorted.reduce((sum, footprint) => sum + footprint.center.x, 0) / sorted.length;
    addPartition(
      sorted.filter((footprint) => footprint.center.x <= centerX),
      sorted.filter((footprint) => footprint.center.x > centerX),
    );
  }

  return partitions
    .map((partition) => {
      const left = createRailForSide(
        partition.left,
        'left',
        regionBounds,
        visibleBounds,
        occupied,
        allFootprints,
        scale,
      );
      const right = createRailForSide(
        partition.right,
        'right',
        regionBounds,
        visibleBounds,
        [...occupied, ...left.layouts],
        allFootprints,
        scale,
      );
      const layouts = [...left.layouts, ...right.layouts];
      return {
        layouts,
        score: getRailScore(layouts, occupied, scale),
        key: `${partition.left.map((item) => item.name).join('|')}::${partition.right
          .map((item) => item.name).join('|')}`,
      };
    })
    .sort((a, b) => a.score - b.score || a.key.localeCompare(b.key))[0];
};

const createHybridLayouts = (
  clusters: CountryFootprint[][],
  allFootprints: CountryFootprint[],
  insideLayouts: CountryLabelLayout[],
  visibleBounds: CountryLabelPlacementBounds,
  mapCenterX: number,
  scale: number,
) => {
  const occupied = [...insideLayouts];
  const layouts: CountryLabelLayout[] = [];
  let maxRailCount = 0;

  clusters.forEach((cluster) => {
    const ordered = sortClusterForFloating(cluster, scale);
    let floatingFootprints = ordered.slice(0, MAX_FLOATING_PER_CLUSTER);
    let railFootprints = ordered.slice(MAX_FLOATING_PER_CLUSTER);

    for (let iteration = 0; iteration <= ordered.length; iteration += 1) {
      const regionBounds = getFootprintScreenBounds(cluster, scale);
      const workingOccupied = [...occupied];
      const floatingLayouts: CountryLabelLayout[] = [];
      const failed: CountryFootprint[] = [];

      floatingFootprints.forEach((footprint) => {
        const candidate = createFloatingCandidates(
          footprint,
          allFootprints,
          workingOccupied,
          visibleBounds,
          mapCenterX,
          scale,
        )[0];

        if (!candidate) {
          failed.push(footprint);
          return;
        }

        workingOccupied.push(candidate.layout);
        floatingLayouts.push(candidate.layout);
      });

      if (failed.length > 0) {
        const failedNames = new Set(failed.map((footprint) => footprint.name));
        railFootprints = [...railFootprints, ...failed]
          .sort((a, b) => a.name.localeCompare(b.name));
        floatingFootprints = floatingFootprints.filter((footprint) => !failedNames.has(footprint.name));
        continue;
      }

      const chosenRail = createBestRailLayout(
        railFootprints,
        regionBounds,
        visibleBounds,
        [...occupied, ...floatingLayouts],
        allFootprints,
        scale,
      );

      maxRailCount = Math.max(
        maxRailCount,
        chosenRail.layouts.filter((layout) => layout.side === 'left').length,
        chosenRail.layouts.filter((layout) => layout.side === 'right').length,
      );
      occupied.push(...chosenRail.layouts, ...floatingLayouts);
      layouts.push(...chosenRail.layouts, ...floatingLayouts);
      break;
    }
  });

  const insideNames = new Set(insideLayouts.map((layout) => layout.name));
  const settledLayouts = settleFloatingLayouts(
    [...insideLayouts, ...layouts],
    allFootprints,
    visibleBounds,
    mapCenterX,
    scale,
  ).filter((layout) => !insideNames.has(layout.name));

  return { layouts: settledLayouts, maxRailCount };
};

const getLineCommand = (from: MapPoint, to: MapPoint) => {
  if (Math.abs(from.y - to.y) < 0.001) return `H ${to.x}`;
  if (Math.abs(from.x - to.x) < 0.001) return `V ${to.y}`;
  return `L ${to.x} ${to.y}`;
};

export const createRoundedOrthogonalPath = (
  points: MapPoint[],
  radius = COUNTRY_LABEL_CORNER_RADIUS,
) => {
  const compactPoints = points.filter((point, index) => (
    index === 0 || distanceBetween(point, points[index - 1]) > 0.001
  ));
  if (compactPoints.length === 0) return '';
  if (compactPoints.length === 1) return `M ${compactPoints[0].x} ${compactPoints[0].y}`;

  let path = `M ${compactPoints[0].x} ${compactPoints[0].y}`;
  let currentPoint = compactPoints[0];

  for (let index = 1; index < compactPoints.length - 1; index += 1) {
    const previous = compactPoints[index - 1];
    const corner = compactPoints[index];
    const next = compactPoints[index + 1];
    const incomingLength = distanceBetween(previous, corner);
    const outgoingLength = distanceBetween(corner, next);
    const cornerRadius = Math.min(radius, incomingLength / 2, outgoingLength / 2);

    if (cornerRadius <= 0.001) {
      path += ` ${getLineCommand(currentPoint, corner)}`;
      currentPoint = corner;
      continue;
    }

    const beforeCorner = {
      x: corner.x + ((previous.x - corner.x) / incomingLength) * cornerRadius,
      y: corner.y + ((previous.y - corner.y) / incomingLength) * cornerRadius,
    };
    const afterCorner = {
      x: corner.x + ((next.x - corner.x) / outgoingLength) * cornerRadius,
      y: corner.y + ((next.y - corner.y) / outgoingLength) * cornerRadius,
    };

    path += ` ${getLineCommand(currentPoint, beforeCorner)}`;
    path += ` Q ${corner.x} ${corner.y} ${afterCorner.x} ${afterCorner.y}`;
    currentPoint = afterCorner;
  }

  const lastPoint = compactPoints[compactPoints.length - 1];
  path += ` ${getLineCommand(currentPoint, lastPoint)}`;
  return path;
};

export const createCountryLabelComposition = (
  countryNames: string[],
  mappings: Record<string, number[]>,
  mapDots: MapPoint[],
  options: CountryLabelCompositionOptions,
): CountryLabelComposition => {
  const scale = Math.max(options.placementScale, 0.01);
  const viewportHeight = Math.max(options.viewportHeight, 1);
  const visibleBounds = options.placementBounds ?? getMapBounds(mapDots, scale);
  const uniqueNames = Array.from(new Set(countryNames)).sort((a, b) => a.localeCompare(b));
  const footprints = uniqueNames
    .map((name) => getCountryFootprint(name, mappings[name] ?? [], mapDots))
    .filter((footprint): footprint is CountryFootprint => Boolean(footprint));

  if (footprints.length === 0) {
    return {
      labels: [],
      artboardHeight: viewportHeight,
      verticalShift: 0,
      exportViewBox: { ...BASE_EXPORT_VIEWBOX },
    };
  }

  const insideLayouts: CountryLabelLayout[] = [];
  const outsideFootprints: CountryFootprint[] = [];
  const insideOrder = [...footprints].sort((a, b) => (
    b.dots.length - a.dots.length ||
    b.width * b.height - a.width * a.height ||
    a.name.localeCompare(b.name)
  ));

  insideOrder.forEach((footprint) => {
    const center = {
      x: footprint.interiorAnchor.x * scale,
      y: footprint.interiorAnchor.y * scale,
    };
    const rect = getRect(center.x, center.y, footprint.labelWidth);
    const canSitInside =
      footprint.dots.length >= MIN_INSIDE_DOT_COUNT &&
      footprint.width * scale >= footprint.labelWidth + INSIDE_PADDING &&
      footprint.height * scale >= COUNTRY_LABEL_HEIGHT + INSIDE_PADDING &&
      rectSitsWithinBounds(rect, visibleBounds) &&
      !insideLayouts.some((layout) => countryLabelRectsOverlap(rect, layout.rect));

    if (!canSitInside) {
      outsideFootprints.push(footprint);
      return;
    }

    insideLayouts.push({
      name: footprint.name,
      anchor: footprint.interiorAnchor,
      offset: { x: 0, y: 0 },
      width: footprint.labelWidth,
      height: COUNTRY_LABEL_HEIGHT,
      rect,
      placement: 'inside',
    });
  });

  let outsideLayouts: CountryLabelLayout[] = [];
  let extraHeight = 0;

  const useCompactRails = scale < COMPACT_RAIL_SCALE_THRESHOLD &&
    footprints.length >= COMPACT_RAIL_LABEL_THRESHOLD;

  if (useCompactRails) {
    const compactResult = createCompactRail(footprints, visibleBounds, scale);
    insideLayouts.length = 0;
    outsideLayouts = compactResult.layouts;
    extraHeight = compactResult.extraHeight;
  } else if (footprints.length >= DENSE_SELECTION_THRESHOLD) {
    const denseResult = createDenseRails(
      footprints,
      [],
      visibleBounds,
      scale,
    );
    insideLayouts.length = 0;
    outsideLayouts = denseResult.layouts;
    extraHeight = denseResult.extraHeight;
  } else if (outsideFootprints.length > 0) {
    const mapBounds = getMapBounds(mapDots, scale);
    const mapCenterX = (mapBounds.left + mapBounds.right) / 2;
    const clusters = createSpatialClusters(outsideFootprints, scale);
    const anticipatedRailCount = Math.max(
      0,
      ...clusters.map((cluster) => Math.max(0, cluster.length - MAX_FLOATING_PER_CLUSTER)),
    );
    extraHeight = getRequiredExtraHeight(anticipatedRailCount, visibleBounds);
    let hybridResult = createHybridLayouts(
      clusters,
      footprints,
      insideLayouts,
      expandBoundsVertically(visibleBounds, extraHeight),
      mapCenterX,
      scale,
    );
    const requiredExtraHeight = getRequiredExtraHeight(hybridResult.maxRailCount, visibleBounds);

    if (requiredExtraHeight > extraHeight) {
      extraHeight = requiredExtraHeight;
      hybridResult = createHybridLayouts(
        clusters,
        footprints,
        insideLayouts,
        expandBoundsVertically(visibleBounds, extraHeight),
        mapCenterX,
        scale,
      );
    }

    outsideLayouts = hybridResult.layouts;
  }

  const exportExtraHeight = Math.ceil((extraHeight / scale) / 2) * 2;

  return {
    labels: [...insideLayouts, ...outsideLayouts].sort((a, b) => a.name.localeCompare(b.name)),
    artboardHeight: viewportHeight + extraHeight,
    verticalShift: extraHeight / 2,
    exportViewBox: {
      ...BASE_EXPORT_VIEWBOX,
      y: BASE_EXPORT_VIEWBOX.y - exportExtraHeight / 2,
      height: BASE_EXPORT_VIEWBOX.height + exportExtraHeight,
    },
  };
};
