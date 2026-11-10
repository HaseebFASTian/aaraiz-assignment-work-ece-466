import { useEffect, useState } from 'react';
import { ChartNoAxesColumnIncreasing, Check, ClipboardCheck, Clock3, FileText, Folder, Home, Menu, RefreshCw, Server, ShieldCheck, X } from 'lucide-react';
import Overview from './components/Overview.jsx';
import ModelDialog from './components/ModelDialog.jsx';
import { Activity, Deliverables, Models, Requirements, Validation } from './components/Sections.jsx';
import { useResearchStatus } from './hooks/useResearchStatus.js';
import { NAVIGATION, allRuns, isComplete, lastSync, number, stateInfo, utcTime } from './lib/data.js';

const NAV_ICONS = {overview: Home, requirements: FileText, models: ChartNoAxesColumnIncreasing,
  validation: ShieldCheck, activity: Server, deliverables: Folder};
const validSection = () => NAVIGATION.some(([id]) => id === window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'overview';

export default function App() {
  const {snapshot, evidence, refreshing, refresh, stale, statusError, evidenceError} = useResearchStatus();
  const [section, setSection] = useState(validSection);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const runs = allRuns(snapshot);
  const selectedRun = runs.find(run => run.id === selectedId);
  const complete = runs.filter(isComplete).length;
  const running = runs.filter(run => stateInfo(run).tone === 'running').length;
  const attention = snapshot?.failure || runs.some(run => stateInfo(run).tone === 'failed');
  const heading = !snapshot ? 'Sequence learning, awaiting data.' : stale ? 'Sequence learning, awaiting update.'
    : attention ? 'Sequence learning, needs attention.' : complete === 8 ? evidence?.readiness?.ready
      ? 'Sequence learning, complete.' : 'Training complete; final review pending.' : 'Sequence learning, in progress.';
  const navigate = id => {
    window.location.hash = id; setSection(id); setMenuOpen(false);
    window.scrollTo({top: 0, behavior: 'instant'});
    document.getElementById('main-content')?.focus({preventScroll: true});
  };
  useEffect(() => {
    const update = () => {setSection(validSection()); setMenuOpen(false);};
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    const close = event => {if (event.key === 'Escape') setMenuOpen(false);};
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);
  const onSelect = run => setSelectedId(run.id);
  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={event => {
      event.preventDefault(); document.getElementById('main-content')?.focus();
    }}>Skip to main content</a>
    {menuOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <aside id="primary-navigation" className={`sidebar ${menuOpen ? 'is-open' : ''}`}>
      <a className="brand" href="#overview" onClick={event => {event.preventDefault(); navigate('overview');}}>
        <img className="brand-portrait" src="/aaraiz-profile.png" alt="Aaraiz" width="48" height="48" />
        <span><strong>Aaraiz</strong><small>Experiment notebook</small></span>
      </a>
      <nav aria-label="Primary"><ul>{NAVIGATION.map(([id, title]) => {
        const Icon = NAV_ICONS[id];
        return <li key={id}><a href={`#${id}`} className={section === id ? 'active' : ''} aria-current={section === id ? 'page' : undefined}
          onClick={event => {event.preventDefault(); navigate(id);}}><Icon size={23} strokeWidth={1.8} aria-hidden="true" /><span>{title}</span></a></li>;
      })}</ul></nav>
      <div className="sidebar-footer"><strong>Homework 6</strong><span>ECE 466</span></div>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <div className="breadcrumb"><button className="icon-button mobile-menu" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={menuOpen} aria-controls="primary-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
          <span>Deep Learning <span className="breadcrumb-divider">/</span> <strong>HW6</strong></span></div>
        <div className="topbar-actions"><span className={`connection-state ${stale || !snapshot ? 'offline' : ''}`}>
          <span className="connection-dot" aria-hidden="true" />{!snapshot ? 'Connecting' : stale ? 'Feed needs update' : 'Live server feed'}</span>
          <button className="outline-button refresh-button" onClick={refresh} disabled={refreshing} aria-label="Refresh experiment data">
            <RefreshCw size={18} strokeWidth={1.8} className={refreshing ? 'refreshing' : ''} aria-hidden="true" /><span>Refresh</span></button></div>
      </header>
      <main id="main-content" tabIndex="-1">
        <section className="hero" aria-label="Assignment overview"><h1>ECE 466 · Homework 6</h1><p className="hero-status">{heading}</p>
          <p className="hero-description">Sentiment analysis and image captioning · ECE 466</p></section>
        <div className="summary-band" aria-label="Experiment summary">
          <div><Check aria-hidden="true" /><span><strong>{snapshot ? complete : '—'} / 8</strong> runs complete</span></div>
          <div className={running ? 'running' : ''}><span className={`activity-ring ${running && !stale ? 'is-active' : ''}`} aria-hidden="true" />
            <span><strong>{snapshot ? running : '—'} {running === 1 ? 'running' : 'running'}</strong></span></div>
          <div><ClipboardCheck aria-hidden="true" /><span><strong>{number(evidence?.verification?.tests_passed)}</strong> checks passed</span></div>
          <div><Clock3 aria-hidden="true" /><span>Last sync: <strong className="normal-weight">{utcTime(lastSync(snapshot))}</strong></span></div>
        </div>
        {((stale && snapshot) || statusError) && <div className="notice" role="status">{snapshot
          ? 'The live feed is delayed. Values below are the last observed snapshot; training completion has not been inferred.'
          : 'The live feed is unavailable. Experiment readings will appear when a verified snapshot arrives.'}</div>}
        {evidenceError && <div className="notice" role="status">Reviewed evidence could not be refreshed. Previously loaded evidence is retained.</div>}
        {section === 'overview' && <Overview snapshot={snapshot} evidence={evidence} onSelect={onSelect} onNavigate={navigate} />}
        {section === 'requirements' && <Requirements evidence={evidence} />}
        {section === 'models' && <Models snapshot={snapshot} onSelect={onSelect} />}
        {section === 'validation' && <Validation evidence={evidence} />}
        {section === 'activity' && <Activity snapshot={snapshot} stale={stale} />}
        {section === 'deliverables' && <Deliverables evidence={evidence} />}
        <footer className="main-footer"><span>ECE 466 · Experiment notebook</span><span>Measured results. Recorded progress.</span></footer>
      </main>
    </div>
    {selectedRun && <ModelDialog key={selectedRun.id} run={selectedRun} onClose={() => setSelectedId(null)} />}
  </div>;
}
