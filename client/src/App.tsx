import { Navigate, Route, Routes } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import type { ParticipantPayload } from './types';
import JoinPage from './pages/JoinPage';
import PlayPage from './pages/PlayPage';
import ResultsPage from './pages/ResultsPage';
import TermsPage from './pages/TermsPage';
import GatePage from './pages/GatePage';
import AdminLoginPage from './admin/AdminLoginPage';
import AdminLayout from './admin/AdminLayout';
import AdminDashboard from './admin/AdminDashboard';
import AdminTeams from './admin/AdminTeams';
import AdminPuzzles from './admin/AdminPuzzles';
import AdminQr from './admin/AdminQr';
import AdminRound from './admin/AdminRound';
import AdminLive from './admin/AdminLive';
import AdminResults from './admin/AdminResults';
import AdminLogs from './admin/AdminLogs';
import NotFound from './pages/NotFound';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<GatePage />} />
      <Route path="/join/team/:teamToken" element={<JoinPage />} />
      <Route path="/play" element={<PlayPage />} />
      <Route path="/results" element={<ResultsPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route
        path="/admin"
        element={
          <AdminGuard>
            <AdminLayout />
          </AdminGuard>
        }
      >
        <Route index element={<AdminDashboard />} />
        <Route path="teams" element={<AdminTeams />} />
        <Route path="puzzles" element={<AdminPuzzles />} />
        <Route path="qr" element={<AdminQr />} />
        <Route path="round" element={<AdminRound />} />
        <Route path="live" element={<AdminLive />} />
        <Route path="results" element={<AdminResults />} />
        <Route path="logs" element={<AdminLogs />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'checking' | 'ok' | 'no'>('checking');

  useEffect(() => {
    let alive = true;
    api
      .get('/api/admin/me')
      .then(() => alive && setState('ok'))
      .catch((err: ApiError) => {
        if (!alive) return;
        setState(err.status === 401 ? 'no' : 'no');
      });
    return () => {
      alive = false;
    };
  }, []);

  if (state === 'checking') return <div className="page-center muted">Checking administrator session…</div>;
  if (state === 'no') return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
}

export type { ParticipantPayload };
