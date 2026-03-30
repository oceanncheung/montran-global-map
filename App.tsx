
import React, { useState, useMemo } from 'react';
import Sidebar from './components/Sidebar';
import MapCanvas from './components/MapCanvas';
import { SidebarTab } from './types';
import { MONTRAN_OFFICES } from './constants';
import { COUNTRY_NAMES } from './utils/mappings';
import { CONTINENT_COUNTRY_MAP, CONTINENT_OPTIONS, ContinentName } from './utils/continents';

const App: React.FC = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<SidebarTab>(SidebarTab.OFFICES);
  const [selectedOffices, setSelectedOffices] = useState<string[]>([]);
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [selectedContinents, setSelectedContinents] = useState<ContinentName[]>([]);
  const [isGlobalGreen, setIsGlobalGreen] = useState(false);

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
  };

  const toggleContinent = (continent: ContinentName) => {
    setSelectedContinents(prev => {
      const next = prev.includes(continent)
        ? prev.filter(name => name !== continent)
        : [...prev, continent];
      if (next.length < CONTINENT_OPTIONS.length) setIsGlobalGreen(false);
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

  const activeRegionCountries = useMemo(() => {
    return Array.from(new Set([
      ...selectedCountries,
      ...selectedContinents.flatMap((continent) => CONTINENT_COUNTRY_MAP[continent]),
    ]));
  }, [selectedCountries, selectedContinents]);

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
        selectedContinents={selectedContinents}
        addCountry={addCountry}
        removeCountry={removeCountry}
        toggleContinent={toggleContinent}
        allCountryNames={COUNTRY_NAMES}
        continentNames={CONTINENT_OPTIONS}
      />
      
      <main className="flex-1 relative overflow-hidden flex flex-col">
        <MapCanvas 
          selectedOffices={currentOfficeObjects}
          selectedCountries={activeRegionCountries}
          isSidebarOpen={isSidebarOpen}
          isGlobalGreen={isGlobalGreen}
          onToggleGlobalGreen={toggleGlobalGreen}
        />
      </main>
    </div>
  );
};

export default App;
