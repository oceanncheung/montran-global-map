
import React, { useRef, useEffect, useLayoutEffect, useState, useMemo } from 'react';
import * as d3 from 'd3';
import type { Font } from 'opentype.js';
import { geoToPixel } from '../utils/geo';
import { OfficeLocation } from '../types';
import { MONTRAN_OFFICES } from '../constants';
import { MANUAL_MAPPINGS, MAP_DOTS } from '../utils/mappings';
import {
  COUNTRY_LABEL_FONT_SIZE,
  CountryLabelPlacementBounds,
  createCountryLabelComposition,
  createRoundedOrthogonalPath,
} from '../utils/countryLabels';

interface MapCanvasProps {
  selectedOffices: OfficeLocation[];
  selectedCountries: string[];
  labelCountries: string[];
  highlightedCountries: string[];
  showCountryLabels: boolean;
  isSidebarOpen: boolean;
  isGlobalGreen: boolean;
  onToggleGlobalGreen: (on: boolean) => void;
}

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

const SIDEBAR_WIDTH = 360;
const SIDEBAR_MARGIN = 24;
const SIDEBAR_GAP = 24;

const CONTENT_PADDING = 120;
const TOP_CLEARANCE = 120;
const BOTTOM_CLEARANCE = 72;
const LABEL_VIEWPORT_PADDING = 16;
const LABEL_VIEWPORT_TOP = 112;
const LABEL_VIEWPORT_BOTTOM = 88;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

let countryLabelFontPromise: Promise<Font> | null = null;

const getCountryLabelFont = () => {
  if (!countryLabelFontPromise) {
    countryLabelFontPromise = Promise.all([
      import('opentype.js'),
      fetch('/fonts/source-sans-3-regular.ttf').then((response) => {
        if (!response.ok) throw new Error(`Unable to load country label font (${response.status})`);
        return response.arrayBuffer();
      }),
    ]).then(([opentype, fontBuffer]) => opentype.parse(fontBuffer));
  }

  return countryLabelFontPromise;
};

const createCountryLabelGlyphPath = (
  font: Font,
  text: string,
  x: number,
  textAnchor: 'start' | 'end',
) => {
  const renderOptions = { kerning: true };
  const advanceWidth = font.getAdvanceWidth(text, COUNTRY_LABEL_FONT_SIZE, renderOptions);
  const startX = textAnchor === 'end' ? x - advanceWidth : x;
  const baselineY = 0.5 + (
    (font.ascender + font.descender) / font.unitsPerEm
  ) * COUNTRY_LABEL_FONT_SIZE / 2;

  return font
    .getPath(text, startX, baselineY, COUNTRY_LABEL_FONT_SIZE, renderOptions)
    .toPathData(3);
};

const DEFAULT_VIEW_FRAME = {
  open: {
    left: SIDEBAR_WIDTH + SIDEBAR_MARGIN + SIDEBAR_GAP,
    right: CONTENT_PADDING,
    top: TOP_CLEARANCE,
    bottom: BOTTOM_CLEARANCE,
  },
  closed: {
    left: CONTENT_PADDING,
    right: CONTENT_PADDING,
    top: TOP_CLEARANCE,
    bottom: BOTTOM_CLEARANCE,
  },
} as const;

const MapCanvas: React.FC<MapCanvasProps> = ({
  selectedOffices,
  selectedCountries,
  labelCountries,
  highlightedCountries,
  showCountryLabels,
  isSidebarOpen,
  isGlobalGreen,
  onToggleGlobalGreen,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const currentTransformRef = useRef<d3.ZoomTransform | null>(null);
  const defaultTransformRef = useRef<d3.ZoomTransform | null>(null);
  const hasInitializedDefaultRef = useRef(false);
  const isOverflowingRef = useRef(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [zoomScale, setZoomScale] = useState(1);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [countryLabelFont, setCountryLabelFont] = useState<Font | null>(null);
  const highlightedCountrySet = useMemo(
    () => new Set(highlightedCountries),
    [highlightedCountries],
  );

  useEffect(() => {
    let isMounted = true;
    getCountryLabelFont().then((font) => {
      if (isMounted) setCountryLabelFont(font);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // Derived set of indices to highlight based on sidebar selection
  const activeDotIndices = useMemo(() => {
    const indices = new Set<number>();
    selectedCountries.forEach(countryName => {
      const countryDots = MANUAL_MAPPINGS[countryName];
      if (countryDots) {
        countryDots.forEach(idx => indices.add(idx));
      }
    });
    return indices;
  }, [selectedCountries]);

  const allOfficeMarkers = useMemo(() => {
    const dotsWithIndices = MAP_DOTS.map((dot, index) => ({ ...dot, index }));
    const countries = Array.from(new Set(MONTRAN_OFFICES.map((o) => o.country)));

    return countries.map((country) => {
      const anchorOffice =
        MONTRAN_OFFICES.find((o) => o.country === country && o.markerAnchor) ??
        MONTRAN_OFFICES.find((o) => o.country === country);

      const anchoredDot =
        anchorOffice?.markerDotIndex !== undefined
          ? MAP_DOTS[anchorOffice.markerDotIndex]
          : null;

      if (anchoredDot) {
        return { id: country, snappedX: anchoredDot.x, snappedY: anchoredDot.y };
      }

      const target = geoToPixel(anchorOffice?.lat ?? 0, anchorOffice?.lng ?? 0);
      const countryDotIndices = MANUAL_MAPPINGS[country];
      const candidateDots = countryDotIndices?.length
        ? countryDotIndices
            .map((index) => ({ index, ...MAP_DOTS[index] }))
            .filter((dot) => Number.isFinite(dot.x) && Number.isFinite(dot.y))
        : dotsWithIndices;

      const chosenDot = candidateDots
        .map((dot) => ({ ...dot, distance: Math.hypot(dot.x - target.x, dot.y - target.y) }))
        .sort((a, b) => a.distance - b.distance)[0];

      return { id: country, snappedX: chosenDot?.x ?? 0, snappedY: chosenDot?.y ?? 0 };
    });
  }, []);

  const activeOfficeCountries = useMemo(() => {
    return new Set(selectedOffices.map((o) => o.country));
  }, [selectedOffices]);

  const transformsMatch = (a: d3.ZoomTransform | null, b: d3.ZoomTransform | null) => {
    if (!a || !b) return false;

    return (
      Math.abs(a.x - b.x) < 0.01 &&
      Math.abs(a.y - b.y) < 0.01 &&
      Math.abs(a.k - b.k) < 0.001
    );
  };

  const getDefaultTransform = (width: number, height: number) => {
    const hasDockedSidebar = isSidebarOpen && width >= 728;
    const frame = hasDockedSidebar ? DEFAULT_VIEW_FRAME.open : DEFAULT_VIEW_FRAME.closed;
    const availableWidth = Math.max(width - frame.left - frame.right, 240);
    const availableHeight = Math.max(height - frame.top - frame.bottom, 240);
    const fittedScale = Math.min(availableWidth / MAP_FIT_WIDTH, availableHeight / MAP_FIT_HEIGHT);
    const tx = frame.left + availableWidth / 2 - MAP_CONTENT_CENTER_X * fittedScale;
    const ty = frame.top + availableHeight / 2 - MAP_CONTENT_CENTER_Y * fittedScale;

    return d3.zoomIdentity.translate(tx, ty).scale(fittedScale);
  };

  const getLabelPlacementBounds = (
    width: number,
    height: number,
    transform: d3.ZoomTransform,
  ): CountryLabelPlacementBounds => {
    const hasDockedSidebar = isSidebarOpen && width >= 728;
    const screenLeft = hasDockedSidebar
      ? SIDEBAR_MARGIN + SIDEBAR_WIDTH + SIDEBAR_GAP / 2
      : LABEL_VIEWPORT_PADDING;

    return {
      left: screenLeft - transform.x,
      right: width - LABEL_VIEWPORT_PADDING - transform.x,
      top: LABEL_VIEWPORT_TOP - transform.y,
      bottom: height - LABEL_VIEWPORT_BOTTOM - transform.y,
    };
  };

  const baseDefaultTransform = useMemo(() => {
    if (viewportSize.width <= 0 || viewportSize.height <= 0) return d3.zoomIdentity;
    return getDefaultTransform(viewportSize.width, viewportSize.height);
  }, [viewportSize.width, viewportSize.height, isSidebarOpen]);

  const baseLabelPlacementBounds = useMemo<CountryLabelPlacementBounds | null>(() => {
    if (viewportSize.width <= 0 || viewportSize.height <= 0) return null;
    return getLabelPlacementBounds(
      viewportSize.width,
      viewportSize.height,
      baseDefaultTransform,
    );
  }, [viewportSize.width, viewportSize.height, baseDefaultTransform, isSidebarOpen]);

  const countryLabelComposition = useMemo(() => createCountryLabelComposition(
    showCountryLabels ? labelCountries : [],
    MANUAL_MAPPINGS,
    MAP_DOTS,
    {
      placementScale: baseDefaultTransform.k,
      placementBounds: baseLabelPlacementBounds,
      viewportHeight: Math.max(viewportSize.height, 1),
    },
  ), [
    showCountryLabels,
    labelCountries,
    baseDefaultTransform.k,
    baseLabelPlacementBounds,
    viewportSize.height,
  ]);

  const artboardHeight = Math.max(viewportSize.height, countryLabelComposition.artboardHeight);
  const isOverflowing = artboardHeight > viewportSize.height + 0.5;
  const defaultScale = Math.max(baseDefaultTransform.k, 0.01);
  const defaultTransform = useMemo(() => d3.zoomIdentity
    .translate(
      baseDefaultTransform.x,
      baseDefaultTransform.y + countryLabelComposition.verticalShift,
    )
    .scale(baseDefaultTransform.k), [
      baseDefaultTransform.x,
      baseDefaultTransform.y,
      baseDefaultTransform.k,
      countryLabelComposition.verticalShift,
    ]);
  const countryLabelLayouts = countryLabelComposition.labels;
  isOverflowingRef.current = isOverflowing;

  const applyTransform = (
    selection: d3.Selection<SVGSVGElement, unknown, null, undefined>,
    transform: d3.ZoomTransform,
    animate: boolean,
    duration = 650,
  ) => {
    if (!zoomRef.current) return;

    if (animate) {
      selection
        .transition()
        .duration(duration)
        .ease(d3.easeCubicInOut)
        .call(zoomRef.current.transform, transform);
      return;
    }

    selection.call(zoomRef.current.transform, transform);
  };

  useLayoutEffect(() => {
    if (!containerRef.current) return;

    const updateViewportSize = () => {
      if (!containerRef.current) return;
      const { width, height } = containerRef.current.getBoundingClientRect();
      setViewportSize((current) => (
        Math.abs(current.width - width) < 0.5 && Math.abs(current.height - height) < 0.5
          ? current
          : { width, height }
      ));
    };

    updateViewportSize();
    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;
    const svg = d3.select(svgRef.current);
    const g = svg.select<SVGGElement>('[data-map-world]');
    
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 15])
      .filter((event) => {
        const passesDefaultFilter = (!event.ctrlKey || event.type === 'wheel') && !event.button;
        return passesDefaultFilter && !(isOverflowingRef.current && event.type === 'wheel');
      })
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
        currentTransformRef.current = event.transform;
        setZoomScale(event.transform.k);
      });

    svg.call(zoom);
    zoomRef.current = zoom;
  }, []);

  useEffect(() => {
    if (
      !svgRef.current ||
      !zoomRef.current ||
      viewportSize.width <= 0 ||
      viewportSize.height <= 0
    ) return;

    const svg = d3.select(svgRef.current);
    const isAtDefault =
      !currentTransformRef.current ||
      transformsMatch(currentTransformRef.current, defaultTransformRef.current);
    const shouldAnimate = hasInitializedDefaultRef.current && isAtDefault;

    defaultTransformRef.current = defaultTransform;
    if (!hasInitializedDefaultRef.current || isAtDefault) {
      applyTransform(svg, defaultTransform, shouldAnimate, shouldAnimate ? 500 : 0);
    }
    hasInitializedDefaultRef.current = true;
  }, [
    defaultTransform.x,
    defaultTransform.y,
    defaultTransform.k,
    viewportSize.width,
    viewportSize.height,
  ]);

  useEffect(() => {
    if (!scrollAreaRef.current) return;
    scrollAreaRef.current.scrollTop = Math.max(0, (artboardHeight - viewportSize.height) / 2);
  }, [artboardHeight, viewportSize.height]);

  const handleZoomIn = () => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy, 1.4);
    }
  };

  const handleZoomOut = () => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy, 0.7);
    }
  };

  const handleResetZoom = () => {
    if (svgRef.current && zoomRef.current) {
      defaultTransformRef.current = defaultTransform;
      applyTransform(d3.select(svgRef.current), defaultTransform, true, 750);
    }
  };

  const getCleanSVGClone = async () => {
    if (!svgRef.current) return null;
    const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
    const innerGroup = clone.querySelector<SVGGElement>('[data-map-world]');
    if (innerGroup) {
      innerGroup.removeAttribute('transform');
    }
    clone.querySelectorAll<SVGGElement>('[data-export-transform]').forEach((label) => {
      const exportTransform = label.getAttribute('data-export-transform');
      if (exportTransform) label.setAttribute('transform', exportTransform);
    });
    const { x, y, width, height } = countryLabelComposition.exportViewBox;
    clone.removeAttribute('style');
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
    clone.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);

    const font = await getCountryLabelFont();
    clone.querySelectorAll<SVGTextElement>('[data-country-label] text').forEach((text) => {
      const glyphPath = document.createElementNS(SVG_NAMESPACE, 'path');
      const textAnchor = text.getAttribute('text-anchor') === 'end' ? 'end' : 'start';
      glyphPath.setAttribute('d', createCountryLabelGlyphPath(
        font,
        text.textContent ?? '',
        Number(text.getAttribute('x') ?? 0),
        textAnchor,
      ));
      glyphPath.setAttribute('fill', text.getAttribute('fill') ?? '#24423d');
      glyphPath.setAttribute('data-country-label-glyphs', 'true');
      text.replaceWith(glyphPath);
    });

    return clone;
  };

  const exportSVG = async () => {
    const clone = await getCleanSVGClone();
    if (!clone) return;
    const svgData = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "montran-world-map.svg";
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportPNG = async (scale: number) => {
    const clone = await getCleanSVGClone();
    if (!clone) return;
    const svgData = new XMLSerializer().serializeToString(clone);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      const baseWidth = countryLabelComposition.exportViewBox.width;
      const baseHeight = countryLabelComposition.exportViewBox.height;
      canvas.width = baseWidth * scale;
      canvas.height = baseHeight * scale;
      
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const pngUrl = canvas.toDataURL("image/png");
        const downloadLink = document.createElement("a");
        downloadLink.href = pngUrl;
        downloadLink.download = `montran-map-${scale}x.png`;
        downloadLink.click();
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  return (
    <div ref={containerRef} className="flex-1 relative bg-white overflow-hidden">
      {/* Header UI */}
      <div className="absolute top-6 right-6 z-40">
        <div className="relative">
          <button 
            onClick={() => setIsExportOpen(!isExportOpen)}
            className={`bg-white border border-slate-200 px-6 h-[72px] rounded-xl flex items-center gap-3 hover:bg-slate-50 transition-all ${isExportOpen ? 'shadow-[0_15px_40px_rgba(0,0,0,0.08)]' : 'shadow-none'}`}
          >
            <span className="text-display-9 font-light text-slate-600">Export</span>
            <svg className={`w-4 h-4 transition-transform ${isExportOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/></svg>
          </button>
          
          {isExportOpen && (
            <div className="absolute top-full right-0 mt-3 w-80 bg-white border border-slate-100 rounded-xl shadow-[0_15px_40px_rgba(0,0,0,0.08)] overflow-hidden animate-in fade-in slide-in-from-top-2">
              <button 
                onClick={() => { exportSVG(); setIsExportOpen(false); }} 
                className="w-full text-left px-6 py-5 text-display-9 text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-all border-b border-slate-50"
              >
                Download SVG
              </button>
              <div className="px-6 py-4 flex items-center justify-between border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors group">
                <span className="text-display-9 text-slate-600">Download PNG</span>
                <div className="flex gap-1">
                  {[1, 2, 4].map(scale => (
                    <button
                      key={scale}
                      onClick={() => { exportPNG(scale); setIsExportOpen(false); }}
                      className="text-[14px] text-slate-400 font-medium hover:text-slate-900 hover:bg-slate-100 transition-all px-3 py-1.5 rounded-lg border border-transparent hover:border-slate-200"
                    >
                      {scale}x
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer UI */}
      <div className="absolute bottom-6 right-6 z-40 flex items-center gap-3">
      <button
        onClick={() => onToggleGlobalGreen(!isGlobalGreen)}
        className={`h-12 px-4 flex items-center gap-2 rounded-xl border transition-all duration-200 ${
          isGlobalGreen
            ? 'bg-[#009681] border-[#009681] text-white shadow-sm'
            : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-600'
        }`}
        title="Toggle all dots green"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      </button>
      <div className="flex items-center bg-white border border-slate-200 rounded-xl overflow-hidden transition-all duration-300">
        <button 
          onClick={handleZoomOut}
          className="w-12 h-12 flex items-center justify-center text-slate-400 hover:text-slate-900 hover:bg-slate-50 transition-all text-xl font-light border-r border-slate-100"
          aria-label="Zoom Out"
        >
          &minus;
        </button>
        <button 
          onClick={handleResetZoom}
          className="px-5 h-12 flex items-center justify-center text-[14px] font-medium text-slate-500 tabular-nums select-none min-w-[64px] hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer"
          title="Reset to 1x"
        >
          {(zoomScale / defaultScale).toFixed(1)}x
        </button>
        <button 
          onClick={handleZoomIn}
          className="w-12 h-12 flex items-center justify-center text-slate-400 hover:text-slate-900 hover:bg-slate-50 transition-all text-xl font-light border-l border-slate-100"
          aria-label="Zoom In"
        >
          +
        </button>
      </div>
      </div>

      <div
        ref={scrollAreaRef}
        className={`absolute inset-0 z-0 overflow-x-hidden ${
          isOverflowing ? 'overflow-y-auto overscroll-contain' : 'overflow-y-hidden'
        }`}
        data-map-scroll-area
      >
      <svg
        ref={svgRef}
        className="w-full map-container block"
        style={{ height: `${Math.max(artboardHeight, 1)}px` }}
        data-artboard-height={artboardHeight}
        data-export-width={countryLabelComposition.exportViewBox.width}
        data-export-height={countryLabelComposition.exportViewBox.height}
      >
        <defs>
          <filter id="office-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="12" result="blur" />
            <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0.6 0 0 0 0  0 0 0 0 0  0 0 0 0.5 0" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="office-glow-green" x="-800%" y="-800%" width="1700%" height="1700%">
            <feMorphology in="SourceGraphic" operator="dilate" radius="12" result="whiteSrc" />
            <feGaussianBlur in="whiteSrc" stdDeviation="28" result="whiteBlur" />
            <feColorMatrix in="whiteBlur" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.65 0" result="whiteGlow" />
            <feMorphology in="SourceGraphic" operator="dilate" radius="4" result="greenSrc" />
            <feGaussianBlur in="greenSrc" stdDeviation="8" result="greenBlur" />
            <feColorMatrix in="greenBlur" type="matrix" values="0 0 0 0 0.7  0 0 0 0 1  0 0 0 0 0.95  0 0 0 0.7 0" result="greenGlow" />
            <feMerge>
              <feMergeNode in="whiteGlow" />
              <feMergeNode in="greenGlow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="country-label-shadow" x="-30%" y="-60%" width="160%" height="220%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#0f172a" floodOpacity="0.14" />
          </filter>
        </defs>
        <g data-map-world>
          <g id="country-label-leaders" pointerEvents="none" aria-hidden="true">
            {countryLabelLayouts.map((label) => {
              if (!label.leaderPoints) return null;
              const baseLabelScale = 1 / defaultScale;
              const labelTransform = `translate(${label.anchor.x} ${label.anchor.y}) scale(${baseLabelScale})`;

              return (
                <g
                  key={`leader-${label.name}`}
                  data-country-leader={label.name}
                  data-export-transform={labelTransform}
                  transform={labelTransform}
                >
                  <path
                    d={createRoundedOrthogonalPath(label.leaderPoints)}
                    fill="none"
                    stroke="#009681"
                    strokeWidth="1.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity="0.5"
                  />
                </g>
              );
            })}
          </g>
          <g id="grid-dots">
            {MAP_DOTS.map((dot, i) => {
              const isActive = isGlobalGreen || activeDotIndices.has(i);
              return (
                <circle
                  key={`dot-${i}`}
                  cx={dot.x}
                  cy={dot.y}
                  r={6}
                  fill={isActive ? "#009681" : "#d5d4d4"}
                  opacity={isActive ? 1 : 0.8}
                  className="grid-dot"
                  style={{ transition: 'fill 150ms ease, opacity 150ms ease' }}
                />
              );
            })}
          </g>
          <g id="country-labels" pointerEvents="none" aria-hidden="true">
            {countryLabelLayouts.map((label, index) => {
              const baseLabelScale = 1 / defaultScale;
              const anchorTransform = `translate(${label.anchor.x} ${label.anchor.y})`;
              const labelTransform = `${anchorTransform} scale(${baseLabelScale})`;
              const mirrorPill = label.side === 'left';
              const textX = mirrorPill ? label.width / 2 - 25 : -label.width / 2 + 25;
              const textAnchor = mirrorPill ? 'end' : 'start';
              const isHighlighted = highlightedCountrySet.has(label.name);
              const labelTextColor = isHighlighted ? '#ffffff' : '#24423d';
              const glyphPath = countryLabelFont
                ? createCountryLabelGlyphPath(countryLabelFont, label.name, textX, textAnchor)
                : null;

              return (
                <g
                  key={label.name}
                  className="country-label"
                  data-country-label={label.name}
                  data-label-placement={label.placement}
                  data-label-side={label.side}
                  data-label-rail-index={label.railIndex}
                  data-label-highlighted={isHighlighted ? 'true' : 'false'}
                  data-export-transform={labelTransform}
                  transform={labelTransform}
                  style={{ animationDelay: `${Math.min(index * 35, 210)}ms` }}
                >
                  <g transform={`translate(${label.offset.x} ${label.offset.y})`}>
                    <rect
                      x={-label.width / 2}
                      y={-label.height / 2}
                      width={label.width}
                      height={label.height}
                      rx={label.height / 2}
                      fill={isHighlighted ? '#009681' : '#ffffff'}
                      stroke="#009681"
                      strokeWidth="1.15"
                      strokeOpacity={isHighlighted ? 1 : 0.48}
                      filter="url(#country-label-shadow)"
                    />
                    <circle
                      cx={mirrorPill ? label.width / 2 - 13 : -label.width / 2 + 13}
                      cy="0"
                      r="3.5"
                      fill={isHighlighted ? '#ffffff' : '#009681'}
                    />
                    {glyphPath ? (
                      <path
                        d={glyphPath}
                        fill={labelTextColor}
                        data-country-label-glyphs="true"
                      />
                    ) : (
                      <text
                        x={textX}
                        y="0.5"
                        fill={labelTextColor}
                        fontFamily="Source Sans 3, sans-serif"
                        fontSize={COUNTRY_LABEL_FONT_SIZE}
                        fontWeight="400"
                        letterSpacing="0"
                        dominantBaseline="middle"
                        textAnchor={textAnchor}
                      >
                        {label.name}
                      </text>
                    )}
                  </g>
                </g>
              );
            })}
          </g>
          <g id="offices">
            {allOfficeMarkers.map((office) => {
              const isVisible = activeOfficeCountries.has(office.id);
              const officeColor = isGlobalGreen ? '#0BEAC5' : '#f97316';
              const officeGlow = isGlobalGreen ? 'url(#office-glow-green)' : 'url(#office-glow)';
              return (
                <circle
                  key={office.id}
                  cx={office.snappedX}
                  cy={office.snappedY}
                  r={isVisible ? (isGlobalGreen ? 14.4 : 12) : 6}
                  fill={isVisible ? officeColor : '#d5d4d4'}
                  opacity={isVisible ? 1 : 0}
                  filter={isVisible ? officeGlow : 'none'}
                  style={{
                    stroke: 'none',
                    transition: isVisible
                      ? 'r 200ms ease-out, fill 150ms ease, opacity 100ms ease, filter 150ms ease'
                      : 'r 200ms ease-in, fill 150ms ease 50ms, opacity 150ms ease 100ms, filter 50ms ease',
                  }}
                  pointerEvents={isVisible ? 'auto' : 'none'}
                />
              );
            })}
          </g>
        </g>
      </svg>
      </div>
    </div>
  );
};

export default MapCanvas;
