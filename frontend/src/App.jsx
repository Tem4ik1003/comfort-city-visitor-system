import React, { useState, useEffect } from 'react';
import AdminPanel from './AdminPanel.jsx';

// Допоміжна функція для парсингу дати з SQLite
const parseSqlDate = (dateStr) => {
  if (!dateStr) return null;
  return new Date(dateStr.includes('Z') ? dateStr : dateStr.replace(' ', 'T') + 'Z');
};

// Словники для перекладу типів гостей та часу
const visitorTypes = {
  courier: "🛵 Кур'єр / Доставка",
  guest: '👥 Гість',
  master: '🛠️ Майстер',
  nanny: '👶 Няня',
  other: '❓ Інше'
};

const visitTimes = {
  now: 'Зараз / протягом години',
  today: 'Сьогодні',
  tomorrow: 'Завтра',
  custom: 'Особливий час'
};

function App() {
  const [visits, setVisits] = useState([]);
  const [apartments, setApartments] = useState([]);
  const [newVisitIds, setNewVisitIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  
  // Фільтри та навігація
  const [activeTab, setActiveTab] = useState('dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSection, setSelectedSection] = useState('all');

  // Роль користувача: 'guard' | 'section_admin' | 'sys_admin'
  const [currentRole, setCurrentRole] = useState('guard');

  // Модалка ручного пропуску
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [manualAptId, setManualAptId] = useState('');
  const [manualType, setManualType] = useState('guest');
  const [manualName, setManualName] = useState('');

  // Для живого оновлення тривалості перебування всередині
  const [timeTick, setTimeTick] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeTick(Date.now());
    }, 30000); // Оновлюємо кожні 30 секунд
    return () => clearInterval(interval);
  }, []);

  // Завантаження заявок з API
  const fetchVisits = async () => {
    try {
      const response = await fetch('/api/visits');
      const data = await response.json();
      
      // Визначаємо нові ID для підсвічування
      if (visits.length > 0) {
        const currentIds = new Set(visits.map(v => v.id));
        const newIds = new Set();
        data.forEach(v => {
          if (!currentIds.has(v.id)) {
            newIds.add(v.id);
          }
        });
        
        if (newIds.size > 0) {
          setNewVisitIds(prev => {
            const updated = new Set(prev);
            newIds.forEach(id => updated.add(id));
            return updated;
          });
          
          setTimeout(() => {
            setNewVisitIds(prev => {
              const updated = new Set(prev);
              newIds.forEach(id => updated.delete(id));
              return updated;
            });
          }, 6000);
        }
      }
      
      setVisits(data);
      setLoading(false);
    } catch (error) {
      console.error('Помилка завантаження заявок:', error);
      setLoading(false);
    }
  };

  // Завантаження квартир для ручного пропуску
  const fetchApartments = async () => {
    try {
      const response = await fetch('/api/apartments');
      const data = await response.json();
      setApartments(data);
    } catch (error) {
      console.error('Помилка завантаження квартир:', error);
    }
  };

  useEffect(() => {
    fetchVisits();
    fetchApartments();

    // Реал-тайм підписка через SSE
    const eventSource = new EventSource('/api/visits/events');
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.update) {
        fetchVisits();
      }
    };

    eventSource.onerror = (error) => {
      console.error('SSE помилка підключення:', error);
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, []);

  // Оновлення статусу (Вхід / Вихід / Відхилити)
  const handleStatusUpdate = async (id, status) => {
    try {
      const response = await fetch(`/api/visits/${id}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status })
      });
      if (response.ok) {
        fetchVisits();
      }
    } catch (error) {
      console.error('Помилка оновлення статусу:', error);
    }
  };

  // Створення ручного пропуску
  const handleCreateManualPass = async (e) => {
    e.preventDefault();
    if (!manualAptId || !manualName) return;

    try {
      const response = await fetch('/api/visits/manual', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          apartmentId: manualAptId,
          visitorType: manualType,
          visitorName: manualName
        })
      });

      if (response.ok) {
        setIsManualModalOpen(false);
        setManualAptId('');
        setManualName('');
        setManualType('guest');
        fetchVisits();
      }
    } catch (error) {
      console.error('Помилка створення ручного пропуску:', error);
    }
  };

  // Розрахунок часу перебування всередині
  const formatTimeInside = (resolvedAt) => {
    if (!resolvedAt) return { text: '—', isLong: false };
    const entry = parseSqlDate(resolvedAt).getTime();
    const now = timeTick;
    const diffMs = now - entry;
    
    if (diffMs < 0) return { text: '0 хв', isLong: false };
    
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    
    const isLong = diffHours >= 3; // підсвічувати жовтим/червоним більше 3 годин

    if (diffHours > 0) {
      return { text: `${diffHours} год ${mins} хв`, isLong };
    }
    return { text: `${mins} хв`, isLong };
  };

  // Форматування дати створення
  const formatTime = (isoString) => {
    if (!isoString) return '';
    return parseSqlDate(isoString).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  };

  // Статистика (сьогодні)
  const todayVisits = visits.filter(v => {
    const today = new Date().toDateString();
    return parseSqlDate(v.created_at).toDateString() === today;
  });

  const stats = {
    pending: visits.filter(v => v.status === 'pending').length,
    inside: visits.filter(v => v.status === 'inside').length,
    manualToday: todayVisits.filter(v => v.is_manual === 1).length
  };

  // Фільтрація заявок на основі пошуку та секції
  const getFilteredVisits = (statusFilter = null) => {
    return visits.filter(v => {
      // 1. Фільтрація по статусу
      if (statusFilter === 'pending' && v.status !== 'pending') return false;
      if (statusFilter === 'inside' && v.status !== 'inside') return false;
      if (statusFilter === 'history' && !['completed', 'cancelled', 'rejected'].includes(v.status)) return false;

      // 2. Фільтрація по секції
      if (selectedSection !== 'all' && v.section !== `Секція ${selectedSection}`) return false;

      // 3. Пошук
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesName = v.visitor_name?.toLowerCase().includes(query);
        const matchesSection = v.section?.toLowerCase().includes(query);
        const matchesNumber = v.number?.toLowerCase().includes(query);
        const matchesType = (visitorTypes[v.visitor_type] || '').toLowerCase().includes(query);
        
        return matchesName || matchesSection || matchesNumber || matchesType;
      }

      return true;
    });
  };

  // Розділення списків для головного дашборду
  const expectedVisits = getFilteredVisits('pending');
  const insideVisitors = getFilteredVisits('inside');

  return (
    <div className="app-layout">
      {/* Ліва панель навігації */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-logo">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <span className="sidebar-brand-text">Comfort City</span>
        </div>

        <ul className="sidebar-menu">
          <li>
            <a 
              className={`sidebar-item ${activeTab === 'dashboard' ? 'active' : ''}`}
              onClick={() => { setActiveTab('dashboard'); }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="9" />
                <rect x="14" y="3" width="7" height="5" />
                <rect x="14" y="12" width="7" height="9" />
                <rect x="3" y="16" width="7" height="5" />
              </svg>
              Пульт охорони
            </a>
          </li>
          {/* ТИМЧАСОВО ПРИХОВАНО
          <li>
            <a 
              className={`sidebar-item ${activeTab === 'expected' ? 'active' : ''}`}
              onClick={() => { setActiveTab('expected'); }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              Очікувані заявки
            </a>
          </li>
          <li>
            <a 
              className={`sidebar-item ${activeTab === 'inside' ? 'active' : ''}`}
              onClick={() => { setActiveTab('inside'); }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              Активні всередині
            </a>
          </li>
          */}
          {/* ТИМЧАСОВО ПРИХОВАНО
          <li>
            <a 
              className="sidebar-item"
              onClick={() => setIsManualModalOpen(true)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="11" x2="16" y2="11" />
              </svg>
              Ручний пропуск
            </a>
          </li>
          <li>
            <a 
              className={`sidebar-item ${activeTab === 'history' ? 'active' : ''}`}
              onClick={() => { setActiveTab('history'); }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              Історія подій
            </a>
          </li>
          */}
          <li>
            <a 
              className="sidebar-item"
              onClick={() => {
                const searchEl = document.querySelector('.search-input');
                if (searchEl) searchEl.focus();
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              Пошук
            </a>
          </li>
          <li>
            <a 
              className={`sidebar-item ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => { setActiveTab('settings'); }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Налаштування
            </a>
          </li>
        </ul>

        <div className="sidebar-footer">
          <div className="sidebar-avatar">
            {currentRole === 'guard' ? 'S1' : currentRole === 'section_admin' ? 'SA' : 'TA'}
          </div>
          <div className="sidebar-user-info">
            <span className="sidebar-user-name">
              {currentRole === 'guard' ? 'Security 01' : currentRole === 'section_admin' ? 'Admin Section' : 'Tech Admin'}
            </span>
            <select
              className="sidebar-role-select"
              value={currentRole}
              onChange={e => setCurrentRole(e.target.value)}
            >
              <option value="guard">🛡️ Охоронець</option>
              <option value="section_admin">📋 Адмін секції</option>
              <option value="sys_admin">⚙️ Тех. адміністратор</option>
            </select>
          </div>
        </div>
      </aside>

      {/* Основний вміст сторінки */}
      <main className="main-content">
        
        {/* Верхня панель управління */}
        <header className="top-bar">
          <div className="top-bar-left">
            <div className="search-container">
              <span className="search-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </span>
              <input 
                type="text" 
                placeholder="Пошук: квартира, ім'я, компанія, коментар..." 
                className="search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            
            <div className="section-filter">
              <span className="section-filter-label">Секція:</span>
              <div className="section-filter-scroll">
                <button
                  className={`section-btn ${selectedSection === 'all' ? 'active' : ''}`}
                  onClick={() => setSelectedSection('all')}
                >
                  Всі
                </button>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(num => (
                  <button
                    key={num}
                    className={`section-btn ${selectedSection === num.toString() ? 'active' : ''}`}
                    onClick={() => setSelectedSection(num.toString())}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="top-bar-right">
            {/* Карточки лічильників */}
            <div className="stat-badge stat-pending">
              <div className="stat-badge-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <div className="stat-badge-content">
                <span className="stat-badge-title">Очікують</span>
                <span className="stat-badge-value">{stats.pending}</span>
              </div>
            </div>

            <div className="stat-badge stat-inside">
              <div className="stat-badge-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                </svg>
              </div>
              <div className="stat-badge-content">
                <span className="stat-badge-title">Всередині</span>
                <span className="stat-badge-value">{stats.inside}</span>
              </div>
            </div>

            <div className="stat-badge stat-manual">
              <div className="stat-badge-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              </div>
              <div className="stat-badge-content">
                <span className="stat-badge-title">Ручні сьогодні</span>
                <span className="stat-badge-value">{stats.manualToday}</span>
              </div>
            </div>

            <button className="btn-icon-only" onClick={fetchVisits} title="Оновити дані">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
          </div>
        </header>

        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            Завантаження даних...
          </div>
        ) : (
          <>
            {/* ТАБ 1: Головний пульт охорони */}
            {activeTab === 'dashboard' && (
              <div className="dashboard-grid">
                
                {/* 1. Очікувані заявки */}
                <section className="dashboard-panel">
                  <div className="panel-header">
                    <h2 className="panel-title">Очікувані заявки</h2>
                  </div>
                  
                  <div className="table-container">
                    {expectedVisits.length === 0 ? (
                      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                        Немає очікуваних заявок.
                      </div>
                    ) : (
                      <table className="dashboard-table">
                        <thead>
                          <tr>
                            <th>Час</th>
                            <th>Сек.</th>
                            <th>Кв.</th>
                            <th>Тип</th>
                            <th>Статус / Дія</th>
                          </tr>
                        </thead>
                        <tbody>
                          {expectedVisits.map(visit => {
                            const isNew = newVisitIds.has(visit.id);
                            return (
                              <tr
                                key={visit.id}
                                style={isNew ? { backgroundColor: 'rgba(16, 185, 129, 0.05)' } : {}}
                              >
                                <td style={{ whiteSpace: 'nowrap' }}>{formatTime(visit.created_at)}</td>
                                <td style={{ fontWeight: '700', textAlign: 'center' }}>{visit.section?.replace('Секція ', '')}</td>
                                <td style={{ fontWeight: '700', textAlign: 'center' }}>{visit.number}</td>
                                <td style={{ fontSize: '0.75rem' }} title={visitorTypes[visit.visitor_type]}>
                                  {visit.visitor_type === 'courier' ? '🛵' :
                                   visit.visitor_type === 'guest'   ? '👥' :
                                   visit.visitor_type === 'master'  ? '🛠️' :
                                   visit.visitor_type === 'nanny'   ? '👶' : '❓'}
                                  {' '}{visit.visitor_name}
                                </td>
                                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                                  {currentRole === 'guard' ? (
                                    <button
                                      className="btn-action-in"
                                      onClick={() => handleStatusUpdate(visit.id, 'inside')}
                                    >
                                      Вхід
                                    </button>
                                  ) : (
                                    <span className="badge badge-pending">⏳</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                  
                  <div className="panel-footer">
                    <a className="panel-link" onClick={() => setActiveTab('expected')}>Показати всі</a>
                  </div>
                </section>

                {/* 2. Активні відвідувачі всередині */}
                <section className="dashboard-panel">
                  <div className="panel-header">
                    <h2 className="panel-title">Активні відвідувачі всередині</h2>
                  </div>

                  <div className="table-container">
                    {insideVisitors.length === 0 ? (
                      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                        Нікого немає всередині.
                      </div>
                    ) : (
                      <table className="dashboard-table">
                        <thead>
                          <tr>
                            <th>Вхід</th>
                            <th>Сек.</th>
                            <th>Кв.</th>
                            <th>Ім'я / Тип</th>
                            <th>Всередині</th>
                            <th style={{ textAlign: 'right' }}>Дія</th>
                          </tr>
                        </thead>
                        <tbody>
                          {insideVisitors.map(visit => {
                            const duration = formatTimeInside(visit.resolved_at);
                            return (
                              <tr
                                key={visit.id}
                                className={duration.isLong ? 'row-warning' : ''}
                              >
                                <td style={{ whiteSpace: 'nowrap' }}>{formatTime(visit.resolved_at)}</td>
                                <td style={{ fontWeight: '700', textAlign: 'center' }}>{visit.section?.replace('Секція ', '')}</td>
                                <td style={{ fontWeight: '700', textAlign: 'center' }}>{visit.number}</td>
                                <td style={{ fontSize: '0.8rem' }}>
                                  {visit.visitor_type === 'courier' ? '🛵' :
                                   visit.visitor_type === 'guest'   ? '👥' :
                                   visit.visitor_type === 'master'  ? '🛠️' :
                                   visit.visitor_type === 'nanny'   ? '👶' : '❓'}
                                  {' '}{visit.visitor_name}
                                </td>
                                <td className={duration.isLong ? 'text-danger-bold' : ''} style={{ whiteSpace: 'nowrap' }}>
                                  {duration.text}
                                </td>
                                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                                  {currentRole === 'guard' ? (
                                    <button
                                      className="btn-action-out"
                                      onClick={() => handleStatusUpdate(visit.id, 'completed')}
                                    >
                                      Вихід
                                    </button>
                                  ) : (
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>🔒</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>

                  <div className="panel-footer">
                    <a className="panel-link" onClick={() => setActiveTab('inside')}>Показати всі</a>
                  </div>
                </section>

                {/* 3. Ручний пропуск */}
                <section className="dashboard-panel">
                  <div className="panel-header">
                    <h2 className="panel-title">Ручний пропуск</h2>
                  </div>
                  <div className="manual-pass-card manual-pass-card--compact">
                    <div className="manual-pass-icon">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <line x1="19" y1="8" x2="19" y2="14" />
                        <line x1="22" y1="11" x2="16" y2="11" />
                      </svg>
                    </div>
                    <p className="manual-pass-text">Створити ручний пропуск для гостя без заявки</p>
                    {currentRole === 'guard' ? (
                      <button className="btn-manual-create" onClick={() => setIsManualModalOpen(true)}>Створити</button>
                    ) : (
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', padding: '0.5rem', background: '#f8fafc', borderRadius: 6 }}>
                        🔒 Недоступно для цієї ролі
                      </div>
                    )}
                  </div>
                </section>

              </div>
            )}

            {/* ТАБ 2: Очікувані заявки (повний список) */}
            {activeTab === 'expected' && (
              <section className="dashboard-panel">
                <div className="panel-header">
                  <h2 className="panel-title">Очікувані заявки (Повний список)</h2>
                </div>
                <div className="table-container">
                  <table className="dashboard-table">
                    <thead>
                      <tr>
                        <th>Час</th>
                        <th>Секція</th>
                        <th>Кв.</th>
                        <th>Тип</th>
                        <th>Опис</th>
                        <th>Статус</th>
                        <th style={{ textAlign: 'right' }}>Дія</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expectedVisits.map(visit => (
                        <tr key={visit.id}>
                          <td>{formatTime(visit.created_at)}</td>
                          <td style={{ fontWeight: '600' }}>{visit.section}</td>
                          <td style={{ fontWeight: '600' }}>{visit.number}</td>
                          <td>{visitorTypes[visit.visitor_type] || visit.visitor_type}</td>
                          <td style={{ fontWeight: '500' }}>{visit.visitor_name}</td>
                          <td><span className="badge badge-pending">⏳ Очікує</span></td>
                          <td style={{ textAlign: 'right' }}>
                            <button 
                              className="btn-action-in"
                              onClick={() => handleStatusUpdate(visit.id, 'inside')}
                            >
                              Вхід
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* ТАБ 3: Активні всередині (повний список) */}
            {activeTab === 'inside' && (
              <section className="dashboard-panel">
                <div className="panel-header">
                  <h2 className="panel-title">Активні всередині (Повний список)</h2>
                </div>
                <div className="table-container">
                  <table className="dashboard-table">
                    <thead>
                      <tr>
                        <th>Вхід</th>
                        <th>Секція</th>
                        <th>Кв.</th>
                        <th>Тип</th>
                        <th>Опис</th>
                        <th>Час всередині</th>
                        <th style={{ textAlign: 'right' }}>Дія</th>
                      </tr>
                    </thead>
                    <tbody>
                      {insideVisitors.map(visit => {
                        const duration = formatTimeInside(visit.resolved_at);
                        return (
                          <tr key={visit.id} className={duration.isLong ? 'row-warning' : ''}>
                            <td>{formatTime(visit.resolved_at)}</td>
                            <td style={{ fontWeight: '600' }}>{visit.section}</td>
                            <td style={{ fontWeight: '600' }}>{visit.number}</td>
                            <td>{visitorTypes[visit.visitor_type] || visit.visitor_type}</td>
                            <td style={{ fontWeight: '500' }}>{visit.visitor_name}</td>
                            <td className={duration.isLong ? 'text-danger-bold' : ''}>{duration.text}</td>
                            <td style={{ textAlign: 'right' }}>
                              <button 
                                className="btn-action-out"
                                onClick={() => handleStatusUpdate(visit.id, 'completed')}
                              >
                                Вихід
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* ТАБ 4: Історія подій */}
            {activeTab === 'history' && (
              <section className="dashboard-panel">
                <div className="panel-header">
                  <h2 className="panel-title">Історія подій (останні 50)</h2>
                </div>
                <div className="table-container">
                  <table className="dashboard-table">
                    <thead>
                      <tr>
                        <th>Створено</th>
                        <th>Закрито</th>
                        <th>Секція</th>
                        <th>Кв.</th>
                        <th>Тип</th>
                        <th>Опис</th>
                        <th>Тип пропуску</th>
                        <th>Статус</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getFilteredVisits('history').slice(0, 50).map(visit => (
                        <tr key={visit.id}>
                          <td>{parseSqlDate(visit.created_at).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' })}</td>
                          <td>{visit.resolved_at ? parseSqlDate(visit.resolved_at).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
                          <td style={{ fontWeight: '600' }}>{visit.section}</td>
                          <td style={{ fontWeight: '600' }}>{visit.number}</td>
                          <td>{visitorTypes[visit.visitor_type] || visit.visitor_type}</td>
                          <td style={{ fontWeight: '500' }}>{visit.visitor_name}</td>
                          <td>{visit.is_manual ? '⚠️ Ручний' : '📱 Бот'}</td>
                          <td>
                            {visit.status === 'completed' && <span className="badge badge-approved">✅ Вийшов</span>}
                            {visit.status === 'rejected' && <span className="badge badge-rejected">❌ Відхилено</span>}
                            {visit.status === 'cancelled' && <span className="badge badge-cancelled">❌ Скасовано</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* ТАБ 5: Налаштування */}
            {activeTab === 'settings' && (
              <section className="dashboard-panel" style={{ padding: '2rem' }}>
                {currentRole === 'sys_admin' ? (
                  <AdminPanel />
                ) : (
                  <>
                    <h2 className="panel-title" style={{ marginBottom: '1rem' }}>Налаштування системи охорони</h2>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                      Система підключена до бази даних <code>safehome.db</code>.
                      Бекенд запущено на порті 5001.
                    </p>
                    <div style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '0.75rem 1rem', fontSize: '0.85rem', color: 'var(--color-red)' }}>
                      🔒 Повна панель адміністрування доступна тільки для <strong>Технічного адміністратора</strong>.
                    </div>
                  </>
                )}
              </section>
            )}
          </>
        )}
      </main>

      {/* Модальне вікно створення ручного пропуску */}
      {isManualModalOpen && (
        <div className="modal-overlay">
          <div className="modal-container">
            <div className="modal-header">
              <h3 className="modal-title">Новий ручний пропуск</h3>
              <button className="modal-close" onClick={() => setIsManualModalOpen(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            
            <form onSubmit={handleCreateManualPass}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Квартира отримувача</label>
                  <select 
                    className="form-select" 
                    value={manualAptId} 
                    onChange={e => setManualAptId(e.target.value)}
                    required
                  >
                    <option value="">-- Оберіть квартиру --</option>
                    {apartments.map(apt => (
                      <option key={apt.id} value={apt.id}>
                        {apt.section}, кв. {apt.number}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Тип гостя</label>
                  <select 
                    className="form-select" 
                    value={manualType} 
                    onChange={e => setManualType(e.target.value)}
                  >
                    <option value="guest">Гість</option>
                    <option value="courier">Кур'єр / Доставка</option>
                    <option value="master">Майстер</option>
                    <option value="nanny">Нняня</option>
                    <option value="other">Інше</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Ім'я або опис відвідувача</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="Наприклад: Сантехнік Василь"
                    value={manualName}
                    onChange={e => setManualName(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-cancel" onClick={() => setIsManualModalOpen(false)}>
                  Скасувати
                </button>
                <button type="submit" className="btn-submit">
                  Створити перепустку
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
