import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Home from './components/Home';
import AdminDashboard from './components/AdminDashboard';
import GuestDashboard from './components/GuestDashboard';

function App() {
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/admin/:roomId" element={<AdminDashboard />} />
        <Route path="/room/:roomId" element={<GuestDashboard />} />
      </Routes>
    </div>
  );
}

export default App;
