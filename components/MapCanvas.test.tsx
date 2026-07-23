import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import MapCanvas from './MapCanvas';

const renderMapCanvas = (
  showCountryLabels: boolean,
  selectedCountries: string[] = ['Fiji'],
) => renderToStaticMarkup(
  <MapCanvas
    selectedOffices={[]}
    selectedCountries={selectedCountries}
    individuallySelectedCountries={selectedCountries}
    selectedContinents={[]}
    highlightedCountries={[]}
    showCountryLabels={showCountryLabels}
    isSidebarOpen
    isGlobalGreen={false}
    onToggleGlobalGreen={() => undefined}
    onToggleCountryLabels={() => undefined}
  />,
);

describe('map country label control', () => {
  it('keeps the tag button disabled and left of the globe until a country is selected', () => {
    const markup = renderMapCanvas(true, []);
    const labelControlIndex = markup.indexOf('aria-label="Select a country to use labels"');
    const globeControlIndex = markup.indexOf('aria-label="Toggle all dots green"');

    expect(labelControlIndex).toBeGreaterThan(-1);
    expect(markup).toContain('disabled=""');
    expect(labelControlIndex).toBeLessThan(globeControlIndex);
  });

  it('renders an active tag button when labels are visible', () => {
    const markup = renderMapCanvas(true);

    expect(markup).toContain('aria-label="Hide country labels"');
    expect(markup).toContain('aria-pressed="true"');
  });

  it('renders an inactive tag button when labels are hidden', () => {
    const markup = renderMapCanvas(false);

    expect(markup).toContain('aria-label="Show country labels"');
    expect(markup).toContain('aria-pressed="false"');
  });
});
