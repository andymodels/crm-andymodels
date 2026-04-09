import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import PublicCadastroModelo from './PublicCadastroModelo.jsx'
import PublicCadastroCliente from './PublicCadastroCliente.jsx'
import AuthGate from './AuthGate.jsx'
import ModeloExtratoPortal from './ModeloExtratoPortal.jsx'
import ContratoAssinaturaPublica from './ContratoAssinaturaPublica.jsx'
import PublicAgendaConfirmacao from './PublicAgendaConfirmacao.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/cadastro-modelo" element={<PublicCadastroModelo />} />
        <Route path="/cadastro-cliente" element={<PublicCadastroCliente />} />
        <Route path="/extrato-modelo" element={<ModeloExtratoPortal />} />
        <Route path="/assinatura-contrato" element={<ContratoAssinaturaPublica />} />
        <Route path="/agenda-confirmar" element={<PublicAgendaConfirmacao />} />
        <Route path="/*" element={<AuthGate>{({ user, onLogout }) => <App authUser={user} onLogout={onLogout} />}</AuthGate>} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
