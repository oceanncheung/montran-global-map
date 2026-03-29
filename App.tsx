
import React, { useState, useEffect, useMemo } from 'react';
import Sidebar from './components/Sidebar';
import MapCanvas from './components/MapCanvas';
import { SidebarTab } from './types';
import { MONTRAN_OFFICES } from './constants';

const App: React.FC = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<SidebarTab>(SidebarTab.OFFICES);
  const [selectedOffices, setSelectedOffices] = useState<string[]>([]);
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [allCountryNames, setAllCountryNames] = useState<string[]>([]);
  const [geoData, setGeoData] = useState<any>(null);

  useEffect(() => {
    fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson')
      .then(res => res.json())
      .then(data => {
        setGeoData(data);
        const names = data.features.map((f: any) => f.properties.ADMIN || f.properties.name || f.properties.NAME);
        setAllCountryNames(Array.from(new Set<string>(names)).sort());
      })
      .catch(err => console.error("Error loading geojson:", err));
  }, []);

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
        addCountry={addCountry}
        removeCountry={removeCountry}
        allCountryNames={allCountryNames}
      />
      
      <main className="flex-1 relative overflow-hidden flex flex-col">
        <MapCanvas 
          selectedOffices={currentOfficeObjects}
          selectedCountries={selectedCountries}
          geoData={geoData}
        />
      </main>
    </div>
  );
};

export default App;
