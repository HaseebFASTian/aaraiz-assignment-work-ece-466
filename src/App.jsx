import { useEffect, useState } from 'react';
import { ChartNoAxesColumnIncreasing, CircleCheck, Clock3, FileText, Folder, Layers, LayoutGrid, Menu, RefreshCw, X } from 'lucide-react';
import Overview from './components/Overview.jsx';
import ModelDialog from './components/ModelDialog.jsx';
import Results from './components/Results.jsx';
import { Activity, Deliverables, Models, Requirements, Validation } from './components/Sections.jsx';
import { useResearchStatus } from './hooks/useResearchStatus.js';
import { NAVIGATION, allRuns, lastSync, utcTime } from './lib/data.js';

const NAV_ICONS = {overview: LayoutGrid, requirements: FileText, models: Layers, results: ChartNoAxesColumnIncreasing,
  validation: CircleCheck, activity: Clock3, files: Folder};
const validSection = () => {
  const value = window.location.hash.slice(1);
  if (value === 'deliverables') return 'files';
  return NAVIGATION.some(([id]) => id === value) ? value : 'overview';
};

export default function App() {
  const {snapshot, evidence, refreshing, refresh, stale, statusError, evidenceError} = useResearchStatus();
  const [section, setSection] = useState(validSection);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const liveSelected = allRuns(snapshot).find(run => run.id === selected?.id);
  const selectedRun = selected ? {...selected, ...liveSelected, config: {...selected.config, ...liveSelected?.config}} : null;
  const navigate = id => {
    window.location.hash = id; setSection(id); setMenuOpen(false);
    window.scrollTo({top: 0, behavior: 'instant'});
    document.getElementById('main-content')?.focus({preventScroll: true});
  };
  useEffect(() => {
    const update = () => {setSection(validSection()); setMenuOpen(false);};
    const close = event => {if (event.key === 'Escape') setMenuOpen(false);};
    window.addEventListener('hashchange', update); window.addEventListener('keydown', close);
    return () => {window.removeEventListener('hashchange', update); window.removeEventListener('keydown', close);};
  }, []);
  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={event => {
      event.preventDefault(); document.getElementById('main-content')?.focus();
    }}>Skip to main content</a>
    {menuOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <aside id="primary-navigation" className={`sidebar ${menuOpen ? 'is-open' : ''}`}>
      <a className="brand" href="#overview" aria-label="Aaraiz · overview" onClick={event => {event.preventDefault(); navigate('overview');}}>
        <img className="brand-portrait" src="/aaraiz-profile.png" alt="Aaraiz" width="80" height="80" />
      </a>
      <nav aria-label="Primary"><ul>{NAVIGATION.map(([id, title]) => {
        const Icon = NAV_ICONS[id];
        return <li key={id}><a href={`#${id}`} className={section === id ? 'active' : ''} aria-current={section === id ? 'page' : undefined}
          onClick={event => {event.preventDefault(); navigate(id);}}><Icon size={24} strokeWidth={1.8} aria-hidden="true" /><span>{title}</span></a></li>;
      })}</ul></nav>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <div className="header-title"><button className="icon-button mobile-menu" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={menuOpen} aria-controls="primary-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
          <div><h1>ECE 466 · Homework 6</h1><p>Aaraiz · Deep learning experiments</p></div></div>
        <div className="topbar-actions"><span className={`connection-state ${stale || !snapshot ? 'offline' : ''}`}>
          <span className="connection-dot" aria-hidden="true" />Live feed: {!snapshot ? 'Connecting' : stale ? 'Delayed' : 'Active'}</span>
          <button className="refresh-button" onClick={refresh} disabled={refreshing} aria-label="Refresh experiment data">
            <RefreshCw size={19} className={refreshing ? 'refreshing' : ''} aria-hidden="true" /><span>Refresh</span></button></div>
      </header>
      <main id="main-content" tabIndex="-1">
        {((stale && snapshot) || statusError) && <div className="notice" role="status">{snapshot
          ? 'The feed is delayed. These are the last observed readings; training completion has not been inferred.'
          : 'The live feed is unavailable. Reviewed results remain available; new progress awaits a verified snapshot.'}</div>}
        {snapshot?.failure && <div className="notice failure-notice" role="status">An experiment needs attention.
          <button onClick={() => navigate('activity')}>View activity</button></div>}
        {evidenceError && <div className="notice" role="status">Reviewed evidence could not be refreshed. Previously loaded evidence is retained.</div>}
        {section === 'overview' && <Overview snapshot={snapshot} evidence={evidence} stale={stale} onSelect={setSelected} onNavigate={navigate} />}
        {section === 'requirements' && <Requirements evidence={evidence} />}
        {section === 'models' && <Models snapshot={snapshot} evidence={evidence} onSelect={setSelected} onNavigate={navigate} />}
        {section === 'results' && <Results snapshot={snapshot} evidence={evidence} onSelect={setSelected} />}
        {section === 'validation' && <Validation evidence={evidence} />}
        {section === 'activity' && <Activity snapshot={snapshot} stale={stale} />}
        {section === 'files' && <Deliverables evidence={evidence} />}
        <footer className="main-footer"><span>ECE 466 · Measured results and recorded progress</span><span>Last sync: {utcTime(lastSync(snapshot))}</span></footer>
      </main>
    </div>
    {selectedRun && <ModelDialog key={selectedRun.id} run={selectedRun} onClose={() => setSelected(null)} />}
  </div>;
}
