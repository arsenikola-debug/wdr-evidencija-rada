import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AuthProvider } from './lib/auth/AuthProvider';
import { DailyEntry } from './routes/DailyEntry';
import { Admin } from './routes/Admin';
import { Analytics } from './routes/Analytics';
import { ControlCenter } from './routes/ControlCenter';
import { CourierStops } from './routes/CourierStops';
import { FinanceCourierStops } from './routes/FinanceCourierStops';
import { FinanceHistory } from './routes/FinanceHistory';
import { AnalyticsCourierStops } from './routes/AnalyticsCourierStops';
import { EmployeeProfile } from './routes/EmployeeProfile';
import { Employees } from './routes/Employees';
import { FinanceAdjustments } from './routes/FinanceAdjustments';
import { FinanceQueue } from './routes/FinanceQueue';
import { MyAdjustments } from './routes/MyAdjustments';
import { FinanceSubmission } from './routes/FinanceSubmission';
import { Home } from './routes/Home';
import { Login } from './routes/Login';
import { MySubmissions } from './routes/MySubmissions';
import { NewPeriod } from './routes/NewPeriod';
import { Notifications } from './routes/Notifications';
import { Preview } from './routes/Preview';
import { RequireAuth } from './routes/RequireAuth';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Home />} />
          <Route
            path="/unos"
            element={
              <RequireAuth permission="entry.view">
                <DailyEntry />
              </RequireAuth>
            }
          />
          <Route
            path="/unos/novi"
            element={
              <RequireAuth permission="entry.view">
                <NewPeriod />
              </RequireAuth>
            }
          />
          <Route
            path="/unos/pregled"
            element={
              <RequireAuth permission="entry.view">
                <Preview />
              </RequireAuth>
            }
          />
          <Route
            path="/stopovi-kurira"
            element={
              <RequireAuth permission="courier_stops.view">
                <CourierStops />
              </RequireAuth>
            }
          />
          <Route
            path="/finansije"
            element={
              <RequireAuth permission="finance.queue.view">
                <FinanceQueue />
              </RequireAuth>
            }
          />
          <Route
            path="/finansije/prijava"
            element={
              <RequireAuth permission="finance.queue.view">
                <FinanceSubmission />
              </RequireAuth>
            }
          />
          <Route
            path="/analitika/stopovi-kurira"
            element={
              <RequireAuth permission="analytics.ba.view">
                <AnalyticsCourierStops />
              </RequireAuth>
            }
          />
          <Route
            path="/finansije/stopovi-kurira"
            element={
              <RequireAuth permission="finance.queue.view">
                <FinanceCourierStops />
              </RequireAuth>
            }
          />
          <Route
            path="/finansije/istorija"
            element={
              <RequireAuth permission="finance.history.view">
                <FinanceHistory />
              </RequireAuth>
            }
          />
          <Route
            path="/finansije/dodatni-zahtevi"
            element={
              <RequireAuth permission="adjustment.approve">
                <FinanceAdjustments />
              </RequireAuth>
            }
          />
          <Route
            path="/dodatni-zahtevi"
            element={
              <RequireAuth permission="adjustment.create">
                <MyAdjustments />
              </RequireAuth>
            }
          />
          <Route
            path="/administracija"
            element={
              <RequireAuth permission="centers.manage">
                <Admin />
              </RequireAuth>
            }
          />
          <Route
            path="/zaposleni"
            element={
              <RequireAuth permission="employee.view">
                <Employees mode="list" />
              </RequireAuth>
            }
          />
          <Route
            path="/zaposleni/novi"
            element={
              <RequireAuth permission="employee.create">
                <Employees mode="new" />
              </RequireAuth>
            }
          />
          <Route
            path="/zaposleni/:id"
            element={
              <RequireAuth permission="employee.view">
                <EmployeeProfile />
              </RequireAuth>
            }
          />
          <Route
            path="/analitika"
            element={
              <RequireAuth permission="analytics.ba.view">
                <Analytics section="pregled" />
              </RequireAuth>
            }
          />
          <Route
            path="/analitika/dnevno"
            element={
              <RequireAuth permission="analytics.ba.view">
                <Analytics section="dnevno" />
              </RequireAuth>
            }
          />
          <Route
            path="/analitika/zaposleni"
            element={
              <RequireAuth permission="analytics.ba.view">
                <Analytics section="zaposleni" />
              </RequireAuth>
            }
          />
          <Route
            path="/analitika/prevoz"
            element={
              <RequireAuth permission="analytics.ba.view">
                <Analytics section="prevoz" />
              </RequireAuth>
            }
          />
          <Route
            path="/kontrolni-centar"
            element={
              <RequireAuth permission="controls.view">
                <ControlCenter />
              </RequireAuth>
            }
          />
          <Route
            path="/moje-prijave"
            element={
              <RequireAuth permission="period.view_status">
                <MySubmissions />
              </RequireAuth>
            }
          />
          <Route
            path="/obavestenja"
            element={
              <RequireAuth permission="notification.view_own">
                <Notifications />
              </RequireAuth>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
