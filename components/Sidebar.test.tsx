import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Sidebar from './Sidebar';
import { SidebarTab } from '../types';
import { CONTINENT_OPTIONS } from '../utils/continents';

const renderCountrySidebar = (showCountryLabels: boolean) => renderToStaticMarkup(
  <Sidebar
    isOpen
    setIsOpen={() => undefined}
    activeTab={SidebarTab.COUNTRIES}
    setActiveTab={() => undefined}
    selectedOffices={[]}
    toggleOffice={() => undefined}
    toggleAllOffices={() => undefined}
    selectedCountries={['Fiji']}
    highlightedCountries={[]}
    selectedContinents={[]}
    showCountryLabels={showCountryLabels}
    addCountry={() => undefined}
    removeCountry={() => undefined}
    toggleCountryHighlight={() => undefined}
    toggleContinent={() => undefined}
    allCountryNames={['Fiji']}
    continentNames={CONTINENT_OPTIONS}
  />,
);

describe('country selection chips', () => {
  it('shows the highlight control while country labels are visible', () => {
    const markup = renderCountrySidebar(true);

    expect(markup).toContain('aria-label="Highlight Fiji"');
    expect(markup).toContain('aria-label="Remove Fiji"');
    expect(markup).not.toContain('aria-label="Show country labels"');
  });

  it('hides the highlight control while country labels are hidden', () => {
    const markup = renderCountrySidebar(false);

    expect(markup).not.toContain('aria-label="Highlight Fiji"');
    expect(markup).toContain('aria-label="Remove Fiji"');
  });
});
