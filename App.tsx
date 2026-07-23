
import React, { useState, useMemo } from 'react';
import Sidebar from './components/Sidebar';
import MapCanvas from './components/MapCanvas';
import { SidebarTab } from './types';
import { MONTRAN_OFFICES } from './constants';
import { COUNTRY_NAMES } from './utils/mappings';
import { CONTINENT_OPTIONS, ContinentName } from './utils/continents';

const App: React.FC = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<SidebarTab>(SidebarTab.OFFICES);
  const [selectedOffices, setSelectedOffices] = useState<string[]>([]);
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [highlightedCountries, setHighlightedCountries] = useState<string[]>([]);
  const [selectedContinents, setSelectedContinents] = useState<ContinentName[]>([]);
  const [isGlobalGreen, setIsGlobalGreen] = useState(false);
  const [showCountryLabels, setShowCountryLabels] = useState(true);

  const toggleOffice = (id: string) => {
    setSelectedOffices(prev => 
      prev.includes(id) ? prev.filter(oId => oId !== id) : [...prev, id]
    );
  };

  const toggleAllOffices = () => {
    if (selectedOffices.length === MONTRAN_OFFICES.length) {
      setSelectedOffices([]);
    } else {
      setSelectedOffices(MONTRAN_OFFICES.map(o => o.id));
    }
  };

  const addCountry = (name: string) => {
    if (!selectedCountries.includes(name)) {
      setSelectedCountries(prev => [...prev, name]);
    }
  };

  const removeCountry = (name: string) => {
    setSelectedCountries(prev => prev.filter(c => c !== name));
    setHighlightedCountries(prev => prev.filter(c => c !== name));
  };

  const toggleCountryHighlight = (name: string) => {
    setHighlightedCountries(prev => (
      prev.includes(name) ? prev.filter(c => c !== name) : [...prev, name]
    ));
  };

  const toggleContinent = (continent: ContinentName) => {
    setSelectedContinents(prev => {
      const next = prev.includes(continent)
        ? prev.filter(name => name !== continent)
        : [...prev, continent];
      setIsGlobalGreen(next.length === CONTINENT_OPTIONS.length);
      return next;
    });
  };

  const toggleGlobalGreen = (on: boolean) => {
    setIsGlobalGreen(on);
    setSelectedContinents(on ? [...CONTINENT_OPTIONS] : []);
  };

  const currentOfficeObjects = useMemo(() => {
    return MONTRAN_OFFICES.filter(o => selectedOffices.includes(o.id));
  }, [selectedOffices]);

  return (
    <div className="flex w-screen h-screen bg-white overflow-hidden relative">
      <Sidebar 
        isOpen={isSidebarOpen}
        setIsOpen={setIsSidebarOpen}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedOffices={selectedOffices}
        toggleOffice={toggleOffice}
        toggleAllOffices={toggleAllOffices}
        selectedCountries={selectedCountries}
        highlightedCountries={highlightedCountries}
        selectedContinents={selectedContinents}
        showCountryLabels={showCountryLabels}
        addCountry={addCountry}
        removeCountry={removeCountry}
        toggleCountryHighlight={toggleCountryHighlight}
        toggleContinent={toggleContinent}
        allCountryNames={COUNTRY_NAMES}
        continentNames={CONTINENT_OPTIONS}
      />
      
      <main className="flex-1 relative overflow-hidden flex flex-col">
        <MapCanvas 
          selectedOffices={currentOfficeObjects}
          selectedCountries={selectedCountries}
          individuallySelectedCountries={selectedCountries}
          selectedContinents={selectedContinents}
          highlightedCountries={highlightedCountries}
          showCountryLabels={showCountryLabels}
          isSidebarOpen={isSidebarOpen}
          isGlobalGreen={isGlobalGreen}
          onToggleGlobalGreen={toggleGlobalGreen}
          onToggleCountryLabels={() => setShowCountryLabels((visible) => !visible)}
        />
      </main>
    </div>
  );
};

export default App;
