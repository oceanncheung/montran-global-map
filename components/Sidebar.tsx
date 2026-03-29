import React, { useState, useMemo, useRef } from 'react';
import { SidebarTab } from '../types';
import { MONTRAN_OFFICES, MontranOffice } from '../constants';

interface SidebarProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  activeTab: SidebarTab;
  setActiveTab: (tab: SidebarTab) => void;
  selectedOffices: string[];
  toggleOffice: (id: string) => void;
  toggleAllOffices: () => void;
  selectedCountries: string[];
  addCountry: (name: string) => void;
  removeCountry: (name: string) => void;
  allCountryNames: string[];
}

const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  setIsOpen,
  activeTab,
  setActiveTab,
  selectedOffices,
  toggleOffice,
  toggleAllOffices,
  selectedCountries,
  addCountry,
  removeCountry,
  allCountryNames
}) => {
  const [countrySearch, setCountrySearch] = useState('');
  const [expandedRegions, setExpandedRegions] = useState<string[]>(['Corporate HQ']);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const groupedOffices = useMemo<Record<string, MontranOffice[]>>(() => {
    const categories = ['Corporate HQ', 'Americas', 'Europe', 'MENA', 'Africa', 'APAC'];
    const acc: Record<string, MontranOffice[]> = {};
    categories.forEach(cat => acc[cat] = []);
    
    MONTRAN_OFFICES.forEach(office => {
      if (acc[office.region]) {
        acc[office.region].push(office);
      }
    });
    return acc;
  }, []);

  const toggleRegion = (region: string) => {
    setExpandedRegions(prev => 
      prev.includes(region) ? prev.filter(r => r !== region) : [...prev, region]
    );
  };

  const handleToggleAllOffices = () => {
    if (selectedOffices.length !== MONTRAN_OFFICES.length) {
      setExpandedRegions(Object.keys(groupedOffices));
    }
    toggleAllOffices();
  };

  const handleCsvUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) return;

      // Simple CSV parsing: split by newlines, then commas/semicolons
      const lines = text.split(/\r?\n/);
      const items = lines.flatMap(line => line.split(/[;,]/)).map(item => item.trim().replace(/^["']|["']$/g, ''));
      
      const matchedCountries = new Set<string>();
      items.forEach(item => {
        const match = allCountryNames.find(c => c.toLowerCase() === item.toLowerCase());
        if (match) matchedCountries.add(match);
      });

      matchedCountries.forEach(name => addCountry(name));
      
      // Reset input
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const filteredCountries = useMemo(() => {
    if (!countrySearch) return [];
    return allCountryNames
      .filter(name => 
        name.toLowerCase().includes(countrySearch.toLowerCase()) && 
        !selectedCountries.includes(name)
      )
      .slice(0, 8);
  }, [countrySearch, allCountryNames, selectedCountries]);

  return (
    <div 
      className={`fixed top-6 left-6 z-50 flex flex-col transition-all duration-500 cubic-bezier(0.4, 0, 0.2, 1) overflow-hidden rounded-xl bg-white border border-slate-200 w-[360px] ${
        isOpen 
          ? 'h-[calc(100vh-3rem)] shadow-[0_15px_40px_rgba(0,0,0,0.08)]' 
          : 'h-[72px] shadow-none'
      }`}
    >
      {/* Hidden File Input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleCsvUpload} 
        accept=".csv,text/csv" 
        className="hidden" 
      />

      {/* Header Section - Completely stable layout */}
      <div className="flex items-center gap-4 px-6 h-[72px] flex-shrink-0">
        <button 
          onClick={() => setIsOpen(!isOpen)}
          className="p-1.5 rounded-lg hover:bg-slate-50 transition-all active:scale-95 group focus:outline-none"
          aria-label="Toggle Navigation"
        >
          <div className="space-y-1 w-5">
            <div className={`h-[1px] bg-slate-800 transition-all duration-300 ${isOpen ? 'rotate-45 translate-y-[5px]' : 'w-full'}`} />
            <div className={`h-[1px] bg-slate-800 transition-all duration-300 ${isOpen ? 'opacity-0 scale-x-0' : 'w-full'}`} />
            <div className={`h-[1px] bg-slate-800 transition-all duration-300 ${isOpen ? '-rotate-45 -translate-y-[5px]' : 'w-2/3 group-hover:w-full'}`} />
          </div>
        </button>
        
        <h1 className="text-[22px] text-slate-800 tracking-tight font-light select-none whitespace-nowrap">
          Montran Global Map
        </h1>
      </div>

      {/* Tabs */}
      <div className={`flex border-b border-slate-100 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        {Object.values(SidebarTab).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-4 text-display-9 transition-all relative focus:outline-none ${
              activeTab === tab 
                ? 'text-[#009681] font-medium border-b-2 border-[#009681] bg-slate-50/50' 
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className={`flex-1 overflow-y-auto no-scrollbar transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="px-6 py-2">
          {activeTab === SidebarTab.OFFICES ? (
            <div className="space-y-1">
              {Object.entries(groupedOffices).map(([region, offices]: [string, MontranOffice[]]) => (
                offices.length > 0 && (
                  <div key={region} className="overflow-hidden">
                    <button 
                      onClick={() => toggleRegion(region)}
                      className="w-full flex items-center justify-between py-4 text-left group transition-all duration-300 border-b-2 border-slate-100"
                    >
                      <span className={`text-display-9 tracking-tight transition-colors group-hover:text-[#009681] ${
                        expandedRegions.includes(region) 
                        ? 'text-[#009681] font-medium' 
                        : 'text-slate-600'
                      }`}>
                        {region}
                      </span>
                      <svg 
                        className={`w-4 h-4 transition-all duration-300 group-hover:text-[#009681] ${
                          expandedRegions.includes(region) 
                          ? 'rotate-180 text-[#009681]' 
                          : 'text-slate-300'
                        }`} 
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/>
                      </svg>
                    </button>
                    
                    <div 
                      className={`space-y-1 overflow-hidden transition-all duration-300 ${expandedRegions.includes(region) ? 'max-h-[1000px] py-4' : 'max-h-0'}`}
                    >
                      {offices.map(office => (
                        <div 
                          key={office.id} 
                          className={`group cursor-pointer transition-all duration-200 py-2.5 px-3 rounded-xl flex items-start gap-4 ${
                            selectedOffices.includes(office.id) 
                            ? 'bg-slate-100' 
                            : 'bg-transparent hover:bg-slate-50'
                          }`}
                          onClick={() => toggleOffice(office.id)}
                        >
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 transition-all mt-2 ${selectedOffices.includes(office.id) ? 'bg-orange-500 scale-125 shadow-sm shadow-orange-500/30' : 'bg-slate-300 group-hover:bg-slate-400'}`} />
                          <div className="flex flex-col leading-snug">
                            <span className="text-[16px] text-slate-900 tracking-tight font-light">
                              {office.name}
                            </span>
                            <span className="text-[13px] text-slate-400 font-normal">
                              {office.city}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              ))}
            </div>
          ) : (
            <div className="text-left">
              <p className="text-display-9 tracking-tight text-slate-600 border-b-2 border-slate-100 py-4 mb-6">
                Territory Lookup
              </p>
              
              <div className="space-y-8">
                <div className="relative">
                  <input 
                    type="text" 
                    placeholder="Search countries..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-display-9 focus:ring-4 focus:ring-[#009681]/5 focus:border-[#009681] outline-none transition-all placeholder:text-slate-300 hover:bg-white focus:bg-white"
                    value={countrySearch}
                    onChange={(e) => setCountrySearch(e.target.value)}
                  />
                  {filteredCountries.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-3 bg-white border border-slate-100 rounded-xl shadow-2xl z-30 overflow-hidden">
                      {filteredCountries.map(name => (
                        <div 
                          key={name}
                          onClick={() => {
                            addCountry(name);
                            setCountrySearch('');
                          }}
                          className="px-5 py-4 text-display-9 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0 text-slate-700"
                        >
                          {name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {selectedCountries.map(name => (
                    <button 
                      key={name}
                      onClick={() => removeCountry(name)}
                      className="flex items-center gap-2 bg-[#009681] text-white border border-transparent px-4 py-2.5 rounded-full text-[16px] hover:bg-[#009681]/10 hover:text-[#009681] hover:border-[#009681]/20 transition-all group shadow-sm active:scale-95"
                    >
                      {name}
                      <svg className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer Button - Shared position and design */}
      <div className={`p-6 border-t border-slate-100 bg-white transition-all duration-300 ${isOpen ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0 pointer-events-none'}`}>
        {activeTab === SidebarTab.OFFICES ? (
          <button 
            onClick={handleToggleAllOffices}
            className="w-full py-5 bg-[#009681] text-white rounded-xl text-display-9 shadow-none hover:bg-[#007a69] transition-all active:scale-[0.98]"
          >
            {selectedOffices.length === MONTRAN_OFFICES.length ? 'Deselect All Offices' : 'Select All Offices'}
          </button>
        ) : (
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="w-full py-5 bg-[#009681] text-white rounded-xl text-display-9 shadow-none hover:bg-[#007a69] transition-all active:scale-[0.98]"
          >
            Upload CSV
          </button>
        )}
      </div>
    </div>
  );
};

export default Sidebar;