import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import MapCanvas from './MapCanvas';

const renderMapCanvas = (showCountryLabels: boolean) => renderToStaticMarkup(
  <MapCanvas
    selectedOffices={[]}
    selectedCountries={[]}
    individuallySelectedCountries={[]}
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
