import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api } from '../api';

const NAV = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/round', label: 'Round control' },
  { to: '/admin/live', label: 'Live monitoring' },
  { to: '/admin/teams', label: 'Teams' },
  { to: '/admin/puzzles', label: 'Puzzles' },
  { to: '/admin/qr', label: 'QR codes' },
  { to: '/admin/results', label: 'Results' },
  { to: '/admin/logs', label: 'Audit log' },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');

  useEffect(() => {
    api
      .get<{ username: string }>('/api/admin/me')
      .then((res) => setUsername(res.username))
      .catch(() => navigate('/admin/login', { replace: true }));
  }, [navigate]);

  function logout() {
    api.post('/api/admin/logout').finally(() => navigate('/admin/login', { replace: true }));
  }

  return (
    <div className="admin-shell">
      <header className="admin-top">
        <div className="row" style={{ gap: 12 }}>
          <span className="admin-brand">Endgame / Control</span>
          <span className="badge badge-quiet">Round 1 · The Mainframe</span>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <span className="badge">{username || 'admin'}</span>
          <button className="btn btn-sm" onClick={logout} type="button">
            Log out
          </button>
        </div>
      </header>
      <nav className="admin-nav">
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end}>
            {item.label}
          </NavLink>
        ))}
      </nav>
      <main className="admin-body">
        <Outlet />
      </main>
    </div>
  );
}
