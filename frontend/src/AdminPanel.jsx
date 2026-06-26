import React, { useState, useEffect } from 'react';

export default function AdminPanel() {
  const [users, setUsers] = useState([]);
  const [apartments, setApartments] = useState([]);
  const [links, setLinks] = useState([]);
  const [settings, setSettings] = useState({ auto_delete_days: 2 });
  const [msg, setMsg] = useState('');

  // New apartment form
  const [newAptSection, setNewAptSection] = useState('');
  const [newAptNumber, setNewAptNumber] = useState('');

  // New user form
  const [newUserTgId, setNewUserTgId] = useState('');
  const [newUserName, setNewUserName] = useState('');

  // Link form
  const [linkUserId, setLinkUserId] = useState('');
  const [linkAptId, setLinkAptId] = useState('');

  const flash = (text) => {
    setMsg(text);
    setTimeout(() => setMsg(''), 3000);
  };

  const fetchAll = async () => {
    const [u, a, l, s] = await Promise.all([
      fetch('/api/users').then(r => r.json()),
      fetch('/api/apartments').then(r => r.json()),
      fetch('/api/user-apartments').then(r => r.json()),
      fetch('/api/settings').then(r => r.json()),
    ]);
    setUsers(u);
    setApartments(a);
    setLinks(l);
    setSettings(s);
  };

  useEffect(() => { fetchAll(); }, []);

  const handleAddApartment = async (e) => {
    e.preventDefault();
    const res = await fetch('/api/apartments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: newAptSection, number: newAptNumber })
    });
    const data = await res.json();
    if (data.success) {
      flash(`✅ Квартира ${newAptSection}/${newAptNumber} додана`);
      setNewAptSection(''); setNewAptNumber('');
      fetchAll();
    } else {
      flash(`❌ ${data.error}`);
    }
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramId: newUserTgId, name: newUserName })
    });
    const data = await res.json();
    if (data.success) {
      flash(`✅ Мешканець "${newUserName}" доданий`);
      setNewUserTgId(''); setNewUserName('');
      fetchAll();
    } else {
      flash(`❌ ${data.error}`);
    }
  };

  const handleLink = async (e) => {
    e.preventDefault();
    const res = await fetch('/api/user-apartments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: linkUserId, apartmentId: linkAptId })
    });
    const data = await res.json();
    if (data.success) {
      flash('✅ Зв\'язок створено');
      setLinkUserId(''); setLinkAptId('');
      fetchAll();
    } else {
      flash(`❌ ${data.error}`);
    }
  };

  const handleUnlink = async (userId, apartmentId) => {
    const res = await fetch('/api/user-apartments', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, apartmentId })
    });
    const data = await res.json();
    if (data.success) { flash('✅ Зв\'язок видалено'); fetchAll(); }
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    const data = await res.json();
    if (data.success) {
      flash('✅ Налаштування збережено');
      fetchAll();
    } else {
      flash(`❌ ${data.error}`);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.125rem', fontWeight: 700 }}>⚙️ Панель адміністрування системи</h2>
        {msg && (
          <div style={{
            background: msg.startsWith('✅') ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
            color: msg.startsWith('✅') ? '#10b981' : '#ef4444',
            padding: '0.4rem 0.9rem',
            borderRadius: 6,
            fontSize: '0.85rem',
            fontWeight: 600
          }}>{msg}</div>
        )}
      </div>

      <div className="admin-grid">
        {/* Квартири */}
        <div className="admin-card">
          <div className="admin-card-title">🏢 Квартири ({apartments.length})</div>
          <form className="admin-form" onSubmit={handleAddApartment}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <div className="form-group">
                <label className="form-label">Секція №</label>
                <input className="form-input" placeholder="Напр: 4" value={newAptSection}
                  onChange={e => setNewAptSection(e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label">Квартира №</label>
                <input className="form-input" placeholder="Напр: 125" value={newAptNumber}
                  onChange={e => setNewAptNumber(e.target.value)} required />
              </div>
            </div>
            <button type="submit" className="btn-submit">+ Додати квартиру</button>
          </form>
          <div className="admin-list-container">
            {apartments.map(a => (
              <div className="admin-list-item" key={a.id}>
                <span>{a.section}, кв. {a.number}</span>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>ID: {a.id}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Мешканці */}
        <div className="admin-card">
          <div className="admin-card-title">👤 Мешканці ({users.length})</div>
          <form className="admin-form" onSubmit={handleAddUser}>
            <div className="form-group">
              <label className="form-label">Telegram ID</label>
              <input className="form-input" placeholder="Напр: 123456789" value={newUserTgId}
                onChange={e => setNewUserTgId(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Ім'я мешканця</label>
              <input className="form-input" placeholder="Напр: Олексій Ткаченко" value={newUserName}
                onChange={e => setNewUserName(e.target.value)} required />
            </div>
            <button type="submit" className="btn-submit">+ Додати мешканця</button>
          </form>
          <div className="admin-list-container">
            {users.map(u => (
              <div className="admin-list-item" key={u.id}>
                <span>{u.name}</span>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>TG: {u.telegram_id}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Зв'язки мешканців з квартирами */}
        <div className="admin-card" style={{ gridColumn: 'span 2' }}>
          <div className="admin-card-title">🔗 Зв'язки мешканець ↔ квартира ({links.length})</div>
          <form className="admin-form" onSubmit={handleLink}
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.5rem', alignItems: 'end' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Мешканець</label>
              <select className="form-select" value={linkUserId} onChange={e => setLinkUserId(e.target.value)} required>
                <option value="">-- Оберіть мешканця --</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name} (TG: {u.telegram_id})</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Квартира</label>
              <select className="form-select" value={linkAptId} onChange={e => setLinkAptId(e.target.value)} required>
                <option value="">-- Оберіть квартиру --</option>
                {apartments.map(a => <option key={a.id} value={a.id}>{a.section}, кв. {a.number}</option>)}
              </select>
            </div>
            <button type="submit" className="btn-submit" style={{ whiteSpace: 'nowrap' }}>+ Зв'язати</button>
          </form>
          <div className="admin-list-container">
            {links.length === 0 && (
              <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                Немає зв'язків. Додайте мешканців та квартири, потім створіть зв'язок.
              </div>
            )}
            {links.map((l, i) => (
              <div className="admin-list-item" key={i}>
                <span>
                  <strong>{l.user_name}</strong>
                  <span style={{ color: 'var(--text-secondary)', marginLeft: 8 }}>→ {l.section}, кв. {l.number}</span>
                </span>
                <button className="btn-unlink" onClick={() => handleUnlink(l.user_id, l.apartment_id)}>
                  Відв'язати
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Налаштування системи */}
        <div className="admin-card" style={{ gridColumn: 'span 2' }}>
          <div className="admin-card-title">⚙️ Налаштування авто-очищення</div>
          <form className="admin-form" onSubmit={handleSaveSettings} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.5rem', alignItems: 'end' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Видаляти старі заявки через (днів)</label>
              <input 
                className="form-input" 
                type="number" 
                min="1" 
                max="365" 
                value={settings.auto_delete_days || 2} 
                onChange={e => setSettings({...settings, auto_delete_days: e.target.value})} 
                required 
              />
            </div>
            <button type="submit" className="btn-submit" style={{ whiteSpace: 'nowrap' }}>Зберегти</button>
          </form>
        </div>
      </div>
    </div>
  );
}
